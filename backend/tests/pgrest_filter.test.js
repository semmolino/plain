"use strict";

/**
 * Regressionstest zu Befund M1 des Sicherheitsaudits vom 2026-09-03.
 *
 * PostgREST liest den .or()-Ausdruck als Struktur. Vor der Korrektur liess
 * sich ueber ein Komma in der Sucheingabe eine zusaetzliche Bedingung
 * einschleusen und damit EMPLOYEE.PASSWORD zeichenweise ausfragen.
 */

const { suchwert, exakterWert } = require("../services/pgrestFilter");

describe("pgrestFilter", () => {
  describe("suchwert", () => {
    it("entfernt das Komma — die Trennung zwischen zwei Bedingungen", () => {
      expect(suchwert("x,PASSWORD.ilike.$2a$10$a")).not.toContain(",");
    });

    it("entfernt Klammern — die Gruppierung von Bedingungen", () => {
      const s = suchwert("a,and(TENANT_ID.eq.1)");
      expect(s).not.toContain("(");
      expect(s).not.toContain(")");
    });

    it("entfernt den Punkt — die Trennung von Spalte, Operator und Wert", () => {
      expect(suchwert("PASSWORD.ilike.abc")).not.toContain(".");
    });

    it("der vollstaendige Angriff aus dem Audit traegt keine Struktur mehr", () => {
      const angriff = 'x,PASSWORD.ilike.*$2a$10$abc*';
      const s = suchwert(angriff);
      // Kein Zeichen mehr, mit dem sich die Filterstruktur erweitern liesse.
      for (const zeichen of [",", ".", "(", ")", '"']) {
        expect(s).not.toContain(zeichen);
      }
      // Der Stern ist der PostgREST-Platzhalter. Er bleibt sichtbar, aber
      // escaped — er matcht sich selbst, statt beliebig viele Zeichen.
      expect(s).toContain("\\*");
      expect(s).not.toMatch(/(^|[^\\])\*/);
    });

    it("ein Backslash aus der Eingabe wird entfernt, nicht durchgereicht", () => {
      // Sonst liesse sich das Escaping der Platzhalter selbst aushebeln.
      expect(suchwert("a\\%b")).toBe("a \\%b");
    });

    it("neutralisiert LIKE-Platzhalter, statt sie zu verwerfen", () => {
      expect(suchwert("100%")).toBe("100\\%");
      expect(suchwert("a_b")).toBe("a\\_b");
    });

    it("laesst normale Suchbegriffe unveraendert — auch mit Umlauten", () => {
      expect(suchwert("Müller")).toBe("Müller");
      expect(suchwert("Neubau Nord")).toBe("Neubau Nord");
      expect(suchwert("ABC-123")).toBe("ABC-123");
    });

    it("kommt mit null, undefined und Zahlen zurecht", () => {
      expect(suchwert(null)).toBe("");
      expect(suchwert(undefined)).toBe("");
      expect(suchwert(42)).toBe("42");
    });
  });

  describe("exakterWert", () => {
    it("entfernt Strukturzeichen", () => {
      expect(exakterWert("BY,TENANT_ID.eq.1")).toBe("BYTENANT_IDeq1");
    });

    it("laesst ein normales Bundeslandkuerzel unveraendert", () => {
      expect(exakterWert("BY")).toBe("BY");
    });

    it("escaped hier NICHT — Platzhalter sind beim Gleichheitsvergleich bedeutungslos", () => {
      expect(exakterWert("100%")).toBe("100%");
    });
  });
});
