"use strict";

/**
 * ════════════════════════════════════════════════════════════════════════════
 *  MUSTERBELEG — der Beleg, an dem die Mapping-Tabelle geprüft wird
 * ════════════════════════════════════════════════════════════════════════════
 *
 * Ein `InvoiceData`-Objekt, das JEDE Gruppe trägt, die plan&simple ausgeben
 * kann: Anlagen, Nachlässe, Skonto, Abzüge früherer Abschläge, Storno-Verweis,
 * Sicherheitseinbehalt, Projekt-, Vertrags-, Bestell- und Buchungsreferenz,
 * Ansprechpartner auf beiden Seiten, Leistungszeitraum, Stundenposition.
 *
 * Zweck: Ein Feld, das nur unter einer bestimmten Datenlage ins XML kommt,
 * ist sonst in der Abdeckungsprüfung nicht sichtbar — und eine Registry-Zeile,
 * die ins Leere zeigt, fiele nicht auf. Wer ein neues optionales Feld ergänzt,
 * ergänzt es hier mit; sonst meldet `registryCheck` die Zeile als unbelegt.
 *
 * Das ist ausdrücklich KEIN Testfixture für fachliche Rechenwege — dafür gibt
 * es `tests/einvoice_data_to_validator.test.js`, das den Beleg durch
 * `loadInvoiceData` schickt. Hier zählt allein die Vollständigkeit der Felder.
 */

const codelists = require("./codelists");

/** @returns {Object} vollständig gefülltes InvoiceData */
function referenceInvoiceData() {
  return {
    docType: "INVOICE",
    invoiceType: "schlussrechnung",
    typeCodeCii: "877",
    typeCodeUbl: "380",
    typeCode: "380",

    number: "RG-2026-0042",
    date: "2026-06-09",
    dueDate: "2026-07-09",
    currency: "EUR",
    comment: "Schlussrechnung zum Bauvorhaben Musterstraße.",
    billingPeriodStart: "2026-05-01",
    billingPeriodEnd: "2026-05-31",
    deliveryDate: "2026-05-31",
    buyerReference: "04011000-1234512345-06",

    seller: {
      name: "Architektur Muster GmbH",
      street: "Hauptstr. 1",
      city: "München",
      postCode: "80331",
      countryId: "DE",
      vatId: "DE123456789",
      taxId: "143/815/09321",
      iban: "DE02120300000000202051",
      bic: "BYLADEM1001",
      creditorId: "DE98ZZZ09999999999",
      postOfficeBox: "Postfach 10 20 30",
      peppolEndpointId: "DE123456789",
      peppolSchemeId: "9930",
      contactName: "S. Messina",
      contactPhone: "+49 89 1234567",
      contactEmail: "rechnung@example.de",
      email: "rechnung@example.de",
    },

    buyer: {
      name: "Bauherr AG",
      street: "Bauplatz 9",
      city: "Berlin",
      postCode: "10115",
      countryId: "DE",
      vatId: "DE987654321",
      debitorNumber: "D-10023",
      peppolEndpointId: "DE987654321",
      peppolSchemeId: "9930",
      email: "buchhaltung@bauherr.example",
      contactName: "K. Ludwig",
      contactPhone: "+49 30 7654321",
      contactEmail: "buchhaltung@bauherr.example",
    },

    lines: [
      {
        id: 1,
        description: "LPH 1 – Grundlagenermittlung",
        note: "Honorar: 3000 / Nebenkosten: 150",
        quantity: 1,
        unitCode: codelists.UNIT_LUMP_SUM,
        unitPrice: 3150,
        lineTotal: 3150,
        vatRate: 19,
        vatCategory: "S",
        billingPeriodStart: "2026-05-01",
        billingPeriodEnd: "2026-05-31",
      },
      {
        id: 2,
        description: "LPH 8 – Objektüberwachung",
        note: "12 Std. (110 €/h)",
        quantity: 12,
        unitCode: codelists.UNIT_HOUR,
        unitPrice: 110,
        lineTotal: 1320,
        vatRate: 19,
        vatCategory: "S",
        billingPeriodStart: "2026-05-01",
        billingPeriodEnd: "2026-05-31",
      },
    ],

    vatBreakdown: [{
      rate: 19,
      basis: 4370,
      amount: 830.3,
      category: "S",
      exemptionReasonCode: null,
      exemptionReasonText: null,
    }],

    deductions: [{
      number: "AR-2026-0007",
      date: "2026-04-02",
      netAmount: 1000,
      vatAmount: 190,
      grossAmount: 1190,
      retainedAmount: 59.5,
      paidAmount: 1130.5,
    }],

    allowances: [{
      reason: "Nachlass laut Vereinbarung",
      percent: 2,
      amount: 100,
    }],

    cashDiscount: { percent: 2, days: 14, amount: 87.4 },
    paymentTermsNote: "#SKONTO#TAGE=14#PROZENT=2.00#\nZahlbar bis 2026-07-09",

    securityRetention: {
      held:    { amount: 260.02, percent: 5, basis: "BRUTTO" },
      release: { total: 59.5, rows: [{ number: "AR-2026-0007", amount: 59.5 }] },
      legalReference: "§ 17 Abs. 6 VOB/B",
      hasHeld: true,
      hasRelease: true,
    },

    totals: {
      lineTotal: 4470,
      allowanceTotal: 100,
      chargeTotal: 0,
      taxBasis: 4370,
      taxAmount: 830.3,
      grandTotal: 5200.3,
      prepaidGross: 1130.5,
      prepaidAmount: 1130.5,
      duePayable: 4069.8,
    },

    canceledDocNumber: "RG-2026-0041",
    canceledDocDate: "2026-05-02",

    projectNumber: "P-2026-014",
    contractNumber: "V-2026-003",
    orderNumber: "BEST-4711",
    buyerAccountingRef: "KST-8100",
    remittanceInformation: "RG-2026-0042",
    paymentMeansCode: "58",
    paymentMeansName: "SEPA-Überweisung",

    attachments: [{
      id: 7,
      documentReference: "ANL-1",
      description: "Stundennachweis Mai 2026",
      fileName: "stundennachweis-2026-05.pdf",
      mimeType: "application/pdf",
      attachmentTypeCode: "916",
      base64: "JVBERi0xLjQK",
    }],
  };
}

/**
 * Zweite Ausprägung: Reverse Charge (§13b UStG) — im Baubereich der Normalfall.
 *
 * Sie existiert, weil BT-120 und BT-121 (Befreiungsgrund) am Regelbeleg gar
 * nicht anfallen: bei Kategorie S gibt es keinen Grund zu nennen. Ohne diese
 * zweite Ausprägung wären beide Registry-Zeilen unbelegt und die
 * Abdeckungsprüfung müsste sie durchwinken — genau die Lücke, die eine
 * Tabelle nie bemerkt hätte.
 */
function referenceInvoiceDataReverseCharge() {
  const d = referenceInvoiceData();
  d.vatBreakdown = [{
    rate: 0,
    basis: 4370,
    amount: 0,
    category: "AE",
    exemptionReasonCode: "VATEX-EU-AE",
    exemptionReasonText: codelists.defaultExemptionReason("AE"),
  }];
  for (const l of d.lines) { l.vatCategory = "AE"; l.vatRate = 0; }
  d.totals = { ...d.totals, taxAmount: 0, grandTotal: 4370, duePayable: 3239.5 };
  return d;
}

/**
 * Alle Ausprägungen, gegen die `registryCheck` die Mapping-Tabelle hält.
 * Ein Feld, das in keiner davon anfällt, gilt als unbelegt.
 */
function referenceDocuments() {
  return [
    { name: "Schlussrechnung mit Regelsteuersatz", data: referenceInvoiceData() },
    { name: "Reverse Charge (§13b UStG)", data: referenceInvoiceDataReverseCharge() },
  ];
}

module.exports = {
  referenceInvoiceData,
  referenceInvoiceDataReverseCharge,
  referenceDocuments,
};
