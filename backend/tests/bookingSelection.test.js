"use strict";

// Buchungsauswahl der Rechnungsassistenten: Stichtag fuer „Seit letzter
// Rechnung" und die Zeilen, die GET …/tec liefert.

const { makeFakeSupabase } = require("./helpers/fakeSupabase");
const { lastBilledDocument, tecEntry } = require("../services/bookingSelection");

const T = 1;
const ctx = { tenantId: T, projectId: 10, contractId: 20 };

function inv(id, over = {}) {
  return {
    ID: id, TENANT_ID: T, PROJECT_ID: 10, CONTRACT_ID: 20, STATUS_ID: 2, INVOICE_TYPE: "rechnung",
    INVOICE_NUMBER: `RE-${id}`, INVOICE_DATE: "2026-08-01", BILLING_PERIOD_FINISH: null, ...over,
  };
}
function adv(id, over = {}) {
  return {
    ID: id, TENANT_ID: T, PROJECT_ID: 10, CONTRACT_ID: 20, STATUS_ID: 2, CANCELS_ADVANCE_INVOICE_ID: null,
    ADVANCE_INVOICE_NUMBER: `AR-${id}`, ADVANCE_INVOICE_DATE: "2026-08-01", BILLING_PERIOD_FINISH: null, ...over,
  };
}

describe("lastBilledDocument", () => {
  it("ohne gebuchte Rechnung gibt es keinen Stichtag", async () => {
    const sb = makeFakeSupabase({ INVOICE: [inv(1, { STATUS_ID: 1 })], ADVANCE_INVOICE: [] });
    expect(await lastBilledDocument(sb, ctx)).toBeNull();
  });

  it("Stichtag ist das Ende des Leistungszeitraums, nicht das Rechnungsdatum", async () => {
    const sb = makeFakeSupabase({
      INVOICE: [],
      ADVANCE_INVOICE: [adv(5, { ADVANCE_INVOICE_DATE: "2026-10-05", BILLING_PERIOD_FINISH: "2026-09-30" })],
    });
    const last = await lastBilledDocument(sb, ctx);
    expect(last).toMatchObject({ kind: "abschlag", id: 5, number: "AR-5", date: "2026-10-05", since: "2026-09-30" });
  });

  it("ohne Leistungszeitraum gilt das Belegdatum", async () => {
    const sb = makeFakeSupabase({ INVOICE: [inv(1, { INVOICE_DATE: "2026-09-12" })], ADVANCE_INVOICE: [] });
    expect((await lastBilledDocument(sb, ctx)).since).toBe("2026-09-12");
  });

  it("zaehlt alle Rechnungsarten und nimmt den spaetesten Stichtag", async () => {
    const sb = makeFakeSupabase({
      INVOICE: [
        inv(1, { INVOICE_TYPE: "schlussrechnung", INVOICE_DATE: "2026-07-01" }),
        // nachgereichte Rechnung fuer August — juenger, aber der fruehere Zeitraum
        inv(2, { INVOICE_DATE: "2026-10-10", BILLING_PERIOD_FINISH: "2026-08-31" }),
      ],
      ADVANCE_INVOICE: [adv(5, { ADVANCE_INVOICE_DATE: "2026-10-05", BILLING_PERIOD_FINISH: "2026-09-30" })],
    });
    expect(await lastBilledDocument(sb, ctx)).toMatchObject({ kind: "abschlag", id: 5, since: "2026-09-30" });
  });

  it("Entwuerfe, stornierte Belege, Stornos und Rechnungskorrekturen zaehlen nicht", async () => {
    const sb = makeFakeSupabase({
      INVOICE: [
        inv(1, { INVOICE_DATE: "2026-06-30" }),
        inv(2, { INVOICE_DATE: "2026-09-01", STATUS_ID: 1 }),
        inv(3, { INVOICE_DATE: "2026-09-02", STATUS_ID: 3 }),
        inv(4, { INVOICE_DATE: "2026-09-03", INVOICE_TYPE: "stornorechnung" }),
        inv(6, { INVOICE_DATE: "2026-09-04", INVOICE_TYPE: "gutschrift" }),
      ],
      ADVANCE_INVOICE: [
        adv(7, { ADVANCE_INVOICE_DATE: "2026-09-05", CANCELS_ADVANCE_INVOICE_ID: 99 }),
        adv(8, { ADVANCE_INVOICE_DATE: "2026-09-06", STATUS_ID: 3 }),
      ],
    });
    expect(await lastBilledDocument(sb, ctx)).toMatchObject({ id: 1, since: "2026-06-30" });
  });

  it("nur derselbe Vertrag und derselbe Mandant", async () => {
    const sb = makeFakeSupabase({
      INVOICE: [
        inv(1, { INVOICE_DATE: "2026-05-01" }),
        inv(2, { INVOICE_DATE: "2026-09-01", CONTRACT_ID: 21 }),
        inv(3, { INVOICE_DATE: "2026-09-02", TENANT_ID: 2 }),
      ],
      ADVANCE_INVOICE: [],
    });
    expect((await lastBilledDocument(sb, ctx)).id).toBe(1);
  });

  it("ohne Vertrag gilt das Projekt", async () => {
    const sb = makeFakeSupabase({
      INVOICE: [inv(1, { CONTRACT_ID: null, INVOICE_DATE: "2026-09-01" }), inv(2, { PROJECT_ID: 11, INVOICE_DATE: "2026-09-09" })],
      ADVANCE_INVOICE: [],
    });
    expect((await lastBilledDocument(sb, { tenantId: T, projectId: 10, contractId: null })).id).toBe(1);
  });

  it("verlangt den Mandanten", async () => {
    const sb = makeFakeSupabase({ INVOICE: [], ADVANCE_INVOICE: [] });
    await expect(lastBilledDocument(sb, { projectId: 10, contractId: 20 })).rejects.toMatchObject({ status: 500 });
  });
});

describe("tecEntry", () => {
  const base = {
    ID: 3, BOOKING_DATE: "2026-09-02", POSTING_DESCRIPTION: "Planung", QUANTITY_EXT: 2.5, HOURLY_RATE: 105, HOURLY_RATE_TOTAL: 262.5,
    BOOKING_KIND: "WORK", STRUCTURE_ID: 40, EMPLOYEE: { ABBR: "SM" }, STRUCTURE: { ABBR: "LP3", NAME: "Entwurfsplanung" },
  };

  it("liefert Stunden, Stundensatz und die Leistung", () => {
    expect(tecEntry(base, true)).toEqual({
      ID: 3, BOOKING_DATE: "2026-09-02", EMPLOYEE_SHORT_NAME: "SM", POSTING_DESCRIPTION: "Planung",
      HOURLY_RATE_TOTAL: 262.5, HOURS: 2.5, HOURLY_RATE: 105, STRUCTURE_ID: 40, STRUCTURE_LABEL: "LP3 – Entwurfsplanung", ASSIGNED: true,
    });
  });

  it("Pauschalen und Stueckleistungen haben weder Stunden noch Stundensatz", () => {
    for (const kind of ["UNIT", "LUMP_COST", "LUMP_REVENUE"]) {
      const e = tecEntry({ ...base, BOOKING_KIND: kind, QUANTITY_EXT: 3 }, false);
      expect(e.HOURS).toBeNull();
      expect(e.HOURLY_RATE).toBeNull();
    }
  });

  it("fehlender Satz bleibt leer statt 0 €", () => {
    expect(tecEntry({ ...base, HOURLY_RATE: null }, false).HOURLY_RATE).toBeNull();
  });

  it("Altbestand ohne Buchungsart zaehlt als Stunden; fehlende Werte werden 0", () => {
    const e = tecEntry({ ...base, BOOKING_KIND: null, QUANTITY_EXT: null, HOURLY_RATE_TOTAL: null, STRUCTURE: null, EMPLOYEE: null }, false);
    expect(e).toMatchObject({ HOURS: 0, HOURLY_RATE_TOTAL: 0, STRUCTURE_LABEL: "", EMPLOYEE_SHORT_NAME: "", ASSIGNED: false });
  });
});
