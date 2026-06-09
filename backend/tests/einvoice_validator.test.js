"use strict";

const { validateEInvoiceData } = require("../services_einvoice_validator");

function baseData(overrides = {}) {
  return Object.assign({
    number: "RG-2026-0001",
    date: "2026-06-09",
    typeCodeCii: "380",
    typeCodeUbl: "380",
    currency: "EUR",
    buyerReference: "TEST-REF",
    seller: { name: "Architektur GmbH", street: "Hauptstr. 1", city: "Munchen", postCode: "80331", countryId: "DE" },
    buyer:  { name: "Bauherr AG",       street: "Bauplatz 9",   city: "Berlin",  postCode: "10115", countryId: "DE" },
    lines:  [{ name: "Honorar HOAI Lph 1", quantity: 1, unitCode: "C62", lineTotal: 1000, vatCategory: "S" }],
    vatBreakdown: [{ category: "S", percent: 19, basis: 1000, amount: 190 }],
    allowances: [],
    totals: {
      lineNetTotal: 1000,
      netTotal: 1000,
      taxBasis: 1000,
      taxAmount: 190,
      grandTotal: 1190,
      duePayable: 1190,
      prepaidGross: 0,
    },
  }, overrides);
}

describe("validateEInvoiceData", () => {
  it("passes a valid base invoice", () => {
    const r = validateEInvoiceData(baseData());
    expect(r.ok).toBe(true);
    expect(r.errors).toHaveLength(0);
  });

  it("flags missing invoice number (BR-02)", () => {
    const r = validateEInvoiceData(baseData({ number: "" }));
    expect(r.ok).toBe(false);
    expect(r.errors.some(e => e.code === "BR-02")).toBe(true);
  });

  it("flags missing seller name (BR-06)", () => {
    const r = validateEInvoiceData(baseData({ seller: { ...baseData().seller, name: "" } }));
    expect(r.ok).toBe(false);
    expect(r.errors.some(e => e.code === "BR-06")).toBe(true);
  });

  it("flags missing line (BR-16)", () => {
    const r = validateEInvoiceData(baseData({ lines: [] }));
    expect(r.ok).toBe(false);
    expect(r.errors.some(e => e.code === "BR-16")).toBe(true);
  });

  it("flags Standardsatz mit Steuersatz 0 (BR-S-02)", () => {
    const data = baseData({ vatBreakdown: [{ category: "S", percent: 0, basis: 1000, amount: 0 }] });
    const r = validateEInvoiceData(data);
    expect(r.errors.some(e => e.code === "BR-S-02")).toBe(true);
  });

  it("flags Reverse-Charge ohne Begruendung (BR-AE-10)", () => {
    const data = baseData({
      vatBreakdown: [{ category: "AE", percent: 0, basis: 1000, amount: 0 }],
      totals: { ...baseData().totals, taxAmount: 0, grandTotal: 1000, duePayable: 1000 },
    });
    const r = validateEInvoiceData(data);
    expect(r.errors.some(e => e.code === "BR-AE-10")).toBe(true);
  });

  it("passes Reverse-Charge mit Begruendung", () => {
    const data = baseData({
      vatBreakdown: [{ category: "AE", percent: 0, basis: 1000, amount: 0, exemptionReasonText: "Reverse Charge gem. §13b UStG" }],
      totals: { ...baseData().totals, taxAmount: 0, grandTotal: 1000, duePayable: 1000 },
    });
    const r = validateEInvoiceData(data);
    expect(r.errors.filter(e => e.code.startsWith("BR-AE"))).toHaveLength(0);
  });

  it("flags Tax-Berechnungsfehler (BR-CO-17)", () => {
    const data = baseData({
      vatBreakdown: [{ category: "S", percent: 19, basis: 1000, amount: 200 }],   // sollte 190 sein
    });
    const r = validateEInvoiceData(data);
    expect(r.errors.some(e => e.code === "BR-CO-17")).toBe(true);
  });

  it("flags Brutto-Berechnungsfehler (BR-CO-15)", () => {
    const data = baseData({
      totals: { ...baseData().totals, grandTotal: 1200 },   // 1000+190 = 1190
    });
    const r = validateEInvoiceData(data);
    expect(r.errors.some(e => e.code === "BR-CO-15")).toBe(true);
  });

  it("flags Zahlbar-Berechnungsfehler (BR-CO-16)", () => {
    const data = baseData({
      totals: { ...baseData().totals, prepaidGross: 200, duePayable: 1190 },   // sollte 990 sein
    });
    const r = validateEInvoiceData(data);
    expect(r.errors.some(e => e.code === "BR-CO-16")).toBe(true);
  });

  it("emits warning when Leitweg-ID fehlt (BR-DE-1) — kein Error", () => {
    const r = validateEInvoiceData(baseData({ buyerReference: "" }));
    expect(r.ok).toBe(true);
    expect(r.warnings.some(w => w.code === "BR-DE-1")).toBe(true);
  });

  it("tolerates 0.01 Rundungsdifferenzen", () => {
    const data = baseData({
      vatBreakdown: [{ category: "S", percent: 19, basis: 1000, amount: 190.01 }],
    });
    const r = validateEInvoiceData(data);
    expect(r.errors.some(e => e.code === "BR-CO-17")).toBe(false);
  });
});
