"use strict";

// Kalkulation ins Angebot uebernehmen (UI-Pilot Runde 5): der Assistent bot
// „Keine Zuordnung" an, die Route wies ein fehlendes Element aber ab — ein
// frisch angelegtes Angebot ohne Struktur liess sich so nie abschliessen.
// Ohne Element entsteht jetzt eines auf oberster Ebene; der Anker
// ATTACH_TO_OFFER_STRUCTURE_ID verhindert, dass das Beauftragen die Phasen
// ein zweites Mal anlegt. Dazu: das Element muss zum Angebot gehoeren.

const { makeFakeSupabase } = require("./helpers/fakeSupabase");
const { postFeeCalcAddToOfferStructure } = require("../controllers/stammdaten");

const T = 7;

function db() {
  return makeFakeSupabase({
    FEE_CALCULATION_MASTER: [
      { ID: 50, TENANT_ID: T, OFFER_ID: 1, PROJECT_ID: null, ABBR: "§ 34", NAME: "Gebäude", ATTACH_TO_OFFER_STRUCTURE_ID: null },
      { ID: 51, TENANT_ID: T, OFFER_ID: null, PROJECT_ID: 3 },
    ],
    FEE_CALCULATION_PHASE: [
      { ID: 501, FEE_MASTER_ID: 50, FEE_PHASE_ID: 1, KX: "K0", FEE_PERCENT: 3, PHASE_REVENUE: 3000 },
      { ID: 502, FEE_MASTER_ID: 50, FEE_PHASE_ID: 2, KX: "K0", FEE_PERCENT: 7, PHASE_REVENUE: 7000 },
    ],
    FEE_PHASE: [
      { ID: 1, ABBR: "LPH 1", NAME: "Grundlagenermittlung", FEE_PERCENT: 2, SORT_ORDER: 1 },
      { ID: 2, ABBR: "LPH 2", NAME: "Vorplanung", FEE_PERCENT: 7, SORT_ORDER: 2 },
    ],
    FEE_CALCULATION_BL: [],
    FEE_CALCULATION_SURCHARGES: [],
    OFFER_STRUCTURE: [
      { ID: 10, TENANT_ID: T, OFFER_ID: 1, FATHER_ID: null, ABBR: "A", SORT_ORDER: 0, BILLING_TYPE_ID: 1, EXTRAS_PERCENT: 5 },
      { ID: 90, TENANT_ID: T, OFFER_ID: 2, FATHER_ID: null, ABBR: "X", SORT_ORDER: 0, BILLING_TYPE_ID: 1 },
    ],
  });
}

async function call(sb, id, body) {
  const res = { statusCode: 200, body: null };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json   = (b) => { res.body = b; return res; };
  await postFeeCalcAddToOfferStructure({ params: { id: String(id) }, body, tenantId: T }, res, sb);
  return res;
}

describe("Kalkulation ins Angebot uebernehmen", () => {
  test("ohne Element: eigenes Element auf oberster Ebene, Phasen darunter, Anker gesetzt", async () => {
    const sb = db();
    const res = await call(sb, 50, { father_id: null });
    expect(res.statusCode).toBe(200);
    const wurzel = sb._tables.OFFER_STRUCTURE.find(r => r.OFFER_ID === 1 && r.ABBR === "§ 34");
    expect(wurzel).toMatchObject({ FATHER_ID: null, NAME: "Gebäude", SORT_ORDER: 10, REVENUE: 10000 });
    const phasen = sb._tables.OFFER_STRUCTURE.filter(r => r.FATHER_ID === wurzel.ID);
    expect(phasen.map(r => r.ABBR)).toEqual(["LPH 1", "LPH 2"]);
    expect(sb._tables.FEE_CALCULATION_MASTER[0].ATTACH_TO_OFFER_STRUCTURE_ID).toBe(wurzel.ID);
    expect(res.body.fatherId).toBe(wurzel.ID);
  });

  test("unter einem Element des eigenen Angebots", async () => {
    const sb = db();
    const res = await call(sb, 50, { father_id: 10 });
    expect(res.statusCode).toBe(200);
    const kinder = sb._tables.OFFER_STRUCTURE.filter(r => r.FATHER_ID === 10);
    expect(kinder).toHaveLength(2);
    expect(kinder[0]).toMatchObject({ OFFER_ID: 1, EXTRAS_PERCENT: 5 });
    expect(sb._tables.FEE_CALCULATION_MASTER[0].ATTACH_TO_OFFER_STRUCTURE_ID).toBe(10);
  });

  test("Element eines anderen Angebots, Projekt-Kalkulation: abgewiesen", async () => {
    const sb = db();
    expect((await call(sb, 50, { father_id: 90 })).statusCode).toBe(400);
    expect(sb._tables.OFFER_STRUCTURE.filter(r => r.OFFER_ID === 2)).toHaveLength(1);
    expect((await call(sb, 51, { father_id: null })).statusCode).toBe(400);
    expect((await call(sb, 50, { father_id: "abc" })).statusCode).toBe(400);
  });
});
