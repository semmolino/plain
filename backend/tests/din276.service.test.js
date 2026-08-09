"use strict";

const {
  anrechenbareKostenGebaeude,
  anrechenbareKostenTragwerk,
  anrechenbareKostenFreianlagen,
  anrechenbareKosten,
  kgHundred,
} = require("../services/din276");

const g = (kg, amount, isPlannedSelf = false) => ({ kg, amount, isPlannedSelf });

// ── kgHundred ─────────────────────────────────────────────────────────────────

describe("kgHundred", () => {
  it("maps 1st-level codes to themselves", () => {
    expect(kgHundred("300")).toBe(300);
    expect(kgHundred("400")).toBe(400);
  });
  it("maps 2nd-level codes to their hundred", () => {
    expect(kgHundred("410")).toBe(400);
    expect(kgHundred("380")).toBe(300);
  });
  it("tolerates numbers and junk", () => {
    expect(kgHundred(300)).toBe(300);
    expect(kgHundred("KG 420")).toBe(400);
    expect(kgHundred("")).toBeNull();
  });
});

// ── § 33 Gebaeude ─────────────────────────────────────────────────────────────

describe("anrechenbareKostenGebaeude (§ 33)", () => {
  it("KG 300 allein ist vollstaendig anrechenbar", () => {
    const r = anrechenbareKostenGebaeude({ groups: [g("300", 500000)] });
    expect(r.anrechenbareKosten).toBe(500000);
    expect(r.sonstigeAnrechenbareKosten).toBe(500000);
    expect(r.herleitung).toHaveLength(1);
  });

  it("Referenzbeispiel aus dem Konzept (KG400 25%/50% + Bausubstanz)", () => {
    // KG300 1.000.000 + Bausubstanz 100.000 = sonstige 1.100.000
    // KG400 selbst 120.000 (voll)
    // KG400 fremd 400.000: bis 25% v. 1.100.000 = 275.000 voll, Rest 125.000 → 62.500
    // Summe = 1.000.000 + 100.000 + 120.000 + 275.000 + 62.500 = 1.557.500
    const r = anrechenbareKostenGebaeude({
      mitverarbeiteteBausubstanz: 100000,
      groups: [
        g("300", 1000000),
        g("400", 120000, true),
        g("400", 400000, false),
      ],
    });
    expect(r.sonstigeAnrechenbareKosten).toBe(1100000);
    expect(r.anrechenbareKosten).toBe(1557500);
  });

  it("KG 400 vollstaendig selbst geplant → voll anrechenbar (keine Kappung)", () => {
    const r = anrechenbareKostenGebaeude({
      groups: [g("300", 1000000), g("400", 200000, true)],
    });
    expect(r.anrechenbareKosten).toBe(1200000);
  });

  it("KG 400 fremd unter der 25%-Schwelle → voll, kein übersteigender Betrag", () => {
    const r = anrechenbareKostenGebaeude({
      groups: [g("300", 1000000), g("400", 200000, false)], // Schwelle 250.000
    });
    expect(r.anrechenbareKosten).toBe(1200000);
    expect(r.herleitung.some((h) => /übersteigender/.test(h.label))).toBe(false);
  });

  it("KG 200/600 selbst geplant zaehlen (auch in die sonstigen Kosten)", () => {
    // sonstige = 800k + 100k + 100k = 1.000.000; Schwelle 250.000
    // KG400 fremd 400.000 → 250.000 voll + 150.000*0.5 = 75.000
    // Summe = 800k + 100k + 100k + 250k + 75k = 1.325.000
    const r = anrechenbareKostenGebaeude({
      groups: [
        g("300", 800000),
        g("200", 100000, true),
        g("600", 100000, true),
        g("400", 400000, false),
      ],
    });
    expect(r.sonstigeAnrechenbareKosten).toBe(1000000);
    expect(r.anrechenbareKosten).toBe(1325000);
  });

  it("KG 100/500/700 und fremd geplante KG 200/600 sind nicht anrechenbar", () => {
    const r = anrechenbareKostenGebaeude({
      groups: [
        g("300", 1000000),
        g("100", 500000),
        g("500", 300000),
        g("700", 200000),
        g("200", 50000, false),
        g("600", 50000, false),
      ],
    });
    expect(r.anrechenbareKosten).toBe(1000000);
    expect(r.sonstigeAnrechenbareKosten).toBe(1000000);
  });

  it("aggregiert 2. Ebene (410/420) auf KG 400", () => {
    const r = anrechenbareKostenGebaeude({
      groups: [g("300", 1000000), g("410", 100000, false), g("420", 100000, false)],
    });
    // KG400 fremd = 200.000 < Schwelle 250.000 → voll
    expect(r.anrechenbareKosten).toBe(1200000);
  });
});

// ── § 50 Tragwerksplanung ─────────────────────────────────────────────────────

describe("anrechenbareKostenTragwerk (§ 50)", () => {
  it("55 % KG 300 + 10 % KG 400", () => {
    const r = anrechenbareKostenTragwerk({ groups: [g("300", 1000000), g("400", 200000)] });
    expect(r.anrechenbareKosten).toBe(570000); // 550.000 + 20.000
  });
  it("nur KG 300", () => {
    const r = anrechenbareKostenTragwerk({ groups: [g("300", 1000000)] });
    expect(r.anrechenbareKosten).toBe(550000);
  });
  it("2. Ebene wird aggregiert", () => {
    const r = anrechenbareKostenTragwerk({ groups: [g("310", 400000), g("330", 600000), g("420", 200000)] });
    expect(r.anrechenbareKosten).toBe(570000);
  });
});

// ── § 38/40 Freianlagen ───────────────────────────────────────────────────────

describe("anrechenbareKostenFreianlagen (§ 38/40)", () => {
  it("KG 500 voll, andere ignoriert", () => {
    const r = anrechenbareKostenFreianlagen({ groups: [g("500", 300000), g("300", 1000000)] });
    expect(r.anrechenbareKosten).toBe(300000);
  });
});

// ── Dispatcher ────────────────────────────────────────────────────────────────

describe("anrechenbareKosten (Dispatcher)", () => {
  it("ruft die Gebaeude-Regel", () => {
    const r = anrechenbareKosten("gebaeude", { groups: [g("300", 100000)] });
    expect(r.anrechenbareKosten).toBe(100000);
  });
  it("ruft die Tragwerk-Regel", () => {
    const r = anrechenbareKosten("tragwerk", { groups: [g("300", 100000)] });
    expect(r.anrechenbareKosten).toBe(55000);
  });
  it("ruft die Freianlagen-Regel", () => {
    const r = anrechenbareKosten("freianlagen", { groups: [g("500", 100000)] });
    expect(r.anrechenbareKosten).toBe(100000);
  });
  it("wirft bei unbekanntem Leistungsbild", () => {
    expect(() => anrechenbareKosten("unbekannt", { groups: [] })).toThrow();
  });
});
