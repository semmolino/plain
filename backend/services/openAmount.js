"use strict";

/**
 * Offener Betrag eines Belegs — die eine Rechnung dafuer.
 *
 * Vorher rechneten sechs Stellen selbst, und drei davon kamen zu einem anderen
 * Ergebnis als die Rechnungsliste:
 *   - Rechnungsliste (Frontend):  Brutto nach Nachlass − Einbehalt − Zahlungen,
 *     Skontozahlung = erledigt (ohne Blick auf die Frist)
 *   - Mahnwesen, Faelligkeitshinweise, Dashboard „Offene Posten",
 *     E-Mail-Vorlagen:            gespeichertes Brutto − Zahlungen
 * Das gespeicherte Brutto ist das VOR Nachlass I/II (die Nachlaesse zieht erst
 * das PDF ab, services_pdf_render.js). Folge: ein Nachlass, ein
 * Sicherheitseinbehalt oder eine Skontozahlung wurde gemahnt, waehrend die
 * Liste denselben Beleg als erledigt zeigte.
 *
 * Jetzt gilt ueberall (und wie auf dem PDF):
 *
 *   Forderung = Brutto nach Nachlass − Einbehalt (+ aufgeloester Einbehalt)
 *   offen     = Forderung − Σ Zahlungen − Σ ausgebuchte Reste
 *
 * Skonto: wurde innerhalb der Frist mindestens der Skontobetrag gezahlt, ist
 * der Beleg erledigt. Ohne Rechnungsdatum oder Skontotage bleibt es bei der
 * alten Regel (keine Frist bekannt → nur der Betrag zaehlt). Neue
 * Skontozahlungen bucht der Zahlungsdialog ausserdem als Minderung aus, damit
 * der USt-Anteil belegt ist (RECEIVABLE_ADJUSTMENT, Grund „skonto").
 *
 * Status und Belegart prueft diese Datei nicht — ob ein Storno oder ein
 * Entwurf ueberhaupt „offen" sein kann, entscheidet der Aufrufer.
 */

const { discountsOf } = require("./documentDiscounts");

const TOL = 0.005;

function toNum(v) {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? ""));
  return Number.isFinite(n) ? n : 0;
}

function round2(n) {
  return Math.round((toNum(n) + Number.EPSILON) * 100) / 100;
}

/** Spalten, die claimOf() braucht — fuer die select()-Listen der Aufrufer. */
const CLAIM_COLS = {
  INVOICE:
    "TOTAL_AMOUNT_NET, TOTAL_AMOUNT_GROSS, TOTAL_DISCOUNTS, DISCOUNT_1_PERCENT, DISCOUNT_2_PERCENT, " +
    "VAT_PERCENT, VAT_CATEGORY, SE_AMOUNT, SE_RELEASE_TOTAL, CASH_DISCOUNT_PERCENT, CASH_DISCOUNT_DAYS, INVOICE_DATE, INVOICE_TYPE",
  ADVANCE_INVOICE:
    "TOTAL_AMOUNT_NET, TOTAL_AMOUNT_GROSS, TOTAL_DISCOUNTS, DISCOUNT_1_PERCENT, DISCOUNT_2_PERCENT, " +
    "VAT_PERCENT, VAT_CATEGORY, SE_AMOUNT, CASH_DISCOUNT_PERCENT, CASH_DISCOUNT_DAYS, ADVANCE_INVOICE_DATE",
};

/**
 * select()-Liste aus eigenen Spalten plus CLAIM_COLS[kind], ohne Dubletten —
 * PostgREST nimmt eine doppelt genannte Spalte nicht stillschweigend hin.
 */
function withClaimCols(kind, extra) {
  const seen = new Set();
  return `${extra}, ${CLAIM_COLS[kind]}`.split(",").map(s => s.trim()).filter(c => c && !seen.has(c) && seen.add(c)).join(", ");
}

/** Bei jeder Kategorie ausser S (Regelsatz) gibt es keine ausgewiesene Steuer. */
function effectiveVatPercent(doc) {
  const cat = String(doc?.VAT_CATEGORY ?? "S").trim().toUpperCase() || "S";
  return cat === "S" ? toNum(doc?.VAT_PERCENT) : 0;
}

function addDays(isoDate, days) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(isoDate ?? ""));
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  d.setUTCDate(d.getUTCDate() + Math.round(days));
  return d.toISOString().slice(0, 10);
}

/**
 * Was der Beleg vom Kunden fordert.
 * @param {object} doc   INVOICE- oder ADVANCE_INVOICE-Zeile (Spalten: CLAIM_COLS)
 * @param {'INVOICE'|'ADVANCE_INVOICE'} kind
 */
function claimOf(doc, kind) {
  const net = round2(doc?.TOTAL_AMOUNT_NET);
  const vatPct = effectiveVatPercent(doc);

  // Nachlaesse wie auf dem PDF und im XML (services/documentDiscounts.js)
  const discounts = discountsOf(doc).total;

  let gross;
  if (Math.abs(discounts) < TOL && doc?.TOTAL_AMOUNT_GROSS != null && doc.TOTAL_AMOUNT_GROSS !== "") {
    gross = round2(doc.TOTAL_AMOUNT_GROSS);
  } else {
    const adjNet = round2(net - discounts);
    gross = round2(adjNet + round2(adjNet * vatPct / 100));
  }

  const seHeld = round2(doc?.SE_AMOUNT);
  const seRelease = kind === "INVOICE" ? round2(doc?.SE_RELEASE_TOTAL) : 0;
  const payable = round2(gross - seHeld + seRelease);

  const cdPct = toNum(doc?.CASH_DISCOUNT_PERCENT);
  const cdDays = toNum(doc?.CASH_DISCOUNT_DAYS);
  const docDate = kind === "INVOICE" ? doc?.INVOICE_DATE : doc?.ADVANCE_INVOICE_DATE;
  const skontoGross = cdPct > 0 ? round2(payable * (1 - cdPct / 100)) : null;
  const skontoDeadline = cdPct > 0 && cdDays > 0 ? addDays(docDate, cdDays) : null;

  return { net, discounts, gross, vatPct, seHeld, seRelease, payable, skontoGross, skontoDeadline };
}

/**
 * @param {ReturnType<typeof claimOf>} claim
 * @param {{ payments?: {gross:number, date?:string|null}[], adjustments?: {gross:number}[] }} p
 */
function computeOpen(claim, { payments = [], adjustments = [], absorbedBy = null, corrected = 0, isCorrection = false } = {}) {
  const paid = round2(payments.reduce((s, p) => s + toNum(p.gross), 0));
  const adjusted = round2(adjustments.reduce((s, a) => s + toNum(a.gross), 0));
  const correctedGross = round2(Math.abs(toNum(corrected)));
  let open = round2(claim.payable - paid - adjusted - correctedGross);
  let skontoTaken = false;

  if (claim.skontoGross != null && open > TOL) {
    // Nach einer Rechnungskorrektur bezieht sich Skonto auf den geminderten Betrag.
    const skontoGross = correctedGross > 0
      ? round2((claim.payable - correctedGross) * claim.skontoGross / (claim.payable || 1))
      : claim.skontoGross;
    const paidInTime = claim.skontoDeadline
      ? round2(payments.filter(p => !p.date || String(p.date).slice(0, 10) <= claim.skontoDeadline)
          .reduce((s, p) => s + toNum(p.gross), 0))
      : paid;
    if (paidInTime >= skontoGross - TOL) {
      open = 0;
      skontoTaken = true;
    }
  }

  // In einer Schlussrechnung aufgegangen (Migration 0178): der Rest steht
  // jetzt dort in Rechnung — hier ist nichts mehr offen, gemahnt wird er dort.
  if (absorbedBy != null) open = 0;

  // Eine Rechnungskorrektur ist keine Forderung: sie mindert den offenen
  // Betrag ihres Originals (corrected dort), selbst ist sie nie offen.
  if (isCorrection) open = 0;

  return {
    paid, adjusted, corrected: correctedGross, open, skontoTaken, settled: open <= TOL,
    absorbedBy: absorbedBy ?? null, isCorrection,
  };
}

// ── Laden ──────────────────────────────────────────────────────────────────

const CHUNK = 200;

// Fehlt die Tabelle (Migration 0177 noch nicht eingespielt, oder PostgREST
// kennt sie noch nicht — der Web-Container startet vor dem postdeploy-Hook),
// rechnen wir ohne ausgebuchte Reste weiter statt den ganzen Aufruf zu kippen.
function tableMissing(err) {
  const msg = String(err?.message || "");
  return /does not exist|schema cache|Could not find the table/i.test(msg) || err?.code === "42P01" || err?.code === "PGRST205";
}

async function loadRows(supabase, { table, col, ids, cols, tenantId }) {
  const out = [];
  const uniq = Array.from(new Set((ids || []).filter(x => x !== null && x !== undefined)));
  for (let i = 0; i < uniq.length; i += CHUNK) {
    let q = supabase.from(table).select(cols).in(col, uniq.slice(i, i + CHUNK));
    if (tenantId != null) q = q.eq("TENANT_ID", tenantId);
    const { data, error } = await q;
    if (error) {
      if (table === "RECEIVABLE_ADJUSTMENT" && tableMissing(error)) return [];
      throw new Error(error.message);
    }
    out.push(...(data || []));
  }
  return out;
}

/**
 * Zahlungen und ausgebuchte Reste je Beleg, gebuendelt geladen.
 * @returns {Promise<{ payments: Map<string, {gross:number,date:string|null}[]>, adjustments: Map<string, object[]> }>}
 */
async function loadMovements(supabase, { kind, ids, tenantId = null }) {
  const col = kind === "INVOICE" ? "INVOICE_ID" : "ADVANCE_INVOICE_ID";
  const [pays, adjs] = await Promise.all([
    loadRows(supabase, { table: "PAYMENT", col, ids, cols: `${col}, AMOUNT_PAYED_GROSS, PAYMENT_DATE`, tenantId }),
    loadRows(supabase, {
      table: "RECEIVABLE_ADJUSTMENT", col, ids, tenantId,
      cols: `ID, ${col}, AMOUNT_GROSS, AMOUNT_NET, AMOUNT_VAT, REBILLABLE, REASON, ADJUSTMENT_DATE`,
    }),
  ]);
  const payments = new Map();
  for (const p of pays) {
    const k = String(p[col]);
    if (!payments.has(k)) payments.set(k, []);
    payments.get(k).push({ gross: toNum(p.AMOUNT_PAYED_GROSS), date: p.PAYMENT_DATE ?? null });
  }
  const adjustments = new Map();
  for (const a of adjs) {
    const k = String(a[col]);
    if (!adjustments.has(k)) adjustments.set(k, []);
    adjustments.get(k).push({ ...a, gross: toNum(a.AMOUNT_GROSS) });
  }
  return { payments, adjustments };
}

/**
 * Offener Betrag fuer eine Liste von Belegen einer Art.
 * @param {object[]} docs  Zeilen mit ID und CLAIM_COLS[kind]
 * @returns {Promise<Map<string, ReturnType<typeof computeOpen> & { claim: ReturnType<typeof claimOf> }>>}
 */
async function openAmountsFor(supabase, { kind, docs, tenantId = null }) {
  const list = Array.isArray(docs) ? docs : [];
  const ids = list.map(d => d.ID);
  const [{ payments, adjustments }, absorbed, corrections] = await Promise.all([
    loadMovements(supabase, { kind, ids, tenantId }),
    kind === "ADVANCE_INVOICE" ? loadAbsorbed(supabase, { ids, tenantId }) : Promise.resolve(new Map()),
    loadCorrections(supabase, { kind, ids, tenantId }),
  ]);
  const out = new Map();
  for (const d of list) {
    const k = String(d.ID);
    const claim = claimOf(d, kind);
    const pays = payments.get(k) || [];
    const adjs = adjustments.get(k) || [];
    out.set(k, {
      claim, payments: pays, adjustments: adjs,
      ...computeOpen(claim, {
        payments: pays, adjustments: adjs, absorbedBy: absorbed.get(k) ?? null,
        corrected: corrections.get(k) || 0,
        isCorrection: kind === "INVOICE" && d.INVOICE_TYPE === "gutschrift",
      }),
    });
  }
  return out;
}

/**
 * Gebuchte Rechnungskorrekturen je Original (Migration 0179), als Betrag
 * (brutto, positiv). Tolerant wie loadAbsorbed: fehlt die Spalte, keine.
 */
async function loadCorrections(supabase, { kind, ids, tenantId }) {
  const out = new Map();
  const ref = kind === "INVOICE" ? "CORRECTS_INVOICE_ID" : "CORRECTS_ADVANCE_INVOICE_ID";
  const uniq = Array.from(new Set((ids || []).filter(x => x !== null && x !== undefined)));
  for (let i = 0; i < uniq.length; i += CHUNK) {
    let q = supabase.from("INVOICE").select(`${ref}, TOTAL_AMOUNT_GROSS`).in(ref, uniq.slice(i, i + CHUNK)).eq("STATUS_ID", 2);
    if (tenantId != null) q = q.eq("TENANT_ID", tenantId);
    const { data, error } = await q;
    if (error) {
      if (/CORRECTS_|schema cache|does not exist/i.test(String(error.message || ""))) return out;
      throw new Error(error.message);
    }
    for (const r of data || []) {
      const k = String(r[ref]);
      out.set(k, round2((out.get(k) || 0) + Math.abs(toNum(r.TOTAL_AMOUNT_GROSS))));
    }
  }
  return out;
}

/**
 * ABSORBED_BY_INVOICE_ID je Abschlagsrechnung (Migration 0178). Bewusst eine
 * eigene Abfrage statt einer Spalte in CLAIM_COLS: der Web-Container startet
 * vor dem postdeploy-Hook, und eine unbekannte Spalte in der Listenabfrage
 * haette Rechnungsliste und Mahnwesen bis zum Ende der Migration lahmgelegt.
 */
async function loadAbsorbed(supabase, { ids, tenantId }) {
  const out = new Map();
  const uniq = Array.from(new Set((ids || []).filter(x => x !== null && x !== undefined)));
  for (let i = 0; i < uniq.length; i += CHUNK) {
    let q = supabase.from("ADVANCE_INVOICE").select("ID, ABSORBED_BY_INVOICE_ID").in("ID", uniq.slice(i, i + CHUNK));
    if (tenantId != null) q = q.eq("TENANT_ID", tenantId);
    const { data, error } = await q;
    if (error) {
      if (/ABSORBED_BY_INVOICE_ID|schema cache|does not exist/i.test(String(error.message || ""))) return out;
      throw new Error(error.message);
    }
    for (const r of data || []) if (r.ABSORBED_BY_INVOICE_ID != null) out.set(String(r.ID), r.ABSORBED_BY_INVOICE_ID);
  }
  return out;
}

module.exports = {
  CLAIM_COLS,
  withClaimCols,
  claimOf,
  computeOpen,
  effectiveVatPercent,
  loadMovements,
  openAmountsFor,
  round2,
  toNum,
  TOL,
};
