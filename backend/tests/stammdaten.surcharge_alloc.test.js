"use strict";

// B6 (Audit 25.08.2026): Die Zuschlagsanteile blieben ungerundet und wurden erst
// je Strukturzeile gerundet, ohne Restausgleich. 100,00 EUR auf 3 gleich grosse
// Leistungsphasen ergaben 3 x 33,33 = 99,99 EUR -- die Zuschlagszeile im PDF wies
// aber 100,00 EUR aus. Ein Cent, der in Summen und Rechnungen weiterlaeuft.

const { computeSurchargeAllocations, distributeWithRemainder } = require("../controllers/stammdaten");

// ENTSCHEIDEND: jeden Anteil einzeln runden, bevor summiert wird -- genau das
// tun die Verbraucher (controllers/stammdaten.js:605-607 und :1922, jeweils
// Math.round(... * 100) / 100 je Strukturzeile). Ohne diese Rundung sind auch
// die ungerundeten Anteile der alten Fassung in Summe exakt, und der Test
// waere gruen gewesen, ohne irgendetwas zu beweisen.
const sum = (obj) => Math.round(
  Object.values(obj).reduce((s, v) => s + Math.round(v * 100) / 100, 0) * 100
) / 100;

const phasen = (n, revenue) =>
  Array.from({ length: n }, (_, i) => ({ ID: i + 1, PHASE_REVENUE: revenue }));

const zuschlag = (over) => Object.assign({
  ID: 1, AMOUNT: 100, PERCENT: 10, LPH_FILTER: null, BL_FILTER: null, CALC_MODE: 'parallel',
}, over);

describe("distributeWithRemainder (B6)", () => {
  it("verteilt 100,00 auf drei gleiche Teile ohne Cent-Verlust", () => {
    const out = distributeWithRemainder(100, [
      { key: 'a', weight: 1000 }, { key: 'b', weight: 1000 }, { key: 'c', weight: 1000 },
    ]);
    expect([...out.values()]).toEqual([33.33, 33.33, 33.34]);
    expect([...out.values()].reduce((s, v) => s + v, 0)).toBeCloseTo(100, 10);
  });

  it("ignoriert Empfaenger ohne Gewicht", () => {
    const out = distributeWithRemainder(100, [
      { key: 'a', weight: 1000 }, { key: 'b', weight: 0 },
    ]);
    expect(out.get('a')).toBe(100);
    expect(out.has('b')).toBe(false);
  });

  it("liefert nichts, wenn kein Empfaenger ein Gewicht hat", () => {
    expect(distributeWithRemainder(100, [{ key: 'a', weight: 0 }]).size).toBe(0);
  });
});

describe("computeSurchargeAllocations (B6)", () => {
  it("verteilt den Zuschlag ohne Rundungsverlust (Szenario aus dem Befund)", () => {
    // 3 LPH a 1.000,00 EUR, Zuschlag 100,00 EUR.
    const { lphAlloc } = computeSurchargeAllocations(phasen(3, 1000), [zuschlag()], []);
    expect(sum(lphAlloc)).toBe(100);
  });

  it("bleibt auch bei ungeraden Verhaeltnissen exakt", () => {
    const phases = [
      { ID: 1, PHASE_REVENUE: 1234.56 },
      { ID: 2, PHASE_REVENUE: 7891.01 },
      { ID: 3, PHASE_REVENUE: 333.33 },
      { ID: 4, PHASE_REVENUE: 12.12 },
    ];
    const { lphAlloc } = computeSurchargeAllocations(phases, [zuschlag({ AMOUNT: 987.65 })], []);
    expect(sum(lphAlloc)).toBe(987.65);
  });

  it("summiert mehrere Zuschlaege exakt auf", () => {
    const rows = [
      zuschlag({ ID: 1, AMOUNT: 100 }),
      zuschlag({ ID: 2, AMOUNT: 33.33 }),
      zuschlag({ ID: 3, AMOUNT: 0.01 }),
    ];
    const { lphAlloc } = computeSurchargeAllocations(phasen(3, 1000), rows, []);
    expect(sum(lphAlloc)).toBe(133.34);
  });

  it("teilt zwischen Leistungsphasen und Besonderen Leistungen ohne Verlust", () => {
    const bl = [{ ID: 91, AMOUNT: 500 }, { ID: 92, AMOUNT: 500 }];
    const row = zuschlag({ AMOUNT: 100, BL_FILTER: JSON.stringify([91, 92]) });
    const { lphAlloc, blAlloc } = computeSurchargeAllocations(phasen(3, 1000), [row], bl);
    expect(Math.round((sum(lphAlloc) + sum(blAlloc)) * 100) / 100).toBe(100);
  });

  it("beachtet den LPH-Filter", () => {
    const row = zuschlag({ AMOUNT: 100, LPH_FILTER: JSON.stringify([1, 2]) });
    const { lphAlloc } = computeSurchargeAllocations(phasen(3, 1000), [row], []);
    expect(lphAlloc[3]).toBeUndefined();
    expect(sum(lphAlloc)).toBe(100);
  });
});
