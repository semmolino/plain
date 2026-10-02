"use strict";

/**
 * Beispielbelege fuer Vorschau und Vorlagentests.
 *
 * Die Vorschau in Einstellungen → Dokumentvorlagen rendert damit die ECHTEN
 * Vorlagen (invoice.njk, offer.njk, …) — vorher zeigte sie eine Attrappe
 * (preview.njk), und Vorschau und PDF konnten auseinanderlaufen. Dieselben
 * Daten halten in tests/documentTemplates.snapshot.test.js fest, dass ein
 * Umbau der Vorlagen nichts Sichtbares veraendert.
 *
 * Bewusst ohne Datenbank: jede Kategorie bekommt ein vollstaendiges
 * View-Model in der Form, die die jeweiligen Builder liefern
 * (buildPdfViewModel, buildOfferPdfViewModel, buildNachtragPdfViewModel,
 * renderMahnungPdf). Wer dort ein Feld ergaenzt, das eine Vorlage liest,
 * ergaenzt es hier mit — sonst zeigt die Vorschau eine Luecke.
 */

const seller = () => ({
  name: "Musterplanung GmbH", street: "Beispielstraße 1", postCode: "10115", city: "Berlin",
  postOfficeBox: "", iban: "DE02 1203 0000 0000 2020 51", bic: "BYLADEM1001",
  taxId: "27/123/45678", vatId: "DE123456789", creditorId: "",
  contactName: "Dipl.-Ing. Anna Muster", contactPhone: "030 1234567", contactEmail: "info@musterplanung.de",
});
const buyer = () => ({ name: "Bauherr Beispiel AG", name2: "Abteilung Bau", street: "Musterallee 7", postCode: "80331", city: "München" });

const PROJECT = "P-2026-014 – Neubau Verwaltungsgebäude Nord";
const CONTRACT = "V-2026-003 – Generalplanervertrag";
const BAUVORHABEN = "Verwaltungszentrum Nord";
const TEXT1 = "vereinbarungsgemäß berechnen wir Ihnen unsere Leistungen für den Leistungszeitraum {{leistungszeitraum}}.";
const TEXT2 = "Wir danken Ihnen für den Auftrag und stehen für Rückfragen gern zur Verfügung.";

function structureRows() {
  return [
    { depth: 0, isLeaf: false, nameShort: "Gebäude", nameLong: "Objektplanung Gebäude", feeTotal: 120000, alreadyBilled: 42000, thisDocNet: 18500, performedPct: 50, revenueBasis: 120000, surchargesTotal: 0 },
    { depth: 1, isLeaf: true, nameShort: "LP2", nameLong: "Vorplanung", feeTotal: 10800, alreadyBilled: 10800, thisDocNet: 0, performedPct: 100, revenueBasis: 10800, surchargesTotal: 0 },
    { depth: 1, isLeaf: true, nameShort: "LP3", nameLong: "Entwurfsplanung", feeTotal: 18000, alreadyBilled: 9000, thisDocNet: 9000, performedPct: 100, revenueBasis: 18000, surchargesTotal: 0 },
    { depth: 1, isLeaf: true, nameShort: "LP5", nameLong: "Ausführungsplanung", feeTotal: 37500, alreadyBilled: 22200, thisDocNet: 9500, performedPct: 85, revenueBasis: 37500, surchargesTotal: 0 },
  ];
}

function honorarCalc() {
  return {
    nameShort: "K-01", nameLong: "Objektplanung Gebäude",
    calc: {
      nameShort: "HOAI 2021 § 35", zoneName: "III", zonePercent: 50,
      constructionCostsK0: 0, constructionCostsK1: 0, constructionCostsK2: 0,
      constructionCostsK3: 2400000, constructionCostsK4: 0,
      revenueK3: 228350,
    },
    phases: [
      { phaseLabel: "LP2 – Vorplanung", kx: "K3", revenueBase: 228350, feePercentBase: 7, basisHonorar: 15984.5, feePercent: 7, phaseRevenue: 15984.5 },
      { phaseLabel: "LP3 – Entwurfsplanung", kx: "K3", revenueBase: 228350, feePercentBase: 15, basisHonorar: 34252.5, feePercent: 15, phaseRevenue: 34252.5 },
    ],
    grundhonorar: 50237,
    blItems: [{ nameShort: "BL-1", name: "Bestandsaufnahme", lphLabel: "LP1", lphRef: "LP1", amount: 4200 }],
    blTotal: 4200,
    surcharges: [{
      nameShort: "UZ", nameLong: "Umbauzuschlag", calcMode: "single", percent: 20, baseAmount: 50237, amount: 10047.4,
      lphDetail: "LP2–LP3", lphItems: [{ label: "LP2", baseAmount: 15984.5, surchargeAmount: 3196.9 }, { label: "LP3", baseAmount: 34252.5, surchargeAmount: 6850.5 }],
      surchargeBls: [],
    }],
    zuschlaegeSum: 10047.4,
    gesamthonorar: 64484.4,
  };
}

function tec() {
  const rows = [
    { dateVoucher: "2026-09-08", employeeName: "Anna Muster", quantityExt: 3, spRate: 110, spTot: 330, postingDescription: "Abstimmung Brandschutzkonzept" },
    { dateVoucher: "2026-09-15", employeeName: "Ben Beispiel", quantityExt: 4.5, spRate: 95, spTot: 427.5, postingDescription: "Bestandsaufnahme Untergeschoss" },
  ];
  return {
    rows, sumQty: 7.5, sumTot: 757.5,
    groups: [{ kuerzel: "BL-2", bezeichnung: "Besondere Leistungen nach Aufwand", rows, sumQty: 7.5, sumTot: 757.5 }],
  };
}

function payments() {
  return [
    { number: "AR-2026-0011", date: "2026-05-29", netAmount: 21000, vatAmount: 3990, grossAmount: 24990, isCurrent: false },
    { number: "AR-2026-0019", date: "2026-07-31", netAmount: 21000, vatAmount: 3990, grossAmount: 24990, isCurrent: false },
    { number: "RE-2026-0042", date: "2026-09-30", netAmount: 18500, vatAmount: 3515, grossAmount: 22015, isCurrent: true },
  ];
}

function discountsFor(net, vatPct, { d1Percent = 0, skonto = true } = {}) {
  const r2 = (n) => Math.round(n * 100) / 100;
  const d1Amount = r2(-net * d1Percent / 100);
  const adjustedNet = r2(net + d1Amount);
  const adjustedVat = r2(adjustedNet * vatPct / 100);
  const adjustedGross = r2(adjustedNet + adjustedVat);
  const cashDiscountAmount = skonto ? r2(adjustedNet * 0.02) : 0;
  return {
    d1Percent, d2Percent: 0, d1Reason: d1Percent ? "Nachlass laut Vertrag" : null, d2Reason: null,
    d1Amount, d2Amount: 0, totalDiscounts: d1Amount,
    cashDiscountPercent: skonto ? 2 : 0, cashDiscountDays: skonto ? 14 : null, cashDiscountAmount,
    adjustedNet, adjustedVat, adjustedGross, hasDiscounts: d1Percent > 0, hasSkonto: skonto,
    skontoPaymentAmount: r2((adjustedNet - cashDiscountAmount) * (1 + vatPct / 100)),
  };
}

const noSe = () => ({ pct: 0, basis: null, basisAmount: 0, amount: 0, legalReference: null, hasSe: false, payable: 0, releaseRows: [], releaseTotal: 0, hasSeRelease: false });

function invoiceInv(over) {
  return {
    docType: "INVOICE", invoiceType: "rechnung", number: "RE-2026-0042", date: "2026-09-30", dueDate: "2026-10-30",
    comment: "", billingPeriodStart: "2026-09-01", billingPeriodEnd: "2026-09-30", buyerReference: "04011000-12345-34",
    seller: seller(), buyer: buyer(),
    lines: [], deductions: [],
    vatBreakdown: [{ rate: 19, basis: 18500, amount: 3515, category: "S" }],
    totals: { lineTotal: 18500, grandTotal: 22015 },
    canceledDocNumber: null, canceledDocDate: null, correctsLabel: null, correctionReason: null, replacesLabel: null,
    ...over,
  };
}

function invoiceVm(over = {}) {
  const inv = invoiceInv(over.inv);
  const net = inv.totals.lineTotal;
  return {
    inv,
    docTitle: "Rechnung",
    amountNet: net - 1000, amountExtrasNet: 1000,
    buyerName2: "z. Hd. Frau Kerstin Ludwig",
    projectName: PROJECT, contractName: CONTRACT, bauvorhaben: BAUVORHABEN,
    salutationLine: "Sehr geehrte Frau Ludwig,",
    text1: TEXT1.replace("{{leistungszeitraum}}", "01.09.2026–30.09.2026"),
    text2: "",
    projectStructureRows: structureRows(),
    structureTotals: { feeTotal: 66300, alreadyBilled: 42000, thisDocNet: 18500 },
    surchargeSummaryRows: [], structureSurchargesTotal: 0,
    projectPayments: payments(),
    paymentTotals: { net: 60500, vat: 11495, gross: 71995 },
    tec: tec(),
    deductionTotals: { net: 0, vat: 0, gross: 0 },
    discounts: discountsFor(net, 19),
    securityRetention: noSe(),
    arProgress: null,
    honorarCalcs: [honorarCalc()],
    payAmount: inv.totals.grandTotal,
    epcQrDataUri: null,
    ...over.vm,
  };
}

// ── je Kategorie ────────────────────────────────────────────────────────────

const SAMPLES = {
  invoice_rechnung: () => invoiceVm({ inv: { comment: "Nebenleistung Brandschutz gemäß Beauftragung vom 12.08.2026" } }),

  invoice_abschlags: () => {
    const vm = invoiceVm({
      inv: { invoiceType: "partial_payment", docType: "ADVANCE_INVOICE", number: "AR-2026-0024" },
      vm: { docTitle: "Abschlagsrechnung", arProgress: { priorNet: 42000, thisNet: 18500, cumulativeNet: 60500, hasPrior: true } },
    });
    vm.securityRetention = { ...noSe(), pct: 5, basis: "BRUTTO", basisAmount: 22015, amount: 1100.75, legalReference: "§ 17 VOB/B", hasSe: true, payable: 20914.25 };
    vm.payAmount = 20914.25;
    return vm;
  },

  invoice_teilschluss: () => finalVm("teilschlussrechnung", "Teilschlussrechnung"),
  invoice_schluss: () => finalVm("schlussrechnung", "Schlussrechnung"),

  invoice_korrektur: () => {
    const vm = invoiceVm({
      inv: {
        invoiceType: "gutschrift", number: "RK-2026-0003",
        canceledDocNumber: "RE-2026-0042", canceledDocDate: "2026-09-30", correctsLabel: "Rechnung",
        correctionReason: "Nebenkosten doppelt berechnet",
        vatBreakdown: [{ rate: 19, basis: -1000, amount: -190, category: "S" }],
        totals: { lineTotal: -1000, grandTotal: -1190 },
      },
      vm: { docTitle: "Rechnungskorrektur", amountNet: -1000, amountExtrasNet: 0, projectPayments: [], tec: { rows: [], groups: [] }, honorarCalcs: [], projectStructureRows: [] },
    });
    vm.discounts = discountsFor(-1000, 19, { skonto: false });
    vm.payAmount = -1190;
    return vm;
  },

  invoice_storno: () => ({
    ...invoiceVm({
      inv: {
        invoiceType: "stornorechnung", number: "ST-2026-0005",
        vatBreakdown: [{ rate: 19, basis: -18500, amount: -3515, category: "S" }],
        totals: { lineTotal: -18500, grandTotal: -22015 },
      },
      vm: { docTitle: "Stornorechnung", amountNet: -17500, amountExtrasNet: -1000 },
    }),
    stornoTitle: "Stornorechnung",
    origInvoice: { INVOICE_NUMBER: "RE-2026-0042", INVOICE_DATE: "2026-09-30", INVOICE_TYPE: "rechnung" },
  }),

  mahnung: () => ({
    seller: seller(),
    buyer: { name1: "Bauherr Beispiel AG", name2: "", street: "Musterallee 7", postCode: "80331", city: "München" },
    mahnstufeLabel: "1. Mahnung",
    invoiceNumber: "RE-2026-0042", invoiceDate: "2026-09-30", bauvorhaben: BAUVORHABEN,
    dueDate: "2026-10-30", daysOverdue: 14,
    totalGross: 22015, seHeld: 0, paidGross: 10000, adjustedGross: 0, openAmount: 12015,
    feeAmount: 5, totalDue: 12020,
    headerText: "leider konnten wir bis heute keinen Zahlungseingang zu der unten genannten Rechnung feststellen.",
    footerText: "Sollten Sie die Zahlung inzwischen veranlasst haben, betrachten Sie dieses Schreiben bitte als gegenstandslos.",
    docDate: "2026-11-13",
  }),

  offer_angebot: () => ({ ...offerVm(), honorarCalcs: [honorarCalc()], honorarTotalSum: 64484.4 }),
  offer_ab: () => ({ ...offerVm(), today: "2026-10-05" }),

  nachtrag: () => ({
    nachtrag: {
      ABBR: "NT-03", NAME: "Erweiterung Tiefgarage", CREATED_AT: "2026-09-20T09:00:00Z", SUBMITTED_DATE: "2026-09-22",
      REASON: "Auf Wunsch des Bauherrn wird die Tiefgarage um eine Achse erweitert. Die zusätzlichen Leistungen sind nicht Teil des Grundauftrags.",
      CLAIM_BASIS: "§ 650b BGB", COMPANY_ID: 1,
    },
    seller: seller(), buyer: buyer(),
    contact: { FIRST_NAME: "Kerstin", LAST_NAME: "Ludwig" },
    employeeName: "Dipl.-Ing. Anna Muster",
    projectName: PROJECT, bauvorhaben: BAUVORHABEN, categoryLabel: "Geänderte Leistung",
    structureRows: [
      { depth: 0, isLeaf: true, isHourly: false, nameShort: "N1", nameLong: "Planung Erweiterung Tiefgarage LP3–LP5", quantity: 1, spRate: 0, revenue: 14800, extras: 740 },
      { depth: 0, isLeaf: true, isHourly: true, nameShort: "N2", nameLong: "Abstimmung Fachplaner", quantity: 24, spRate: 110, revenue: 2640, extras: 0 },
    ],
    hasExtras: true,
    totals: { revenue: 17440, extras: 740, total: 18180 },
    vatPercent: 19, vatAmount: 3454.2, grossTotal: 21634.2,
  }),
};

function finalVm(invoiceType, title) {
  const vm = invoiceVm({
    inv: {
      invoiceType, number: "SR-2026-0007",
      deductions: [
        { number: "AR-2026-0011", date: "2026-05-29", netAmount: 21000, billedGross: 24990, paidAmount: 23740.5, minderungGross: 0, includedGross: 1249.5 },
        { number: "AR-2026-0019", date: "2026-07-31", netAmount: 21000, billedGross: 24990, paidAmount: 24990, minderungGross: 0, includedGross: 0 },
      ],
      vatBreakdown: [{ rate: 19, basis: 24300, amount: 4617, category: "S" }],
      totals: { lineTotal: 66300, grandTotal: 28917 },
    },
    vm: { docTitle: title, amountNet: 63000, amountExtrasNet: 3300, deductionTotals: { net: 42000, vat: 7980, gross: 49980 } },
  });
  vm.discounts = discountsFor(24300, 19);
  vm.payAmount = 28917;
  return vm;
}

function offerVm() {
  return {
    offer: { ABBR: "A-2026-016", NAME: "Machbarkeitsstudie Verwaltungsgebäude", OFFER_DATE: "2026-09-01", VALID_UNTIL: "2026-10-01", CREATED_AT: "2026-09-01T08:00:00Z" },
    seller: seller(), buyer: buyer(),
    contact: { FIRST_NAME: "Kerstin", LAST_NAME: "Ludwig", EMAIL: "k.ludwig@bauherr.example" },
    employee: { FIRST_NAME: "Anna", LAST_NAME: "Muster" },
    structureRows: [
      { id: 1, depth: 0, isLeaf: false, nameShort: "1", nameLong: "Machbarkeitsstudie", btId: 1, isHourly: false, quantity: 0, spRate: 0, revenueBasis: 18000, revenue: 18000, extrasPct: 5, extras: 900, total: 18900, roleName: "", effortLines: [], surchargesTotal: 0 },
      { id: 2, depth: 1, isLeaf: true, nameShort: "1.1", nameLong: "Grundlagenermittlung und Variantenvergleich", btId: 1, isHourly: false, quantity: 0, spRate: 0, revenueBasis: 12000, revenue: 12000, extrasPct: 5, extras: 600, total: 12600, roleName: "", effortLines: [], surchargesTotal: 0 },
      { id: 3, depth: 1, isLeaf: true, nameShort: "1.2", nameLong: "Workshops mit dem Nutzer", btId: 2, isHourly: true, quantity: 40, spRate: 150, revenueBasis: 6000, revenue: 6000, extrasPct: 5, extras: 300, total: 6300, roleName: "Projektleitung",
        effortLines: [{ hours: 24, rate: 150, amount: 3600, roleName: "Projektleitung" }, { hours: 16, rate: 150, amount: 2400, roleName: "Projektleitung" }], surchargesTotal: 0 },
    ],
    hasExtras: true, hasSurcharges: false, offerSurchargesTotal: 0, surchargeSummaryRows: [],
    vatPercent: 19, vatAmount: 3591, grossTotal: 22491,
    totals: { revenue: 18000, extras: 900, total: 18900 },
    text1: "gern unterbreiten wir Ihnen unser Angebot für die Machbarkeitsstudie.",
    text2: TEXT2,
    honorarCalcs: [], honorarTotalSum: 0,
  };
}

const SAMPLE_CATEGORIES = Object.keys(SAMPLES);

/** Vollstaendiges View-Model einer Kategorie (ohne theme/logo — die setzt der Aufrufer). */
function sampleViewModel(category) {
  const f = SAMPLES[category] || SAMPLES.invoice_rechnung;
  return f();
}

module.exports = { sampleViewModel, SAMPLE_CATEGORIES };
