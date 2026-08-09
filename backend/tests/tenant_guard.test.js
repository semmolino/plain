"use strict";

/**
 * Regressionstests zu den Pentest-Befunden vom 2026-08-06, zweite Runde.
 *
 * Der wiederkehrende Fehler war ein Muster, keine Einzelstelle: der Mandant
 * wurde aus dem ANGEFRAGTEN OBJEKT abgeleitet statt aus der Sitzung.
 *
 *     const tenantId = projRow?.TENANT_ID;   // services/buchungen.js
 *
 * Beim LESEN bestaetigt das nur, dass ein fremder Datensatz zu seinem eigenen
 * Mandanten gehoert. Beim SCHREIBEN ist es schlimmer: der neue Datensatz
 * uebernimmt dann den fremden Mandanten — eine Zeitbuchung landet also in der
 * Buchhaltung eines fremden Buueros.
 *
 * Diese Tests halten fest, dass die Richtung jetzt umgedreht ist.
 */

const { assertInTenant, assertProjectInTenant } = require("../services/tenantGuard");

/** Kennt ein Projekt (ID 1) und eine Struktur (ID 7), beide in Mandant 4. */
function fakeSupabase() {
  const TABLES = {
    PROJECT:           [{ ID: 1, TENANT_ID: 4 }],
    PROJECT_STRUCTURE: [{ ID: 7, TENANT_ID: 4 }],
  };
  return {
    from(table) {
      const q = {
        _eq: {},
        select() { return q; },
        eq(col, val) { q._eq[col] = val; return q; },
        async maybeSingle() {
          const hit = (TABLES[table] || []).find(
            (r) =>
              (q._eq.ID === undefined || String(r.ID) === String(q._eq.ID)) &&
              (q._eq.TENANT_ID === undefined || String(r.TENANT_ID) === String(q._eq.TENANT_ID))
          );
          return { data: hit || null, error: null };
        },
      };
      return q;
    },
  };
}

const fehler = async (fn) => { try { await fn(); return null; } catch (e) { return e; } };

describe("tenantGuard", () => {
  it("laesst einen eigenen Datensatz durch und liefert die numerische ID", async () => {
    await expect(assertProjectInTenant(fakeSupabase(), "1", 4)).resolves.toBe(1);
  });

  it("weist einen fremden Mandanten mit 404 ab", async () => {
    const e = await fehler(() => assertProjectInTenant(fakeSupabase(), 1, 6));
    expect(e.status).toBe(404);
  });

  it("verlangt tenantId — fail-closed statt Vollzugriff", async () => {
    for (const leer of [undefined, null, ""]) {
      const e = await fehler(() => assertProjectInTenant(fakeSupabase(), 1, leer));
      expect(String(e.message)).toMatch(/tenantId ist erforderlich/);
    }
  });

  it("antwortet bei fremdem und nicht existierendem Datensatz gleich", async () => {
    // Sonst liesse sich ueber den Statuscode ermitteln, welche IDs in anderen
    // Mandanten vergeben sind.
    const fremd  = await fehler(() => assertProjectInTenant(fakeSupabase(), 1, 6));
    const nichts = await fehler(() => assertProjectInTenant(fakeSupabase(), 999, 4));
    expect(fremd.status).toBe(nichts.status);
    expect(fremd.message).toBe(nichts.message);
  });

  it("weist nicht-numerische IDs ab, ohne die Datenbank zu fragen", async () => {
    const e = await fehler(() => assertProjectInTenant(fakeSupabase(), "abc", 4));
    expect(e.status).toBe(404);
  });

  it("funktioniert fuer beliebige Tabellen mit TENANT_ID", async () => {
    await expect(assertInTenant(fakeSupabase(), "PROJECT_STRUCTURE", 7, 4)).resolves.toBe(7);
    const e = await fehler(() => assertInTenant(fakeSupabase(), "PROJECT_STRUCTURE", 7, 6));
    expect(e.status).toBe(404);
  });
});
