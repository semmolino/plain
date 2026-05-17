"use strict";
const express = require("express");

module.exports = (supabase) => {
  const router = express.Router();

  // GET /preset?employee_id=&project_id=
  router.get("/preset", async (req, res) => {
    const employeeId = Number(req.query.employee_id);
    const projectId  = Number(req.query.project_id);
    if (!employeeId || !projectId)
      return res.status(400).json({ error: "employee_id and project_id are required" });

    const { data, error } = await supabase
      .from("EMPLOYEE2PROJECT")
      .select("ROLE_ID, ROLE_NAME_SHORT, ROLE_NAME_LONG, SP_RATE")
      .eq("EMPLOYEE_ID", employeeId)
      .eq("PROJECT_ID", projectId)
      .limit(1);

    if (error) return res.status(500).json({ error: error.message });
    if (!data || !data.length) return res.json({ found: false });

    const row = data[0];
    return res.json({
      found:           true,
      ROLE_ID:         row.ROLE_ID         ?? null,
      ROLE_NAME_SHORT: row.ROLE_NAME_SHORT ?? null,
      ROLE_NAME_LONG:  row.ROLE_NAME_LONG  ?? null,
      SP_RATE:         row.SP_RATE         ?? null,
    });
  });

  // GET /project/:projectId — list all assignments for a project
  router.get("/project/:projectId", async (req, res) => {
    const projectId = Number(req.params.projectId);
    if (!projectId) return res.status(400).json({ error: "projectId fehlt" });

    const { data: e2pRows, error } = await supabase
      .from("EMPLOYEE2PROJECT")
      .select("ID, EMPLOYEE_ID, ROLE_ID, ROLE_NAME_SHORT, ROLE_NAME_LONG, SP_RATE")
      .eq("PROJECT_ID", projectId)
      .eq("TENANT_ID", req.tenantId)
      .order("ID");

    if (error) return res.status(500).json({ error: error.message });
    if (!e2pRows || !e2pRows.length) return res.json({ data: [] });

    const employeeIds = [...new Set(e2pRows.map(r => r.EMPLOYEE_ID))];
    const { data: emps } = await supabase
      .from("EMPLOYEE")
      .select("ID, SHORT_NAME, FIRST_NAME, LAST_NAME")
      .in("ID", employeeIds)
      .eq("TENANT_ID", req.tenantId);

    const empMap = Object.fromEntries((emps || []).map(e => [e.ID, e]));

    const enriched = e2pRows.map(r => ({
      ...r,
      EMPLOYEE_SHORT_NAME: empMap[r.EMPLOYEE_ID]?.SHORT_NAME ?? null,
      EMPLOYEE_FIRST_NAME: empMap[r.EMPLOYEE_ID]?.FIRST_NAME ?? null,
      EMPLOYEE_LAST_NAME:  empMap[r.EMPLOYEE_ID]?.LAST_NAME  ?? null,
    }));

    res.json({ data: enriched });
  });

  // POST /project/:projectId — add employee to project
  router.post("/project/:projectId", async (req, res) => {
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
        ROLE_NAME_SHORT: b.role_name_short || "",
        ROLE_NAME_LONG:  b.role_name_long  || "",
        SP_RATE:         b.sp_rate !== "" && b.sp_rate != null ? Number(b.sp_rate) : null,
        TENANT_ID:       req.tenantId,
      })
      .select("ID, EMPLOYEE_ID, ROLE_ID, ROLE_NAME_SHORT, ROLE_NAME_LONG, SP_RATE")
      .single();

    if (error) return res.status(500).json({ error: error.message });
    res.json({ data });
  });

  // PATCH /:id — update role / rate
  router.patch("/:id", async (req, res) => {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ error: "ID fehlt" });

    const b = req.body || {};
    const update = {};
    if (b.role_id         !== undefined) update.ROLE_ID         = b.role_id ? Number(b.role_id) : null;
    if (b.role_name_short !== undefined) update.ROLE_NAME_SHORT = b.role_name_short || "";
    if (b.role_name_long  !== undefined) update.ROLE_NAME_LONG  = b.role_name_long  || "";
    if (b.sp_rate         !== undefined) update.SP_RATE         = b.sp_rate !== "" && b.sp_rate != null ? Number(b.sp_rate) : null;

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
  router.delete("/:id", async (req, res) => {
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
