/**
 * Vorbelegungen für neu angelegte Verträge (TENANT_SETTINGS → CONTRACT-Spalten).
 *
 * Ein Vertrag entsteht an vier Stellen (Projektanlage, Angebots-Umwandlung und
 * zweimal im Datenimport). Ohne gemeinsame Stelle driften die Vorbelegungen
 * auseinander — genau das war der Fall: Skonto ließ sich in den Einstellungen
 * pflegen, wurde aber nirgends angewendet.
 */

function num(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Baut das Defaults-Fragment für eine CONTRACT-Insert-Zeile.
 * Nur gesetzte Werte landen im Ergebnis — nicht konfigurierte Vorbelegungen
 * überschreiben keine Spalten-Defaults der Datenbank.
 *
 * @param {Record<string, string|null>} defaults  TENANT_SETTINGS als KEY→VALUE
 * @returns {Record<string, unknown>}
 */
function contractDefaults(defaults) {
  const d = defaults || {};
  const out = {};

  const currencyId = num(d.default_currency_id);
  if (currencyId !== null) out.CURRENCY_ID = currencyId;

  const vatId = num(d.default_vat_id);
  if (vatId !== null) out.VAT_ID = vatId;

  const cashPct = num(d.default_cash_discount_percent);
  if (cashPct !== null) out.CASH_DISCOUNT_PERCENT = cashPct;

  const cashDays = num(d.default_cash_discount_days);
  if (cashDays !== null) out.CASH_DISCOUNT_DAYS = Math.trunc(cashDays);

  // Sicherheitseinbehalt: nur der eingeschaltete Zustand wird persistiert.
  if (String(d.default_se_enabled) === "true") {
    out.SE_ENABLED = true;
    const sePct = num(d.default_se_percent);
    if (sePct !== null) out.SE_PERCENT = sePct;
    const basis = String(d.default_se_basis || "").toUpperCase();
    out.SE_BASIS = basis === "NETTO" ? "NETTO" : "BRUTTO";
    const legal = String(d.default_se_legal_reference || "").trim();
    if (legal) out.SE_LEGAL_REFERENCE = legal;
  }

  return out;
}

/** Konditionen, die ein Folgevertrag desselben Vorhabens erbt (Steuer, Skonto, Einbehalt, Währung). */
const INHERITED_TERMS = [
  "CURRENCY_ID", "VAT_ID", "VAT_CATEGORY", "VAT_EXEMPTION_REASON_CODE", "VAT_EXEMPTION_REASON_TEXT",
  "CASH_DISCOUNT_PERCENT", "CASH_DISCOUNT_DAYS",
  "SE_ENABLED", "SE_PERCENT", "SE_BASIS", "SE_LEGAL_REFERENCE",
];

/**
 * Konditionen aus einem bestehenden Vertrag — für einen Vertrag, der aus einem
 * anderen hervorgeht (Nachtrag als eigenes Projekt). Dort gelten die
 * Bedingungen des Ursprungsvertrags, nicht die allgemeinen Vorbelegungen: ein
 * Reverse-Charge-Auftrag oder ein vereinbarter Einbehalt bleibt, was er war.
 * Rechnungsempfaenger gehoert NICHT dazu — der ist gerade der Grund für den
 * eigenen Vertrag. Nur gesetzte Werte landen im Ergebnis.
 *
 * @param {Record<string, unknown>|null} source  CONTRACT-Zeile
 */
function inheritedContractTerms(source) {
  const out = {};
  for (const k of INHERITED_TERMS) {
    if (source && source[k] !== undefined && source[k] !== null) out[k] = source[k];
  }
  return out;
}

module.exports = { contractDefaults, inheritedContractTerms, INHERITED_TERMS };
