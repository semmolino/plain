"use strict";

/**
 * services/einvoiceSnapshot.js
 *
 * R6 (Audit 25.08.2026) — Einfrieren der CII-Fassung beim Buchen.
 *
 * Beim Buchen wurde bisher nur die UBL-Fassung eingefroren
 * (DOCUMENT_XML_ASSET_ID + DOCUMENT_XML_PROFILE = 'xrechnung-ubl').
 * Der CII-Endpunkt liefert einen Snapshot nur, wenn das Profil 'zugferd-*'
 * heisst — das traf nie zu; das Hybrid-PDF prueft gar keinen Snapshot.
 * Beide wurden deshalb bei jedem Abruf neu erzeugt, und jede Korrektur an
 * den Buildern veraenderte rueckwirkend das Dokument bereits gebuchter
 * Belege, waehrend deren UBL unveraendert blieb.
 *
 * Dieses Modul friert die CII-Fassung in eigene Spalten ein (Migration 0133).
 *
 * Bewusst best-effort: schlaegt das Einfrieren fehl — etwa weil die Migration
 * noch nicht eingespielt ist —, bleibt die Buchung gueltig und der Abruf
 * faellt auf den bisherigen Live-Pfad zurueck. Eine Buchung an einer
 * Snapshot-Optimierung scheitern zu lassen waere die schlechtere Wahl:
 * der Beleg ist fachlich vollstaendig, sobald PDF und UBL stehen.
 */

const { loadInvoiceData } = require("../services_einvoice_data");
const { generateCiiXml } = require("../services_einvoice_cii");
const { storeGeneratedXmlAsAsset, bestEffortDeleteAsset } = require("./generatedAssets");

// Das Profil, das beim Buchen eingefroren wird. Der Leseweg vergleicht damit,
// damit ein Abruf mit abweichendem Profil bewusst live erzeugt.
const CII_SNAPSHOT_PROFILE = "EN16931";
const CII_SNAPSHOT_PROFILE_KEY = `zugferd-${CII_SNAPSHOT_PROFILE.toLowerCase()}`;

/**
 * Erzeugt die CII-Fassung und legt sie als eingefrorenes Asset ab.
 *
 * @param {object} supabase
 * @param {object} opts
 * @param {'INVOICE'|'PARTIAL_PAYMENT'} opts.docType
 * @param {number} opts.docId
 * @param {number} opts.tenantId
 * @param {number} opts.companyId
 * @param {string} opts.fileBase  Dateiname ohne Endung, z. B. 'ZUGFeRD_RG-2026-0001'
 * @returns {Promise<{assetId: number, profile: string}|null>} null bei jedem Fehlschlag
 */
async function freezeCiiSnapshot(supabase, { docType, docId, tenantId, companyId, fileBase }) {
  const table = docType === "INVOICE" ? "INVOICE" : "PARTIAL_PAYMENT";
  let asset = null;
  try {
    const data = await loadInvoiceData(supabase, parseInt(docId, 10), docType, tenantId);
    const xml = generateCiiXml(data, CII_SNAPSHOT_PROFILE);

    asset = await storeGeneratedXmlAsAsset({
      supabase,
      companyId,
      fileName: `${fileBase}.xml`,
      xmlString: xml,
      assetType: `XML_ZUGFERD_${docType}`,
    });

    const { error } = await supabase
      .from(table)
      .update({
        DOCUMENT_XML_CII_ASSET_ID:    asset?.ID ?? null,
        DOCUMENT_XML_CII_PROFILE:     CII_SNAPSHOT_PROFILE_KEY,
        DOCUMENT_XML_CII_RENDERED_AT: new Date().toISOString(),
      })
      .eq("ID", docId);

    // Fehlt die Migration, schlaegt genau dieses Update fehl. Dann muss das
    // eben erzeugte Asset wieder weg — sonst liegt eine Datei im Speicher,
    // auf die nichts verweist und die niemand je wiederfindet.
    if (error) throw new Error(error.message);

    return { assetId: asset.ID, profile: CII_SNAPSHOT_PROFILE_KEY };
  } catch (e) {
    await bestEffortDeleteAsset({ supabase, asset });
    console.warn("[EINVOICE_CII_SNAPSHOT] nicht eingefroren, Abruf bleibt live", {
      doc_type: docType, doc_id: docId, error: e?.message || String(e),
    });
    return null;
  }
}

module.exports = {
  freezeCiiSnapshot,
  CII_SNAPSHOT_PROFILE,
  CII_SNAPSHOT_PROFILE_KEY,
};
