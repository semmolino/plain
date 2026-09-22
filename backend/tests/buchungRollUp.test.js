"use strict";

// ─────────────────────────────────────────────────────────────────────────────
// Eine Buchung muss den Vaterpfad mitrechnen.
//
// BEFUND 2026-09-22: Nach dem Projektimport zeigten die Elternzeilen und die
// Projektebene 0 EUR, obwohl die Nachweis-Positionen darunter ihre Erloese
// trugen. Ursache war nicht der Import allein: recomputeStructure aktualisiert
// den gebuchten Knoten — und hoerte dort auf.
//
// Beim Anlegen und Aendern einer Struktur lief der Weg nach oben laengst
// (stammdaten-Controller, Nachtraege); nur der Buchungsweg hat ihn nie
// gegangen. Am deutlichsten bei Nachweis-Positionen, wo der Erloes ueberhaupt
// erst aus Buchungen entsteht: dort stand oben dauerhaft 0.
// ─────────────────────────────────────────────────────────────────────────────

const { makeFakeSupabase } = require("./helpers/fakeSupabase");
const { recomputeStructure } = require("../services/buchungen");

const TENANT = 7;

/**
 * Projekt mit zwei Ebenen: ein Sammelknoten (Pauschal, ohne eigenes Honorar)
 * und darunter eine Nachweis-Position.
 */
function baum({ buchungen = [] } = {}) {
  return makeFakeSupabase({
    PROJECT: [{ ID: 1, TENANT_ID: TENANT, ABBR: "P-1" }],
    PROJECT_STRUCTURE: [
      { ID: 10, TENANT_ID: TENANT, PROJECT_ID: 1, ABBR: "Sammel", FATHER_ID: null,
        BILLING_TYPE_ID: 1, REVENUE: 0, EXTRAS: 0, EXTRAS_PERCENT: 0, COSTS: 0,
        REVENUE_COMPLETION: 0, EXTRAS_COMPLETION: 0, ADVANCE_INVOICED: 0, INVOICED: 0, PAYED: 0 },
      { ID: 11, TENANT_ID: TENANT, PROJECT_ID: 1, ABBR: "Std", FATHER_ID: 10,
        BILLING_TYPE_ID: 2, REVENUE: 0, EXTRAS: 0, EXTRAS_PERCENT: 10, COSTS: 0,
        REVENUE_COMPLETION: 0, EXTRAS_COMPLETION: 0, ADVANCE_INVOICED: 0, INVOICED: 0, PAYED: 0 },
    ],
    BOOKING: buchungen,
  });
}

const erloesbuchung = (betrag) => ({
  ID: 100, TENANT_ID: TENANT, PROJECT_ID: 1, STRUCTURE_ID: 11, STATUS: "CONFIRMED",
  BOOKING_KIND: "LUMP_REVENUE", QUANTITY_INT: 0, QUANTITY_EXT: 1,
  COST_RATE: 0, COST_TOTAL: 0, HOURLY_RATE: betrag, HOURLY_RATE_TOTAL: betrag,
});

describe("recomputeStructure", () => {
  it("schreibt den Erlös einer Nachweis-Position an den Knoten", async () => {
    const sb = baum({ buchungen: [erloesbuchung(2126.25)] });
    await recomputeStructure(sb, 11);

    const blatt = sb._tables.PROJECT_STRUCTURE.find((s) => s.ID === 11);
    expect(blatt.REVENUE).toBe(2126.25);
    expect(blatt.EXTRAS).toBeCloseTo(212.625, 3);   // 10 % Nebenkosten
    // Gebuchtes ist Erbrachtes.
    expect(blatt.REVENUE_COMPLETION_PERCENT).toBe(100);
    expect(blatt.REVENUE_COMPLETION).toBe(2126.25);
  });

  // Der eigentliche Befund.
  it("rechnet den Vaterpfad mit", async () => {
    const sb = baum({ buchungen: [erloesbuchung(2126.25)] });
    await recomputeStructure(sb, 11);

    const vater = sb._tables.PROJECT_STRUCTURE.find((s) => s.ID === 10);
    expect(vater.REVENUE).toBe(2126.25);
    // Der Elternwert wird kaufmaennisch gerundet (recalcParent), der Blattwert
    // nicht — deshalb hier 212,63 statt 212,625. Bestehendes Verhalten.
    expect(vater.EXTRAS).toBe(212.63);
  });

  it("nimmt den Wert oben auch wieder weg, wenn die Buchung verschwindet", async () => {
    const sb = baum({ buchungen: [erloesbuchung(2126.25)] });
    await recomputeStructure(sb, 11);

    sb._tables.BOOKING.length = 0;
    await recomputeStructure(sb, 11);

    expect(sb._tables.PROJECT_STRUCTURE.find((s) => s.ID === 11).REVENUE).toBe(0);
    expect(sb._tables.PROJECT_STRUCTURE.find((s) => s.ID === 10).REVENUE).toBe(0);
  });

  it("zählt bei einer Kostenbuchung die Kosten nach oben", async () => {
    const sb = baum({ buchungen: [{
      ID: 101, TENANT_ID: TENANT, PROJECT_ID: 1, STRUCTURE_ID: 11, STATUS: "CONFIRMED",
      BOOKING_KIND: "LUMP_COST", QUANTITY_INT: 0, QUANTITY_EXT: 0,
      COST_RATE: 480, COST_TOTAL: 480, HOURLY_RATE: 0, HOURLY_RATE_TOTAL: 0,
    }] });
    await recomputeStructure(sb, 11);

    expect(sb._tables.PROJECT_STRUCTURE.find((s) => s.ID === 11).COSTS).toBe(480);
    expect(sb._tables.PROJECT_STRUCTURE.find((s) => s.ID === 10).COSTS).toBe(480);
  });
});
