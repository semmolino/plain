"use strict";

/**
 * ════════════════════════════════════════════════════════════════════════════
 *  BT-REGISTRY — EINZIGE QUELLE DER WAHRHEIT für das Feld-Mapping der E-Rechnung
 * ════════════════════════════════════════════════════════════════════════════
 *
 *  Diese Datei ersetzt `backend/config/Mapping BT.xlsx`.
 *
 *  Warum die Excel weg ist — drei Gründe, jeder für sich ausreichend:
 *
 *  1. **Sie konnte nichts beweisen.** Eine Tabellenzeile „BT-11 ← PROJECT.ABBR"
 *     war eine Behauptung. Ob das Feld wirklich im XML landet, wusste sie
 *     nicht. Genau so ist BT-11 monatelang geladen und nie ausgegeben worden
 *     (Audit 25.08.2026, Befund im Abschnitt „Was kritisch fehlt"), ohne dass
 *     Tabelle oder Test etwas gemerkt hätten.
 *  2. **Sie war nicht überprüfbar geschrieben.** `git diff` zeigt bei einer
 *     .xlsx nur „binary files differ"; ein Review konnte die Änderung nicht
 *     lesen. Und der Lader dazu (`services_bt_mapping.js`) hatte keinen
 *     einzigen Aufrufer — die Datei wurde nie gelesen, auch nicht zur Laufzeit.
 *  3. **Sie war bereits falsch.** Die Tabelle führte BT-13 (Bestellnummer) und
 *     BT-14 (Auftragsnummer) beide auf `CONTRACT.ABBR`; im Code kommt BT-13
 *     aus `BUYER_ORDER_REFERENCE` und BT-14 gibt es nicht. Ein Widerspruch,
 *     den niemand sehen konnte.
 *
 *  Was stattdessen gilt:
 *
 *  - Jede Zeile hier nennt den XML-Pfad, an dem das Feld tatsächlich landet.
 *  - `registryCheck.js` erzeugt aus `referenceDocument.js` echte CII- und
 *    UBL-Dokumente und hält jede Zeile dagegen — **in beide Richtungen**:
 *    eine Zeile ohne Pfad im Dokument ist ein Fehler, ein Pfad im Dokument
 *    ohne Zeile ebenso. Drift ist damit nicht mehr möglich, sie ist ein
 *    roter Test.
 *  - `docs/EINVOICE_BT_MAPPING.md` wird aus dieser Datei erzeugt
 *    (`npm run einvoice:gen`) — die Tabelle für Menschen bleibt, nur ist sie
 *    jetzt abgeleitet statt gepflegt.
 *
 *  ── Feldbedeutung ─────────────────────────────────────────────────────────
 *    id           'BT-1' — Business Term nach EN 16931
 *    group        'BG-4' — Business Group, oder null für Dokumentebene
 *    labelDe      Klartext (deutsch), wie ihn die KoSIT-Handreichung führt
 *    cardinality  '1..1' | '0..1' | '0..n' | '1..n' — im Profil EN 16931
 *    source       Herkunft in der Datenbank: 'TABELLE.SPALTE', mehrere mit ' / ',
 *                 'abgeleitet: …' für Rechenwerte, null wenn nicht unterstützt
 *    data         Pfad im InvoiceData-Objekt (services_einvoice_data.js)
 *    cii          absoluter XML-Pfad im CII-Dokument, oder null
 *    ubl          absoluter XML-Pfad im UBL-Dokument, oder null
 *    attr         Attribut statt Elementinhalt (z. B. unitCode) — optional
 *    discriminator  wenn mehrere BT denselben Pfad teilen (schemeID) — optional
 *    status       'emitted'       — wird ausgegeben, wird geprüft
 *                 'loaded-unused' — Datenmodell kennt es, kein Builder gibt es aus
 *                 'unsupported'   — bewusst nicht unterstützt
 *    note         Begründung, Vorbehalt, Verweis auf einen Auditbefund
 *
 *  ── Beim Ergänzen eines Feldes ────────────────────────────────────────────
 *    1. Zeile hier auf 'emitted' setzen und beide Pfade eintragen
 *    2. Builder ergänzen
 *    3. `referenceDocument.js` so füllen, dass das Feld auch wirklich anfällt
 *    4. `npm run einvoice:gen` (erzeugt die Doku neu)
 *    5. `npm test --prefix backend -- einvoice_mapping` muss grün sein
 */

// ── Pfad-Präfixe, damit die Zeilen lesbar bleiben ────────────────────────────

const CII_ROOT = "rsm:CrossIndustryInvoice";
const CTX  = `${CII_ROOT}/rsm:ExchangedDocumentContext`;
const DOC  = `${CII_ROOT}/rsm:ExchangedDocument`;
const TX   = `${CII_ROOT}/rsm:SupplyChainTradeTransaction`;
const LINE = `${TX}/ram:IncludedSupplyChainTradeLineItem`;
const AGR  = `${TX}/ram:ApplicableHeaderTradeAgreement`;
const DEL  = `${TX}/ram:ApplicableHeaderTradeDelivery`;
const STL  = `${TX}/ram:ApplicableHeaderTradeSettlement`;
const SELLER = `${AGR}/ram:SellerTradeParty`;
const BUYER  = `${AGR}/ram:BuyerTradeParty`;
const SUM  = `${STL}/ram:SpecifiedTradeSettlementHeaderMonetarySummation`;

const UBL_ROOT = "Invoice";
const U_SELLER = `${UBL_ROOT}/cac:AccountingSupplierParty/cac:Party`;
const U_BUYER  = `${UBL_ROOT}/cac:AccountingCustomerParty/cac:Party`;
const U_LINE   = `${UBL_ROOT}/cac:InvoiceLine`;
const U_TOTAL  = `${UBL_ROOT}/cac:LegalMonetaryTotal`;

// ── Business Groups ──────────────────────────────────────────────────────────

const GROUPS = {
  "BG-1":  "Rechnungsbegleitender Text",
  "BG-2":  "Prozesssteuerung",
  "BG-3":  "Referenz auf vorausgegangene Rechnung",
  "BG-4":  "Verkäufer",
  "BG-5":  "Postanschrift des Verkäufers",
  "BG-6":  "Kontaktangaben des Verkäufers",
  "BG-7":  "Käufer",
  "BG-8":  "Postanschrift des Käufers",
  "BG-9":  "Kontaktangaben des Käufers",
  "BG-10": "Zahlungsempfänger",
  "BG-11": "Steuervertreter des Verkäufers",
  "BG-13": "Lieferinformationen",
  "BG-14": "Rechnungszeitraum",
  "BG-16": "Zahlungsanweisungen",
  "BG-17": "Überweisung",
  "BG-19": "Lastschrift",
  "BG-20": "Nachlässe auf Dokumentenebene",
  "BG-21": "Zuschläge auf Dokumentenebene",
  "BG-22": "Gesamtbeträge",
  "BG-23": "Aufschlüsselung der Umsatzsteuer",
  "BG-24": "Anlagen",
  "BG-25": "Rechnungsposition",
  "BG-26": "Zeitraum der Position",
  "BG-27": "Nachlässe auf Positionsebene",
  "BG-28": "Zuschläge auf Positionsebene",
  "BG-29": "Detailinformationen zum Preis",
  "BG-30": "Umsatzsteuerangaben der Position",
  "BG-31": "Artikelangaben",
};

const STATUSES = new Set(["emitted", "loaded-unused", "unsupported"]);

// ── Das Mapping ──────────────────────────────────────────────────────────────

/** @type {Array<Object>} */
const ENTRIES = [

  // ═══ Dokumentebene ════════════════════════════════════════════════════════
  { id: "BT-1", group: null, labelDe: "Rechnungsnummer", cardinality: "1..1",
    source: "INVOICE.INVOICE_NUMBER / ADVANCE_INVOICE.ADVANCE_INVOICE_NUMBER",
    data: "number", cii: `${DOC}/ram:ID`, ubl: `${UBL_ROOT}/cbc:ID` },

  { id: "BT-2", group: null, labelDe: "Rechnungsdatum", cardinality: "1..1",
    source: "INVOICE.INVOICE_DATE / ADVANCE_INVOICE.ADVANCE_INVOICE_DATE",
    data: "date", cii: `${DOC}/ram:IssueDateTime/udt:DateTimeString`, ubl: `${UBL_ROOT}/cbc:IssueDate` },

  { id: "BT-3", group: null, labelDe: "Code für den Rechnungstyp", cardinality: "1..1",
    source: "abgeleitet: docType + INVOICE.INVOICE_TYPE + CANCELS_*_ID",
    data: "typeCodeCii / typeCodeUbl", cii: `${DOC}/ram:TypeCode`, ubl: `${UBL_ROOT}/cbc:InvoiceTypeCode`,
    note: "Codeliste UNTDID 1001, gebildet in codelists.documentTypeCode(). CII nutzt die Bau-Codes 875/876/877, UBL 326/380." },

  { id: "BT-5", group: null, labelDe: "Code für die Rechnungswährung", cardinality: "1..1",
    source: "CURRENCY.ABBR über INVOICE.CURRENCY_ID",
    data: "currency", cii: `${STL}/ram:InvoiceCurrencyCode`, ubl: `${UBL_ROOT}/cbc:DocumentCurrencyCode` },

  { id: "BT-6", group: null, labelDe: "Code der Währung für die Umsatzsteuerbuchung", cardinality: "0..1",
    source: null, data: null, cii: null, ubl: null, status: "unsupported",
    note: "Abweichende Buchungswährung wird nicht unterstützt — plan&simple rechnet in Belegwährung." },

  { id: "BT-7", group: null, labelDe: "Datum der Steuerfälligkeit", cardinality: "0..1",
    source: null, data: null, cii: null, ubl: null, status: "unsupported",
    note: "Ist-Versteuerung wird nicht abgebildet; das Rechnungsdatum (BT-2) gilt." },

  { id: "BT-8", group: null, labelDe: "Code für das Datum der Steuerfälligkeit", cardinality: "0..1",
    source: null, data: null, cii: null, ubl: null, status: "unsupported", note: "Siehe BT-7." },

  { id: "BT-9", group: null, labelDe: "Fälligkeitsdatum der Zahlung", cardinality: "0..1",
    source: "INVOICE.DUE_DATE / ADVANCE_INVOICE.DUE_DATE", data: "dueDate",
    cii: `${STL}/ram:SpecifiedTradePaymentTerms/ram:DueDateDateTime/udt:DateTimeString`,
    ubl: `${UBL_ROOT}/cbc:DueDate` },

  { id: "BT-10", group: null, labelDe: "Käuferreferenz (Leitweg-ID)", cardinality: "0..1",
    source: "INVOICE.BUYER_REFERENCE / ADDRESS.ADDRESS_REFERENCE_NUMBER", data: "buyerReference",
    cii: `${AGR}/ram:BuyerReference`, ubl: `${UBL_ROOT}/cbc:BuyerReference`,
    note: "Bei öffentlichen Auftraggebern Pflicht (B2G); der Validator warnt unter BR-DE-15. Leer wird das Element weggelassen, nicht leer geschrieben (Befund N5)." },

  { id: "BT-11", group: null, labelDe: "Projektreferenz", cardinality: "0..1",
    source: "PROJECT.PROJECT_NUMBER / PROJECT.ABBR über INVOICE.PROJECT_ID", data: "projectNumber",
    cii: `${AGR}/ram:SpecifiedProcuringProject/ram:ID`, ubl: `${UBL_ROOT}/cac:ProjectReference/cbc:ID`,
    note: "Für die Zielbranche das wichtigste Strukturfeld — Empfänger ordnen die Rechnung darüber dem Bauvorhaben zu." },

  { id: "BT-12", group: null, labelDe: "Vertragsnummer", cardinality: "0..1",
    source: "CONTRACT.CONTRACT_NUMBER über INVOICE.CONTRACT_ID", data: "contractNumber",
    cii: `${AGR}/ram:ContractReferencedDocument/ram:IssuerAssignedID`,
    ubl: `${UBL_ROOT}/cac:ContractDocumentReference/cbc:ID` },

  { id: "BT-13", group: null, labelDe: "Bestellnummer", cardinality: "0..1",
    source: "INVOICE.BUYER_ORDER_REFERENCE", data: "orderNumber",
    cii: `${AGR}/ram:BuyerOrderReferencedDocument/ram:IssuerAssignedID`,
    ubl: `${UBL_ROOT}/cac:OrderReference/cbc:ID`,
    note: "Die alte Excel-Tabelle führte BT-13 auf CONTRACT.ABBR — das war falsch und ist der Grund, warum diese Registry existiert." },

  { id: "BT-14", group: null, labelDe: "Auftragsnummer", cardinality: "0..1",
    source: null, data: null, cii: null, ubl: null, status: "unsupported",
    note: "Kein eigenes Feld. Die Excel-Tabelle führte BT-14 und BT-13 auf dieselbe Spalte." },

  { id: "BT-15", group: null, labelDe: "Referenz auf die Empfangsbestätigung", cardinality: "0..1",
    source: null, data: null, cii: null, ubl: null, status: "unsupported" },
  { id: "BT-16", group: null, labelDe: "Referenz auf die Versandanzeige", cardinality: "0..1",
    source: null, data: null, cii: null, ubl: null, status: "unsupported" },
  { id: "BT-17", group: null, labelDe: "Referenz auf die Ausschreibung", cardinality: "0..1",
    source: null, data: null, cii: null, ubl: null, status: "unsupported" },
  { id: "BT-18", group: null, labelDe: "Objektkennung", cardinality: "0..1",
    source: null, data: null, cii: null, ubl: null, status: "unsupported" },

  { id: "BT-19", group: null, labelDe: "Buchungsreferenz des Käufers", cardinality: "0..1",
    source: "INVOICE.BUYER_ACCOUNTING_REFERENCE", data: "buyerAccountingRef",
    cii: `${STL}/ram:ReceivableSpecifiedTradeAccountingAccount/ram:ID`,
    ubl: `${UBL_ROOT}/cbc:AccountingCost` },

  { id: "BT-20", group: null, labelDe: "Zahlungsbedingungen", cardinality: "0..1",
    source: "abgeleitet: DUE_DATE + CASH_DISCOUNT_PERCENT/-DAYS", data: "paymentTermsNote",
    cii: `${STL}/ram:SpecifiedTradePaymentTerms/ram:Description`,
    ubl: `${UBL_ROOT}/cac:PaymentTerms/cbc:Note`,
    note: "Trägt die KoSIT-Skonto-Konvention #SKONTO#TAGE=..#PROZENT=..#. Wird EINMAL in loadInvoiceData gebildet — vorher baute jeder Builder seinen eigenen Text und beide liefen auseinander (Befund R2)." },

  { id: "BT-21", group: "BG-1", labelDe: "Betreffcode der Anmerkung", cardinality: "0..1",
    source: "abgeleitet: REG (Verkäuferangaben) bzw. PMT (Sicherheitseinbehalt)", data: "securityRetention",
    cii: `${DOC}/ram:IncludedNote/ram:SubjectCode`, ubl: null,
    note: "UBL kennt kein eigenes Element: der Code steht als #PMT#-Präfix im Notentext (cbc:Note). Codeliste UNTDID 4451." },

  { id: "BT-22", group: "BG-1", labelDe: "Anmerkung zur Rechnung", cardinality: "0..n",
    source: "INVOICE.COMMENT", data: "comment",
    cii: `${DOC}/ram:IncludedNote/ram:Content`, ubl: `${UBL_ROOT}/cbc:Note` },

  { id: "BT-23", group: "BG-2", labelDe: "Geschäftsprozesstyp", cardinality: "0..1",
    source: "fest: Peppol-Billing-Profil", data: null,
    cii: null, ubl: `${UBL_ROOT}/cbc:ProfileID`,
    note: "Nur UBL. Im CII sieht unser Dokument kein BusinessProcessSpecifiedDocumentContextParameter vor." },

  { id: "BT-24", group: "BG-2", labelDe: "Spezifikationskennung", cardinality: "1..1",
    source: "fest: Profil-ID (einvoice/profiles.js)", data: null,
    cii: `${CTX}/ram:GuidelineSpecifiedDocumentContextParameter/ram:ID`,
    ubl: `${UBL_ROOT}/cbc:CustomizationID` },

  { id: "BT-25", group: "BG-3", labelDe: "Referenz auf die vorausgegangene Rechnung", cardinality: "0..1",
    source: "INVOICE.CANCELS_INVOICE_ID / INVOICE_DEDUCTION.ADVANCE_INVOICE_ID",
    data: "canceledDocNumber / deductions[].number",
    cii: `${STL}/ram:InvoiceReferencedDocument/ram:IssuerAssignedID`,
    ubl: `${UBL_ROOT}/cac:BillingReference/cac:InvoiceDocumentReference/cbc:ID`,
    note: "Zwei Anlässe, ein Element: Storno verweist auf den stornierten Beleg, die Schlussrechnung auf jede abgezogene Abschlagsrechnung." },

  { id: "BT-26", group: "BG-3", labelDe: "Datum der vorausgegangenen Rechnung", cardinality: "0..1",
    source: "INVOICE.INVOICE_DATE / ADVANCE_INVOICE.ADVANCE_INVOICE_DATE des Bezugsbelegs",
    data: "canceledDocDate / deductions[].date",
    cii: `${STL}/ram:InvoiceReferencedDocument/ram:FormattedIssueDateTime/qdt:DateTimeString`,
    ubl: `${UBL_ROOT}/cac:BillingReference/cac:InvoiceDocumentReference/cbc:IssueDate` },

  // ═══ BG-4 Verkäufer ═══════════════════════════════════════════════════════
  { id: "BT-27", group: "BG-4", labelDe: "Name des Verkäufers", cardinality: "1..1",
    source: "INVOICE.COMPANY_NAME_1 / COMPANY.COMPANY_NAME_1", data: "seller.name",
    cii: `${SELLER}/ram:Name`, ubl: `${U_SELLER}/cac:PartyLegalEntity/cbc:RegistrationName` },

  { id: "BT-28", group: "BG-4", labelDe: "Handelsname des Verkäufers", cardinality: "0..1",
    source: null, data: null, cii: null, ubl: null, status: "unsupported",
    note: "Bewusst entfernt (Befund S5): UBL schrieb denselben String in cac:PartyName und RegistrationName und behauptete damit einen Handelsnamen, den niemand erfasst hat." },

  { id: "BT-29", group: "BG-4", labelDe: "Kennung des Verkäufers", cardinality: "0..n",
    source: null, data: null, cii: null, ubl: null, status: "unsupported",
    note: "Zusammen mit BT-30 der Grund, warum BR-CO-26 nur über die USt-IdNr erfüllt wird (Befund N9)." },

  { id: "BT-30", group: "BG-4", labelDe: "Registernummer des Verkäufers", cardinality: "0..1",
    source: null, data: null, cii: null, ubl: null, status: "unsupported",
    note: "Handelsregisternummer. Fehlt im Datenmodell; wäre die belastbare Lösung für BR-CO-26 (Befund N9)." },

  { id: "BT-31", group: "BG-4", labelDe: "Umsatzsteuer-Identifikationsnummer des Verkäufers", cardinality: "0..1",
    source: "INVOICE.\"COMPANY_TAX-ID\"", data: "seller.vatId",
    cii: `${SELLER}/ram:SpecifiedTaxRegistration/ram:ID`, ubl: `${U_SELLER}/cac:PartyTaxScheme/cbc:CompanyID`,
    discriminator: { cii: 'schemeID="VA"', ubl: "cac:TaxScheme/cbc:ID = VAT" } },

  { id: "BT-32", group: "BG-4", labelDe: "Steuernummer des Verkäufers", cardinality: "0..1",
    source: "INVOICE.COMPANY_TAX_NUMBER", data: "seller.taxId",
    cii: `${SELLER}/ram:SpecifiedTaxRegistration/ram:ID`, ubl: `${U_SELLER}/cac:PartyTaxScheme/cbc:CompanyID`,
    discriminator: { cii: 'schemeID="FC"', ubl: "cac:TaxScheme/cbc:ID = FC" },
    note: "Erfüllt BR-CO-26 nicht (die Norm verlangt BT-29/30/31) — der Validator warnt, wenn nur die Steuernummer vorliegt." },

  { id: "BT-33", group: "BG-4", labelDe: "Sonstige rechtliche Informationen des Verkäufers", cardinality: "0..1",
    source: null, data: null, cii: null, ubl: null, status: "unsupported" },

  { id: "BT-34", group: "BG-4", labelDe: "Elektronische Adresse des Verkäufers", cardinality: "0..1",
    source: "EMPLOYEE.MAIL / COMPANY.PEPPOL_ENDPOINT_ID", data: "seller.email / seller.peppolEndpointId",
    cii: `${SELLER}/ram:URIUniversalCommunication/ram:URIID`, ubl: `${U_SELLER}/cbc:EndpointID`,
    note: "Im Peppol-Modus zusätzlich mit EAS-schemeID (z. B. 9930 für DE-USt-IdNr), sonst schemeID=EM." },

  { id: "BT-35", group: "BG-5", labelDe: "Straße/Hausnummer des Verkäufers", cardinality: "0..1",
    source: "INVOICE.COMPANY_STREET / COMPANY.STREET", data: "seller.street",
    cii: `${SELLER}/ram:PostalTradeAddress/ram:LineOne`, ubl: `${U_SELLER}/cac:PostalAddress/cbc:StreetName` },

  { id: "BT-36", group: "BG-5", labelDe: "Adresszusatz des Verkäufers", cardinality: "0..1",
    source: "INVOICE.COMPANY_POST_OFFICE_BOX", data: "seller.postOfficeBox",
    cii: null, ubl: null, status: "loaded-unused",
    note: "Das Postfach wird geladen, aber von keinem Builder ausgegeben (Befund S3)." },

  { id: "BT-37", group: "BG-5", labelDe: "Ort des Verkäufers", cardinality: "0..1",
    source: "INVOICE.COMPANY_CITY / COMPANY.CITY", data: "seller.city",
    cii: `${SELLER}/ram:PostalTradeAddress/ram:CityName`, ubl: `${U_SELLER}/cac:PostalAddress/cbc:CityName` },

  { id: "BT-38", group: "BG-5", labelDe: "Postleitzahl des Verkäufers", cardinality: "0..1",
    source: "INVOICE.COMPANY_POST_CODE / COMPANY.POST_CODE", data: "seller.postCode",
    cii: `${SELLER}/ram:PostalTradeAddress/ram:PostcodeCode`, ubl: `${U_SELLER}/cac:PostalAddress/cbc:PostalZone` },

  { id: "BT-39", group: "BG-5", labelDe: "Region des Verkäufers", cardinality: "0..1",
    source: null, data: null, cii: null, ubl: null, status: "unsupported" },

  { id: "BT-40", group: "BG-5", labelDe: "Ländercode des Verkäufers", cardinality: "1..1",
    source: "COUNTRY.ABBR über COMPANY.COUNTRY_ID", data: "seller.countryId",
    cii: `${SELLER}/ram:PostalTradeAddress/ram:CountryID`,
    ubl: `${U_SELLER}/cac:PostalAddress/cac:Country/cbc:IdentificationCode` },

  { id: "BT-41", group: "BG-6", labelDe: "Ansprechpartner des Verkäufers", cardinality: "0..1",
    source: "INVOICE.EMPLOYEE / EMPLOYEE.FIRST_NAME+LAST_NAME", data: "seller.contactName",
    cii: `${SELLER}/ram:DefinedTradeContact/ram:PersonName`, ubl: `${U_SELLER}/cac:Contact/cbc:Name`,
    note: "Die XRechnung-CIUS macht BG-6 zur Pflichtgruppe; der Validator meldet Fehlen als Fehler (Befund N7)." },

  { id: "BT-42", group: "BG-6", labelDe: "Telefon des Verkäufers", cardinality: "0..1",
    source: "INVOICE.EMPLOYEE_PHONE / EMPLOYEE.MOBILE / EMPLOYEE.PHONE", data: "seller.contactPhone",
    cii: `${SELLER}/ram:DefinedTradeContact/ram:TelephoneUniversalCommunication/ram:CompleteNumber`,
    ubl: `${U_SELLER}/cac:Contact/cbc:Telephone` },

  { id: "BT-43", group: "BG-6", labelDe: "E-Mail des Verkäufers", cardinality: "0..1",
    source: "INVOICE.EMPLOYEE_MAIL / EMPLOYEE.MAIL", data: "seller.contactEmail",
    cii: `${SELLER}/ram:DefinedTradeContact/ram:EmailURIUniversalCommunication/ram:URIID`,
    ubl: `${U_SELLER}/cac:Contact/cbc:ElectronicMail` },

  // ═══ BG-7 Käufer ══════════════════════════════════════════════════════════
  { id: "BT-44", group: "BG-7", labelDe: "Name des Käufers", cardinality: "1..1",
    source: "INVOICE.ADDRESS_NAME_1 / ADDRESS.ADDRESS_NAME_1", data: "buyer.name",
    cii: `${BUYER}/ram:Name`, ubl: `${U_BUYER}/cac:PartyLegalEntity/cbc:RegistrationName` },

  { id: "BT-45", group: "BG-7", labelDe: "Handelsname des Käufers", cardinality: "0..1",
    source: null, data: null, cii: null, ubl: null, status: "unsupported", note: "Siehe BT-28 (Befund S5)." },

  { id: "BT-46", group: "BG-7", labelDe: "Kennung des Käufers", cardinality: "0..1",
    source: "INVOICE.ADDRESS_DEBITOR_NUMBER / ADDRESS.DEBITOR_NUMBER", data: "buyer.debitorNumber",
    cii: null, ubl: null, status: "loaded-unused",
    note: "Die Debitorennummer wird geladen und von keinem Builder ausgegeben (Befund S3). Sie wäre der naheliegende Kandidat, um BR-CO-26 zu entschärfen." },

  { id: "BT-47", group: "BG-7", labelDe: "Registernummer des Käufers", cardinality: "0..1",
    source: null, data: null, cii: null, ubl: null, status: "unsupported" },

  { id: "BT-48", group: "BG-7", labelDe: "Umsatzsteuer-Identifikationsnummer des Käufers", cardinality: "0..1",
    source: "INVOICE.ADDRESS_VAT_ID / ADDRESS.VAT_ID", data: "buyer.vatId",
    cii: `${BUYER}/ram:SpecifiedTaxRegistration/ram:ID`, ubl: `${U_BUYER}/cac:PartyTaxScheme/cbc:CompanyID`,
    discriminator: { cii: 'schemeID="VA"', ubl: "cac:TaxScheme/cbc:ID = VAT" },
    note: "Bei Reverse Charge (AE) und innergemeinschaftlicher Lieferung (K) Pflicht — der Validator prüft das (Befund R7)." },

  { id: "BT-49", group: "BG-7", labelDe: "Elektronische Adresse des Käufers", cardinality: "0..1",
    source: "INVOICE.CONTACT_MAIL / ADDRESS.PEPPOL_ENDPOINT_ID", data: "buyer.email / buyer.peppolEndpointId",
    cii: `${BUYER}/ram:URIUniversalCommunication/ram:URIID`, ubl: `${U_BUYER}/cbc:EndpointID` },

  { id: "BT-50", group: "BG-8", labelDe: "Straße/Hausnummer des Käufers", cardinality: "0..1",
    source: "INVOICE.ADDRESS_STREET / ADDRESS.STREET", data: "buyer.street",
    cii: `${BUYER}/ram:PostalTradeAddress/ram:LineOne`, ubl: `${U_BUYER}/cac:PostalAddress/cbc:StreetName` },

  { id: "BT-51", group: "BG-8", labelDe: "Adresszusatz des Käufers", cardinality: "0..1",
    source: null, data: null, cii: null, ubl: null, status: "unsupported" },

  { id: "BT-52", group: "BG-8", labelDe: "Ort des Käufers", cardinality: "0..1",
    source: "INVOICE.ADDRESS_CITY / ADDRESS.CITY", data: "buyer.city",
    cii: `${BUYER}/ram:PostalTradeAddress/ram:CityName`, ubl: `${U_BUYER}/cac:PostalAddress/cbc:CityName` },

  { id: "BT-53", group: "BG-8", labelDe: "Postleitzahl des Käufers", cardinality: "0..1",
    source: "INVOICE.ADDRESS_POST_CODE / ADDRESS.POST_CODE", data: "buyer.postCode",
    cii: `${BUYER}/ram:PostalTradeAddress/ram:PostcodeCode`, ubl: `${U_BUYER}/cac:PostalAddress/cbc:PostalZone` },

  { id: "BT-54", group: "BG-8", labelDe: "Region des Käufers", cardinality: "0..1",
    source: null, data: null, cii: null, ubl: null, status: "unsupported" },

  { id: "BT-55", group: "BG-8", labelDe: "Ländercode des Käufers", cardinality: "1..1",
    source: "INVOICE.ADDRESS_COUNTRY / COUNTRY.ABBR über ADDRESS.COUNTRY_ID", data: "buyer.countryId",
    cii: `${BUYER}/ram:PostalTradeAddress/ram:CountryID`,
    ubl: `${U_BUYER}/cac:PostalAddress/cac:Country/cbc:IdentificationCode` },

  { id: "BT-56", group: "BG-9", labelDe: "Ansprechpartner des Käufers", cardinality: "0..1",
    source: "INVOICE.CONTACT", data: "buyer.contactName",
    cii: `${BUYER}/ram:DefinedTradeContact/ram:PersonName`, ubl: `${U_BUYER}/cac:Contact/cbc:Name` },

  { id: "BT-57", group: "BG-9", labelDe: "Telefon des Käufers", cardinality: "0..1",
    source: "INVOICE.CONTACT_PHONE", data: "buyer.contactPhone",
    cii: `${BUYER}/ram:DefinedTradeContact/ram:TelephoneUniversalCommunication/ram:CompleteNumber`,
    ubl: `${U_BUYER}/cac:Contact/cbc:Telephone` },

  { id: "BT-58", group: "BG-9", labelDe: "E-Mail des Käufers", cardinality: "0..1",
    source: "INVOICE.CONTACT_MAIL", data: "buyer.contactEmail",
    cii: `${BUYER}/ram:DefinedTradeContact/ram:EmailURIUniversalCommunication/ram:URIID`,
    ubl: `${U_BUYER}/cac:Contact/cbc:ElectronicMail` },

  // ═══ BG-10/BG-11 — nicht unterstützt ══════════════════════════════════════
  { id: "BT-59", group: "BG-10", labelDe: "Name des Zahlungsempfängers", cardinality: "0..1",
    source: null, data: null, cii: null, ubl: null, status: "unsupported",
    note: "Ein abweichender Zahlungsempfänger (Factoring, Abtretung) ist nicht vorgesehen — Zahlungsempfänger ist immer der Verkäufer." },
  { id: "BT-60", group: "BG-10", labelDe: "Kennung des Zahlungsempfängers", cardinality: "0..1",
    source: null, data: null, cii: null, ubl: null, status: "unsupported" },
  { id: "BT-61", group: "BG-10", labelDe: "Registernummer des Zahlungsempfängers", cardinality: "0..1",
    source: null, data: null, cii: null, ubl: null, status: "unsupported" },
  { id: "BT-62", group: "BG-11", labelDe: "Name des Steuervertreters", cardinality: "0..1",
    source: null, data: null, cii: null, ubl: null, status: "unsupported" },
  { id: "BT-63", group: "BG-11", labelDe: "USt-IdNr des Steuervertreters", cardinality: "0..1",
    source: null, data: null, cii: null, ubl: null, status: "unsupported" },

  // ═══ BG-13 Lieferung ══════════════════════════════════════════════════════
  { id: "BT-70", group: "BG-13", labelDe: "Name des Lieferorts", cardinality: "0..1",
    source: null, data: null, cii: null, ubl: null, status: "unsupported" },
  { id: "BT-71", group: "BG-13", labelDe: "Kennung des Lieferorts", cardinality: "0..1",
    source: null, data: null, cii: null, ubl: null, status: "unsupported" },

  { id: "BT-72", group: "BG-13", labelDe: "Tatsächliches Lieferdatum", cardinality: "0..1",
    source: "abgeleitet: BILLING_PERIOD_FINISH, ersatzweise BILLING_PERIOD_START", data: "deliveryDate",
    cii: `${DEL}/ram:ActualDeliverySupplyChainEvent/ram:OccurrenceDateTime/udt:DateTimeString`,
    ubl: `${UBL_ROOT}/cac:Delivery/cbc:ActualDeliveryDate`,
    note: "Kein Rückfall auf das Rechnungsdatum: ohne Leistungszeitraum bleibt die Gruppe leer, statt einen Liefertag zu behaupten (Befund R1)." },

  { id: "BT-73", group: "BG-14", labelDe: "Beginn des Abrechnungszeitraums", cardinality: "0..1",
    source: "INVOICE.BILLING_PERIOD_START", data: "billingPeriodStart",
    cii: `${STL}/ram:BillingSpecifiedPeriod/ram:StartDateTime/udt:DateTimeString`,
    ubl: `${UBL_ROOT}/cac:InvoicePeriod/cbc:StartDate` },

  { id: "BT-74", group: "BG-14", labelDe: "Ende des Abrechnungszeitraums", cardinality: "0..1",
    source: "INVOICE.BILLING_PERIOD_FINISH", data: "billingPeriodEnd",
    cii: `${STL}/ram:BillingSpecifiedPeriod/ram:EndDateTime/udt:DateTimeString`,
    ubl: `${UBL_ROOT}/cac:InvoicePeriod/cbc:EndDate` },

  // ═══ BG-16 Zahlungsanweisungen ════════════════════════════════════════════
  { id: "BT-81", group: "BG-16", labelDe: "Code für die Zahlungsart", cardinality: "0..1",
    source: "PAYMENT_MEANS.ABBR", data: "paymentMeansCode",
    cii: `${STL}/ram:SpecifiedTradeSettlementPaymentMeans/ram:TypeCode`,
    ubl: `${UBL_ROOT}/cac:PaymentMeans/cbc:PaymentMeansCode`,
    note: "Codeliste UNTDID 4461, seit Migration 0163 aus dem globalen Katalog PAYMENT_MEANS. Ausgebbar sind 30 und 58; 59 verlangt BG-19 (Mandat) und wird vom Validator abgewiesen (BR-DE-PM). Der ganze Block hängt weiterhin an der IBAN (Befund N6)." },

  { id: "BT-82", group: "BG-16", labelDe: "Bezeichnung der Zahlungsart", cardinality: "0..1",
    source: "PAYMENT_MEANS.NAME", data: "paymentMeansName",
    cii: `${STL}/ram:SpecifiedTradeSettlementPaymentMeans/ram:Information`,
    ubl: `${UBL_ROOT}/cac:PaymentMeans/cbc:PaymentMeansCode/@name` },

  { id: "BT-83", group: "BG-16", labelDe: "Verwendungszweck", cardinality: "0..1",
    source: "INVOICE.REMITTANCE_INFORMATION", data: "remittanceInformation",
    cii: `${STL}/ram:PaymentReference`, ubl: `${UBL_ROOT}/cac:PaymentMeans/cbc:PaymentID` },

  { id: "BT-84", group: "BG-17", labelDe: "IBAN des Zahlungskontos", cardinality: "1..1",
    source: "INVOICE.COMPANY_IBAN / COMPANY.IBAN", data: "seller.iban",
    cii: `${STL}/ram:SpecifiedTradeSettlementPaymentMeans/ram:PayeePartyCreditorFinancialAccount/ram:IBANID`,
    ubl: `${UBL_ROOT}/cac:PaymentMeans/cac:PayeeFinancialAccount/cbc:ID`,
    note: "Ohne IBAN entsteht gar kein BG-16 — der Validator meldet das als Fehler, nicht als Warnung (Befund N6)." },

  { id: "BT-85", group: "BG-17", labelDe: "Name des Kontoinhabers", cardinality: "0..1",
    source: null, data: null, cii: null, ubl: null, status: "unsupported",
    note: "Kontoinhaber ist implizit der Verkäufer (BT-27); ein abweichender Name wird nicht erfasst." },

  { id: "BT-86", group: "BG-17", labelDe: "BIC des Zahlungsdienstleisters", cardinality: "0..1",
    source: "INVOICE.COMPANY_BIC / COMPANY.BIC", data: "seller.bic",
    cii: `${STL}/ram:SpecifiedTradeSettlementPaymentMeans/ram:PayeeSpecifiedCreditorFinancialInstitution/ram:BICID`,
    ubl: `${UBL_ROOT}/cac:PaymentMeans/cac:PayeeFinancialAccount/cac:FinancialInstitutionBranch/cbc:ID` },

  { id: "BT-89", group: "BG-19", labelDe: "Mandatsreferenz (Lastschrift)", cardinality: "0..1",
    source: null, data: null, cii: null, ubl: null, status: "unsupported",
    note: "Lastschrift wird nicht unterstützt — die Zahlungsart ist fest 58." },

  { id: "BT-90", group: "BG-19", labelDe: "Gläubiger-Identifikationsnummer", cardinality: "0..1",
    source: 'INVOICE."COMPANY_CREDITOR-ID"', data: "seller.creditorId",
    cii: null, ubl: null, status: "loaded-unused",
    note: "Wird geladen und von keinem Builder ausgegeben (Befund S3). Sinnvoll erst mit einer Lastschrift-Zahlungsart." },

  { id: "BT-91", group: "BG-19", labelDe: "Belastetes Konto (Lastschrift)", cardinality: "0..1",
    source: null, data: null, cii: null, ubl: null, status: "unsupported" },

  // ═══ BG-20 Nachlässe auf Dokumentenebene ══════════════════════════════════
  { id: "BT-92", group: "BG-20", labelDe: "Betrag des Nachlasses", cardinality: "1..1",
    source: "INVOICE.DISCOUNT_1 / INVOICE.DISCOUNT_2", data: "allowances[].amount",
    cii: `${STL}/ram:SpecifiedTradeAllowanceCharge/ram:ActualAmount`,
    ubl: `${UBL_ROOT}/cac:AllowanceCharge/cbc:Amount` },

  { id: "BT-93", group: "BG-20", labelDe: "Grundbetrag des Nachlasses", cardinality: "0..1",
    source: "abgeleitet: Betrag / Prozentsatz", data: "allowances[]",
    cii: `${STL}/ram:SpecifiedTradeAllowanceCharge/ram:BasisAmount`,
    ubl: `${UBL_ROOT}/cac:AllowanceCharge/cbc:BaseAmount` },

  { id: "BT-94", group: "BG-20", labelDe: "Prozentsatz des Nachlasses", cardinality: "0..1",
    source: "INVOICE.DISCOUNT_1_PERCENT / DISCOUNT_2_PERCENT", data: "allowances[].percent",
    cii: `${STL}/ram:SpecifiedTradeAllowanceCharge/ram:CalculationPercent`,
    ubl: `${UBL_ROOT}/cac:AllowanceCharge/cbc:MultiplierFactorNumeric` },

  { id: "BT-95", group: "BG-20", labelDe: "Umsatzsteuerkategorie des Nachlasses", cardinality: "1..1",
    source: "abgeleitet: Kategorie des Belegs", data: "vatBreakdown[0].category",
    cii: `${STL}/ram:SpecifiedTradeAllowanceCharge/ram:CategoryTradeTax/ram:CategoryCode`,
    ubl: `${UBL_ROOT}/cac:AllowanceCharge/cac:TaxCategory/cbc:ID` },

  { id: "BT-96", group: "BG-20", labelDe: "Umsatzsteuersatz des Nachlasses", cardinality: "0..1",
    source: "abgeleitet: Satz des Belegs", data: "vatBreakdown[0].rate",
    cii: `${STL}/ram:SpecifiedTradeAllowanceCharge/ram:CategoryTradeTax/ram:RateApplicablePercent`,
    ubl: `${UBL_ROOT}/cac:AllowanceCharge/cac:TaxCategory/cbc:Percent` },

  { id: "BT-97", group: "BG-20", labelDe: "Grund des Nachlasses", cardinality: "0..1",
    source: "INVOICE.DISCOUNT_1_REASON / DISCOUNT_2_REASON", data: "allowances[].reason",
    cii: `${STL}/ram:SpecifiedTradeAllowanceCharge/ram:Reason`,
    ubl: `${UBL_ROOT}/cac:AllowanceCharge/cbc:AllowanceChargeReason` },

  { id: "BT-98", group: "BG-20", labelDe: "Code für den Grund des Nachlasses", cardinality: "0..1",
    source: "fest: 95 (Rabatt)", data: null,
    cii: `${STL}/ram:SpecifiedTradeAllowanceCharge/ram:ReasonCode`,
    ubl: `${UBL_ROOT}/cac:AllowanceCharge/cbc:AllowanceChargeReasonCode` },

  // ═══ BG-21 Zuschläge — nicht unterstützt ══════════════════════════════════
  { id: "BT-99",  group: "BG-21", labelDe: "Betrag des Zuschlags", cardinality: "1..1",
    source: null, data: null, cii: null, ubl: null, status: "unsupported",
    note: "Zuschläge auf Dokumentenebene gibt es im Datenmodell nicht; BT-108 wird deshalb immer 0 ausgegeben." },
  { id: "BT-100", group: "BG-21", labelDe: "Grundbetrag des Zuschlags", cardinality: "0..1",
    source: null, data: null, cii: null, ubl: null, status: "unsupported" },
  { id: "BT-101", group: "BG-21", labelDe: "Prozentsatz des Zuschlags", cardinality: "0..1",
    source: null, data: null, cii: null, ubl: null, status: "unsupported" },
  { id: "BT-102", group: "BG-21", labelDe: "Umsatzsteuerkategorie des Zuschlags", cardinality: "1..1",
    source: null, data: null, cii: null, ubl: null, status: "unsupported" },
  { id: "BT-103", group: "BG-21", labelDe: "Umsatzsteuersatz des Zuschlags", cardinality: "0..1",
    source: null, data: null, cii: null, ubl: null, status: "unsupported" },
  { id: "BT-104", group: "BG-21", labelDe: "Grund des Zuschlags", cardinality: "0..1",
    source: null, data: null, cii: null, ubl: null, status: "unsupported" },
  { id: "BT-105", group: "BG-21", labelDe: "Code für den Grund des Zuschlags", cardinality: "0..1",
    source: null, data: null, cii: null, ubl: null, status: "unsupported" },

  // ═══ BG-22 Gesamtbeträge ══════════════════════════════════════════════════
  { id: "BT-106", group: "BG-22", labelDe: "Summe der Positionsbeträge (netto)", cardinality: "1..1",
    source: "abgeleitet: Summe der Positionen", data: "totals.lineTotal",
    cii: `${SUM}/ram:LineTotalAmount`, ubl: `${U_TOTAL}/cbc:LineExtensionAmount` },

  { id: "BT-107", group: "BG-22", labelDe: "Summe der Nachlässe (netto)", cardinality: "0..1",
    source: "abgeleitet: Summe DISCOUNT_1 + DISCOUNT_2", data: "totals.allowanceTotal",
    cii: `${SUM}/ram:AllowanceTotalAmount`, ubl: `${U_TOTAL}/cbc:AllowanceTotalAmount` },

  { id: "BT-108", group: "BG-22", labelDe: "Summe der Zuschläge (netto)", cardinality: "0..1",
    source: "fest: 0", data: "totals.chargeTotal",
    cii: `${SUM}/ram:ChargeTotalAmount`, ubl: `${U_TOTAL}/cbc:ChargeTotalAmount`,
    note: "Immer 0 — siehe BG-21." },

  { id: "BT-109", group: "BG-22", labelDe: "Gesamtbetrag ohne Umsatzsteuer", cardinality: "1..1",
    source: "INVOICE.TOTAL_AMOUNT_NET", data: "totals.taxBasis",
    cii: `${SUM}/ram:TaxBasisTotalAmount`, ubl: `${U_TOTAL}/cbc:TaxExclusiveAmount`,
    note: "Gespeicherter Wert schlägt die Berechnung — eine gespeicherte 0 ist eine Aussage, kein fehlender Wert (Befund R9)." },

  { id: "BT-110", group: "BG-22", labelDe: "Gesamtbetrag der Umsatzsteuer", cardinality: "0..1",
    source: "INVOICE.TAX_AMOUNT_NET", data: "totals.taxAmount",
    cii: `${SUM}/ram:TaxTotalAmount`, ubl: `${UBL_ROOT}/cac:TaxTotal/cbc:TaxAmount` },

  { id: "BT-111", group: "BG-22", labelDe: "Umsatzsteuerbetrag in Buchungswährung", cardinality: "0..1",
    source: null, data: null, cii: null, ubl: null, status: "unsupported", note: "Siehe BT-6." },

  { id: "BT-112", group: "BG-22", labelDe: "Gesamtbetrag mit Umsatzsteuer", cardinality: "1..1",
    source: "INVOICE.TOTAL_AMOUNT_GROSS", data: "totals.grandTotal",
    cii: `${SUM}/ram:GrandTotalAmount`, ubl: `${U_TOTAL}/cbc:TaxInclusiveAmount` },

  { id: "BT-113", group: "BG-22", labelDe: "Bereits gezahlter Betrag", cardinality: "0..1",
    source: "abgeleitet: Summe der VEREINNAHMTEN Abschläge (brutto abzüglich Einbehalt)",
    data: "totals.prepaidGross",
    cii: `${SUM}/ram:TotalPrepaidAmount`, ubl: `${U_TOTAL}/cbc:PrepaidAmount`,
    note: "Maßgeblich ist das Vereinnahmte, nicht das Fakturierte: § 14 Abs. 5 UStG verlangt den Abzug der vereinnahmten Teilentgelte. Der Sicherheitseinbehalt war nie gezahlt und zählt deshalb nicht mit (Befund N10)." },

  { id: "BT-114", group: "BG-22", labelDe: "Rundungsbetrag", cardinality: "0..1",
    source: null, data: null, cii: null, ubl: null, status: "unsupported" },

  { id: "BT-115", group: "BG-22", labelDe: "Fälliger Zahlungsbetrag", cardinality: "1..1",
    source: "abgeleitet: BT-112 − BT-113", data: "totals.duePayable",
    cii: `${SUM}/ram:DuePayableAmount`, ubl: `${U_TOTAL}/cbc:PayableAmount`,
    note: "Der Sicherheitseinbehalt wird hier NICHT abgezogen — er ist eine Zahlungsmodalität, keine Rechnungsgröße, und ein Abzug verletzt BR-CO-16. Er steht als Hinweis mit Betreffcode PMT im Dokument (Befund N10)." },

  // ═══ BG-23 Aufschlüsselung der Umsatzsteuer ═══════════════════════════════
  { id: "BT-116", group: "BG-23", labelDe: "Steuerbasisbetrag je Kategorie", cardinality: "1..1",
    source: "INVOICE.TOTAL_AMOUNT_NET", data: "vatBreakdown[].basis",
    cii: `${STL}/ram:ApplicableTradeTax/ram:BasisAmount`,
    ubl: `${UBL_ROOT}/cac:TaxTotal/cac:TaxSubtotal/cbc:TaxableAmount` },

  { id: "BT-117", group: "BG-23", labelDe: "Steuerbetrag je Kategorie", cardinality: "1..1",
    source: "INVOICE.TAX_AMOUNT_NET", data: "vatBreakdown[].amount",
    cii: `${STL}/ram:ApplicableTradeTax/ram:CalculatedAmount`,
    ubl: `${UBL_ROOT}/cac:TaxTotal/cac:TaxSubtotal/cbc:TaxAmount` },

  { id: "BT-118", group: "BG-23", labelDe: "Code der Umsatzsteuerkategorie", cardinality: "1..1",
    source: "INVOICE.VAT_CATEGORY", data: "vatBreakdown[].category",
    cii: `${STL}/ram:ApplicableTradeTax/ram:CategoryCode`,
    ubl: `${UBL_ROOT}/cac:TaxTotal/cac:TaxSubtotal/cac:TaxCategory/cbc:ID`,
    note: "Codeliste UNTDID 5305 — zulässige Werte und Regeln je Kategorie in codelists.js." },

  { id: "BT-119", group: "BG-23", labelDe: "Umsatzsteuersatz je Kategorie", cardinality: "0..1",
    source: "INVOICE.VAT_PERCENT", data: "vatBreakdown[].rate",
    cii: `${STL}/ram:ApplicableTradeTax/ram:RateApplicablePercent`,
    ubl: `${UBL_ROOT}/cac:TaxTotal/cac:TaxSubtotal/cac:TaxCategory/cbc:Percent`,
    note: "Bei jeder Kategorie außer S zwingend 0 — der gespeicherte Satz wird dann überschrieben." },

  { id: "BT-120", group: "BG-23", labelDe: "Grund der Steuerbefreiung (Text)", cardinality: "0..1",
    source: "INVOICE.VAT_EXEMPTION_REASON_TEXT, ersatzweise Standardtext je Kategorie",
    data: "vatBreakdown[].exemptionReasonText",
    cii: `${STL}/ram:ApplicableTradeTax/ram:ExemptionReason`,
    ubl: `${UBL_ROOT}/cac:TaxTotal/cac:TaxSubtotal/cac:TaxCategory/cbc:TaxExemptionReason`,
    note: "Standardtexte stehen in codelists.UNTDID_5305 — eine Stelle, nicht zwei." },

  { id: "BT-121", group: "BG-23", labelDe: "Code für den Grund der Steuerbefreiung", cardinality: "0..1",
    source: "INVOICE.VAT_EXEMPTION_REASON_CODE", data: "vatBreakdown[].exemptionReasonCode",
    cii: `${STL}/ram:ApplicableTradeTax/ram:ExemptionReasonCode`,
    ubl: `${UBL_ROOT}/cac:TaxTotal/cac:TaxSubtotal/cac:TaxCategory/cbc:TaxExemptionReasonCode` },

  // ═══ BG-24 Anlagen ════════════════════════════════════════════════════════
  { id: "BT-122", group: "BG-24", labelDe: "Kennung der Anlage", cardinality: "1..1",
    source: "EINVOICE_ATTACHMENT.DOCUMENT_REFERENCE", data: "attachments[].documentReference",
    cii: `${AGR}/ram:AdditionalReferencedDocument/ram:IssuerAssignedID`,
    ubl: `${UBL_ROOT}/cac:AdditionalDocumentReference/cbc:ID` },

  { id: "BT-123", group: "BG-24", labelDe: "Beschreibung der Anlage", cardinality: "0..1",
    source: "EINVOICE_ATTACHMENT.DESCRIPTION", data: "attachments[].description",
    cii: `${AGR}/ram:AdditionalReferencedDocument/ram:Name`,
    ubl: `${UBL_ROOT}/cac:AdditionalDocumentReference/cbc:DocumentDescription` },

  { id: "BT-125", group: "BG-24", labelDe: "Eingebetteter Anlageninhalt", cardinality: "0..1",
    source: "EINVOICE_ATTACHMENT (Objektspeicher, base64)", data: "attachments[].base64",
    cii: `${AGR}/ram:AdditionalReferencedDocument/ram:AttachmentBinaryObject`,
    ubl: `${UBL_ROOT}/cac:AdditionalDocumentReference/cac:Attachment/cbc:EmbeddedDocumentBinaryObject`,
    note: "Dateiname und MIME-Typ stehen als Attribute (filename, mimeCode) am selben Element. Anlagen ohne Inhalt werden ausgelassen statt als literal 'undefined' geschrieben (Befund R5). Der Vorgabewert application/octet-stream ist weiterhin offen — BT-125 ist codelistenbeschränkt." },

  { id: "BT-124", group: "BG-24", labelDe: "Externer Verweis auf die Anlage (URI)", cardinality: "0..1",
    source: null, data: null, cii: null, ubl: null, status: "unsupported",
    note: "Anlagen werden eingebettet, nicht verlinkt — ein Link wäre für den Empfänger nicht dauerhaft erreichbar." },

  // ═══ BG-25 Rechnungsposition ══════════════════════════════════════════════
  { id: "BT-126", group: "BG-25", labelDe: "Kennung der Position", cardinality: "1..1",
    source: "abgeleitet: laufende Nummer", data: "lines[].id",
    cii: `${LINE}/ram:AssociatedDocumentLineDocument/ram:LineID`, ubl: `${U_LINE}/cbc:ID` },

  { id: "BT-127", group: "BG-25", labelDe: "Anmerkung zur Position", cardinality: "0..1",
    source: "abgeleitet: Nebenkosten bzw. Stundenzahl und Satz", data: "lines[].note",
    cii: `${LINE}/ram:AssociatedDocumentLineDocument/ram:IncludedNote/ram:Content`, ubl: `${U_LINE}/cbc:Note` },

  { id: "BT-128", group: "BG-25", labelDe: "Objektkennung der Position", cardinality: "0..1",
    source: null, data: null, cii: null, ubl: null, status: "unsupported" },

  { id: "BT-129", group: "BG-25", labelDe: "Menge der Position", cardinality: "1..1",
    source: "abgeleitet: 1 (Pauschal) bzw. Summe BOOKING.QUANTITY_INT (Stunden)", data: "lines[].quantity",
    cii: `${LINE}/ram:SpecifiedLineTradeDelivery/ram:BilledQuantity`, ubl: `${U_LINE}/cbc:InvoicedQuantity`,
    note: "Bei Storno wird die MENGE negativ, nicht der Einzelpreis — BR-27 verbietet negative Einzelpreise (Befund N3)." },

  { id: "BT-130", group: "BG-25", labelDe: "Code der Mengeneinheit", cardinality: "1..1",
    source: "abgeleitet: HUR bei Stundenpositionen, sonst LS", data: "lines[].unitCode",
    cii: `${LINE}/ram:SpecifiedLineTradeDelivery/ram:BilledQuantity`, ubl: `${U_LINE}/cbc:InvoicedQuantity`,
    attr: "unitCode",
    note: "Codeliste UN/ECE Rec. 20. Buchungsarten ohne Stundencharakter (UNIT, LUMP_*) erzwingen LS — eine HUR-Position wäre dort irreführend." },

  { id: "BT-131", group: "BG-25", labelDe: "Nettobetrag der Position", cardinality: "1..1",
    source: "INVOICE_STRUCTURE.AMOUNT_NET + AMOUNT_EXTRAS_NET", data: "lines[].lineTotal",
    cii: `${LINE}/ram:SpecifiedLineTradeSettlement/ram:SpecifiedTradeSettlementLineMonetarySummation/ram:LineTotalAmount`,
    ubl: `${U_LINE}/cbc:LineExtensionAmount` },

  { id: "BT-132", group: "BG-25", labelDe: "Referenz auf die Bestellposition", cardinality: "0..1",
    source: null, data: null, cii: null, ubl: null, status: "unsupported" },
  { id: "BT-133", group: "BG-25", labelDe: "Buchungsreferenz der Position", cardinality: "0..1",
    source: null, data: null, cii: null, ubl: null, status: "unsupported" },

  { id: "BT-134", group: "BG-26", labelDe: "Beginn des Leistungszeitraums der Position", cardinality: "0..1",
    source: "INVOICE.BILLING_PERIOD_START", data: "lines[].billingPeriodStart",
    cii: `${LINE}/ram:SpecifiedLineTradeSettlement/ram:BillingSpecifiedPeriod/ram:StartDateTime/udt:DateTimeString`,
    ubl: `${U_LINE}/cac:InvoicePeriod/cbc:StartDate` },

  { id: "BT-135", group: "BG-26", labelDe: "Ende des Leistungszeitraums der Position", cardinality: "0..1",
    source: "INVOICE.BILLING_PERIOD_FINISH", data: "lines[].billingPeriodEnd",
    cii: `${LINE}/ram:SpecifiedLineTradeSettlement/ram:BillingSpecifiedPeriod/ram:EndDateTime/udt:DateTimeString`,
    ubl: `${U_LINE}/cac:InvoicePeriod/cbc:EndDate` },

  { id: "BT-136", group: "BG-27", labelDe: "Betrag des Positionsnachlasses", cardinality: "1..1",
    source: null, data: null, cii: null, ubl: null, status: "unsupported",
    note: "Nachlässe auf Positionsebene gibt es im Datenmodell nicht — Nachlässe liegen auf Dokumentenebene (BG-20)." },
  { id: "BT-137", group: "BG-27", labelDe: "Grundbetrag des Positionsnachlasses", cardinality: "0..1",
    source: null, data: null, cii: null, ubl: null, status: "unsupported" },
  { id: "BT-138", group: "BG-27", labelDe: "Prozentsatz des Positionsnachlasses", cardinality: "0..1",
    source: null, data: null, cii: null, ubl: null, status: "unsupported" },
  { id: "BT-139", group: "BG-27", labelDe: "Grund des Positionsnachlasses", cardinality: "0..1",
    source: null, data: null, cii: null, ubl: null, status: "unsupported" },
  { id: "BT-140", group: "BG-27", labelDe: "Code für den Grund des Positionsnachlasses", cardinality: "0..1",
    source: null, data: null, cii: null, ubl: null, status: "unsupported" },
  { id: "BT-141", group: "BG-28", labelDe: "Betrag des Positionszuschlags", cardinality: "1..1",
    source: null, data: null, cii: null, ubl: null, status: "unsupported" },
  { id: "BT-142", group: "BG-28", labelDe: "Grundbetrag des Positionszuschlags", cardinality: "0..1",
    source: null, data: null, cii: null, ubl: null, status: "unsupported" },
  { id: "BT-143", group: "BG-28", labelDe: "Prozentsatz des Positionszuschlags", cardinality: "0..1",
    source: null, data: null, cii: null, ubl: null, status: "unsupported" },
  { id: "BT-144", group: "BG-28", labelDe: "Grund des Positionszuschlags", cardinality: "0..1",
    source: null, data: null, cii: null, ubl: null, status: "unsupported" },
  { id: "BT-145", group: "BG-28", labelDe: "Code für den Grund des Positionszuschlags", cardinality: "0..1",
    source: null, data: null, cii: null, ubl: null, status: "unsupported" },

  { id: "BT-146", group: "BG-29", labelDe: "Einzelpreis (netto)", cardinality: "1..1",
    source: "abgeleitet: Positionsbetrag / Menge", data: "lines[].unitPrice",
    cii: `${LINE}/ram:SpecifiedLineTradeAgreement/ram:NetPriceProductTradePrice/ram:ChargeAmount`,
    ubl: `${U_LINE}/cac:Price/cbc:PriceAmount`,
    note: "Darf nach BR-27 nie negativ sein — auch beim Storno nicht (Befund N3)." },

  { id: "BT-147", group: "BG-29", labelDe: "Nachlass auf den Einzelpreis", cardinality: "0..1",
    source: null, data: null, cii: null, ubl: null, status: "unsupported" },
  { id: "BT-148", group: "BG-29", labelDe: "Listenpreis (brutto)", cardinality: "0..1",
    source: null, data: null, cii: null, ubl: null, status: "unsupported" },

  { id: "BT-149", group: "BG-29", labelDe: "Basismenge zum Einzelpreis", cardinality: "0..1",
    source: "fest: 1", data: null,
    cii: `${LINE}/ram:SpecifiedLineTradeAgreement/ram:NetPriceProductTradePrice/ram:BasisQuantity`,
    ubl: `${U_LINE}/cac:Price/cbc:BaseQuantity`,
    note: "Fest 1, nicht die Rechnungsmenge — sonst wäre Einzelpreis × Basismenge nicht der Positionsbetrag (Befund N4)." },

  { id: "BT-150", group: "BG-29", labelDe: "Code der Einheit zur Basismenge", cardinality: "0..1",
    source: "abgeleitet: wie BT-130", data: "lines[].unitCode",
    cii: `${LINE}/ram:SpecifiedLineTradeAgreement/ram:NetPriceProductTradePrice/ram:BasisQuantity`,
    ubl: `${U_LINE}/cac:Price/cbc:BaseQuantity`, attr: "unitCode" },

  { id: "BT-151", group: "BG-30", labelDe: "Umsatzsteuerkategorie der Position", cardinality: "1..1",
    source: "INVOICE.VAT_CATEGORY", data: "lines[].vatCategory",
    cii: `${LINE}/ram:SpecifiedLineTradeSettlement/ram:ApplicableTradeTax/ram:CategoryCode`,
    ubl: `${U_LINE}/cac:Item/cac:ClassifiedTaxCategory/cbc:ID` },

  { id: "BT-152", group: "BG-30", labelDe: "Umsatzsteuersatz der Position", cardinality: "0..1",
    source: "INVOICE.VAT_PERCENT", data: "lines[].vatRate",
    cii: `${LINE}/ram:SpecifiedLineTradeSettlement/ram:ApplicableTradeTax/ram:RateApplicablePercent`,
    ubl: `${U_LINE}/cac:Item/cac:ClassifiedTaxCategory/cbc:Percent` },

  { id: "BT-153", group: "BG-31", labelDe: "Bezeichnung des Artikels", cardinality: "1..1",
    source: "PROJECT_STRUCTURE.ABBR + NAME", data: "lines[].description",
    cii: `${LINE}/ram:SpecifiedTradeProduct/ram:Name`, ubl: `${U_LINE}/cac:Item/cbc:Name` },

  { id: "BT-154", group: "BG-31", labelDe: "Beschreibung des Artikels", cardinality: "0..1",
    source: null, data: null, cii: null, ubl: null, status: "unsupported",
    note: "Erläuterungen stehen in BT-127 (Positionsanmerkung)." },
  { id: "BT-155", group: "BG-31", labelDe: "Artikelnummer des Verkäufers", cardinality: "0..1",
    source: null, data: null, cii: null, ubl: null, status: "unsupported" },
  { id: "BT-156", group: "BG-31", labelDe: "Artikelnummer des Käufers", cardinality: "0..1",
    source: null, data: null, cii: null, ubl: null, status: "unsupported" },
  { id: "BT-157", group: "BG-31", labelDe: "Internationale Artikelnummer", cardinality: "0..1",
    source: null, data: null, cii: null, ubl: null, status: "unsupported" },
  { id: "BT-158", group: "BG-31", labelDe: "Klassifizierung des Artikels", cardinality: "0..n",
    source: null, data: null, cii: null, ubl: null, status: "unsupported" },
  { id: "BT-159", group: "BG-31", labelDe: "Ursprungsland des Artikels", cardinality: "0..1",
    source: null, data: null, cii: null, ubl: null, status: "unsupported" },
  { id: "BT-160", group: "BG-31", labelDe: "Merkmalsname des Artikels", cardinality: "0..n",
    source: null, data: null, cii: null, ubl: null, status: "unsupported" },
  { id: "BT-161", group: "BG-31", labelDe: "Merkmalswert des Artikels", cardinality: "0..n",
    source: null, data: null, cii: null, ubl: null, status: "unsupported" },
];

// ── Strukturelemente ohne eigenen Business Term ──────────────────────────────
//
// Die Gegenprobe („jedes Element im XML gehört zu einer Registry-Zeile")
// braucht eine Liste der Elemente, die die Syntax verlangt, die aber kein
// Feld der EN 16931 tragen. Sie ist bewusst kurz und bewusst begründet — wer
// hier etwas einträgt, statt eine Registry-Zeile anzulegen, muss sagen warum.

const STRUCTURAL_PATHS = [
  { path: `${LINE}/ram:SpecifiedLineTradeSettlement/ram:ApplicableTradeTax/ram:TypeCode`,
    reason: "Fest 'VAT' — benennt das Steuerschema, nicht einen Wert des Belegs." },
  { path: `${STL}/ram:ApplicableTradeTax/ram:TypeCode`,
    reason: "Fest 'VAT' — siehe oben." },
  { path: `${STL}/ram:SpecifiedTradeAllowanceCharge/ram:CategoryTradeTax/ram:TypeCode`,
    reason: "Fest 'VAT' — siehe oben." },
  { path: `${STL}/ram:SpecifiedTradeAllowanceCharge/ram:ChargeIndicator/udt:Indicator`,
    reason: "Unterscheidet Nachlass (false, BG-20) von Zuschlag (true, BG-21); kein eigener BT." },
  { path: `${AGR}/ram:AdditionalReferencedDocument/ram:TypeCode`,
    reason: "Fest '916' (zugehöriges Dokument) — von der CII-Syntax verlangt, in der EN 16931 kein BT." },
  { path: `${AGR}/ram:SpecifiedProcuringProject/ram:Name`,
    reason: "Die CII-Syntax verlangt neben der Projekt-ID einen Namen; wir spiegeln die Projektnummer aus BT-11." },
  { path: `${STL}/ram:SpecifiedTradePaymentTerms/ram:ApplicableTradePaymentDiscountTerms/ram:BasisPeriodMeasure`,
    reason: "Strukturierte Skontofrist. Das Skonto selbst trägt BT-20 als KoSIT-Konvention; CII führt es zusätzlich maschinenlesbar." },
  { path: `${STL}/ram:SpecifiedTradePaymentTerms/ram:ApplicableTradePaymentDiscountTerms/ram:CalculationPercent`,
    reason: "Siehe BasisPeriodMeasure." },

  { path: `${UBL_ROOT}/cac:AllowanceCharge/cbc:ChargeIndicator`,
    reason: "Gegenstück zu ram:ChargeIndicator — Nachlass (false) statt Zuschlag." },
  { path: `${UBL_ROOT}/cac:AllowanceCharge/cac:TaxCategory/cac:TaxScheme/cbc:ID`,
    reason: "Fest 'VAT' — benennt das Steuerschema." },
  { path: `${UBL_ROOT}/cac:TaxTotal/cac:TaxSubtotal/cac:TaxCategory/cac:TaxScheme/cbc:ID`,
    reason: "Fest 'VAT' — siehe oben." },
  { path: `${U_LINE}/cac:Item/cac:ClassifiedTaxCategory/cac:TaxScheme/cbc:ID`,
    reason: "Fest 'VAT' — siehe oben." },
  { path: `${U_SELLER}/cac:PartyTaxScheme/cac:TaxScheme/cbc:ID`,
    reason: "Unterscheidet USt-IdNr (VAT, BT-31) von Steuernummer (FC, BT-32)." },
  { path: `${U_BUYER}/cac:PartyTaxScheme/cac:TaxScheme/cbc:ID`,
    reason: "Wie beim Verkäufer — hier immer VAT (BT-48)." },
];

// ── Zugriff ──────────────────────────────────────────────────────────────────

/** Eintrag mit gefüllten Vorgabewerten. */
function normalize(e) {
  return {
    status: e.cii || e.ubl ? "emitted" : "unsupported",
    group: null, cardinality: "0..1", source: null, data: null,
    cii: null, ubl: null, attr: null, discriminator: null, note: null,
    ...e,
  };
}

const ALL = ENTRIES.map(normalize);
const BY_ID = new Map(ALL.map((e) => [e.id, e]));

const all = () => ALL.slice();
const get = (id) => BY_ID.get(String(id)) || null;
const has = (id) => BY_ID.has(String(id));
const emitted = () => ALL.filter((e) => e.status === "emitted");
const structuralPaths = () => STRUCTURAL_PATHS.slice();

/** Nummerischer Anteil einer BT-Kennung, für die Sortierung. */
const btNumber = (id) => Number(String(id).replace(/^BT-/, "")) || 0;

/** Zählwerk für die Doku: wie viel der Norm bedienen wir? */
function coverage() {
  const c = { emitted: 0, "loaded-unused": 0, unsupported: 0, total: ALL.length };
  for (const e of ALL) c[e.status] += 1;
  return c;
}

module.exports = {
  GROUPS, STATUSES,
  all, get, has, emitted, structuralPaths, coverage, btNumber,
  CII_ROOT, UBL_ROOT,
};
