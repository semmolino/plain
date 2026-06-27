"use strict";
const express = require("express");
const { requirePermission } = require("../middleware/permissions");

// ── Routen: Urlaub / Abwesenheit (Phase 1) ────────────────────────────────────
// Tenant-Isolation: jede Query filtert auf req.tenantId.
// Rechte: absence.view (fremde sehen) · absence.request (eigene beantragen) ·
//         absence.approve (genehmigen/ablehnen) · absence.manage (Arten/Anspruch
//         pflegen, fuer andere erfassen).
module.exports = (supabase) => {
  const router = express.Router();

  // Werktage (Mo–Fr) im Zeitraum; halber Tag nur bei Eintagesabwesenheit.
  // Phase 1 ohne Feiertags-Beruecksichtigung (Naeherung — spaeter verfeinern).
  function workdayCount(from, to, halfDay) {
    const a = new Date(`${from}T00:00:00`);
    const b = new Date(`${to}T00:00:00`);
    if (isNaN(a.getTime()) || isNaN(b.getTime()) || b < a) return 0;
    if (halfDay && from === to) return 0.5;
    let days = 0;
    for (const d = new Date(a); d <= b; d.setDate(d.getDate() + 1)) {
      const wd = d.getDay();
      if (wd !== 0 && wd !== 6) days++;
    }
    return days;
  }

  // ── ABSENCE_TYPE (Katalog) ──────────────────────────────────────────────────
  router.get("/types", async (req, res) => {
    const { data, error } = await supabase
      .from("ABSENCE_TYPE")
      .select("*")
      .eq("TENANT_ID", req.tenantId)
      .order("SORT_ORDER", { ascending: true })
      .order("NAME", { ascending: true });
    if (error) return res.status(500).json({ error: error.message });
    res.json({ data: data || [] });
  });

  router.post("/types", requirePermission("absence.manage"), async (req, res) => {
    const b = req.body || {};
    if (!b.name) return res.status(400).json({ error: "Name erforderlich" });
    const { data, error } = await supabase.from("ABSENCE_TYPE").insert([{
      TENANT_ID:         req.tenantId,
      NAME:              b.name,
      COLOR:             b.color || null,
      COUNTS_AS_WORKED:  b.counts_as_worked  !== false,
      REDUCES_VACATION:  !!b.reduces_vacation,
      REQUIRES_APPROVAL: b.requires_approval !== false,
      IS_PAID:           b.is_paid !== false,
      ACTIVE:            b.active != null ? Number(b.active) : 1,
      SORT_ORDER:        b.sort_order != null ? Number(b.sort_order) : 0,
    }]).select("*").single();
    if (error) return res.status(500).json({ error: error.message });
    res.json({ data });
  });

  router.patch("/types/:id", requirePermission("absence.manage"), async (req, res) => {
    const id = Number(req.params.id);
    const b = req.body || {};
    const upd = {};
    if (b.name             !== undefined) upd.NAME              = b.name;
    if (b.color            !== undefined) upd.COLOR             = b.color || null;
    if (b.counts_as_worked !== undefined) upd.COUNTS_AS_WORKED  = !!b.counts_as_worked;
    if (b.reduces_vacation !== undefined) upd.REDUCES_VACATION  = !!b.reduces_vacation;
    if (b.requires_approval!== undefined) upd.REQUIRES_APPROVAL = !!b.requires_approval;
    if (b.is_paid          !== undefined) upd.IS_PAID           = !!b.is_paid;
    if (b.active           !== undefined) upd.ACTIVE            = Number(b.active);
    if (b.sort_order       !== undefined) upd.SORT_ORDER        = Number(b.sort_order);
    if (!Object.keys(upd).length) return res.status(400).json({ error: "Keine Felder" });
    const { error } = await supabase.from("ABSENCE_TYPE").update(upd).eq("ID", id).eq("TENANT_ID", req.tenantId);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ success: true });
  });

  router.delete("/types/:id", requirePermission("absence.manage"), async (req, res) => {
    const id = Number(req.params.id);
    // Wird die Art noch verwendet -> nur deaktivieren statt loeschen.
    const { data: used } = await supabase.from("ABSENCE").select("ID").eq("ABSENCE_TYPE_ID", id).eq("TENANT_ID", req.tenantId).limit(1);
    if (used && used.length) {
      const { error } = await supabase.from("ABSENCE_TYPE").update({ ACTIVE: 0 }).eq("ID", id).eq("TENANT_ID", req.tenantId);
      if (error) return res.status(500).json({ error: error.message });
      return res.json({ success: true, deactivated: true });
    }
    const { error } = await supabase.from("ABSENCE_TYPE").delete().eq("ID", id).eq("TENANT_ID", req.tenantId);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ success: true });
  });

  // ── ABSENCE ─────────────────────────────────────────────────────────────────
  // GET /?employee_id=&from=&to=&status=  (Zeitraum = Ueberlappung)
  router.get("/", async (req, res) => {
    const empId = req.query.employee_id ? Number(req.query.employee_id) : null;
    const wantsForeign = !empId || empId !== req.employeeId;
    if (wantsForeign && !req.hasPermission("absence.view"))
      return res.status(403).json({ error: "Fehlende Berechtigung: absence.view" });

    let q = supabase.from("ABSENCE").select("*").eq("TENANT_ID", req.tenantId);
    if (empId)             q = q.eq("EMPLOYEE_ID", empId);
    if (req.query.status)  q = q.eq("STATUS", req.query.status);
    if (req.query.from)    q = q.gte("DATE_TO", req.query.from);
    if (req.query.to)      q = q.lte("DATE_FROM", req.query.to);
    q = q.order("DATE_FROM", { ascending: false });
    const { data, error } = await q;
    if (error) return res.status(500).json({ error: error.message });

    const rows = data || [];
    const typeIds = [...new Set(rows.map(r => r.ABSENCE_TYPE_ID))];
    const empIds  = [...new Set(rows.map(r => r.EMPLOYEE_ID))];
    const [typesRes, empsRes] = await Promise.all([
      typeIds.length ? supabase.from("ABSENCE_TYPE").select("ID, NAME, COLOR, COUNTS_AS_WORKED, REDUCES_VACATION").in("ID", typeIds) : Promise.resolve({ data: [] }),
      empIds.length  ? supabase.from("EMPLOYEE").select("ID, SHORT_NAME, FIRST_NAME, LAST_NAME").in("ID", empIds).eq("TENANT_ID", req.tenantId) : Promise.resolve({ data: [] }),
    ]);
    const typeMap = Object.fromEntries((typesRes.data || []).map(t => [t.ID, t]));
    const empMap  = Object.fromEntries((empsRes.data  || []).map(e => [e.ID, e]));

    const enriched = rows.map(r => ({
      ...r,
      DAYS:                workdayCount(r.DATE_FROM, r.DATE_TO, r.HALF_DAY),
      TYPE_NAME:           typeMap[r.ABSENCE_TYPE_ID]?.NAME  ?? null,
      TYPE_COLOR:          typeMap[r.ABSENCE_TYPE_ID]?.COLOR ?? null,
      REDUCES_VACATION:    typeMap[r.ABSENCE_TYPE_ID]?.REDUCES_VACATION ?? false,
      EMPLOYEE_SHORT_NAME: empMap[r.EMPLOYEE_ID]?.SHORT_NAME ?? null,
      EMPLOYEE_FIRST_NAME: empMap[r.EMPLOYEE_ID]?.FIRST_NAME ?? null,
      EMPLOYEE_LAST_NAME:  empMap[r.EMPLOYEE_ID]?.LAST_NAME  ?? null,
    }));
    res.json({ data: enriched });
  });

  // POST / — Abwesenheit anlegen (eigener Antrag oder Erfassung fuer andere)
  router.post("/", async (req, res) => {
    const b = req.body || {};
    const empId = b.employee_id ? Number(b.employee_id) : req.employeeId;
    const forOther = empId !== req.employeeId;
    if (forOther) {
      if (!req.hasPermission("absence.manage"))  return res.status(403).json({ error: "Fehlende Berechtigung: absence.manage" });
    } else if (!req.hasPermission("absence.request")) {
      return res.status(403).json({ error: "Fehlende Berechtigung: absence.request" });
    }
    if (!b.absence_type_id || !b.date_from || !b.date_to)
      return res.status(400).json({ error: "Art, Von- und Bis-Datum erforderlich" });
    if (b.date_to < b.date_from) return res.status(400).json({ error: "Bis-Datum liegt vor Von-Datum" });
    const half = !!b.half_day && b.date_from === b.date_to;

    const { data: type } = await supabase.from("ABSENCE_TYPE")
      .select("REQUIRES_APPROVAL").eq("ID", Number(b.absence_type_id)).eq("TENANT_ID", req.tenantId).maybeSingle();
    const requiresApproval = type ? type.REQUIRES_APPROVAL !== false : true;
    // Erfassung fuer andere (durch Verwalter) -> direkt genehmigt;
    // eigener Antrag -> REQUESTED, ausser die Art braucht keine Freigabe.
    const status  = forOther ? "APPROVED" : (requiresApproval ? "REQUESTED" : "APPROVED");
    const decided = status === "APPROVED";

    const { data, error } = await supabase.from("ABSENCE").insert([{
      TENANT_ID:       req.tenantId,
      EMPLOYEE_ID:     empId,
      ABSENCE_TYPE_ID: Number(b.absence_type_id),
      DATE_FROM:       b.date_from,
      DATE_TO:         b.date_to,
      HALF_DAY:        half,
      STATUS:          status,
      NOTE:            b.note || null,
      REQUESTED_BY:    req.employeeId,
      DECIDED_BY:      decided ? req.employeeId : null,
      DECIDED_AT:      decided ? new Date().toISOString() : null,
    }]).select("*").single();
    if (error) return res.status(500).json({ error: error.message });
    res.json({ data });
  });

  // PATCH /:id — Felder aendern (eigener offener Antrag oder Verwalter)
  router.patch("/:id", async (req, res) => {
    const id = Number(req.params.id);
    const { data: row } = await supabase.from("ABSENCE").select("*").eq("ID", id).eq("TENANT_ID", req.tenantId).maybeSingle();
    if (!row) return res.status(404).json({ error: "Nicht gefunden" });
    const isOwner   = row.EMPLOYEE_ID === req.employeeId;
    const canManage = req.hasPermission("absence.manage");
    if (!canManage && !(isOwner && row.STATUS === "REQUESTED"))
      return res.status(403).json({ error: "Nur offene eigene Antraege sind editierbar" });

    const b = req.body || {};
    const upd = {};
    if (b.absence_type_id !== undefined) upd.ABSENCE_TYPE_ID = Number(b.absence_type_id);
    if (b.date_from       !== undefined) upd.DATE_FROM       = b.date_from;
    if (b.date_to         !== undefined) upd.DATE_TO         = b.date_to;
    if (b.half_day        !== undefined) upd.HALF_DAY        = !!b.half_day;
    if (b.note            !== undefined) upd.NOTE            = b.note || null;
    if (!Object.keys(upd).length) return res.status(400).json({ error: "Keine Felder" });

    const df = upd.DATE_FROM ?? row.DATE_FROM;
    const dt = upd.DATE_TO   ?? row.DATE_TO;
    if (dt < df) return res.status(400).json({ error: "Bis-Datum liegt vor Von-Datum" });
    if ((upd.HALF_DAY ?? row.HALF_DAY) && df !== dt) upd.HALF_DAY = false;

    const { error } = await supabase.from("ABSENCE").update(upd).eq("ID", id).eq("TENANT_ID", req.tenantId);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ success: true });
  });

  // POST /:id/decision — genehmigen / ablehnen
  router.post("/:id/decision", requirePermission("absence.approve"), async (req, res) => {
    const id = Number(req.params.id);
    const decision = String(req.body?.decision || "").toUpperCase();
    if (!["APPROVED", "REJECTED"].includes(decision))
      return res.status(400).json({ error: "decision muss APPROVED oder REJECTED sein" });
    const { error } = await supabase.from("ABSENCE").update({
      STATUS:        decision,
      DECIDED_BY:    req.employeeId,
      DECIDED_AT:    new Date().toISOString(),
      DECISION_NOTE: req.body?.note || null,
    }).eq("ID", id).eq("TENANT_ID", req.tenantId);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ success: true });
  });

  // POST /:id/cancel — stornieren (Owner oder Verwalter)
  router.post("/:id/cancel", async (req, res) => {
    const id = Number(req.params.id);
    const { data: row } = await supabase.from("ABSENCE").select("EMPLOYEE_ID").eq("ID", id).eq("TENANT_ID", req.tenantId).maybeSingle();
    if (!row) return res.status(404).json({ error: "Nicht gefunden" });
    if (row.EMPLOYEE_ID !== req.employeeId && !req.hasPermission("absence.manage"))
      return res.status(403).json({ error: "Keine Berechtigung" });
    const { error } = await supabase.from("ABSENCE").update({ STATUS: "CANCELLED" }).eq("ID", id).eq("TENANT_ID", req.tenantId);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ success: true });
  });

  // DELETE /:id — loeschen (eigener offener Antrag oder Verwalter)
  router.delete("/:id", async (req, res) => {
    const id = Number(req.params.id);
    const { data: row } = await supabase.from("ABSENCE").select("EMPLOYEE_ID, STATUS").eq("ID", id).eq("TENANT_ID", req.tenantId).maybeSingle();
    if (!row) return res.status(404).json({ error: "Nicht gefunden" });
    const isOwner = row.EMPLOYEE_ID === req.employeeId;
    if (!req.hasPermission("absence.manage") && !(isOwner && row.STATUS === "REQUESTED"))
      return res.status(403).json({ error: "Keine Berechtigung" });
    const { error } = await supabase.from("ABSENCE").delete().eq("ID", id).eq("TENANT_ID", req.tenantId);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ success: true });
  });

  // ── Urlaubsanspruch + Saldo ───────────────────────────────────────────────
  router.get("/entitlements", async (req, res) => {
    const empId = req.query.employee_id ? Number(req.query.employee_id) : req.employeeId;
    if (empId !== req.employeeId && !req.hasPermission("absence.view"))
      return res.status(403).json({ error: "Fehlende Berechtigung: absence.view" });
    let q = supabase.from("VACATION_ENTITLEMENT").select("*").eq("TENANT_ID", req.tenantId).eq("EMPLOYEE_ID", empId);
    if (req.query.year) q = q.eq("YEAR", Number(req.query.year));
    q = q.order("YEAR", { ascending: false });
    const { data, error } = await q;
    if (error) return res.status(500).json({ error: error.message });
    res.json({ data: data || [] });
  });

  router.put("/entitlements", requirePermission("absence.manage"), async (req, res) => {
    const b = req.body || {};
    const empId = Number(b.employee_id), year = Number(b.year);
    if (!empId || !year) return res.status(400).json({ error: "employee_id und year erforderlich" });
    const payload = {
      TENANT_ID:          req.tenantId,
      EMPLOYEE_ID:        empId,
      YEAR:               year,
      DAYS_ENTITLED:      b.days_entitled != null ? Number(b.days_entitled) : 0,
      CARRYOVER_OVERRIDE: b.carryover_override != null && b.carryover_override !== "" ? Number(b.carryover_override) : null,
      NOTE:               b.note || null,
    };
    const { data: existing } = await supabase.from("VACATION_ENTITLEMENT")
      .select("ID").eq("TENANT_ID", req.tenantId).eq("EMPLOYEE_ID", empId).eq("YEAR", year).maybeSingle();
    const result = existing
      ? await supabase.from("VACATION_ENTITLEMENT").update(payload).eq("ID", existing.ID).select("*").single()
      : await supabase.from("VACATION_ENTITLEMENT").insert([payload]).select("*").single();
    if (result.error) return res.status(500).json({ error: result.error.message });
    res.json({ data: result.data });
  });

  // GET /vacation-balance?employee_id=&year= — Anspruch + Auto-Uebertrag - genommen
  router.get("/vacation-balance", async (req, res) => {
    const empId = req.query.employee_id ? Number(req.query.employee_id) : req.employeeId;
    const year  = req.query.year ? Number(req.query.year) : new Date().getFullYear();
    if (empId !== req.employeeId && !req.hasPermission("absence.view"))
      return res.status(403).json({ error: "Fehlende Berechtigung: absence.view" });

    const { data: vacTypes } = await supabase.from("ABSENCE_TYPE")
      .select("ID").eq("TENANT_ID", req.tenantId).eq("REDUCES_VACATION", true);
    const vacTypeIds = (vacTypes || []).map(t => t.ID);

    const { data: entitlements } = await supabase.from("VACATION_ENTITLEMENT")
      .select("*").eq("TENANT_ID", req.tenantId).eq("EMPLOYEE_ID", empId);
    const { data: absences } = vacTypeIds.length
      ? await supabase.from("ABSENCE").select("DATE_FROM, DATE_TO, HALF_DAY")
          .eq("TENANT_ID", req.tenantId).eq("EMPLOYEE_ID", empId).eq("STATUS", "APPROVED").in("ABSENCE_TYPE_ID", vacTypeIds)
      : { data: [] };

    const takenByYear = {};
    for (const a of absences || []) {
      const y = Number(String(a.DATE_FROM).slice(0, 4));
      takenByYear[y] = (takenByYear[y] || 0) + workdayCount(a.DATE_FROM, a.DATE_TO, a.HALF_DAY);
    }
    const entByYear = {};
    for (const e of entitlements || []) entByYear[e.YEAR] = e;

    const knownYears = [...new Set([...Object.keys(entByYear), ...Object.keys(takenByYear)].map(Number))];
    const minYear = knownYears.length ? Math.min(Math.min(...knownYears), year) : year;

    let carryover = 0;
    const breakdown = [];
    for (let y = minYear; y <= year; y++) {
      const ent = entByYear[y];
      const override = ent && ent.CARRYOVER_OVERRIDE != null ? Number(ent.CARRYOVER_OVERRIDE) : null;
      const startCarry = override != null ? override : carryover;
      const entitled = ent ? Number(ent.DAYS_ENTITLED) : 0;
      const taken = takenByYear[y] || 0;
      const remaining = Math.round((startCarry + entitled - taken) * 100) / 100;
      breakdown.push({ year: y, carryover: startCarry, entitled, taken, remaining });
      carryover = remaining;
    }
    const cur = breakdown[breakdown.length - 1] || { year, carryover: 0, entitled: 0, taken: 0, remaining: 0 };
    res.json({ data: { year: cur.year, entitled: cur.entitled, carryover: cur.carryover, taken: cur.taken, remaining: cur.remaining, breakdown } });
  });

  return router;
};
