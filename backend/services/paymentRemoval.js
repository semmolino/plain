"use strict";

/**
 * Zahlungen loeschen — eine Stelle fuer „Zahlung loeschen" und
 * „Stornieren + Zahlungen loeschen" (docs/RECHNUNGSKUERZUNGEN_ANALYSE.md,
 * Nebenbefund 3).
 *
 * Vorher hatten cancelInvoice und cancelPartialPayment eine eigene Kopie:
 * PROJECT_STRUCTURE.PAYED wurde nur fuer Elemente neu gerechnet, die NOCH
 * Zahlungen hatten — war die geloeschte die einzige, blieb der alte Wert
 * stehen —, und die Vaeter wurden nicht nachgezogen. Obendrein lief die
 * Neuberechnung ueber alle Zahlungen des Mandanten.
 *
 * Jetzt fuer jedes betroffene Blatt: PAYED = Σ verbleibende PAYMENT_STRUCTURE
 * (0, wenn keine mehr da ist), danach die Vaeter bis zur Wurzel; PROJECT.PAYED
 * je Projekt aus den verbleibenden Zahlungen; ein PROJECT_PROGRESS-Snapshot
 * mit dem Minus je Blatt.
 */

const { insertProgressSnapshot } = require("./projectProgress");

function toNum(v) {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? ""));
  return Number.isFinite(n) ? n : 0;
}
const round2 = (n) => Math.round((toNum(n) + Number.EPSILON) * 100) / 100;
const sum = (rows, col) => round2((rows || []).reduce((s, r) => s + toNum(r[col]), 0));

/** Vaeter bis zur Wurzel aus ihren Kindern neu summieren. */
async function propagatePayedUpwards(supabase, structureId) {
  const { data: node } = await supabase
    .from("PROJECT_STRUCTURE").select("FATHER_ID").eq("ID", structureId).maybeSingle();
  if (!node || node.FATHER_ID == null) return;
  const parentId = node.FATHER_ID;

  const { data: siblings } = await supabase
    .from("PROJECT_STRUCTURE")
    .select("REVENUE, EXTRAS, COSTS, REVENUE_COMPLETION, EXTRAS_COMPLETION, ADVANCE_INVOICED, INVOICED, PAYED")
    .eq("FATHER_ID", parentId);
  if (siblings && siblings.length > 0) {
    await supabase.from("PROJECT_STRUCTURE").update({
      REVENUE:            sum(siblings, "REVENUE"),
      EXTRAS:             sum(siblings, "EXTRAS"),
      COSTS:              sum(siblings, "COSTS"),
      REVENUE_COMPLETION: sum(siblings, "REVENUE_COMPLETION"),
      EXTRAS_COMPLETION:  sum(siblings, "EXTRAS_COMPLETION"),
      ADVANCE_INVOICED:   sum(siblings, "ADVANCE_INVOICED"),
      INVOICED:           sum(siblings, "INVOICED"),
      PAYED:              sum(siblings, "PAYED"),
    }).eq("ID", parentId);
  }
  await propagatePayedUpwards(supabase, parentId);
}

/**
 * Loescht Zahlungen samt Aufteilung und zieht PAYED nach.
 * @param {{ tenantId:number, paymentIds:number[] }} p  nur Zahlungen dieses Mandanten werden beruehrt
 * @returns {Promise<{ removed:number }>}
 */
async function removePayments(supabase, { tenantId, paymentIds }) {
  const wanted = (paymentIds || []).map((x) => parseInt(String(x), 10)).filter(Number.isFinite);
  if (wanted.length === 0) return { removed: 0 };

  const { data: payments, error: pErr } = await supabase
    .from("PAYMENT").select("ID, PROJECT_ID").in("ID", wanted).eq("TENANT_ID", tenantId);
  if (pErr) throw new Error(pErr.message);
  const ids = (payments || []).map((p) => p.ID);
  if (ids.length === 0) return { removed: 0 };

  const { data: psRows, error: psErr } = await supabase
    .from("PAYMENT_STRUCTURE").select("STRUCTURE_ID, AMOUNT_PAYED_NET").in("PAYMENT_ID", ids);
  if (psErr) throw new Error(psErr.message);

  const { error: dsErr } = await supabase.from("PAYMENT_STRUCTURE").delete().in("PAYMENT_ID", ids);
  if (dsErr) throw new Error(dsErr.message);
  const { error: dErr } = await supabase.from("PAYMENT").delete().in("ID", ids).eq("TENANT_ID", tenantId);
  if (dErr) throw new Error(dErr.message);

  // PROJECT.PAYED je Projekt aus den verbleibenden Zahlungen (neu summiert, kein Delta)
  for (const projectId of [...new Set((payments || []).map((p) => p.PROJECT_ID).filter((x) => x != null))]) {
    const { data: rest } = await supabase
      .from("PAYMENT").select("AMOUNT_PAYED_NET").eq("PROJECT_ID", projectId).eq("TENANT_ID", tenantId);
    await supabase.from("PROJECT").update({ PAYED: sum(rest, "AMOUNT_PAYED_NET") }).eq("ID", projectId).eq("TENANT_ID", tenantId);
  }

  // Jedes betroffene Blatt — auch das, an dem jetzt keine Zahlung mehr haengt
  const leaves = new Map((psRows || []).filter((r) => r.STRUCTURE_ID != null).map((r) => [String(r.STRUCTURE_ID), r.STRUCTURE_ID]));
  for (const sid of leaves.values()) {
    const { data: rest } = await supabase
      .from("PAYMENT_STRUCTURE").select("AMOUNT_PAYED_NET").eq("STRUCTURE_ID", sid).eq("TENANT_ID", tenantId);
    await supabase.from("PROJECT_STRUCTURE").update({ PAYED: sum(rest, "AMOUNT_PAYED_NET") }).eq("ID", sid).eq("TENANT_ID", tenantId);
    await propagatePayedUpwards(supabase, sid);
  }

  if ((psRows || []).length > 0) {
    const { error: prErr } = await insertProgressSnapshot(supabase, psRows.map((r) => ({
      TENANT_ID: tenantId ?? null,
      STRUCTURE_ID: r.STRUCTURE_ID,
      PAYED: -round2(r.AMOUNT_PAYED_NET),
    })));
    if (prErr) console.error("[PAYMENT_REMOVE][PROGRESS]", prErr.message);
  }
  return { removed: ids.length };
}

/** Alle Zahlungen eines Belegs loeschen (Storno mit „Zahlungen loeschen"). */
async function removePaymentsOfDoc(supabase, { kind, id, tenantId }) {
  const col = kind === "INVOICE" ? "INVOICE_ID" : "ADVANCE_INVOICE_ID";
  const { data, error } = await supabase.from("PAYMENT").select("ID").eq(col, id).eq("TENANT_ID", tenantId);
  if (error) throw new Error(error.message);
  return removePayments(supabase, { tenantId, paymentIds: (data || []).map((p) => p.ID) });
}

module.exports = { removePayments, removePaymentsOfDoc, propagatePayedUpwards };
