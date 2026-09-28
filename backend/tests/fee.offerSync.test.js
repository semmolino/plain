"use strict";

// „Angebot aktualisieren" und „Struktur aktualisieren" (UI-Pilot Runde 6):
// Elemente aus einer Kalkulation tragen die Verknuepfung (Migration 0174 im
// Angebot, 0041/0043 im Projekt). Beim Abgleich zaehlen Phase + Zuschlags-
// anteil, darauf die eigenen Zuschlaege und NK des Elements; das Feld
// „Honorar" (REVENUE_BASIS) zieht mit. Beim Beauftragen geht die
// Verknuepfung ins Projekt ueber.

const { makeFakeSupabase } = require("./helpers/fakeSupabase");
const { syncFeeCalcToStructure } = require("../controllers/stammdaten");
const angebote = require("../services/angebote");

const T = 7;

async function sync(sb, id) {
  const res = { statusCode: 200, body: null };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json   = (b) => { res.body = b; return res; };
  await syncFeeCalcToStructure({ params: { id: String(id) }, tenantId: T }, res, sb);
  return res;
}

const calcTables = (masterOver = {}) => ({
  FEE_CALCULATION_MASTER: [{ ID: 50, TENANT_ID: T, OFFER_ID: 1, PROJECT_ID: null, ABBR: "§ 34", NAME: "Gebäude", ATTACH_TO_OFFER_STRUCTURE_ID: 10, ...masterOver }],
  // Kalkulation inzwischen geaendert: LPH 2 von 7.000 auf 8.000
  FEE_CALCULATION_PHASE: [
    { ID: 501, FEE_MASTER_ID: 50, FEE_PHASE_ID: 1, PHASE_REVENUE: 3000 },
    { ID: 502, FEE_MASTER_ID: 50, FEE_PHASE_ID: 2, PHASE_REVENUE: 8000 },
  ],
  FEE_CALCULATION_BL: [
    { ID: 601, FEE_CALC_MASTER_ID: 50, TENANT_ID: T, ABBR: "BL1", NAME: "Brandschutz", AMOUNT: 1000, SORT_ORDER: 0 },
    { ID: 602, FEE_CALC_MASTER_ID: 50, TENANT_ID: T, ABBR: "BL2", NAME: "Bestand", AMOUNT: 500, SORT_ORDER: 1 },
  ],
  // 10 % Zuschlag nur auf die Leistungsphasen: 1.100 → 300 / 800
  FEE_CALCULATION_SURCHARGES: [{ FEE_CALC_MASTER_ID: 50, TENANT_ID: T, AMOUNT: 1100, LPH_FILTER: null, BL_FILTER: null, SORT_ORDER: 0 }],
});

describe("Angebot aktualisieren", () => {
  const db = () => makeFakeSupabase({
    ...calcTables(),
    OFFER: [{ ID: 1, TENANT_ID: T, SURCHARGE_1_LABEL: null }],
    OFFER_STRUCTURE: [
      { ID: 10, TENANT_ID: T, OFFER_ID: 1, FATHER_ID: null, ABBR: "§ 34", BILLING_TYPE_ID: 1, EXTRAS_PERCENT: 0, REVENUE: 11000, SORT_ORDER: 0 },
      { ID: 11, TENANT_ID: T, OFFER_ID: 1, FATHER_ID: 10, ABBR: "LPH 1", BILLING_TYPE_ID: 1, EXTRAS_PERCENT: 5, SORT_ORDER: 0,
        REVENUE_BASIS: 3300, REVENUE: 3300, EXTRAS: 165, FEE_CALC_MASTER_ID: 50, FEE_CALC_PHASE_ID: 501 },
      // eigener Nachlass am Element bleibt erhalten
      { ID: 12, TENANT_ID: T, OFFER_ID: 1, FATHER_ID: 10, ABBR: "LPH 2", BILLING_TYPE_ID: 1, EXTRAS_PERCENT: 5, SORT_ORDER: 10,
        SURCHARGE_1_LABEL: "Nachlass", SURCHARGE_1_PCT: -10, SURCHARGE_1_CUMUL: true,
        REVENUE_BASIS: 7700, REVENUE: 6930, EXTRAS: 346.5, FEE_CALC_MASTER_ID: 50, FEE_CALC_PHASE_ID: 502 },
      { ID: 13, TENANT_ID: T, OFFER_ID: 1, FATHER_ID: 10, ABBR: "Brandschutz", BILLING_TYPE_ID: 1, EXTRAS_PERCENT: 5, SORT_ORDER: 20,
        REVENUE_BASIS: 900, REVENUE: 900, EXTRAS: 45, FEE_CALC_MASTER_ID: 50, FEE_CALC_BL_ID: 601 },
      // von Hand angelegt, gehoert nicht dazu
      { ID: 14, TENANT_ID: T, OFFER_ID: 1, FATHER_ID: null, ABBR: "X", BILLING_TYPE_ID: 1, REVENUE_BASIS: 50, REVENUE: 50, EXTRAS: 0 },
    ],
  });
  const row = (sb, id) => sb._tables.OFFER_STRUCTURE.find(r => r.ID === id);

  test("Phasen samt Anteil, eigene Zuschläge, NK; neue BL daneben; Vater neu", async () => {
    const sb = db();
    const res = await sync(sb, 50);
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ synced: 4, offerId: 1, message: "4 Angebotselemente wurden aktualisiert." });
    expect(row(sb, 11)).toMatchObject({ REVENUE_BASIS: 3300, REVENUE: 3300, EXTRAS: 165 });
    // 8.000 + 800 = 8.800, Nachlass 10 % = -880 → 7.920, NK 5 % = 396
    expect(row(sb, 12)).toMatchObject({ REVENUE_BASIS: 8800, SURCHARGES_TOTAL: -880, REVENUE: 7920, EXTRAS: 396 });
    expect(row(sb, 13)).toMatchObject({ REVENUE_BASIS: 1000, REVENUE: 1000, EXTRAS: 50 });
    const neu = sb._tables.OFFER_STRUCTURE.find(r => r.FEE_CALC_BL_ID === 602);
    expect(neu).toMatchObject({ FATHER_ID: 10, REVENUE: 500, EXTRAS: 25, EXTRAS_PERCENT: 5, FEE_CALC_MASTER_ID: 50 });
    expect(row(sb, 10).REVENUE).toBe(3300 + 7920 + 1000 + 500);
    expect(row(sb, 14)).toMatchObject({ REVENUE: 50 });
  });

  test("ohne verknüpfte Elemente: nichts, keine Fehlermeldung", async () => {
    const sb = db();
    for (const r of sb._tables.OFFER_STRUCTURE) delete r.FEE_CALC_MASTER_ID;
    const res = await sync(sb, 50);
    expect(res.body).toMatchObject({ synced: 0, message: "Keine Elemente aktualisiert." });
  });
});

describe("Struktur aktualisieren im Projekt", () => {
  test("eigene Zuschläge bleiben, das Honorar-Feld zieht mit", async () => {
    const sb = makeFakeSupabase({
      ...calcTables({ PROJECT_ID: 3, OFFER_ID: null }),
      PROJECT: [{ ID: 3, TENANT_ID: T }],
      PROJECT_STRUCTURE: [
        { ID: 30, TENANT_ID: T, PROJECT_ID: 3, FATHER_ID: null, BILLING_TYPE_ID: 1, EXTRAS_PERCENT: 0, REVENUE: 0 },
        { ID: 32, TENANT_ID: T, PROJECT_ID: 3, FATHER_ID: 30, BILLING_TYPE_ID: 1, EXTRAS_PERCENT: 5,
          SURCHARGE_1_LABEL: "Nachlass", SURCHARGE_1_PCT: -10, SURCHARGE_1_CUMUL: true,
          REVENUE_BASIS: 7700, REVENUE: 6930, EXTRAS: 346.5, FEE_CALC_MASTER_ID: 50, FEE_CALC_PHASE_ID: 502 },
      ],
    });
    const res = await sync(sb, 50);
    expect(res.statusCode).toBe(200);
    expect(sb._tables.PROJECT_STRUCTURE.find(r => r.ID === 32)).toMatchObject({ REVENUE_BASIS: 8800, REVENUE: 7920, EXTRAS: 396 });
  });
});

describe("Beauftragen", () => {
  test("die Verknüpfung geht ins Projekt über", async () => {
    const sb = makeFakeSupabase({
      OFFER: [{ ID: 1, TENANT_ID: T, ABBR: "A-1", NAME: "Kita", COMPANY_ID: 5, ADDRESS_ID: 9, CONTACT_ID: 11, PROJECT_ID: null, SURCHARGES_TOTAL: 0 }],
      OFFER_STRUCTURE: [
        { ID: 10, OFFER_ID: 1, TENANT_ID: T, FATHER_ID: null, BILLING_TYPE_ID: 1, ABBR: "§ 34", SORT_ORDER: 0, REVENUE: 3300, REVENUE_BASIS: 3300 },
        { ID: 11, OFFER_ID: 1, TENANT_ID: T, FATHER_ID: 10, BILLING_TYPE_ID: 1, ABBR: "LPH 1", SORT_ORDER: 0, REVENUE: 3300, REVENUE_BASIS: 3300,
          FEE_CALC_MASTER_ID: 50, FEE_CALC_PHASE_ID: 501 },
      ],
      ...calcTables(),
    });
    sb.rpc = async () => ({ data: "P-2026-001", error: null });
    await angebote.convertOfferToProject(sb, { tenantId: T, offerId: 1, body: { order_date: "2026-09-28", project_status_id: 1, project_manager_id: 3 } });
    const lph = sb._tables.PROJECT_STRUCTURE.find(r => r.ABBR === "LPH 1");
    expect(lph).toMatchObject({ FEE_CALC_MASTER_ID: 50, FEE_CALC_PHASE_ID: 501 });
    // Die Phasen stehen schon im Angebot — kein zweites Mal anlegen
    expect(sb._tables.PROJECT_STRUCTURE.filter(r => r.ABBR === "LPH 1")).toHaveLength(1);
  });
});
