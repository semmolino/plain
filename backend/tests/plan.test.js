"use strict";

// Plan am Projekt-Element (Migration 0173, UI-Pilot Runde 5): beim
// Beauftragen geht die Schaetzung eines Elements nach Aufwand als Plan mit,
// die Budgetwarnung vergleicht dort das gebuchte Honorar mit dem Plan statt
// die Kosten mit dem (mitwachsenden) gebuchten Honorar.

const { makeFakeSupabase } = require("./helpers/fakeSupabase");
const angebote = require("../services/angebote");
const projekte = require("../services/projekte");
const { loadProjectTree, aggregateSubtree } = require("../services/budgetWarnings");

const T = 7;

function offerDb(extra = {}) {
  const sb = makeFakeSupabase({
    OFFER: [{ ID: 1, TENANT_ID: T, ABBR: "A-1", NAME: "Kita", COMPANY_ID: 5, ADDRESS_ID: 9, CONTACT_ID: 11, PROJECT_ID: null, SURCHARGES_TOTAL: 0 }],
    OFFER_STRUCTURE: [
      { ID: 20, OFFER_ID: 1, TENANT_ID: T, FATHER_ID: null, BILLING_TYPE_ID: 2, ABBR: "BL", SORT_ORDER: 0, REVENUE: 3240, REVENUE_BASIS: 3240 },
      { ID: 21, OFFER_ID: 1, TENANT_ID: T, FATHER_ID: 20, BILLING_TYPE_ID: 2, ABBR: "BL1", SORT_ORDER: 0,
        EFFORT_LINES: [{ role_id: 2, role_abbr: "PL", role_name: null, hours: 8, rate: 120 }, { role_id: 4, role_abbr: "TZ", role_name: null, hours: 16, rate: 85 }],
        QUANTITY: 24, HOURLY_RATE: null, REVENUE: 2320, REVENUE_BASIS: 2320 },
      // Altbestand: eine Rolle ueber die Einzelspalten
      { ID: 22, OFFER_ID: 1, TENANT_ID: T, FATHER_ID: 20, BILLING_TYPE_ID: 2, ABBR: "BL2", SORT_ORDER: 10,
        QUANTITY: 10, HOURLY_RATE: 92, ROLE_ID: 3, EFFORT_LINES: null, REVENUE: 920, REVENUE_BASIS: 920 },
      { ID: 23, OFFER_ID: 1, TENANT_ID: T, FATHER_ID: null, BILLING_TYPE_ID: 1, ABBR: "LP1", SORT_ORDER: 10, REVENUE: 5000, REVENUE_BASIS: 5000 },
    ],
    ...extra,
  });
  sb.rpc = async () => ({ data: "P-2026-001", error: null });
  return sb;
}
const BODY = { order_date: "2026-09-28", project_status_id: 1, project_manager_id: 3 };
const byAbbr = (sb) => Object.fromEntries(sb._tables.PROJECT_STRUCTURE.map(r => [r.ABBR, r]));

describe("Beauftragen: Plan aus den Aufwandszeilen", () => {
  test("Blaetter nach Aufwand bekommen den Plan, Vater und Pauschal nicht", async () => {
    const sb = offerDb();
    await angebote.convertOfferToProject(sb, { tenantId: T, offerId: 1, body: BODY });
    const s = byAbbr(sb);
    expect(s.BL1).toMatchObject({ PLAN_HOURS: 24, PLAN_REVENUE: 2320, REVENUE: 0 });
    expect(s.BL2).toMatchObject({ PLAN_HOURS: 10, PLAN_REVENUE: 920 });
    expect(s.BL.PLAN_REVENUE).toBeUndefined();
    expect(s.LP1.PLAN_REVENUE).toBeUndefined();
    expect(s.LP1.REVENUE).toBe(5000);
  });

  test("transfer_plan: false laesst den Plan weg", async () => {
    const sb = offerDb();
    await angebote.convertOfferToProject(sb, { tenantId: T, offerId: 1, body: { ...BODY, transfer_plan: false } });
    expect(byAbbr(sb).BL1.PLAN_REVENUE).toBeUndefined();
  });
});

function projectDb(bookings) {
  return makeFakeSupabase({
    PROJECT_STRUCTURE: [
      { ID: 30, PROJECT_ID: 2, TENANT_ID: T, FATHER_ID: null, BILLING_TYPE_ID: 2, REVENUE: 1900, COSTS: 1200, SURCHARGES_TOTAL: 0 },
      { ID: 31, PROJECT_ID: 2, TENANT_ID: T, FATHER_ID: 30, BILLING_TYPE_ID: 2, REVENUE: 1900, COSTS: 1200, SURCHARGES_TOTAL: 0, PLAN_HOURS: 24, PLAN_REVENUE: 2320 },
      { ID: 32, PROJECT_ID: 2, TENANT_ID: T, FATHER_ID: 30, BILLING_TYPE_ID: 1, REVENUE: 5000, COSTS: 1000, SURCHARGES_TOTAL: 0 },
    ],
    BOOKING: bookings,
  });
}

describe("Budgetwarnung mit Plan", () => {
  test("Blatt mit Plan: Budget = Plan, Verbrauch = gebuchtes Honorar ohne Entwuerfe", async () => {
    const sb = projectDb([
      { ID: 1, STRUCTURE_ID: 31, HOURLY_RATE_TOTAL: 1140, STATUS: "CONFIRMED" },
      { ID: 2, STRUCTURE_ID: 31, HOURLY_RATE_TOTAL: 760, STATUS: "CONFIRMED" },
      { ID: 3, STRUCTURE_ID: 31, HOURLY_RATE_TOTAL: 999, STATUS: "DRAFT" },
    ]);
    const { nodes, childrenOf } = await loadProjectTree(sb, 2);
    expect(aggregateSubtree("31", nodes, childrenOf)).toEqual({ budget: 2320, verbrauch: 1900, plan: "all" });
    // Pauschal-Blatt wie bisher: Honorar gegen Kosten
    expect(aggregateSubtree("32", nodes, childrenOf)).toEqual({ budget: 5000, verbrauch: 1000, plan: "none" });
    // Vater mischt beide — die Beschriftung sagt das
    expect(aggregateSubtree("30", nodes, childrenOf)).toMatchObject({ budget: 7320, verbrauch: 2900, plan: "some" });
  });

  test("ohne Plan rechnet ein Aufwand-Blatt wie bisher", async () => {
    const sb = projectDb([]);
    sb._tables.PROJECT_STRUCTURE[1].PLAN_REVENUE = null;
    const { nodes, childrenOf } = await loadProjectTree(sb, 2);
    expect(aggregateSubtree("31", nodes, childrenOf)).toEqual({ budget: 1900, verbrauch: 1200, plan: "none" });
  });
});

describe("Plan im Projekt aendern", () => {
  const db = () => makeFakeSupabase({
    PROJECT_STRUCTURE: [
      { ID: 31, PROJECT_ID: 2, TENANT_ID: T, FATHER_ID: null, BILLING_TYPE_ID: 2, REVENUE: 0 },
      { ID: 32, PROJECT_ID: 2, TENANT_ID: T, FATHER_ID: null, BILLING_TYPE_ID: 1, REVENUE: 5000 },
      { ID: 99, PROJECT_ID: 8, TENANT_ID: 8, FATHER_ID: null, BILLING_TYPE_ID: 2, REVENUE: 0 },
    ],
    PROJECT: [{ ID: 2, TENANT_ID: T }],
  });

  test("setzt und leert den Plan", async () => {
    const sb = db();
    await projekte.patchStructurePlan(sb, { structureId: 31, tenantId: T, planHours: "30", planRevenue: 2850 });
    expect(sb._tables.PROJECT_STRUCTURE[0]).toMatchObject({ PLAN_HOURS: 30, PLAN_REVENUE: 2850 });
    await projekte.patchStructurePlan(sb, { structureId: 31, tenantId: T, planHours: "", planRevenue: null });
    expect(sb._tables.PROJECT_STRUCTURE[0]).toMatchObject({ PLAN_HOURS: null, PLAN_REVENUE: null });
  });

  test("nur nach Aufwand, keine negativen Werte, kein fremder Mandant", async () => {
    const sb = db();
    await expect(projekte.patchStructurePlan(sb, { structureId: 32, tenantId: T, planHours: 1, planRevenue: 1 }))
      .rejects.toMatchObject({ status: 400 });
    await expect(projekte.patchStructurePlan(sb, { structureId: 31, tenantId: T, planHours: -1, planRevenue: 1 }))
      .rejects.toMatchObject({ status: 400 });
    await expect(projekte.patchStructurePlan(sb, { structureId: 99, tenantId: T, planHours: 1, planRevenue: 1 }))
      .rejects.toMatchObject({ status: 404 });
  });
});
