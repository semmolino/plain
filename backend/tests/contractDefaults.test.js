"use strict";

// Vorbelegungen fuer neue Vertraege. Der Ausloeser dieses Tests: Skonto liess
// sich in den Einstellungen pflegen, wurde bei der Vertragsanlage aber nie
// angewendet — die Einstellung war wirkungslos, ohne dass es auffiel.

const { contractDefaults } = require("../services/contractDefaults");

describe("contractDefaults", () => {
  test("ohne Vorbelegungen bleibt die Zeile leer", () => {
    expect(contractDefaults({})).toEqual({});
    expect(contractDefaults(null)).toEqual({});
  });

  test("Waehrung und MwSt werden als Zahl uebernommen", () => {
    expect(contractDefaults({ default_currency_id: "1", default_vat_id: "2" }))
      .toEqual({ CURRENCY_ID: 1, VAT_ID: 2 });
  });

  test("Skonto wird uebernommen (war der Fehler)", () => {
    expect(contractDefaults({ default_cash_discount_percent: "2", default_cash_discount_days: "14" }))
      .toEqual({ CASH_DISCOUNT_PERCENT: 2, CASH_DISCOUNT_DAYS: 14 });
  });

  test("Skonto 0 % ist ein gueltiger Wert, kein 'nicht gesetzt'", () => {
    expect(contractDefaults({ default_cash_discount_percent: "0" }))
      .toEqual({ CASH_DISCOUNT_PERCENT: 0 });
  });

  test("leere Werte erzeugen keine Spalten", () => {
    expect(contractDefaults({ default_vat_id: "", default_cash_discount_days: null }))
      .toEqual({});
  });

  test("Sicherheitseinbehalt nur, wenn eingeschaltet", () => {
    expect(contractDefaults({ default_se_percent: "5", default_se_basis: "NETTO" })).toEqual({});
    expect(contractDefaults({
      default_se_enabled: "true",
      default_se_percent: "5",
      default_se_basis: "NETTO",
      default_se_legal_reference: " § 17 VOB/B ",
    })).toEqual({
      SE_ENABLED: true,
      SE_PERCENT: 5,
      SE_BASIS: "NETTO",
      SE_LEGAL_REFERENCE: "§ 17 VOB/B",
    });
  });

  test("Sicherheitseinbehalt faellt auf BRUTTO zurueck", () => {
    expect(contractDefaults({ default_se_enabled: "true" }))
      .toEqual({ SE_ENABLED: true, SE_BASIS: "BRUTTO" });
  });
});
