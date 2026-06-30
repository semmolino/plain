"use strict";

/**
 * imageStrip.js — entfernt Metadaten aus Bild-Uploads (Screenshots), ohne externe
 * Abhängigkeit. Ziel: keine ungewollten personenbezogenen/ortsbezogenen Daten
 * (EXIF/GPS, Kamera, Autor, Software-Tags) im Anhang. Siehe DATENSCHUTZ-Regeln in
 * docs/SERVICE_AREA_CONCEPT.md §1.2.
 *
 * - JPEG: entfernt alle APPn-Segmente (FFE0–FFEF, u. a. EXIF/APP1) und Kommentare (FFFE).
 * - PNG:  entfernt Text-/Metadaten-Chunks (tEXt, zTXt, iTXt, eXIf, tIME).
 * Unbekannte/andere Typen werden unverändert zurückgegeben (defensive No-Op).
 */

function stripJpeg(buf) {
  if (buf.length < 2 || buf[0] !== 0xff || buf[1] !== 0xd8) return buf; // kein JPEG
  const out = [Buffer.from([0xff, 0xd8])];
  let i = 2;
  while (i + 1 < buf.length) {
    if (buf[i] !== 0xff) { out.push(buf.slice(i)); break; } // unerwartet → Rest übernehmen
    const marker = buf[i + 1];
    // SOS (Bilddaten folgen) oder EOI → Rest unverändert anhängen.
    if (marker === 0xda || marker === 0xd9) { out.push(buf.slice(i)); break; }
    if (i + 3 >= buf.length) { out.push(buf.slice(i)); break; }
    const len = buf.readUInt16BE(i + 2);
    const segEnd = i + 2 + len;
    if (segEnd > buf.length) { out.push(buf.slice(i)); break; }
    const isApp = marker >= 0xe0 && marker <= 0xef;
    const isCom = marker === 0xfe;
    if (!isApp && !isCom) out.push(buf.slice(i, segEnd)); // Segment behalten
    i = segEnd;
  }
  return Buffer.concat(out);
}

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const PNG_DROP = new Set(["tEXt", "zTXt", "iTXt", "eXIf", "tIME"]);

function stripPng(buf) {
  if (buf.length < 8 || !buf.slice(0, 8).equals(PNG_SIG)) return buf;
  const out = [buf.slice(0, 8)];
  let i = 8;
  while (i + 8 <= buf.length) {
    const len = buf.readUInt32BE(i);
    const type = buf.slice(i + 4, i + 8).toString("latin1");
    const chunkEnd = i + 12 + len; // length(4) + type(4) + data(len) + crc(4)
    if (chunkEnd > buf.length) { out.push(buf.slice(i)); break; }
    if (!PNG_DROP.has(type)) out.push(buf.slice(i, chunkEnd));
    if (type === "IEND") break;
    i = chunkEnd;
  }
  return Buffer.concat(out);
}

/** Strippt Metadaten anhand des MIME-Typs. Gibt immer einen Buffer zurück. */
function stripImageMetadata(buffer, mime) {
  try {
    const m = String(mime || "").toLowerCase();
    if (m === "image/jpeg" || m === "image/jpg") return stripJpeg(buffer);
    if (m === "image/png") return stripPng(buffer);
    return buffer;
  } catch {
    return buffer; // im Zweifel Original (Upload soll nicht an einem Strip-Fehler scheitern)
  }
}

module.exports = { stripImageMetadata, stripJpeg, stripPng };
