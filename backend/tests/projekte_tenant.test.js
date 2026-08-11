"use strict";

/**
 * Regressionstest zum Pentest-Befund vom 2026-08-06:
 * "services/projekte.js — Projektstruktur, Vertraege und Leistungsstand
 *  komplett ohne TENANT_ID (Lesen und Schreiben)".
 *
 * 15 Einstiegspunkte filterten nur nach ID. Ein Nutzer konnte durch blosses
 * Hochzaehlen der Projekt-ID Honorarstrukturen und Vertragskonditionen fremder
 * Mandanten lesen — und ueber patchStructureCompletionPercents bzw.
 * deleteStructure sogar veraendern und loeschen.
 *
 * Abgesichert wird jetzt an der Grenze: jeder Einstiegspunkt prueft zuerst die
 * Zugehoerigkeit. Diese Tests halten fest, dass die Pruefung greift und dass
 * sie fail-closed ist (fehlender tenantId => Fehler, nicht Vollzugriff).
 */

const svc = require("../services/projekte");

/** Kennt je einen Datensatz pro Tabelle, alle in Mandant 4. */
function fakeSupabase() {
  const TABLES = {
    PROJECT:           [{ ID: 1, TENANT_ID: 4 }],
    PROJECT_STRUCTURE: [{ ID: 7, TENANT_ID: 4 }],
    CONTRACT:          [{ ID: 9, TENANT_ID: 4 }],
  };
  return {
    from(table) {
      const q = {
        _eq: {},
        select() { return q; },
        eq(col, val) { q._eq[col] = val; return q; },
        order() { return q; },
        limit() { return q; },
        in() { return q; },
        then(resolve) { return Promise.resolve({ data: [], error: null }).then(resolve); },
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

/** Fuehrt fn aus und liefert die Fehlermeldung, oder null bei Erfolg. */
async function fehler(fn) {
  try { await fn(); return null; }
  catch (e) { return e?.message ?? String(e?.status ?? e); }
}

const EIGENER = 4;
const FREMDER = 6;

describe("services/projekte — Mandantentrennung an den Einstiegspunkten", () => {
  const faelle = [
    ["getProjectStructure",              (t) => svc.getProjectStructure(fakeSupabase(), { projectId: 1, tenantId: t })],
    ["searchContracts",                  (t) => svc.searchContracts(fakeSupabase(), { projectId: 1, q: "", tenantId: t })],
    ["getLeistungsstand",                (t) => svc.getLeistungsstand(fakeSupabase(), { projectId: 1, tenantId: t })],
    ["patchStructureCompletionPercents", (t) => svc.patchStructureCompletionPercents(fakeSupabase(), { structureId: 7, revPct: 50, exPct: 0, tenantId: t })],
    ["deleteStructure",                  (t) => svc.deleteStructure(fakeSupabase(), { structureId: 7, cascade: 1, tenantId: t })],
    ["patchContract",                    (t) => svc.patchContract(fakeSupabase(), { contractId: 9, body: {}, tenantId: t })],
    ["getTecSum",                        (t) => svc.getTecSum(fakeSupabase(), { structureId: 7, tenantId: t })],
    ["moveStructure",                    (t) => svc.moveStructure(fakeSupabase(), { structureId: 7, fatherRaw: null, sortAfterId: null, tenantId: t })],
  ];

  describe.each(faelle)("%s", (_name, aufruf) => {
    it("weist einen fremden Mandanten ab", async () => {
      expect(await fehler(() => aufruf(FREMDER))).toMatch(/Nicht gefunden/);
    });

    it("verlangt tenantId (fail-closed)", async () => {
      expect(await fehler(() => aufruf(undefined))).toMatch(/tenantId ist erforderlich/);
    });

    it("laesst den eigenen Mandanten die Pruefung passieren", async () => {
      const msg = await fehler(() => aufruf(EIGENER));
      // Danach darf es an fehlenden Daten des Nachbaus scheitern — nur nicht
      // an der Mandantenpruefung.
      if (msg) {
        expect(msg).not.toMatch(/Nicht gefunden/);
        expect(msg).not.toMatch(/tenantId ist erforderlich/);
      }
    });
  });
});
