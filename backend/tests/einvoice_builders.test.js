"use strict";

// Die erste Absicherung des erzeugten XML selbst (S2). Bisher prueften Tests
// nur die Vorpruefung — dass beide Builder aus derselben Datenlage dasselbe
// Dokument bauen, prueft sonst niemand.

const { generateCiiXml } = require("../services_einvoice_cii");
const { generateUblXml } = require("../services_einvoice_ubl");

function baseData(overrides = {}) {
  return Object.assign({
    number: "RG-2026-0001",
    date: "2026-06-09",
    typeCodeCii: "380",
    typeCodeUbl: "380",
    currency: "EUR",
    buyerReference: "04011000-1234512345-06",
    seller: {
      name: "Architektur GmbH", street: "Hauptstr. 1", city: "Munchen", postCode: "80331", countryId: "DE",
      vatId: "DE123456789", taxId: "143/815/09321", iban: "DE02120300000000202051", bic: "BYLADEM1001",
      contactName: "S. Messina", contactPhone: "+49 89 1234567", contactEmail: "info@example.de",
    },
    buyer: {
      name: "Bauherr AG", street: "Bauplatz 9", city: "Berlin", postCode: "10115", countryId: "DE",
      vatId: "DE987654321",
    },
    lines: [{ position: 1, description: "Honorar HOAI Lph 1", quantity: 1, unitCode: "C62", unitPrice: 1000, lineTotal: 1000, vatCategory: "S", vatPercent: 19 }],
    vatBreakdown: [{ category: "S", percent: 19, basis: 1000, amount: 190 }],
    allowances: [],
    attachments: [],
    deductions: [],
    totals: {
      lineTotal: 1000, allowanceTotal: 0, chargeTotal: 0,
      taxBasis: 1000, taxAmount: 190, grandTotal: 1190, duePayable: 1190, prepaidGross: 0,
    },
  }, overrides);
}

const both = (data) => ({ cii: generateCiiXml(data, "EN16931"), ubl: generateUblXml(data) });

describe("CII- und UBL-Builder", () => {
  it("erzeugen kein leeres BuyerReference-Element (N5)", () => {
    const { cii, ubl } = both(baseData({ buyerReference: "" }));
    // Ein leeres Element ist schlechter als gar keins: es faellt zusaetzlich
    // ueber die Leerelement-Pruefung des Empfaengers.
    expect(cii).not.toContain("<ram:BuyerReference></ram:BuyerReference>");
    expect(cii).not.toContain("<ram:BuyerReference/>");
    expect(ubl).not.toContain("<cbc:BuyerReference></cbc:BuyerReference>");
    expect(ubl).not.toContain("<cbc:BuyerReference/>");
  });

  it("schreiben eine vorhandene Leitweg-ID weiterhin aus", () => {
    const { cii, ubl } = both(baseData());
    expect(cii).toContain("<ram:BuyerReference>04011000-1234512345-06</ram:BuyerReference>");
    expect(ubl).toContain("<cbc:BuyerReference>04011000-1234512345-06</cbc:BuyerReference>");
  });

  it("lassen leere Adressfelder weg statt sie leer zu schreiben (N8)", () => {
    const data = baseData();
    data.seller = { ...data.seller, postCode: "", street: "" };
    const { cii, ubl } = both(data);
    expect(cii).not.toContain("<ram:PostcodeCode></ram:PostcodeCode>");
    expect(cii).not.toContain("<ram:LineOne></ram:LineOne>");
    expect(ubl).not.toContain("<cbc:PostalZone></cbc:PostalZone>");
    // Die Stadt ist gefuellt und muss weiterhin dastehen.
    expect(cii).toContain("<ram:CityName>Munchen</ram:CityName>");
  });

  it("geben in beiden Syntaxen dieselbe Verkaeuferadresse aus", () => {
    const { cii, ubl } = both(baseData());
    for (const wert of ["80331", "Hauptstr. 1", "Munchen"]) {
      expect(cii).toContain(wert);
      expect(ubl).toContain(wert);
    }
  });
});
