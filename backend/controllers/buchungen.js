"use strict";

const svc = require("../services/buchungen");

async function createBuchung(req, res, supabase) {
  try {
    await svc.createBuchung(supabase, { body: req.body, tenantId: req.tenantId });
    res.json({ success: true });
  } catch (err) {
    const status = err.status || 500;
    res.status(status).json({ error: err.message || err });
  }
}

async function patchBuchung(req, res, supabase) {
  const id = req.params.id;
  if (!id) return res.status(400).json({ error: "ID fehlt" });
  try {
    const data = await svc.patchBuchung(supabase, { id, body: req.body, tenantId: req.tenantId });
    res.json({ data });
  } catch (err) {
    const status = err.status || 500;
    res.status(status).json({ error: err.message || err });
  }
}

async function deleteBuchung(req, res, supabase) {
  const id = parseInt(req.params.id, 10);
  if (!id) return res.status(400).json({ error: "ID fehlt" });
  try {
    const depCheck = require("../services/dependencyCheck");
    const check = await depCheck.checkTec(supabase, { tenantId: req.tenantId, id });
    if (check.blocked) return res.status(409).json({ error: check.message, refs: check.refs });
    await svc.deleteBuchung(supabase, { id });
    res.json({ success: true });
  } catch (err) {
    const status = err.status || 500;
    res.status(status).json({ error: err.message || err });
  }
}

async function listBuchungenByProject(req, res, supabase) {
  const projectId = req.params.id;
  try {
    const data = await svc.listBuchungenByProject(supabase, { projectId, tenantId: req.tenantId });

    // Phase 6: Felder-Filter — Erloese / Kosten nur mit jeweiliger Permission
    const showRevenue = !!req._permissionsUnrestricted || req.permissions?.has?.("projects.bookings.revenue.view");
    const showCosts   = !!req._permissionsUnrestricted || req.permissions?.has?.("projects.bookings.costs.view");
    const filtered = (data || []).map(r => {
      const out = { ...r };
      if (!showRevenue) {
        delete out.QUANTITY_EXT;
        delete out.SP_RATE;
        delete out.SP_TOT;
      }
      if (!showCosts) {
        delete out.CP_RATE;
        delete out.CP_TOT;
      }
      return out;
    });

    res.json({ data: filtered });
  } catch (err) {
    res.status(500).json({ error: err.message || err });
  }
}

async function createTimerDraft(req, res, supabase) {
  try {
    const data = await svc.createTimerDraft(supabase, { body: req.body, tenantId: req.tenantId });
    res.json({ success: true, data });
  } catch (err) {
    const status = err.status || 500;
    res.status(status).json({ error: err.message || err });
  }
}

async function listDraftsByEmployee(req, res, supabase) {
  const { employee_id, date } = req.query;
  try {
    const data = await svc.listDraftsByEmployee(supabase, { employeeId: employee_id, date, tenantId: req.tenantId });
    res.json({ data });
  } catch (err) {
    res.status(500).json({ error: err.message || err });
  }
}

async function confirmDrafts(req, res, supabase) {
  const { ids, break_confirmations } = req.body || {};
  try {
    const result = await svc.confirmDrafts(supabase, {
      ids,
      breakConfirmations: break_confirmations || {},
      tenantId: req.tenantId,
    });
    res.json({ success: true, ...result });
  } catch (err) {
    const status = err.status || 500;
    res.status(status).json({ error: err.message || err, details: err.details });
  }
}

async function deleteDraft(req, res, supabase) {
  const id = req.params.id;
  if (!id) return res.status(400).json({ error: "ID fehlt" });
  try {
    await svc.deleteDraft(supabase, { id });
    res.json({ success: true });
  } catch (err) {
    const status = err.status || 500;
    res.status(status).json({ error: err.message || err });
  }
}

async function patchDraftDescription(req, res, supabase) {
  const id = req.params.id;
  if (!id) return res.status(400).json({ error: "ID fehlt" });
  const { description, time_start, time_finish, quantity_int } = req.body || {};
  try {
    await svc.patchDraftDescription(supabase, { id, description, time_start, time_finish, quantity_int });
    res.json({ success: true });
  } catch (err) {
    const status = err.status || 500;
    res.status(status).json({ error: err.message || err });
  }
}

// ── Workstart-Status (Stempeluhr-Auto-Popup) ─────────────────────────────────
//
// Liefert dem Frontend zwei Werte fuer die Login-Logik:
//   autoshowEnabled   tenant-weiter Schalter (NOTIFICATION_TYPE_CONFIG
//                      fuer 'workstart_autoshow').
//   hasBookingsToday  hat der eingeloggte Mitarbeiter heute schon eine
//                      TEC-Zeile (Draft oder Confirmed)?
// Wenn beides erfuellt ist: Pop-up automatisch oeffnen.
async function getWorkstartStatus(req, res, supabase) {
  try {
    const employeeId = req.employeeId;
    const tenantId   = req.tenantId;
    const today      = new Date().toISOString().slice(0, 10);

    let autoshowEnabled = false;
    try {
      // Tenant-Override hat Vorrang, sonst Default aus dem Katalog.
      const { data: cfg } = await supabase
        .from("NOTIFICATION_TYPE_CONFIG")
        .select("ENABLED")
        .eq("TENANT_ID", tenantId)
        .eq("TYPE_KEY", "workstart_autoshow")
        .maybeSingle();
      if (cfg) {
        autoshowEnabled = !!cfg.ENABLED;
      } else {
        const { data: cat } = await supabase
          .from("NOTIFICATION_TYPE")
          .select("DEFAULT_ENABLED")
          .eq("TYPE_KEY", "workstart_autoshow")
          .maybeSingle();
        autoshowEnabled = !!cat?.DEFAULT_ENABLED;
      }
    } catch (_) { /* Migration 0057 noch nicht da -> autoshowEnabled bleibt false */ }

    const { data: tecRows } = await supabase
      .from("TEC")
      .select("ID")
      .eq("TENANT_ID", tenantId)
      .eq("EMPLOYEE_ID", employeeId)
      .eq("DATE_VOUCHER", today)
      .limit(1);
    const hasBookingsToday = Array.isArray(tecRows) && tecRows.length > 0;

    res.json({ data: { autoshowEnabled, hasBookingsToday, today } });
  } catch (e) {
    res.status(500).json({ error: e?.message || String(e) });
  }
}

module.exports = {
  createBuchung,
  patchBuchung,
  deleteBuchung,
  listBuchungenByProject,
  createTimerDraft,
  listDraftsByEmployee,
  confirmDrafts,
  deleteDraft,
  patchDraftDescription,
  getWorkstartStatus,
};
