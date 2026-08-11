"use strict";

/**
 * Zugriffspruefung fuer ASSET-Datensaetze.
 *
 * Pentest-Befund vom 2026-08-06: Vier Codepfade luden Assets allein ueber die
 * ID und lieferten deren Inhalt aus —
 *   • POST /mitarbeiter/me/avatar         (Datei base64 in der Antwort)
 *   • PUT  /stammdaten/logo               (base64 in den eigenen Einstellungen)
 *   • GET  /branding/login/:slug/hero     (oeffentlich, ohne Anmeldung)
 *   • POST /invoices/:id/attachments      (base64 in der eigenen XRechnung)
 * Da ASSET.ID fortlaufend vergeben wird, liess sich damit durch Hochzaehlen
 * jede hochgeladene Datei der Plattform abziehen: Logos, Unterschriften,
 * Vertrags-PDFs, generierte Rechnungen.
 *
 * ASSET hat keine TENANT_ID — die Zugehoerigkeit laeuft ueber COMPANY_ID.
 * Deshalb hier zentral, statt die Aufloesung an vier Stellen zu wiederholen.
 *
 * Anders als das aeltere resolveCompanyId (routes/assets.js), das mit limit(1)
 * nur die ERSTE Firma des Mandanten nimmt, werden hier alle beruecksichtigt.
 * Sonst wuerde bei Mandanten mit mehreren Firmen ein legitimes Asset abgelehnt.
 */

/** Alle COMPANY-IDs eines Mandanten. */
async function companyIdsForTenant(supabase, tenantId) {
  if (tenantId === undefined || tenantId === null || tenantId === "") {
    throw new Error("companyIdsForTenant: tenantId ist erforderlich");
  }
  const { data, error } = await supabase
    .from("COMPANY")
    .select("ID")
    .eq("TENANT_ID", tenantId);
  if (error) throw { status: 500, message: error.message };
  return (data || []).map((r) => r.ID);
}

/**
 * Laedt ein Asset, aber nur wenn es zu einer Firma des Mandanten gehoert.
 *
 * @param {string} columns  Spalten fuer den SELECT (Standard: die fuer die
 *                          Dateiauslieferung noetigen).
 * @returns {Promise<object>} der Asset-Datensatz
 * @throws  {{status:404}}    wenn es nicht existiert ODER einem anderen
 *                            Mandanten gehoert — bewusst nicht unterscheidbar,
 *                            sonst liessen sich fremde Asset-IDs ermitteln.
 */
async function loadAssetForTenant(supabase, assetId, tenantId, columns = "ID, COMPANY_ID, STORAGE_KEY, MIME_TYPE, FILE_NAME, FILE_SIZE") {
  const id = parseInt(String(assetId), 10);
  if (!Number.isFinite(id)) throw { status: 404, message: "Asset nicht gefunden." };

  const companyIds = await companyIdsForTenant(supabase, tenantId);
  if (companyIds.length === 0) throw { status: 404, message: "Asset nicht gefunden." };

  const { data, error } = await supabase
    .from("ASSET")
    .select(columns)
    .eq("ID", id)
    .in("COMPANY_ID", companyIds)
    .maybeSingle();
  if (error) throw { status: 500, message: error.message };
  if (!data) throw { status: 404, message: "Asset nicht gefunden." };
  return data;
}

/** Wie loadAssetForTenant, liefert aber null statt zu werfen. */
async function findAssetForTenant(supabase, assetId, tenantId, columns) {
  try {
    return await loadAssetForTenant(supabase, assetId, tenantId, columns);
  } catch (e) {
    if (e && e.status === 404) return null;
    throw e;
  }
}

module.exports = { companyIdsForTenant, loadAssetForTenant, findAssetForTenant };
