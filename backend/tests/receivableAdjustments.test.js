"use strict";

// Rest ausbuchen (Migration 0177, services/receivableAdjustments.js).
//
// Szenario: Abschlagsrechnung 30.000 € netto (LPH 2: 20.000, LPH 3: 10.000),
// der Kunde zahlt 29.750 € statt 35.700 € brutto, weil er den Leistungsstand
// bestreitet. Das Buero akzeptiert — und will den Betrag mit der naechsten
// Abschlagsrechnung wieder abrechnen koennen.

const { makeFakeSupabase } = require("./helpers/fakeSupabase");
const adj = require("../services/receivableAdjustments");
const { loadPreviouslyBilledByStructure } = require("../services/partialPayments");

const T = 1;

function welt(extra = {}) {
  return makeFakeSupabase({
    PROJECT: [{ ID: 40, TENANT_ID: T, INVOICED: 0, ADVANCE_INVOICED: 30000 }],
    PROJECT_STRUCTURE: [
      { ID: 500, TENANT_ID: T, PROJECT_ID: 40, BILLING_TYPE_ID: 1, ADVANCE_INVOICED: 20000, INVOICED: 0 },
      { ID: 501, TENANT_ID: T, PROJECT_ID: 40, BILLING_TYPE_ID: 1, ADVANCE_INVOICED: 10000, INVOICED: 0 },
      { ID: 502, TENANT_ID: T, PROJECT_ID: 40, BILLING_TYPE_ID: 2, ADVANCE_INVOICED: 0, INVOICED: 0 },
    ],
    ADVANCE_INVOICE: [{
      ID: 700, TENANT_ID: T, STATUS_ID: 2, PROJECT_ID: 40, CONTRACT_ID: 30,
      ADVANCE_INVOICE_DATE: "2026-08-01", DOCUMENT_RENDERED_AT: "2026-08-01T10:00:00.000Z",
      TOTAL_AMOUNT_NET: 30000, TOTAL_AMOUNT_GROSS: 35700, VAT_PERCENT: 19, VAT_CATEGORY: "S",
      CANCELS_ADVANCE_INVOICE_ID: null,
    }],
    ADVANCE_INVOICE_STRUCTURE: [
      { ID: 1, TENANT_ID: T, ADVANCE_INVOICE_ID: 700, STRUCTURE_ID: 500, AMOUNT_NET: 20000, AMOUNT_EXTRAS_NET: 0 },
      { ID: 2, TENANT_ID: T, ADVANCE_INVOICE_ID: 700, STRUCTURE_ID: 501, AMOUNT_NET: 10000, AMOUNT_EXTRAS_NET: 0 },
    ],
    PAYMENT: [{ ID: 1, TENANT_ID: T, ADVANCE_INVOICE_ID: 700, AMOUNT_PAYED_GROSS: 29750, PAYMENT_DATE: "2026-08-20" }],
    INVOICE: [], INVOICE_STRUCTURE: [], RECEIVABLE_ADJUSTMENT: [], PROJECT_PROGRESS: [],
    ...extra,
  });
}

const kuerzung = (extra = {}) => ({
  advance_invoice_id: 700, amount_gross: 5950, adjustment_date: "2026-09-01",
  reason: "kuerzung", rebillable: true, ...extra,
});

describe("Rest ausbuchen — anlegen", () => {
  test("wieder abrechenbar: USt-Anteil festgehalten, Summen wie beim Storno gemindert", async () => {
    const db = welt();
    const row = await adj.createAdjustment(db, { tenantId: T, employeeId: 7, body: kuerzung() });
    expect(row).toMatchObject({ AMOUNT_GROSS: 5950, AMOUNT_NET: 5000, AMOUNT_VAT: 950, REBILLABLE: true, REASON: "kuerzung" });

    const t = db._tables;
    expect(t.PROJECT[0].ADVANCE_INVOICED).toBe(25000);
    const ps = Object.fromEntries(t.PROJECT_STRUCTURE.map(p => [p.ID, p.ADVANCE_INVOICED]));
    expect(ps[500]).toBeCloseTo(16666.67, 2);
    expect(ps[501]).toBeCloseTo(8333.33, 2);
    expect(ps[502]).toBe(0);
    const deltas = t.PROJECT_PROGRESS.map(p => p.ADVANCE_INVOICED).reduce((s, v) => s + v, 0);
    expect(deltas).toBeCloseTo(-5000, 2);
  });

  test("die naechste Abschlagsrechnung schlaegt den Betrag wieder vor", async () => {
    const db = welt();
    const vorher = await loadPreviouslyBilledByStructure(db, { contractId: 30, structureIds: [500, 501] });
    expect(vorher.get("500")).toBe(20000);
    await adj.createAdjustment(db, { tenantId: T, body: kuerzung() });
    const nachher = await loadPreviouslyBilledByStructure(db, { contractId: 30, structureIds: [500, 501] });
    expect(nachher.get("500")).toBeCloseTo(16666.67, 2);
    expect(nachher.get("501")).toBeCloseTo(8333.33, 2);
  });

  test("endgueltig: Abgerechnetes und Summen bleiben, wie sie sind", async () => {
    const db = welt();
    await adj.createAdjustment(db, { tenantId: T, body: kuerzung({ reason: "kulanz", rebillable: false }) });
    expect(db._tables.PROJECT[0].ADVANCE_INVOICED).toBe(30000);
    const billed = await loadPreviouslyBilledByStructure(db, { contractId: 30, structureIds: [500, 501] });
    expect(billed.get("500")).toBe(20000);
  });

  test("mehr als offen ist, laesst sich nicht ausbuchen", async () => {
    await expect(adj.createAdjustment(welt(), { tenantId: T, body: kuerzung({ amount_gross: 6000 }) }))
      .rejects.toMatchObject({ status: 400, message: expect.stringContaining("5950,00") });
  });

  test("„wieder abrechenbar“ nur beim Grund Kürzung", async () => {
    await expect(adj.createAdjustment(welt(), { tenantId: T, body: kuerzung({ reason: "skonto" }) }))
      .rejects.toMatchObject({ status: 400 });
  });

  test("nur Stunden auf dem Beleg: wieder abrechenbar geht nicht", async () => {
    const db = welt({
      ADVANCE_INVOICE_STRUCTURE: [{ ID: 1, TENANT_ID: T, ADVANCE_INVOICE_ID: 700, STRUCTURE_ID: 502, AMOUNT_NET: 30000, AMOUNT_EXTRAS_NET: 0 }],
    });
    await expect(adj.createAdjustment(db, { tenantId: T, body: kuerzung() }))
      .rejects.toMatchObject({ status: 400, message: expect.stringContaining("Stunden") });
  });

  test("nach einer Schlussrechnung nur endgueltig", async () => {
    const db = welt({
      INVOICE: [{ ID: 800, TENANT_ID: T, STATUS_ID: 2, PROJECT_ID: 40, CONTRACT_ID: 30, INVOICE_TYPE: "schlussrechnung",
        INVOICE_DATE: "2026-09-01", TOTAL_AMOUNT_NET: 1000, TOTAL_AMOUNT_GROSS: 1190, VAT_PERCENT: 19, VAT_CATEGORY: "S" }],
    });
    await expect(adj.createAdjustment(db, { tenantId: T, body: { invoice_id: 800, amount_gross: 100, adjustment_date: "2026-09-10", reason: "kuerzung", rebillable: true } }))
      .rejects.toMatchObject({ status: 400 });
    const ok = await adj.createAdjustment(db, { tenantId: T, body: { invoice_id: 800, amount_gross: 100, adjustment_date: "2026-09-10", reason: "kuerzung", rebillable: false } });
    expect(ok.AMOUNT_NET).toBe(84.03);
  });

  test("Stornobeleg und fremder Mandant sind ausgeschlossen", async () => {
    const db = welt({
      ADVANCE_INVOICE: [
        { ID: 700, TENANT_ID: T, STATUS_ID: 2, PROJECT_ID: 40, TOTAL_AMOUNT_NET: -30000, TOTAL_AMOUNT_GROSS: -35700, CANCELS_ADVANCE_INVOICE_ID: 699 },
        { ID: 701, TENANT_ID: 2, STATUS_ID: 2, PROJECT_ID: 41, TOTAL_AMOUNT_NET: 100, TOTAL_AMOUNT_GROSS: 119 },
      ],
    });
    await expect(adj.createAdjustment(db, { tenantId: T, body: kuerzung({ rebillable: false }) })).rejects.toMatchObject({ status: 400 });
    await expect(adj.createAdjustment(db, { tenantId: T, body: kuerzung({ advance_invoice_id: 701 }) })).rejects.toMatchObject({ status: 404 });
  });
});

describe("Rest ausbuchen — zuruecknehmen und Storno", () => {
  test("Zuruecknehmen stellt die Summen wieder her", async () => {
    const db = welt();
    const row = await adj.createAdjustment(db, { tenantId: T, body: kuerzung() });
    db._tables.RECEIVABLE_ADJUSTMENT[0].created_at = "2026-09-01T09:00:00.000Z";
    await adj.deleteAdjustment(db, { tenantId: T, id: row.ID });
    expect(db._tables.RECEIVABLE_ADJUSTMENT).toHaveLength(0);
    expect(db._tables.PROJECT[0].ADVANCE_INVOICED).toBe(30000);
    const ps = Object.fromEntries(db._tables.PROJECT_STRUCTURE.map(p => [p.ID, p.ADVANCE_INVOICED]));
    expect(ps[500]).toBe(20000);
  });

  test("wurde danach schon wieder abgerechnet, ist Zuruecknehmen gesperrt", async () => {
    const db = welt();
    const row = await adj.createAdjustment(db, { tenantId: T, body: kuerzung() });
    db._tables.RECEIVABLE_ADJUSTMENT[0].created_at = "2026-09-01T09:00:00.000Z";
    db._tables.ADVANCE_INVOICE.push({ ID: 702, TENANT_ID: T, STATUS_ID: 2, PROJECT_ID: 40, CONTRACT_ID: 30,
      DOCUMENT_RENDERED_AT: "2026-09-15T09:00:00.000Z", TOTAL_AMOUNT_NET: 8000, TOTAL_AMOUNT_GROSS: 9520 });
    await expect(adj.deleteAdjustment(db, { tenantId: T, id: row.ID })).rejects.toMatchObject({ status: 409 });
  });

  test("Storno nimmt die ausgebuchten Reste mit und gleicht die Summen aus", async () => {
    const db = welt();
    await adj.createAdjustment(db, { tenantId: T, body: kuerzung() });
    const n = await adj.removeForCancelledDoc(db, { tenantId: T, kind: "ADVANCE_INVOICE", id: 700 });
    expect(n).toBe(1);
    expect(db._tables.RECEIVABLE_ADJUSTMENT).toHaveLength(0);
    // Der Storno selbst zieht danach die vollen 30.000 ab — ohne diesen
    // Ausgleich stuende das Projekt bei -5.000.
    expect(db._tables.PROJECT[0].ADVANCE_INVOICED).toBe(30000);
  });
});

describe("splitRebillable", () => {
  test("rechnet den Nachlass zurueck, damit er nicht zweimal gewaehrt wird", () => {
    const parts = adj.splitRebillable(900, { net: 1000, discounts: 100 }, [
      { STRUCTURE_ID: 1, AMOUNT_NET: 600, AMOUNT_EXTRAS_NET: 0 },
      { STRUCTURE_ID: 2, AMOUNT_NET: 300, AMOUNT_EXTRAS_NET: 100 },
    ]);
    expect(parts.reduce((s, p) => s + p.total, 0)).toBeCloseTo(1000, 2);
    expect(parts[1]).toMatchObject({ net: 300, extras: 100 });
  });
});
