"use strict";

const arbzg = require("./arbzg");
const budgetWarnings = require("./budgetWarnings");
const { assertProjectInTenant, assertStructureInTenant, assertTecInTenant, NOT_FOUND } = require("./tenantGuard");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const fmt2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

// Buchungsarten ohne Stundencharakter (Pauschalen/Stückleistungen).
const SPECIAL_KINDS = new Set(["UNIT", "LUMP_COST", "LUMP_REVENUE"]);

// Kostenbeitrag einer BOOKING-Zeile zur Struktur: Stunden = Menge × Satz (unverändert,
// auch korrekt bei ArbZG-Pausenabzug); Spezialarten tragen ihren COST_TOTAL direkt
// (QUANTITY_INT ist dort bewusst 0, damit keine Stundensumme verfälscht wird).
const tecCostContribution = (r) =>
  SPECIAL_KINDS.has(r.BOOKING_KIND)
    ? Number(r.COST_TOTAL ?? 0)
    : Number(r.QUANTITY_INT ?? 0) * Number(r.COST_RATE ?? 0);

// Looks up the effective COST_RATE for an employee on a specific date.
// Returns the rate from EMPLOYEE_COST_RATE where VALID_FROM <= dateStr (most recent).
// Returns null if no rate exists (caller should treat as 0 and warn).
async function lookupCpRate(supabase, tenantId, employeeId, dateStr) {
  const { data } = await supabase
    .from("EMPLOYEE_COST_RATE")
    .select("COST_RATE")
    .eq("TENANT_ID", tenantId)
    .eq("EMPLOYEE_ID", employeeId)
    .lte("VALID_FROM", dateStr)
    .order("VALID_FROM", { ascending: false })
    .limit(1);
  return data && data.length > 0 ? Number(data[0].COST_RATE) : null;
}

async function loadEmployee2Project(supabase, employeeId, projectId) {
  if (!employeeId || !projectId) return null;
  const { data, error } = await supabase
    .from("EMPLOYEE2PROJECT")
    .select("ROLE_ID, ROLE_ABBR, ROLE_NAME, HOURLY_RATE")
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
    .from("BOOKING")
    .select("QUANTITY_INT, COST_RATE, COST_TOTAL, HOURLY_RATE_TOTAL, BOOKING_KIND")
    .eq("STRUCTURE_ID", structureId)
    .neq("STATUS", "DRAFT");
  if (tecErr) throw new Error("Fehler beim Laden der Buchungen: " + tecErr.message);

  const newCosts = (tecRows || []).reduce((acc, r) => acc + tecCostContribution(r), 0);
  const revenueSum = (tecRows || []).reduce((acc, r) => acc + Number(r.HOURLY_RATE_TOTAL ?? 0), 0);

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

  // Und dann nach oben. Ohne diesen Schritt blieb der gebuchte Wert am Blatt
  // stehen: die Elternzeilen und die Projektebene zeigten weiter den Stand von
  // vor der Buchung. Am deutlichsten bei Nachweis-Positionen, wo der Erloes
  // ueberhaupt erst aus Buchungen entsteht — dort stand oben dauerhaft 0.
  //
  // Angelegt und geaendert wird eine Struktur laengst so (stammdaten-Controller,
  // Nachtraege); nur der Buchungsweg hat es nie getan.
  //
  // Der require steht bewusst hier drin und nicht oben: projekte.js ist gross
  // und zieht seinerseits Dienste nach; ein Verweis auf Modulebene waere eine
  // Ladereihenfolge, auf die sich niemand verlassen sollte.
  const { propagateUpwards } = require("./projekte");
  await propagateUpwards(supabase, { structureId });
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
  if (!b.EMPLOYEE_ID || !b.BOOKING_DATE ||
      (entryKind === 'WORK' && (!b.STRUCTURE_ID || !b.PROJECT_ID))) {
    throw { status: 400, message: "Pflichtfelder fehlen" };
  }

  await checkMonthNotClosed(supabase, tenantId, b.EMPLOYEE_ID, b.BOOKING_DATE);

  // Das Projekt muss dem Mandanten des Aufrufers gehoeren. Frueher wurde die
  // TENANT_ID aus dem MITGESCHICKTEN Projekt abgeleitet — damit liess sich
  // durch Angabe einer fremden PROJECT_ID in den fremden Mandanten
  // hineinschreiben (Pentest 2026-08-06).
  const resolvedTenantId = tenantId ?? null;
  let preset = null;
  if (b.PROJECT_ID) {
    await assertProjectInTenant(supabase, b.PROJECT_ID, tenantId);
    preset = await loadEmployee2Project(supabase, Number(b.EMPLOYEE_ID), Number(b.PROJECT_ID));
  }

  const quantityInt = Number(b.QUANTITY_INT ?? 0);
  const quantityExt = quantityInt;

  // Pause-Blöcke werden kostenneutral gebucht.
  let cpRate = 0;
  let spRate = 0;
  if (entryKind === 'WORK') {
    const lookedUpRate = await lookupCpRate(supabase, resolvedTenantId, Number(b.EMPLOYEE_ID), b.BOOKING_DATE);
    cpRate = lookedUpRate !== null ? lookedUpRate : 0;
    spRate = preset?.HOURLY_RATE != null ? Number(preset.HOURLY_RATE) : 0;
  }

  // ── ArbZG-Vorabprüfung ──────────────────────────────────────────────────
  let arbzgIssues = [];
  try {
    const r = await arbzg.validateBookingArbZG(supabase, {
      tenantId:    resolvedTenantId,
      employeeId:  Number(b.EMPLOYEE_ID),
      dateVoucher: b.BOOKING_DATE,
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

  const { data: inserted, error: insErr } = await supabase.from("BOOKING").insert([{
    TENANT_ID: resolvedTenantId,
    STATUS: "DRAFT",
    ENTRY_KIND: entryKind,
    EMPLOYEE_ID: b.EMPLOYEE_ID,
    BOOKING_DATE: b.BOOKING_DATE,
    TIME_START: b.TIME_START || null,
    TIME_FINISH: b.TIME_FINISH || null,
    QUANTITY_INT: quantityInt,
    COST_RATE: cpRate,
    COST_TOTAL: quantityInt * cpRate,
    QUANTITY_EXT: quantityExt,
    ROLE_ID: preset?.ROLE_ID ?? null,
    ROLE_ABBR: preset?.ROLE_ABBR ?? null,
    ROLE_NAME: preset?.ROLE_NAME ?? null,
    HOURLY_RATE: spRate,
    HOURLY_RATE_TOTAL: quantityExt * spRate,
    POSTING_DESCRIPTION: b.POSTING_DESCRIPTION || "",
    PROJECT_ID: b.PROJECT_ID ?? null,
    STRUCTURE_ID: b.STRUCTURE_ID ?? null,
  }]).select("ID").single();

  if (insErr) {
    // Fallback: wenn ENTRY_KIND-Spalte (Migration 0051) noch nicht existiert,
    // retry ohne sie. Pausen sind dann nicht buchbar — aber WORK funktioniert.
    if (/ENTRY_KIND/i.test(insErr.message) && entryKind === 'WORK') {
      const { data: retry, error: retryErr } = await supabase.from("BOOKING").insert([{
        TENANT_ID: resolvedTenantId, STATUS: "DRAFT", EMPLOYEE_ID: b.EMPLOYEE_ID,
        BOOKING_DATE: b.BOOKING_DATE, TIME_START: b.TIME_START || null,
        TIME_FINISH: b.TIME_FINISH || null, QUANTITY_INT: quantityInt,
        COST_RATE: cpRate, COST_TOTAL: quantityInt * cpRate, QUANTITY_EXT: quantityExt,
        ROLE_ID: preset?.ROLE_ID ?? null, ROLE_ABBR: preset?.ROLE_ABBR ?? null,
        ROLE_NAME: preset?.ROLE_NAME ?? null, HOURLY_RATE: spRate,
        HOURLY_RATE_TOTAL: quantityExt * spRate, POSTING_DESCRIPTION: b.POSTING_DESCRIPTION || "",
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
    .from("BOOKING")
    .select(`
      ID, PROJECT_ID, STRUCTURE_ID, EMPLOYEE_ID,
      BOOKING_DATE, TIME_START, TIME_FINISH,
      QUANTITY_INT, COST_RATE, COST_TOTAL,
      QUANTITY_EXT, HOURLY_RATE, HOURLY_RATE_TOTAL,
      POSTING_DESCRIPTION, STATUS,
      PROJECT:PROJECT_ID(ABBR),
      STRUCTURE:STRUCTURE_ID(ABBR, NAME)
    `)
    .eq("EMPLOYEE_ID", employeeId)
    .eq("BOOKING_DATE", date)
    .eq("STATUS", "DRAFT")
    .eq("TENANT_ID", tenantId)
    .order("TIME_START", { ascending: true });

  if (error) throw error;
  return data || [];
}

async function confirmDrafts(supabase, { ids, breakConfirmations = {}, tenantId }) {
  if (!Array.isArray(ids) || !ids.length) throw { status: 400, message: "ids fehlen" };

  // Nur Entwuerfe des eigenen Mandanten. Frueher wurde allein nach der
  // ID-Liste geladen und der Mandant anschliessend aus dem ERSTEN Treffer
  // abgeleitet — fremde Entwurfs-IDs liessen sich damit bestaetigen und
  // wurden zu abrechnungsrelevanten Buchungen (Pentest 2026-08-06).
  if (tenantId === undefined || tenantId === null || tenantId === "") {
    throw new Error("confirmDrafts: tenantId ist erforderlich");
  }
  const { data: rows, error: fetchErr } = await supabase
    .from("BOOKING")
    .select("ID, TENANT_ID, EMPLOYEE_ID, BOOKING_DATE, STRUCTURE_ID, STATUS, QUANTITY_INT, ENTRY_KIND")
    .in("ID", ids)
    .eq("TENANT_ID", tenantId);
  if (fetchErr) throw fetchErr;

  const drafts = (rows || []).filter(r => r.STATUS === "DRAFT");
  if (!drafts.length) return { confirmed: 0, arbzgEvents: [] };

  const draftIds = drafts.map(r => r.ID);
  const resolvedTenant = tenantId;

  // ── ArbZG-Tagesabschluss pro (Mitarbeiter, Datum) ───────────────────────
  const settings = await arbzg.getArbzgSettings(supabase, resolvedTenant);
  const auditEvents = [];

  // Gruppiere Drafts pro (employee, date)
  const groups = new Map();
  for (const r of drafts) {
    const key = `${r.EMPLOYEE_ID}|${r.BOOKING_DATE}`;
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
                .from("BOOKING")
                .update({
                  QUANTITY_INT:            reducedH,
                  PAUSE_AUTO_DEDUCTED_MIN: missingMin,
                  CONFIRMED_BY_EMPLOYEE_AT: new Date().toISOString(),
                })
                .eq("ID", target.ID);
              // Spalten-Fallback: falls Migration 0051 noch nicht gelaufen
              if (autoErr && /PAUSE_AUTO_DEDUCTED_MIN|CONFIRMED_BY_EMPLOYEE_AT/i.test(autoErr.message)) {
                await supabase.from("BOOKING").update({ QUANTITY_INT: reducedH }).eq("ID", target.ID);
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
            const { error: brErr } = await supabase.from("BOOKING").insert([{
              TENANT_ID: resolvedTenant, STATUS: "CONFIRMED", ENTRY_KIND: 'BREAK',
              EMPLOYEE_ID: employeeId, BOOKING_DATE: dateVoucher,
              TIME_START: null, TIME_FINISH: null,
              QUANTITY_INT: Math.round(addMin / 60 * 100) / 100,
              COST_RATE: 0, COST_TOTAL: 0, QUANTITY_EXT: 0, HOURLY_RATE: 0, HOURLY_RATE_TOTAL: 0,
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
    .from("BOOKING")
    .update({ STATUS: "CONFIRMED", CONFIRMED_BY_EMPLOYEE_AT: new Date().toISOString() })
    .in("ID", draftIds);
  if (updErr) {
    // Fallback ohne CONFIRMED_BY_EMPLOYEE_AT
    if (/CONFIRMED_BY_EMPLOYEE_AT/i.test(updErr.message)) {
      const { error: retry } = await supabase
        .from("BOOKING").update({ STATUS: "CONFIRMED" }).in("ID", draftIds);
      if (retry) throw { status: 500, message: "Fehler beim Freigeben: " + retry.message };
    } else {
      throw { status: 500, message: "Fehler beim Freigeben: " + updErr.message };
    }
  }

  // Audit-Events schreiben (BOOKING_CONFIRMED + alle vorher gesammelten)
  for (const r of drafts) {
    auditEvents.push({
      employeeId: r.EMPLOYEE_ID, dateVoucher: r.BOOKING_DATE, tecId: r.ID,
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

// Mandant UND Besitzer pruefen. Frueher filterte diese Funktion allein nach
// der BOOKING-ID: jede gueltige Sitzung konnte damit Entwuerfe fremder Mandanten
// und fremder Kollegen loeschen (Pentest 2026-08-06).
async function deleteDraft(supabase, { id, tenantId, employeeId }) {
  const { data: row, error: fetchErr } = await supabase
    .from("BOOKING")
    .select("ID, STATUS, EMPLOYEE_ID")
    .eq("ID", id)
    .eq("TENANT_ID", tenantId)
    .maybeSingle();
  if (fetchErr) throw fetchErr;
  if (!row) throw { status: 404, message: "Eintrag nicht gefunden" };
  if (row.STATUS !== "DRAFT") throw { status: 400, message: "Nur Entwürfe können gelöscht werden" };
  if (employeeId != null && String(row.EMPLOYEE_ID) !== String(employeeId)) {
    throw { status: 403, message: "Nur eigene Entwürfe können gelöscht werden" };
  }

  const { error } = await supabase
    .from("BOOKING").delete().eq("ID", id).eq("TENANT_ID", tenantId);
  if (error) throw error;
}

// Mandant UND Besitzer pruefen — siehe deleteDraft.
async function patchDraftDescription(supabase, { id, description, time_start, time_finish, quantity_int, tenantId, employeeId }) {
  const { data: row, error: fetchErr } = await supabase
    .from("BOOKING").select("ID, STATUS, EMPLOYEE_ID").eq("ID", id).eq("TENANT_ID", tenantId).maybeSingle();
  if (fetchErr) throw fetchErr;
  if (!row) throw { status: 404, message: "Eintrag nicht gefunden" };
  if (row.STATUS !== "DRAFT") throw { status: 400, message: "Nur Entwürfe können bearbeitet werden" };
  if (employeeId != null && String(row.EMPLOYEE_ID) !== String(employeeId)) {
    throw { status: 403, message: "Nur eigene Entwürfe können bearbeitet werden" };
  }

  const updates = {};
  if (description  !== undefined) updates.POSTING_DESCRIPTION = description;
  if (time_start   !== undefined) updates.TIME_START           = time_start;
  if (time_finish  !== undefined) updates.TIME_FINISH          = time_finish;
  if (quantity_int !== undefined) updates.QUANTITY_INT         = quantity_int;

  if (!Object.keys(updates).length) return;

  const { error } = await supabase
    .from("BOOKING").update(updates).eq("ID", id).eq("TENANT_ID", tenantId);
  if (error) throw error;
}

// Manuelle Pause-Buchung: kostenneutrale BOOKING-Zeile (ENTRY_KIND='BREAK'), nicht
// projektbezogen im fachlichen Sinn — sie wird aber am aktuellen Projekt gehängt,
// damit sie in der Projekt-Buchungsliste sichtbar/löschbar bleibt (PROJECT_ID
// dient nur als Anzeige-Container, STRUCTURE_ID bleibt leer → keine Kosten).
// Zählt für die ArbZG-Pausenpflicht (§ 4), NICHT als Arbeitszeit im Zeitkonto.
async function createBreakBuchung(supabase, { body, tenantId }) {
  const b = body;
  if (!b.EMPLOYEE_ID || !b.BOOKING_DATE || b.QUANTITY_INT == null) {
    throw { status: 400, message: "Mitarbeiter, Datum und Dauer sind erforderlich." };
  }
  const quantityInt = Number(b.QUANTITY_INT || 0);
  if (!(quantityInt > 0)) throw { status: 400, message: "Die Pausendauer muss größer als 0 sein." };

  await checkMonthNotClosed(supabase, tenantId, b.EMPLOYEE_ID, b.BOOKING_DATE);

  // Das Projekt muss dem Mandanten des Aufrufers gehoeren. Frueher wurde die
  // TENANT_ID aus dem MITGESCHICKTEN Projekt abgeleitet — damit liess sich
  // durch Angabe einer fremden PROJECT_ID in den fremden Mandanten
  // hineinschreiben (Pentest 2026-08-06).
  const resolvedTenantId = tenantId ?? null;
  if (b.PROJECT_ID) {
    await assertProjectInTenant(supabase, b.PROJECT_ID, tenantId);
  }

  const insertRow = {
    TENANT_ID:           resolvedTenantId,
    STATUS:              "CONFIRMED",
    ENTRY_KIND:          "BREAK",
    EMPLOYEE_ID:         b.EMPLOYEE_ID,
    BOOKING_DATE:        b.BOOKING_DATE,
    TIME_START:          b.TIME_START  || null,
    TIME_FINISH:         b.TIME_FINISH || null,
    QUANTITY_INT:        quantityInt,
    COST_RATE: 0, COST_TOTAL: 0, QUANTITY_EXT: 0, HOURLY_RATE: 0, HOURLY_RATE_TOTAL: 0,
    POSTING_DESCRIPTION: b.POSTING_DESCRIPTION || "Pause",
    PROJECT_ID:          b.PROJECT_ID ?? null,
    STRUCTURE_ID:        null,
  };

  const { error: insErr } = await supabase.from("BOOKING").insert([insertRow]);
  if (insErr) {
    if (/ENTRY_KIND/i.test(insErr.message)) {
      throw { status: 400, message: "Pausen-Buchung nicht möglich: Migration 0051 (ENTRY_KIND) fehlt in dieser Umgebung." };
    }
    throw { status: 500, message: "Fehler beim Speichern der Pause: " + insErr.message };
  }
}

async function createBuchung(supabase, { body, tenantId }) {
  const b = body;

  // Pause-Buchung läuft über einen eigenen, kostenneutralen Pfad.
  if (b.ENTRY_KIND === 'BREAK') {
    return createBreakBuchung(supabase, { body: b, tenantId });
  }

  if (!b.EMPLOYEE_ID || !b.BOOKING_DATE || b.QUANTITY_INT == null ||
      b.QUANTITY_EXT == null || b.HOURLY_RATE == null || !b.POSTING_DESCRIPTION || !b.PROJECT_ID) {
    throw { status: 400, message: "Pflichtfelder fehlen" };
  }

  await checkMonthNotClosed(supabase, tenantId, b.EMPLOYEE_ID, b.BOOKING_DATE);

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

  // Das Projekt muss dem Mandanten des Aufrufers gehoeren. Frueher wurde die
  // TENANT_ID aus dem MITGESCHICKTEN Projekt abgeleitet — damit liess sich
  // durch Angabe einer fremden PROJECT_ID in den fremden Mandanten
  // hineinschreiben (Pentest 2026-08-06).
  await assertProjectInTenant(supabase, b.PROJECT_ID, tenantId);
  const resolvedTenantId = tenantId;

  let preset = null;
  try {
    preset = await loadEmployee2Project(supabase, Number(b.EMPLOYEE_ID), Number(b.PROJECT_ID));
  } catch (e) {
    throw { status: 500, message: "Fehler beim Laden EMPLOYEE2PROJECT: " + e.message };
  }

  const effectiveSpRate = preset && preset.HOURLY_RATE != null ? Number(preset.HOURLY_RATE) : Number(b.HOURLY_RATE);
  const roleId = preset ? (preset.ROLE_ID ?? null) : null;
  const roleNameShort = preset ? (preset.ROLE_ABBR ?? null) : null;
  const roleNameLong = preset ? (preset.ROLE_NAME ?? null) : null;

  // Look up time-based CP rate; fall back to 0 if none defined yet
  const lookedUpRate = await lookupCpRate(supabase, resolvedTenantId, Number(b.EMPLOYEE_ID), b.BOOKING_DATE);
  const effectiveCpRate = lookedUpRate !== null ? lookedUpRate : 0;

  // ── ArbZG-Vorabprüfung (nur BLOCK hindert Insert) ──────────────────────
  try {
    const r = await arbzg.validateBookingArbZG(supabase, {
      tenantId:    resolvedTenantId,
      employeeId:  Number(b.EMPLOYEE_ID),
      dateVoucher: b.BOOKING_DATE,
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

  const { error: insertError } = await supabase.from("BOOKING").insert([{
    TENANT_ID: resolvedTenantId,
    EMPLOYEE_ID: b.EMPLOYEE_ID,
    BOOKING_DATE: b.BOOKING_DATE,
    TIME_START: b.TIME_START || null,
    TIME_FINISH: b.TIME_FINISH || null,
    QUANTITY_INT: b.QUANTITY_INT,
    COST_RATE: effectiveCpRate,
    COST_TOTAL: b.QUANTITY_INT * effectiveCpRate,
    QUANTITY_EXT: b.QUANTITY_EXT,
    ROLE_ID: roleId,
    ROLE_ABBR: roleNameShort,
    ROLE_NAME: roleNameLong,
    HOURLY_RATE: effectiveSpRate,
    HOURLY_RATE_TOTAL: b.QUANTITY_EXT * effectiveSpRate,
    POSTING_DESCRIPTION: b.POSTING_DESCRIPTION,
    PROJECT_ID: b.PROJECT_ID,
    STRUCTURE_ID: b.STRUCTURE_ID || null,
  }]);

  if (insertError) throw { status: 500, message: "Fehler beim Speichern in BOOKING: " + insertError.message };

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
      .from("BOOKING")
      .select("HOURLY_RATE_TOTAL")
      .eq("STRUCTURE_ID", b.STRUCTURE_ID);
    if (tecError) throw { status: 500, message: "Fehler beim Laden der BOOKING-Summe: " + tecError.message };

    const revenue = (tecRows || []).reduce((sum, r) => sum + (Number(r.HOURLY_RATE_TOTAL) || 0), 0);
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
    .from("BOOKING")
    .select("ID, STRUCTURE_ID, PROJECT_ID, EMPLOYEE_ID, TENANT_ID, BOOKING_DATE, QUANTITY_INT, QUANTITY_EXT, COST_RATE, HOURLY_RATE, BOOKING_KIND, ENTRY_KIND")
    .eq("ID", id)
    .eq("TENANT_ID", tenantId)
    .single();

  if (exErr || !existing) {
    throw { status: 404, message: "Buchung nicht gefunden: " + (exErr?.message || "") };
  }

  // Pauschalen/Stückleistungen und Pausen bekommen ihre Sätze NICHT aus Rolle/
  // Mitarbeiter vorbelegt — Preset-Übernahme nur für echte Stundenbuchungen.
  // Pausen bleiben kostenneutral (CP/SP = 0).
  const isBreak   = existing.ENTRY_KIND === 'BREAK';
  const isSpecial = SPECIAL_KINDS.has(existing.BOOKING_KIND) || isBreak;

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

  // existing wurde bereits mandantengefiltert geladen. Der fruehere
  // Fallback holte die TENANT_ID notfalls aus dem Projekt — und damit
  // moeglicherweise aus einem fremden Mandanten.
  const resolvedTenantId = existing.TENANT_ID ?? tenantId ?? null;

  // Echtes PATCH: nur Felder schreiben, die im Body explizit gesetzt sind.
  // Effektivwerte für Berechnung (Total-Spalten) aus den existierenden Werten
  // zusammensetzen, wenn das jeweilige Feld nicht geliefert wurde.
  const updateTec = { TENANT_ID: resolvedTenantId };
  if (b.BOOKING_DATE       !== undefined) updateTec.BOOKING_DATE       = b.BOOKING_DATE || null;
  if (b.TIME_START         !== undefined) updateTec.TIME_START         = toNullIfEmpty(b.TIME_START);
  if (b.TIME_FINISH        !== undefined) updateTec.TIME_FINISH        = toNullIfEmpty(b.TIME_FINISH);
  if (b.POSTING_DESCRIPTION !== undefined) updateTec.POSTING_DESCRIPTION = b.POSTING_DESCRIPTION ?? "";

  const effQty    = b.QUANTITY_INT !== undefined ? Number(b.QUANTITY_INT) : Number(existing.QUANTITY_INT ?? 0);
  const effQtyExt = b.QUANTITY_EXT !== undefined ? Number(b.QUANTITY_EXT) : Number(existing.QUANTITY_EXT ?? 0);
  const effCpRate = b.COST_RATE      !== undefined ? Number(b.COST_RATE)      : Number(existing.COST_RATE ?? 0);
  const effSpRate = b.HOURLY_RATE      !== undefined ? Number(b.HOURLY_RATE)      : Number(existing.HOURLY_RATE ?? 0);

  if (b.QUANTITY_INT !== undefined) updateTec.QUANTITY_INT = effQty;
  if (b.QUANTITY_EXT !== undefined) updateTec.QUANTITY_EXT = effQtyExt;
  if (b.COST_RATE      !== undefined) updateTec.COST_RATE      = effCpRate;
  if (b.HOURLY_RATE      !== undefined) updateTec.HOURLY_RATE      = effSpRate;

  // Total-Spalten neu rechnen, wenn sich Menge oder Satz geändert hat
  const totalsChanged =
    b.QUANTITY_INT !== undefined || b.COST_RATE !== undefined ||
    b.QUANTITY_EXT !== undefined || b.HOURLY_RATE !== undefined;
  if (totalsChanged) {
    updateTec.COST_TOTAL = Math.round(effQty    * effCpRate * 100) / 100;
    updateTec.HOURLY_RATE_TOTAL = Math.round(effQtyExt * effSpRate * 100) / 100;
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

    if (preset && preset.HOURLY_RATE != null) {
      updateTec.ROLE_ID = preset.ROLE_ID ?? null;
      updateTec.ROLE_ABBR = preset.ROLE_ABBR ?? null;
      updateTec.ROLE_NAME = preset.ROLE_NAME ?? null;
      updateTec.HOURLY_RATE = Number(preset.HOURLY_RATE);
      updateTec.HOURLY_RATE_TOTAL = Math.round(effQtyExt * Number(preset.HOURLY_RATE) * 100) / 100;
    }
  }

  const { data: updatedTec, error: updErr } = await supabase
    .from("BOOKING")
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

// Mandantengebunden loeschen. Frueher filterte diese Funktion allein nach der
// BOOKING-ID. Der vorgeschaltete dependencyCheck im Controller IST tenant-gescopt
// und fand fremde Zeilen deshalb gar nicht — er meldete "nicht blockiert",
// und anschliessend loeschte diese Funktion die fremde Buchung und schrieb
// COSTS/REVENUE des fremden Strukturknotens neu (Pentest 2026-08-06).
async function deleteBuchung(supabase, { id, tenantId }) {
  const { data: existing, error: exErr } = await supabase
    .from("BOOKING")
    .select("ID, STRUCTURE_ID, PROJECT_ID, EMPLOYEE_ID, TENANT_ID")
    .eq("ID", id)
    .eq("TENANT_ID", tenantId)
    .maybeSingle();

  if (exErr || !existing) {
    throw { status: 404, message: "Buchung nicht gefunden" };
  }

  const structureId = existing.STRUCTURE_ID;

  const { error: delErr } = await supabase
    .from("BOOKING").delete().eq("ID", id).eq("TENANT_ID", tenantId);
  if (delErr) throw { status: 500, message: "Fehler beim Löschen: " + delErr.message };

  if (!structureId) return;

  const { data: tecRows, error: tecErr } = await supabase
    .from("BOOKING")
    .select("QUANTITY_INT, COST_RATE, COST_TOTAL, HOURLY_RATE_TOTAL, BOOKING_KIND")
    .eq("STRUCTURE_ID", structureId);
  if (tecErr) throw { status: 500, message: "Fehler beim Laden der BOOKING-Daten: " + tecErr.message };

  const newCosts = (tecRows || []).reduce((acc, r) => acc + tecCostContribution(r), 0);
  const revenueSum = (tecRows || []).reduce((acc, r) => acc + Number(r.HOURLY_RATE_TOTAL ?? 0), 0);

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

// Berechnet die BOOKING-Felder einer Spezial-Buchung aus dem Request-Body.
// WICHTIG: QUANTITY_INT bleibt 0 — Spezial-Buchungen sind keine Stunden und
// dürfen in keiner Stunden-/Reportsumme (HOURS_TOTAL = SUM(QUANTITY_INT))
// mitgezählt werden. Geld steckt in COST_TOTAL/HOURLY_RATE_TOTAL (so leiten alle Reports
// Kosten/Erlös ab); die Struktur-Kostenrechnung nutzt für Spezialarten COST_TOTAL.
function computeSpecialEncoding(kind, b) {
  const num = (v) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  };
  let qtyInt = 0, cpRate = 0, cpTot = 0, qtyExt = 0, spRate = 0, spTot = 0, unitLabel = null;

  if (kind === "UNIT") {
    const qty = num(b.QUANTITY);
    if (qty <= 0) throw { status: 400, message: "Menge muss größer als 0 sein." };
    cpRate = num(b.COST_RATE);
    spRate = num(b.HOURLY_RATE);
    if (cpRate === 0 && spRate === 0) throw { status: 400, message: "Bitte Stückpreis und/oder Stückkosten angeben." };
    qtyExt = qty;                       // Menge in QUANTITY_EXT (nicht _INT)
    cpTot = fmt2(qty * cpRate);
    spTot = fmt2(qty * spRate);
    unitLabel = (b.UNIT_LABEL || "").trim() || null;
  } else if (kind === "LUMP_COST") {
    const amount = num(b.AMOUNT);
    if (amount === 0) throw { status: 400, message: "Bitte einen Betrag angeben." };
    cpRate = amount; cpTot = fmt2(amount);   // Summe → Kosten (COST_TOTAL)
  } else if (kind === "LUMP_REVENUE") {
    const amount = num(b.AMOUNT);
    if (amount === 0) throw { status: 400, message: "Bitte einen Betrag angeben." };
    // QUANTITY_EXT=1 hält die Invariante HOURLY_RATE_TOTAL = QUANTITY_EXT × HOURLY_RATE
    // (QUANTITY_INT bleibt 0 → keine Stunden); so greifen auch Abrechnungs-
    // Pfade, die Menge × Satz nutzen.
    qtyExt = 1; spRate = amount; spTot = fmt2(amount);
  }
  return { qtyInt, qtyExt, cpRate, cpTot, spRate, spTot, unitLabel };
}

// Abrechenbare Spezialarten (Erlösseite) müssen auf einem Projektelement liegen,
// sonst sind sie nirgends abrechenbar (Abrechnung läuft pro Strukturelement).
const BILLABLE_SPECIAL_KINDS = new Set(["UNIT", "LUMP_REVENUE"]);

async function assertLeafStructure(supabase, structureId) {
  if (!structureId) return;
  const { data: childCheck } = await supabase
    .from("PROJECT_STRUCTURE").select("ID").eq("FATHER_ID", structureId).limit(1);
  if (childCheck && childCheck.length > 0) {
    throw { status: 400, message: "Buchungen können nur auf Blatt-Elemente (ohne Unterpositionen) gebucht werden" };
  }
}

async function createSpecialBuchung(supabase, { body, tenantId, employeeId }) {
  const b = body || {};
  const kind = String(b.BOOKING_KIND || "").trim();
  if (!SPECIAL_KINDS.has(kind)) throw { status: 400, message: "Ungültige Buchungsart." };
  if (!b.PROJECT_ID || !b.BOOKING_DATE || !b.POSTING_DESCRIPTION) {
    throw { status: 400, message: "Projekt, Datum und Beschreibung sind erforderlich." };
  }
  if (BILLABLE_SPECIAL_KINDS.has(kind) && !b.STRUCTURE_ID) {
    throw { status: 400, message: "Für abrechenbare Buchungen (Erlös-Pauschale/Stückleistung) ist ein Projektelement erforderlich." };
  }

  await assertLeafStructure(supabase, b.STRUCTURE_ID);

  // Das Projekt muss dem Mandanten des Aufrufers gehoeren. Frueher wurde die
  // TENANT_ID aus dem MITGESCHICKTEN Projekt abgeleitet — damit liess sich
  // durch Angabe einer fremden PROJECT_ID in den fremden Mandanten
  // hineinschreiben (Pentest 2026-08-06).
  await assertProjectInTenant(supabase, b.PROJECT_ID, tenantId);
  const resolvedTenantId = tenantId ?? null;

  const { qtyInt, qtyExt, cpRate, cpTot, spRate, spTot, unitLabel } = computeSpecialEncoding(kind, b);

  const insertRow = {
    TENANT_ID:           resolvedTenantId,
    STATUS:              "CONFIRMED",
    BOOKING_KIND:        kind,
    BOOKING_TYPE_ID:     b.BOOKING_TYPE_ID ? Number(b.BOOKING_TYPE_ID) : null,
    UNIT_LABEL:          unitLabel,
    EMPLOYEE_ID:         employeeId ?? (b.EMPLOYEE_ID ?? null),
    BOOKING_DATE:        b.BOOKING_DATE,
    QUANTITY_INT:        qtyInt,
    COST_RATE:             cpRate,
    COST_TOTAL:              cpTot,
    QUANTITY_EXT:        qtyExt,
    HOURLY_RATE:             spRate,
    HOURLY_RATE_TOTAL:              spTot,
    POSTING_DESCRIPTION: b.POSTING_DESCRIPTION,
    PROJECT_ID:          Number(b.PROJECT_ID),
    STRUCTURE_ID:        b.STRUCTURE_ID ? Number(b.STRUCTURE_ID) : null,
  };

  const { data: inserted, error: insErr } = await supabase.from("BOOKING").insert([insertRow]).select("ID").single();
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

async function updateSpecialBuchung(supabase, { id, body, tenantId }) {
  const b = body || {};
  const { data: existing, error: exErr } = await supabase
    .from("BOOKING")
    .select("ID, STRUCTURE_ID, PROJECT_ID, TENANT_ID, BOOKING_KIND, ADVANCE_INVOICE_ID, INVOICE_ID")
    .eq("ID", id)
    .eq("TENANT_ID", tenantId)
    .single();
  if (exErr || !existing) throw { status: 404, message: "Buchung nicht gefunden." };
  if (!SPECIAL_KINDS.has(existing.BOOKING_KIND)) {
    throw { status: 400, message: "Diese Buchung ist keine Pauschale/Stückleistung." };
  }
  if (existing.ADVANCE_INVOICE_ID != null || existing.INVOICE_ID != null) {
    throw { status: 409, message: "Bereits abgerechnete Buchungen können nicht bearbeitet werden." };
  }

  const kind = existing.BOOKING_KIND; // Art wird beim Bearbeiten nicht gewechselt
  if (!b.BOOKING_DATE || !b.POSTING_DESCRIPTION) {
    throw { status: 400, message: "Datum und Beschreibung sind erforderlich." };
  }
  if (BILLABLE_SPECIAL_KINDS.has(kind) && !b.STRUCTURE_ID) {
    throw { status: 400, message: "Für abrechenbare Buchungen (Erlös-Pauschale/Stückleistung) ist ein Projektelement erforderlich." };
  }

  const newStructureId = b.STRUCTURE_ID ? Number(b.STRUCTURE_ID) : null;
  await assertLeafStructure(supabase, newStructureId);

  const { qtyExt, cpRate, cpTot, spRate, spTot, unitLabel } = computeSpecialEncoding(kind, b);

  const updateRow = {
    BOOKING_TYPE_ID:     b.BOOKING_TYPE_ID ? Number(b.BOOKING_TYPE_ID) : null,
    UNIT_LABEL:          unitLabel,
    BOOKING_DATE:        b.BOOKING_DATE,
    QUANTITY_INT:        0,
    COST_RATE:             cpRate,
    COST_TOTAL:              cpTot,
    QUANTITY_EXT:        qtyExt,
    HOURLY_RATE:             spRate,
    HOURLY_RATE_TOTAL:              spTot,
    POSTING_DESCRIPTION: b.POSTING_DESCRIPTION,
    STRUCTURE_ID:        newStructureId,
  };

  const { error: updErr } = await supabase.from("BOOKING").update(updateRow).eq("ID", id).eq("TENANT_ID", tenantId);
  if (updErr) throw { status: 500, message: "Fehler beim Aktualisieren: " + updErr.message };

  const affected = new Set([existing.STRUCTURE_ID, newStructureId].filter((v) => v != null).map(Number));
  for (const sid of affected) await recomputeStructure(supabase, sid);

  try {
    if (existing.PROJECT_ID && affected.size > 0) {
      await budgetWarnings.evaluateAfterTecChange(supabase, {
        tenantId: existing.TENANT_ID ?? tenantId,
        projectId: Number(existing.PROJECT_ID),
        structureIds: affected,
        triggerEmployeeId: null,
        triggerTecId: Number(id),
      });
    }
  } catch (e) {
    console.warn(`[BUDGET_WARNING] updateSpecialBuchung eval failed: ${e?.message || e}`);
  }

  return { id: Number(id) };
}

async function listBuchungenByProject(supabase, { projectId, tenantId }) {
  const { data, error } = await supabase
    .from("BOOKING")
    .select(`
      ID, PROJECT_ID, STRUCTURE_ID, EMPLOYEE_ID,
      BOOKING_DATE, TIME_START, TIME_FINISH,
      QUANTITY_INT, COST_RATE, COST_TOTAL,
      QUANTITY_EXT, HOURLY_RATE, HOURLY_RATE_TOTAL,
      POSTING_DESCRIPTION,
      BOOKING_KIND, ENTRY_KIND, UNIT_LABEL, BOOKING_TYPE_ID,
      ADVANCE_INVOICE_ID, INVOICE_ID,
      EMPLOYEE:EMPLOYEE_ID(ABBR)
    `)
    .eq("TENANT_ID", tenantId)
    .eq("PROJECT_ID", projectId)
    .order("BOOKING_DATE", { ascending: true });

  if (error) throw error;
  return data;
}

// ---------------------------------------------------------------------------
// Umbuchen — Buchungen auf ein anderes Projektelement / Projekt verschieben
// ---------------------------------------------------------------------------
//
// Warum ein eigener Weg und nicht patchBuchung je Zeile:
//
//   * Es ist eine Korrektur, keine Bearbeitung. Sie darf NUR das Ziel und die
//     daraus folgenden Saetze anfassen — Menge, Datum, Person und Beschreibung
//     bleiben, wie gebucht wurde. patchBuchung schreibt alles, was im Body steht.
//   * Abgerechnete Buchungen muessen gesperrt sein. patchBuchung prueft
//     INVOICE_ID/ADVANCE_INVOICE_ID bewusst nicht — sonst liesse sich ein
//     Tippfehler in der Beschreibung nach dem Rechnungslauf nicht mehr
//     geradeziehen. Beim Umbuchen ist die Sperre dagegen der Kern der Sache:
//     eine gestellte Rechnung darf ihre Grundlage nicht verlieren.
//   * Eine Auswahl von 200 Zeilen soll EIN Vorgang sein — eine Vorschau, eine
//     Bestaetigung, je Zeile ein Protokolleintrag, und die Summen der
//     betroffenen Strukturknoten am Ende genau einmal neu gerechnet.
//
// Nicht geprueft wird der Monatsabschluss (EMPLOYEE_MONTH_CLOSE): er friert die
// Zeiterfassung eines Mitarbeiters ein, und Datum, Person und Menge bleiben
// hier unberuehrt — die Stundensumme des abgeschlossenen Monats also auch.

/** Ein Beleg macht die Buchung unantastbar. `0` gilt wie NULL als „kein Beleg" —
 *  so lesen es auch die Rechnungswege (isNullOrZero in services/invoices.js);
 *  Altbestand traegt dort teils 0 statt NULL. */
const belegLos = (v) => v === null || v === undefined || String(v) === "0";
const istAbgerechnet = (r) => !belegLos(r.INVOICE_ID) || !belegLos(r.ADVANCE_INVOICE_ID);

// Deckel gegen einen Aufruf, der die halbe Tabelle in einem Rutsch verschiebt:
// jede Zeile zieht eine Protokollzeile und die Neuberechnung ihrer Struktur nach.
const REBOOK_MAX = 500;

const REBOOK_SKIP_REASON = {
  not_found: "Buchung nicht gefunden",
  billed:    "bereits abgerechnet",
  draft:     "Entwurf der Stempeluhr — erst bestätigen",
  break:     "Pause — liegt auf keinem Projektelement",
  unchanged: "liegt bereits auf dem Ziel",
};

/** Prueft das Ziel und liefert es samt Klartextnamen fuer Meldung und Protokoll. */
async function loadRebookTarget(supabase, { targetProjectId, targetStructureId, tenantId }) {
  const projectId   = await assertProjectInTenant(supabase, targetProjectId, tenantId);
  const structureId = parseInt(String(targetStructureId), 10);
  if (!Number.isFinite(structureId)) throw NOT_FOUND();

  // Diese Abfrage IST die Besitzpruefung des Elements (Filter auf TENANT_ID,
  // fehlende Zeile -> 404, nicht unterscheidbar von „fremd"); sie holt die
  // Namen fuer Meldung und Protokoll gleich mit, statt assertStructureInTenant
  // dieselbe Zeile ein zweites Mal lesen zu lassen.
  const { data: node, error: nodeErr } = await supabase
    .from("PROJECT_STRUCTURE")
    .select("ID, PROJECT_ID, ABBR, NAME")
    .eq("ID", structureId)
    .eq("TENANT_ID", tenantId)
    .maybeSingle();
  if (nodeErr) throw { status: 500, message: "Ziel-Projektelement nicht lesbar: " + nodeErr.message };
  if (!node) throw NOT_FOUND();
  if (Number(node.PROJECT_ID) !== Number(projectId)) {
    throw { status: 400, message: "Das Ziel-Projektelement gehört nicht zum Zielprojekt." };
  }

  // Gleiche Regel wie beim Anlegen: gebucht wird auf Blaetter. Ein Knoten mit
  // Unterpositionen summiert seine Kinder — eine Buchung darauf zaehlte doppelt.
  const { data: kinder, error: kinderErr } = await supabase
    .from("PROJECT_STRUCTURE")
    .select("ID")
    .eq("FATHER_ID", structureId)
    .eq("TENANT_ID", tenantId)
    .limit(1);
  if (kinderErr) throw { status: 500, message: "Ziel-Projektelement nicht lesbar: " + kinderErr.message };
  if (kinder && kinder.length > 0) {
    throw { status: 400, message: "Umbuchen ist nur auf Blatt-Elemente (ohne Unterpositionen) möglich." };
  }

  const { data: projekt } = await supabase
    .from("PROJECT")
    .select("ID, ABBR, NAME")
    .eq("ID", projectId)
    .eq("TENANT_ID", tenantId)
    .maybeSingle();

  return {
    projectId,
    structureId,
    projectName:   projekt?.ABBR || `#${projectId}`,
    structureName: node.NAME ? `${node.ABBR}: ${node.NAME}` : (node.ABBR || `#${structureId}`),
  };
}

/**
 * Umbuchen — mit `dryRun: true` als Vorschau (schreibt nichts).
 *
 * Die Vorschau laeuft durch DENSELBEN Code wie die Ausfuehrung; nur der
 * Schreibteil am Ende faellt weg. Eine zweite, „ungefaehrliche" Kopie der
 * Pruefungen waere genau die Stelle, an der Vorschau und Ergebnis
 * auseinanderlaufen — und die Vorschau ist hier die Entscheidungsgrundlage
 * des Nutzers.
 *
 * @returns {Promise<{target, moved:Array, skipped:Array, warnings:Array, movedCount:number}>}
 */
async function rebookBuchungen(supabase, {
  ids, targetProjectId, targetStructureId, reason = "", dryRun = false, tenantId, employeeId = null,
}) {
  if (tenantId === undefined || tenantId === null || tenantId === "") {
    throw new Error("rebookBuchungen: tenantId ist erforderlich");
  }
  const idList = [...new Set((Array.isArray(ids) ? ids : []).map(v => parseInt(String(v), 10)).filter(Number.isFinite))];
  if (!idList.length) throw { status: 400, message: "Keine Buchungen ausgewählt." };
  if (idList.length > REBOOK_MAX) {
    throw { status: 400, message: `Es lassen sich höchstens ${REBOOK_MAX} Buchungen auf einmal umbuchen (ausgewählt: ${idList.length}).` };
  }
  if (!targetProjectId || !targetStructureId) {
    throw { status: 400, message: "Zielprojekt und Ziel-Projektelement sind erforderlich." };
  }

  const target = await loadRebookTarget(supabase, { targetProjectId, targetStructureId, tenantId });

  const { data: rows, error: rowsErr } = await supabase
    .from("BOOKING")
    .select(`
      ID, TENANT_ID, PROJECT_ID, STRUCTURE_ID, EMPLOYEE_ID, BOOKING_DATE,
      QUANTITY_INT, QUANTITY_EXT, COST_RATE, COST_TOTAL, HOURLY_RATE, HOURLY_RATE_TOTAL,
      POSTING_DESCRIPTION, STATUS, BOOKING_KIND, ENTRY_KIND,
      INVOICE_ID, ADVANCE_INVOICE_ID
    `)
    .in("ID", idList)
    .eq("TENANT_ID", tenantId);
  if (rowsErr) throw { status: 500, message: "Buchungen nicht lesbar: " + rowsErr.message };

  const byId = new Map((rows || []).map(r => [Number(r.ID), r]));

  // Klartext fuer die Herkunft — Projekt- und Elementnamen einmal fuer alle
  // beteiligten IDs, nicht je Zeile.
  const quellProjektIds   = [...new Set((rows || []).map(r => r.PROJECT_ID).filter(v => v != null).map(Number))];
  const quellStrukturIds  = [...new Set((rows || []).map(r => r.STRUCTURE_ID).filter(v => v != null).map(Number))];
  const [projektNamen, strukturNamen] = await Promise.all([
    (async () => {
      if (!quellProjektIds.length) return new Map();
      const { data } = await supabase.from("PROJECT").select("ID, ABBR").in("ID", quellProjektIds).eq("TENANT_ID", tenantId);
      return new Map((data || []).map(p => [Number(p.ID), p.ABBR || `#${p.ID}`]));
    })(),
    (async () => {
      if (!quellStrukturIds.length) return new Map();
      const { data } = await supabase.from("PROJECT_STRUCTURE").select("ID, ABBR, NAME").in("ID", quellStrukturIds).eq("TENANT_ID", tenantId);
      return new Map((data || []).map(s => [Number(s.ID), s.NAME ? `${s.ABBR}: ${s.NAME}` : (s.ABBR || `#${s.ID}`)]));
    })(),
  ]);

  // Belegnummern der gesperrten Zeilen — „bereits abgerechnet" ohne Nummer
  // laesst den Nutzer suchen.
  const invoiceIds = [...new Set((rows || []).filter(r => !belegLos(r.INVOICE_ID)).map(r => Number(r.INVOICE_ID)))];
  const partialIds = [...new Set((rows || []).filter(r => !belegLos(r.ADVANCE_INVOICE_ID)).map(r => Number(r.ADVANCE_INVOICE_ID)))];
  const [invoiceNr, partialNr] = await Promise.all([
    (async () => {
      if (!invoiceIds.length) return new Map();
      const { data } = await supabase.from("INVOICE").select("ID, INVOICE_NUMBER").in("ID", invoiceIds).eq("TENANT_ID", tenantId);
      return new Map((data || []).map(i => [Number(i.ID), i.INVOICE_NUMBER || `#${i.ID}`]));
    })(),
    (async () => {
      if (!partialIds.length) return new Map();
      const { data } = await supabase.from("ADVANCE_INVOICE").select("ID, ADVANCE_INVOICE_NUMBER").in("ID", partialIds).eq("TENANT_ID", tenantId);
      return new Map((data || []).map(p => [Number(p.ID), p.ADVANCE_INVOICE_NUMBER || `#${p.ID}`]));
    })(),
  ]);

  const skipped = [];
  const kandidaten = [];

  for (const id of idList) {
    const r = byId.get(id);
    // Nicht gefunden heisst hier auch „fremder Mandant" — die Abfrage oben ist
    // mandantengefiltert. Bewusst nicht unterscheidbar (siehe tenantGuard).
    if (!r) { skipped.push({ ID: id, reason: "not_found", message: REBOOK_SKIP_REASON.not_found }); continue; }

    const beschreibung = {
      ID:           Number(r.ID),
      BOOKING_DATE: r.BOOKING_DATE,
      QUANTITY_INT: Number(r.QUANTITY_INT ?? 0),
      POSTING_DESCRIPTION: r.POSTING_DESCRIPTION || "",
      FROM_PROJECT_ID:     r.PROJECT_ID != null ? Number(r.PROJECT_ID) : null,
      FROM_PROJECT_NAME:   r.PROJECT_ID != null ? (projektNamen.get(Number(r.PROJECT_ID)) || null) : null,
      FROM_STRUCTURE_ID:   r.STRUCTURE_ID != null ? Number(r.STRUCTURE_ID) : null,
      FROM_STRUCTURE_NAME: r.STRUCTURE_ID != null ? (strukturNamen.get(Number(r.STRUCTURE_ID)) || null) : null,
    };

    if (istAbgerechnet(r)) {
      const belege = [
        !belegLos(r.INVOICE_ID)         ? `Rechnung ${invoiceNr.get(Number(r.INVOICE_ID)) || `#${r.INVOICE_ID}`}` : null,
        !belegLos(r.ADVANCE_INVOICE_ID) ? `Abschlag ${partialNr.get(Number(r.ADVANCE_INVOICE_ID)) || `#${r.ADVANCE_INVOICE_ID}`}` : null,
      ].filter(Boolean).join(" · ");
      skipped.push({ ...beschreibung, reason: "billed", message: `${REBOOK_SKIP_REASON.billed} (${belege})` });
      continue;
    }
    if (r.STATUS === "DRAFT") {
      skipped.push({ ...beschreibung, reason: "draft", message: REBOOK_SKIP_REASON.draft });
      continue;
    }
    if (r.ENTRY_KIND === "BREAK") {
      skipped.push({ ...beschreibung, reason: "break", message: REBOOK_SKIP_REASON.break });
      continue;
    }
    if (Number(r.PROJECT_ID) === target.projectId && Number(r.STRUCTURE_ID) === target.structureId) {
      skipped.push({ ...beschreibung, reason: "unchanged", message: REBOOK_SKIP_REASON.unchanged });
      continue;
    }
    kandidaten.push({ row: r, beschreibung });
  }

  // ── Saetze des Zielprojekts ───────────────────────────────────────────────
  // Der Stundensatz haengt an der Mitarbeiter/Projekt-Zuordnung, nicht an der
  // Buchung: nach dem Umbuchen gilt der Satz des Zielprojekts, sonst rechnet
  // das Ziel mit einem Preis, der dort nie vereinbart wurde. Fehlt die
  // Zuordnung, bleibt der alte Satz stehen und die Antwort sagt das — eine
  // stillschweigende 0 waere ein verschwundener Erloes.
  // Der Kostensatz (COST_RATE) bleibt in jedem Fall: er kommt aus
  // EMPLOYEE_COST_RATE und ist projektunabhaengig.
  const presetCache = new Map();
  const zielPreset = async (mitarbeiterId) => {
    const key = Number(mitarbeiterId);
    if (!presetCache.has(key)) {
      presetCache.set(key, await loadEmployee2Project(supabase, key, target.projectId));
    }
    return presetCache.get(key);
  };

  const moved    = [];
  const warnings = [];

  for (const { row: r, beschreibung } of kandidaten) {
    // Pauschalen/Stueckleistungen tragen einen frei erfassten Preis, keinen
    // Stundensatz aus der Zuordnung — der bleibt unberuehrt.
    const istSpezial = SPECIAL_KINDS.has(r.BOOKING_KIND);
    const update = { PROJECT_ID: target.projectId, STRUCTURE_ID: target.structureId };

    let spRateAfter = Number(r.HOURLY_RATE ?? 0);
    let spTotAfter  = Number(r.HOURLY_RATE_TOTAL ?? 0);
    let rateNote    = null;

    if (!istSpezial) {
      const preset = await zielPreset(r.EMPLOYEE_ID);
      if (preset && preset.HOURLY_RATE != null) {
        spRateAfter = Number(preset.HOURLY_RATE);
        spTotAfter  = fmt2(Number(r.QUANTITY_EXT ?? 0) * spRateAfter);
        update.HOURLY_RATE         = spRateAfter;
        update.HOURLY_RATE_TOTAL          = spTotAfter;
        update.ROLE_ID         = preset.ROLE_ID ?? null;
        update.ROLE_ABBR = preset.ROLE_ABBR ?? null;
        update.ROLE_NAME  = preset.ROLE_NAME ?? null;
        if (fmt2(Number(r.HOURLY_RATE ?? 0)) !== fmt2(spRateAfter)) rateNote = "rate_changed";
      } else {
        rateNote = "no_assignment";
      }
    }

    moved.push({
      ...beschreibung,
      HOURLY_RATE_BEFORE: fmt2(Number(r.HOURLY_RATE ?? 0)),
      HOURLY_RATE_AFTER:  fmt2(spRateAfter),
      HOURLY_RATE_TOTAL_BEFORE:  fmt2(Number(r.HOURLY_RATE_TOTAL ?? 0)),
      HOURLY_RATE_TOTAL_AFTER:   fmt2(spTotAfter),
      RATE_NOTE:      rateNote,
      _update:        update,
      _row:           r,
    });
  }

  const rateChanged  = moved.filter(m => m.RATE_NOTE === "rate_changed");
  const noAssignment = moved.filter(m => m.RATE_NOTE === "no_assignment");
  if (rateChanged.length) {
    warnings.push({
      code: "rate_changed",
      count: rateChanged.length,
      message: `${rateChanged.length} ${rateChanged.length === 1 ? "Buchung erhält" : "Buchungen erhalten"} den Stundensatz des Zielprojekts — der abrechenbare Erlös ändert sich dadurch.`,
    });
  }
  if (noAssignment.length) {
    warnings.push({
      code: "no_assignment",
      count: noAssignment.length,
      message: `${noAssignment.length} ${noAssignment.length === 1 ? "Buchung betrifft einen Mitarbeiter" : "Buchungen betreffen Mitarbeiter"} ohne Stundensatz im Zielprojekt — dort bleibt der bisherige Satz stehen.`,
    });
  }
  const billed = skipped.filter(s => s.reason === "billed");
  if (billed.length) {
    warnings.push({
      code: "billed",
      count: billed.length,
      message: `${billed.length} ${billed.length === 1 ? "Buchung ist" : "Buchungen sind"} bereits abgerechnet und ${billed.length === 1 ? "bleibt" : "bleiben"} unverändert.`,
    });
  }

  const antwort = {
    target: {
      PROJECT_ID:     target.projectId,
      PROJECT_NAME:   target.projectName,
      STRUCTURE_ID:   target.structureId,
      STRUCTURE_NAME: target.structureName,
    },
    moved:      moved.map(({ _update, _row, ...rest }) => rest),
    movedCount: moved.length,
    skipped,
    warnings,
  };

  if (dryRun) return antwort;
  if (!moved.length) return { ...antwort, rebooked: 0 };

  // ── Schreiben ─────────────────────────────────────────────────────────────
  // Zeilen mit identischer Nutzlast in einem Aufruf: das Ziel ist fuer alle
  // gleich, die Saetze unterscheiden sich nur je Mitarbeiter/Buchungsart.
  const gruppen = new Map();
  for (const m of moved) {
    const key = JSON.stringify(m._update);
    if (!gruppen.has(key)) gruppen.set(key, { update: m._update, ids: [] });
    gruppen.get(key).ids.push(m.ID);
  }
  // Bricht eine Gruppe ab, laufen Protokoll und Neuberechnung TROTZDEM ueber
  // das, was schon verschoben ist — und der Fehler wird danach gemeldet.
  // Ohne das stehen Kosten und Erloes der betroffenen Knoten falsch da, und
  // zwar still: die Zeilen sind umgebucht, die Summen zeigen den alten Stand.
  // Eine Transaktion gibt es hier nicht (kein rohes SQL im App-Code).
  const verschobenIds = new Set();
  let updateFehler = null;
  for (const { update, ids: gruppenIds } of gruppen.values()) {
    const { error: updErr } = await supabase
      .from("BOOKING")
      .update(update)
      .in("ID", gruppenIds)
      .eq("TENANT_ID", tenantId);
    if (updErr) { updateFehler = updErr; break; }
    for (const id of gruppenIds) verschobenIds.add(id);
  }
  const verschoben = moved.filter(m => verschobenIds.has(m.ID));

  // Protokoll. Es steht bewusst NACH dem Update: ein Eintrag ohne Umbuchung
  // wäre eine falsche Auskunft, eine Umbuchung ohne Eintrag nur eine
  // unvollstaendige — und der Fehler wird gemeldet, nicht geschluckt.
  const protokoll = verschoben.map(m => ({
    TENANT_ID:            tenantId,
    BOOKING_ID:               m.ID,
    BOOKING_DATE:         m.BOOKING_DATE || null,
    BOOKING_EMPLOYEE_ID:  m._row.EMPLOYEE_ID ?? null,
    QUANTITY_INT:         Number(m._row.QUANTITY_INT ?? 0),
    COST_TOTAL:               Number(m._row.COST_TOTAL ?? 0),
    FROM_PROJECT_ID:      m.FROM_PROJECT_ID,
    FROM_PROJECT_NAME:    m.FROM_PROJECT_NAME,
    FROM_STRUCTURE_ID:    m.FROM_STRUCTURE_ID,
    FROM_STRUCTURE_NAME:  m.FROM_STRUCTURE_NAME,
    TO_PROJECT_ID:        target.projectId,
    TO_PROJECT_NAME:      target.projectName,
    TO_STRUCTURE_ID:      target.structureId,
    TO_STRUCTURE_NAME:    target.structureName,
    HOURLY_RATE_BEFORE:       m.HOURLY_RATE_BEFORE,
    HOURLY_RATE_AFTER:        m.HOURLY_RATE_AFTER,
    HOURLY_RATE_TOTAL_BEFORE:        m.HOURLY_RATE_TOTAL_BEFORE,
    HOURLY_RATE_TOTAL_AFTER:         m.HOURLY_RATE_TOTAL_AFTER,
    REASON:               String(reason || "").trim().slice(0, 500) || null,
    CREATED_BY_EMPLOYEE_ID: employeeId ?? null,
  }));
  let logFehler = null;
  if (protokoll.length) {
    const { error: logErr } = await supabase.from("BOOKING_REBOOKING").insert(protokoll);
    // Fehlt die Tabelle (Migration 0139 nicht eingespielt), ist das kein Grund,
    // die Umbuchung als gescheitert zu melden — sie hat stattgefunden.
    if (logErr && !/relation .* does not exist/i.test(logErr.message)) logFehler = logErr;
  }

  // ── Summen der betroffenen Strukturknoten ─────────────────────────────────
  // Quelle UND Ziel: dem einen fehlen die Kosten jetzt, dem anderen kommen
  // sie zu. Jede Struktur genau einmal, auch wenn 50 Zeilen aus ihr kommen.
  const betroffeneStrukturen = new Set(verschoben.length ? [target.structureId] : []);
  for (const m of verschoben) if (m.FROM_STRUCTURE_ID != null) betroffeneStrukturen.add(m.FROM_STRUCTURE_ID);
  for (const sid of betroffeneStrukturen) await recomputeStructure(supabase, sid);

  // Budget-Warnungen je betroffenem Projekt (Reset auf der Quelle, evtl.
  // Auslösung auf dem Ziel). Weich: eine fehlgeschlagene Auswertung darf eine
  // erfolgte Umbuchung nicht als Fehler erscheinen lassen.
  const projektStrukturen = new Map();
  const merken = (projectId, structureId) => {
    if (projectId == null || structureId == null) return;
    const key = Number(projectId);
    if (!projektStrukturen.has(key)) projektStrukturen.set(key, new Set());
    projektStrukturen.get(key).add(Number(structureId));
  };
  if (verschoben.length) merken(target.projectId, target.structureId);
  for (const m of verschoben) merken(m.FROM_PROJECT_ID, m.FROM_STRUCTURE_ID);
  for (const [projectId, structureIds] of projektStrukturen) {
    try {
      await budgetWarnings.evaluateAfterTecChange(supabase, {
        tenantId, projectId, structureIds, triggerEmployeeId: employeeId ?? null, triggerTecId: null,
      });
    } catch (e) {
      console.warn(`[BUDGET_WARNING] rebookBuchungen eval failed (Projekt ${projectId}): ${e?.message || e}`);
    }
  }

  if (updateFehler) throw { status: 500, message: `Fehler beim Umbuchen nach ${verschoben.length} von ${moved.length} Buchungen: ${updateFehler.message}` };
  if (logFehler)    throw { status: 500, message: "Umbuchung erfolgte, Protokoll fehlgeschlagen: " + logFehler.message };

  return { ...antwort, rebooked: verschoben.length };
}

module.exports = {
  recomputeStructure,
  createBuchung,
  createSpecialBuchung,
  updateSpecialBuchung,
  patchBuchung,
  deleteBuchung,
  rebookBuchungen,
  listBuchungenByProject,
  createTimerDraft,
  listDraftsByEmployee,
  confirmDrafts,
  deleteDraft,
  patchDraftDescription,
};
