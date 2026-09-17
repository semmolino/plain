"use strict";
const express = require("express");
const { requirePermission } = require("../middleware/permissions");

module.exports = (supabase) => {
  const router = express.Router();

  // Wer das Projektteam aendert, aendert das Projekt -> projects.edit.
  //
  // HOURLY_RATE ist davon getrennt: der Stundensatz fliesst in Kostenrechnung und
  // Nachkalkulation, und der Rechtekatalog fuehrt ihn nicht ohne Grund als
  // eigenes Paar (projects.hourly_rates.view/.edit). Ein Projektleiter darf
  // sein Team zusammenstellen, ohne deshalb Saetze setzen zu duerfen.
  //
  // Vor dieser Aenderung trug KEINER der drei mutierenden Endpunkte eine
  // Pruefung — die Datei importierte requirePermission nicht einmal. Jeder
  // angemeldete Mitarbeiter konnte sich jedem Projekt des Mandanten zuordnen
  // und Saetze setzen (Sicherheitsaudit 2026-09-03, H2).
  const TEAM_GUARD = requirePermission("projects.edit");

  /** 403, wenn die Nutzlast einen Stundensatz setzt und das Recht dafuer fehlt. */
  function satzGuard(req, res, next) {
    const b = req.body || {};
    if (b.hourly_rate === undefined) return next();
    if (req.hasPermission("projects.hourly_rates.edit")) return next();
    return res.status(403).json({ error: "Fehlende Berechtigung: projects.hourly_rates.edit" });
  }

  // GET /preset?employee_id=&project_id=
  router.get("/preset", async (req, res) => {
    const employeeId = Number(req.query.employee_id);
    const projectId  = Number(req.query.project_id);
    if (!employeeId || !projectId)
      return res.status(400).json({ error: "employee_id and project_id are required" });

    const { data, error } = await supabase
      .from("EMPLOYEE2PROJECT")
      .select("ROLE_ID, ROLE_ABBR, ROLE_NAME, HOURLY_RATE")
      .eq("EMPLOYEE_ID", employeeId)
      .eq("PROJECT_ID", projectId)
      // Als einziger Endpunkt dieser Datei fehlte hier der Mandantenfilter.
      // RLS faengt es ab, aber die zweite Linie gehoert dazu — sonst haengt
      // die Trennung an einer Umgebungsvariablen.
      .eq("TENANT_ID", req.tenantId)
      .limit(1);

    if (error) return res.status(500).json({ error: error.message });
    if (!data || !data.length) return res.json({ found: false });

    const row = data[0];
    return res.json({
      found:           true,
      ROLE_ID:         row.ROLE_ID         ?? null,
      ROLE_ABBR: row.ROLE_ABBR ?? null,
      ROLE_NAME:  row.ROLE_NAME  ?? null,
      HOURLY_RATE:         row.HOURLY_RATE         ?? null,
    });
  });

  // GET /project/:projectId — list all assignments for a project
  router.get("/project/:projectId", async (req, res) => {
    const projectId = Number(req.params.projectId);
    if (!projectId) return res.status(400).json({ error: "projectId fehlt" });

    const { data: e2pRows, error } = await supabase
      .from("EMPLOYEE2PROJECT")
      .select("ID, EMPLOYEE_ID, ROLE_ID, ROLE_ABBR, ROLE_NAME, HOURLY_RATE")
      .eq("PROJECT_ID", projectId)
      .eq("TENANT_ID", req.tenantId)
      .order("ID");

    if (error) return res.status(500).json({ error: error.message });
    if (!e2pRows || !e2pRows.length) return res.json({ data: [] });

    const employeeIds = [...new Set(e2pRows.map(r => r.EMPLOYEE_ID))];
    const { data: emps } = await supabase
      .from("EMPLOYEE")
      .select("ID, ABBR, FIRST_NAME, LAST_NAME")
      .in("ID", employeeIds)
      .eq("TENANT_ID", req.tenantId);

    const empMap = Object.fromEntries((emps || []).map(e => [e.ID, e]));

    const enriched = e2pRows.map(r => ({
      ...r,
      EMPLOYEE_SHORT_NAME: empMap[r.EMPLOYEE_ID]?.ABBR ?? null,
      EMPLOYEE_FIRST_NAME: empMap[r.EMPLOYEE_ID]?.FIRST_NAME ?? null,
      EMPLOYEE_LAST_NAME:  empMap[r.EMPLOYEE_ID]?.LAST_NAME  ?? null,
    }));

    res.json({ data: enriched });
  });

  // GET /employee/:employeeId — list all projects an employee is assigned to
  router.get("/employee/:employeeId", async (req, res) => {
    const employeeId = Number(req.params.employeeId);
    if (!employeeId) return res.status(400).json({ error: "employeeId fehlt" });

    const { data: e2pRows, error } = await supabase
      .from("EMPLOYEE2PROJECT")
      .select("ID, PROJECT_ID, ROLE_ABBR, ROLE_NAME, HOURLY_RATE")
      .eq("EMPLOYEE_ID", employeeId)
      .eq("TENANT_ID", req.tenantId)
      .order("ID");

    if (error) return res.status(500).json({ error: error.message });
    if (!e2pRows || !e2pRows.length) return res.json({ data: [] });

    const projectIds = [...new Set(e2pRows.map(r => r.PROJECT_ID).filter(Boolean))];
    const { data: projects } = await supabase
      .from("PROJECT")
      .select("ID, ABBR, NAME, STATUS:PROJECT_STATUS_ID(ABBR)")
      .in("ID", projectIds)
      .eq("TENANT_ID", req.tenantId);

    const projMap = Object.fromEntries((projects || []).map(p => [p.ID, p]));

    const enriched = e2pRows
      .filter(r => projMap[r.PROJECT_ID])
      .map(r => ({
        ID:              r.ID,
        PROJECT_ID:      r.PROJECT_ID,
        PROJECT_NUMBER:  projMap[r.PROJECT_ID]?.ABBR ?? null,
        PROJECT_NAME:    projMap[r.PROJECT_ID]?.NAME  ?? null,
        STATUS_NAME:     projMap[r.PROJECT_ID]?.STATUS?.ABBR ?? null,
        ROLE_ABBR: r.ROLE_ABBR ?? null,
        HOURLY_RATE:         r.HOURLY_RATE ?? null,
      }));

    res.json({ data: enriched });
  });

  // POST /project/:projectId — add employee to project
  router.post("/project/:projectId", TEAM_GUARD, satzGuard, async (req, res) => {
    const projectId = Number(req.params.projectId);
    if (!projectId) return res.status(400).json({ error: "projectId fehlt" });

    const b = req.body || {};
    if (!b.employee_id) return res.status(400).json({ error: "employee_id fehlt" });

    const { data, error } = await supabase
      .from("EMPLOYEE2PROJECT")
      .insert({
        PROJECT_ID:      projectId,
        EMPLOYEE_ID:     Number(b.employee_id),
        ROLE_ID:         b.role_id ? Number(b.role_id) : null,
        ROLE_ABBR: b.role_abbr || "",
        ROLE_NAME:  b.role_name  || "",
        HOURLY_RATE:         b.hourly_rate !== "" && b.hourly_rate != null ? Number(b.hourly_rate) : null,
        TENANT_ID:       req.tenantId,
      })
      .select("ID, EMPLOYEE_ID, ROLE_ID, ROLE_ABBR, ROLE_NAME, HOURLY_RATE")
      .single();

    if (error) return res.status(500).json({ error: error.message });
    res.json({ data });
  });

  // PATCH /:id — update role / rate
  router.patch("/:id", TEAM_GUARD, satzGuard, async (req, res) => {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ error: "ID fehlt" });

    const b = req.body || {};
    const update = {};
    if (b.role_id         !== undefined) update.ROLE_ID         = b.role_id ? Number(b.role_id) : null;
    if (b.role_abbr !== undefined) update.ROLE_ABBR = b.role_abbr || "";
    if (b.role_name  !== undefined) update.ROLE_NAME  = b.role_name  || "";
    if (b.hourly_rate         !== undefined) update.HOURLY_RATE         = b.hourly_rate !== "" && b.hourly_rate != null ? Number(b.hourly_rate) : null;

    if (!Object.keys(update).length)
      return res.status(400).json({ error: "Keine Felder übergeben" });

    const { error } = await supabase
      .from("EMPLOYEE2PROJECT")
      .update(update)
      .eq("ID", id)
      .eq("TENANT_ID", req.tenantId);

    if (error) return res.status(500).json({ error: error.message });
    res.json({ success: true });
  });

  // DELETE /:id — remove employee from project
  router.delete("/:id", TEAM_GUARD, async (req, res) => {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ error: "ID fehlt" });

    const { error } = await supabase
      .from("EMPLOYEE2PROJECT")
      .delete()
      .eq("ID", id)
      .eq("TENANT_ID", req.tenantId);

    if (error) return res.status(500).json({ error: error.message });
    res.json({ success: true });
  });

  return router;
};
