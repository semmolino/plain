"use strict";

const { computeMischhonorar } = require("../services/mischhonorar");

// Fake-Tafel: Grundhonorar bei GESAMT-AK je Zone (fix, unabhängig vom cost —
// für die Gewichtungslogik ausreichend). Zone 2 → 60.000, Zone 3 → 80.000.
const FAKE_TAFEL = { 2: 60000, 3: 80000 };
const tafelFn = (_cost, zoneId) => FAKE_TAFEL[zoneId] ?? 0;

describe("computeMischhonorar (§ 54 Abs. 3)", () => {
  it("Referenzbeispiel: zwei Zonen, gewichtet nach Kostenanteil", () => {
    const r = computeMischhonorar(
      [
        { zoneId: 2, amount: 300000 },
        { zoneId: 3, amount: 200000 },
      ],
      tafelFn,
    );
    expect(r.akGesamt).toBe(500000);
    // 60.000×0,6 + 80.000×0,4 = 36.000 + 32.000
    expect(r.honorar).toBe(68000);
    expect(r.herleitung).toHaveLength(2);
    expect(r.herleitung[0].einzelhonorar).toBe(36000);
    expect(r.herleitung[1].einzelhonorar).toBe(32000);
  });

  it("eine Zone → volles Tafelhonorar dieser Zone (Anteil 100 %)", () => {
    const r = computeMischhonorar([{ zoneId: 2, amount: 400000 }], tafelFn);
    expect(r.akGesamt).toBe(400000);
    expect(r.honorar).toBe(60000);
    expect(r.herleitung[0].anteilPct).toBe(100);
  });

  it("die Degression wirkt auf die Gesamtsumme (H_voll bei AK_gesamt, nicht je Teil)", () => {
    // Tafel steigt unterproportional: bei kleiner Basis relativ höherer Satz.
    const degressiv = (cost, zoneId) => (zoneId === 2 ? cost * (cost >= 500000 ? 0.12 : 0.15) : 0);
    // Beide Anteile in Zone 2, AK_gesamt = 500.000 → H_voll = 60.000 (0,12).
    // Gewichtete Summe = 60.000 (weil eine Zone) — nicht 2×(250k×0,15)=75.000.
    const r = computeMischhonorar(
      [{ zoneId: 2, amount: 250000 }, { zoneId: 2, amount: 250000 }],
      degressiv,
    );
    expect(r.akGesamt).toBe(500000);
    expect(r.honorar).toBe(60000);
  });

  it("leere/0-Anteile → 0", () => {
    expect(computeMischhonorar([], tafelFn).honorar).toBe(0);
    expect(computeMischhonorar([{ zoneId: 2, amount: 0 }], tafelFn).honorar).toBe(0);
  });
});
