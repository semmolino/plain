"use strict";

// ─────────────────────────────────────────────────────────────────────────────
// Die Summenformel eines Belegs.
//
// Sie stand zweimal da (recomputeInvoiceTotals, recomputePartialPaymentTotals)
// und wird fuer den gebuendelten Belegimport ein drittes Mal gebraucht. Zwei
// Wege zu derselben Zahl weichen irgendwann voneinander ab — lautlos, weil
// keiner der beiden den anderen kennt. Diese Tests halten die eine Fassung
// fest, besonders die Rundungsreihenfolge.
// ─────────────────────────────────────────────────────────────────────────────

const { belegSummen } = require("../services/belegRechnung");

const pos = (netto, extras = 0) => ({ AMOUNT_NET: netto, AMOUNT_EXTRAS_NET: extras });

describe("belegSummen", () => {
  it("rechnet Netto, Steuer und Brutto", () => {
    expect(belegSummen({ positionen: [pos(1000)], vatPercent: 19 })).toEqual({
      AMOUNT_NET: 1000, AMOUNT_EXTRAS_NET: 0,
      TOTAL_AMOUNT_NET: 1000, TAX_AMOUNT_NET: 190, TOTAL_AMOUNT_GROSS: 1190,
    });
  });

  it("zaehlt Nebenkosten getrennt und in die Gesamtsumme", () => {
    const b = belegSummen({ positionen: [pos(1000, 50), pos(500, 25)], vatPercent: 19 });
    expect(b.AMOUNT_NET).toBe(1500);
    expect(b.AMOUNT_EXTRAS_NET).toBe(75);
    expect(b.TOTAL_AMOUNT_NET).toBe(1575);
  });

  // Die Reihenfolge ist bindend: erst beide Teilsummen einzeln runden, dann
  // addieren. Rundet man erst am Ende, kommt hier 100,01 statt 100,02 heraus —
  // und dann streiten zwei Zahlen darueber, welche die richtige ist.
  it("rundet die Teilsummen einzeln, nicht erst am Ende", () => {
    const b = belegSummen({
      positionen: [pos(33.333, 0), pos(33.333, 0), pos(33.333, 0)],
      vatPercent: 0,
    });
    expect(b.AMOUNT_NET).toBe(100);
    expect(b.TOTAL_AMOUNT_NET).toBe(100);
  });

  it("kommt ohne Steuersatz aus", () => {
    const b = belegSummen({ positionen: [pos(1000)], vatPercent: 0 });
    expect(b.TAX_AMOUNT_NET).toBe(0);
    expect(b.TOTAL_AMOUNT_GROSS).toBe(1000);
  });

  // Schlussrechnung: die Steuer faellt auf den Betrag NACH Abzug der
  // Abschlaege an — sonst zahlt der Kunde die Steuer zweimal.
  it("zieht Abschlaege vor der Steuer ab", () => {
    const b = belegSummen({ positionen: [pos(10000)], vatPercent: 19, abzuege: 4000 });
    expect(b.AMOUNT_NET).toBe(10000);          // die Leistung bleibt, was sie war
    expect(b.TOTAL_AMOUNT_NET).toBe(6000);     // zu zahlen bleiben 6.000
    expect(b.TAX_AMOUNT_NET).toBe(1140);       // 19 % auf 6.000, nicht auf 10.000
    expect(b.TOTAL_AMOUNT_GROSS).toBe(7140);
  });

  // Eine Gutschrift oder ein Storno traegt negative Betraege — die Formel darf
  // daran nichts glaetten.
  it("laesst negative Betraege negativ", () => {
    const b = belegSummen({ positionen: [pos(-2126.25, -212.63)], vatPercent: 19 });
    expect(b.TOTAL_AMOUNT_NET).toBe(-2338.88);
    expect(b.TOTAL_AMOUNT_GROSS).toBe(-2783.27);
  });

  it("vertraegt eine leere Positionsliste", () => {
    const b = belegSummen({ positionen: [], vatPercent: 19 });
    expect(b.TOTAL_AMOUNT_NET).toBe(0);
    expect(b.TOTAL_AMOUNT_GROSS).toBe(0);
  });
});
