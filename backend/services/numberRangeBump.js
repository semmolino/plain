"use strict";

// ---------------------------------------------------------------------------
// Den Rechnungsnummern-Zaehler nach einem Belegimport anheben.
//
// WARUM ES DAS BRAUCHT
//   Ein Beleg mit eigener Nummer aus dem Altsystem laeuft an der Nummernvergabe
//   vorbei: services/invoices.js ruft next_document_number() nur, WENN das Feld
//   leer ist. Der Zaehler bewegt sich dabei nicht.
//
//   Harmlos ist das nur bei Belegen aus vergangenen Jahren — der Zaehler laeuft
//   je Jahr. Sobald ein Beleg aus dem LAUFENDEN Jahr dabei ist, vergibt
//   plan&simple beim naechsten Mal eine Nummer, die es schon gibt. Und es gibt
//   nirgends einen Unique-Index auf INVOICE_NUMBER oder
//   ADVANCE_INVOICE_NUMBER: die Datenbank faengt das nicht ab.
//
// WARUM MIT KASKADE UND NICHT MIT EINEM REGEX
//   Die Altnummern folgen dem Format von plan&simple (RE-JJJJ-NNNN) im Zweifel
//   gar nicht. Sie koennen ein anderes Praefix tragen, ein anderes Trennzeichen,
//   gar keine Jahreszahl oder durchlaufend nummeriert sein. Jede Form, die sich
//   nicht sicher deuten laesst, wird deshalb NICHT geraten, sondern namentlich
//   gemeldet — der Zaehler laesst sich nicht wieder senken.
// ---------------------------------------------------------------------------

// Ueber diesem Wert ist eine "laufende Nummer" keine mehr, sondern eine
// verstuemmelte Kennung. Ohne den Deckel hebt eine Nummer wie 2019004711234
// den Zaehler in den Unsinn — und zurueck geht es nicht.
const MAX_ZAEHLER = 99999;

const IST_JAHR = (n) => Number.isFinite(n) && n >= 1900 && n <= 2999;

/**
 * Jahr und laufende Nummer aus einer Belegnummer lesen.
 *
 * @param {string} raw            die Nummer, wie sie im Altsystem steht
 * @param {number} [fallbackJahr] Jahr des Belegdatums — greift, wenn die Nummer
 *                                selbst keine Jahreszahl traegt
 * @returns {{jahr:number, zaehler:number}|null}  null = nicht deutbar
 */
function parseDocumentNumber(raw, fallbackJahr) {
  const text = String(raw ?? "").trim();
  if (!text) return null;

  const zahlen = text.match(/\d+/g) || [];
  if (zahlen.length === 0) return null;      // gar keine Ziffer: nicht deutbar

  // A) Praefix – Jahr – Zaehler, das haeufigste Muster:
  //    RE-2025-0044, AR 2025/7, 2025-123
  const a = text.match(/^[^\d]*((?:19|20)\d{2})[-/. ]+(\d{1,6})$/);
  if (a) {
    const zaehler = parseInt(a[2], 10);
    return zaehler <= MAX_ZAEHLER ? { jahr: parseInt(a[1], 10), zaehler } : null;
  }

  // B) Irgendwo eine Jahreszahl UND mindestens eine weitere Ziffernfolge:
  //    R2025/0123, 2025-RE-123. Der Zaehler ist dann die LETZTE Ziffernfolge —
  //    die Jahreszahl selbst scheidet dafuer aus.
  const jahrToken = zahlen.find((z) => z.length === 4 && IST_JAHR(parseInt(z, 10)));
  if (jahrToken && zahlen.length > 1) {
    const rest = [...zahlen];
    rest.splice(rest.lastIndexOf(jahrToken), 1);
    const zaehler = parseInt(rest[rest.length - 1], 10);
    return zaehler <= MAX_ZAEHLER ? { jahr: parseInt(jahrToken, 10), zaehler } : null;
  }

  // C) Keine Jahreszahl in der Nummer — durchlaufende Nummerierung. Das Jahr
  //    kommt dann vom Belegdatum.
  if (!IST_JAHR(Number(fallbackJahr))) return null;
  const zaehler = parseInt(zahlen[zahlen.length - 1], 10);
  return zaehler <= MAX_ZAEHLER ? { jahr: Number(fallbackJahr), zaehler } : null;
}

/**
 * Aus den geschriebenen Belegen ableiten, auf welchen Stand die Zaehler muessen.
 *
 * Gruppiert wird nach Firma UND Jahr, weil document_number_range genau so
 * gefuehrt wird. Belege ohne deutbare Nummer kommen namentlich zurueck — sie
 * gehoeren in die Abschlussmeldung, nicht in ein Protokoll.
 *
 * @param {Array} belege  [{ companyId, nummer, datum }]
 * @returns {{anheben: Array<{companyId, jahr, minNext}>, ungedeutet: string[]}}
 */
function planeBump(belege) {
  const max = new Map();          // "firma|jahr" -> hoechster Zaehler
  const ungedeutet = [];
  const ohneJahrToken = new Map(); // firma -> hoechster Zaehler aus Fall C

  for (const b of belege || []) {
    const nummer = String(b?.nummer ?? "").trim();
    if (!nummer || b?.companyId == null) continue;

    const jahrAusDatum = Number(String(b?.datum ?? "").slice(0, 4));
    const teil = parseDocumentNumber(nummer, jahrAusDatum);
    if (!teil) { ungedeutet.push(nummer); continue; }

    const key = `${b.companyId}|${teil.jahr}`;
    max.set(key, Math.max(max.get(key) ?? 0, teil.zaehler));

    // Traegt die Nummer selbst keine Jahreszahl, ist die Nummerierung
    // durchlaufend. Dann reicht es nicht, das Jahr des Belegs anzuheben: die
    // naechste Nummer wird im LAUFENDEN Jahr vergeben, und die muss ueber
    // allem liegen, was das Altsystem je verbraucht hat.
    if (!/(?:19|20)\d{2}/.test(nummer)) {
      ohneJahrToken.set(b.companyId, Math.max(ohneJahrToken.get(b.companyId) ?? 0, teil.zaehler));
    }
  }

  const anheben = [];
  for (const [key, zaehler] of max) {
    const [companyId, jahr] = key.split("|");
    anheben.push({ companyId: Number(companyId), jahr: Number(jahr), minNext: zaehler + 1 });
  }

  const heuer = new Date().getFullYear();
  for (const [companyId, zaehler] of ohneJahrToken) {
    const vorhanden = anheben.find((a) => a.companyId === companyId && a.jahr === heuer);
    if (vorhanden) vorhanden.minNext = Math.max(vorhanden.minNext, zaehler + 1);
    else anheben.push({ companyId, jahr: heuer, minNext: zaehler + 1, wegenDurchlaufend: true });
  }

  anheben.sort((a, b) => a.companyId - b.companyId || a.jahr - b.jahr);
  return { anheben, ungedeutet };
}

/**
 * Die geplanten Anhebungen ausfuehren. Der Zaehler steigt oder bleibt — die
 * Datenbankfunktion sorgt mit GREATEST dafuer, dass er nie faellt.
 */
async function bumpNumberRanges(supabase, belege) {
  const { anheben, ungedeutet } = planeBump(belege);
  const ergebnis = [];

  for (const a of anheben) {
    const { data, error } = await supabase.rpc("bump_document_number_range", {
      p_company_id: a.companyId,
      p_year:       a.jahr,
      p_min_next:   a.minNext,
    });
    // Ein Fehler hier darf den Import nicht kippen: die Belege stehen bereits.
    // Er gehoert aber in die Abschlussmeldung, nicht ins Protokoll — sonst
    // vergibt der Kunde spaeter eine Nummer, die es schon gibt.
    ergebnis.push({
      ...a,
      standJetzt: error ? null : (typeof data === "number" ? data : a.minNext),
      fehler: error ? (error.message || String(error)) : null,
    });
  }

  return { angehoben: ergebnis, ungedeutet };
}

module.exports = { parseDocumentNumber, planeBump, bumpNumberRanges, MAX_ZAEHLER };
