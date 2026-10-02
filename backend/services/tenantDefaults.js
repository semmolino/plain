"use strict";
// ============================================================================
// Vorbelegungen des Mandanten (TENANT_SETTINGS) — was PUT/GET /stammdaten/defaults
// lesen und schreiben darf (UI-Pilot Runde 12).
//
// Vorher nahm PUT /defaults JEDEN Schlüssel an, ohne den Wert zu prüfen. Wer
// nur Vorbelegungen pflegen durfte (settings.defaults.edit), konnte damit
// Einstellungen anderer Rechte überschreiben — das Firmenlogo in allen PDFs
// (co_<id>_logo_data_uri, sonst settings.company.edit), den Monatsabschluss
// samt gespeichertem Bericht, die Arbeitszeitregeln, den Verfall des
// Urlaubsübertrags. Und GET /defaults lieferte allen Angemeldeten sämtliche
// Zeilen, auch den gespeicherten Monatsabschluss-Bericht und Logos als
// Base64 — bei jedem Formular, das eine Vorbelegung liest.
//
// Jetzt gibt es eine feste Liste. Jeder Schlüssel nennt sein Recht, seine Art
// und seine Grenzen; ein unbekannter Schlüssel ist ein Fehler. Geprüft wird
// die ganze Anfrage, bevor etwas geschrieben wird — eine ungültige Angabe
// schreibt nichts halb. Vorher gingen 28 PUT-Aufrufe nacheinander raus.
// ============================================================================

const { findAssetForTenant } = require("./assetAccess");

const D = "settings.defaults.edit";
const C = "settings.company.edit";

// kind: ref (Katalog-ID, tenant = mandantengebunden), int, num, enum, text, pcts, slug, asset
const SPEC = {
  default_country_id:            { perm: D, kind: "ref",  table: "COUNTRY",        label: "Land" },
  default_company_id:            { perm: D, kind: "ref",  table: "COMPANY",        label: "Firma", tenant: true },
  default_project_status_id:     { perm: D, kind: "ref",  table: "PROJECT_STATUS", label: "Projektstatus" },
  default_offer_status_id:       { perm: D, kind: "ref",  table: "OFFER_STATUS",   label: "Angebotsstatus" },
  default_currency_id:           { perm: D, kind: "ref",  table: "CURRENCY",       label: "Währung" },
  default_vat_id:                { perm: D, kind: "ref",  table: "VAT",            label: "MwSt." },
  default_payment_means_id:      { perm: D, kind: "ref",  table: "PAYMENT_MEANS",  label: "Zahlungsart" },
  offer_valid_days:              { perm: D, kind: "int",  min: 1, max: 365, label: "Gültigkeitsdauer" },
  default_cash_discount_percent: { perm: D, kind: "num",  min: 0, max: 100, label: "Skonto (%)" },
  default_cash_discount_days:    { perm: D, kind: "int",  min: 0, max: 365, label: "Skonto-Tage" },
  default_payment_term_days:     { perm: D, kind: "int",  min: 0, max: 365, label: "Zahlungsziel" },
  default_se_enabled:            { perm: D, kind: "enum", values: ["true"],            label: "Sicherheitseinbehalt" },
  default_se_percent:            { perm: D, kind: "num",  min: 0, max: 100,            label: "Sicherheitseinbehalt (%)" },
  default_se_basis:              { perm: D, kind: "enum", values: ["BRUTTO", "NETTO"], label: "Basis des Sicherheitseinbehalts" },
  default_se_legal_reference:    { perm: D, kind: "text", max: 200,                    label: "Rechtsgrundlage" },
  timer_enabled:                 { perm: D, kind: "enum", values: ["false"],           label: "Stempeluhr" },
  budget_warning_enabled:        { perm: D, kind: "enum", values: ["false"],           label: "Budget-Warnungen" },
  budget_warning_default_pcts:   { perm: D, kind: "pcts",                              label: "Standard-Schwellen" },
  budget_warning_notify_pm:      { perm: D, kind: "enum", values: ["false"],           label: "Projektleiter benachrichtigen" },
  budget_warning_notify_booker:  { perm: D, kind: "enum", values: ["false"],           label: "Verursachende benachrichtigen" },
  wip_cost_factor_percent:       { perm: D, kind: "num",  min: 0, max: 100,            label: "Bewertungsfaktor Kosten" },
  wip_method_default:            { perm: D, kind: "enum", values: ["erloes", "hk"],    label: "Bewertungsmethode" },
  wip_tax_cost_factor_percent:   { perm: D, kind: "num",  min: 0, max: 100,            label: "Bewertungsfaktor Steuerbilanz" },
  wip_target_cost_ratio_percent: { perm: D, kind: "num",  min: 0, max: 500,            label: "Zielkostenquote" },
  kpi_cpi_watch_threshold:       { perm: D, kind: "num",  min: 0.1, max: 5,            label: "Schwelle „beobachten“" },
  kpi_cpi_critical_threshold:    { perm: D, kind: "num",  min: 0.1, max: 5,            label: "Schwelle „Handlungsbedarf“" },
  // Basiszinssatz fuer Verzugszinsen (§ 247 BGB) — aendert sich zum 1.1./1.7.
  dunning_base_rate_percent:     { perm: "settings.dunning_config.edit", kind: "num",  min: -10, max: 20, label: "Basiszinssatz (%)" },
  dunning_base_rate_since:       { perm: "settings.dunning_config.edit", kind: "date",                       label: "Basiszinssatz gültig seit" },
  "tenant.theme_default":        { perm: C, kind: "slug",                              label: "Standard-Theme" },
  "tenant.hero_asset_id":        { perm: C, kind: "asset",                             label: "Anmeldebild" },
};
const KEYS = Object.keys(SPEC);

const bad = (message, status = 400) => ({ status, message });
const r4 = (n) => Math.round(n * 10000) / 10000;

/** Wert einer Eingabe als Zahl — nimmt „2,5" wie „2.5". */
function parseNumber(v) {
  const t = String(v).trim().replace(",", ".");
  if (!/^-?\d+(\.\d+)?$/.test(t)) return NaN;
  return Number(t);
}

/**
 * Prüft einen Wert und liefert ihn in Speicherform (String oder null).
 * Wirft {status, message}. `null`/"" heißt: Vorbelegung entfernen.
 */
async function normalize(supabase, tenantId, key, raw) {
  const s = SPEC[key];
  if (raw === null || raw === undefined || String(raw).trim() === "") return null;
  const v = String(raw).trim();
  switch (s.kind) {
    case "int": {
      const n = parseNumber(v);
      if (!Number.isInteger(n) || n < s.min || n > s.max) throw bad(`${s.label}: bitte eine ganze Zahl von ${s.min} bis ${s.max}.`);
      return String(n);
    }
    case "num": {
      const n = parseNumber(v);
      if (!Number.isFinite(n) || n < s.min || n > s.max) throw bad(`${s.label}: bitte eine Zahl von ${String(s.min).replace(".", ",")} bis ${String(s.max).replace(".", ",")}.`);
      return String(r4(n));
    }
    case "enum":
      if (!s.values.includes(v)) throw bad(`${s.label}: ungültiger Wert.`);
      return v;
    case "text":
      if (v.length > s.max) throw bad(`${s.label}: höchstens ${s.max} Zeichen.`);
      return v;
    case "date":
      if (!/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(Date.parse(`${v}T00:00:00Z`))) throw bad(`${s.label}: bitte ein Datum.`);
      return v;
    case "slug":
      if (!/^[a-z0-9-]{1,40}$/.test(v)) throw bad(`${s.label}: ungültiger Wert.`);
      return v;
    case "pcts": {
      const parts = v.split(/[;,\s]+/).filter(Boolean).map(parseNumber);
      if (!parts.length || parts.length > 10 || parts.some(n => !Number.isFinite(n) || n <= 0 || n > 1000))
        throw bad(`${s.label}: Prozentwerte über 0, durch Komma getrennt — z. B. 75, 90, 100.`);
      return [...new Set(parts.map(r4))].sort((a, b) => a - b).join(", ");
    }
    case "ref": {
      const id = parseNumber(v);
      if (!Number.isInteger(id) || id <= 0) throw bad(`${s.label}: ungültige Auswahl.`);
      let q = supabase.from(s.table).select("ID").eq("ID", id);
      if (s.tenant) q = q.eq("TENANT_ID", tenantId);
      const { data, error } = await q.maybeSingle();
      if (error) throw bad(error.message, 500);
      if (!data) throw bad(`${s.label}: Auswahl nicht gefunden.`);
      return String(id);
    }
    case "asset": {
      const id = parseNumber(v);
      if (!Number.isInteger(id) || id <= 0) throw bad(`${s.label}: ungültige Datei.`);
      const asset = await findAssetForTenant(supabase, id, tenantId, "ID");
      if (!asset) throw bad(`${s.label}: Datei nicht gefunden.`);
      return String(id);
    }
    default:
      throw bad(`${s.label}: nicht speicherbar.`, 500);
  }
}

/** Gespeicherte Vorbelegungen — nur die Schlüssel der Liste. */
async function readDefaults(supabase, tenantId) {
  const { data, error } = await supabase.from("TENANT_SETTINGS").select("KEY, VALUE")
    .eq("TENANT_ID", tenantId).in("KEY", KEYS);
  if (error) throw bad(error.message, 500);
  const out = {};
  for (const row of data || []) out[row.KEY] = row.VALUE;
  return out;
}

/**
 * Schreibt mehrere Vorbelegungen auf einmal.
 * @param values { key: value } — value null/"" entfernt die Vorbelegung
 * @param can    (perm) => boolean
 */
async function writeDefaults(supabase, tenantId, values, can) {
  const entries = Object.entries(values || {});
  if (!entries.length) throw bad("Keine Änderungen übergeben.");
  const unknown = entries.map(([k]) => k).filter(k => !SPEC[k]);
  if (unknown.length) throw bad(`Unbekannte Einstellung: ${unknown.join(", ")}`);
  const denied = [...new Set(entries.map(([k]) => SPEC[k].perm).filter(p => !can(p)))];
  if (denied.length) throw bad(`Fehlende Berechtigung: ${denied.join(", ")}`, 403);

  const normalized = {};
  for (const [k, v] of entries) normalized[k] = await normalize(supabase, tenantId, k, v);

  // Die Ampel braucht „Handlungsbedarf" unter „beobachten" — geprüft gegen den
  // Stand, der nach dem Speichern gilt, nicht nur gegen die Anfrage.
  if ("kpi_cpi_watch_threshold" in normalized || "kpi_cpi_critical_threshold" in normalized) {
    const stored = await readDefaults(supabase, tenantId);
    const merged = { ...stored, ...normalized };
    const w = merged.kpi_cpi_watch_threshold, c = merged.kpi_cpi_critical_threshold;
    if (w != null && c != null && Number(c) >= Number(w))
      throw bad("Die Schwelle „Handlungsbedarf“ muss unter „beobachten“ liegen.");
  }

  // Entfernen heißt löschen, nicht VALUE = null: mehrere Leser legen
  // gespeicherte Zeilen über ihre Standardwerte ({ ...DEFAULTS, ...map }), eine
  // leere Zeile überschrieb dort den Standard (Budget-Warnungen, Runde 12).
  const now = new Date().toISOString();
  const rows = Object.entries(normalized).filter(([, v]) => v != null)
    .map(([KEY, VALUE]) => ({ TENANT_ID: tenantId, KEY, VALUE, UPDATED_AT: now }));
  const removed = Object.entries(normalized).filter(([, v]) => v == null).map(([k]) => k);
  if (rows.length) {
    const { error } = await supabase.from("TENANT_SETTINGS").upsert(rows, { onConflict: "TENANT_ID,KEY" });
    if (error) throw bad(error.message, 500);
  }
  if (removed.length) {
    const { error } = await supabase.from("TENANT_SETTINGS").delete().eq("TENANT_ID", tenantId).in("KEY", removed);
    if (error) throw bad(error.message, 500);
  }
  return normalized;
}

module.exports = { SPEC, KEYS, readDefaults, writeDefaults, normalize, parseNumber };
