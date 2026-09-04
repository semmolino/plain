"use strict";

/**
 * Tests zu Befund M4 des Sicherheitsaudits vom 2026-09-03.
 *
 * Ein Anmelde-Token gilt 8 Stunden. Ohne Ruecknahme wirken Rollenentzug,
 * Deaktivierung und Passwortwechsel erst nach Ablauf.
 */

const { makeMiddleware, revokeSessions, invalidateSession } = require("../middleware/sessionGuard");

/** Minimaler supabase-Doppelgaenger: liefert genau eine EMPLOYEE-Zeile. */
function fakeSupabase(zeile, { fehler = null } = {}) {
  const aufrufe = { updates: [] };
  const api = {
    from() { return api; },
    select() { return api; },
    eq() { return api; },
    maybeSingle: async () => ({ data: zeile, error: fehler }),
    update(werte) { aufrufe.updates.push(werte); return { eq: async () => ({ error: fehler }) }; },
    _aufrufe: aufrufe,
  };
  return api;
}

function lauf(mw, req) {
  return new Promise((resolve) => {
    const res = {
      statusCode: null,
      status(c) { this.statusCode = c; return this; },
      json(body) { resolve({ status: this.statusCode, body }); return this; },
    };
    mw(req, res, () => resolve({ status: null, weiter: true }));
  });
}

const JETZT = Math.floor(Date.now() / 1000);

describe("sessionGuard", () => {
  beforeEach(() => invalidateSession(null));

  it("laesst ein Token durch, das nach dem letzten Rueckruf ausgestellt wurde", async () => {
    const vorEinerStunde = new Date((JETZT - 3600) * 1000).toISOString();
    const mw = makeMiddleware(fakeSupabase({ ID: 7, ACTIVE: 1, SESSION_EPOCH: vorEinerStunde }));
    const r = await lauf(mw, { employeeId: 7, tokenIssuedAt: JETZT }); // Token juenger
    expect(r.weiter).toBe(true);
  });

  it("weist ein Token ab, das vor dem letzten Rueckruf ausgestellt wurde", async () => {
    const geradeEben = new Date(JETZT * 1000).toISOString();
    const mw = makeMiddleware(fakeSupabase({ ID: 7, ACTIVE: 1, SESSION_EPOCH: geradeEben }));
    const r = await lauf(mw, { employeeId: 7, tokenIssuedAt: JETZT - 3600 }); // Token aelter
    expect(r.status).toBe(401);
    expect(r.body.error).toMatch(/Sitzung wurde beendet/);
  });

  it("sperrt einen deaktivierten Mitarbeiter sofort aus", async () => {
    const mw = makeMiddleware(fakeSupabase({ ID: 7, ACTIVE: 2, SESSION_EPOCH: null }));
    const r = await lauf(mw, { employeeId: 7, tokenIssuedAt: JETZT });
    expect(r.status).toBe(403);
    expect(r.body.error).toMatch(/inaktiv/);
  });

  it("laesst durch, solange nie zurueckgenommen wurde (SESSION_EPOCH null)", async () => {
    const mw = makeMiddleware(fakeSupabase({ ID: 7, ACTIVE: 1, SESSION_EPOCH: null }));
    const r = await lauf(mw, { employeeId: 7, tokenIssuedAt: JETZT - 99999 });
    expect(r.weiter).toBe(true);
  });

  it("laesst durch, wenn Migration 0134 fehlt — kein Aussperren durch eine fehlende Spalte", async () => {
    const mw = makeMiddleware(fakeSupabase(null, { fehler: { message: 'column "SESSION_EPOCH" does not exist' } }));
    const r = await lauf(mw, { employeeId: 7, tokenIssuedAt: JETZT });
    expect(r.weiter).toBe(true);
  });

  it("greift nicht ohne employeeId oder Ausstellungszeitpunkt", async () => {
    const mw = makeMiddleware(fakeSupabase({ ID: 7, ACTIVE: 2, SESSION_EPOCH: null }));
    expect((await lauf(mw, {})).weiter).toBe(true);
    expect((await lauf(mw, { employeeId: 7 })).weiter).toBe(true);
  });

  describe("revokeSessions", () => {
    it("schreibt einen Zeitstempel und verwirft den Zwischenspeicher", async () => {
      const db = fakeSupabase({ ID: 7, ACTIVE: 1, SESSION_EPOCH: null });
      const ok = await revokeSessions(db, 7);
      expect(ok).toBe(true);
      expect(db._aufrufe.updates).toHaveLength(1);
      expect(typeof db._aufrufe.updates[0].SESSION_EPOCH).toBe("string");
    });

    it("kippt nicht, wenn die Spalte fehlt — der Aufrufer soll weiterlaufen", async () => {
      const db = fakeSupabase(null, { fehler: { message: 'column "SESSION_EPOCH" does not exist' } });
      await expect(revokeSessions(db, 7)).resolves.toBe(false);
    });

    it("tut nichts ohne Mitarbeiter", async () => {
      const db = fakeSupabase(null);
      await expect(revokeSessions(db, null)).resolves.toBe(false);
      expect(db._aufrufe.updates).toHaveLength(0);
    });
  });
});
