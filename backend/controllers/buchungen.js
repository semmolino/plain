"use strict";

const svc = require("../services/buchungen");
const eigen = require("../services/eigeneZeit");

const has = (req, key) => !!req._permissionsUnrestricted || !!req.hasPermission?.(key);
/** Nur „Eigene Zeit buchen", nicht das volle Recht fuer diese Aktion. */
const ownOnly = (req, fullKey) => !has(req, fullKey) && has(req, "projects.bookings.own");

/** Eigene, geladene Buchung — oder 403/404. */
async function loadOwnBooking(supabase, req, id) {
  const { data } = await supabase
    .from("BOOKING").select("ID, EMPLOYEE_ID, PROJECT_ID, BOOKING_DATE")
    .eq("ID", id).eq("TENANT_ID", req.tenantId).maybeSingle();
  if (!data) throw { status: 404, message: "Buchung nicht gefunden" };
  if (Number(data.EMPLOYEE_ID) !== Number(req.employeeId)) {
    throw { status: 403, message: "Nur eigene Buchungen lassen sich ändern." };
  }
  return data;
}

/** GET /buchungen/mine?from&to — eigene Buchungen, Mitarbeiter aus der Sitzung. */
async function listMine(req, res, supabase) {
  try {
    const data = await eigen.listMine(supabase, {
      tenantId: req.tenantId, employeeId: req.employeeId, from: req.query.from, to: req.query.to,
    });
    res.json({ data });
  } catch (err) {
    res.status(err?.status || 500).json({ error: err?.message || String(err) });
  }
}

async function createBuchung(req, res, supabase) {
  try {
    let body = req.body || {};
    // Mit „Eigene Zeit buchen": immer fuer sich selbst, Saetze vom Server,
    // Stunden zur Abrechnung = geleistete Stunden, nur laufende Projekte.
    if (ownOnly(req, "projects.bookings.create")) {
      await eigen.assertBookable(supabase, { tenantId: req.tenantId, projectId: body.PROJECT_ID });
      if (body.STRUCTURE_ID) {
        await eigen.assertLeafOfProject(supabase, { tenantId: req.tenantId, projectId: body.PROJECT_ID, structureId: body.STRUCTURE_ID });
      }
      body = { ...body, EMPLOYEE_ID: req.employeeId, HOURLY_RATE: 0, QUANTITY_EXT: body.QUANTITY_INT };
      delete body.COST_RATE;
    }
    await svc.createBuchung(supabase, { body, tenantId: req.tenantId });
    res.json({ success: true });
  } catch (err) {
    const status = err.status || 500;
    res.status(status).json({ error: err.message || err });
  }
}

async function createSpecialBuchung(req, res, supabase) {
  try {
    const data = await svc.createSpecialBuchung(supabase, {
      body: req.body,
      tenantId: req.tenantId,
      employeeId: req.employeeId,
    });
    res.json({ success: true, data });
  } catch (err) {
    const status = err.status || 500;
    res.status(status).json({ error: err.message || err });
  }
}

async function updateSpecialBuchung(req, res, supabase) {
  const id = req.params.id;
  if (!id) return res.status(400).json({ error: "ID fehlt" });
  try {
    const data = await svc.updateSpecialBuchung(supabase, { id, body: req.body, tenantId: req.tenantId });
    res.json({ success: true, data });
  } catch (err) {
    const status = err.status || 500;
    res.status(status).json({ error: err.message || err });
  }
}

async function patchBuchung(req, res, supabase) {
  const id = req.params.id;
  if (!id) return res.status(400).json({ error: "ID fehlt" });
  try {
    let body = req.body || {};
    if (ownOnly(req, "projects.bookings.edit")) {
      const own = await loadOwnBooking(supabase, req, id);
      // Nur Zeit, Menge, Text und die Leistung im selben Projekt — kein
      // Mitarbeiter-, Projekt- oder Satzwechsel (Umbuchen ist ein eigenes Recht).
      const allowed = ["BOOKING_DATE", "TIME_START", "TIME_FINISH", "QUANTITY_INT", "POSTING_DESCRIPTION", "STRUCTURE_ID"];
      body = Object.fromEntries(Object.entries(body).filter(([k]) => allowed.includes(k)));
      if (body.QUANTITY_INT !== undefined) body.QUANTITY_EXT = body.QUANTITY_INT;
      if (body.STRUCTURE_ID !== undefined) {
        await eigen.assertLeafOfProject(supabase, { tenantId: req.tenantId, projectId: own.PROJECT_ID, structureId: body.STRUCTURE_ID });
      }
    }
    const data = await svc.patchBuchung(supabase, { id, body, tenantId: req.tenantId });
    // patchBuchung liefert die ganze Zeile (select *) — Saetze nur mit Recht,
    // wie beim Lesen der Liste.
    res.json({ data: stripBookingMoney(req, [data])[0] });
  } catch (err) {
    const status = err.status || 500;
    res.status(status).json({ error: err.message || err });
  }
}

async function deleteBuchung(req, res, supabase) {
  const id = parseInt(req.params.id, 10);
  if (!id) return res.status(400).json({ error: "ID fehlt" });
  try {
    if (ownOnly(req, "projects.bookings.delete")) {
      const own = await loadOwnBooking(supabase, req, id);
      if (own.BOOKING_DATE) await svc.checkMonthNotClosed(supabase, req.tenantId, own.EMPLOYEE_ID, String(own.BOOKING_DATE));
    }
    const depCheck = require("../services/dependencyCheck");
    const check = await depCheck.checkTec(supabase, { tenantId: req.tenantId, id });
    if (check.blocked) return res.status(409).json({ error: check.message, refs: check.refs });
    await svc.deleteBuchung(supabase, { id, tenantId: req.tenantId });
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
    res.json({ data: stripBookingMoney(req, data) });
  } catch (err) {
    res.status(err?.status || 500).json({ error: err?.message || String(err) });
  }
}

async function createTimerDraft(req, res, supabase) {
  try {
    // EMPLOYEE_ID aus der SITZUNG, nicht aus dem Body. Frueher liess sich
    // hier eine fremde Mitarbeiter-ID mitschicken und damit eine Zeitbuchung
    // fuer einen Kollegen anlegen (Pentest 2026-08-06).
    const data = await svc.createTimerDraft(supabase, {
      body: { ...(req.body || {}), EMPLOYEE_ID: req.employeeId },
      tenantId: req.tenantId,
    });
    res.json({ success: true, data });
  } catch (err) {
    const status = err.status || 500;
    res.status(status).json({ error: err.message || err });
  }
}

/** Erloes- und Kostenfelder nur mit dem jeweiligen Recht (wie die Projektliste). */
function stripBookingMoney(req, rows) {
  const showRevenue = !!req._permissionsUnrestricted || req.permissions?.has?.("projects.bookings.revenue.view");
  const showCosts   = !!req._permissionsUnrestricted || req.permissions?.has?.("projects.bookings.costs.view");
  return (rows || []).map(r => {
    const out = { ...r };
    if (!showRevenue) { delete out.QUANTITY_EXT; delete out.HOURLY_RATE; delete out.HOURLY_RATE_TOTAL; }
    if (!showCosts)   { delete out.COST_RATE; delete out.COST_TOTAL; }
    return out;
  });
}

/** Timer-Entwuerfe sehen und bestaetigen: eigene immer, fremde nur mit
 *  employees.bookings.view_all. Vorher kam die Mitarbeiter-ID ungeprueft aus
 *  der Anfrage — jeder mit Buchungsrecht las (samt Kostensatz) und bestaetigte
 *  die Tagesentwuerfe eines Kollegen. */
function mayActForEmployee(req, employeeId) {
  if (Number(employeeId) === Number(req.employeeId)) return true;
  return !!req.hasPermission?.("employees.bookings.view_all");
}

async function listDraftsByEmployee(req, res, supabase) {
  const { employee_id, date } = req.query;
  const employeeId = employee_id != null && employee_id !== "" ? Number(employee_id) : req.employeeId;
  if (!mayActForEmployee(req, employeeId)) {
    return res.status(403).json({ error: "Nur eigene Entwürfe sichtbar." });
  }
  try {
    const data = await svc.listDraftsByEmployee(supabase, { employeeId, date, tenantId: req.tenantId });
    res.json({ data: stripBookingMoney(req, data) });
  } catch (err) {
    res.status(err?.status || 500).json({ error: err?.message || String(err) });
  }
}

async function confirmDrafts(req, res, supabase) {
  const { ids, break_confirmations } = req.body || {};
  try {
    const result = await svc.confirmDrafts(supabase, {
      ids,
      breakConfirmations: break_confirmations || {},
      tenantId: req.tenantId,
      // Fremde Entwuerfe nur mit Team-Sicht; sonst werden sie still uebergangen.
      employeeId: req.hasPermission?.("employees.bookings.view_all") ? null : req.employeeId,
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
    await svc.deleteDraft(supabase, { id, tenantId: req.tenantId, employeeId: req.employeeId });
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
    await svc.patchDraftDescription(supabase, { id, description, time_start, time_finish, quantity_int, tenantId: req.tenantId, employeeId: req.employeeId });
    res.json({ success: true });
  } catch (err) {
    const status = err.status || 500;
    res.status(status).json({ error: err.message || err });
  }
}

// ── Umbuchen ────────────────────────────────────────────────────────────────
//
// Zwei Endpunkte, EIN Service-Aufruf: die Vorschau ist derselbe Lauf mit
// dryRun=true. Sie ist die Entscheidungsgrundlage des Nutzers ("welche
// Buchungen sind gesperrt, welcher Satz aendert sich?") — eine zweite,
// harmlosere Kopie der Pruefungen waere die Stelle, an der Vorschau und
// Ergebnis auseinanderlaufen.
async function rebookHandler(req, res, supabase, dryRun) {
  const b = req.body || {};
  try {
    const data = await svc.rebookBuchungen(supabase, {
      ids:               b.ids,
      targetProjectId:   b.target_project_id,
      targetStructureId: b.target_structure_id,
      reason:            b.reason,
      dryRun,
      tenantId:          req.tenantId,
      employeeId:        req.employeeId,
    });

    // Felder-Filter wie in listBuchungenByProject: wer Erloese nicht sehen
    // darf, bekommt die Betraege auch hier nicht. Der Hinweis, DASS sich der
    // Satz aendert, bleibt — er nennt keine Zahl und ist die Grundlage der
    // Entscheidung.
    const showRevenue = !!req._permissionsUnrestricted || req.permissions?.has?.("projects.bookings.revenue.view");
    if (!showRevenue) {
      data.moved = (data.moved || []).map(({ HOURLY_RATE_BEFORE, HOURLY_RATE_AFTER, HOURLY_RATE_TOTAL_BEFORE, HOURLY_RATE_TOTAL_AFTER, ...rest }) => rest);
    }

    res.json({ success: true, data });
  } catch (err) {
    const status = err.status || 500;
    res.status(status).json({ error: err.message || String(err) });
  }
}

const previewRebook = (req, res, supabase) => rebookHandler(req, res, supabase, true);
const rebook        = (req, res, supabase) => rebookHandler(req, res, supabase, false);

// ── Workstart-Status (Stempeluhr-Auto-Popup) ─────────────────────────────────
//
// Liefert dem Frontend zwei Werte fuer die Login-Logik:
//   autoshowEnabled   tenant-weiter Schalter (NOTIFICATION_TYPE_CONFIG
//                      fuer 'workstart_autoshow').
//   hasBookingsToday  hat der eingeloggte Mitarbeiter heute schon eine
//                      BOOKING-Zeile (Draft oder Confirmed)?
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
      .from("BOOKING")
      .select("ID")
      .eq("TENANT_ID", tenantId)
      .eq("EMPLOYEE_ID", employeeId)
      .eq("BOOKING_DATE", today)
      .limit(1);
    const hasBookingsToday = Array.isArray(tecRows) && tecRows.length > 0;

    res.json({ data: { autoshowEnabled, hasBookingsToday, today } });
  } catch (e) {
    res.status(e?.status || 500).json({ error: e?.message || String(e) });
  }
}

async function listOwnProjects(req, res, supabase) {
  try {
    res.json({ data: await eigen.listOwnProjects(supabase, { tenantId: req.tenantId }) });
  } catch (err) {
    res.status(err?.status || 500).json({ error: err?.message || String(err) });
  }
}

async function listOwnLeaves(req, res, supabase) {
  try {
    res.json({ data: await eigen.listOwnLeaves(supabase, { tenantId: req.tenantId, projectId: req.params.id }) });
  } catch (err) {
    res.status(err?.status || 500).json({ error: err?.message || String(err) });
  }
}

module.exports = {
  listOwnProjects,
  listOwnLeaves,
  createBuchung,
  createSpecialBuchung,
  updateSpecialBuchung,
  patchBuchung,
  deleteBuchung,
  previewRebook,
  rebook,
  listBuchungenByProject,
  createTimerDraft,
  listDraftsByEmployee,
  confirmDrafts,
  deleteDraft,
  patchDraftDescription,
  getWorkstartStatus,
  listMine,
};
