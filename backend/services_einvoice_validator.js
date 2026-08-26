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
// Regeln je USt-Kategorie ausser S. Ersetzt das frueher definierte, aber
// nirgends benutzte VAT_CATEGORIES_REQUIRE_REASON — dadurch fehlten G und K
// in der Pruefung komplett. Z verlangt bewusst KEINEN Befreiungsgrund; die
// alte Konstante fuehrte Z faelschlich mit.
// ACHTUNG: Die Codes BR-G-* und BR-IC-* sowie die Zuordnung der -02/-03
// Varianten sind nicht gegen den KoSIT-Katalog gegengeprueft.
const VAT_CATEGORY_RULES = {
  AE: { label: 'Reverse Charge',        rateCode: 'BR-AE-01', reasonCode: 'BR-AE-10', hint: '§13b UStG',
        sellerVatCode: 'BR-AE-02', buyerVatCode: 'BR-AE-03' },
  E:  { label: 'Steuerbefreit',         rateCode: 'BR-E-01',  reasonCode: 'BR-E-10',  hint: '' },
  Z:  { label: 'Nullsatz',              rateCode: 'BR-Z-01',  reasonCode: null,       hint: '' },
  O:  { label: 'Nicht steuerbar',       rateCode: 'BR-O-01',  reasonCode: 'BR-O-10',  hint: 'z.B. §19 Kleinunternehmer' },
  G:  { label: 'Ausfuhrlieferung',      rateCode: 'BR-G-01',  reasonCode: 'BR-G-10',  hint: 'Drittland' },
  K:  { label: 'Innergemeinschaftlich', rateCode: 'BR-IC-01', reasonCode: 'BR-IC-10', hint: 'EU-Lieferung',
        sellerVatCode: 'BR-IC-02', buyerVatCode: 'BR-IC-03' },
};
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

  // BG-6: Verkaufer-Kontakt. Die Builder geben die Gruppe nur aus, wenn die
  // Felder gefuellt sind — eine unvollstandige BG-6 (etwa Ansprechpartner
  // ohne Telefon) wird vom Pruefportal abgewiesen. Quelle der Daten ist der
  // EMPLOYEE des Belegs.
  // ACHTUNG: Die Codes BR-DE-5/6/7 stammen aus der XRechnung-CIUS und sind
  // nicht gegen den aktuellen KoSIT-Katalog gegengeprueft.
  if (!nonEmpty(data.seller?.contactName)) {
    errors.push(mkError('BR-DE-5', 'BT-41', 'Verkaufer-Ansprechpartner fehlt (BG-6) — beim Mitarbeiter hinterlegen.'));
  }
  if (!nonEmpty(data.seller?.contactPhone)) {
    errors.push(mkError('BR-DE-6', 'BT-42', 'Verkaufer-Telefonnummer fehlt (BG-6) — beim Mitarbeiter hinterlegen.'));
  }
  if (!nonEmpty(data.seller?.contactEmail)) {
    errors.push(mkError('BR-DE-7', 'BT-43', 'Verkaufer-E-Mail fehlt (BG-6) — beim Mitarbeiter hinterlegen.'));
  }

  // BR-CO-26: mindestens eine Verkaufer-Kennung. Die Norm verlangt BT-29,
  // BT-30 oder BT-31 — die Steuernummer BT-32 erfuellt sie nicht. Das
  // Datenmodell kennt derzeit nur BT-31 und BT-32; BT-29/BT-30 gibt kein
  // Builder aus. Fehlt beides, ist der Beleg sicher unbrauchbar (Error);
  // liegt nur die Steuernummer vor, haengt es am Validator des Empfaengers
  // (Warnung) — die belastbare Loesung waere ein Registernummer-Feld BT-30.
  const sellerHasVatId = nonEmpty(data.seller?.vatId);
  const sellerHasTaxId = nonEmpty(data.seller?.taxId);
  if (!sellerHasVatId && !sellerHasTaxId) {
    errors.push(mkError('BR-CO-26', 'BT-31',
      'Weder USt-IdNr (BT-31) noch Steuernummer (BT-32) hinterlegt — die Rechnung wird abgewiesen.'));
  } else if (!sellerHasVatId) {
    warnings.push(mkWarning('BR-CO-26', 'BT-31',
      'Nur Steuernummer (BT-32) hinterlegt. BR-CO-26 verlangt BT-29, BT-30 oder BT-31 — '
      + 'Empfaenger koennen die Rechnung deshalb abweisen.'));
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
    if (!nonEmpty(l.description)) {
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
    } else {
      // Alle uebrigen Kategorien verlangen Satz 0 und — ausser Z — einen
      // Befreiungsgrund. Tabellengesteuert, damit eine zugelassene Kategorie
      // nicht wieder stillschweigend ungeprueft bleibt.
      const rules = VAT_CATEGORY_RULES[cat];
      if (rules) {
        const label = rules.hint ? `${rules.label}, ${rules.hint}` : rules.label;
        if (rate !== 0) {
          errors.push(mkError(rules.rateCode, 'BT-119',
            `Steuerkategorie ${cat} (${label}) verlangt einen Steuersatz von 0.`));
        }
        if (rules.reasonCode && !nonEmpty(vb.exemptionReasonText) && !nonEmpty(vb.exemptionReasonCode)) {
          errors.push(mkError(rules.reasonCode, 'BT-120',
            `Steuerkategorie ${cat} (${label}) verlangt einen Befreiungsgrund.`));
        }
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

  // Reverse Charge und innergemeinschaftliche Lieferung verlangen die
  // USt-IdNr BEIDER Parteien. Beide Felder liegen im Datenmodell vor, wurden
  // bisher aber nicht geprueft — eine §13b-Rechnung ohne Kaeufer-USt-IdNr
  // lief durch und wurde erst beim Empfaenger abgewiesen.
  const categoriesInUse = new Set(vatBreakdown.map(vb => vb.category || vb.categoryCode || 'S'));
  for (const cat of ['AE', 'K']) {
    if (!categoriesInUse.has(cat)) continue;
    const rules = VAT_CATEGORY_RULES[cat];
    if (!nonEmpty(data.seller?.vatId)) {
      errors.push(mkError(rules.sellerVatCode, 'BT-31',
        `Steuerkategorie ${cat} (${rules.label}) verlangt die USt-IdNr des Verkaufers.`));
    }
    if (!nonEmpty(data.buyer?.vatId)) {
      errors.push(mkError(rules.buyerVatCode, 'BT-48',
        `Steuerkategorie ${cat} (${rules.label}) verlangt die USt-IdNr des Kaufers.`));
    }
  }

  // ── BR-12..15: Totals must be present ───────────────────────────────────────
  const t = data.totals || {};
  if (!Number.isFinite(Number(t.lineTotal))) {
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
  const lineNetTotal = Number(t.lineTotal ?? lineSum);
  if (abs(lineSum - lineNetTotal) > ROUNDING_TOLERANCE) {
    errors.push(mkError('BR-CO-10', 'BT-106',
      `Summe Positions-Netto: ${lineSum.toFixed(2)} weicht ab von BT-106 (${fmt2(lineNetTotal).toFixed(2)}).`));
  }

  // BR-CO-13: BT-109 = BT-106 - BT-107 + BT-108
  // Ohne diese Pruefung faellt eine Drift zwischen der Summe der je Position
  // gerundeten Betraege und dem gespeicherten Dokument-Netto erst beim
  // Empfaenger auf, wo sie zur Ablehnung fuehrt.
  const docAllowanceTotal = Number(t.allowanceTotal ?? 0);
  const docChargeTotal    = Number(t.chargeTotal ?? 0);
  if (Number.isFinite(Number(t.taxBasis))) {
    const expectedBasis = fmt2(lineNetTotal - docAllowanceTotal + docChargeTotal);
    if (abs(Number(t.taxBasis) - expectedBasis) > ROUNDING_TOLERANCE) {
      errors.push(mkError('BR-CO-13', 'BT-109',
        `Gesamt-Netto (BT-109): erwartet ${expectedBasis.toFixed(2)} `
        + `(Positionssumme ${fmt2(lineNetTotal).toFixed(2)} `
        + `- Nachlasse ${fmt2(docAllowanceTotal).toFixed(2)} `
        + `+ Zuschlage ${fmt2(docChargeTotal).toFixed(2)}), `
        + `ist ${fmt2(Number(t.taxBasis)).toFixed(2)}.`));
    }
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

  // ── BR-DE-1: Zahlungsinformationen (BG-16) ─────────────────────────
  // Beide Builder haengen den KOMPLETTEN Zahlungsblock an die IBAN
  // (cii.js buildPaymentMeans, ubl.js cac:PaymentMeans) und kennen als
  // Zahlungsart nur die SEPA-Ueberweisung (TypeCode 58). Ohne IBAN entsteht
  // deshalb kein BG-16 — nicht etwa ein unvollstaendiges, sondern gar keins.
  // Beim Empfaenger ist das eine harte Abweisung, hier war es bisher nicht
  // einmal eine Warnung: geprueft wurde nur das Format einer vorhandenen IBAN.
  const iban = String(data.seller?.iban ?? '').replace(/\s+/g, '').toUpperCase();
  if (!iban) {
    errors.push(mkError('BR-DE-1', 'BT-84',
      'IBAN fehlt — ohne sie enthaelt die Rechnung keine Zahlungsinformationen (BG-16) '
      + 'und wird abgewiesen. In den Firmenstammdaten hinterlegen.'));
  } else if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(iban)) {
    warnings.push(mkWarning('BR-DE-IBAN', 'BT-84', `IBAN-Format wirkt ungultig: "${iban}"`));
  }

  // ── BR-DE-15: BuyerReference (Leitweg-ID) — NUR Warnung ──────────────────────
  // Hinweis: Pflicht fur B2G, optional fur B2B. Auf Wunsch keine Hartpflicht.
  // Der Code hiess bis 25.08.2026 BR-DE-1 — das ist nach KoSIT die Regel zu den
  // Zahlungsinformationen (direkt darueber) und war damit doppelt vergeben.
  // ACHTUNG: BR-DE-15 ist nicht gegen den KoSIT-Katalog gegengeprueft.
  if (!nonEmpty(data.buyerReference)) {
    warnings.push(mkWarning('BR-DE-15', 'BT-10',
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
