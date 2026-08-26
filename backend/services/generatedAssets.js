"use strict";

// ============================================================================
// generatedAssets.js — erzeugte Dokumente ablegen, ausliefern, loeschen
//
// WARUM ES DAS GIBT
//   Diese sechs Funktionen standen dreifach im Baum: in services/invoices.js,
//   services/finalInvoices.js und services/partialPayments.js — zeichengleich
//   bis auf eine Abweichung, die schon Folgen hatte: streamXmlAsset setzte in
//   partialPayments.js keine No-Cache-Header, in invoices.js schon. Derselbe
//   Name, dasselbe Verhalten erwartet, unterschiedliches Ergebnis.
//
//   Mit der Umstellung auf den Objektspeicher waere dieselbe Aenderung dreimal
//   faellig geworden. Deshalb hier zusammengefuehrt: eine Stelle, ein
//   Verhalten. Die drei Services exportieren die Namen unveraendert weiter,
//   die Controller merken davon nichts.
//
// ABLAGE
//   Nicht mehr fs.*, sondern services/objectStorage. Der STORAGE_KEY bleibt
//   exakt derselbe wie zuvor ("<companyId>/generated/<uuid>.<ext>"), damit
//   bestehende ASSET-Zeilen ohne Datenmigration weiter zeigen, wohin sie
//   sollen.
// ============================================================================

const crypto = require("crypto");
const storage = require("./objectStorage");
const { findAssetForTenant } = require("./assetAccess");

function safeFileName(name, fallback) {
  const base = String(name || fallback || "document").replace(/[\/:*?"<>|]+/g, "_").trim();
  return base.length ? base : "document";
}

// Mandantengebunden aufloesen statt allein ueber die ID. Die Aufrufer holen
// die Asset-ID zwar aus einer bereits tenant-gefilterten Rechnung — damit
// haengt die Sicherheit aber an der Disziplin der Aufrufer, nicht an der
// Struktur. Diese Schranke macht sie unabhaengig davon (Pentest 2026-08-06,
// nachrangige Beobachtung zu streamPdfAsset/streamXmlAsset).
async function loadAssetRow({ supabase, assetId, tenantId }) {
  return findAssetForTenant(supabase, assetId, tenantId, "*");
}

// Erzeugte Belege duerfen weder im Browser noch in einem Zwischenspeicher
// haengen bleiben: sie koennen storniert und neu erzeugt werden, und dann
// waere die alte Fassung die sichtbare. Galt bisher nur fuer einen Teil der
// Aufrufe — jetzt fuer alle.
function setNoStore(res) {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
}

async function streamPdfAsset({ supabase, res, assetId, tenantId, dispositionName, download }) {
  const asset = await loadAssetRow({ supabase, assetId, tenantId });
  if (!asset) return res.status(404).json({ error: "PDF asset not found" });

  const obj = await storage.getStream(asset.STORAGE_KEY);
  if (!obj) return res.status(404).json({ error: "PDF file missing on disk" });

  res.setHeader("Content-Type", "application/pdf");
  const disp = download ? "attachment" : "inline";
  res.setHeader("Content-Disposition", `${disp}; filename="${encodeURIComponent(dispositionName || asset.FILE_NAME || "document.pdf")}"`);
  setNoStore(res);
  obj.stream.pipe(res);
  return true;
}

async function streamXmlAsset({ supabase, res, assetId, tenantId, dispositionName, download }) {
  const asset = await loadAssetRow({ supabase, assetId, tenantId });
  if (!asset) throw new Error("XML asset not found");

  const obj = await storage.getStream(asset.STORAGE_KEY);
  if (!obj) throw new Error("XML file missing on disk");

  res.setHeader("Content-Type", "application/xml; charset=utf-8");
  const disp = download ? "attachment" : "inline";
  res.setHeader("Content-Disposition", `${disp}; filename="${encodeURIComponent(dispositionName || asset.FILE_NAME || "document.xml")}"`);
  setNoStore(res);
  obj.stream.pipe(res);
  return true;
}

// Eingefrorenes XML als String lesen -- fuer Verbraucher, die es weiter-
// verarbeiten statt auszuliefern (das Hybrid-PDF bettet es ein).
// Gibt null zurueck, wenn Zeile oder Datei fehlen; der Aufrufer faellt dann
// auf den Live-Pfad zurueck.
async function readXmlAssetString({ supabase, assetId, tenantId }) {
  if (!assetId) return null;
  try {
    const asset = await loadAssetRow({ supabase, assetId, tenantId });
    if (!asset?.STORAGE_KEY) return null;
    const buf = await storage.getBuffer(asset.STORAGE_KEY);
    return buf ? buf.toString('utf8') : null;
  } catch (_) {
    return null;
  }
}

// Gemeinsamer Kern fuer PDF und XML. Die beiden oeffentlichen Funktionen
// darunter unterscheiden sich nur in Endung, MIME-Typ und Vorgabewert.
async function storeGeneratedAsset({ supabase, companyId, fileName, buffer, ext, mimeType, assetType, fallbackName }) {
  const storageKey = `${companyId}/generated/${crypto.randomUUID()}.${ext}`;
  await storage.put(storageKey, buffer, { contentType: mimeType });

  const row = {
    COMPANY_ID: companyId,
    ASSET_TYPE: assetType,
    FILE_NAME: safeFileName(fileName, fallbackName),
    MIME_TYPE: mimeType,
    FILE_SIZE: Buffer.byteLength(buffer),
    STORAGE_KEY: storageKey,
    SHA256: crypto.createHash("sha256").update(buffer).digest("hex"),
  };

  const { data, error } = await supabase.from("ASSET").insert([row]).select("*").maybeSingle();
  if (error) {
    // Die Datei liegt bereits im Speicher, die Zeile fehlt — ohne Aufraeumen
    // bliebe ein Objekt zurueck, auf das nichts mehr verweist und das niemand
    // je wiederfindet. Es zaehlt aber weiter gegen das Speicherlimit.
    await storage.remove(storageKey).catch(() => {});
    throw new Error(error.message);
  }
  return data;
}

async function storeGeneratedPdfAsAsset({ supabase, companyId, fileName, pdfBuffer, assetType }) {
  return storeGeneratedAsset({
    supabase, companyId, fileName,
    buffer: Buffer.from(pdfBuffer),
    ext: "pdf",
    mimeType: "application/pdf",
    assetType: assetType || "PDF",
    fallbackName: "document.pdf",
  });
}

async function storeGeneratedXmlAsAsset({ supabase, companyId, fileName, xmlString, assetType }) {
  return storeGeneratedAsset({
    supabase, companyId, fileName,
    buffer: Buffer.from(String(xmlString || ""), "utf8"),
    ext: "xml",
    mimeType: "application/xml",
    assetType: assetType || "XML",
    fallbackName: "document.xml",
  });
}

async function bestEffortDeleteAsset({ supabase, asset }) {
  try {
    if (asset?.STORAGE_KEY) await storage.remove(asset.STORAGE_KEY);
  } catch (_) {}
  try {
    if (asset?.ID) await supabase.from("ASSET").delete().eq("ID", asset.ID);
  } catch (_) {}
}

module.exports = {
  safeFileName,
  loadAssetRow,
  streamPdfAsset,
  streamXmlAsset,
  readXmlAssetString,
  storeGeneratedPdfAsAsset,
  storeGeneratedXmlAsAsset,
  bestEffortDeleteAsset,
};
