"use strict";

/**
 * Generator: Rechnungen & Zahlungen.
 *
 * Iteration 2a — Abschlagsrechnungen (PARTIAL_PAYMENT) + Zahlungseingänge (PAYMENT).
 * Die Schlussrechnung (INVOICE mit Abschlags-Abzügen) folgt separat.
 *
 * Für jedes Projekt werden über die Laufzeit im Rhythmus `partialEveryDays`
 * Abschlagsrechnungen gestellt — exakt über die echten Services, in derselben
 * Reihenfolge wie der Wizard (controllers/partialPayments.js):
 *   init → (BT2) TEC zuordnen → applyPerformanceAmount (BT1) → updateBt2FromTec →
 *   recomputePartialPaymentTotals → Datumsfelder → bookPartialPayment(skipDocuments).
 *
 * BT1 (Pauschal) wird nach geplantem Leistungsstand abgerechnet (gleiche ease-Kurve
 * wie der Fortschritts-Generator), gedeckelt durch den tatsächlich abrechenbaren
 * Rest (REVENUE_COMPLETION − bereits berechnet). BT2 (Stunden) rechnet die bis zum
 * Stichtag aufgelaufenen, noch nicht fakturierten Buchungen ab.
 *
 * Zahlungen: ein Teil der gebuchten Abschläge wird (mit Verzug) als Zahlungseingang
 * verbucht — Logik gespiegelt aus routes/payments.js (PAYMENT + PAYMENT_STRUCTURE +
 * PROJECT/PROJECT_STRUCTURE.PAYED + Fortschritts-Snapshot).
 */

const pp = require("../../../services/partialPayments");
const { insertProgressSnapshot } = require("../../../services/projectProgress");
const cal = require("../lib/calendar");

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const toNum = (v) => {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? ""));
  return Number.isFinite(n) ? n : 0;
};

// gleiche Fertigstellungskurve wie generators/progress.js
function ease(f) {
  const x = Math.max(0, Math.min(1, f));
  return x * x * x * (x * (x * 6 - 15) + 10);
}

function scheduledPct(tl, dateISO) {
  const total = Math.max(1, cal.diffDays(tl.start, tl.end));
  const f = cal.diffDays(tl.start, dateISO) / total;
  if (tl.closed && dateISO >= tl.end) return 100;
  return Math.min(ease(f) * 100, 95);
}

function billingDates(startISO, endISO, everyDays) {
  const out = [];
  let cur = cal.addDays(startISO, everyDays);
  while (cur <= endISO) {
    out.push(cur);
    cur = cal.addDays(cur, everyDays);
  }
  return out;
}

// Zahlung für eine gebuchte AR verbuchen — gespiegelt aus routes/payments.js (POST).
async function recordPayment({ supabase, tenantId, ppRow, paymentDateISO }) {
  const gross = toNum(ppRow.TOTAL_AMOUNT_GROSS);
  if (gross <= 0) return false;
  const vatPercent = toNum(ppRow.VAT_PERCENT);
  const net = round2(gross / (1 + vatPercent / 100));
  const vat = round2(gross - net);
  const projectId = ppRow.PROJECT_ID;
  const contractId = ppRow.CONTRACT_ID;

  const { data: created, error: insErr } = await supabase
    .from("PAYMENT")
    .insert([
      {
        PARTIAL_PAYMENT_ID: ppRow.ID,
        INVOICE_ID: null,
        AMOUNT_PAYED_GROSS: gross,
        AMOUNT_PAYED_NET: net,
        AMOUNT_PAYED_VAT: vat,
        PAYMENT_DATE: paymentDateISO,
        PROJECT_ID: projectId,
        CONTRACT_ID: contractId,
        PURPOSE_OF_PAYMENT: ppRow.PARTIAL_PAYMENT_NUMBER || null,
        COMMENT: null,
        TENANT_ID: tenantId,
        AMOUNT_PAYED_EXTRAS_NET: null,
      },
    ])
    .select("ID")
    .single();
  if (insErr) throw new Error(insErr.message);

  // PROJECT.PAYED += net
  const { data: projRow } = await supabase.from("PROJECT").select("PAYED").eq("ID", projectId).maybeSingle();
  await supabase
    .from("PROJECT")
    .update({ PAYED: round2(toNum(projRow?.PAYED) + net) })
    .eq("ID", projectId);

  // Verteilung auf Strukturelemente
  const { data: structureRows } = await supabase
    .from("PARTIAL_PAYMENT_STRUCTURE")
    .select("STRUCTURE_ID, AMOUNT_NET, AMOUNT_EXTRAS_NET")
    .eq("PARTIAL_PAYMENT_ID", ppRow.ID);

  if (structureRows && structureRows.length > 0) {
    const totalAllocated = structureRows.reduce((s, r) => s + toNum(r.AMOUNT_NET) + toNum(r.AMOUNT_EXTRAS_NET), 0);
    const payStructRows = structureRows.map((r) => {
      const rowTotal = toNum(r.AMOUNT_NET) + toNum(r.AMOUNT_EXTRAS_NET);
      const share = totalAllocated !== 0 ? round2((net * rowTotal) / totalAllocated) : round2(net / structureRows.length);
      return {
        PAYMENT_ID: created.ID,
        PARTIAL_PAYMENT_ID: ppRow.ID,
        INVOICE_ID: null,
        STRUCTURE_ID: r.STRUCTURE_ID,
        AMOUNT_PAYED_NET: share,
        AMOUNT_PAYED_EXTRAS_NET: 0,
        TENANT_ID: tenantId,
      };
    });
    // Rundungsdifferenz auf die erste Zeile legen
    const rowSum = payStructRows.reduce((s, r) => s + r.AMOUNT_PAYED_NET, 0);
    const diff = round2(net - rowSum);
    if (diff !== 0 && payStructRows.length > 0) payStructRows[0].AMOUNT_PAYED_NET = round2(payStructRows[0].AMOUNT_PAYED_NET + diff);

    const { error: psErr } = await supabase.from("PAYMENT_STRUCTURE").insert(payStructRows);
    if (!psErr) {
      // PROJECT_STRUCTURE.PAYED je Blatt neu summieren + Fortschritts-Snapshot
      for (const r of payStructRows) {
        const { data: sPays } = await supabase.from("PAYMENT_STRUCTURE").select("AMOUNT_PAYED_NET").eq("STRUCTURE_ID", r.STRUCTURE_ID);
        const sum = round2((sPays || []).reduce((s, x) => s + toNum(x.AMOUNT_PAYED_NET), 0));
        await supabase.from("PROJECT_STRUCTURE").update({ PAYED: sum }).eq("ID", r.STRUCTURE_ID);
      }
      const progressRows = payStructRows.map((r) => ({ TENANT_ID: tenantId, STRUCTURE_ID: r.STRUCTURE_ID, PAYED: r.AMOUNT_PAYED_NET }));
      await insertProgressSnapshot(supabase, progressRows);
    }
  }
  return true;
}

async function makePartialPayment({ supabase, md, project, tl, dateISO, prevDateISO, cfg, rng, stats, log }) {
  const contractId = project.contract.ID;
  const employeeId = project.PROJECT_MANAGER_ID || project.assignments[0]?.EMPLOYEE_ID || md.employees[0]?.ID;
  const companyId = md.companyId || project.COMPANY_ID;
  if (!employeeId || !companyId) {
    stats.skipped++;
    return;
  }

  // 1) Draft anlegen
  const { id } = await pp.initPartialPayment(supabase, { companyId, employeeId, projectId: project.ID, contractId });

  try {
    const structures = await pp.loadProjectStructuresForContext(supabase, { contractId, projectId: project.ID });
    const bt1 = (structures || []).filter((s) => Number(s.BILLING_TYPE_ID) === 1);
    const bt2Ids = (structures || []).filter((s) => Number(s.BILLING_TYPE_ID) === 2).map((s) => s.ID);
    const bt1Ids = bt1.map((s) => s.ID);

    // 2) BT2 — noch nicht fakturierte Buchungen bis zum Stichtag zuordnen
    if (bt2Ids.length > 0) {
      const { data: cand } = await supabase
        .from("TEC")
        .select("ID, PARTIAL_PAYMENT_ID, INVOICE_ID")
        .in("STRUCTURE_ID", bt2Ids)
        .lte("DATE_VOUCHER", dateISO)
        .neq("STATUS", "DRAFT");
      const assignable = (cand || [])
        .filter((t) => pp.isNullOrZero(t.PARTIAL_PAYMENT_ID) && pp.isUninvoiced(t.INVOICE_ID))
        .map((t) => t.ID);
      if (assignable.length > 0) {
        await supabase.from("TEC").update({ PARTIAL_PAYMENT_ID: id }).in("ID", assignable);
      }
    }

    // 3) BT1 — nach geplantem Leistungsstand abrechnen (gedeckelt durch Rest)
    if (bt1Ids.length > 0) {
      // Fixhonorar aus den Stammdaten (loadProjectStructuresForContext liefert kein REVENUE).
      const leafRevenue = new Map((project.leaves || []).map((l) => [String(l.ID), toNum(l.REVENUE)]));
      const honorarBt1 = round2(bt1Ids.reduce((s, sid) => s + (leafRevenue.get(String(sid)) || 0), 0));
      const prev = await pp.loadPreviouslyBilledByStructure(supabase, {
        contractId,
        projectId: project.ID,
        structureIds: bt1Ids,
        excludePartialPaymentId: id,
        bookedStatusId: 2,
      });
      const alreadyBilled = round2(bt1Ids.reduce((s, sid) => s + (prev.get(String(sid)) || 0), 0));
      const maxBillable = round2(
        bt1.reduce((s, x) => {
          const rem = toNum(x.REVENUE_COMPLETION) - (prev.get(String(x.ID)) || 0);
          return s + (rem > 0 ? rem : 0);
        }, 0),
      );
      const pct = Math.min(scheduledPct(tl, dateISO), cfg.invoicing.partialCapPct);
      const targetCum = round2((honorarBt1 * pct) / 100);
      let amount = round2(targetCum - alreadyBilled);
      if (amount > maxBillable) amount = maxBillable;
      if (amount > 0.005) {
        await pp.applyPerformanceAmount(supabase, { partialPaymentId: id, contractId, projectId: project.ID, amount });
      }
    }

    // 4) BT2-Summen aus zugeordneten TEC in die AR schreiben
    if (bt2Ids.length > 0) {
      await pp.updateBt2FromTec(supabase, { partialPaymentId: id, contractId, projectId: project.ID });
    }

    // 5) Summen berechnen
    const totals = await pp.recomputePartialPaymentTotals(supabase, id);
    if (toNum(totals.total_amount_net) <= 0.005) {
      await pp.deletePartialPayment(supabase, { id, tenantId: md.tenantId });
      return; // in dieser Periode nichts abzurechnen
    }

    // 6) Datumsfelder setzen
    await supabase
      .from("PARTIAL_PAYMENT")
      .update({
        PARTIAL_PAYMENT_DATE: dateISO,
        DUE_DATE: cal.addDays(dateISO, 30),
        BILLING_PERIOD_START: prevDateISO || tl.start,
        BILLING_PERIOD_FINISH: dateISO,
      })
      .eq("ID", id);

    // 7) Buchen (ohne PDF/XML)
    const { data: ppRow } = await supabase
      .from("PARTIAL_PAYMENT")
      .select("ID, COMPANY_ID, PROJECT_ID, CONTRACT_ID, TOTAL_AMOUNT_NET, VAT_PERCENT, STATUS_ID, PARTIAL_PAYMENT_NUMBER, DOCUMENT_TEMPLATE_ID, TENANT_ID, CANCELS_PARTIAL_PAYMENT_ID")
      .eq("ID", id)
      .maybeSingle();
    await pp.bookPartialPayment(supabase, { id, pp: ppRow, tenantId: md.tenantId, force: true, skipDocuments: cfg.invoicing.skipDocuments });
    stats.booked++;

    // 8) Zahlung (mit Verzug), sofern Zahlungsdatum nicht in der Zukunft liegt
    if (rng.chance(cfg.invoicing.payment.payRatio)) {
      const delay = rng.int(cfg.invoicing.payment.delayDays.min, cfg.invoicing.payment.delayDays.max);
      const payDate = cal.addDays(dateISO, delay);
      if (payDate <= cal.todayISO()) {
        const { data: booked } = await supabase
          .from("PARTIAL_PAYMENT")
          .select("ID, PROJECT_ID, CONTRACT_ID, TOTAL_AMOUNT_GROSS, VAT_PERCENT, PARTIAL_PAYMENT_NUMBER")
          .eq("ID", id)
          .maybeSingle();
        const paid = await recordPayment({ supabase, tenantId: md.tenantId, ppRow: booked, paymentDateISO: payDate });
        if (paid) stats.paid++;
      }
    }
  } catch (e) {
    stats.errors++;
    if (stats.errors <= 8) log(`  ⚠︎ Abschlag P${project.ID} ${dateISO}: ${e?.message || e}`);
    // Draft aufräumen, falls noch ungebucht
    try {
      const { data: chk } = await supabase.from("PARTIAL_PAYMENT").select("STATUS_ID").eq("ID", id).maybeSingle();
      if (chk && String(chk.STATUS_ID) !== "2") await pp.deletePartialPayment(supabase, { id, tenantId: md.tenantId });
    } catch (_) {
      /* ignore cleanup errors */
    }
  }
}

async function generate({ supabase, md, timeline, cfg, rng, log, apply }) {
  const stats = { booked: 0, paid: 0, skipped: 0, errors: 0, planned: 0 };
  const today = cal.todayISO();

  for (const project of md.projects) {
    const tl = timeline.byProject.get(String(project.ID));
    if (!tl || !project.contract || !project.leaves.length) {
      if (!project.contract) stats.skipped++;
      continue;
    }
    const winEnd = tl.end < today ? tl.end : today;
    const dates = billingDates(tl.start, winEnd, cfg.invoicing.partialEveryDays);
    stats.planned += dates.length;

    if (!apply) continue; // Dry-Run: nur planen

    const projRng = rng.derive(`inv:${project.ID}`);
    let prevDate = tl.start;
    for (const d of dates) {
      await makePartialPayment({ supabase, md, project, tl, dateISO: d, prevDateISO: prevDate, cfg, rng: projRng, stats, log });
      prevDate = d;
    }
  }

  if (!apply) {
    log(`  Abschlagsrechnungen (geplant): ~${stats.planned} über ${md.projects.filter((p) => p.contract).length} Projekte mit Vertrag`);
  } else {
    log(
      `  Abschlagsrechnungen: ${stats.booked} gebucht, ${stats.paid} bezahlt` +
        (stats.skipped ? `, ${stats.skipped} ohne Vertrag/Firma übersprungen` : "") +
        (stats.errors ? `, ${stats.errors} Fehler` : ""),
    );
  }
  return stats;
}

module.exports = { generate, recordPayment };
