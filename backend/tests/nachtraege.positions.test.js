"use strict";

// Nachtrags-Positionen (UI-Pilot Runde 7): der Reiter bietet jetzt „Position
// bearbeiten" an. Vorher prüfte das Backend weder, ob eine Position schon ins
// Projekt freigegeben ist, noch ob sie zum Nachtrag der URL gehört; Löschen
// nahm nur eine Ebene mit. Und eine gekürzt anerkannte Position liess sich
// ein zweites Mal freigeben — doppelter Projektknoten, doppelter Betrag.

const { makeFakeSupabase } = require("./helpers/fakeSupabase");
const svc = require("../services/nachtraege");

const T = 4, P = 77, N = 900;

function db(structure) {
  return makeFakeSupabase({
    NACHTRAG: [
      { ID: N, TENANT_ID: T, PROJECT_ID: P, NACHTRAG_STATUS_ID: 3, ABBR: "N-001", NAME: "Mehrleistung Dach", AMOUNT_APPROVED_NET: 0 },
      { ID: 901, TENANT_ID: T, PROJECT_ID: P, NACHTRAG_STATUS_ID: 3, ABBR: "N-002", NAME: "Anderer" },
    ],
    NACHTRAG_STATUS: [
      { ID: 3, CODE: "IN_REVIEW", ALLOWS_RELEASE: true },
      { ID: 6, CODE: "PARTIALLY_COMMISSIONED", ALLOWS_RELEASE: true },
      { ID: 7, CODE: "COMMISSIONED", ALLOWS_RELEASE: false },
    ],
    NACHTRAG_STRUCTURE: structure,
    PROJECT: [{ ID: P, TENANT_ID: T, ABBR: "P-26-001", NAME: "Dachsanierung" }],
    PROJECT_STRUCTURE: [], PROJECT_PROGRESS: [], NACHTRAG_RELEASE: [], NACHTRAG_AUDIT: [],
  });
}

const node = (o) => ({ TENANT_ID: T, NACHTRAG_ID: N, FATHER_ID: null, BILLING_TYPE_ID: 1, REVENUE: 1000, REVENUE_BASIS: 1000,
  EXTRAS_PERCENT: 0, EXTRAS: 0, SORT_ORDER: 10, APPROVAL_STATE: "OPEN", RELEASED_STRUCTURE_ID: null, ...o });

describe("Positionen ändern und löschen", () => {
  test("freigegebene Position: Ändern und Löschen 409, offene geht", async () => {
    const sb = db([node({ ID: 1, NAME: "frei", APPROVAL_STATE: "APPROVED", RELEASED_STRUCTURE_ID: 55 }), node({ ID: 2, NAME: "offen" })]);
    await expect(svc.updateStructureNode(sb, { tenantId: T, nachtragId: N, nodeId: 1, body: { name: "x" } })).rejects.toMatchObject({ status: 409 });
    await expect(svc.deleteStructureNode(sb, { tenantId: T, nachtragId: N, nodeId: 1 })).rejects.toMatchObject({ status: 409 });
    const upd = await svc.updateStructureNode(sb, { tenantId: T, nachtragId: N, nodeId: 2, body: { name: "offen, neu", revenue: 1500 } });
    expect(upd).toMatchObject({ NAME: "offen, neu", REVENUE: 1500 });
  });

  test("Position eines anderen Nachtrags: 404", async () => {
    const sb = db([node({ ID: 1, NAME: "fremd", NACHTRAG_ID: 901 })]);
    await expect(svc.updateStructureNode(sb, { tenantId: T, nachtragId: N, nodeId: 1, body: { name: "x" } })).rejects.toMatchObject({ status: 404 });
    await expect(svc.deleteStructureNode(sb, { tenantId: T, nachtragId: N, nodeId: 1 })).rejects.toMatchObject({ status: 404 });
  });

  test("Löschen nimmt den ganzen Zweig mit — auch Enkel", async () => {
    const sb = db([node({ ID: 1, NAME: "Gruppe" }), node({ ID: 2, FATHER_ID: 1, NAME: "Untergruppe" }), node({ ID: 3, FATHER_ID: 2, NAME: "Enkel" }), node({ ID: 4, NAME: "bleibt" })]);
    await svc.deleteStructureNode(sb, { tenantId: T, nachtragId: N, nodeId: 1 });
    expect(sb._tables.NACHTRAG_STRUCTURE.map(r => r.ID)).toEqual([4]);
  });

  test("Zweig mit freigegebener Position lässt sich nicht löschen", async () => {
    const sb = db([node({ ID: 1, NAME: "Gruppe" }), node({ ID: 2, FATHER_ID: 1, NAME: "frei", APPROVAL_STATE: "PARTIAL", RELEASED_STRUCTURE_ID: 56 })]);
    await expect(svc.deleteStructureNode(sb, { tenantId: T, nachtragId: N, nodeId: 1 })).rejects.toMatchObject({ status: 409 });
    expect(sb._tables.NACHTRAG_STRUCTURE).toHaveLength(2);
  });

  test("keine neue Position unter einer freigegebenen", async () => {
    const sb = db([node({ ID: 1, NAME: "frei", APPROVAL_STATE: "APPROVED", RELEASED_STRUCTURE_ID: 55 })]);
    await expect(svc.addStructureNode(sb, { tenantId: T, nachtragId: N, body: { name: "neu", billing_type_id: 1, revenue: 10, father_id: 1 } }))
      .rejects.toMatchObject({ status: 409 });
  });
});

describe("Freigabe", () => {
  test("Position nach Aufwand geht mit Plan ins Projekt, startet bei 0", async () => {
    const sb = db([node({ ID: 1, NAME: "Mehraufwand Statik", BILLING_TYPE_ID: 2, QUANTITY: 24, HOURLY_RATE: 95, REVENUE: 2280, REVENUE_BASIS: 2280 })]);
    await svc.release(sb, { tenantId: T, nachtragId: N, employeeId: 1, body: { release_kind: "FULL" } });
    const pos = sb._tables.PROJECT_STRUCTURE.find(r => r.NAME === "Mehraufwand Statik");
    expect(pos).toMatchObject({ BILLING_TYPE_ID: 2, REVENUE: 0, PLAN_HOURS: 24, PLAN_REVENUE: 2280 });
    expect(pos.ROLE_ABBR).toBeUndefined();
  });

  test("gekürzt anerkannte Position wird nicht ein zweites Mal freigegeben, der Nachtrag ist dann beauftragt", async () => {
    const sb = db([node({ ID: 1, NAME: "A" }), node({ ID: 2, NAME: "B" })]);
    await svc.release(sb, { tenantId: T, nachtragId: N, employeeId: 1, body: { positions: [{ nachtrag_structure_id: 1, approved_amount_net: 800 }] } });
    expect(sb._tables.NACHTRAG_STRUCTURE.find(r => r.ID === 1).APPROVAL_STATE).toBe("PARTIAL");
    expect(sb._tables.NACHTRAG.find(r => r.ID === N).NACHTRAG_STATUS_ID).toBe(6);

    // Zweite Freigabe mit beiden: nur B kommt dazu
    await svc.release(sb, { tenantId: T, nachtragId: N, employeeId: 1, body: { positions: [{ nachtrag_structure_id: 1 }, { nachtrag_structure_id: 2 }] } });
    const leaves = sb._tables.PROJECT_STRUCTURE.filter(r => r.BILLING_TYPE_ID === 1)
    expect(leaves.map(r => r.NAME).sort()).toEqual(["A", "B"]);
    const head = sb._tables.NACHTRAG.find(r => r.ID === N);
    expect(head.AMOUNT_APPROVED_NET).toBe(1800);
    expect(head.NACHTRAG_STATUS_ID).toBe(7);
  });
});
