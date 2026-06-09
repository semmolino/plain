'use strict';

/**
 * services_einvoice_validator.js
 *
 * Validiert die InvoiceData (aus services_einvoice_data.js) gegen die
 * wichtigsten Business-Rules (BR-*) der EN 16931 / XRechnung 3.0.
 *
 * Warum eigene Engine statt Schematron?
 *   - Schematron-XSLT-Engine in Node ist eine schwere Abhaengigkeit
 *     (SaxonJS oder externer Java-Aufruf — nicht railway-tauglich).
 *   - Wir validieren direkt das interne JS-Datenobjekt -- viel schneller
 *     als XML zu generieren und zu reparsen.
 *   - Deutsche Fehlermeldungen, klar zuordenbare BT-Felder.
 *
 * Was wird NICHT geprueft:
 *   - Vollstaendige Codeliste-Compliance (z.B. ISO 4217 Currency, ISO 3166-1 Country)
 *     -- wir trauen unseren DB-Stammdaten.
 *   - Mehrwertsteuer-Mathematik bis auf 2 Nachkommastellen
 *     -- wir tolerieren +/- 0.01 EUR Rundungsdifferenz.
 *   - Strict XML-Schema-Validierung -- die uebernimmt der CII/UBL Builder.
 *
 * Returns:
 *   { ok: boolean, errors: ValidationIssue[], warnings: ValidationIssue[] }
 *
 *   ValidationIssue:
 *     { code: 'BR-02', severity: 'error'|'warning', message: string, btField: 'BT-1'|null }
 */

const VAT_CATEGORIES_ALLOWED = new Set(['S', 'AE', 'E', 'Z', 'O', 'G', 'K']);
const VAT_CATEGORIES_REQUIRE_REASON = new Set(['AE', 'E', 'Z', 'O', 'G', 'K']);
const ROUNDING_TOLERANCE = 0.02;   // EUR

function fmt2(n) { return Math.round(Number(n || 0) * 100) / 100; }
function abs(n) { return Math.abs(Number(n || 0)); }
function nonEmpty(s) { return typeof s === 'string' && s.trim().length > 0; }
function isPositive(n) { return Number.isFinite(Number(n)) && Number(n) > 0; }

function mkError(code, btField, message)   { return { code, severity: 'error',   message, btField }; }
function mkWarning(code, btField, message) { return { code, severity: 'warning', message, btField }; }

/**
 * Hauptvalidierung.
 *
 * @param {Object} data — InvoiceData wie von loadInvoiceData() zurueckgegeben
 * @param {Object} [opts]
 * @param {string} [opts.profile='EN16931']
 * @returns {{ ok: boolean, errors: any[], warnings: any[] }}
 */
function validateEInvoiceData(data, opts = {}) {
  const errors = [];
  const warnings = [];

  if (!data || typeof data !== 'object') {
    return { ok: false, errors: [mkError('BR-DATA', null, 'Keine Rechnungsdaten geladen.')], warnings };
  }

  // ── BR-02: Invoice number (BT-1) ────────────────────────────────────────────
  if (!nonEmpty(data.number)) {
    errors.push(mkError('BR-02', 'BT-1', 'Rechnungsnummer fehlt.'));
  }

  // ── BR-03: Invoice issue date (BT-2) ────────────────────────────────────────
  if (!nonEmpty(data.date)) {
    errors.push(mkError('BR-03', 'BT-2', 'Rechnungsdatum fehlt.'));
  }

  // ── BR-04: Type code (BT-3) ─────────────────────────────────────────────────
  if (!data.typeCodeCii && !data.typeCodeUbl && !data.typeCode) {
    errors.push(mkError('BR-04', 'BT-3', 'Rechnungstyp-Code fehlt.'));
  }

  // ── BR-05: Currency (BT-5) ──────────────────────────────────────────────────
  if (!nonEmpty(data.currency)) {
    errors.push(mkError('BR-05', 'BT-5', 'Wahrungs-Code fehlt.'));
  } else if (!/^[A-Z]{3}$/.test(String(data.currency))) {
    errors.push(mkError('BR-CL-04', 'BT-5', `Wahrungs-Code "${data.currency}" entspricht nicht ISO 4217 (3 Grossbuchstaben).`));
  }

  // ── BR-06: Seller name (BT-27) ──────────────────────────────────────────────
  if (!nonEmpty(data.seller?.name)) {
    errors.push(mkError('BR-06', 'BT-27', 'Verkaufer-Name fehlt.'));
  }

  // ── BR-08: Seller postal address (BG-5) — city + country mind. ──────────────
  if (!nonEmpty(data.seller?.city)) {
    errors.push(mkError('BR-08', 'BT-37', 'Verkaufer-Stadt fehlt.'));
  }

  // ── BR-09: Seller country code (BT-40) ──────────────────────────────────────
  if (!nonEmpty(data.seller?.countryId)) {
    errors.push(mkError('BR-09', 'BT-40', 'Verkaufer-Landercode fehlt.'));
  }

  // ── BR-07/10: Buyer name (BT-44) ────────────────────────────────────────────
  if (!nonEmpty(data.buyer?.name)) {
    errors.push(mkError('BR-07', 'BT-44', 'Kaufer-Name fehlt.'));
  }

  // ── BR-11: Buyer postal address (BG-8) ──────────────────────────────────────
  if (!nonEmpty(data.buyer?.city)) {
    warnings.push(mkWarning('BR-11', 'BT-52', 'Kaufer-Stadt fehlt — Buchung erlaubt, aber XRechnung-konform sollte BG-8 vollstandig sein.'));
  }
  if (!nonEmpty(data.buyer?.countryId)) {
    errors.push(mkError('BR-55', 'BT-55', 'Kaufer-Landercode fehlt.'));
  }

  // ── BR-16: At least one invoice line (BG-25) ────────────────────────────────
  const lines = Array.isArray(data.lines) ? data.lines : [];
  if (lines.length === 0) {
    errors.push(mkError('BR-16', 'BG-25', 'Mindestens eine Rechnungsposition erforderlich.'));
  }

  // ── BR-21..27: Each line must have ID, name, quantity, unit, net amount ─────
  lines.forEach((l, i) => {
    const lineLabel = `Position ${i + 1}`;
    if (!nonEmpty(l.name)) {
      errors.push(mkError('BR-22', 'BT-153', `${lineLabel}: Bezeichnung fehlt.`));
    }
    if (!Number.isFinite(Number(l.quantity))) {
      errors.push(mkError('BR-23', 'BT-129', `${lineLabel}: Menge fehlt oder ungultig.`));
    }
    if (!nonEmpty(l.unitCode)) {
      warnings.push(mkWarning('BR-23', 'BT-130', `${lineLabel}: Mengeneinheit fehlt (Default: C62).`));
    }
    if (!Number.isFinite(Number(l.lineTotal))) {
      errors.push(mkError('BR-24', 'BT-131', `${lineLabel}: Positions-Nettobetrag fehlt.`));
    }
    if (l.vatCategory && !VAT_CATEGORIES_ALLOWED.has(l.vatCategory)) {
      errors.push(mkError('BR-CL-09', 'BT-151', `${lineLabel}: Steuerkategorie "${l.vatCategory}" ist ungultig.`));
    }
  });

  // ── BR-S-01..09: VAT category rules ──────────────────────────────────────────
  const vatBreakdown = Array.isArray(data.vatBreakdown) ? data.vatBreakdown : [];
  if (vatBreakdown.length === 0 && lines.length > 0) {
    warnings.push(mkWarning('BR-CO-14', 'BG-23', 'Keine USt-Aufschlusselung vorhanden -- pruefen.'));
  }

  vatBreakdown.forEach(vb => {
    const cat = vb.category || vb.categoryCode || 'S';
    const rate = Number(vb.percent ?? vb.rate ?? 0);

    if (!VAT_CATEGORIES_ALLOWED.has(cat)) {
      errors.push(mkError('BR-CL-09', 'BT-118', `Steuerkategorie "${cat}" ist ungultig.`));
      return;
    }

    // BR-S-02: standard rate must be > 0
    if (cat === 'S') {
      if (!isPositive(rate)) {
        errors.push(mkError('BR-S-02', 'BT-119', 'Steuerkategorie S (Standardsatz) erfordert einen Steuersatz > 0.'));
      }
    }

    // BR-AE-01/02: reverse charge requires exemption reason and rate 0
    if (cat === 'AE') {
      if (rate !== 0) {
        errors.push(mkError('BR-AE-01', 'BT-119', 'Steuerkategorie AE (Reverse Charge) verlangt einen Steuersatz von 0.'));
      }
      if (!nonEmpty(vb.exemptionReasonText) && !nonEmpty(vb.exemptionReasonCode)) {
        errors.push(mkError('BR-AE-10', 'BT-120', 'Steuerkategorie AE (Reverse Charge) verlangt einen Befreiungsgrund (§13b UStG).'));
      }
    }

    // BR-E: tax exempt requires exemption reason
    if (cat === 'E') {
      if (rate !== 0) {
        errors.push(mkError('BR-E-01', 'BT-119', 'Steuerkategorie E (Steuerbefreit) verlangt einen Steuersatz von 0.'));
      }
      if (!nonEmpty(vb.exemptionReasonText) && !nonEmpty(vb.exemptionReasonCode)) {
        errors.push(mkError('BR-E-10', 'BT-120', 'Steuerkategorie E (Steuerbefreit) verlangt einen Befreiungsgrund.'));
      }
    }

    // BR-Z: zero rated
    if (cat === 'Z' && rate !== 0) {
      errors.push(mkError('BR-Z-01', 'BT-119', 'Steuerkategorie Z (Nullsatz) verlangt einen Steuersatz von 0.'));
    }

    // BR-O: out of scope (§19 Kleinunternehmer)
    if (cat === 'O') {
      if (rate !== 0) {
        errors.push(mkError('BR-O-01', 'BT-119', 'Steuerkategorie O (Nicht steuerbar) verlangt einen Steuersatz von 0.'));
      }
      if (!nonEmpty(vb.exemptionReasonText) && !nonEmpty(vb.exemptionReasonCode)) {
        errors.push(mkError('BR-O-10', 'BT-120', 'Steuerkategorie O (z.B. §19 Kleinunternehmer) verlangt einen Befreiungsgrund.'));
      }
    }

    // VAT amount must match basis * percent (within tolerance)
    if (vb.basis != null && vb.amount != null) {
      const expected = fmt2(Number(vb.basis) * (rate / 100));
      if (abs(Number(vb.amount) - expected) > ROUNDING_TOLERANCE) {
        errors.push(mkError('BR-CO-17', 'BT-117',
          `Steuerbetrag fur Kategorie ${cat} (${rate}%): erwartet ${expected.toFixed(2)}, ist ${fmt2(vb.amount).toFixed(2)}.`));
      }
    }
  });

  // ── BR-12..15: Totals must be present ───────────────────────────────────────
  const t = data.totals || {};
  if (!Number.isFinite(Number(t.netTotal)) && !Number.isFinite(Number(t.lineNetTotal))) {
    errors.push(mkError('BR-12', 'BT-106', 'Summe der Positions-Nettobetrage (BT-106) fehlt.'));
  }
  if (!Number.isFinite(Number(t.taxBasis))) {
    errors.push(mkError('BR-13', 'BT-109', 'Gesamt-Netto (BT-109) fehlt.'));
  }
  if (!Number.isFinite(Number(t.grandTotal)) && !Number.isFinite(Number(t.gross))) {
    errors.push(mkError('BR-14', 'BT-112', 'Gesamt-Brutto (BT-112) fehlt.'));
  }
  if (!Number.isFinite(Number(t.duePayable)) && !Number.isFinite(Number(t.amountDue))) {
    errors.push(mkError('BR-15', 'BT-115', 'Zahlbarer Betrag (BT-115) fehlt.'));
  }

  // ── BR-CO-10: sum(lineTotal) == netTotal (within tolerance) ─────────────────
  const lineSum = fmt2(lines.reduce((s, l) => s + Number(l.lineTotal || 0), 0));
  const lineNetTotal = Number(t.lineNetTotal ?? t.netTotal ?? lineSum);
  if (abs(lineSum - lineNetTotal) > ROUNDING_TOLERANCE) {
    errors.push(mkError('BR-CO-10', 'BT-106',
      `Summe Positions-Netto: ${lineSum.toFixed(2)} weicht ab von BT-106 (${fmt2(lineNetTotal).toFixed(2)}).`));
  }

  // ── BR-CO-15: gross = taxBasis + tax (tolerance) ────────────────────────────
  const taxBasis = Number(t.taxBasis ?? 0);
  const tax      = Number(t.taxAmount ?? t.tax ?? 0);
  const gross    = Number(t.grandTotal ?? t.gross ?? 0);
  if (Number.isFinite(taxBasis) && Number.isFinite(tax) && Number.isFinite(gross)) {
    const expected = fmt2(taxBasis + tax);
    if (abs(gross - expected) > ROUNDING_TOLERANCE) {
      errors.push(mkError('BR-CO-15', 'BT-112',
        `Brutto: erwartet ${expected.toFixed(2)} (Netto ${fmt2(taxBasis).toFixed(2)} + USt ${fmt2(tax).toFixed(2)}), ist ${fmt2(gross).toFixed(2)}.`));
    }
  }

  // ── BR-CO-16: duePayable = gross - prepaid ──────────────────────────────────
  if (Number.isFinite(Number(t.prepaidGross)) && Number.isFinite(gross)) {
    const expected = fmt2(gross - Number(t.prepaidGross || 0));
    const due = Number(t.duePayable ?? t.amountDue ?? 0);
    if (abs(due - expected) > ROUNDING_TOLERANCE) {
      errors.push(mkError('BR-CO-16', 'BT-115',
        `Zahlbarer Betrag: erwartet ${expected.toFixed(2)} (Brutto ${fmt2(gross).toFixed(2)} - Vorausz. ${fmt2(t.prepaidGross).toFixed(2)}), ist ${fmt2(due).toFixed(2)}.`));
    }
  }

  // ── BR-IBAN: IBAN-Format pruefen (sofern angegeben) ─────────────────────────
  const iban = String(data.seller?.iban ?? '').replace(/\s+/g, '').toUpperCase();
  if (iban && !/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(iban)) {
    warnings.push(mkWarning('BR-DE-IBAN', 'BT-84', `IBAN-Format wirkt ungultig: "${iban}"`));
  }

  // ── BR-DE-1: BuyerReference (Leitweg-ID) — NUR Warnung ──────────────────────
  // Hinweis: Pflicht fur B2G, optional fur B2B. Auf Wunsch keine Hartpflicht.
  if (!nonEmpty(data.buyerReference)) {
    warnings.push(mkWarning('BR-DE-1', 'BT-10',
      'Leitweg-ID/Kauferreferenz fehlt -- bei offentlichen Auftraggebern Pflicht (B2G).'));
  }

  // ── BR-DE-21: Currency = EUR empfohlen ──────────────────────────────────────
  if (data.currency && data.currency !== 'EUR') {
    warnings.push(mkWarning('BR-DE-21', 'BT-5',
      `Wahrung ist ${data.currency}, EUR ist fur deutsche Rechnungen ueblich.`));
  }

  // ── BR-31: Allowance reason and amount ──────────────────────────────────────
  const allowances = Array.isArray(data.allowances) ? data.allowances : [];
  allowances.forEach((a, i) => {
    if (!Number.isFinite(Number(a.amount)) || Number(a.amount) === 0) return;
    if (!nonEmpty(a.reason) && !nonEmpty(a.reasonCode)) {
      warnings.push(mkWarning('BR-33', 'BT-97',
        `Rabatt/Abzug ${i + 1}: Begrundungstext oder -code fehlt.`));
    }
  });

  return {
    ok: errors.length === 0,
    errors,
    warnings,
  };
}

module.exports = { validateEInvoiceData };
