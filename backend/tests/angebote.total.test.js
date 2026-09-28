"use strict";

// Angebotssumme der Liste = Summe im Angebots-PDF (services/angebote.js,
// offerNetTotal). Vorher summierte die Liste nur die Blaetter: Zuschlaege auf
// Vaetern und am Angebot fehlten, der Kopf des Angebots zeigte eine andere
// Zahl als die Struktur darunter.

const { makeFakeSupabase } = require("./helpers/fakeSupabase");
const svc = require("../services/angebote");

const T = 7;
// Vater LPH: Kinder 10.000 + 20.000, eigener Zuschlag 10 % → REVENUE 33.000,
// NK 5 % → 1.650. Blatt BL ohne Vater: 1.000, NK 0. Angebot: −3 % Nachlass.
const OFFER = { ID: 1, TENANT_ID: T, ABBR: "A-1", NAME: "Test", SURCHARGES_TOTAL: -1020 };
const STRUCT = [
  { ID: 10, OFFER_ID: 1, TENANT_ID: T, FATHER_ID: null, REVENUE: 33000, EXTRAS: 1650, SURCHARGES_TOTAL: 3000 },
  { ID: 11, OFFER_ID: 1, TENANT_ID: T, FATHER_ID: 10,   REVENUE: 10000, EXTRAS: 500 },
  { ID: 12, OFFER_ID: 1, TENANT_ID: T, FATHER_ID: 10,   REVENUE: 20000, EXTRAS: 1000 },
  { ID: 20, OFFER_ID: 1, TENANT_ID: T, FATHER_ID: null, REVENUE: 1000,  EXTRAS: 0 },
];

describe("Angebotssumme", () => {
  test("offerNetTotal: Wurzel-Honorar + Angebotszuschlaege + Wurzel-NK", () => {
    expect(svc.offerNetTotal(STRUCT, -1020)).toBe(33000 + 1000 - 1020 + 1650);
  });

  test("Liste rechnet wie das PDF — mit Vater- und Angebotszuschlaegen", async () => {
    const supabase = makeFakeSupabase({ OFFER: [OFFER], OFFER_STRUCTURE: STRUCT });
    const rows = await svc.listOffers(supabase, { tenantId: T });
    expect(rows).toHaveLength(1);
    // Nur-Blaetter haette 10.000 + 20.000 + 1.000 + NK 1.500 = 32.500 ergeben
    expect(rows[0].TOTAL_AMOUNT).toBe(34630);
  });

  test("Angebot ohne Struktur hat keine Summe", async () => {
    const supabase = makeFakeSupabase({ OFFER: [OFFER], OFFER_STRUCTURE: [] });
    const rows = await svc.listOffers(supabase, { tenantId: T });
    expect(rows[0].TOTAL_AMOUNT).toBeNull();
  });
});
