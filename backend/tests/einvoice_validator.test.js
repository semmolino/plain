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
    seller: {
      name: "Architektur GmbH", street: "Hauptstr. 1", city: "Munchen", postCode: "80331", countryId: "DE",
      vatId: "DE123456789", taxId: "143/815/09321",
      contactName: "S. Messina", contactPhone: "+49 89 1234567", contactEmail: "info@example.de",
      iban: "DE02120300000000202051", bic: "BYLADEM1001",
    },
    buyer:  {
      name: "Bauherr AG", street: "Bauplatz 9", city: "Berlin", postCode: "10115", countryId: "DE",
      vatId: "DE987654321",
    },
    lines:  [{ description: "Honorar HOAI Lph 1", quantity: 1, unitCode: "C62", lineTotal: 1000, vatCategory: "S" }],
    vatBreakdown: [{ category: "S", percent: 19, basis: 1000, amount: 190 }],
    allowances: [],
    totals: {
      lineTotal: 1000,
      allowanceTotal: 0,
      chargeTotal: 0,
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

  it("emits warning when Leitweg-ID fehlt (BR-DE-15) — kein Error", () => {
    const r = validateEInvoiceData(baseData({ buyerReference: "" }));
    expect(r.ok).toBe(true);
    expect(r.warnings.some(w => w.code === "BR-DE-15")).toBe(true);
    // BR-DE-1 gehoert zu den Zahlungsinformationen und darf hier nicht auftauchen.
    expect(r.warnings.some(w => w.code === "BR-DE-1")).toBe(false);
  });

  it("tolerates 0.01 Rundungsdifferenzen", () => {
    const data = baseData({
      vatBreakdown: [{ category: "S", percent: 19, basis: 1000, amount: 190.01 }],
    });
    const r = validateEInvoiceData(data);
    expect(r.errors.some(e => e.code === "BR-CO-17")).toBe(false);
  });

  // ── Regression N1: der Validator muss die Feldnamen lesen, die
  //    loadInvoiceData tatsaechlich liefert (description / totals.lineTotal).
  //    Vorher pruefte er l.name und t.netTotal — Felder, die es nie gab.

  it("liest die Positions-Bezeichnung aus description (BR-22)", () => {
    const data = baseData({
      lines: [{ description: "", quantity: 1, unitCode: "C62", lineTotal: 1000, vatCategory: "S" }],
    });
    const r = validateEInvoiceData(data);
    expect(r.errors.some(e => e.code === "BR-22")).toBe(true);
  });

  it("liest die Positionssumme aus totals.lineTotal (BR-12)", () => {
    const { lineTotal, ...totalsOhneSumme } = baseData().totals;
    const r = validateEInvoiceData(baseData({ totals: totalsOhneSumme }));
    expect(r.errors.some(e => e.code === "BR-12")).toBe(true);
  });

  // ── N2: BT-109 muss zur Positionssumme passen

  it("flags Abweichung zwischen Positionssumme und Gesamt-Netto (BR-CO-13)", () => {
    const data = baseData({
      totals: { ...baseData().totals, taxBasis: 1100 },   // Positionssumme ist 1000
    });
    const r = validateEInvoiceData(data);
    expect(r.errors.some(e => e.code === "BR-CO-13")).toBe(true);
  });

  it("rechnet Nachlaesse und Zuschlaege in BR-CO-13 ein", () => {
    const data = baseData({
      // 1000 - 100 + 50 = 950
      totals: { ...baseData().totals, allowanceTotal: 100, chargeTotal: 50, taxBasis: 950 },
    });
    const r = validateEInvoiceData(data);
    expect(r.errors.some(e => e.code === "BR-CO-13")).toBe(false);
  });

  // ── N7: Verkaeufer-Kontakt BG-6 muss vollstaendig sein

  it("flags fehlenden Ansprechpartner (BG-6)", () => {
    const r = validateEInvoiceData(baseData({
      seller: { ...baseData().seller, contactName: "" },
    }));
    expect(r.errors.some(e => e.btField === "BT-41")).toBe(true);
  });

  it("flags Ansprechpartner ohne Telefonnummer", () => {
    const r = validateEInvoiceData(baseData({
      seller: { ...baseData().seller, contactPhone: "" },
    }));
    expect(r.errors.some(e => e.btField === "BT-42")).toBe(true);
  });

  // ── N9: BR-CO-26 — Steuernummer allein genuegt der Norm nicht

  it("warnt, wenn nur die Steuernummer vorliegt (BR-CO-26)", () => {
    const r = validateEInvoiceData(baseData({
      seller: { ...baseData().seller, vatId: "" },
    }));
    expect(r.warnings.some(w => w.code === "BR-CO-26")).toBe(true);
    expect(r.errors.some(e => e.code === "BR-CO-26")).toBe(false);
  });

  it("flags fehlende Verkaeufer-Kennung ganz (BR-CO-26)", () => {
    const r = validateEInvoiceData(baseData({
      seller: { ...baseData().seller, vatId: "", taxId: "" },
    }));
    expect(r.errors.some(e => e.code === "BR-CO-26")).toBe(true);
  });

  // ── R7: Kategorien G und K wurden vorher gar nicht geprueft

  it("flags Ausfuhrlieferung ohne Befreiungsgrund (Kategorie G)", () => {
    const r = validateEInvoiceData(baseData({
      vatBreakdown: [{ category: "G", percent: 0, basis: 1000, amount: 0 }],
      totals: { ...baseData().totals, taxAmount: 0, grandTotal: 1000, duePayable: 1000 },
    }));
    expect(r.errors.some(e => e.code === "BR-G-10")).toBe(true);
  });

  it("flags innergemeinschaftliche Lieferung mit Steuersatz (Kategorie K)", () => {
    const r = validateEInvoiceData(baseData({
      vatBreakdown: [{ category: "K", percent: 19, basis: 1000, amount: 190,
                       exemptionReasonText: "Innergemeinschaftliche Lieferung" }],
    }));
    expect(r.errors.some(e => e.code === "BR-IC-01")).toBe(true);
  });

  it("verlangt bei Reverse Charge die USt-IdNr des Kaeufers (BT-48)", () => {
    const r = validateEInvoiceData(baseData({
      buyer: { ...baseData().buyer, vatId: "" },
      vatBreakdown: [{ category: "AE", percent: 0, basis: 1000, amount: 0,
                       exemptionReasonText: "Reverse Charge gem. §13b UStG" }],
      totals: { ...baseData().totals, taxAmount: 0, grandTotal: 1000, duePayable: 1000 },
    }));
    expect(r.errors.some(e => e.btField === "BT-48")).toBe(true);
  });

  // ── N6: ohne IBAN entsteht gar kein Zahlungsblock (BG-16)

  it("flags fehlende IBAN (BG-16)", () => {
    const r = validateEInvoiceData(baseData({
      seller: { ...baseData().seller, iban: "" },
    }));
    expect(r.errors.some(e => e.code === "BR-DE-1" && e.btField === "BT-84")).toBe(true);
    expect(r.ok).toBe(false);
  });

  it("meldet eine unplausible IBAN weiterhin nur als Warnung", () => {
    const r = validateEInvoiceData(baseData({
      seller: { ...baseData().seller, iban: "DE00" },
    }));
    expect(r.warnings.some(w => w.code === "BR-DE-IBAN")).toBe(true);
    expect(r.errors.some(e => e.btField === "BT-84")).toBe(false);
  });

  it("verlangt bei Nullsatz KEINEN Befreiungsgrund (Kategorie Z)", () => {
    const r = validateEInvoiceData(baseData({
      vatBreakdown: [{ category: "Z", percent: 0, basis: 1000, amount: 0 }],
      totals: { ...baseData().totals, taxAmount: 0, grandTotal: 1000, duePayable: 1000 },
    }));
    expect(r.errors.some(e => e.btField === "BT-120")).toBe(false);
  });
});
