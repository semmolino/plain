"use strict";

// ---------------------------------------------------------------------------
// Der Stammdaten-Abzug eines Belegs — an EINER Stelle.
//
// Ein Beleg friert rund 40 Spalten ein: Firma, Mitarbeiter, Rechnungsadresse
// und Ansprechpartner, wie sie am Tag der Rechnung aussahen. Das ist richtig
// so — eine Rechnung von 2019 darf nicht die Adresse von heute zeigen.
//
// WARUM ALS REINE FUNKTION
//   initInvoice() hat diesen Abzug bisher selbst gebaut und dafuer 14 einzelne
//   Abfragen gemacht: Projekt, Firma, Land, Mitarbeiter, Anrede, Vertrag, MwSt,
//   Adresse, Land, Kontakt, Anrede, Vorbelegung, Zahlungsart, Insert. Bei einer
//   Belegoruebernahme mit mehreren tausend Belegen sind das zehntausende
//   Rundreisen — derselbe Weg, der den Projektimport in den Gateway-Abbruch
//   geschickt hat.
//
//   Der Abzug haengt aber gar nicht am einzelnen Beleg: er haengt an
//   (Firma, Mitarbeiter, Vertrag). ALLE Belege desselben Vertrags tragen
//   denselben Abzug. Der Import laedt die Stammdaten deshalb einmal mandanten-
//   weit und spreizt sie hier hinein.
//
//   Damit es nicht zwei Definitionen gibt, die auseinanderlaufen, benutzt
//   initInvoice dieselbe Funktion.
// ---------------------------------------------------------------------------

/** @param {"invoice"|"advance"} kind — nur zwei Spaltennamen unterscheiden sich. */
function belegSnapshot({
  kind = "invoice",
  tenantId, projectId, contractId, companyId, employeeId, invoiceType = null,
  company, companyCountryLong,
  employee, employeeSalutation,
  contract,
  address, addressCountryShort, addressId,
  contact, contactSalutation, contactId,
  paymentMeansId = null,
  vatId = null, vatPercent = 0,
}) {
  const t = (v) => String(v ?? "").trim();
  const adressSpalte = kind === "invoice" ? "INVOICE_ADDRESS_ID" : "ADVANCE_INVOICE_ADDRESS_ID";
  const kontaktSpalte = kind === "invoice" ? "INVOICE_CONTACT_ID" : "ADVANCE_INVOICE_CONTACT_ID";

  const row = {
    COMPANY_ID: companyId,
    EMPLOYEE_ID: employeeId,
    PROJECT_ID: projectId,
    CONTRACT_ID: contractId,
    CURRENCY_ID: contract?.CURRENCY_ID ?? null,
    VAT_ID: vatId,
    VAT_PERCENT: vatPercent,
    STATUS_ID: 1,

    COMPANY_NAME_1: company?.COMPANY_NAME_1 ?? null,
    COMPANY_NAME_2: company?.COMPANY_NAME_2 ?? null,
    COMPANY_STREET: company?.STREET ?? null,
    COMPANY_POST_CODE: company?.POST_CODE ?? null,
    COMPANY_CITY: company?.CITY ?? null,
    COMPANY_COUNTRY: companyCountryLong ?? null,
    COMPANY_POST_OFFICE_BOX: company?.POST_OFFICE_BOX ?? null,
    COMPANY_BIC: company?.BIC ?? null,
    "COMPANY_TAX-ID": company?.["TAX-ID"] ?? null,
    COMPANY_TAX_NUMBER: company?.TAX_NUMBER ?? null,
    COMPANY_IBAN: company?.IBAN ?? null,
    "COMPANY_CREDITOR-ID": company?.["CREDITOR-ID"] ?? null,

    EMPLOYEE: `${employee?.ABBR ?? ""}: ${t(employee?.FIRST_NAME)} ${t(employee?.LAST_NAME)}`.trim(),
    EMPLOYEE_SALUTATION: employeeSalutation ?? null,
    EMPLOYEE_MAIL: employee?.MAIL ?? null,
    EMPLOYEE_PHONE: employee?.MOBILE ?? null,

    [adressSpalte]: addressId,
    ADDRESS_NAME_1: address?.ADDRESS_NAME_1 ?? null,
    ADDRESS_NAME_2: address?.ADDRESS_NAME_2 ?? null,
    ADDRESS_STREET: address?.STREET ?? null,
    ADDRESS_POST_CODE: address?.POST_CODE ?? null,
    ADDRESS_CITY: address?.CITY ?? null,
    ADDRESS_COUNTRY: addressCountryShort ?? null,
    ADDRESS_POST_OFFICE_BOX: address?.POST_OFFICE_BOX ?? null,
    ADDRESS_DEBITOR_NUMBER: address?.CUSTOMER_NUMBER ?? null,
    BUYER_REFERENCE: address?.BUYER_REFERENCE ?? null,
    ADDRESS_REFERENCE_NUMBER: address?.BUYER_REFERENCE ?? null,

    [kontaktSpalte]: contactId,
    CONTACT: `${t(contact?.FIRST_NAME)} ${t(contact?.LAST_NAME)}`.trim(),
    CONTACT_SALUTATION: contactSalutation ?? null,
    CONTACT_MAIL: contact?.EMAIL ?? null,
    CONTACT_PHONE: contact?.MOBILE ?? null,

    TENANT_ID: tenantId,

    // E-Rechnung: Steuerkategorie kommt vom Vertrag, nicht vom Beleg.
    VAT_CATEGORY:              contract?.VAT_CATEGORY              ?? "S",
    VAT_EXEMPTION_REASON_CODE: contract?.VAT_EXEMPTION_REASON_CODE ?? null,
    VAT_EXEMPTION_REASON_TEXT: contract?.VAT_EXEMPTION_REASON_TEXT ?? null,

    PAYMENT_MEANS_ID: paymentMeansId,
  };

  // Die Abschlagsrechnung ist eine eigene Tabelle und traegt keine Typspalte.
  if (kind === "invoice") row.INVOICE_TYPE = invoiceType;

  return row;
}

module.exports = { belegSnapshot };
