"use strict";

// Der Takt der zeitplangesteuerten Checker.
//
// ANLASS (2026-09-17): Die Oberflaeche laesst eine Uhrzeit auf die Minute
// genau einstellen, geprueft wurde aber nur stuendlich — und das Raster hing
// am Prozessstart. Gemessen: Start 17:32 UTC, Laeufe also 17:37, 18:37, 19:37;
// der Zeitplan stand auf 17:38 UTC. Der Lauf kam eine Minute zu frueh, der
// naechste 59 Minuten zu spaet, und nach dem naechsten Deploy laege das Raster
// wieder woanders. Aus Nutzersicht: "die Erinnerung kommt nicht".
//
// Dieser Test haelt die Regel fest, an der das scheiterte: der Takt muss
// feiner sein als die Genauigkeit, die die Oberflaeche verspricht. Er liest
// die Quelltexte, weil der Takt eine Konstante im Modul ist — ihn ueber einen
// echten Timer zu pruefen hiesse, im Test eine Stunde zu warten.

const fs   = require("node:fs");
const path = require("node:path");

const SERVICES = path.join(__dirname, "..", "services");

// Die Checker, die eine vom Nutzer eingestellte Uhrzeit einhalten muessen.
const ZEITPLAN_CHECKER = [
  "leistungsstandReminderChecker.js",
  "hoursBookingReminderChecker.js",
];

// Was die Oberflaeche zusagt: SCHEDULE_TIME_OF_DAY wird als HH:MM gepflegt.
const VERSPROCHENE_GENAUIGKEIT_MS = 60 * 1000;

function intervallVon(datei) {
  const quelle = fs.readFileSync(path.join(SERVICES, datei), "utf8");
  const treffer = quelle.match(/const\s+INTERVAL_MS\s*=\s*([^;]+);/);
  if (!treffer) throw new Error(`INTERVAL_MS in ${datei} nicht gefunden`);
  // Der Ausdruck ist bewusst als Rechnung geschrieben (60 * 1000) — so bleibt
  // im Quelltext lesbar, was gemeint ist.
  return Function(`"use strict"; return (${treffer[1]});`)();
}

describe("Zeitplan-Checker: der Takt haelt, was die Uhrzeit verspricht", () => {
  for (const datei of ZEITPLAN_CHECKER) {
    test(`${datei} prueft mindestens so oft, wie die Uhrzeit genau ist`, () => {
      expect(intervallVon(datei)).toBeLessThanOrEqual(VERSPROCHENE_GENAUIGKEIT_MS);
    });
  }

  test("ein Lauf ist idempotent — haeufiges Pruefen darf nichts doppelt senden", () => {
    // Die Absicherung dagegen steht nicht im Takt, sondern im Lauf selbst:
    // LAST_FIRED_DATE je Zeitplan und die ref_date-Pruefung je Empfaenger.
    // Faellt eine davon weg, wird aus minuetlichem Pruefen minuetliches Senden.
    for (const datei of ZEITPLAN_CHECKER) {
      const quelle = fs.readFileSync(path.join(SERVICES, datei), "utf8");
      expect(quelle).toContain("LAST_FIRED_DATE");
      expect(quelle).toMatch(/ref_date/);
    }
  });
});

describe("checkerHealth: der letzte Lauf mit Wirkung geht nicht im Takt unter", () => {
  test("ein leerer Lauf loescht nicht, was der letzte wirksame Lauf erzeugt hat", () => {
    const health = require("../services/checkerHealth");
    health._zuruecksetzen();

    health.melde("test_checker", { gesehen: 4, erstellt: 3 });
    const nachWirkung = health.status().checker.test_checker;
    expect(nachWirkung.zuletztErstellt).toBe(3);
    expect(nachWirkung.zuletztErstelltUm).toBeTruthy();

    // Der naechste minuetliche Lauf findet nichts mehr.
    health.melde("test_checker", { gesehen: 4, erstellt: 0 });
    const danach = health.status().checker.test_checker;
    expect(danach.erstellt).toBe(0);              // der letzte Lauf: leer
    expect(danach.zuletztErstellt).toBe(3);       // die Wirkung bleibt sichtbar
  });
});
