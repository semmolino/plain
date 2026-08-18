"use strict";

const {
  anrechenbareKostenGebaeude,
  anrechenbareKostenTragwerk,
  anrechenbareKostenFreianlagen,
  anrechenbareKostenIngenieurbauwerke,
  anrechenbareKostenVerkehrsanlagen,
  anrechenbareKostenTGA,
  anrechenbareKostenGeotechnik,
  anrechenbareKosten,
  parseLeistungsbild,
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

// ── § 42 Ingenieurbauwerke ─────────────────────────────────────────────────────

describe("anrechenbareKostenIngenieurbauwerke (§ 42)", () => {
  it("KG 300 voll, ohne weitere Kostengruppen", () => {
    const r = anrechenbareKostenIngenieurbauwerke({ groups: [g("300", 1000000)] });
    expect(r.anrechenbareKosten).toBe(1000000);
  });
  it("KG 400 selbst geplant: voll", () => {
    const r = anrechenbareKostenIngenieurbauwerke({ groups: [g("300", 1000000), g("400", 200000, true)] });
    expect(r.anrechenbareKosten).toBe(1200000);
  });
  it("KG 400 fremd geplant: 25-/50-%-Schwelle wie bei Gebäude", () => {
    const r = anrechenbareKostenIngenieurbauwerke({ groups: [g("300", 1000000), g("400", 300000, false)] });
    // sonstige = 1.000.000; Schwelle 25 % = 250.000 voll + 50.000 zur Hälfte (25.000)
    expect(r.anrechenbareKosten).toBe(1275000);
  });
  it("KG 500 selbst geplant ist anrechenbar (anders als bei Gebäude)", () => {
    const r = anrechenbareKostenIngenieurbauwerke({ groups: [g("300", 1000000), g("500", 100000, true)] });
    expect(r.anrechenbareKosten).toBe(1100000);
  });
  it("KG 500 fremd geplant ist NICHT anrechenbar", () => {
    const r = anrechenbareKostenIngenieurbauwerke({ groups: [g("300", 1000000), g("500", 100000, false)] });
    expect(r.anrechenbareKosten).toBe(1000000);
  });
});

// ── § 46 Verkehrsanlagen ───────────────────────────────────────────────────────

describe("anrechenbareKostenVerkehrsanlagen (§ 46)", () => {
  it("Abs. 1–3 rechnen identisch zu § 42 (unabhängige, aber gleich aufgebaute Vorschrift)", () => {
    const groups = [g("300", 1000000), g("400", 300000, false), g("500", 100000, true)];
    const verkehr = anrechenbareKostenVerkehrsanlagen({ groups });
    const ingbau  = anrechenbareKostenIngenieurbauwerke({ groups });
    expect(verkehr.anrechenbareKosten).toBe(ingbau.anrechenbareKosten);
  });
  it("KG 300 voll", () => {
    const r = anrechenbareKostenVerkehrsanlagen({ groups: [g("300", 500000)] });
    expect(r.anrechenbareKosten).toBe(500000);
  });
});

// ── § 53/54 Technische Ausrüstung ─────────────────────────────────────────────

describe("anrechenbareKostenTGA (§ 53/54)", () => {
  it("summiert nur die gewählte Anlagengruppe (KG 420er), voll", () => {
    const r = anrechenbareKostenTGA(
      { groups: [g("420", 150000), g("421", 30000), g("410", 99000), g("300", 1000000)] },
      { anlagengruppe: "420" },
    );
    expect(r.anrechenbareKosten).toBe(180000);
  });
  it("wirft ohne Anlagengruppe", () => {
    expect(() => anrechenbareKostenTGA({ groups: [g("420", 1)] }, {})).toThrow();
  });
  it("liefert 0, wenn die Anlagengruppe nicht erfasst ist", () => {
    const r = anrechenbareKostenTGA({ groups: [g("410", 50000)] }, { anlagengruppe: "480" });
    expect(r.anrechenbareKosten).toBe(0);
  });
});

// ── Anlage 1.3 Geotechnik ──────────────────────────────────────────────────────

describe("anrechenbareKostenGeotechnik (Anlage 1.3.2)", () => {
  it("rechnet identisch zur Tragwerk-Regel (55 % KG 300 + 10 % KG 400)", () => {
    const groups = [g("300", 1000000), g("400", 200000)];
    const geotechnik = anrechenbareKostenGeotechnik({ groups });
    const tragwerk = anrechenbareKostenTragwerk({ groups });
    expect(geotechnik.anrechenbareKosten).toBe(tragwerk.anrechenbareKosten);
    expect(geotechnik.anrechenbareKosten).toBe(570000);
  });
  it("Baugrube (KG 310) ist Teil von KG 300, also mit 55 % erfasst", () => {
    const r = anrechenbareKostenGeotechnik({ groups: [g("310", 400000), g("330", 600000)] });
    expect(r.anrechenbareKosten).toBe(550000);
  });
});

// ── parseLeistungsbild ────────────────────────────────────────────────────────

describe("parseLeistungsbild", () => {
  it("einfacher Schlüssel", () => {
    expect(parseLeistungsbild("gebaeude")).toEqual({ key: "gebaeude", opts: {} });
  });
  it("TGA mit Anlagengruppe", () => {
    expect(parseLeistungsbild("tga:420")).toEqual({ key: "tga", opts: { anlagengruppe: "420" } });
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
  it("ruft die TGA-Regel mit Anlagengruppe", () => {
    const r = anrechenbareKosten("tga", { groups: [g("430", 80000)] }, { anlagengruppe: "430" });
    expect(r.anrechenbareKosten).toBe(80000);
  });
  it("ruft die Geotechnik-Regel", () => {
    const r = anrechenbareKosten("geotechnik", { groups: [g("300", 100000)] });
    expect(r.anrechenbareKosten).toBe(55000);
  });
  it("ruft die Ingenieurbauwerke-Regel", () => {
    const r = anrechenbareKosten("ingenieurbauwerke", { groups: [g("300", 100000)] });
    expect(r.anrechenbareKosten).toBe(100000);
  });
  it("ruft die Verkehrsanlagen-Regel", () => {
    const r = anrechenbareKosten("verkehrsanlagen", { groups: [g("300", 100000)] });
    expect(r.anrechenbareKosten).toBe(100000);
  });
  it("wirft bei unbekanntem Leistungsbild", () => {
    expect(() => anrechenbareKosten("unbekannt", { groups: [] })).toThrow();
  });
});

// ── Anlage 1.2 Bauphysik ──────────────────────────────────────────────────────

const {
  anrechenbareKostenBauphysikWaerme,
  anrechenbareKostenBauphysikBauakustik,
  anrechenbareKostenBauphysikRaumakustik,
} = require("../services/din276");

describe("anrechenbareKostenBauphysikWaerme (Anlage 1.2.3)", () => {
  it("erbt die Gebaeuderegel nach § 33 unveraendert", () => {
    const estimate = {
      mitverarbeiteteBausubstanz: 100000,
      groups: [g("300", 1000000), g("400", 120000, true), g("400", 400000, false)],
    };
    expect(anrechenbareKostenBauphysikWaerme(estimate).anrechenbareKosten)
      .toBe(anrechenbareKostenGebaeude(estimate).anrechenbareKosten);
  });

  it("kappt fremdgeplante KG 400 wie § 33 (25 % voll, Rest zur Haelfte)", () => {
    // sonstige = KG300 1.000.000; KG400 fremd 400.000
    // → 250.000 voll + 150.000/2 = 75.000  ⇒ 1.325.000
    const r = anrechenbareKostenBauphysikWaerme({ groups: [g("300", 1000000), g("400", 400000)] });
    expect(r.anrechenbareKosten).toBe(1325000);
  });
});

describe("anrechenbareKostenBauphysikBauakustik (Anlage 1.2.4)", () => {
  it("rechnet KG 300 + KG 400 voll an — ohne die 25/50-Kappung des § 33", () => {
    const r = anrechenbareKostenBauphysikBauakustik({ groups: [g("300", 1000000), g("400", 400000)] });
    expect(r.anrechenbareKosten).toBe(1400000);
  });

  it("ignoriert selbst/fremd geplant — die Kappung gilt nur dem Gebaeudeplaner", () => {
    const selbst = anrechenbareKostenBauphysikBauakustik({ groups: [g("400", 400000, true)] });
    const fremd  = anrechenbareKostenBauphysikBauakustik({ groups: [g("400", 400000, false)] });
    expect(selbst.anrechenbareKosten).toBe(fremd.anrechenbareKosten);
  });

  it("laesst KG 100/500/600/700 aussen vor", () => {
    const r = anrechenbareKostenBauphysikBauakustik({
      groups: [g("300", 100000), g("100", 50000), g("500", 50000), g("610", 50000), g("700", 50000)],
    });
    expect(r.anrechenbareKosten).toBe(100000);
  });

  it("beruecksichtigt mitverarbeitete Bausubstanz", () => {
    const r = anrechenbareKostenBauphysikBauakustik({
      mitverarbeiteteBausubstanz: 80000,
      groups: [g("300", 100000)],
    });
    expect(r.anrechenbareKosten).toBe(180000);
  });
});

describe("anrechenbareKostenBauphysikRaumakustik (Anlage 1.2.5)", () => {
  it("teilt KG 300 + KG 400 ueber den Bruttorauminhalt auf den Innenraum", () => {
    // (1.000.000 + 200.000) x 600/6000 = 120.000, zzgl. KG 610 des Innenraums
    const r = anrechenbareKostenBauphysikRaumakustik(
      { groups: [g("300", 1000000), g("400", 200000), g("610", 30000)] },
      { rauminhalt: 600, bri: 6000 },
    );
    expect(r.anrechenbareKosten).toBe(150000);
  });

  it("rechnet KG 610 voll an, nicht anteilig", () => {
    const r = anrechenbareKostenBauphysikRaumakustik(
      { groups: [g("610", 30000)] },
      { rauminhalt: 600, bri: 6000 },
    );
    expect(r.anrechenbareKosten).toBe(30000);
  });

  it("verlangt Rauminhalt und Bruttorauminhalt", () => {
    const est = { groups: [g("300", 100000)] };
    expect(() => anrechenbareKostenBauphysikRaumakustik(est, {})).toThrow(/Rauminhalt/);
    expect(() => anrechenbareKostenBauphysikRaumakustik(est, { rauminhalt: 600 })).toThrow(/Rauminhalt/);
    expect(() => anrechenbareKostenBauphysikRaumakustik(est, { bri: 6000 })).toThrow(/Rauminhalt/);
  });

  it("weist einen Innenraum groesser als das Gebaeude zurueck", () => {
    expect(() => anrechenbareKostenBauphysikRaumakustik(
      { groups: [g("300", 100000)] }, { rauminhalt: 7000, bri: 6000 },
    )).toThrow(/groesser/);
  });

  it("ist ueber die Registry erreichbar", () => {
    const r = anrechenbareKosten("bauphysik_raumakustik",
      { groups: [g("300", 1200000)] }, { rauminhalt: 500, bri: 5000 });
    expect(r.anrechenbareKosten).toBe(120000);
  });
});
