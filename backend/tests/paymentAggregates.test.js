"use strict";

// ─────────────────────────────────────────────────────────────────────────────
// Eine Zahlung muss am Knoten UND im Vaterpfad ankommen.
//
// BEFUND 2026-09-23: routes/payments.js schrieb beim Anlegen einer Zahlung
// PAYMENT, PAYMENT_STRUCTURE, PROJECT.PAYED und einen Fortschritts-Schnapp-
// schuss — aber nicht PROJECT_STRUCTURE.PAYED. Die Weitergabe nach oben lief
// ausschliesslich im LOESCHpfad. Das "bezahlt" je Position blieb deshalb auf 0
// stehen, bis irgendwann jemand eine Zahlung loeschte; dann sprang es auf den
// richtigen Wert. Getroffen hat das jede Auswertung auf den Knotenwerten,
// allen voran den Bericht ueber teilfertige Leistungen.
// ─────────────────────────────────────────────────────────────────────────────

const { makeFakeSupabase } = require("./helpers/fakeSupabase");
const { neuSummierenPayed } = require("../services/paymentAggregates");

const TENANT = 7;

/** Projekt mit einem Sammelknoten (10) und zwei Positionen (11, 12). */
function baum(zahlungen = []) {
  const knoten = (id, vater) => ({
    ID: id, TENANT_ID: TENANT, PROJECT_ID: 1, FATHER_ID: vater,
    REVENUE: 0, EXTRAS: 0, COSTS: 0, REVENUE_COMPLETION: 0, EXTRAS_COMPLETION: 0,
    ADVANCE_INVOICED: 0, INVOICED: 0, PAYED: 0,
  });
  return makeFakeSupabase({
    PROJECT: [{ ID: 1, TENANT_ID: TENANT, ABBR: "P-1", PAYED: 0 }],
    PROJECT_STRUCTURE: [knoten(10, null), knoten(11, 10), knoten(12, 10)],
    PAYMENT_STRUCTURE: zahlungen,
  });
}

const zahlung = (id, structureId, betrag) => ({
  ID: id, TENANT_ID: TENANT, PAYMENT_ID: id,
  STRUCTURE_ID: structureId, AMOUNT_PAYED_NET: betrag, AMOUNT_PAYED_EXTRAS_NET: 0,
});

const knotenVon = (sb, id) => sb._tables.PROJECT_STRUCTURE.find((s) => s.ID === id);

describe("neuSummierenPayed", () => {
  it("schreibt den bezahlten Betrag an die Position", async () => {
    const sb = baum([zahlung(100, 11, 2380)]);
    await neuSummierenPayed(sb, [11]);

    expect(knotenVon(sb, 11).PAYED).toBe(2380);
  });

  // Der eigentliche Befund.
  it("rechnet den Vaterpfad mit", async () => {
    const sb = baum([zahlung(100, 11, 2380)]);
    await neuSummierenPayed(sb, [11]);

    expect(knotenVon(sb, 10).PAYED).toBe(2380);
  });

  it("summiert mehrere Teilzahlungen auf derselben Position", async () => {
    const sb = baum([zahlung(100, 11, 1000), zahlung(101, 11, 380.5)]);
    await neuSummierenPayed(sb, [11]);

    expect(knotenVon(sb, 11).PAYED).toBe(1380.5);
    expect(knotenVon(sb, 10).PAYED).toBe(1380.5);
  });

  it("zaehlt die Geschwister zusammen, nicht nur den ausloesenden Zweig", async () => {
    const sb = baum([zahlung(100, 11, 1000), zahlung(101, 12, 500)]);
    await neuSummierenPayed(sb, [11, 12]);

    expect(knotenVon(sb, 10).PAYED).toBe(1500);
  });

  // Neu summiert statt fortgeschrieben: zweimal laufen aendert nichts.
  it("ist wiederholbar", async () => {
    const sb = baum([zahlung(100, 11, 2380)]);
    await neuSummierenPayed(sb, [11]);
    await neuSummierenPayed(sb, [11]);

    expect(knotenVon(sb, 11).PAYED).toBe(2380);
    expect(knotenVon(sb, 10).PAYED).toBe(2380);
  });

  it("nimmt den Wert wieder weg, wenn die Zahlung verschwindet", async () => {
    const sb = baum([zahlung(100, 11, 2380)]);
    await neuSummierenPayed(sb, [11]);

    sb._tables.PAYMENT_STRUCTURE.length = 0;
    await neuSummierenPayed(sb, [11]);

    expect(knotenVon(sb, 11).PAYED).toBe(0);
    expect(knotenVon(sb, 10).PAYED).toBe(0);
  });
});
