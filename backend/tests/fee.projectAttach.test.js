"use strict";

// Kalkulation in die Projektstruktur uebernehmen (HOAI-Assistent, Schritt
// „In die Struktur übernehmen").
//
// BEFUND 2026-10-03: Der Schritt endete immer mit „Es ist ein interner Fehler
// aufgetreten" — im Protokoll:
//     assertInTenant(PROJECT_STRUCTURE): tenantId ist erforderlich
// Der Controller rief checkParentForChild seit 05/2026 ohne tenantId auf. Das
// fiel nicht auf, bis die Mandanten-Haertung vom 08.08.2026 die Pruefung zur
// Pflicht machte; seitdem liess sich im Projekt keine Kalkulation mehr
// uebernehmen.
//
// Daneben: die Leistungsstaende der Besonderen Leistungen gingen ueber
// `insert(...).catch(...)` — ein PostgREST-Aufruf kennt kein .catch, der
// Aufruf warf, ein Soft-Fail schluckte es, und die Zeilen entstanden nie.

const { makeFakeSupabase } = require("./helpers/fakeSupabase");
const { postFeeCalcAddToStructure } = require("../controllers/stammdaten");

const T = 4;
const FREMD = 9;

function db() {
  return makeFakeSupabase({
    FEE_CALCULATION_MASTER: [
      { ID: 60, TENANT_ID: T, PROJECT_ID: 3, ABBR: "§ 34", NAME: "Gebäude" },
    ],
    PROJECT: [
      { ID: 3, TENANT_ID: T },
    ],
    PROJECT_STRUCTURE: [
      { ID: 20, TENANT_ID: T, PROJECT_ID: 3, FATHER_ID: null, ABBR: "1", NAME: "HOAI 1", BILLING_TYPE_ID: 1, EXTRAS_PERCENT: 0, REVENUE: 0, EXTRAS: 0, COSTS: 0 },
      // Gleiche Projekt-ID, anderer Mandant: darf nie als Vater gelten.
      { ID: 91, TENANT_ID: FREMD, PROJECT_ID: 3, FATHER_ID: null, ABBR: "X", BILLING_TYPE_ID: 1, EXTRAS_PERCENT: 0 },
    ],
    FEE_CALCULATION_PHASE: [
      { ID: 601, TENANT_ID: T, FEE_MASTER_ID: 60, FEE_PHASE_ID: 1, FEE_PERCENT: 3, PHASE_REVENUE: 3000 },
      { ID: 602, TENANT_ID: T, FEE_MASTER_ID: 60, FEE_PHASE_ID: 2, FEE_PERCENT: 7, PHASE_REVENUE: 7000 },
      { ID: 603, TENANT_ID: T, FEE_MASTER_ID: 60, FEE_PHASE_ID: 3, FEE_PERCENT: 0, PHASE_REVENUE: 0 },
    ],
    FEE_PHASE: [
      { ID: 1, ABBR: "LPH 1", NAME: "Grundlagenermittlung", SORT_ORDER: 1 },
      { ID: 2, ABBR: "LPH 2", NAME: "Vorplanung", SORT_ORDER: 2 },
      { ID: 3, ABBR: "LPH 3", NAME: "Entwurfsplanung", SORT_ORDER: 3 },
    ],
    FEE_CALCULATION_BL: [
      { ID: 70, TENANT_ID: T, FEE_CALC_MASTER_ID: 60, ABBR: "BL1", NAME: "Erweiterung BL1", AMOUNT: 253.41, SORT_ORDER: 0 },
    ],
    FEE_CALCULATION_SURCHARGES: [],
    PROJECT_PROGRESS: [],
    BOOKING: [],
  });
}

async function call(sb, id, body) {
  const res = { statusCode: 200, body: null };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json   = (b) => { res.body = b; return res; };
  await postFeeCalcAddToStructure({ params: { id: String(id) }, body, tenantId: T }, res, sb);
  return res;
}

describe("Kalkulation in die Projektstruktur uebernehmen", () => {
  test("legt Phasen und Besondere Leistungen unter dem Element an", async () => {
    const sb = db();
    const res = await call(sb, 60, { father_id: 20, confirmed: true });
    expect(res.body?.error).toBeUndefined();
    expect(res.statusCode).toBe(200);

    const kinder = sb._tables.PROJECT_STRUCTURE.filter(r => r.FATHER_ID === 20);
    // Phase ohne Prozent und Betrag faellt weg
    expect(kinder.map(r => r.ABBR)).toEqual(["LPH 1", "LPH 2", "BL1"]);
    expect(kinder.every(r => r.TENANT_ID === T && r.FEE_CALC_MASTER_ID === 60)).toBe(true);
    expect(kinder.find(r => r.ABBR === "BL1")).toMatchObject({ FEE_CALC_BL_ID: 70, REVENUE: 253.41 });
  });

  test("jedes neue Element bekommt seinen Leistungsstand — auch die Besonderen Leistungen", async () => {
    const sb = db();
    await call(sb, 60, { father_id: 20, confirmed: true });
    const kinder = sb._tables.PROJECT_STRUCTURE.filter(r => r.FATHER_ID === 20);
    expect(kinder).toHaveLength(3);
    const mitStand = new Set(sb._tables.PROJECT_PROGRESS.map(r => r.STRUCTURE_ID));
    expect(kinder.filter(r => !mitStand.has(r.ID)).map(r => r.ABBR)).toEqual([]);
  });

  test("ein Element eines fremden Mandanten ist kein Vater", async () => {
    const sb = db();
    const res = await call(sb, 60, { father_id: 91, confirmed: true });
    expect(res.statusCode).toBe(404);
    expect(sb._tables.PROJECT_STRUCTURE.filter(r => r.FATHER_ID === 91)).toHaveLength(0);
  });
});
