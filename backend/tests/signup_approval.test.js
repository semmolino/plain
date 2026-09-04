"use strict";

/**
 * Tests zu Befund N3 des Sicherheitsaudits vom 2026-09-03.
 *
 * Die Registrierung legte Mandant, Firma und Erst-Nutzer in einem Zug an, mit
 * sofort nutzbarem Passwort — ohne Nachweis der Adresse und ohne Zutun des
 * Betreibers. Jetzt zwei Tore: E-Mail bestätigen, dann Freigabe.
 */

process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret";

const jwt = require("jsonwebtoken");
const signup = require("../services/signupApproval");
const { ZUSTAND } = signup;

/** supabase-Doppelgaenger fuer TENANTS: eine Zeile, protokollierte Updates. */
function fakeDb(zeile, { updateFehler = null, selectFehler = null } = {}) {
  const log = { updates: [], filter: [] };
  const api = {
    from() { return api; },
    select() { return api; },
    eq(spalte, wert) { log.filter.push([spalte, wert]); return api; },
    in() { return api; },
    order() { return api; },
    limit() { return api; },
    maybeSingle: async () => ({ data: zeile, error: selectFehler }),
    update(werte) {
      log.updates.push(werte);
      const kette = {
        eq(spalte, wert) { log.filter.push([spalte, wert]); return kette; },
        select: async () => ({ data: updateFehler ? null : [{ ID: zeile?.ID ?? 1 }], error: updateFehler }),
      };
      return kette;
    },
    _log: log,
  };
  return api;
}

describe("Registrierung: Bestätigung und Freigabe", () => {
  describe("loginSperre", () => {
    it("sperrt, solange die E-Mail nicht bestätigt ist", () => {
      const m = signup.loginSperre(ZUSTAND.MAIL_OFFEN);
      expect(m).toMatch(/E-Mail-Adresse/i);
    });

    it("sperrt, solange die Freigabe fehlt", () => {
      const m = signup.loginSperre(ZUSTAND.FREIGABE_OFFEN);
      expect(m).toMatch(/prüfen|pruefen/i);
    });

    it("laesst einen freigegebenen Mandanten durch", () => {
      expect(signup.loginSperre(ZUSTAND.AKTIV)).toBeNull();
    });

    it("laesst durch, wenn die Spalte fehlt — eine fehlende Migration sperrt niemanden aus", () => {
      expect(signup.loginSperre(null)).toBeNull();
      expect(signup.loginSperre(undefined)).toBeNull();
      expect(signup.loginSperre("")).toBeNull();
    });

    it("sperrt bei einem unbekannten Zustand — fail-closed", () => {
      expect(signup.loginSperre("irgendwas")).not.toBeNull();
    });
  });

  describe("Bestätigungstoken", () => {
    it("traegt purpose und ist damit keine Sitzung", () => {
      // middleware/auth.js lehnt Token mit purpose als Sitzung ab (M2).
      const decoded = jwt.decode(signup.baueToken(7, "a@b.de"));
      expect(decoded.purpose).toBe("signup_confirm");
      expect(decoded.tenant_id).toBe(7);
    });

    it("wird von verifySessionToken abgelehnt", () => {
      const { verifySessionToken } = require("../middleware/auth");
      expect(() => verifySessionToken(signup.baueToken(7, "a@b.de"), process.env.JWT_SECRET))
        .toThrow(/Ungültiges Token|Ungueltiges Token/);
    });
  });

  describe("bestaetigeEmail", () => {
    it("schaltet von pending_email auf pending_approval", async () => {
      const db = fakeDb({ ID: 7, TENANT: "Büro Müller", SIGNUP_STATE: ZUSTAND.MAIL_OFFEN });
      const r = await signup.bestaetigeEmail(db, signup.baueToken(7, "a@b.de"));
      expect(r.tenantId).toBe(7);
      expect(db._log.updates[0].SIGNUP_STATE).toBe(ZUSTAND.FREIGABE_OFFEN);
      expect(db._log.updates[0].EMAIL_CONFIRMED_AT).toBeTruthy();
    });

    it("schreibt nur aus dem erwarteten Zustand — kein Rennen bei zwei Klicks", async () => {
      const db = fakeDb({ ID: 7, TENANT: "X", SIGNUP_STATE: ZUSTAND.MAIL_OFFEN });
      await signup.bestaetigeEmail(db, signup.baueToken(7, "a@b.de"));
      expect(db._log.filter).toContainEqual(["SIGNUP_STATE", ZUSTAND.MAIL_OFFEN]);
    });

    it("meldet den zweiten Klick als bereits bestaetigt, nicht als Fehler", async () => {
      const db = fakeDb({ ID: 7, TENANT: "X", SIGNUP_STATE: ZUSTAND.FREIGABE_OFFEN });
      const r = await signup.bestaetigeEmail(db, signup.baueToken(7, "a@b.de"));
      expect(r.schonBestaetigt).toBe(true);
      expect(db._log.updates).toHaveLength(0);
    });

    it("meldet einen bereits freigegebenen Mandanten als aktiv", async () => {
      const db = fakeDb({ ID: 7, TENANT: "X", SIGNUP_STATE: ZUSTAND.AKTIV });
      const r = await signup.bestaetigeEmail(db, signup.baueToken(7, "a@b.de"));
      expect(r.schonAktiv).toBe(true);
    });

    it("weist einen fremden Token-Zweck ab", async () => {
      const fremd = jwt.sign({ tenant_id: 7, purpose: "reset" }, process.env.JWT_SECRET);
      await expect(signup.bestaetigeEmail(fakeDb(null), fremd)).rejects.toMatchObject({ status: 400 });
    });

    it("weist einen mit falschem Geheimnis signierten Token ab", async () => {
      const gefaelscht = jwt.sign({ tenant_id: 7, purpose: "signup_confirm" }, "falsches-geheimnis");
      await expect(signup.bestaetigeEmail(fakeDb(null), gefaelscht)).rejects.toMatchObject({ status: 400 });
    });

    it("weist einen abgelaufenen Token ab", async () => {
      const alt = jwt.sign(
        { tenant_id: 7, purpose: "signup_confirm", exp: Math.floor(Date.now() / 1000) - 10 },
        process.env.JWT_SECRET
      );
      await expect(signup.bestaetigeEmail(fakeDb(null), alt)).rejects.toMatchObject({ status: 400 });
    });

    it("meldet verstaendlich, wenn der Antrag zwischenzeitlich abgelehnt wurde", async () => {
      // Ablehnen loescht den Mandanten — der Link zeigt dann ins Leere.
      const db = fakeDb(null);
      await expect(signup.bestaetigeEmail(db, signup.baueToken(7, "a@b.de")))
        .rejects.toMatchObject({ status: 400, message: expect.stringMatching(/existiert nicht mehr/) });
    });

    it("meldet einen fehlgeschlagenen Schreibvorgang statt Erfolg zu behaupten", async () => {
      const db = fakeDb(
        { ID: 7, TENANT: "X", SIGNUP_STATE: ZUSTAND.MAIL_OFFEN },
        { updateFehler: { message: "kaputt" } }
      );
      await expect(signup.bestaetigeEmail(db, signup.baueToken(7, "a@b.de")))
        .rejects.toMatchObject({ status: 500 });
    });
  });

  describe("benachrichtigeBetreiber", () => {
    it("kippt nicht, wenn kein aktiver Plattform-Admin hinterlegt ist", async () => {
      const db = {
        from() { return this; },
        select: async () => ({ data: [{ EMAIL: "a@b.de", IS_ACTIVE: false }], error: null }),
      };
      await expect(signup.benachrichtigeBetreiber(db, { tenantId: 1, firma: "X", email: "a@b.de" }))
        .resolves.toBe(false);
    });
  });
});
