"use strict";

/**
 * Tests zu Befund M6 des Sicherheitsaudits vom 2026-09-03.
 *
 * Die PDF-Erzeugung startet je Aufruf Playwright-Chromium; sie war
 * ungedrosselt. Wichtig ist hier nicht die Zahl, sondern WORAUF gezaehlt wird:
 * pro Konto, nicht pro IP — sonst sperrt sich ein Buero hinter einer
 * NAT-Adresse beim Rechnungslauf selbst aus.
 */

// Die Limiter selbst sind in NODE_ENV=test No-Ops (siehe make() in
// middleware/rateLimit.js). Geprueft werden deshalb die beiden Entscheidungen,
// die unabhaengig davon gelten: welcher Pfad als teuer gilt und welcher
// Schluessel gezaehlt wird.
const { _istTeuer: istTeuer } = require("../middleware/rateLimit");

describe("Rate-Limit fuer teure Endpunkte", () => {
  describe("Pfaderkennung", () => {
    it.each([
      "/1/pdf",
      "/123/pdf",
      "/reports/overview",
      "/report",
      "/1/einvoice/ubl",
      "/1/xml",
    ])("%s gilt als teuer", (pfad) => {
      expect(istTeuer({ path: pfad })).toBe(true);
    });

    it.each([
      "/",
      "/1",
      "/search",
      "/settings",
      "/1/attachments",
      "/pdfvorlage",          // kein eigener Pfadabschnitt
      "/exportierbar",
    ])("%s gilt nicht als teuer", (pfad) => {
      expect(istTeuer({ path: pfad })).toBe(false);
    });
  });

  describe("Zaehlschluessel", () => {
    // Die echte Schluesselfunktion, nicht ein Nachbau — genau hier lag der
    // Fehler: ipKeyGenerator nimmt die IP als String. Mit dem Request-Objekt
    // gab es ein Objekt zurueck, ohne zu werfen, und der Limiter waere still
    // unbrauchbar gewesen.
    const { _perKonto: perKonto } = require("../middleware/rateLimit");

    it("zaehlt auf den Mitarbeiter, wenn eine Sitzung vorliegt", () => {
      expect(perKonto({ employeeId: 42, ip: "10.0.0.1" })).toBe("e42");
    });

    it("zwei Mitarbeiter derselben IP teilen sich kein Kontingent", () => {
      const a = perKonto({ employeeId: 1, ip: "203.0.113.7" });
      const b = perKonto({ employeeId: 2, ip: "203.0.113.7" });
      expect(a).not.toBe(b);
    });

    it("faellt ohne Sitzung auf die IP zurueck", () => {
      expect(perKonto({ ip: "203.0.113.7" })).toBe("203.0.113.7");
    });

    it("liefert immer einen String — sonst zaehlt der Limiter ins Leere", () => {
      expect(typeof perKonto({ employeeId: 42 })).toBe("string");
      expect(typeof perKonto({ ip: "203.0.113.7" })).toBe("string");
      expect(typeof perKonto({})).toBe("string");
    });

    it("normalisiert IPv6 auf ein Praefix — sonst holt sich ein Client neue Kontingente", () => {
      expect(perKonto({ ip: "2001:db8:1234:5678::1" })).toBe("2001:db8:1234:5600::/56");
    });
  });
});
