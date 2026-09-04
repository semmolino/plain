"use strict";

/**
 * Sichere Auslieferung hochgeladener Dateien.
 *
 * WARUM ZENTRAL
 *   Der MIME-Typ in ASSET.MIME_TYPE stammt aus dem Upload, also vom Nutzer.
 *   Wird er ungeprueft als Content-Type gesetzt und die Datei mit
 *   "inline" ausgeliefert, laeuft ein hochgeladenes SVG als Dokument im
 *   Origin der Anwendung. Die CSP ist projektweit abgeschaltet (SPA-Bundles,
 *   PDF-Auslieferung) und das JWT liegt im localStorage — ein solches SVG
 *   liest damit die Sitzung jedes Kollegen, der den Link oeffnet
 *   (Sicherheitsaudit 2026-09-03, H1).
 *
 *   routes/branding.js hatte das bereits geloest, routes/assets.js und
 *   routes/service.js nicht. Genau dieses Auseinanderlaufen — eine Stelle
 *   behoben, die Zwillingsstelle nicht — ist das wiederkehrende Muster in
 *   diesem Projekt. Deshalb hier EINE Funktion statt drei Kopien.
 *
 * WAS SIE TUT
 *   • Bilder und PDF gehen weiter "inline" durch: Vorschauen, <img>-Tags und
 *     der eingebettete PDF-Betrachter funktionieren unveraendert.
 *   • Alles andere wird zu application/octet-stream und "attachment" — es
 *     wird heruntergeladen statt im Origin ausgefuehrt.
 *   • JEDE Antwort traegt eine Sandbox-CSP. Das ist der eigentliche Schutz
 *     fuer SVG: das Bild wird weiter angezeigt, aber Skripte darin laufen
 *     nicht. Ohne sie muesste man SVG-Vorschauen aufgeben.
 *   • nosniff, damit der Browser den deklarierten Typ nicht ueberstimmt.
 */

/** Inline unbedenklich: vom Browser als Bild bzw. im PDF-Betrachter gerendert. */
const INLINE_ERLAUBT = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "image/svg+xml",   // nur zusammen mit der Sandbox-CSP unten
  "application/pdf",
]);

/**
 * RFC 5987: Dateinamen mit Umlauten ("Angebot Müller.pdf") brechen den
 * Header, wenn sie roh eingesetzt werden. encodeURIComponent allein ist
 * falsch — es macht aus dem Namen im Downloaddialog "Angebot%20M%C3%BCller".
 * Deshalb ASCII-Fassung plus filename*.
 */
function dispositionHeader(art, dateiname) {
  const name = String(dateiname || "datei");
  const ascii = name.replace(/[^\x20-\x7E]/g, "_").replace(/["\\]/g, "_");
  return `${art}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

/**
 * Setzt die Kopfzeilen und leitet den Inhalt weiter.
 *
 * @param {import("express").Response} res
 * @param {import("stream").Readable|Buffer} inhalt  Stream oder Puffer
 * @param {string|null} mimeTyp    wie gespeichert (nicht vertrauenswuerdig)
 * @param {string|null} dateiname  wie gespeichert (nicht vertrauenswuerdig)
 */
function sendeDateiSicher(res, inhalt, mimeTyp, dateiname) {
  const mime = String(mimeTyp || "").toLowerCase().trim();
  const darfInline = INLINE_ERLAUBT.has(mime);

  res.setHeader("Content-Type", darfInline ? mime : "application/octet-stream");
  res.setHeader("Content-Disposition", dispositionHeader(darfInline ? "inline" : "attachment", dateiname));
  res.setHeader("X-Content-Type-Options", "nosniff");
  // Kein Skript, kein Plugin, keine eigene Herkunft — auch wenn der Inhalt
  // ein SVG ist. Gilt nur fuer diese Antwort, nicht fuer die Anwendung.
  res.setHeader("Content-Security-Policy", "sandbox; default-src 'none'; img-src data: blob:; style-src 'unsafe-inline'");

  if (Buffer.isBuffer(inhalt)) return res.end(inhalt);
  return inhalt.pipe(res);
}

module.exports = { sendeDateiSicher, INLINE_ERLAUBT };
