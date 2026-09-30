"use strict";

/**
 * Rechnungskorrektur (INVOICE_TYPE 'gutschrift', Migration 0179).
 *
 * Mindert eine GEBUCHTE Rechnung oder Abschlagsrechnung — mit Bezug auf das
 * Original (§ 31 Abs. 5 UStDV) und einem Grund, der auf dem Beleg steht. Fuer
 * eine Aenderung der Leistung (Aufmass, Umfang) ist eine Rechnungsberichtigung
 * noetig (BMF 15.10.2025 Rn. 51b); fuer eine reine Minderung des Entgelts
 * genuegt „Rest ausbuchen" (receivableAdjustments.js).
 *
 * Vorher war die „Gutschrift" eine Einzelrechnung mit anderem Typcode: ohne
 * Bezug, mit POSITIVEN Betraegen (sie erhoehte das Abgerechnete) und als
 * Forderung im Mahnwesen.
 *
 * Betraege stehen negativ in INVOICE_STRUCTURE und den Summen — wie beim
 * Storno und wie der Belegimport sie anlegt. Damit mindert bookInvoice das
 * Abgerechnete an Projekt und Struktur ohne Sonderweg, und die „bisher
 * abgerechnet"-Summen der Rechnungsvorschlaege sehen die Korrektur von
 * selbst. Den offenen Betrag des Originals mindert openAmount.js.
 */

const { round2, toNum, effectiveVatPercent, TOL } = require("./openAmount");

const META = {
  INVOICE: {
    table: "INVOICE", structTable: "INVOICE_STRUCTURE", idCol: "INVOICE_ID", ref: "CORRECTS_INVOICE_ID",
    numberCol: "INVOICE_NUMBER", dateCol: "INVOICE_DATE", label: "Rechnung",
    cols: "ID, STATUS_ID, PROJECT_ID, CONTRACT_ID, COMPANY_ID, INVOICE_NUMBER, INVOICE_DATE, INVOICE_TYPE, CANCELS_INVOICE_ID, VAT_ID, VAT_PERCENT, VAT_CATEGORY, VAT_EXEMPTION_REASON_CODE, VAT_EXEMPTION_REASON_TEXT, BUYER_REFERENCE, BUYER_ORDER_REFERENCE",
  },
  ADVANCE_INVOICE: {
    table: "ADVANCE_INVOICE", structTable: "ADVANCE_INVOICE_STRUCTURE", idCol: "ADVANCE_INVOICE_ID", ref: "CORRECTS_ADVANCE_INVOICE_ID",
    numberCol: "ADVANCE_INVOICE_NUMBER", dateCol: "ADVANCE_INVOICE_DATE", label: "Abschlagsrechnung",
    cols: "ID, STATUS_ID, PROJECT_ID, CONTRACT_ID, COMPANY_ID, ADVANCE_INVOICE_NUMBER, ADVANCE_INVOICE_DATE, CANCELS_ADVANCE_INVOICE_ID, VAT_ID, VAT_PERCENT, VAT_CATEGORY, VAT_EXEMPTION_REASON_CODE, VAT_EXEMPTION_REASON_TEXT, BUYER_REFERENCE, BUYER_ORDER_REFERENCE",
  },
};

function fail(status, message) { return { status, message }; }

function originOf(src) {
  const inv = src?.invoice_id ?? null;
  const adv = src?.advance_invoice_id ?? null;
  if (!!inv === !!adv) throw fail(400, "Bitte die zu korrigierende Rechnung ODER Abschlagsrechnung angeben.");
  const id = parseInt(String(inv ?? adv), 10);
  if (!Number.isFinite(id) || id <= 0) throw fail(400, "Ungültige Belegnummer.");
  return { kind: inv ? "INVOICE" : "ADVANCE_INVOICE", id };
}

async function loadOriginal(supabase, { tenantId, kind, id }) {
  const m = META[kind];
  const { data, error } = await supabase.from(m.table).select(m.cols).eq("ID", id).eq("TENANT_ID", tenantId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw fail(404, `${m.label} nicht gefunden.`);
  if (Number(data.STATUS_ID) !== 2) throw fail(400, "Korrigieren lässt sich nur ein gebuchter, nicht stornierter Beleg.");
  const storno = kind === "INVOICE"
    ? (data.INVOICE_TYPE === "stornorechnung" || data.CANCELS_INVOICE_ID != null)
    : data.CANCELS_ADVANCE_INVOICE_ID != null;
  if (storno) throw fail(400, "Eine Stornorechnung lässt sich nicht korrigieren.");
  if (kind === "INVOICE" && data.INVOICE_TYPE === "gutschrift") throw fail(400, "Eine Rechnungskorrektur lässt sich nicht korrigieren — bitte stornieren und neu anlegen.");
  return data;
}

/** Bereits korrigierte Betraege je Strukturelement (gebuchte und Entwuerfe, ohne `exceptId`). */
async function correctedByStructure(supabase, { tenantId, kind, id, exceptId = null }) {
  const m = META[kind];
  let q = supabase.from("INVOICE").select("ID, STATUS_ID").eq("TENANT_ID", tenantId).eq(m.ref, id).in("STATUS_ID", [1, 2]);
  const { data: corr, error } = await q;
  if (error) {
    if (/CORRECTS_|schema cache|does not exist/i.test(String(error.message || ""))) return new Map();
    throw new Error(error.message);
  }
  const ids = (corr || []).map(c => c.ID).filter(cid => String(cid) !== String(exceptId));
  const out = new Map();
  if (ids.length === 0) return out;
  const { data: rows } = await supabase.from("INVOICE_STRUCTURE").select("STRUCTURE_ID, AMOUNT_NET, AMOUNT_EXTRAS_NET").in("INVOICE_ID", ids);
  for (const r of rows || []) {
    const k = String(r.STRUCTURE_ID);
    out.set(k, round2((out.get(k) || 0) + Math.abs(toNum(r.AMOUNT_NET) + toNum(r.AMOUNT_EXTRAS_NET))));
  }
  return out;
}

/**
 * Was sich an einem Beleg korrigieren laesst: je Strukturelement der
 * berechnete Betrag, was davon schon korrigiert ist, und was bleibt.
 */
async function correctionBasis(supabase, { tenantId, query }) {
  const { kind, id } = originOf(query);
  const m = META[kind];
  const orig = await loadOriginal(supabase, { tenantId, kind, id });
  const draftId = query?.draft_id ? parseInt(String(query.draft_id), 10) : null;

  const { data: rows, error } = await supabase.from(m.structTable)
    .select("STRUCTURE_ID, AMOUNT_NET, AMOUNT_EXTRAS_NET").eq(m.idCol, id);
  if (error) throw new Error(error.message);
  const sids = [...new Set((rows || []).map(r => r.STRUCTURE_ID))];
  const { data: ps } = sids.length
    ? await supabase.from("PROJECT_STRUCTURE").select("ID, ABBR, NAME").in("ID", sids)
    : { data: [] };
  const psById = new Map((ps || []).map(p => [String(p.ID), p]));
  const corrected = await correctedByStructure(supabase, { tenantId, kind, id, exceptId: draftId });

  // Zeilen des Entwurfs, falls einer fortgesetzt wird
  const draftRows = new Map();
  if (draftId) {
    const { data: dr } = await supabase.from("INVOICE_STRUCTURE").select("STRUCTURE_ID, AMOUNT_NET, AMOUNT_EXTRAS_NET").eq("INVOICE_ID", draftId);
    for (const r of dr || []) draftRows.set(String(r.STRUCTURE_ID), round2(Math.abs(toNum(r.AMOUNT_NET) + toNum(r.AMOUNT_EXTRAS_NET))));
  }

  const byStructure = new Map();
  for (const r of rows || []) {
    const k = String(r.STRUCTURE_ID);
    const cur = byStructure.get(k) || { net: 0, extras: 0 };
    byStructure.set(k, { net: round2(cur.net + toNum(r.AMOUNT_NET)), extras: round2(cur.extras + toNum(r.AMOUNT_EXTRAS_NET)) });
  }

  return {
    original: {
      kind, id, number: orig[m.numberCol] ?? null, date: orig[m.dateCol] ?? null,
      invoiceType: kind === "INVOICE" ? (orig.INVOICE_TYPE || "rechnung") : "abschlag",
      vatPercent: effectiveVatPercent(orig),
    },
    rows: [...byStructure.entries()].map(([sid, v]) => {
      const billed = round2(v.net + v.extras);
      const done = corrected.get(sid) || 0;
      const p = psById.get(sid) || {};
      return {
        STRUCTURE_ID: Number(sid), ABBR: p.ABBR ?? "", NAME: p.NAME ?? "",
        BILLED_NET: billed, CORRECTED_NET: done, MAX_NET: round2(Math.max(0, billed - done)),
        DRAFT_NET: draftRows.get(sid) ?? null,
      };
    }).filter(r => r.BILLED_NET > 0),
  };
}

/**
 * Legt eine Rechnungskorrektur als Entwurf an oder ersetzt die Zeilen eines
 * bestehenden Entwurfs. Gebucht wird ueber POST /invoices/:id/book.
 *
 * body: { invoice_id | advance_invoice_id, rows: [{ structure_id, amount_net }],
 *         invoice_date, reason, employee_id?, draft_id? }
 */
async function saveCorrection(supabase, { tenantId, employeeId = null, body }) {
  const { kind, id } = originOf(body);
  const m = META[kind];
  const orig = await loadOriginal(supabase, { tenantId, kind, id });

  const reason = String(body?.reason || "").trim();
  if (!reason) throw fail(400, "Bitte den Grund der Korrektur angeben — er steht auf dem Beleg.");
  const date = String(body?.invoice_date || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw fail(400, "Datum ist erforderlich (JJJJ-MM-TT).");

  const draftId = body?.draft_id ? parseInt(String(body.draft_id), 10) : null;
  if (draftId) {
    const { data: d } = await supabase.from("INVOICE").select(`ID, STATUS_ID, INVOICE_TYPE, ${m.ref}`)
      .eq("ID", draftId).eq("TENANT_ID", tenantId).maybeSingle();
    if (!d || Number(d.STATUS_ID) !== 1 || d.INVOICE_TYPE !== "gutschrift" || String(d[m.ref]) !== String(id)) {
      throw fail(404, "Korrektur-Entwurf nicht gefunden.");
    }
  }

  const basis = await correctionBasis(supabase, { tenantId, query: { [m.idCol === "INVOICE_ID" ? "invoice_id" : "advance_invoice_id"]: id, draft_id: draftId } });
  const byId = new Map(basis.rows.map(r => [String(r.STRUCTURE_ID), r]));
  const wanted = (Array.isArray(body?.rows) ? body.rows : [])
    .map(r => ({ sid: String(r?.structure_id ?? ""), amount: round2(r?.amount_net) }))
    .filter(r => r.amount > 0);
  if (wanted.length === 0) throw fail(400, "Bitte mindestens einen Betrag angeben, um den korrigiert wird.");
  for (const w of wanted) {
    const row = byId.get(w.sid);
    if (!row) throw fail(400, "Dieses Element gehört nicht zum korrigierten Beleg.");
    if (w.amount > row.MAX_NET + TOL) {
      throw fail(400, `${row.ABBR || "Element"}: höchstens ${row.MAX_NET.toFixed(2).replace(".", ",")} € lassen sich noch korrigieren.`);
    }
  }

  // Anlegen ueber initInvoice (Firma, Adresse, Kontakt, Zahlungsart wie
  // jede Rechnung) — oder den Entwurf wiederverwenden.
  let invId = draftId;
  if (!invId) {
    const { initInvoice } = require("./invoices");
    const created = await initInvoice(supabase, {
      companyId: orig.COMPANY_ID, employeeId: body?.employee_id ?? employeeId,
      projectId: orig.PROJECT_ID, contractId: orig.CONTRACT_ID, invoiceType: "gutschrift", tenantId,
    });
    invId = created.id;
  }

  const { error: upErr } = await supabase.from("INVOICE").update({
    [m.ref]: id,
    CORRECTION_REASON: reason,
    INVOICE_DATE: date,
    DUE_DATE: null,                       // keine Forderung, also keine Faelligkeit
    COMMENT: reason,
    VAT_ID: orig.VAT_ID ?? null,          // Steuer wie im Original
    VAT_PERCENT: orig.VAT_PERCENT ?? null,
    VAT_CATEGORY: orig.VAT_CATEGORY ?? "S",
    VAT_EXEMPTION_REASON_CODE: orig.VAT_EXEMPTION_REASON_CODE ?? null,
    VAT_EXEMPTION_REASON_TEXT: orig.VAT_EXEMPTION_REASON_TEXT ?? null,
    BUYER_REFERENCE: orig.BUYER_REFERENCE ?? null,
    BUYER_ORDER_REFERENCE: orig.BUYER_ORDER_REFERENCE ?? null,
  }).eq("ID", invId).eq("TENANT_ID", tenantId);
  if (upErr) {
    if (/CORRECT/i.test(String(upErr.message || ""))) throw fail(503, "Rechnungskorrektur ist noch nicht eingerichtet (Migration 0179 fehlt).");
    throw new Error(upErr.message);
  }

  // Zeilen negativ, Honorar und Nebenkosten im Verhaeltnis des Originals.
  const { data: origRows } = await supabase.from(m.structTable)
    .select("STRUCTURE_ID, AMOUNT_NET, AMOUNT_EXTRAS_NET").eq(m.idCol, id);
  const share = new Map();
  for (const r of origRows || []) {
    const k = String(r.STRUCTURE_ID);
    const cur = share.get(k) || { net: 0, extras: 0 };
    share.set(k, { net: cur.net + toNum(r.AMOUNT_NET), extras: cur.extras + toNum(r.AMOUNT_EXTRAS_NET) });
  }
  const newRows = wanted.map(w => {
    const s = share.get(w.sid) || { net: 1, extras: 0 };
    const total = s.net + s.extras;
    const net = total > 0 ? round2(w.amount * s.net / total) : w.amount;
    return {
      INVOICE_ID: invId, STRUCTURE_ID: Number(w.sid), TENANT_ID: tenantId,
      AMOUNT_NET: -net, AMOUNT_EXTRAS_NET: -round2(w.amount - net),
    };
  });
  const { error: delErr } = await supabase.from("INVOICE_STRUCTURE").delete().eq("INVOICE_ID", invId);
  if (delErr) throw new Error(delErr.message);
  const { error: insErr } = await supabase.from("INVOICE_STRUCTURE").insert(newRows);
  if (insErr) throw new Error(insErr.message);

  // Summen mit der Steuer des Originals — bewusst nicht recomputeInvoiceTotals:
  // das ersetzt 0 % durch den Standardsatz und haette die Korrektur einer
  // §13b-Rechnung mit Umsatzsteuer versehen.
  const amountNet    = round2(newRows.reduce((s, r) => s + r.AMOUNT_NET, 0));
  const amountExtras = round2(newRows.reduce((s, r) => s + r.AMOUNT_EXTRAS_NET, 0));
  const totalNet     = round2(amountNet + amountExtras);
  const vatPct       = effectiveVatPercent(orig);
  const taxAmountNet = round2(totalNet * vatPct / 100);
  const totalGross   = round2(totalNet + taxAmountNet);
  const { error: totErr } = await supabase.from("INVOICE").update({
    AMOUNT_NET: amountNet, AMOUNT_EXTRAS_NET: amountExtras,
    TOTAL_AMOUNT_NET: totalNet, TAX_AMOUNT_NET: taxAmountNet, TOTAL_AMOUNT_GROSS: totalGross,
  }).eq("ID", invId).eq("TENANT_ID", tenantId);
  if (totErr) throw new Error(totErr.message);

  return { id: invId, total_amount_net: totalNet, tax_amount_net: taxAmountNet, total_amount_gross: totalGross, vat_percent: vatPct };
}

module.exports = { correctionBasis, saveCorrection };
