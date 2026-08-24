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

module.exports = { contractDefaults };
