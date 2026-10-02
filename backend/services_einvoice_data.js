'use strict';

/**
 * services_einvoice_data.js
 *
 * Loads and normalises all invoice data into a single InvoiceData object
 * consumed by both the CII (ZUGFeRD/Factur-X) and UBL (XRechnung) renderers.
 */

const codelists = require('./einvoice/codelists');
const { paymentMeansForEinvoice } = require('./services/paymentMeans');
const { AR_COLS, deductionsFor } = require('./services/arDeduction');
const { discountsOf } = require('./services/documentDiscounts');

class InvoiceDataError extends Error {
  constructor(msg) { super(msg); this.name = 'InvoiceDataError'; this.status = 422; }
}

// Buchungsarten ohne Stundencharakter (Pauschalen/Stückleistungen) — solche
// Positionen werden in der E-Rechnung als Pauschalposition (LS) ausgewiesen,
// nicht als Stunden (HUR).
const EINVOICE_SPECIAL_KINDS = new Set(['UNIT', 'LUMP_COST', 'LUMP_REVENUE']);

// ── Helpers ───────────────────────────────────────────────────────────────────

function toNum(v) {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? ''));
  return Number.isFinite(n) ? n : 0;
}

function asIsoDate(v) {
  if (!v) return null;
  const m = String(v).match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : null;
}

function fmt2(n) {
  return Math.round(toNum(n) * 100) / 100;
}

// Erste nicht-leere Angabe gewinnen. Die Belege tragen die Stamm daten
// denormalisiert mit (COMPANY_*, EMPLOYEE_*, ADDRESS_*); ist so eine Spalte
// LEER statt NULL, sprang der frueher benutzte ??-Operator NICHT auf die
// Stammdaten zurueck -- er greift nur bei null/undefined. Ergebnis: ein
// Buero mit gepflegter IBAN erzeugte einen Beleg ohne Zahlungsinformationen.
// Seit N6/N7/N8 als Fehler pruefen, haette das die Rechnung sogar am Buchen
// gehindert. Fuer Textfelder heisst leer immer "nicht gesetzt".
function firstNonEmpty(...values) {
  for (const v of values) {
    const t = String(v ?? '').trim();
    if (t) return t;
  }
  return '';
}

function isCountryCode(v) {
  return /^[A-Z]{2}$/.test(String(v ?? '').trim());
}

function normalizeVatId(raw, countryCode) {
  const v = String(raw ?? '').trim();
  if (!v) return '';
  if (/^[A-Za-z]{2}/.test(v)) return v.toUpperCase();
  const cc = String(countryCode ?? '').trim().toUpperCase();
  return /^[A-Z]{2}$/.test(cc) ? `${cc}${v}` : v;
}

// ── DB helpers ────────────────────────────────────────────────────────────────

async function one(supabase, table, id, tenantId) {
  if (!id) return null;
  const q = supabase.from(table).select('*').eq('ID', id);
  if (tenantId) q.eq('TENANT_ID', tenantId);
  const { data } = await q.maybeSingle();
  return data ?? null;
}

async function lookupCountryCode(supabase, countryId) {
  if (!countryId) return 'DE';
  const { data } = await supabase.from('COUNTRY').select('ABBR').eq('ID', countryId).maybeSingle();
  return isCountryCode(data?.ABBR) ? data.ABBR : 'DE';
}

// ── Main export ───────────────────────────────────────────────────────────────

async function loadInvoiceData(supabase, docId, docType, tenantId) {
  const table = docType === 'INVOICE' ? 'INVOICE' : 'ADVANCE_INVOICE';
  const doc   = await one(supabase, table, docId, tenantId);
  if (!doc) throw new InvoiceDataError(`${table} ${docId} not found.`);

  // Eigene Textbloecke aus dem Aufbau des Belegs (Vorlagen-Plan Stufe 3) gehen
  // als Hinweise (BT-22) mit — dieselben Texte, die auch im PDF stehen. Soft-
  // fail: ohne sie bleibt die E-Rechnung gueltig, nur ohne diese Hinweise.
  let layoutNotes = [];
  try {
    layoutNotes = await require('./services_pdf_render').layoutTextNotes({ supabase, tenantId, docType, docId });
  } catch (e) {
    console.warn('[EINVOICE][LAYOUT_NOTES]', { docType, docId, error: e?.message || String(e) });
  }

  // Branch 9: Anlagen laden (soft-fail wenn Tabelle/Datei fehlt)
  let attachments = [];
  try {
    const attSvc = require('./services/attachments');
    attachments = await attSvc.loadAttachmentsForXml(supabase, { docType, docId, tenantId });
  } catch (e) {
    // Migration 0060 evtl. noch nicht gelaufen -- nur loggen, nicht abbrechen
    if (!String(e?.message || '').includes('does not exist')) {
      console.warn('[loadInvoiceData][attachments]', e?.message);
    }
  }

  // ── 1. Document type & TypeCodes ──────────────────────────────────────────

  const isInvoice  = docType === 'INVOICE';
  const isStornoPP = docType === 'ADVANCE_INVOICE' && !!doc.CANCELS_ADVANCE_INVOICE_ID;
  const invoiceType = isInvoice
    ? (doc.INVOICE_TYPE || 'rechnung')
    : (isStornoPP ? 'stornorechnung' : 'partial_payment');

  const isFinal  = invoiceType === 'schlussrechnung' || invoiceType === 'teilschlussrechnung';
  const isStorno = invoiceType === 'stornorechnung';
  // Rechnungskorrektur (Migration 0179): mindert eine gebuchte Rechnung, mit
  // Bezug auf sie (BT-25). Betraege stehen negativ gespeichert, wie beim Storno.
  const isCorrection = invoiceType === 'gutschrift';

  const number  = isInvoice ? doc.INVOICE_NUMBER        : doc.ADVANCE_INVOICE_NUMBER;
  const docDate = isInvoice ? doc.INVOICE_DATE          : doc.ADVANCE_INVOICE_DATE;
  const addressIdField = isInvoice ? 'INVOICE_ADDRESS_ID'      : 'ADVANCE_INVOICE_ADDRESS_ID';

  // BT-3. Die Belegart ist eine fachliche Entscheidung, der Codeunterschied
  // zwischen den Syntaxen eine Eigenschaft der Norm. Beides stand hier bis
  // 09/2026 als ZWEI Ternaer-Kaskaden nebeneinander -- wer eine Belegart
  // ergaenzte, musste an beide denken, und niemand konnte sehen, welcher Code
  // welche Bedeutung hat. Jetzt: eine Funktion, eine Codeliste (UNTDID 1001,
  // siehe einvoice/codelists.js und docs/EINVOICE_BT_MAPPING.md).
  const typeCodeArgs = { docType, invoiceType, isCancellation: isStorno || isStornoPP };
  const typeCodeCii = codelists.documentTypeCode({ ...typeCodeArgs, syntax: 'CII' });
  const typeCodeUbl = codelists.documentTypeCode({ ...typeCodeArgs, syntax: 'UBL' });

  // ── 2. Seller (COMPANY) ───────────────────────────────────────────────────

  const company = await one(supabase, 'COMPANY', doc.COMPANY_ID, tenantId);

  let sellerCountry = null;
  if (company?.COUNTRY_ID) {
    sellerCountry = await lookupCountryCode(supabase, company.COUNTRY_ID);
  }
  if (!isCountryCode(sellerCountry)) sellerCountry = 'DE';

  // COMPANY_TAX-ID = Umsatzsteuer-ID (VA scheme, e.g. DE123456789)
  const sellerVatId = normalizeVatId(doc['COMPANY_TAX-ID'] ?? '', sellerCountry);
  // COMPANY_TAX_NUMBER = Steuernummer (FC scheme, e.g. 78910/12345)
  const sellerTaxId = String(doc.COMPANY_TAX_NUMBER ?? '').trim();

  // BT-81/82: bis 09/2026 war der Code fest verdrahtet. Jetzt kommt er aus
  // PAYMENT_MEANS — mit demselben Wert als Rueckfall, damit Belege ohne
  // Zuordnung unveraendert bleiben.
  const paymentMeans = await paymentMeansForEinvoice(supabase, doc.PAYMENT_MEANS_ID);

  const sellerIban        = firstNonEmpty(doc.COMPANY_IBAN, company?.IBAN);
  const sellerBic         = firstNonEmpty(doc.COMPANY_BIC, company?.BIC);
  const sellerCreditorId  = String(doc['COMPANY_CREDITOR-ID']                        ?? '').trim();
  const sellerPostOffBox  = String(doc.COMPANY_POST_OFFICE_BOX                       ?? '').trim();

  // Branch 11: Peppol-Endpoint (Verkauefer aus COMPANY)
  const sellerPeppolEndpointId = String(company?.PEPPOL_ENDPOINT_ID ?? '').trim();
  const sellerPeppolSchemeId   = String(company?.PEPPOL_SCHEME_ID   ?? '').trim();

  // ── 3. Seller contact (EMPLOYEE) ─────────────────────────────────────────

  const employee = await one(supabase, 'EMPLOYEE', doc.EMPLOYEE_ID, tenantId);
  const contactName  = String(doc.EMPLOYEE ?? '').trim()
    || [employee?.FIRST_NAME, employee?.LAST_NAME].filter(Boolean).join(' ')
    || String(employee?.ABBR ?? '').trim();
  const contactPhone = firstNonEmpty(doc.EMPLOYEE_PHONE, employee?.MOBILE, employee?.PHONE);
  const contactEmail = firstNonEmpty(doc.EMPLOYEE_MAIL, employee?.MAIL);

  // ── 4. Buyer (ADDRESS) ────────────────────────────────────────────────────

  const address = await one(supabase, 'ADDRESS', doc[addressIdField], tenantId);

  const buyerName = firstNonEmpty(
    doc.ADDRESS_NAME_1, address?.ADDRESS_NAME_1, doc.ADDRESS_NAME_2, address?.ADDRESS_NAME_2
  );
  if (!buyerName) throw new InvoiceDataError('Käufername (BT-44) fehlt. Bitte Rechnungsadresse prüfen.');

  let buyerCountry = doc.ADDRESS_COUNTRY ?? null;
  if (!isCountryCode(buyerCountry) && address?.COUNTRY_ID) {
    buyerCountry = await lookupCountryCode(supabase, address.COUNTRY_ID);
  }
  if (!isCountryCode(buyerCountry)) buyerCountry = 'DE';

  const buyerVatId         = normalizeVatId(firstNonEmpty(doc.ADDRESS_VAT_ID, address?.VAT_ID), buyerCountry);
  const buyerDebitorNumber = firstNonEmpty(doc.ADDRESS_DEBITOR_NUMBER, address?.DEBITOR_NUMBER);

  // Branch 11: Peppol-Endpoint (Kaeufer aus ADDRESS)
  const buyerPeppolEndpointId = String(address?.PEPPOL_ENDPOINT_ID ?? '').trim();
  const buyerPeppolSchemeId   = String(address?.PEPPOL_SCHEME_ID   ?? '').trim();

  // ── 5. Currency ───────────────────────────────────────────────────────────

  let currency = 'EUR';
  if (doc.CURRENCY_ID) {
    const cur = await one(supabase, 'CURRENCY', doc.CURRENCY_ID, null);
    if (cur?.ABBR) currency = cur.ABBR;
  }

  // ── 6. VAT ────────────────────────────────────────────────────────────────

  const vatPercent = toNum(doc.VAT_PERCENT ?? 0);
  // BT-118 — VAT-Category aus der DB (Branch 2). Ist die Spalte leer oder
  // unbekannt, entscheidet der Steuersatz: > 0 -> 'S', sonst 'Z'. Bei
  // Reverse-Charge, Steuerbefreiung oder Kleinunternehmerregelung setzt der
  // Nutzer bewusst 'AE'/'E'/'O'/'G'/'K'.
  //
  // Zulaessige Werte und Standardtexte kommen aus der Codeliste
  // UNTDID 5305 (einvoice/codelists.js) -- dieselbe Quelle, aus der auch der
  // Validator seine Regeln je Kategorie zieht. Vorher lag die Liste hier, die
  // Standardtexte ebenfalls hier und die Regeln im Validator: drei Orte fuer
  // eine Aussage, und die Kategorien G und K waren in einem davon vergessen
  // worden (Befund R7).
  const vatCategory = codelists.normalizeVatCategory(doc.VAT_CATEGORY, vatPercent);
  // BT-121 Befreiungsgrund-Code (vom Nutzer gepflegt), BT-120 der Text dazu.
  const vatExemptionReasonCode = String(doc.VAT_EXEMPTION_REASON_CODE ?? '').trim() || null;
  const vatExemptionReasonText = String(doc.VAT_EXEMPTION_REASON_TEXT ?? '').trim()
    || codelists.defaultExemptionReason(vatCategory);
  // Bei jeder Kategorie ausser S ist der gesetzliche Steuersatz 0.
  const effectiveVatPercent = (vatCategory === 'S') ? vatPercent : 0;

  // ── 7. Document-level allowances (Skonto-unabhängige Nachlässe) ───────────

  // Nachlass I/II wie auf dem PDF (services/documentDiscounts.js). Bis 10/2026
  // las diese Stelle nur die Betragsspalten DISCOUNT_1/2, die kein Code
  // schreibt: das XML nannte keinen Nachlass und forderte den Betrag davor.
  const discounts  = discountsOf(doc);
  const allowances = discounts.steps.map((s) => ({
    reason:     s.reason,
    percent:    s.percent,
    amount:     fmt2(s.amount),
    baseAmount: fmt2(s.baseAmount),
  }));

  // ── 8. Cash discount (Skonto) ─────────────────────────────────────────────

  const cashDiscount = toNum(doc.CASH_DISCOUNT_PERCENT) > 0 ? {
    percent: toNum(doc.CASH_DISCOUNT_PERCENT),
    days:    toNum(doc.CASH_DISCOUNT_DAYS),
    amount:  fmt2(doc.CASH_DISCOUNT),
  } : null;

  // R2: BT-20 wird einmal hier gebildet, nicht zweimal in den Buildern.
  // Vorher schrieb UBL die KoSIT-Konvention (#SKONTO#TAGE=..#PROZENT=..#) und
  // CII nur einen strukturierten Block ohne Text -- wer das Hybrid-PDF bekam,
  // sah das Skonto nur im Fliesstext, wer das UBL bekam, sah es maschinen-
  // lesbar. Dieselbe Rechnung, zwei Aussagen. Beide Builder lesen jetzt
  // diesen einen Wert.
  //
  // Skonto nur zusammen mit einem Faelligkeitsdatum -- ohne Bezugspunkt ist
  // eine Skontofrist sinnlos (CII-SR-408 verlangt es ausserdem).
  const paymentTermsNote = (() => {
    const basis = doc.DUE_DATE && asIsoDate(doc.DUE_DATE)
      ? `Zahlbar bis ${asIsoDate(doc.DUE_DATE)}`
      : 'Zahlbar sofort netto';
    if (!cashDiscount || !doc.DUE_DATE) return basis;
    const tage    = Math.round(cashDiscount.days);
    const prozent = cashDiscount.percent.toFixed(2);
    return `#SKONTO#TAGE=${tage}#PROZENT=${prozent}#
${basis}`;
  })();

  // ── 9. Canceled document reference (Storno) ───────────────────────────────

  let canceledDocNumber = null;
  let canceledDocDate   = null;
  let canceledOrig      = null;   // das stornierte Original (fuer Abzuege einer Schlussrechnung)
  let replacesLabel     = null;   // neu ausgestellt: Art der ersetzten Rechnung (PDF-Hinweis)
  if (isStorno && isInvoice && doc.CANCELS_INVOICE_ID) {
    const orig = await one(supabase, 'INVOICE', doc.CANCELS_INVOICE_ID, tenantId);
    canceledOrig      = orig;
    canceledDocNumber = orig?.INVOICE_NUMBER ?? String(doc.CANCELS_INVOICE_ID);
    canceledDocDate   = asIsoDate(orig?.INVOICE_DATE);
  } else if (isStornoPP) {
    const orig = await one(supabase, 'ADVANCE_INVOICE', doc.CANCELS_ADVANCE_INVOICE_ID, tenantId);
    canceledDocNumber = orig?.ADVANCE_INVOICE_NUMBER ?? String(doc.CANCELS_ADVANCE_INVOICE_ID);
    canceledDocDate   = asIsoDate(orig?.ADVANCE_INVOICE_DATE);
  } else if (isCorrection && (doc.CORRECTS_INVOICE_ID || doc.CORRECTS_ADVANCE_INVOICE_ID)) {
    // Rechnungskorrektur: derselbe Verweis (BT-25) auf das korrigierte Original.
    const isInv = !!doc.CORRECTS_INVOICE_ID;
    const orig  = await one(supabase, isInv ? 'INVOICE' : 'ADVANCE_INVOICE', isInv ? doc.CORRECTS_INVOICE_ID : doc.CORRECTS_ADVANCE_INVOICE_ID, tenantId);
    canceledDocNumber = (isInv ? orig?.INVOICE_NUMBER : orig?.ADVANCE_INVOICE_NUMBER)
      ?? String(isInv ? doc.CORRECTS_INVOICE_ID : doc.CORRECTS_ADVANCE_INVOICE_ID);
    canceledDocDate   = asIsoDate(isInv ? orig?.INVOICE_DATE : orig?.ADVANCE_INVOICE_DATE);
  } else if (isInvoice ? doc.REPLACES_INVOICE_ID : doc.REPLACES_ADVANCE_INVOICE_ID) {
    // Neu ausgestellt (Migration 0180): Verweis (BT-25) auf die stornierte
    // Rechnung, die dieser Beleg ersetzt — der Empfaenger ordnet so zu.
    const replacedId = isInvoice ? doc.REPLACES_INVOICE_ID : doc.REPLACES_ADVANCE_INVOICE_ID;
    const orig = await one(supabase, isInvoice ? 'INVOICE' : 'ADVANCE_INVOICE', replacedId, tenantId);
    canceledDocNumber = (isInvoice ? orig?.INVOICE_NUMBER : orig?.ADVANCE_INVOICE_NUMBER) ?? String(replacedId);
    canceledDocDate   = asIsoDate(isInvoice ? orig?.INVOICE_DATE : orig?.ADVANCE_INVOICE_DATE);
    replacesLabel     = isInvoice ? 'Rechnung' : 'Abschlagsrechnung';
  }

  // ── 10. Line items ────────────────────────────────────────────────────────

  let lines = [];

  if (isInvoice) {
    const { data: invStructures } = await supabase
      .from('INVOICE_STRUCTURE')
      .select('STRUCTURE_ID, AMOUNT_NET, AMOUNT_EXTRAS_NET')
      .eq('INVOICE_ID', docId)
      .eq('TENANT_ID', tenantId);

    if (invStructures && invStructures.length > 0) {
      const structIds = invStructures.map(r => r.STRUCTURE_ID);
      const { data: projStructures } = await supabase
        .from('PROJECT_STRUCTURE')
        .select('ID, ABBR, NAME, BILLING_TYPE_ID')
        .in('ID', structIds);

      const nameMap = Object.fromEntries((projStructures ?? []).map(r => [r.ID, r]));

      // Branch 3 — Stundenrechnungen: BOOKING-Zeilen je BT2-Struktur
      // aggregieren (Summe Stunden). Daraus kann eine Rechnungszeile mit
      // unitCode='HUR' und reellem Stundensatz gebildet werden.
      const bt2StructIds = (projStructures || [])
        .filter(s => Number(s.BILLING_TYPE_ID) === 2)
        .map(s => s.ID);
      const tecAggByStructure = new Map();
      if (bt2StructIds.length > 0) {
        const { data: tecRows } = await supabase
          .from('BOOKING')
          .select('STRUCTURE_ID, QUANTITY_INT, HOURLY_RATE, HOURLY_RATE_TOTAL, BOOKING_KIND')
          .eq('INVOICE_ID', docId)
          .in('STRUCTURE_ID', bt2StructIds);
        for (const t of (tecRows || [])) {
          const sid = t.STRUCTURE_ID;
          const agg = tecAggByStructure.get(sid) || { hours: 0, totalNet: 0, distinctRates: new Set(), hasSpecial: false };
          agg.hours    += toNum(t.QUANTITY_INT);
          agg.totalNet += toNum(t.HOURLY_RATE_TOTAL);
          if (t.HOURLY_RATE != null) agg.distinctRates.add(Number(t.HOURLY_RATE));
          // Pauschalen/Stückleistungen (BOOKING_KIND ∈ UNIT/LUMP_*) sind keine
          // Stunden → eine HUR-Position wäre irreführend; solche Strukturen
          // werden als Pauschalposition (LS) ausgewiesen.
          if (EINVOICE_SPECIAL_KINDS.has(t.BOOKING_KIND)) agg.hasSpecial = true;
          tecAggByStructure.set(sid, agg);
        }
      }

      lines = invStructures.map((row, idx) => {
        const ps           = nameMap[row.STRUCTURE_ID] ?? {};
        const amountNet    = fmt2(row.AMOUNT_NET ?? 0);
        const amountExtras = fmt2(row.AMOUNT_EXTRAS_NET ?? 0);
        const lineTotal    = fmt2(amountNet + amountExtras);
        const desc = [ps.ABBR, ps.NAME].filter(Boolean).join(' – ') || `Position ${idx + 1}`;

        // Default Pauschal-Line
        let unitCode  = codelists.UNIT_LUMP_SUM;
        let quantity  = 1;
        let unitPrice = lineTotal;
        let note      = amountExtras > 0 ? `Honorar: ${amountNet} / Nebenkosten: ${amountExtras}` : '';

        // Stundenrechnung: wenn BT2 und Stunden gebucht
        const tecAgg = tecAggByStructure.get(row.STRUCTURE_ID);
        if (Number(ps.BILLING_TYPE_ID) === 2 && tecAgg && tecAgg.hours > 0 && !tecAgg.hasSpecial) {
          const hours = fmt2(tecAgg.hours);
          unitCode  = codelists.UNIT_HOUR;
          quantity  = hours;
          unitPrice = fmt2(amountNet / hours);
          const rateText = tecAgg.distinctRates.size === 1
            ? `${fmt2([...tecAgg.distinctRates][0])} €/h`
            : `Ø ${unitPrice} €/h (gemischte Saetze)`;
          note = amountExtras > 0
            ? `${hours} Std. (${rateText}) + Nebenkosten: ${amountExtras}`
            : `${hours} Std. (${rateText})`;
        }

        return {
          id:          idx + 1,
          description: desc,
          note,
          quantity,
          unitCode,
          unitPrice,
          lineTotal,
          vatRate:     effectiveVatPercent,
          vatCategory,
          billingPeriodStart: asIsoDate(doc.BILLING_PERIOD_START),
          billingPeriodEnd:   asIsoDate(doc.BILLING_PERIOD_FINISH),
        };
      });
    }
  }

  if (lines.length === 0) {
    const amountNet    = fmt2(doc.AMOUNT_NET ?? 0);
    const amountExtras = fmt2(doc.AMOUNT_EXTRAS_NET ?? 0);
    const lineTotal    = fmt2(amountNet + amountExtras);
    const label = docType === 'ADVANCE_INVOICE' ? 'Abschlagsrechnung' : 'Rechnung';

    // Branch 3 — Stundenrechnungen: wenn BOOKING-Stunden mit diesem Dokument
    // verknuepft sind und deren HOURLY_RATE_TOTAL-Summe (== Stunden-Anteil am Net)
    // dem amountNet entspricht, dann Unit=HUR statt LS.
    let unitCode  = codelists.UNIT_LUMP_SUM;
    let quantity  = 1;
    let unitPrice = lineTotal;
    let note      = amountExtras > 0 ? `Honorar: ${amountNet} / Nebenkosten: ${amountExtras}` : '';

    try {
      const tecFilter = docType === 'ADVANCE_INVOICE'
        ? { col: 'ADVANCE_INVOICE_ID', val: docId }
        : { col: 'INVOICE_ID',          val: docId };
      const { data: tecRows } = await supabase
        .from('BOOKING')
        .select('QUANTITY_INT, HOURLY_RATE, HOURLY_RATE_TOTAL, BOOKING_KIND')
        .eq(tecFilter.col, tecFilter.val);
      if (tecRows && tecRows.length > 0) {
        let hours = 0, totalNetTec = 0, hasSpecial = false;
        const distinctRates = new Set();
        for (const t of tecRows) {
          hours       += toNum(t.QUANTITY_INT);
          totalNetTec += toNum(t.HOURLY_RATE_TOTAL);
          if (t.HOURLY_RATE != null) distinctRates.add(Number(t.HOURLY_RATE));
          if (EINVOICE_SPECIAL_KINDS.has(t.BOOKING_KIND)) hasSpecial = true;
        }
        // Akzeptanz: reine Stunden (keine Pauschalen/Stück) und BOOKING-Summe deckt amountNet.
        if (hours > 0 && !hasSpecial && Math.abs(fmt2(totalNetTec) - amountNet) <= 0.01) {
          const h = fmt2(hours);
          unitCode  = codelists.UNIT_HOUR;
          quantity  = h;
          unitPrice = fmt2(amountNet / h);
          const rateText = distinctRates.size === 1
            ? `${fmt2([...distinctRates][0])} €/h`
            : `Ø ${unitPrice} €/h (gemischte Saetze)`;
          note = amountExtras > 0
            ? `${h} Std. (${rateText}) + Nebenkosten: ${amountExtras}`
            : `${h} Std. (${rateText})`;
        }
      }
    } catch (_) { /* BOOKING fehlt -> Pauschal-Fallback */ }

    lines.push({
      id: 1, description: label,
      note,
      quantity, unitCode, unitPrice, lineTotal,
      vatRate: effectiveVatPercent, vatCategory,
      billingPeriodStart: asIsoDate(doc.BILLING_PERIOD_START),
      billingPeriodEnd:   asIsoDate(doc.BILLING_PERIOD_FINISH),
    });
  }

  // ── 11. Deductions (Schlussrechnung only) ─────────────────────────────────
  //
  // Die Schlussrechnung ist eine Restrechnung (UStAE 14.8 Abs. 11): abgesetzt
  // werden die vereinnahmten Teilentgelte (services/arDeduction.js), und
  // gespeichert ist genau der Rest — TOTAL_AMOUNT_NET = Positionen minus
  // Abzuege (finalInvoices.recomputeTotal). Im XML stehen die Abzuege deshalb
  // als Positionen mit negativer Menge (BR-27 verbietet den negativen
  // Einzelpreis, wie beim Storno), und BT-113 „bereits bezahlt" bleibt 0.
  //
  // Vorher: volle Positionen, BT-109 = Rest UND BT-113 = Abschlaege. Das
  // verletzte BR-CO-13 (Buchen nur mit „trotzdem buchen") und zog die
  // Abschlaege im Zahlbetrag ein zweites Mal ab — bei 100.000 € Honorar und
  // 30.000 € Abschlag forderte das XML 47.600 statt 83.300 €. Der Test dazu
  // hatte TOTAL_AMOUNT_NET mit dem vollen Honorar angelegt, also anders, als
  // die Anwendung speichert.

  let deductions = [];
  let deductedArIds = new Set();
  if (isFinal) {
    const { data: dedRows } = await supabase
      .from('INVOICE_DEDUCTION')
      .select('DEDUCTION_AMOUNT_NET, ADVANCE_INVOICE_ID')
      .eq('INVOICE_ID', docId)
      .eq('TENANT_ID', tenantId);

    if (dedRows && dedRows.length > 0) {
      const ppIds = dedRows.map(r => r.ADVANCE_INVOICE_ID);
      deductedArIds = new Set(ppIds.map(String));
      const { data: partials } = await supabase
        .from('ADVANCE_INVOICE')
        .select(AR_COLS)
        .in('ID', ppIds);
      const ppMap = Object.fromEntries((partials ?? []).map(p => [p.ID, p]));
      const stand = await deductionsFor(supabase, { ars: partials ?? [], tenantId });

      deductions = dedRows.map(d => {
        const pp  = ppMap[d.ADVANCE_INVOICE_ID] ?? {};
        const s   = stand.get(String(d.ADVANCE_INVOICE_ID)) ?? {};
        const net = fmt2(d.DEDUCTION_AMOUNT_NET ?? 0);
        const vat = fmt2(net * effectiveVatPercent / 100);
        return {
          arId:           d.ADVANCE_INVOICE_ID,
          number:         pp.ADVANCE_INVOICE_NUMBER ?? String(d.ADVANCE_INVOICE_ID),
          date:           asIsoDate(pp.ADVANCE_INVOICE_DATE),
          netAmount:      net,                      // abgesetzt (netto)
          vatAmount:      vat,
          grossAmount:    fmt2(net + vat),          // abgesetzt (brutto)
          billedGross:    fmt2(s.billedGross ?? pp.TOTAL_AMOUNT_GROSS ?? 0),  // fakturiert
          paidAmount:     fmt2(s.paidGross ?? 0),   // davon vereinnahmt
          retainedAmount: fmt2(s.seHeld ?? pp.SE_AMOUNT ?? 0),
          minderungGross: fmt2(s.minderungGross ?? 0),
          // Einbehalt + offener Rest + wieder abrechenbar: in dieser Rechnung enthalten
          includedGross:  fmt2(s.includedGross ?? 0),
        };
      });

      for (const d of deductions) {
        if (!(d.netAmount > 0.005)) continue;   // nichts gezahlt: nichts abzusetzen
        lines.push({
          id:          lines.length + 1,
          description: `Abzug Abschlagsrechnung ${d.number}${d.date ? ` vom ${d.date}` : ''}`,
          note:        d.includedGross > 0.005
            ? `Vereinnahmt abgesetzt; noch offen und in dieser Rechnung enthalten: ${d.includedGross} EUR brutto`
            : 'Vereinnahmt abgesetzt',
          quantity:    -1,
          unitCode:    codelists.UNIT_LUMP_SUM,
          unitPrice:   d.netAmount,
          lineTotal:   -d.netAmount,
          vatRate:     effectiveVatPercent,
          vatCategory,
          billingPeriodStart: asIsoDate(doc.BILLING_PERIOD_START),
          billingPeriodEnd:   asIsoDate(doc.BILLING_PERIOD_FINISH),
        });
      }
    }
  }

  // ── 11b. Storno einer Schlussrechnung: Abzuege zuruecknehmen ─────────────
  // Der Storno kopiert die Positionen des Originals negativ (volles Honorar),
  // gespeichert ist aber der negative REST (Honorar minus Abzuege). Ohne die
  // Ruecknahme-Positionen passten Positionssumme und Gesamtbetrag nicht
  // zusammen (BR-CO-13).
  if (isStorno && canceledOrig
      && (canceledOrig.INVOICE_TYPE === 'schlussrechnung' || canceledOrig.INVOICE_TYPE === 'teilschlussrechnung')) {
    const { data: origDed } = await supabase
      .from('INVOICE_DEDUCTION')
      .select('DEDUCTION_AMOUNT_NET, ADVANCE_INVOICE_ID')
      .eq('INVOICE_ID', canceledOrig.ID)
      .eq('TENANT_ID', tenantId);
    const arIds = (origDed || []).map(r => r.ADVANCE_INVOICE_ID);
    const { data: ars } = arIds.length
      ? await supabase.from('ADVANCE_INVOICE').select('ID, ADVANCE_INVOICE_NUMBER').in('ID', arIds)
      : { data: [] };
    const nr = Object.fromEntries((ars || []).map(a => [a.ID, a.ADVANCE_INVOICE_NUMBER]));
    for (const d of origDed || []) {
      const net = fmt2(d.DEDUCTION_AMOUNT_NET ?? 0);
      if (!(net > 0.005)) continue;
      lines.push({
        id: lines.length + 1,
        description: `Rücknahme Abzug Abschlagsrechnung ${nr[d.ADVANCE_INVOICE_ID] ?? d.ADVANCE_INVOICE_ID}`,
        note: '',
        quantity: 1, unitCode: codelists.UNIT_LUMP_SUM, unitPrice: net, lineTotal: net,
        vatRate: effectiveVatPercent, vatCategory,
        billingPeriodStart: asIsoDate(doc.BILLING_PERIOD_START),
        billingPeriodEnd:   asIsoDate(doc.BILLING_PERIOD_FINISH),
      });
    }
  }

  // ── 12. Monetary totals ───────────────────────────────────────────────────

  const lineTotal      = fmt2(lines.reduce((s, l) => s + l.lineTotal, 0));
  const allowanceTotal = fmt2(allowances.reduce((s, a) => s + a.amount, 0));
  const chargeTotal    = 0;

  // Use stored totals from the document (authoritative, handles all edge cases).
  // Bei Reverse-Charge / Steuerbefreit (Kategorie != 'S') wird kein
  // Steuerbetrag ausgewiesen — auch wenn die DB-Spalte aus Altdaten noch
  // einen Wert haelt, ueberschreiben wir mit 0.
  // R9: frueher stand hier "toNum(x) || berechnet". Ein gespeicherter Wert 0
  // ist falsy und wurde damit durch die Berechnung ersetzt — bei einer
  // Nullrechnung oder bewusst auf 0 gesetzter Steuer wich das XML von der
  // Buchhaltung ab. toNum(null) ist ebenfalls 0, deshalb entscheidet die
  // Rohspalte: NULL heisst "nicht gerechnet", 0 heisst "wirklich null".
  const stored = (v) => (v !== null && v !== undefined && v !== '' ? fmt2(toNum(v)) : null);
  //
  // Nachlass: gespeichert sind Netto, Steuer und Brutto VOR Nachlass. Mit
  // Nachlass gilt deshalb der Rechenweg des PDFs — Steuer auf das Netto nach
  // Nachlass (BR-CO-13: BT-109 = BT-106 − BT-107).
  const hasAllowances = allowances.length > 0;
  const taxBasis   = hasAllowances
    ? fmt2((stored(doc.TOTAL_AMOUNT_NET) ?? lineTotal) - allowanceTotal)
    : (stored(doc.TOTAL_AMOUNT_NET) ?? fmt2(lineTotal - allowanceTotal));
  const taxAmount  = vatCategory !== 'S' ? 0
    : hasAllowances ? fmt2(taxBasis * vatPercent / 100)
    : (stored(doc.TAX_AMOUNT_NET) ?? fmt2(taxBasis * vatPercent / 100));
  const grandTotal = vatCategory !== 'S' ? taxBasis
    : hasAllowances ? fmt2(taxBasis + taxAmount)
    : (stored(doc.TOTAL_AMOUNT_GROSS) ?? fmt2(taxBasis + taxAmount));

  // BT-113 — "Bezahlter Betrag". Die Schlussrechnung ist eine Restrechnung
  // (siehe Abschnitt 11): die vereinnahmten Abschlaege stehen als negative
  // Positionen darin und sind im Gesamtbetrag schon abgezogen. BT-113 wird
  // deshalb nicht noch einmal belegt — vorher zog es dieselben Abschlaege ein
  // zweites Mal ab.
  const prepaidGross = 0;

  // ── Sicherheitseinbehalt (Phase 4) ────────────────────────────────────────
  // SE held in THIS doc → reduces payable (customer pays less).
  // SE released by THIS doc → increases payable (customer pays more, gets prior SE back).
  // VAT is NOT affected — kept in PayableAmount only.
  const seHeldAmount    = toNum(doc.SE_AMOUNT ?? 0);
  const seHeldPercent   = toNum(doc.SE_PERCENT ?? 0);
  const seHeldBasis     = String(doc.SE_BASIS ?? '').trim() || null;   // 'BRUTTO' | 'NETTO'
  const seReleaseTotal  = toNum(doc.SE_RELEASE_TOTAL ?? 0);

  // Load released PARTIAL_PAYMENTs (Phase 2 link) for SE-release reason text
  let seReleaseRows = [];
  if (docType === 'INVOICE' && doc.ID) {
    try {
      const { data: rels } = await supabase
        .from('ADVANCE_INVOICE')
        .select('ID, ADVANCE_INVOICE_NUMBER, SE_AMOUNT')
        .eq('SE_RELEASED_BY_INVOICE_ID', doc.ID);
      // Einbehalte abgesetzter Abschlagsrechnungen stecken bereits im
      // Restentgelt (Abschnitt 11) — sie sind keine zusaetzliche Aufloesung.
      seReleaseRows = (rels || [])
        .filter(r => !deductedArIds.has(String(r.ID)))
        .map(r => ({
          number: r.ADVANCE_INVOICE_NUMBER || String(r.ID),
          amount: fmt2(toNum(r.SE_AMOUNT ?? 0)),
        }));
    } catch (_) { /* schema may lack column */ }
  }

  // Legal reference text from CONTRACT
  let seLegalReference = null;
  if ((seHeldAmount > 0 || seReleaseTotal > 0) && doc.CONTRACT_ID) {
    try {
      const { data: c } = await supabase
        .from('CONTRACT').select('SE_LEGAL_REFERENCE').eq('ID', doc.CONTRACT_ID).maybeSingle();
      seLegalReference = c?.SE_LEGAL_REFERENCE ?? null;
    } catch (_) { /* ignore */ }
  }

  const securityRetention = {
    held: {
      amount:  fmt2(seHeldAmount),
      percent: seHeldPercent,
      basis:   seHeldBasis,
    },
    release: {
      total:   fmt2(seReleaseTotal),
      rows:    seReleaseRows,
    },
    legalReference: seLegalReference,
    hasHeld:    seHeldAmount > 0,
    hasRelease: seReleaseTotal > 0,
  };

  // N10 — BT-115. Der Sicherheitseinbehalt wird hier NICHT mehr abgezogen.
  //
  // Die offizielle XRechnung-FAQ (XStandards Einkauf) ist dazu eindeutig:
  // "Sicherheitseinbehalte mindern den Forderungsbetrag einer Rechnung nicht
  // und zielen auf eine von der Rechnungsfaelligkeit unabhaengige Auszahlung
  // ab. In XRechnung koennen sie daher nicht als Nachlass auf Dokumenten-
  // (BG-20) oder Positionsebene ausgedrueckt werden." Eine eigene Abbildung
  // sieht das semantische Modell nicht vor; vorgesehen ist ein Hinweis mit
  // Betreffcode PMT (BT-21/BT-22) -- siehe buildSecurityRetentionNote.
  //
  // Vorher wurde der Einbehalt direkt vom Zahlbetrag abgezogen und die
  // Aufloesung wieder addiert. Beides verletzte BR-CO-16 (BT-115 muss
  // BT-112 - BT-113 sein), und zwar in beide Richtungen: solche Rechnungen
  // waren nur mit force=true buchbar.
  //
  // Der Einbehalt ist damit keine Groesse der Rechnung mehr, sondern eine
  // Zahlungsmodalitaet. Das PDF weist ihn weiterhin aus ("Rechnungssumme
  // brutto" gegen "Zahlungsbetrag") -- der Unterschied zu BT-115 ist gewollt.
  const duePayable   = fmt2(grandTotal - prepaidGross);

  const vatBreakdown = [{
    rate:        effectiveVatPercent,
    basis:       taxBasis,
    amount:      taxAmount,
    category:    vatCategory,
    exemptionReasonCode: vatExemptionReasonCode,
    exemptionReasonText: vatExemptionReasonText,
  }];

  // ── 13. Project / Contract references ────────────────────────────────────

  let projectNumber  = '';
  let contractNumber = '';
  if (doc.PROJECT_ID) {
    const proj = await one(supabase, 'PROJECT', doc.PROJECT_ID, tenantId);
    projectNumber = String(proj?.PROJECT_NUMBER ?? proj?.ABBR ?? '').trim();
  }
  if (doc.CONTRACT_ID) {
    const contract = await one(supabase, 'CONTRACT', doc.CONTRACT_ID, tenantId);
    contractNumber = String(contract?.CONTRACT_NUMBER ?? '').trim();
  }

  // ── 14. Assemble ─────────────────────────────────────────────────────────

  // Vorzeichen. Storno und Rechnungskorrektur (384) stehen NEGATIV
  // gespeichert — cancelInvoice/cancelPartialPayment, invoiceCorrection.js und
  // der Belegimport legen sie so an. Bis 09/2026 wurden sie hier trotzdem noch
  // einmal gespiegelt: das Storno-XML trug dadurch POSITIVE Summen (es
  // forderte den stornierten Betrag ein zweites Mal ein) und einen negativen
  // Einzelpreis, den Pruefportale nach BR-27 fatal abweisen — der eigene
  // Validator prueft BR-27 nicht, deshalb fiel es nicht auf.
  //
  // Jetzt gilt fuer jeden Beleg dieselbe Regel: Summen wie gespeichert; je
  // Position ist der Einzelpreis (BT-146) positiv und die Menge (BT-129)
  // traegt das Vorzeichen des Positionsbetrags. Das deckt auch die negativen
  // Abzugspositionen einer Schlussrechnung und die positiven
  // Ruecknahme-Positionen ihres Stornos ab.
  for (const l of lines) {
    const neg = toNum(l.lineTotal) < 0;
    l.unitPrice = Math.abs(toNum(l.unitPrice));
    l.quantity  = neg ? -Math.abs(toNum(l.quantity)) : Math.abs(toNum(l.quantity));
  }
  // Nachlaesse tragen schon das Vorzeichen des Belegs (documentDiscounts.js).
  const totalsOut = {
    lineTotal,
    allowanceTotal: fmt2(allowances.reduce((s, a) => s + a.amount, 0)),
    chargeTotal,
    taxBasis,
    taxAmount,
    grandTotal,
    prepaidGross,
    duePayable,
    prepaidAmount: prepaidGross,
  };

  return {
    docType,
    invoiceType,
    typeCodeCii,
    typeCodeUbl,
    typeCode: typeCodeUbl,  // legacy compat
    number:   number || String(docId),
    date:     asIsoDate(docDate) || asIsoDate(new Date().toISOString()),
    dueDate:  asIsoDate(doc.DUE_DATE),
    currency,
    comment:  String(doc.COMMENT ?? '').trim(),
    layoutNotes,
    billingPeriodStart: asIsoDate(doc.BILLING_PERIOD_START),
    billingPeriodEnd:   asIsoDate(doc.BILLING_PERIOD_FINISH),
    buyerReference: String(doc.BUYER_REFERENCE ?? doc.ADDRESS_REFERENCE_NUMBER ?? '').trim(),

    seller: {
      name:          firstNonEmpty(doc.COMPANY_NAME_1, company?.COMPANY_NAME_1),
      street:        firstNonEmpty(doc.COMPANY_STREET,    company?.STREET),
      city:          firstNonEmpty(doc.COMPANY_CITY,      company?.CITY),
      postCode:      firstNonEmpty(doc.COMPANY_POST_CODE, company?.POST_CODE),
      countryId:     sellerCountry,
      vatId:         sellerVatId,
      taxId:         sellerTaxId,
      iban:          sellerIban,
      bic:           sellerBic,
      creditorId:    sellerCreditorId,
      postOfficeBox: sellerPostOffBox,
      peppolEndpointId: sellerPeppolEndpointId,
      peppolSchemeId:   sellerPeppolSchemeId,
      contactName:   contactName,
      contactPhone:  contactPhone,
      contactEmail:  contactEmail,
      email:         contactEmail,
    },

    buyer: {
      name:               buyerName,
      peppolEndpointId:   buyerPeppolEndpointId,
      peppolSchemeId:     buyerPeppolSchemeId,
      street:        firstNonEmpty(doc.ADDRESS_STREET,    address?.STREET),
      city:          firstNonEmpty(doc.ADDRESS_CITY,      address?.CITY),
      postCode:      firstNonEmpty(doc.ADDRESS_POST_CODE, address?.POST_CODE),
      countryId:     buyerCountry,
      vatId:         buyerVatId,
      debitorNumber: buyerDebitorNumber,
      email:         String(doc.CONTACT_MAIL ?? '').trim(),
      // BT-56/57/58 Buyer Contact (Ansprechpartner beim Kaeufer)
      contactName:   String(doc.CONTACT       ?? '').trim(),
      contactPhone:  String(doc.CONTACT_PHONE ?? '').trim(),
      contactEmail:  String(doc.CONTACT_MAIL  ?? '').trim(),
    },

    lines,
    vatBreakdown,
    deductions,
    allowances,
    cashDiscount,
    paymentTermsNote,
    securityRetention,

    totals: totalsOut,

    canceledDocNumber,
    canceledDocDate,
    // Rechnungskorrektur: worauf sie sich bezieht und warum (steht auf dem PDF)
    correctsLabel:    isCorrection ? (doc.CORRECTS_ADVANCE_INVOICE_ID ? 'Abschlagsrechnung' : 'Rechnung') : null,
    correctionReason: isCorrection ? (String(doc.CORRECTION_REASON ?? '').trim() || null) : null,
    // Neu ausgestellt: ersetzt die stornierte Rechnung canceledDocNumber (steht auf dem PDF)
    replacesLabel,
    projectNumber,                                          // BT-11
    contractNumber,                                         // BT-12
    orderNumber:           String(doc.BUYER_ORDER_REFERENCE      ?? '').trim(), // BT-13
    buyerAccountingRef:    String(doc.BUYER_ACCOUNTING_REFERENCE ?? '').trim(), // BT-19
    remittanceInformation: String(doc.REMITTANCE_INFORMATION     ?? '').trim(), // BT-83
    paymentMeansCode: paymentMeans.code,                    // BT-81
    paymentMeansName: paymentMeans.name,                    // BT-82
    attachments,                                            // Branch 9: BG-24
  };
}

module.exports = { loadInvoiceData, InvoiceDataError };
