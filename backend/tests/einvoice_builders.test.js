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
    lines: [{ id: 1, description: "Honorar HOAI Lph 1", quantity: 1, unitCode: "C62", unitPrice: 1000, lineTotal: 1000, vatCategory: "S", vatPercent: 19 }],
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

// ── R1/R2/R5/S5: Stellen, an denen dieselbe Datenlage zwei verschiedene
//    Dokumente ergab. Alle vier stammen aus dem Audit vom 25.08.2026.

describe("CII und UBL sagen dasselbe (R1, R2, R5, S5)", () => {
  const mitSkonto = () => baseData({
    dueDate: "2026-07-09",
    cashDiscount: { percent: 2, days: 14, amount: 20 },
    billingPeriodStart: "2026-05-01",
    billingPeriodEnd: "2026-05-31",
  });

  it("geben das Lieferdatum in beiden Syntaxen aus (R1)", () => {
    const { cii, ubl } = both(mitSkonto());
    expect(cii).toContain("ActualDeliverySupplyChainEvent");
    expect(cii).toContain("20260531");
    // UBL kannte cac:Delivery vorher gar nicht.
    expect(ubl).toContain("<cac:Delivery>");
    expect(ubl).toContain("<cbc:ActualDeliveryDate>2026-05-31</cbc:ActualDeliveryDate>");
  });

  it("erfinden kein Lieferdatum, wenn kein Leistungszeitraum vorliegt (R1)", () => {
    // Frueher fiel CII auf das Rechnungsdatum zurueck -- eine inhaltliche
    // Aussage ueber den Liefertag, die niemand geprueft hatte.
    const { cii, ubl } = both(baseData());
    expect(cii).not.toContain("ActualDeliverySupplyChainEvent");
    expect(ubl).not.toContain("<cac:Delivery>");
  });

  it("tragen die Skonto-Konvention in beiden Syntaxen (R2)", () => {
    const { cii, ubl } = both(mitSkonto());
    const konvention = "#SKONTO#TAGE=14#PROZENT=2.00#";
    // Vorher stand sie nur im UBL; wer das Hybrid-PDF bekam, sah das Skonto
    // ausschliesslich als Fliesstext.
    expect(ubl).toContain(konvention);
    expect(cii).toContain(konvention);
  });

  it("behalten CII den strukturierten Skonto-Block zusaetzlich", () => {
    const { cii } = both(mitSkonto());
    expect(cii).toContain("ApplicableTradePaymentDiscountTerms");
    expect(cii).toContain("<ram:CalculationPercent>2.00</ram:CalculationPercent>");
  });

  it("behaupten keinen Handelsnamen, den niemand erfasst hat (S5)", () => {
    const { cii, ubl } = both(baseData());
    // BT-28/BT-45 sind optional; vorher schrieb UBL denselben String wie in
    // RegistrationName und behauptete damit einen Handelsnamen.
    expect(ubl).not.toContain("<cac:PartyName>");
    expect(ubl).toContain("<cbc:RegistrationName>Architektur GmbH</cbc:RegistrationName>");
    expect(cii).not.toContain("PartyName");
  });

  it("lassen Anhaenge ohne Inhalt weg statt undefined zu schreiben (R5)", () => {
    const data = baseData({
      attachments: [
        { id: 1, fileName: "ok.pdf", mimeType: "application/pdf", base64: "SGFsbG8=" },
        { id: 2, fileName: "kaputt.pdf", mimeType: "application/pdf" },   // kein base64
      ],
    });
    const { cii, ubl } = both(data);
    for (const doc of [cii, ubl]) {
      expect(doc).not.toContain("undefined");
      expect(doc).toContain("SGFsbG8=");
      expect(doc).not.toContain("kaputt.pdf");
    }
  });

  it("bilden BT-20 aus einer Quelle, wenn die Daten sie mitbringen (R2)", () => {
    // loadInvoiceData liefert paymentTermsNote; beide Builder muessen ihn
    // uebernehmen statt einen eigenen zu bauen.
    const data = baseData({ paymentTermsNote: "Zahlbar in Naturalien" });
    const { cii, ubl } = both(data);
    expect(cii).toContain("Zahlbar in Naturalien");
    expect(ubl).toContain("Zahlbar in Naturalien");
  });
});
