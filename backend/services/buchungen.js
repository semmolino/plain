"use strict";

const arbzg = require("./arbzg");
const budgetWarnings = require("./budgetWarnings");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const fmt2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

// Buchungsarten ohne Stundencharakter (Pauschalen/Stückleistungen).
const SPECIAL_KINDS = new Set(["UNIT", "LUMP_COST", "LUMP_REVENUE"]);

// Kostenbeitrag einer TEC-Zeile zur Struktur: Stunden = Menge × Satz (unverändert,
// auch korrekt bei ArbZG-Pausenabzug); Spezialarten tragen ihren CP_TOT direkt
// (QUANTITY_INT ist dort bewusst 0, damit keine Stundensumme verfälscht wird).
const tecCostContribution = (r) =>
  SPECIAL_KINDS.has(r.BOOKING_KIND)
    ? Number(r.CP_TOT ?? 0)
    : Number(r.QUANTITY_INT ?? 0) * Number(r.CP_RATE ?? 0);

// Looks up the effective CP_RATE for an employee on a specific date.
// Returns the rate from EMPLOYEE_CP_RATE where VALID_FROM <= dateStr (most recent).
// Returns null if no rate exists (caller should treat as 0 and warn).
async function lookupCpRate(supabase, tenantId, employeeId, dateStr) {
  const { data } = await supabase
    .from("EMPLOYEE_CP_RATE")
    .select("CP_RATE")
    .eq("TENANT_ID", tenantId)
    .eq("EMPLOYEE_ID", employeeId)
    .lte("VALID_FROM", dateStr)
    .order("VALID_FROM", { ascending: false })
    .limit(1);
  return data && data.length > 0 ? Number(data[0].CP_RATE) : null;
}

async function loadEmployee2Project(supabase, employeeId, projectId) {
  if (!employeeId || !projectId) return null;
  const { data, error } = await supabase
    .from("EMPLOYEE2PROJECT")
    .select("ROLE_ID, ROLE_NAME_SHORT, ROLE_NAME_LONG, SP_RATE")
    .eq("EMPLOYEE_ID", employeeId)
    .eq("PROJECT_ID", projectId)
    .limit(1);
  if (error) throw new Error(error.message);
  if (!data || !data.length) return null;
  return data[0];
}

async function recomputeStructure(supabase, structureId) {
  if (!structureId) return;

  const { data: tecRows, error: tecErr } = await supabase
    .from("TEC")
    .select("QUANTITY_INT, CP_RATE, CP_TOT, SP_TOT, BOOKING_KIND")
    .eq("STRUCTURE_ID", structureId)
    .neq("STATUS", "DRAFT");
  if (tecErr) throw new Error("Fehler beim Laden der TEC-Daten: " + tecErr.message);

  const newCosts = (tecRows || []).reduce((acc, r) => acc + tecCostContribution(r), 0);
  const revenueSum = (tecRows || []).reduce((acc, r) => acc + Number(r.SP_TOT ?? 0), 0);

  const { data: structureRow, error: strErr } = await supabase
    .from("PROJECT_STRUCTURE")
    .select("ID, BILLING_TYPE_ID, EXTRAS_PERCENT")
    .eq("ID", structureId)
    .single();
  if (strErr) throw new Error("Struktur-Element nicht gefunden: " + strErr.message);

  const structureUpdate = { COSTS: newCosts };
  if (Number(structureRow.BILLING_TYPE_ID) === 2) {
    const extrasPercent = Number(structureRow.EXTRAS_PERCENT ?? 0);
    const extras = (revenueSum * extrasPercent) / 100;
    structureUpdate.REVENUE = revenueSum;
    structureUpdate.EXTRAS = extras;
    structureUpdate.REVENUE_COMPLETION_PERCENT = 100;
    structureUpdate.EXTRAS_COMPLETION_PERCENT = 100;
    structureUpdate.REVENUE_COMPLETION = revenueSum;
    structureUpdate.EXTRAS_COMPLETION = extras;
  }

  const { error: psErr } = await supabase.from("PROJECT_STRUCTURE").update(structureUpdate).eq("ID", structureId);
  if (psErr) throw new Error("Fehler beim Aktualisieren der Projektstruktur: " + psErr.message);
}

// ---------------------------------------------------------------------------
// Service functions
// ---------------------------------------------------------------------------

async function checkMonthNotClosed(supabase, tenantId, employeeId, dateStr) {
  const year  = parseInt(dateStr.slice(0, 4), 10);
  const month = parseInt(dateStr.slice(5, 7), 10);
  const { data } = await supabase
    .from("EMPLOYEE_MONTH_CLOSE")
    .select("ID")
    .eq("TENANT_ID", tenantId)
    .eq("EMPLOYEE_ID", Number(employeeId))
    .eq("YEAR", year)
    .eq("MONTH", month)
    .maybeSingle();
  if (data) {
    throw { status: 409, message: `${month}/${year} ist abgeschlossen. Keine neuen Buchungen möglich.` };
  }
}

async function createTimerDraft(supabase, { body, tenantId }) {
  const b = body;
  const entryKind = b.ENTRY_KIND === 'BREAK' ? 'BREAK' : 'WORK';

  // STRUCTURE/PROJECT-Pflicht entfällt für Pausen-Blöcke
  if (!b.EMPLOYEE_ID || !b.DATE_VOUCHER ||
      (entryKind === 'WORK' && (!b.STRUCTURE_ID || !b.PROJECT_ID))) {
    throw { status: 400, message: "Pflichtfelder fehlen" };
  }

  await checkMonthNotClosed(supabase, tenantId, b.EMPLOYEE_ID, b.DATE_VOUCHER);

  let resolvedTenantId = tenantId ?? null;
  let preset = null;
  if (b.PROJECT_ID) {
    const { data: projRow, error: projErr } = await supabase
      .from("PROJECT")
      .select("TENANT_ID")
      .eq("ID", b.PROJECT_ID)
      .maybeSingle();
    if (projErr) throw { status: 500, message: "Fehler beim Laden des Projekts: " + projErr.message };
    resolvedTenantId = projRow?.TENANT_ID ?? tenantId ?? null;
    preset = await loadEmployee2Project(supabase, Number(b.EMPLOYEE_ID), Number(b.PROJECT_ID));
  }

  const quantityInt = Number(b.QUANTITY_INT ?? 0);
  const quantityExt = quantityInt;

  // Pause-Blöcke werden kostenneutral gebucht.
  let cpRate = 0;
  let spRate = 0;
  if (entryKind === 'WORK') {
    const lookedUpRate = await lookupCpRate(supabase, resolvedTenantId, Number(b.EMPLOYEE_ID), b.DATE_VOUCHER);
    cpRate = lookedUpRate !== null ? lookedUpRate : 0;
    spRate = preset?.SP_RATE != null ? Number(preset.SP_RATE) : 0;
  }

  // ── ArbZG-Vorabprüfung ──────────────────────────────────────────────────
  let arbzgIssues = [];
  try {
    const r = await arbzg.validateBookingArbZG(supabase, {
      tenantId:    resolvedTenantId,
      employeeId:  Number(b.EMPLOYEE_ID),
      dateVoucher: b.DATE_VOUCHER,
      timeStart:   b.TIME_START || null,
      timeFinish:  b.TIME_FINISH || null,
      quantityInt,
      entryKind,
    });
    arbzgIssues = r.issues;
    const blockers = arbzgIssues.filter(i => i.severity === 'BLOCK');
    if (blockers.length > 0) {
      throw { status: 409, message: blockers.map(i => i.message).join(' · '),
              details: { code: 'ARBZG_BLOCK', issues: arbzgIssues } };
    }
  } catch (e) {
    if (e?.details?.code === 'ARBZG_BLOCK') throw e;
    // Andere ArbZG-Fehler nicht block — Buchung darf trotzdem rein
  }

  const { data: inserted, error: insErr } = await supabase.from("TEC").insert([{
    TENANT_ID: resolvedTenantId,
    STATUS: "DRAFT",
    ENTRY_KIND: entryKind,
    EMPLOYEE_ID: b.EMPLOYEE_ID,
    DATE_VOUCHER: b.DATE_VOUCHER,
    TIME_START: b.TIME_START || null,
    TIME_FINISH: b.TIME_FINISH || null,
    QUANTITY_INT: quantityInt,
    CP_RATE: cpRate,
    CP_TOT: quantityInt * cpRate,
    QUANTITY_EXT: quantityExt,
    ROLE_ID: preset?.ROLE_ID ?? null,
    ROLE_NAME_SHORT: preset?.ROLE_NAME_SHORT ?? null,
    ROLE_NAME_LONG: preset?.ROLE_NAME_LONG ?? null,
    SP_RATE: spRate,
    SP_TOT: quantityExt * spRate,
    POSTING_DESCRIPTION: b.POSTING_DESCRIPTION || "",
    PROJECT_ID: b.PROJECT_ID ?? null,
    STRUCTURE_ID: b.STRUCTURE_ID ?? null,
  }]).select("ID").single();

  if (insErr) {
    // Fallback: wenn ENTRY_KIND-Spalte (Migration 0051) noch nicht existiert,
    // retry ohne sie. Pausen sind dann nicht buchbar — aber WORK funktioniert.
    if (/ENTRY_KIND/i.test(insErr.message) && entryKind === 'WORK') {
      const { data: retry, error: retryErr } = await supabase.from("TEC").insert([{
        TENANT_ID: resolvedTenantId, STATUS: "DRAFT", EMPLOYEE_ID: b.EMPLOYEE_ID,
        DATE_VOUCHER: b.DATE_VOUCHER, TIME_START: b.TIME_START || null,
        TIME_FINISH: b.TIME_FINISH || null, QUANTITY_INT: quantityInt,
        CP_RATE: cpRate, CP_TOT: quantityInt * cpRate, QUANTITY_EXT: quantityExt,
        ROLE_ID: preset?.ROLE_ID ?? null, ROLE_NAME_SHORT: preset?.ROLE_NAME_SHORT ?? null,
        ROLE_NAME_LONG: preset?.ROLE_NAME_LONG ?? null, SP_RATE: spRate,
        SP_TOT: quantityExt * spRate, POSTING_DESCRIPTION: b.POSTING_DESCRIPTION || "",
        PROJECT_ID: b.PROJECT_ID ?? null, STRUCTURE_ID: b.STRUCTURE_ID ?? null,
      }]).select("ID").single();
      if (retryErr) throw { status: 500, message: "Fehler beim Speichern des Entwurfs: " + retryErr.message };
      return { ...retry, arbzgIssues };
    }
    throw { status: 500, message: "Fehler beim Speichern des Entwurfs: " + insErr.message };
  }
  return { ...inserted, arbzgIssues };
}

async function listDraftsByEmployee(supabase, { employeeId, date, tenantId }) {
  if (!employeeId || !date) throw { status: 400, message: "employee_id und date sind erforderlich" };

  const { data, error } = await supabase
    .from("TEC")
    .select(`
      ID, PROJECT_ID, STRUCTURE_ID, EMPLOYEE_ID,
      DATE_VOUCHER, TIME_START, TIME_FINISH,
      QUANTITY_INT, CP_RATE, CP_TOT,
      QUANTITY_EXT, SP_RATE, SP_TOT,
      POSTING_DESCRIPTION, STATUS,
      PROJECT:PROJECT_ID(NAME_SHORT),
      STRUCTURE:STRUCTURE_ID(NAME_SHORT, NAME_LONG)
    `)
    .eq("EMPLOYEE_ID", employeeId)
    .eq("DATE_VOUCHER", date)
    .eq("STATUS", "DRAFT")
    .eq("TENANT_ID", tenantId)
    .order("TIME_START", { ascending: true });

  if (error) throw error;
  return data || [];
}

async function confirmDrafts(supabase, { ids, breakConfirmations = {}, tenantId }) {
  if (!Array.isArray(ids) || !ids.length) throw { status: 400, message: "ids fehlen" };

  const { data: rows, error: fetchErr } = await supabase
    .from("TEC")
    .select("ID, TENANT_ID, EMPLOYEE_ID, DATE_VOUCHER, STRUCTURE_ID, STATUS, QUANTITY_INT, ENTRY_KIND")
    .in("ID", ids);
  if (fetchErr) throw fetchErr;

  const drafts = (rows || []).filter(r => r.STATUS === "DRAFT");
  if (!drafts.length) return { confirmed: 0, arbzgEvents: [] };

  const draftIds = drafts.map(r => r.ID);
  const resolvedTenant = drafts[0].TENANT_ID ?? tenantId ?? null;

  // ── ArbZG-Tagesabschluss pro (Mitarbeiter, Datum) ───────────────────────
  const settings = await arbzg.getArbzgSettings(supabase, resolvedTenant);
  const auditEvents = [];

  // Gruppiere Drafts pro (employee, date)
  const groups = new Map();
  for (const r of drafts) {
    const key = `${r.EMPLOYEE_ID}|${r.DATE_VOUCHER}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  }

  for (const [key, groupRows] of groups) {
    const [empIdStr, dateVoucher] = key.split('|');
    const employeeId = Number(empIdStr);

    if (settings.enabled) {
      const model     = await arbzg.getActiveWorkModel(supabase, resolvedTenant, employeeId, dateVoucher);
      const breakRule = await arbzg.getBreakRule(supabase, resolvedTenant,
        model?.BREAK_RULE_ID ?? settings.defaultBreakRuleId);

      // Tagesgesamtsumme nach Bestätigung (inkl. dieser drafts):
      const dayWork  = await arbzg.sumDayWorkHours(supabase, resolvedTenant, employeeId, dateVoucher);
      const dayBreak = await arbzg.sumDayBreakMinutes(supabase, resolvedTenant, employeeId, dateVoucher);

      // § 4 — Pflichtpause / Auto-Abzug
      if (settings.checkBreakRequired) {
        const required = dayWork > Number(breakRule.T2_HOURS) ? Number(breakRule.T2_BREAK_MIN)
                       : dayWork > Number(breakRule.T1_HOURS) ? Number(breakRule.T1_BREAK_MIN)
                       : 0;
        if (required > 0 && dayBreak < required) {
          const missingMin = required - dayBreak;
          const conf = breakConfirmations[key] || breakConfirmations[`${employeeId}|${dateVoucher}`];

          if (settings.autoBreakRequireConfirm && !conf) {
            throw {
              status: 409,
              message: `Pausenbestätigung erforderlich für ${employeeId} / ${dateVoucher}`,
              details: { code: 'ARBZG_BREAK_CONFIRM_REQUIRED',
                         employeeId, dateVoucher, requiredMin: required,
                         currentMin: dayBreak, missingMin },
            };
          }

          if (conf?.kind === 'ACCEPT_AUTO_DEDUCT' || (!conf && settings.autoBreakDeduct)) {
            // Auto-Abzug auf den letzten WORK-Draft des Tages buchen.
            const workDrafts = groupRows.filter(r => (r.ENTRY_KIND ?? 'WORK') === 'WORK');
            const target = workDrafts[workDrafts.length - 1] || groupRows[groupRows.length - 1];
            if (target) {
              const reducedH = Math.max(0, Number(target.QUANTITY_INT || 0) - missingMin / 60);
              const { error: autoErr } = await supabase
                .from("TEC")
                .update({
                  QUANTITY_INT:            reducedH,
                  PAUSE_AUTO_DEDUCTED_MIN: missingMin,
                  CONFIRMED_BY_EMPLOYEE_AT: new Date().toISOString(),
                })
                .eq("ID", target.ID);
              // Spalten-Fallback: falls Migration 0051 noch nicht gelaufen
              if (autoErr && /PAUSE_AUTO_DEDUCTED_MIN|CONFIRMED_BY_EMPLOYEE_AT/i.test(autoErr.message)) {
                await supabase.from("TEC").update({ QUANTITY_INT: reducedH }).eq("ID", target.ID);
              }
              auditEvents.push({
                employeeId, dateVoucher, tecId: target.ID,
                eventType: 'PAUSE_AUTO_DEDUCT', severity: 'WARN',
                details: { deductedMin: missingMin, required, current: dayBreak },
              });
            }
          } else if (conf?.kind === 'BREAK_TAKEN_UNRECORDED') {
            // Mitarbeiter trägt zusätzliche Pause ein.
            const addMin = Number(conf.minutes || missingMin);
            const { error: brErr } = await supabase.from("TEC").insert([{
              TENANT_ID: resolvedTenant, STATUS: "CONFIRMED", ENTRY_KIND: 'BREAK',
              EMPLOYEE_ID: employeeId, DATE_VOUCHER: dateVoucher,
              TIME_START: null, TIME_FINISH: null,
              QUANTITY_INT: Math.round(addMin / 60 * 100) / 100,
              CP_RATE: 0, CP_TOT: 0, QUANTITY_EXT: 0, SP_RATE: 0, SP_TOT: 0,
              POSTING_DESCRIPTION: 'Pause (nachträglich, bestätigt)',
              CONFIRMED_BY_EMPLOYEE_AT: new Date().toISOString(),
            }]);
            if (brErr && !/ENTRY_KIND|CONFIRMED_BY_EMPLOYEE_AT/i.test(brErr.message)) {
              throw { status: 500, message: 'Pausen-Buchung fehlgeschlagen: ' + brErr.message };
            }
            auditEvents.push({
              employeeId, dateVoucher,
              eventType: 'MANUAL_OVERRIDE', severity: 'INFO',
              details: { kind: 'BREAK_TAKEN_UNRECORDED', minutes: addMin },
            });
          }
        }
      }

      // > 8 h Dokumentation (§ 16 Abs. 2)
      if (dayWork > 8) {
        auditEvents.push({
          employeeId, dateVoucher,
          eventType: 'OVER_8H', severity: 'INFO',
          details: { dayWork },
        });
      }
    }
  }

  // Tatsächlich bestätigen (inkl. evtl. reduzierter Stunden)
  const { error: updErr } = await supabase
    .from("TEC")
    .update({ STATUS: "CONFIRMED", CONFIRMED_BY_EMPLOYEE_AT: new Date().toISOString() })
    .in("ID", draftIds);
  if (updErr) {
    // Fallback ohne CONFIRMED_BY_EMPLOYEE_AT
    if (/CONFIRMED_BY_EMPLOYEE_AT/i.test(updErr.message)) {
      const { error: retry } = await supabase
        .from("TEC").update({ STATUS: "CONFIRMED" }).in("ID", draftIds);
      if (retry) throw { status: 500, message: "Fehler beim Freigeben: " + retry.message };
    } else {
      throw { status: 500, message: "Fehler beim Freigeben: " + updErr.message };
    }
  }

  // Audit-Events schreiben (BOOKING_CONFIRMED + alle vorher gesammelten)
  for (const r of drafts) {
    auditEvents.push({
      employeeId: r.EMPLOYEE_ID, dateVoucher: r.DATE_VOUCHER, tecId: r.ID,
      eventType: 'BOOKING_CONFIRMED', severity: 'INFO',
      details: { entryKind: r.ENTRY_KIND ?? 'WORK', quantityInt: Number(r.QUANTITY_INT || 0) },
    });
  }
  await arbzg.writeAuditEvents(supabase, resolvedTenant, auditEvents);

  // Struktur-Recompute
  const affectedStructures = [...new Set(drafts.map(r => r.STRUCTURE_ID).filter(Boolean))];
  for (const sid of affectedStructures) {
    await recomputeStructure(supabase, sid);
  }

  // Budget-Warnungen: pro betroffenes Projekt einmal eval (Ancestor-Kette
  // wird intern ergänzt). Bewusst soft: Fehler darf die Buchung nicht killen.
  try {
    const byProject = new Map();
    for (const r of drafts) {
      if (!r.PROJECT_ID || !r.STRUCTURE_ID) continue;
      const key = String(r.PROJECT_ID);
      if (!byProject.has(key)) byProject.set(key, { sids: new Set(), triggerEmpId: r.EMPLOYEE_ID, triggerTecId: r.ID });
      byProject.get(key).sids.add(Number(r.STRUCTURE_ID));
    }
    for (const [pidStr, info] of byProject) {
      await budgetWarnings.evaluateAfterTecChange(supabase, {
        tenantId: resolvedTenant,
        projectId: Number(pidStr),
        structureIds: info.sids,
        triggerEmployeeId: info.triggerEmpId,
        triggerTecId: info.triggerTecId,
      });
    }
  } catch (e) {
    console.warn(`[BUDGET_WARNING] confirmDrafts eval failed: ${e?.message || e}`);
  }

  return { confirmed: draftIds.length, arbzgEvents: auditEvents };
}

async function deleteDraft(supabase, { id }) {
  const { data: row, error: fetchErr } = await supabase
    .from("TEC")
    .select("ID, STATUS")
    .eq("ID", id)
    .maybeSingle();
  if (fetchErr) throw fetchErr;
  if (!row) throw { status: 404, message: "Eintrag nicht gefunden" };
  if (row.STATUS !== "DRAFT") throw { status: 400, message: "Nur Entwürfe können gelöscht werden" };

  const { error } = await supabase.from("TEC").delete().eq("ID", id);
  if (error) throw error;
}

async function patchDraftDescription(supabase, { id, description, time_start, time_finish, quantity_int }) {
  const { data: row, error: fetchErr } = await supabase
    .from("TEC").select("ID, STATUS").eq("ID", id).maybeSingle();
  if (fetchErr) throw fetchErr;
  if (!row) throw { status: 404, message: "Eintrag nicht gefunden" };
  if (row.STATUS !== "DRAFT") throw { status: 400, message: "Nur Entwürfe können bearbeitet werden" };

  const updates = {};
  if (description  !== undefined) updates.POSTING_DESCRIPTION = description;
  if (time_start   !== undefined) updates.TIME_START           = time_start;
  if (time_finish  !== undefined) updates.TIME_FINISH          = time_finish;
  if (quantity_int !== undefined) updates.QUANTITY_INT         = quantity_int;

  if (!Object.keys(updates).length) return;

  const { error } = await supabase.from("TEC").update(updates).eq("ID", id);
  if (error) throw error;
}

async function createBuchung(supabase, { body, tenantId }) {
  const b = body;

  if (!b.EMPLOYEE_ID || !b.DATE_VOUCHER || b.QUANTITY_INT == null ||
      b.QUANTITY_EXT == null || b.SP_RATE == null || !b.POSTING_DESCRIPTION || !b.PROJECT_ID) {
    throw { status: 400, message: "Pflichtfelder fehlen" };
  }

  await checkMonthNotClosed(supabase, tenantId, b.EMPLOYEE_ID, b.DATE_VOUCHER);

  if (b.STRUCTURE_ID) {
    const { data: childCheck } = await supabase
      .from("PROJECT_STRUCTURE")
      .select("ID")
      .eq("FATHER_ID", b.STRUCTURE_ID)
      .limit(1);
    if (childCheck && childCheck.length > 0) {
      throw { status: 400, message: "Buchungen können nur auf Blatt-Elemente (ohne Unterpositionen) gebucht werden" };
    }
  }

  const { data: projRow, error: projErr } = await supabase
    .from("PROJECT")
    .select("TENANT_ID")
    .eq("ID", b.PROJECT_ID)
    .maybeSingle();
  if (projErr) throw { status: 500, message: "Fehler beim Laden des Projekts: " + projErr.message };
  const resolvedTenantId = projRow?.TENANT_ID ?? null;

  let preset = null;
  try {
    preset = await loadEmployee2Project(supabase, Number(b.EMPLOYEE_ID), Number(b.PROJECT_ID));
  } catch (e) {
    throw { status: 500, message: "Fehler beim Laden EMPLOYEE2PROJECT: " + e.message };
  }

  const effectiveSpRate = preset && preset.SP_RATE != null ? Number(preset.SP_RATE) : Number(b.SP_RATE);
  const roleId = preset ? (preset.ROLE_ID ?? null) : null;
  const roleNameShort = preset ? (preset.ROLE_NAME_SHORT ?? null) : null;
  const roleNameLong = preset ? (preset.ROLE_NAME_LONG ?? null) : null;

  // Look up time-based CP rate; fall back to 0 if none defined yet
  const lookedUpRate = await lookupCpRate(supabase, resolvedTenantId, Number(b.EMPLOYEE_ID), b.DATE_VOUCHER);
  const effectiveCpRate = lookedUpRate !== null ? lookedUpRate : 0;

  // ── ArbZG-Vorabprüfung (nur BLOCK hindert Insert) ──────────────────────
  try {
    const r = await arbzg.validateBookingArbZG(supabase, {
      tenantId:    resolvedTenantId,
      employeeId:  Number(b.EMPLOYEE_ID),
      dateVoucher: b.DATE_VOUCHER,
      timeStart:   b.TIME_START || null,
      timeFinish:  b.TIME_FINISH || null,
      quantityInt: Number(b.QUANTITY_INT || 0),
      entryKind:   'WORK',
    });
    const blockers = r.issues.filter(i => i.severity === 'BLOCK');
    if (blockers.length > 0) {
      throw { status: 409, message: blockers.map(i => i.message).join(' · '),
              details: { code: 'ARBZG_BLOCK', issues: r.issues } };
    }
  } catch (e) {
    if (e?.details?.code === 'ARBZG_BLOCK') throw e;
  }

  const { error: insertError } = await supabase.from("TEC").insert([{
    TENANT_ID: resolvedTenantId,
    EMPLOYEE_ID: b.EMPLOYEE_ID,
    DATE_VOUCHER: b.DATE_VOUCHER,
    TIME_START: b.TIME_START || null,
    TIME_FINISH: b.TIME_FINISH || null,
    QUANTITY_INT: b.QUANTITY_INT,
    CP_RATE: effectiveCpRate,
    CP_TOT: b.QUANTITY_INT * effectiveCpRate,
    QUANTITY_EXT: b.QUANTITY_EXT,
    ROLE_ID: roleId,
    ROLE_NAME_SHORT: roleNameShort,
    ROLE_NAME_LONG: roleNameLong,
    SP_RATE: effectiveSpRate,
    SP_TOT: b.QUANTITY_EXT * effectiveSpRate,
    POSTING_DESCRIPTION: b.POSTING_DESCRIPTION,
    PROJECT_ID: b.PROJECT_ID,
    STRUCTURE_ID: b.STRUCTURE_ID || null,
  }]);

  if (insertError) throw { status: 500, message: "Fehler beim Speichern in TEC: " + insertError.message };

  if (!b.STRUCTURE_ID) return;

  const costAddition = b.QUANTITY_INT * effectiveCpRate;
  const { data: currentProjectElement, error: fetchError } = await supabase
    .from("PROJECT_STRUCTURE")
    .select("COSTS, BILLING_TYPE_ID, EXTRAS_PERCENT")
    .eq("ID", b.STRUCTURE_ID)
    .single();

  if (fetchError) throw { status: 500, message: "Projekt nicht gefunden: " + fetchError.message };

  const newCost = (currentProjectElement.COSTS || 0) + costAddition;
  let updatePayload = { COSTS: newCost };

  if (Number(currentProjectElement.BILLING_TYPE_ID) === 2) {
    const { data: tecRows, error: tecError } = await supabase
      .from("TEC")
      .select("SP_TOT")
      .eq("STRUCTURE_ID", b.STRUCTURE_ID);
    if (tecError) throw { status: 500, message: "Fehler beim Laden der TEC-Summe: " + tecError.message };

    const revenue = (tecRows || []).reduce((sum, r) => sum + (Number(r.SP_TOT) || 0), 0);
    const extrasPercent = Number(currentProjectElement.EXTRAS_PERCENT) || 0;
    const extras = (revenue * extrasPercent) / 100;

    updatePayload = {
      ...updatePayload,
      REVENUE: revenue,
      EXTRAS: extras,
      REVENUE_COMPLETION_PERCENT: 100,
      EXTRAS_COMPLETION_PERCENT: 100,
      REVENUE_COMPLETION: revenue,
      EXTRAS_COMPLETION: extras,
    };
  }

  const { error: updateError } = await supabase.from("PROJECT_STRUCTURE").update(updatePayload).eq("ID", b.STRUCTURE_ID);
  if (updateError) throw { status: 500, message: "Fehler beim Update der Projektstruktur: " + updateError.message };
}

async function patchBuchung(supabase, { id, body, tenantId }) {
  const b = body || {};

  const { data: existing, error: exErr } = await supabase
    .from("TEC")
    .select("ID, STRUCTURE_ID, PROJECT_ID, EMPLOYEE_ID, TENANT_ID, DATE_VOUCHER, QUANTITY_INT, QUANTITY_EXT, CP_RATE, SP_RATE, BOOKING_KIND")
    .eq("ID", id)
    .eq("TENANT_ID", tenantId)
    .single();

  if (exErr || !existing) {
    throw { status: 404, message: "Buchung nicht gefunden: " + (exErr?.message || "") };
  }

  // Pauschalen/Stückleistungen bekommen ihre Sätze NICHT aus Rolle/Mitarbeiter
  // vorbelegt — sie tragen eigene Werte. Preset-Übernahme nur für Stunden.
  const isSpecial = SPECIAL_KINDS.has(existing.BOOKING_KIND);

  const oldStructureId = existing.STRUCTURE_ID ?? null;

  const normFk = (v) => {
    if (v === undefined) return undefined;
    if (v === null) return null;
    const s = String(v).trim();
    if (!s || s === "null" || s === "undefined") return null;
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  };

  const newEmployeeId = normFk(b.EMPLOYEE_ID);
  const newProjectId = normFk(b.PROJECT_ID);
  const newStructureId = normFk(b.STRUCTURE_ID);

  const toNullIfEmpty = (v) => {
    if (v === undefined || v === null) return null;
    const s = String(v).trim();
    return s === "" ? null : s;
  };

  let resolvedTenantId = existing.TENANT_ID ?? null;
  if (!resolvedTenantId) {
    const effectivePid = newProjectId !== undefined ? newProjectId : existing.PROJECT_ID;
    const { data: projRow } = await supabase.from("PROJECT").select("TENANT_ID").eq("ID", effectivePid).maybeSingle();
    resolvedTenantId = projRow?.TENANT_ID ?? null;
  }

  // Echtes PATCH: nur Felder schreiben, die im Body explizit gesetzt sind.
  // Effektivwerte für Berechnung (Total-Spalten) aus den existierenden Werten
  // zusammensetzen, wenn das jeweilige Feld nicht geliefert wurde.
  const updateTec = { TENANT_ID: resolvedTenantId };
  if (b.DATE_VOUCHER       !== undefined) updateTec.DATE_VOUCHER       = b.DATE_VOUCHER || null;
  if (b.TIME_START         !== undefined) updateTec.TIME_START         = toNullIfEmpty(b.TIME_START);
  if (b.TIME_FINISH        !== undefined) updateTec.TIME_FINISH        = toNullIfEmpty(b.TIME_FINISH);
  if (b.POSTING_DESCRIPTION !== undefined) updateTec.POSTING_DESCRIPTION = b.POSTING_DESCRIPTION ?? "";

  const effQty    = b.QUANTITY_INT !== undefined ? Number(b.QUANTITY_INT) : Number(existing.QUANTITY_INT ?? 0);
  const effQtyExt = b.QUANTITY_EXT !== undefined ? Number(b.QUANTITY_EXT) : Number(existing.QUANTITY_EXT ?? 0);
  const effCpRate = b.CP_RATE      !== undefined ? Number(b.CP_RATE)      : Number(existing.CP_RATE ?? 0);
  const effSpRate = b.SP_RATE      !== undefined ? Number(b.SP_RATE)      : Number(existing.SP_RATE ?? 0);

  if (b.QUANTITY_INT !== undefined) updateTec.QUANTITY_INT = effQty;
  if (b.QUANTITY_EXT !== undefined) updateTec.QUANTITY_EXT = effQtyExt;
  if (b.CP_RATE      !== undefined) updateTec.CP_RATE      = effCpRate;
  if (b.SP_RATE      !== undefined) updateTec.SP_RATE      = effSpRate;

  // Total-Spalten neu rechnen, wenn sich Menge oder Satz geändert hat
  const totalsChanged =
    b.QUANTITY_INT !== undefined || b.CP_RATE !== undefined ||
    b.QUANTITY_EXT !== undefined || b.SP_RATE !== undefined;
  if (totalsChanged) {
    updateTec.CP_TOT = Math.round(effQty    * effCpRate * 100) / 100;
    updateTec.SP_TOT = Math.round(effQtyExt * effSpRate * 100) / 100;
  }

  if (newEmployeeId  !== undefined) updateTec.EMPLOYEE_ID  = newEmployeeId;
  if (newProjectId   !== undefined) updateTec.PROJECT_ID   = newProjectId;
  if (newStructureId !== undefined) updateTec.STRUCTURE_ID = newStructureId;

  const effectiveEmployeeId = newEmployeeId !== undefined ? newEmployeeId : existing.EMPLOYEE_ID;
  const effectiveProjectId  = newProjectId  !== undefined ? newProjectId  : existing.PROJECT_ID;

  if (!isSpecial) {
    let preset = null;
    try {
      preset = await loadEmployee2Project(supabase, Number(effectiveEmployeeId), Number(effectiveProjectId));
    } catch (e) {
      throw { status: 500, message: "Fehler beim Laden EMPLOYEE2PROJECT: " + e.message };
    }

    if (preset && preset.SP_RATE != null) {
      updateTec.ROLE_ID = preset.ROLE_ID ?? null;
      updateTec.ROLE_NAME_SHORT = preset.ROLE_NAME_SHORT ?? null;
      updateTec.ROLE_NAME_LONG = preset.ROLE_NAME_LONG ?? null;
      updateTec.SP_RATE = Number(preset.SP_RATE);
      updateTec.SP_TOT = Math.round(effQtyExt * Number(preset.SP_RATE) * 100) / 100;
    }
  }

  const { data: updatedTec, error: updErr } = await supabase
    .from("TEC")
    .update(updateTec)
    .eq("ID", id)
    .select("*")
    .single();
  if (updErr) throw { status: 500, message: "Fehler beim Aktualisieren: " + updErr.message };

  const affected = new Set([
    oldStructureId,
    newStructureId !== undefined ? newStructureId : oldStructureId,
  ].filter(Boolean));

  for (const sid of affected) {
    await recomputeStructure(supabase, sid);
  }

  // Budget-Warnungen: für alte + neue Struktur (Reset bzw. Fire)
  try {
    const effProjectId = updatedTec.PROJECT_ID ?? null;
    if (effProjectId && affected.size > 0) {
      await budgetWarnings.evaluateAfterTecChange(supabase, {
        tenantId: resolvedTenantId,
        projectId: Number(effProjectId),
        structureIds: new Set(Array.from(affected).map(Number)),
        triggerEmployeeId: updatedTec.EMPLOYEE_ID,
        triggerTecId: updatedTec.ID,
      });
    }
  } catch (e) {
    console.warn(`[BUDGET_WARNING] patchBuchung eval failed: ${e?.message || e}`);
  }

  return updatedTec;
}

async function deleteBuchung(supabase, { id }) {
  const { data: existing, error: exErr } = await supabase
    .from("TEC")
    .select("ID, STRUCTURE_ID, PROJECT_ID, EMPLOYEE_ID, TENANT_ID")
    .eq("ID", id)
    .single();

  if (exErr || !existing) {
    throw { status: 404, message: "Buchung nicht gefunden: " + ((exErr && exErr.message) || "") };
  }

  const structureId = existing.STRUCTURE_ID;

  const { error: delErr } = await supabase.from("TEC").delete().eq("ID", id);
  if (delErr) throw { status: 500, message: "Fehler beim Löschen: " + delErr.message };

  if (!structureId) return;

  const { data: tecRows, error: tecErr } = await supabase
    .from("TEC")
    .select("QUANTITY_INT, CP_RATE, CP_TOT, SP_TOT, BOOKING_KIND")
    .eq("STRUCTURE_ID", structureId);
  if (tecErr) throw { status: 500, message: "Fehler beim Laden der TEC-Daten: " + tecErr.message };

  const newCosts = (tecRows || []).reduce((acc, r) => acc + tecCostContribution(r), 0);
  const revenueSum = (tecRows || []).reduce((acc, r) => acc + Number(r.SP_TOT ?? 0), 0);

  const { data: structureRow, error: strErr } = await supabase
    .from("PROJECT_STRUCTURE")
    .select("ID, BILLING_TYPE_ID, EXTRAS_PERCENT")
    .eq("ID", structureId)
    .single();
  if (strErr) throw { status: 500, message: "Struktur-Element nicht gefunden: " + strErr.message };

  const structureUpdate = { COSTS: newCosts };
  if (Number(structureRow.BILLING_TYPE_ID) === 2) {
    const extrasPercent = Number(structureRow.EXTRAS_PERCENT ?? 0);
    const extras = (revenueSum * extrasPercent) / 100;
    structureUpdate.REVENUE = revenueSum;
    structureUpdate.EXTRAS = extras;
    structureUpdate.REVENUE_COMPLETION_PERCENT = 100;
    structureUpdate.EXTRAS_COMPLETION_PERCENT = 100;
    structureUpdate.REVENUE_COMPLETION = revenueSum;
    structureUpdate.EXTRAS_COMPLETION = extras;
  }

  const { error: psErr } = await supabase.from("PROJECT_STRUCTURE").update(structureUpdate).eq("ID", structureId);
  if (psErr) throw { status: 500, message: "Fehler beim Aktualisieren der Projektstruktur: " + psErr.message };

  // Budget-Warnungen: bei Löschen typischerweise Reset (Verbrauch sinkt),
  // aber evaluator entscheidet selbst (Fire/Reset/Nichts).
  try {
    if (existing.PROJECT_ID && existing.TENANT_ID) {
      await budgetWarnings.evaluateAfterTecChange(supabase, {
        tenantId: existing.TENANT_ID,
        projectId: Number(existing.PROJECT_ID),
        structureIds: new Set([Number(structureId)]),
        triggerEmployeeId: existing.EMPLOYEE_ID,
        triggerTecId: null,
      });
    }
  } catch (e) {
    console.warn(`[BUDGET_WARNING] deleteBuchung eval failed: ${e?.message || e}`);
  }
}

// ---------------------------------------------------------------------------
// Sonstige Buchungsarten: Pauschalen & Stückleistungen (nicht stundenbasiert)
//   UNIT          Menge × Stückpreis (SP) bzw. × Stückkosten (CP)
//   LUMP_COST     Pauschalsumme → Kosten (COSTS), z. B. Lieferantenrechnung
//   LUMP_REVENUE  Pauschalsumme → abrechenbarer Erlös
// EMPLOYEE_ID ist hier reines "gebucht von" (kein Stundenträger); die Zeile
// wird in den Stundenauswertungen über BOOKING_KIND herausgefiltert.
// ---------------------------------------------------------------------------

async function createSpecialBuchung(supabase, { body, tenantId, employeeId }) {
  const b = body || {};
  const kind = String(b.BOOKING_KIND || "").trim();
  if (!SPECIAL_KINDS.has(kind)) throw { status: 400, message: "Ungültige Buchungsart." };
  if (!b.PROJECT_ID || !b.DATE_VOUCHER || !b.POSTING_DESCRIPTION) {
    throw { status: 400, message: "Projekt, Datum und Beschreibung sind erforderlich." };
  }

  // Buchungen nur auf Blatt-Elemente (wie bei Stundenbuchungen).
  if (b.STRUCTURE_ID) {
    const { data: childCheck } = await supabase
      .from("PROJECT_STRUCTURE").select("ID").eq("FATHER_ID", b.STRUCTURE_ID).limit(1);
    if (childCheck && childCheck.length > 0) {
      throw { status: 400, message: "Buchungen können nur auf Blatt-Elemente (ohne Unterpositionen) gebucht werden" };
    }
  }

  const { data: projRow, error: projErr } = await supabase
    .from("PROJECT").select("TENANT_ID").eq("ID", b.PROJECT_ID).maybeSingle();
  if (projErr) throw { status: 500, message: "Fehler beim Laden des Projekts: " + projErr.message };
  const resolvedTenantId = projRow?.TENANT_ID ?? tenantId ?? null;

  const num = (v) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  };

  // WICHTIG: QUANTITY_INT bleibt 0 — Spezial-Buchungen sind keine Stunden und
  // dürfen in keiner Stunden-/Reportsumme (HOURS_TOTAL = SUM(QUANTITY_INT))
  // mitgezählt werden. Geld steckt in CP_TOT/SP_TOT (so leiten alle Reports
  // Kosten/Erlös ab); die Struktur-Kostenrechnung nutzt für Spezialarten CP_TOT.
  let qtyInt = 0, cpRate = 0, cpTot = 0, qtyExt = 0, spRate = 0, spTot = 0, unitLabel = null;

  if (kind === "UNIT") {
    const qty = num(b.QUANTITY);
    if (qty <= 0) throw { status: 400, message: "Menge muss größer als 0 sein." };
    cpRate = num(b.CP_RATE);
    spRate = num(b.SP_RATE);
    if (cpRate === 0 && spRate === 0) throw { status: 400, message: "Bitte Stückpreis und/oder Stückkosten angeben." };
    qtyExt = qty;                       // Menge in QUANTITY_EXT (nicht _INT)
    cpTot = fmt2(qty * cpRate);
    spTot = fmt2(qty * spRate);
    unitLabel = (b.UNIT_LABEL || "").trim() || null;
  } else if (kind === "LUMP_COST") {
    const amount = num(b.AMOUNT);
    if (amount === 0) throw { status: 400, message: "Bitte einen Betrag angeben." };
    cpRate = amount; cpTot = fmt2(amount);   // Summe → Kosten (CP_TOT)
  } else if (kind === "LUMP_REVENUE") {
    const amount = num(b.AMOUNT);
    if (amount === 0) throw { status: 400, message: "Bitte einen Betrag angeben." };
    spRate = amount; spTot = fmt2(amount);   // Summe → abrechenbarer Erlös (SP_TOT)
  }

  const insertRow = {
    TENANT_ID:           resolvedTenantId,
    STATUS:              "CONFIRMED",
    BOOKING_KIND:        kind,
    BOOKING_TYPE_ID:     b.BOOKING_TYPE_ID ? Number(b.BOOKING_TYPE_ID) : null,
    UNIT_LABEL:          unitLabel,
    EMPLOYEE_ID:         employeeId ?? (b.EMPLOYEE_ID ?? null),
    DATE_VOUCHER:        b.DATE_VOUCHER,
    QUANTITY_INT:        qtyInt,
    CP_RATE:             cpRate,
    CP_TOT:              cpTot,
    QUANTITY_EXT:        qtyExt,
    SP_RATE:             spRate,
    SP_TOT:              spTot,
    POSTING_DESCRIPTION: b.POSTING_DESCRIPTION,
    PROJECT_ID:          Number(b.PROJECT_ID),
    STRUCTURE_ID:        b.STRUCTURE_ID ? Number(b.STRUCTURE_ID) : null,
  };

  const { data: inserted, error: insErr } = await supabase.from("TEC").insert([insertRow]).select("ID").single();
  if (insErr) throw { status: 500, message: "Fehler beim Speichern der Buchung: " + insErr.message };

  if (insertRow.STRUCTURE_ID) {
    await recomputeStructure(supabase, insertRow.STRUCTURE_ID);
    try {
      await budgetWarnings.evaluateAfterTecChange(supabase, {
        tenantId: resolvedTenantId,
        projectId: Number(b.PROJECT_ID),
        structureIds: new Set([Number(insertRow.STRUCTURE_ID)]),
        triggerEmployeeId: insertRow.EMPLOYEE_ID,
        triggerTecId: inserted?.ID ?? null,
      });
    } catch (e) {
      console.warn(`[BUDGET_WARNING] createSpecialBuchung eval failed: ${e?.message || e}`);
    }
  }

  return inserted;
}

async function listBuchungenByProject(supabase, { projectId, tenantId }) {
  const { data, error } = await supabase
    .from("TEC")
    .select(`
      ID, PROJECT_ID, STRUCTURE_ID, EMPLOYEE_ID,
      DATE_VOUCHER, TIME_START, TIME_FINISH,
      QUANTITY_INT, CP_RATE, CP_TOT,
      QUANTITY_EXT, SP_RATE, SP_TOT,
      POSTING_DESCRIPTION,
      BOOKING_KIND, UNIT_LABEL, BOOKING_TYPE_ID,
      PARTIAL_PAYMENT_ID, INVOICE_ID,
      EMPLOYEE:EMPLOYEE_ID(SHORT_NAME)
    `)
    .eq("TENANT_ID", tenantId)
    .eq("PROJECT_ID", projectId)
    .order("DATE_VOUCHER", { ascending: true });

  if (error) throw error;
  return data;
}

module.exports = {
  createBuchung,
  createSpecialBuchung,
  patchBuchung,
  deleteBuchung,
  listBuchungenByProject,
  createTimerDraft,
  listDraftsByEmployee,
  confirmDrafts,
  deleteDraft,
  patchDraftDescription,
};
