"use strict";

/**
 * Nachbearbeitung fertiger Brief-PDFs (Vorlagen-Plan Stufe 4).
 *
 * Drei Dinge lassen sich im HTML nicht ausdruecken und laufen deshalb hier,
 * auf dem PDF, das Chromium erzeugt hat:
 *
 *   Briefpapier  Ein eigenes PDF als Hintergrund. Es muss UNTER dem Inhalt
 *                liegen — ein Bild im HTML laege im Satzspiegel und ueberdeckte
 *                nichts am Rand; ein drawPage() von pdf-lib zeichnete darueber.
 *                Deshalb wird der Hintergrund als eigener Inhaltsstrom VOR die
 *                vorhandenen gestellt.
 *   Falzmarken   liegen 5–10 mm vom linken Blattrand, also im Seitenrand, den
 *                Chromium nicht bedruckt.
 *   Folgeseiten  „Rechnung RE-… · Empfaenger" oben ab Seite 2. Chromiums
 *                Kopfzeile erscheint auf jeder Seite und laesst sich ohne
 *                JavaScript nicht auf Folgeseiten beschraenken.
 *
 * Ohne Optionen kommt das PDF unveraendert zurueck — das bisherige Aussehen
 * kostet keinen zweiten Durchlauf.
 */

const {
  PDFDocument, StandardFonts, rgb,
  pushGraphicsState, popGraphicsState, concatTransformationMatrix, drawObject,
} = require("pdf-lib");
const storage = require("./objectStorage");
const { findAssetForTenant } = require("./assetAccess");

const MM = 72 / 25.4;
const GREY = rgb(0.55, 0.55, 0.55);

// Falzmarken je DIN-Form (mm von oben); Lochmarke immer auf Blattmitte.
const FOLDS = { A: [87, 192], B: [105, 210] };
const PUNCH_MM = 148.5;

/** Legt die erste Seite des Briefpapiers unter den Inhalt einer Seite. */
function underlay(doc, page, embedded) {
  const name = page.node.newXObject("PsLetterhead", embedded.ref);
  const { width, height } = page.getSize();
  const ops = [
    pushGraphicsState(),
    concatTransformationMatrix(width / embedded.width, 0, 0, height / embedded.height, 0, 0),
    drawObject(name),
    popGraphicsState(),
  ];
  const ref = doc.context.register(doc.context.contentStream(ops));
  page.node.normalizedEntries().Contents.insert(0, ref);
}

/** Zeichen, die die Standardschrift (WinAnsi) nicht kennt, fallen weg. */
function winAnsiSafe(font, text) {
  let out = "";
  for (const ch of String(text || "")) {
    try { font.encodeText(ch); out += ch; } catch (_) { out += ch === "−" ? "-" : ""; }
  }
  return out;
}

/**
 * @param pdfBytes  Buffer/Uint8Array aus page.pdf()
 * @param opts      { letterhead?: { bytes, pages: 'first'|'all' },
 *                    foldMarks?: { din: 'A'|'B'|'none' },
 *                    followHeader?: string }
 */
async function finishPdf(pdfBytes, opts = {}) {
  const { letterhead, foldMarks, followHeader } = opts;
  if (!(letterhead && letterhead.bytes) && !foldMarks && !followHeader) return pdfBytes;

  const doc = await PDFDocument.load(pdfBytes);
  const pages = doc.getPages();

  if (letterhead && letterhead.bytes) {
    try {
      const [bg] = await doc.embedPdf(letterhead.bytes, [0]);
      for (const page of letterhead.pages === "all" ? pages : pages.slice(0, 1)) underlay(doc, page, bg);
    } catch (e) {
      // Ein defektes oder verschluesseltes Briefpapier darf keinen Beleg verhindern.
      console.warn("[PDF_FINISH] Briefpapier nicht verwendbar:", e?.message || e);
    }
  }

  if (foldMarks && pages[0]) {
    const p = pages[0];
    const h = p.getHeight();
    const line = (yMm, len) => p.drawLine({
      start: { x: 5 * MM, y: h - yMm * MM }, end: { x: (5 + len) * MM, y: h - yMm * MM }, thickness: 0.4, color: GREY,
    });
    for (const y of FOLDS[foldMarks.din === "A" ? "A" : "B"]) line(y, 5);
    line(PUNCH_MM, 7);
  }

  if (followHeader && pages.length > 1) {
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const text = winAnsiSafe(font, followHeader).slice(0, 140);
    for (const p of pages.slice(1)) {
      p.drawText(text, { x: 25 * MM, y: p.getHeight() - 9 * MM, size: 7.5, font, color: GREY });
    }
  }

  return Buffer.from(await doc.save());
}

/**
 * Briefpapier des Mandanten laden: nur ein eigenes Asset, nur PDF. Fehlt es
 * oder passt es nicht, wird ohne Briefpapier gedruckt.
 */
async function loadLetterhead({ supabase, tenantId, assetId }) {
  if (!assetId) return null;
  try {
    const asset = await findAssetForTenant(supabase, assetId, tenantId, "*");
    if (!asset || asset.MIME_TYPE !== "application/pdf" || !asset.STORAGE_KEY) return null;
    const buf = await storage.getBuffer(asset.STORAGE_KEY);
    if (!buf || buf.subarray(0, 5).toString("latin1") !== "%PDF-") return null;
    return buf;
  } catch (e) {
    console.warn("[PDF_FINISH] Briefpapier nicht lesbar:", e?.message || e);
    return null;
  }
}

/**
 * Optionen fuer finishPdf aus dem Theme.
 * @param follow  Text fuer den Folgeseitenkopf, z. B. „Rechnung RE-1 · Kunde"
 */
async function finishOptions({ supabase, tenantId, theme, follow }) {
  const layout = (theme && theme.layout) || {};
  const lh = (theme && theme.letterhead) || {};
  const bytes = lh.assetId ? await loadLetterhead({ supabase, tenantId, assetId: lh.assetId }) : null;
  return {
    letterhead: bytes ? { bytes, pages: lh.pages === "all" ? "all" : "first" } : null,
    foldMarks: layout.foldMarks ? { din: layout.din } : null,
    followHeader: layout.followHeader && follow ? follow : null,
    // Fusszeile weglassen, wenn das Briefpapier sie traegt
    hideFooter: !!(bytes && lh.hideFooter),
  };
}

module.exports = { finishPdf, finishOptions, loadLetterhead, FOLDS, PUNCH_MM };
