"use strict";

// Buchungsauswahl in der Schlussrechnung. Vorher setzte die Schlussrechnung an
// keiner Buchung die INVOICE_ID: sie rechnete die Buchungen eines Elements nach
// Aufwand ab, sie blieben aber offen und standen in der naechsten
// Einzelrechnung noch einmal zur Auswahl.

const { makeFakeSupabase } = require("./helpers/fakeSupabase");
const { getPhases, savePhases, phaseRemaining } = require("../services/finalInvoices");

const T = 1;
const CONTRACT = 10;
const DRAFT = 1;
const SINGLE = 77;   // gebuchte Einzelrechnung, hat B5 abgerechnet
const AR = 50;       // gebuchter Abschlag, hat B1 abgerechnet
const HONORAR = 500; // Pauschal
const AUFWAND = 600; // nach Aufwand, 10 % Nebenkosten
const INTERN = 601;  // nach Aufwand, intern

function booking(ID, STRUCTURE_ID, HOURLY_RATE_TOTAL, over = {}) {
  return { ID, TENANT_ID: T, STRUCTURE_ID, HOURLY_RATE_TOTAL, STATUS: "CONFIRMED", INVOICE_ID: null, ADVANCE_INVOICE_ID: null, ...over };
}

function fixture() {
  return makeFakeSupabase({
    INVOICE: [
      { ID: DRAFT,  TENANT_ID: T, STATUS_ID: 1, PROJECT_ID: 100, CONTRACT_ID: CONTRACT, INVOICE_TYPE: "schlussrechnung", VAT_PERCENT: 19 },
      { ID: SINGLE, TENANT_ID: T, STATUS_ID: 2, PROJECT_ID: 100, CONTRACT_ID: CONTRACT, INVOICE_TYPE: "rechnung", VAT_PERCENT: 19 },
    ],
    INVOICE_STRUCTURE: [
      { ID: 1, TENANT_ID: T, INVOICE_ID: SINGLE, STRUCTURE_ID: AUFWAND, AMOUNT_NET: 400, AMOUNT_EXTRAS_NET: 40 },
    ],
    INVOICE_DEDUCTION: [],
    ADVANCE_INVOICE: [{ ID: AR, TENANT_ID: T, STATUS_ID: 2, CONTRACT_ID: CONTRACT, PROJECT_ID: 100 }],
    ADVANCE_INVOICE_STRUCTURE: [{ ID: 1, TENANT_ID: T, ADVANCE_INVOICE_ID: AR, STRUCTURE_ID: AUFWAND, AMOUNT_NET: 100, AMOUNT_EXTRAS_NET: 10 }],
    PROJECT_STRUCTURE: [
      { ID: HONORAR, TENANT_ID: T, PROJECT_ID: 100, CONTRACT_ID: CONTRACT, ABBR: "LP1", NAME: "Grundlagen", BILLING_TYPE_ID: 1,
        IS_INTERNAL: false, REVENUE_COMPLETION: 5000, EXTRAS_PERCENT: 0, ADVANCE_INVOICED: 0, INVOICED: 0, CLOSED_BY_INVOICE_ID: null, FATHER_ID: null },
      // Leistungsstand = Summe aller Buchungen: 100 + 200 + 300 + 0 + 400
      { ID: AUFWAND, TENANT_ID: T, PROJECT_ID: 100, CONTRACT_ID: CONTRACT, ABBR: "BL", NAME: "Besondere Leistungen", BILLING_TYPE_ID: 2,
        IS_INTERNAL: false, REVENUE_COMPLETION: 1000, EXTRAS_PERCENT: 10, ADVANCE_INVOICED: 110, INVOICED: 440, CLOSED_BY_INVOICE_ID: null, FATHER_ID: null },
      { ID: INTERN, TENANT_ID: T, PROJECT_ID: 100, CONTRACT_ID: CONTRACT, ABBR: "INT", NAME: "Intern", BILLING_TYPE_ID: 2,
        IS_INTERNAL: true, REVENUE_COMPLETION: 50, EXTRAS_PERCENT: 0, ADVANCE_INVOICED: 0, INVOICED: 0, CLOSED_BY_INVOICE_ID: null, FATHER_ID: null },
    ],
    BOOKING: [
      booking(1, AUFWAND, 100, { ADVANCE_INVOICE_ID: AR }),
      booking(2, AUFWAND, 200),
      booking(3, AUFWAND, 300),
      booking(4, AUFWAND, 0),
      booking(5, AUFWAND, 400, { INVOICE_ID: SINGLE }),
      booking(6, INTERN, 50),
      booking(7, AUFWAND, 999, { STATUS: "DRAFT" }),
    ],
  }, { strictSchema: true });
}

async function amountOf(sb, structureId) {
  const { data } = await sb.from("INVOICE_STRUCTURE").select("*").eq("INVOICE_ID", DRAFT).eq("STRUCTURE_ID", structureId);
  return (data || []).reduce((s, r) => s + Number(r.AMOUNT_NET) + Number(r.AMOUNT_EXTRAS_NET), 0);
}
async function assigned(sb) {
  const { data } = await sb.from("BOOKING").select("ID").eq("INVOICE_ID", DRAFT);
  return (data || []).map((b) => b.ID).sort();
}
async function invoiceOf(sb, id) {
  const { data } = await sb.from("BOOKING").select("INVOICE_ID").eq("ID", id).maybeSingle();
  return data.INVOICE_ID;
}

describe("Schlussrechnung: Buchungen nach Aufwand", () => {
  it("ohne Auswahl wie bisher abgerechnet — aber jetzt mit Zuordnung der offenen Buchungen", async () => {
    const sb = fixture();
    await savePhases(sb, { id: DRAFT, tenantId: T, structureIds: [HONORAR, AUFWAND] });
    // 1.100 Leistungsstand (inkl. 10 % NK) − 440 aus der Einzelrechnung; der Abschlag zieht erst Schritt 4 ab
    expect(await amountOf(sb, AUFWAND)).toBe(660);
    expect(await amountOf(sb, HONORAR)).toBe(5000);
    expect(await assigned(sb)).toEqual([2, 3, 4]);
    expect(await invoiceOf(sb, 1)).toBeNull();     // im Abschlag — bleibt dort
    expect(await invoiceOf(sb, 5)).toBe(SINGLE);   // schon abgerechnet
    expect(await invoiceOf(sb, 7)).toBeNull();     // Entwurf einer Buchung
  });

  it("abgewählte offene Buchungen mindern die Position samt Nebenkosten und bleiben offen", async () => {
    const sb = fixture();
    await savePhases(sb, { id: DRAFT, tenantId: T, structureIds: [AUFWAND], bookingIds: [3] });
    expect(await amountOf(sb, AUFWAND)).toBe(440); // 660 − 200 × 1,1
    expect(await assigned(sb)).toEqual([3]);
  });

  it("erneutes Speichern gibt Abgewähltes frei", async () => {
    const sb = fixture();
    await savePhases(sb, { id: DRAFT, tenantId: T, structureIds: [AUFWAND], bookingIds: [3] });
    await savePhases(sb, { id: DRAFT, tenantId: T, structureIds: [AUFWAND], bookingIds: [2, 4] });
    expect(await assigned(sb)).toEqual([2, 4]);
    expect(await amountOf(sb, AUFWAND)).toBe(330); // 660 − 300 × 1,1
  });

  it("ein Element abwählen gibt seine Buchungen frei", async () => {
    const sb = fixture();
    await savePhases(sb, { id: DRAFT, tenantId: T, structureIds: [AUFWAND] });
    await savePhases(sb, { id: DRAFT, tenantId: T, structureIds: [HONORAR] });
    expect(await assigned(sb)).toEqual([]);
    await savePhases(sb, { id: DRAFT, tenantId: T, structureIds: [AUFWAND] });
    await savePhases(sb, { id: DRAFT, tenantId: T, structureIds: [] });
    expect(await assigned(sb)).toEqual([]);
  });

  it("schon abgerechnete Buchungen lassen sich nicht hineinwählen; der Abschlag bleibt in der Position", async () => {
    const sb = fixture();
    await savePhases(sb, { id: DRAFT, tenantId: T, structureIds: [AUFWAND], bookingIds: [1, 5] });
    expect(await assigned(sb)).toEqual([]);
    expect(await invoiceOf(sb, 5)).toBe(SINGLE);
    // Alle offenen abgewählt: übrig bleibt der per Abschlag abgerechnete Teil (100 × 1,1),
    // den Schritt 4 als Gezahltes wieder abzieht.
    expect(await amountOf(sb, AUFWAND)).toBe(110);
  });

  it("interne Elemente fasst die Auswahl nicht an (wie die Auswahlliste)", async () => {
    const sb = fixture();
    await savePhases(sb, { id: DRAFT, tenantId: T, structureIds: [INTERN], bookingIds: [] });
    expect(await amountOf(sb, INTERN)).toBe(50);
    expect(await invoiceOf(sb, 6)).toBeNull();
  });

  it("Buchungen eines fremden Mandanten bleiben unberührt", async () => {
    const sb = fixture();
    await sb.from("BOOKING").insert({ ...booking(8, AUFWAND, 70), TENANT_ID: 2 });
    await savePhases(sb, { id: DRAFT, tenantId: T, structureIds: [AUFWAND] });
    expect(await invoiceOf(sb, 8)).toBeNull();
  });

  it("getPhases liefert den Nebenkosten-Satz für die Live-Rechnung", async () => {
    const sb = fixture();
    const phases = await getPhases(sb, { id: DRAFT, tenantId: T });
    expect(phases.find((p) => p.ID === AUFWAND).EXTRAS_PERCENT).toBe(10);
  });

  it("phaseRemaining wird nie negativ", () => {
    expect(phaseRemaining({ totalEarned: 100, billedFinal: 0, deselected: 200, extrasPercent: 10 })).toBe(0);
    expect(phaseRemaining({ totalEarned: 1100, billedFinal: 440, deselected: 0, extrasPercent: 10 })).toBe(660);
  });
});
