"use strict";

// ─────────────────────────────────────────────────────────────────────────────
// PROJECT_PROGRESS — Uebertragen des vorherigen Stands.
//
// Der Vorstand wurde bis 09/2026 mit EINER Abfrage JE ZEILE geholt: bei 4.050
// Knoten also 4.050 Rundreisen, an jeder Stelle, die Schnappschuesse schreibt.
// Das Holen laeuft jetzt gebuendelt (`in`, 200 je Stapel), die Auswahl
// "neueste je Knoten" in JS.
//
// Diese Tests halten fest, dass sich am ERGEBNIS nichts geaendert hat — das
// Buendeln darf schneller sein, aber nicht anders.
// ─────────────────────────────────────────────────────────────────────────────

const { makeFakeSupabase } = require("./helpers/fakeSupabase");
const { insertProgressSnapshot } = require("../services/projectProgress");

const TENANT = 7;
const zeilen = (sb) => sb._tables.PROJECT_PROGRESS;
const letzteFuer = (sb, sid) => zeilen(sb).filter((r) => String(r.STRUCTURE_ID) === String(sid)).pop();

function bestand(vorher = []) {
  return makeFakeSupabase({ PROJECT_PROGRESS: vorher });
}

const alt = (id, structureId, felder) => ({
  ID: id, TENANT_ID: TENANT, STRUCTURE_ID: structureId,
  created_at: `2026-0${id}-01T00:00:00Z`, ...felder,
});

describe("insertProgressSnapshot", () => {
  it("schreibt eine Zeile je Knoten", async () => {
    const sb = bestand();
    await insertProgressSnapshot(sb, [
      { TENANT_ID: TENANT, STRUCTURE_ID: 11, INVOICED: 100 },
      { TENANT_ID: TENANT, STRUCTURE_ID: 12, INVOICED: 200 },
    ]);
    expect(zeilen(sb)).toHaveLength(2);
  });

  // INVOICED, ADVANCE_INVOICED und PAYED sind Zuwaechse, keine Staende.
  it("addiert die kumulierten Spalten auf den Vorstand", async () => {
    const sb = bestand([alt(1, 11, { INVOICED: 1000, PAYED: 400 })]);
    await insertProgressSnapshot(sb, [{ TENANT_ID: TENANT, STRUCTURE_ID: 11, INVOICED: 250 }]);

    const neu = letzteFuer(sb, 11);
    expect(neu.INVOICED).toBe(1250);
    expect(neu.PAYED).toBe(400);      // nicht mitgegeben -> uebernommen
  });

  it("uebernimmt nicht genannte Spalten unveraendert", async () => {
    const sb = bestand([alt(1, 11, { REVENUE: 5000, EXTRAS_PERCENT: 7, REVENUE_COMPLETION_PERCENT: 40 })]);
    await insertProgressSnapshot(sb, [{ TENANT_ID: TENANT, STRUCTURE_ID: 11, INVOICED: 100 }]);

    const neu = letzteFuer(sb, 11);
    expect(neu.REVENUE).toBe(5000);
    expect(neu.EXTRAS_PERCENT).toBe(7);
    expect(neu.REVENUE_COMPLETION_PERCENT).toBe(40);
  });

  it("ersetzt die nicht-kumulierten Spalten, wenn ein Wert mitkommt", async () => {
    const sb = bestand([alt(1, 11, { REVENUE: 5000 })]);
    await insertProgressSnapshot(sb, [{ TENANT_ID: TENANT, STRUCTURE_ID: 11, REVENUE: 6000 }]);
    expect(letzteFuer(sb, 11).REVENUE).toBe(6000);
  });

  // Der Kern der Umstellung: der Vorstand muss je Knoten der NEUESTE sein,
  // auch wenn alle Knoten in einem Zug geholt werden.
  it("nimmt je Knoten den neuesten Vorstand, nicht irgendeinen", async () => {
    const sb = bestand([
      alt(1, 11, { INVOICED: 100 }),
      alt(2, 11, { INVOICED: 900 }),   // neuer
      alt(3, 12, { INVOICED: 50 }),
    ]);
    await insertProgressSnapshot(sb, [
      { TENANT_ID: TENANT, STRUCTURE_ID: 11, INVOICED: 1 },
      { TENANT_ID: TENANT, STRUCTURE_ID: 12, INVOICED: 1 },
    ]);

    expect(letzteFuer(sb, 11).INVOICED).toBe(901);
    expect(letzteFuer(sb, 12).INVOICED).toBe(51);
  });

  it("kommt ohne Vorstand aus", async () => {
    const sb = bestand();
    await insertProgressSnapshot(sb, [{ TENANT_ID: TENANT, STRUCTURE_ID: 11, INVOICED: 100 }]);
    expect(letzteFuer(sb, 11).INVOICED).toBe(100);
  });

  it("tut bei leerer Eingabe nichts", async () => {
    const sb = bestand();
    await insertProgressSnapshot(sb, []);
    expect(zeilen(sb)).toHaveLength(0);
  });
});
