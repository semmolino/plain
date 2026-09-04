"use strict";

const {
  computeWipRow,
  aggregateWip,
  stockChange,
  wipTotalForMethod,
  FLAG_NO_PERFORMANCE,
  FLAG_PREPAYMENT,
  FLAG_LOSS_RISK,
} = require("../services/wipReport");

// Basisfall, von dem die meisten Tests abweichen: 100.000 Auftrag, 60 % geleistet,
// 40.000 abgerechnet, 30.000 Kosten gebucht.
const base = { orderValue: 100000, performance: 60000, billed: 40000, cost: 30000 };

describe("computeWipRow — Grundfall", () => {
  const r = computeWipRow(base);

  it("unfertiger Leistungsanteil ist Leistung minus abgerechnet", () => {
    expect(r.UNBILLED_NET).toBe(20000);
  });

  it("kein Anzahlungsueberhang, solange geleistet > abgerechnet", () => {
    expect(r.PREPAYMENT_NET).toBe(0);
    expect(r.flags).not.toContain(FLAG_PREPAYMENT);
  });

  it("Kosten werden im Verhaeltnis des unfertigen Anteils zugeordnet", () => {
    // q = 40000/60000 = 2/3 -> K_u = 30000 * 1/3 = 10000
    expect(r.COST_UNBILLED_NET).toBe(10000);
  });

  it("HGB-Wert sind die Kosten der unfertigen Leistung (unter dem Erloes)", () => {
    expect(r.WIP_HK_NET).toBe(10000);
  });

  it("Controlling-Wert ist der unfertige Leistungsanteil", () => {
    expect(r.WIP_REVENUE_NET).toBe(20000);
  });

  it("die Differenz ist der nicht realisierte Gewinn", () => {
    expect(r.UNREALIZED_GAIN_NET).toBe(10000);
  });

  it("kein Drohverlust", () => {
    expect(r.LOSS_RISK_NET).toBe(0);
  });
});

describe("computeWipRow — Bewertungsfaktor", () => {
  it("80 % senkt nur den Kostenansatz, nicht den Leistungswert", () => {
    const r = computeWipRow({ ...base, costFactorPercent: 80 });
    expect(r.COST_UNBILLED_NET).toBe(8000);
    expect(r.WIP_HK_NET).toBe(8000);
    expect(r.WIP_REVENUE_NET).toBe(20000);
  });

  it("0 % ergibt keinen Aktivposten nach HGB", () => {
    const r = computeWipRow({ ...base, costFactorPercent: 0 });
    expect(r.WIP_HK_NET).toBe(0);
    expect(r.LOSS_RISK_NET).toBe(0);
  });

  it("fehlender Faktor wird als 100 % gerechnet", () => {
    expect(computeWipRow(base).COST_UNBILLED_NET)
      .toBe(computeWipRow({ ...base, costFactorPercent: 100 }).COST_UNBILLED_NET);
  });
});

describe("computeWipRow — mehr abgerechnet als geleistet", () => {
  const r = computeWipRow({ orderValue: 100000, performance: 40000, billed: 55000, cost: 30000 });

  it("erzeugt eine erhaltene Anzahlung statt eines negativen Vorrats", () => {
    expect(r.PREPAYMENT_NET).toBe(15000);
    expect(r.WIP_HK_NET).toBe(0);
    expect(r.WIP_REVENUE_NET).toBe(0);
  });

  it("keine Kosten mehr im unfertigen Anteil", () => {
    expect(r.COST_UNBILLED_NET).toBe(0);
  });

  it("wird markiert", () => {
    expect(r.flags).toContain(FLAG_PREPAYMENT);
  });
});

describe("computeWipRow — verlustfreie Bewertung", () => {
  // Kosten der unfertigen Leistung (20.000) uebersteigen den erzielbaren
  // Erloes (10.000): der Vorratsposten wird gedeckelt, der Rest ist Drohverlust.
  const r = computeWipRow({ orderValue: 50000, performance: 30000, billed: 20000, cost: 60000 });

  it("deckelt den HGB-Wert auf den noch erzielbaren Erloes", () => {
    expect(r.UNBILLED_NET).toBe(10000);
    expect(r.COST_UNBILLED_NET).toBe(20000);
    expect(r.WIP_HK_NET).toBe(10000);
  });

  it("weist den Ueberhang als Drohverlust aus", () => {
    expect(r.LOSS_RISK_NET).toBe(10000);
    expect(r.flags).toContain(FLAG_LOSS_RISK);
  });

  it("meldet keinen nicht realisierten Gewinn", () => {
    expect(r.UNREALIZED_GAIN_NET).toBe(0);
  });
});

describe("computeWipRow — Leistungsstand nicht gepflegt", () => {
  const r = computeWipRow({ orderValue: 80000, performance: 0, billed: 0, cost: 12000 });

  it("markiert die Zeile, statt still 0 auszuweisen", () => {
    expect(r.flags).toContain(FLAG_NO_PERFORMANCE);
  });

  it("aktiviert nichts, weil kein Erloes belegt ist", () => {
    expect(r.WIP_HK_NET).toBe(0);
    expect(r.WIP_REVENUE_NET).toBe(0);
  });

  it("die Kosten stehen trotzdem als Kostenanteil da", () => {
    expect(r.COST_UNBILLED_NET).toBe(12000);
    expect(r.LOSS_RISK_NET).toBe(12000);
  });
});

describe("computeWipRow — Randfaelle", () => {
  it("alles null bleibt null, ohne Marker", () => {
    const r = computeWipRow({ orderValue: 0, performance: 0, billed: 0, cost: 0 });
    expect(r.WIP_HK_NET).toBe(0);
    expect(r.PREPAYMENT_NET).toBe(0);
    expect(r.flags).toEqual([]);
  });

  it("Storno unter den Abrechnungen (negatives R) erhoeht den unfertigen Anteil", () => {
    // Ein Storno macht die Abrechnungssumme kleiner; im Extremfall negativ.
    const r = computeWipRow({ orderValue: 100000, performance: 50000, billed: -5000, cost: 20000 });
    expect(r.UNBILLED_NET).toBe(55000);
    expect(r.COST_UNBILLED_NET).toBe(20000);   // q = 0, nichts wirksam abgerechnet
    expect(r.WIP_HK_NET).toBe(20000);
  });

  it("vollstaendig abgerechnet laesst nichts unfertig", () => {
    const r = computeWipRow({ orderValue: 100000, performance: 100000, billed: 100000, cost: 70000 });
    expect(r.UNBILLED_NET).toBe(0);
    expect(r.COST_UNBILLED_NET).toBe(0);
    expect(r.WIP_HK_NET).toBe(0);
    expect(r.PREPAYMENT_NET).toBe(0);
  });

  it("rundet auf zwei Stellen", () => {
    const r = computeWipRow({ orderValue: 1000, performance: 333.33, billed: 111.11, cost: 100 });
    expect(r.COST_UNBILLED_NET).toBe(Math.round(r.COST_UNBILLED_NET * 100) / 100);
    expect(String(r.WIP_HK_NET)).toMatch(/^-?\d+(\.\d{1,2})?$/);
  });

  it("Text-Eingaben aus der Datenbank werden als Zahl gelesen", () => {
    const r = computeWipRow({ orderValue: "100000", performance: "60000", billed: "40000", cost: "30000" });
    expect(r.WIP_HK_NET).toBe(10000);
  });
});

describe("aggregateWip — Saldierungsverbot", () => {
  const rows = [
    { ...computeWipRow(base), flags: computeWipRow(base).flags },
    computeWipRow({ orderValue: 100000, performance: 40000, billed: 55000, cost: 30000 }),
  ];
  const t = aggregateWip(rows);

  it("summiert Aktiv- und Passivseite getrennt", () => {
    expect(t.wipHk).toBe(10000);        // nur das erste Projekt
    expect(t.prepayments).toBe(15000);  // nur das zweite
  });

  it("verrechnet die Anzahlung nicht gegen den Vorratsposten", () => {
    expect(t.wipHk - t.prepayments).not.toBe(0);
    expect(t.wipHk).toBeGreaterThan(0);
    expect(t.prepayments).toBeGreaterThan(0);
  });

  it("zaehlt die Projekte und die Marker", () => {
    expect(t.projectCount).toBe(2);
    expect(t.prepaymentCount).toBe(1);
  });
});

describe("wipTotalForMethod / stockChange", () => {
  const now    = aggregateWip([computeWipRow(base)]);
  const before = aggregateWip([computeWipRow({ ...base, performance: 50000, billed: 40000, cost: 24000 })]);

  it("liefert je Methode den passenden Bilanzansatz", () => {
    expect(wipTotalForMethod(now, "hk")).toBe(10000);
    expect(wipTotalForMethod(now, "erloes")).toBe(20000);
  });

  it("Bestandsveraenderung ist die Differenz zweier Stichtage", () => {
    // vorher: q = 40/50 = 0.8 -> K_u = 24000 * 0.2 = 4800
    expect(wipTotalForMethod(before, "hk")).toBe(4800);
    expect(stockChange(now, before, "hk").wip).toBe(5200);
  });

  it("ohne Vergleichsstichtag gibt es keine Bestandsveraenderung", () => {
    expect(stockChange(now, null, "hk")).toBeNull();
  });
});
