"use strict";

/**
 * Tests zu Befund M8 des Sicherheitsaudits vom 2026-09-03.
 *
 * 376 Stellen antworteten mit der Original-Datenbankmeldung. Fuer Nutzer
 * unbrauchbar, fuer jemanden, der das System sondiert, eine Landkarte.
 * Entscheidend ist die Trennlinie: fachliche Fehler (< 500) muessen
 * unveraendert ankommen, Serverfehler nicht.
 */

const { makeMiddleware, GENERISCHE_MELDUNG } = require("../middleware/errorSanitizer");

/** Minimaler res-Doppelgaenger mit dem echten json-Umbau darauf. */
function fakeRes(statusCode) {
  const res = {
    statusCode,
    gesendet: null,
    json(body) { this.gesendet = body; return this; },
  };
  return res;
}

function durchleiten(statusCode, body, req = {}) {
  const mw = makeMiddleware();
  const res = fakeRes(statusCode);
  mw({ method: "GET", originalUrl: "/api/v1/test", ...req }, res, () => {});
  res.json(body);
  return res.gesendet;
}

describe("errorSanitizer", () => {
  let fehlerLog;
  beforeEach(() => { fehlerLog = jest.spyOn(console, "error").mockImplementation(() => {}); });
  afterEach(() => fehlerLog.mockRestore());

  describe("Serverfehler (>= 500)", () => {
    it("ersetzt eine Datenbankmeldung durch eine allgemeine", () => {
      const raus = durchleiten(500, { error: 'new row violates row-level security policy for table "INVOICE"' });
      expect(raus.error).toBe(GENERISCHE_MELDUNG);
      expect(JSON.stringify(raus)).not.toMatch(/INVOICE|row-level|policy/);
    });

    it("verraet keine Spalten- oder Tabellennamen", () => {
      const raus = durchleiten(500, { error: 'column "SE_AMOUNT" of relation "PARTIAL_PAYMENT" does not exist' });
      expect(JSON.stringify(raus)).not.toMatch(/SE_AMOUNT|PARTIAL_PAYMENT|relation/);
    });

    it("vergibt eine Fehlerkennung und protokolliert sie mit dem Original", () => {
      const raus = durchleiten(500, { error: "kaputt in Tabelle X" }, { tenantId: 4, employeeId: 9 });
      expect(raus.ref).toMatch(/^[0-9a-f]{6}$/);
      const zeile = fehlerLog.mock.calls[0][0];
      expect(zeile).toContain(raus.ref);
      expect(zeile).toContain("kaputt in Tabelle X");  // vollstaendig im Protokoll
      expect(zeile).toContain("Mandant 4");
      expect(zeile).toContain("Mitarbeiter 9");
    });

    it("behaelt die uebrigen Felder — das Frontend wertet Flags aus", () => {
      const raus = durchleiten(500, { error: "db kaputt", limit_reached: true, capability: "limits.storage_mb" });
      expect(raus.limit_reached).toBe(true);
      expect(raus.capability).toBe("limits.storage_mb");
    });

    it("laesst als userFacing gekennzeichnete Meldungen durch", () => {
      const raus = durchleiten(500, { error: "E-Mail-Versand nicht konfiguriert.", userFacing: true });
      expect(raus.error).toBe("E-Mail-Versand nicht konfiguriert.");
    });

    it("sendet den Marker nicht mit", () => {
      const raus = durchleiten(500, { error: "Etwas fuer den Nutzer", userFacing: true });
      expect(raus).not.toHaveProperty("userFacing");
    });

    it("gilt auch fuer 502/503", () => {
      expect(durchleiten(503, { error: "upstream weg" }).error).toBe(GENERISCHE_MELDUNG);
    });
  });

  describe("Entwicklungsmodus", () => {
    const ALT = process.env.NODE_ENV;
    afterEach(() => { process.env.NODE_ENV = ALT; });

    it("laesst die Originalmeldung durch, wenn NODE_ENV ausdruecklich development ist", () => {
      process.env.NODE_ENV = "development";
      const raus = durchleiten(500, { error: 'relation "TEC" does not exist' });
      expect(raus.error).toContain("TEC");
      expect(raus.dev).toBe(true);
      expect(raus.ref).toMatch(/^[0-9a-f]{6}$/);
    });

    it.each(["production", "", "produktion", "prod", "staging", undefined])(
      "neutralisiert bei NODE_ENV=%s — nur ein ausdrueckliches development oeffnet",
      (wert) => {
        // Die Umkehrung (!== "production") waere die Falle: ein vertipptes
        // oder fehlendes NODE_ENV wuerde den Schutz still abschalten.
        if (wert === undefined) delete process.env.NODE_ENV;
        else process.env.NODE_ENV = wert;
        expect(durchleiten(500, { error: 'relation "TEC" does not exist' }).error).toBe(GENERISCHE_MELDUNG);
      }
    );
  });

  describe("Fachliche Fehler (< 500) bleiben unberuehrt", () => {
    it.each([
      [400, "Pflichtfeld fehlt"],
      [401, "Sitzung abgelaufen oder ungültig. Bitte neu anmelden."],
      [402, "Diese Funktion ist in deinem Tarif nicht enthalten."],
      [403, "Fehlende Berechtigung: invoices.edit"],
      [404, "Nicht gefunden."],
      [409, "Diese E-Mail-Adresse gehört zu mehreren Konten."],
      [429, "Zu viele Versuche. Bitte später erneut versuchen."],
    ])("%i behaelt seine Meldung", (status, meldung) => {
      expect(durchleiten(status, { error: meldung }).error).toBe(meldung);
    });

    it("protokolliert fachliche Fehler nicht als Serverfehler", () => {
      durchleiten(400, { error: "Pflichtfeld fehlt" });
      expect(fehlerLog).not.toHaveBeenCalled();
    });
  });

  describe("Erfolgsantworten", () => {
    it("bleiben unangetastet", () => {
      const daten = { data: [{ ID: 1, NAME: "Projekt" }] };
      expect(durchleiten(200, daten)).toEqual(daten);
    });

    it("auch wenn ein Feld zufaellig 'error' heisst", () => {
      // 200 mit error-Feld: kommt bei Sammelantworten vor (Import-Report).
      const raus = durchleiten(200, { data: [], error: "Zeile 4: Datum unlesbar" });
      expect(raus.error).toBe("Zeile 4: Datum unlesbar");
    });
  });
});
