"use strict";

/**
 * Fehlversuchsbremse je KONTO (Sicherheitsaudit 2026-09-03, N6).
 *
 * WAS BISHER FEHLTE
 *   Der Login-Limiter zählt pro IP-Adresse. Wer über viele Adressen verteilt
 *   probiert — Botnetz, Mobilfunk-NAT, ein Dutzend Cloud-Instanzen — läuft
 *   daran vorbei: jede Adresse hat ihre eigenen 15 Versuche. Auf ein einzelnes
 *   Konto gerichtet ergibt das beliebig viele Rateversuche.
 *
 * WARUM BREMSEN UND NICHT SPERREN
 *   Eine harte Kontosperre ist selbst eine Waffe: wer die E-Mail-Adresse der
 *   Geschäftsleitung kennt, sperrt sie mit zehn falschen Passwörtern aus dem
 *   eigenen System aus — am Monatsende, wenn Rechnungen rausgehen müssen. Der
 *   Angreifer braucht dafür nicht einmal einen Treffer.
 *
 *   Deshalb wird nur verzögert. Die Wirkung auf einen Rateangriff ist
 *   drastisch: statt einiger hundert Versuche pro Minute sind es nach kurzer
 *   Zeit weniger als zwanzig. Für den rechtmäßigen Nutzer, der sich zweimal
 *   vertippt, ändert sich nichts — die Bremse greift erst ab dem sechsten
 *   Fehlversuch, und ein erfolgreicher Login löscht den Zähler sofort.
 *
 * ZUSTAND IM ARBEITSSPEICHER
 *   Bewusst keine Datenbankspalte: das Fenster ist kurz, und wer auf einen
 *   Neustart wartet, um weiterzuraten, hat nichts gewonnen — die Bremse setzt
 *   danach schlicht neu ein. Ein Neustart darf zudem niemanden aussperren.
 *   Bei mehreren Instanzen zählt jede für sich; das schwächt die Bremse
 *   anteilig, hebt sie aber nicht auf (das IP-Limit greift weiterhin).
 */

const FENSTER_MS = 15 * 60 * 1000;
const FREIVERSUCHE = 5;          // so oft darf sich jeder vertippen, ohne Bremse
const STUFE_MS = 400;            // Zuwachs je weiterem Fehlversuch
const MAX_VERZOEGERUNG_MS = 4000; // Deckel: ein Handler soll nicht ewig offen liegen

const isTest = process.env.NODE_ENV === "test";

const versuche = new Map(); // konto -> { anzahl, resetAt }

/** Gleiche Adresse, gleiches Konto — unabhängig von Schreibweise und Rand. */
function schluessel(email) {
  return String(email || "").trim().toLowerCase();
}

function eintrag(konto) {
  const jetzt = Date.now();
  const vorhanden = versuche.get(konto);
  if (!vorhanden || jetzt > vorhanden.resetAt) {
    const neu = { anzahl: 0, resetAt: jetzt + FENSTER_MS };
    versuche.set(konto, neu);
    return neu;
  }
  return vorhanden;
}

/**
 * Wie lange dieser Anmeldeversuch warten soll (Millisekunden, 0 = sofort).
 * Rein lesend — der Zähler steigt erst mit registriereFehlversuch().
 */
function verzoegerungFuer(email) {
  if (isTest) return 0;
  const e = versuche.get(schluessel(email));
  if (!e || Date.now() > e.resetAt) return 0;
  const ueber = e.anzahl - FREIVERSUCHE;
  if (ueber <= 0) return 0;
  return Math.min(ueber * STUFE_MS, MAX_VERZOEGERUNG_MS);
}

/** Nach einem fehlgeschlagenen Versuch aufrufen. */
function registriereFehlversuch(email) {
  if (isTest) return;
  const e = eintrag(schluessel(email));
  e.anzahl += 1;
}

/** Nach einem erfolgreichen Login aufrufen — die Bremse ist dann erledigt. */
function loescheFehlversuche(email) {
  versuche.delete(schluessel(email));
}

/** Bremst den aktuellen Versuch aus, sofern für dieses Konto etwas ansteht. */
async function bremsen(email) {
  const ms = verzoegerungFuer(email);
  if (ms > 0) await new Promise((r) => setTimeout(r, ms));
  return ms;
}

// Aufräumen, damit die Map nicht wächst. unref: der Timer darf den Prozess
// nicht am Beenden hindern (sonst hängen Tests und ein Neustart).
const aufraeumer = setInterval(() => {
  const jetzt = Date.now();
  for (const [konto, e] of versuche) if (jetzt > e.resetAt) versuche.delete(konto);
}, 5 * 60 * 1000);
aufraeumer.unref?.();

module.exports = {
  bremsen,
  registriereFehlversuch,
  loescheFehlversuche,
  verzoegerungFuer,
  _versuche: versuche,
  _konstanten: { FENSTER_MS, FREIVERSUCHE, STUFE_MS, MAX_VERZOEGERUNG_MS },
};
