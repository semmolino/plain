# E-Rechnung — Feld-Mapping (EN 16931)

> **Erzeugte Datei — nicht von Hand bearbeiten.**
> Quelle: `backend/einvoice/btRegistry.js`. Neu erzeugen mit `npm run einvoice:gen`
> (aus `backend/`). `npm run einvoice:check` und der Jest-Test
> `tests/einvoice_mapping.test.js` halten beides gegen das tatsächlich erzeugte XML.

Diese Tabelle ersetzt die frühere `backend/config/Mapping BT.xlsx`. Der Unterschied
ist nicht das Format: die Excel *behauptete* ein Mapping, diese Tabelle wird aus dem
Code abgeleitet und gegen zwei Musterbelege geprüft — vorwärts (jede Zeile muss im
XML vorkommen) **und** rückwärts (jedes XML-Element muss eine Zeile haben).

## Abdeckung

| Zustand | Felder |
|---|---:|
| ✅ ausgegeben | 83 |
| ⚠️ geladen, aber von keinem Builder ausgegeben | 3 |
| — bewusst nicht unterstützt | 60 |
| **katalogisiert insgesamt** | **146** |

## Erzeugte Formate

| Syntax | Kennung |
|---|---|
| CII · Factur-X MINIMUM | `urn:factur-x.eu:1p0:minimum` |
| CII · Factur-X BASIC WL (ohne Positionen) | `urn:factur-x.eu:1p0:basicwl` |
| CII · Factur-X BASIC | `urn:factur-x.eu:1p0:basic` |
| CII · EN 16931 (COMFORT) | `urn:cen.eu:en16931:2017` |
| CII · Factur-X EXTENDED *(Vorgabe)* | `urn:cen.eu:en16931:2017#conformant#urn:factur-x.eu:1p0:extended` |
| UBL · XRechnung 3.0 (UBL) | `urn:cen.eu:en16931:2017#compliant#urn:xeinkauf.de:kosit:xrechnung_3.0` |
| UBL · Peppol BIS Billing 3.0 | `urn:cen.eu:en16931:2017#compliant#urn:fdc:peppol.eu:2017:poacc:billing:3.0` |

## Felder

Pfade sind gekürzt: `…/` steht im CII für
`rsm:CrossIndustryInvoice/rsm:SupplyChainTradeTransaction/`, im UBL entfällt das
führende `Invoice/`. Die vollständigen Pfade stehen in der Registry.

### Dokumentebene

| BT | Bezeichnung | Kard. | Herkunft (DB) | CII | UBL | Status |
|---|---|---|---|---|---|---|
| BT-1 | Rechnungsnummer | 1..1 | INVOICE.INVOICE_NUMBER / ADVANCE_INVOICE.ADVANCE_INVOICE_NUMBER | `…/rsm:ExchangedDocument/ram:ID` | `cbc:ID` | ✅ ausgegeben |
| BT-2 | Rechnungsdatum | 1..1 | INVOICE.INVOICE_DATE / ADVANCE_INVOICE.ADVANCE_INVOICE_DATE | `…/rsm:ExchangedDocument/ram:IssueDateTime/udt:DateTimeString` | `cbc:IssueDate` | ✅ ausgegeben |
| BT-3 | Code für den Rechnungstyp | 1..1 | abgeleitet: docType + INVOICE.INVOICE_TYPE + CANCELS_*_ID | `…/rsm:ExchangedDocument/ram:TypeCode` | `cbc:InvoiceTypeCode` | ✅ ausgegeben |
| BT-5 | Code für die Rechnungswährung | 1..1 | CURRENCY.ABBR über INVOICE.CURRENCY_ID | `…/ram:ApplicableHeaderTradeSettlement/ram:InvoiceCurrencyCode` | `cbc:DocumentCurrencyCode` | ✅ ausgegeben |
| BT-6 | Code der Währung für die Umsatzsteuerbuchung | 0..1 | — | — | — | — nicht unterstützt |
| BT-7 | Datum der Steuerfälligkeit | 0..1 | — | — | — | — nicht unterstützt |
| BT-8 | Code für das Datum der Steuerfälligkeit | 0..1 | — | — | — | — nicht unterstützt |
| BT-9 | Fälligkeitsdatum der Zahlung | 0..1 | INVOICE.DUE_DATE / ADVANCE_INVOICE.DUE_DATE | `…/ram:ApplicableHeaderTradeSettlement/ram:SpecifiedTradePaymentTerms/ram:DueDateDateTime/udt:DateTimeString` | `cbc:DueDate` | ✅ ausgegeben |
| BT-10 | Käuferreferenz (Leitweg-ID) | 0..1 | INVOICE.BUYER_REFERENCE / ADDRESS.ADDRESS_REFERENCE_NUMBER | `…/ram:ApplicableHeaderTradeAgreement/ram:BuyerReference` | `cbc:BuyerReference` | ✅ ausgegeben |
| BT-11 | Projektreferenz | 0..1 | PROJECT.PROJECT_NUMBER / PROJECT.ABBR über INVOICE.PROJECT_ID | `…/ram:ApplicableHeaderTradeAgreement/ram:SpecifiedProcuringProject/ram:ID` | `cac:ProjectReference/cbc:ID` | ✅ ausgegeben |
| BT-12 | Vertragsnummer | 0..1 | CONTRACT.CONTRACT_NUMBER über INVOICE.CONTRACT_ID | `…/ram:ApplicableHeaderTradeAgreement/ram:ContractReferencedDocument/ram:IssuerAssignedID` | `cac:ContractDocumentReference/cbc:ID` | ✅ ausgegeben |
| BT-13 | Bestellnummer | 0..1 | INVOICE.BUYER_ORDER_REFERENCE | `…/ram:ApplicableHeaderTradeAgreement/ram:BuyerOrderReferencedDocument/ram:IssuerAssignedID` | `cac:OrderReference/cbc:ID` | ✅ ausgegeben |
| BT-14 | Auftragsnummer | 0..1 | — | — | — | — nicht unterstützt |
| BT-15 | Referenz auf die Empfangsbestätigung | 0..1 | — | — | — | — nicht unterstützt |
| BT-16 | Referenz auf die Versandanzeige | 0..1 | — | — | — | — nicht unterstützt |
| BT-17 | Referenz auf die Ausschreibung | 0..1 | — | — | — | — nicht unterstützt |
| BT-18 | Objektkennung | 0..1 | — | — | — | — nicht unterstützt |
| BT-19 | Buchungsreferenz des Käufers | 0..1 | INVOICE.BUYER_ACCOUNTING_REFERENCE | `…/ram:ApplicableHeaderTradeSettlement/ram:ReceivableSpecifiedTradeAccountingAccount/ram:ID` | `cbc:AccountingCost` | ✅ ausgegeben |
| BT-20 | Zahlungsbedingungen | 0..1 | abgeleitet: DUE_DATE + CASH_DISCOUNT_PERCENT/-DAYS | `…/ram:ApplicableHeaderTradeSettlement/ram:SpecifiedTradePaymentTerms/ram:Description` | `cac:PaymentTerms/cbc:Note` | ✅ ausgegeben |

- **BT-3** — Codeliste UNTDID 1001, gebildet in codelists.documentTypeCode(). CII nutzt die Bau-Codes 875/876/877, UBL 326/380.
- **BT-6** — Abweichende Buchungswährung wird nicht unterstützt — plan&simple rechnet in Belegwährung.
- **BT-7** — Ist-Versteuerung wird nicht abgebildet; das Rechnungsdatum (BT-2) gilt.
- **BT-8** — Siehe BT-7.
- **BT-10** — Bei öffentlichen Auftraggebern Pflicht (B2G); der Validator warnt unter BR-DE-15. Leer wird das Element weggelassen, nicht leer geschrieben (Befund N5).
- **BT-11** — Für die Zielbranche das wichtigste Strukturfeld — Empfänger ordnen die Rechnung darüber dem Bauvorhaben zu.
- **BT-13** — Die alte Excel-Tabelle führte BT-13 auf CONTRACT.ABBR — das war falsch und ist der Grund, warum diese Registry existiert.
- **BT-14** — Kein eigenes Feld. Die Excel-Tabelle führte BT-14 und BT-13 auf dieselbe Spalte.
- **BT-20** — Trägt die KoSIT-Skonto-Konvention #SKONTO#TAGE=..#PROZENT=..#. Wird EINMAL in loadInvoiceData gebildet — vorher baute jeder Builder seinen eigenen Text und beide liefen auseinander (Befund R2).

### BG-1 — Rechnungsbegleitender Text

| BT | Bezeichnung | Kard. | Herkunft (DB) | CII | UBL | Status |
|---|---|---|---|---|---|---|
| BT-21 | Betreffcode der Anmerkung | 0..1 | abgeleitet: REG (Verkäuferangaben) bzw. PMT (Sicherheitseinbehalt) | `…/rsm:ExchangedDocument/ram:IncludedNote/ram:SubjectCode` | — | ✅ ausgegeben |
| BT-22 | Anmerkung zur Rechnung | 0..n | INVOICE.COMMENT | `…/rsm:ExchangedDocument/ram:IncludedNote/ram:Content` | `cbc:Note` | ✅ ausgegeben |

- **BT-21** — UBL kennt kein eigenes Element: der Code steht als #PMT#-Präfix im Notentext (cbc:Note). Codeliste UNTDID 4451.

### BG-2 — Prozesssteuerung

| BT | Bezeichnung | Kard. | Herkunft (DB) | CII | UBL | Status |
|---|---|---|---|---|---|---|
| BT-23 | Geschäftsprozesstyp | 0..1 | fest: Peppol-Billing-Profil | — | `cbc:ProfileID` | ✅ ausgegeben |
| BT-24 | Spezifikationskennung | 1..1 | fest: Profil-ID (einvoice/profiles.js) | `…/rsm:ExchangedDocumentContext/ram:GuidelineSpecifiedDocumentContextParameter/ram:ID` | `cbc:CustomizationID` | ✅ ausgegeben |

- **BT-23** — Nur UBL. Im CII sieht unser Dokument kein BusinessProcessSpecifiedDocumentContextParameter vor.

### BG-3 — Referenz auf vorausgegangene Rechnung

| BT | Bezeichnung | Kard. | Herkunft (DB) | CII | UBL | Status |
|---|---|---|---|---|---|---|
| BT-25 | Referenz auf die vorausgegangene Rechnung | 0..1 | INVOICE.CANCELS_INVOICE_ID / INVOICE_DEDUCTION.ADVANCE_INVOICE_ID | `…/ram:ApplicableHeaderTradeSettlement/ram:InvoiceReferencedDocument/ram:IssuerAssignedID` | `cac:BillingReference/cac:InvoiceDocumentReference/cbc:ID` | ✅ ausgegeben |
| BT-26 | Datum der vorausgegangenen Rechnung | 0..1 | INVOICE.INVOICE_DATE / ADVANCE_INVOICE.ADVANCE_INVOICE_DATE des Bezugsbelegs | `…/ram:ApplicableHeaderTradeSettlement/ram:InvoiceReferencedDocument/ram:FormattedIssueDateTime/qdt:DateTimeString` | `cac:BillingReference/cac:InvoiceDocumentReference/cbc:IssueDate` | ✅ ausgegeben |

- **BT-25** — Zwei Anlässe, ein Element: Storno verweist auf den stornierten Beleg, die Schlussrechnung auf jede abgezogene Abschlagsrechnung.

### BG-4 — Verkäufer

| BT | Bezeichnung | Kard. | Herkunft (DB) | CII | UBL | Status |
|---|---|---|---|---|---|---|
| BT-27 | Name des Verkäufers | 1..1 | INVOICE.COMPANY_NAME_1 / COMPANY.COMPANY_NAME_1 | `…/ram:ApplicableHeaderTradeAgreement/ram:SellerTradeParty/ram:Name` | `cac:AccountingSupplierParty/cac:Party/cac:PartyLegalEntity/cbc:RegistrationName` | ✅ ausgegeben |
| BT-28 | Handelsname des Verkäufers | 0..1 | — | — | — | — nicht unterstützt |
| BT-29 | Kennung des Verkäufers | 0..n | — | — | — | — nicht unterstützt |
| BT-30 | Registernummer des Verkäufers | 0..1 | — | — | — | — nicht unterstützt |
| BT-31 | Umsatzsteuer-Identifikationsnummer des Verkäufers | 0..1 | INVOICE."COMPANY_TAX-ID" | `…/ram:ApplicableHeaderTradeAgreement/ram:SellerTradeParty/ram:SpecifiedTaxRegistration/ram:ID` | `cac:AccountingSupplierParty/cac:Party/cac:PartyTaxScheme/cbc:CompanyID` | ✅ ausgegeben |
| BT-32 | Steuernummer des Verkäufers | 0..1 | INVOICE.COMPANY_TAX_NUMBER | `…/ram:ApplicableHeaderTradeAgreement/ram:SellerTradeParty/ram:SpecifiedTaxRegistration/ram:ID` | `cac:AccountingSupplierParty/cac:Party/cac:PartyTaxScheme/cbc:CompanyID` | ✅ ausgegeben |
| BT-33 | Sonstige rechtliche Informationen des Verkäufers | 0..1 | — | — | — | — nicht unterstützt |
| BT-34 | Elektronische Adresse des Verkäufers | 0..1 | EMPLOYEE.MAIL / COMPANY.PEPPOL_ENDPOINT_ID | `…/ram:ApplicableHeaderTradeAgreement/ram:SellerTradeParty/ram:URIUniversalCommunication/ram:URIID` | `cac:AccountingSupplierParty/cac:Party/cbc:EndpointID` | ✅ ausgegeben |

- **BT-28** — Bewusst entfernt (Befund S5): UBL schrieb denselben String in cac:PartyName und RegistrationName und behauptete damit einen Handelsnamen, den niemand erfasst hat.
- **BT-29** — Zusammen mit BT-30 der Grund, warum BR-CO-26 nur über die USt-IdNr erfüllt wird (Befund N9).
- **BT-30** — Handelsregisternummer. Fehlt im Datenmodell; wäre die belastbare Lösung für BR-CO-26 (Befund N9).
- **BT-31** — *(Unterscheidung: CII schemeID="VA", UBL cac:TaxScheme/cbc:ID = VAT)*
- **BT-32** — Erfüllt BR-CO-26 nicht (die Norm verlangt BT-29/30/31) — der Validator warnt, wenn nur die Steuernummer vorliegt. *(Unterscheidung: CII schemeID="FC", UBL cac:TaxScheme/cbc:ID = FC)*
- **BT-34** — Im Peppol-Modus zusätzlich mit EAS-schemeID (z. B. 9930 für DE-USt-IdNr), sonst schemeID=EM.

### BG-5 — Postanschrift des Verkäufers

| BT | Bezeichnung | Kard. | Herkunft (DB) | CII | UBL | Status |
|---|---|---|---|---|---|---|
| BT-35 | Straße/Hausnummer des Verkäufers | 0..1 | INVOICE.COMPANY_STREET / COMPANY.STREET | `…/ram:ApplicableHeaderTradeAgreement/ram:SellerTradeParty/ram:PostalTradeAddress/ram:LineOne` | `cac:AccountingSupplierParty/cac:Party/cac:PostalAddress/cbc:StreetName` | ✅ ausgegeben |
| BT-36 | Adresszusatz des Verkäufers | 0..1 | INVOICE.COMPANY_POST_OFFICE_BOX | — | — | ⚠️ geladen, ungenutzt |
| BT-37 | Ort des Verkäufers | 0..1 | INVOICE.COMPANY_CITY / COMPANY.CITY | `…/ram:ApplicableHeaderTradeAgreement/ram:SellerTradeParty/ram:PostalTradeAddress/ram:CityName` | `cac:AccountingSupplierParty/cac:Party/cac:PostalAddress/cbc:CityName` | ✅ ausgegeben |
| BT-38 | Postleitzahl des Verkäufers | 0..1 | INVOICE.COMPANY_POST_CODE / COMPANY.POST_CODE | `…/ram:ApplicableHeaderTradeAgreement/ram:SellerTradeParty/ram:PostalTradeAddress/ram:PostcodeCode` | `cac:AccountingSupplierParty/cac:Party/cac:PostalAddress/cbc:PostalZone` | ✅ ausgegeben |
| BT-39 | Region des Verkäufers | 0..1 | — | — | — | — nicht unterstützt |
| BT-40 | Ländercode des Verkäufers | 1..1 | COUNTRY.ABBR über COMPANY.COUNTRY_ID | `…/ram:ApplicableHeaderTradeAgreement/ram:SellerTradeParty/ram:PostalTradeAddress/ram:CountryID` | `cac:AccountingSupplierParty/cac:Party/cac:PostalAddress/cac:Country/cbc:IdentificationCode` | ✅ ausgegeben |

- **BT-36** — Das Postfach wird geladen, aber von keinem Builder ausgegeben (Befund S3).

### BG-6 — Kontaktangaben des Verkäufers

| BT | Bezeichnung | Kard. | Herkunft (DB) | CII | UBL | Status |
|---|---|---|---|---|---|---|
| BT-41 | Ansprechpartner des Verkäufers | 0..1 | INVOICE.EMPLOYEE / EMPLOYEE.FIRST_NAME+LAST_NAME | `…/ram:ApplicableHeaderTradeAgreement/ram:SellerTradeParty/ram:DefinedTradeContact/ram:PersonName` | `cac:AccountingSupplierParty/cac:Party/cac:Contact/cbc:Name` | ✅ ausgegeben |
| BT-42 | Telefon des Verkäufers | 0..1 | INVOICE.EMPLOYEE_PHONE / EMPLOYEE.MOBILE / EMPLOYEE.PHONE | `…/ram:ApplicableHeaderTradeAgreement/ram:SellerTradeParty/ram:DefinedTradeContact/ram:TelephoneUniversalCommunication/ram:CompleteNumber` | `cac:AccountingSupplierParty/cac:Party/cac:Contact/cbc:Telephone` | ✅ ausgegeben |
| BT-43 | E-Mail des Verkäufers | 0..1 | INVOICE.EMPLOYEE_MAIL / EMPLOYEE.MAIL | `…/ram:ApplicableHeaderTradeAgreement/ram:SellerTradeParty/ram:DefinedTradeContact/ram:EmailURIUniversalCommunication/ram:URIID` | `cac:AccountingSupplierParty/cac:Party/cac:Contact/cbc:ElectronicMail` | ✅ ausgegeben |

- **BT-41** — Die XRechnung-CIUS macht BG-6 zur Pflichtgruppe; der Validator meldet Fehlen als Fehler (Befund N7).

### BG-7 — Käufer

| BT | Bezeichnung | Kard. | Herkunft (DB) | CII | UBL | Status |
|---|---|---|---|---|---|---|
| BT-44 | Name des Käufers | 1..1 | INVOICE.ADDRESS_NAME_1 / ADDRESS.ADDRESS_NAME_1 | `…/ram:ApplicableHeaderTradeAgreement/ram:BuyerTradeParty/ram:Name` | `cac:AccountingCustomerParty/cac:Party/cac:PartyLegalEntity/cbc:RegistrationName` | ✅ ausgegeben |
| BT-45 | Handelsname des Käufers | 0..1 | — | — | — | — nicht unterstützt |
| BT-46 | Kennung des Käufers | 0..1 | INVOICE.ADDRESS_DEBITOR_NUMBER / ADDRESS.DEBITOR_NUMBER | — | — | ⚠️ geladen, ungenutzt |
| BT-47 | Registernummer des Käufers | 0..1 | — | — | — | — nicht unterstützt |
| BT-48 | Umsatzsteuer-Identifikationsnummer des Käufers | 0..1 | INVOICE.ADDRESS_VAT_ID / ADDRESS.VAT_ID | `…/ram:ApplicableHeaderTradeAgreement/ram:BuyerTradeParty/ram:SpecifiedTaxRegistration/ram:ID` | `cac:AccountingCustomerParty/cac:Party/cac:PartyTaxScheme/cbc:CompanyID` | ✅ ausgegeben |
| BT-49 | Elektronische Adresse des Käufers | 0..1 | INVOICE.CONTACT_MAIL / ADDRESS.PEPPOL_ENDPOINT_ID | `…/ram:ApplicableHeaderTradeAgreement/ram:BuyerTradeParty/ram:URIUniversalCommunication/ram:URIID` | `cac:AccountingCustomerParty/cac:Party/cbc:EndpointID` | ✅ ausgegeben |

- **BT-45** — Siehe BT-28 (Befund S5).
- **BT-46** — Die Debitorennummer wird geladen und von keinem Builder ausgegeben (Befund S3). Sie wäre der naheliegende Kandidat, um BR-CO-26 zu entschärfen.
- **BT-48** — Bei Reverse Charge (AE) und innergemeinschaftlicher Lieferung (K) Pflicht — der Validator prüft das (Befund R7). *(Unterscheidung: CII schemeID="VA", UBL cac:TaxScheme/cbc:ID = VAT)*

### BG-8 — Postanschrift des Käufers

| BT | Bezeichnung | Kard. | Herkunft (DB) | CII | UBL | Status |
|---|---|---|---|---|---|---|
| BT-50 | Straße/Hausnummer des Käufers | 0..1 | INVOICE.ADDRESS_STREET / ADDRESS.STREET | `…/ram:ApplicableHeaderTradeAgreement/ram:BuyerTradeParty/ram:PostalTradeAddress/ram:LineOne` | `cac:AccountingCustomerParty/cac:Party/cac:PostalAddress/cbc:StreetName` | ✅ ausgegeben |
| BT-51 | Adresszusatz des Käufers | 0..1 | — | — | — | — nicht unterstützt |
| BT-52 | Ort des Käufers | 0..1 | INVOICE.ADDRESS_CITY / ADDRESS.CITY | `…/ram:ApplicableHeaderTradeAgreement/ram:BuyerTradeParty/ram:PostalTradeAddress/ram:CityName` | `cac:AccountingCustomerParty/cac:Party/cac:PostalAddress/cbc:CityName` | ✅ ausgegeben |
| BT-53 | Postleitzahl des Käufers | 0..1 | INVOICE.ADDRESS_POST_CODE / ADDRESS.POST_CODE | `…/ram:ApplicableHeaderTradeAgreement/ram:BuyerTradeParty/ram:PostalTradeAddress/ram:PostcodeCode` | `cac:AccountingCustomerParty/cac:Party/cac:PostalAddress/cbc:PostalZone` | ✅ ausgegeben |
| BT-54 | Region des Käufers | 0..1 | — | — | — | — nicht unterstützt |
| BT-55 | Ländercode des Käufers | 1..1 | INVOICE.ADDRESS_COUNTRY / COUNTRY.ABBR über ADDRESS.COUNTRY_ID | `…/ram:ApplicableHeaderTradeAgreement/ram:BuyerTradeParty/ram:PostalTradeAddress/ram:CountryID` | `cac:AccountingCustomerParty/cac:Party/cac:PostalAddress/cac:Country/cbc:IdentificationCode` | ✅ ausgegeben |

### BG-9 — Kontaktangaben des Käufers

| BT | Bezeichnung | Kard. | Herkunft (DB) | CII | UBL | Status |
|---|---|---|---|---|---|---|
| BT-56 | Ansprechpartner des Käufers | 0..1 | INVOICE.CONTACT | `…/ram:ApplicableHeaderTradeAgreement/ram:BuyerTradeParty/ram:DefinedTradeContact/ram:PersonName` | `cac:AccountingCustomerParty/cac:Party/cac:Contact/cbc:Name` | ✅ ausgegeben |
| BT-57 | Telefon des Käufers | 0..1 | INVOICE.CONTACT_PHONE | `…/ram:ApplicableHeaderTradeAgreement/ram:BuyerTradeParty/ram:DefinedTradeContact/ram:TelephoneUniversalCommunication/ram:CompleteNumber` | `cac:AccountingCustomerParty/cac:Party/cac:Contact/cbc:Telephone` | ✅ ausgegeben |
| BT-58 | E-Mail des Käufers | 0..1 | INVOICE.CONTACT_MAIL | `…/ram:ApplicableHeaderTradeAgreement/ram:BuyerTradeParty/ram:DefinedTradeContact/ram:EmailURIUniversalCommunication/ram:URIID` | `cac:AccountingCustomerParty/cac:Party/cac:Contact/cbc:ElectronicMail` | ✅ ausgegeben |

### BG-10 — Zahlungsempfänger

| BT | Bezeichnung | Kard. | Herkunft (DB) | CII | UBL | Status |
|---|---|---|---|---|---|---|
| BT-59 | Name des Zahlungsempfängers | 0..1 | — | — | — | — nicht unterstützt |
| BT-60 | Kennung des Zahlungsempfängers | 0..1 | — | — | — | — nicht unterstützt |
| BT-61 | Registernummer des Zahlungsempfängers | 0..1 | — | — | — | — nicht unterstützt |

- **BT-59** — Ein abweichender Zahlungsempfänger (Factoring, Abtretung) ist nicht vorgesehen — Zahlungsempfänger ist immer der Verkäufer.

### BG-11 — Steuervertreter des Verkäufers

| BT | Bezeichnung | Kard. | Herkunft (DB) | CII | UBL | Status |
|---|---|---|---|---|---|---|
| BT-62 | Name des Steuervertreters | 0..1 | — | — | — | — nicht unterstützt |
| BT-63 | USt-IdNr des Steuervertreters | 0..1 | — | — | — | — nicht unterstützt |

### BG-13 — Lieferinformationen

| BT | Bezeichnung | Kard. | Herkunft (DB) | CII | UBL | Status |
|---|---|---|---|---|---|---|
| BT-70 | Name des Lieferorts | 0..1 | — | — | — | — nicht unterstützt |
| BT-71 | Kennung des Lieferorts | 0..1 | — | — | — | — nicht unterstützt |
| BT-72 | Tatsächliches Lieferdatum | 0..1 | abgeleitet: BILLING_PERIOD_FINISH, ersatzweise BILLING_PERIOD_START | `…/ram:ApplicableHeaderTradeDelivery/ram:ActualDeliverySupplyChainEvent/ram:OccurrenceDateTime/udt:DateTimeString` | `cac:Delivery/cbc:ActualDeliveryDate` | ✅ ausgegeben |

- **BT-72** — Kein Rückfall auf das Rechnungsdatum: ohne Leistungszeitraum bleibt die Gruppe leer, statt einen Liefertag zu behaupten (Befund R1).

### BG-14 — Rechnungszeitraum

| BT | Bezeichnung | Kard. | Herkunft (DB) | CII | UBL | Status |
|---|---|---|---|---|---|---|
| BT-73 | Beginn des Abrechnungszeitraums | 0..1 | INVOICE.BILLING_PERIOD_START | `…/ram:ApplicableHeaderTradeSettlement/ram:BillingSpecifiedPeriod/ram:StartDateTime/udt:DateTimeString` | `cac:InvoicePeriod/cbc:StartDate` | ✅ ausgegeben |
| BT-74 | Ende des Abrechnungszeitraums | 0..1 | INVOICE.BILLING_PERIOD_FINISH | `…/ram:ApplicableHeaderTradeSettlement/ram:BillingSpecifiedPeriod/ram:EndDateTime/udt:DateTimeString` | `cac:InvoicePeriod/cbc:EndDate` | ✅ ausgegeben |

### BG-16 — Zahlungsanweisungen

| BT | Bezeichnung | Kard. | Herkunft (DB) | CII | UBL | Status |
|---|---|---|---|---|---|---|
| BT-81 | Code für die Zahlungsart | 0..1 | PAYMENT_MEANS.ABBR | `…/ram:ApplicableHeaderTradeSettlement/ram:SpecifiedTradeSettlementPaymentMeans/ram:TypeCode` | `cac:PaymentMeans/cbc:PaymentMeansCode` | ✅ ausgegeben |
| BT-82 | Bezeichnung der Zahlungsart | 0..1 | PAYMENT_MEANS.NAME | `…/ram:ApplicableHeaderTradeSettlement/ram:SpecifiedTradeSettlementPaymentMeans/ram:Information` | `cac:PaymentMeans/cbc:PaymentMeansCode/@name` | ✅ ausgegeben |
| BT-83 | Verwendungszweck | 0..1 | INVOICE.REMITTANCE_INFORMATION | `…/ram:ApplicableHeaderTradeSettlement/ram:PaymentReference` | `cac:PaymentMeans/cbc:PaymentID` | ✅ ausgegeben |

- **BT-81** — Codeliste UNTDID 4461, seit Migration 0163 aus dem globalen Katalog PAYMENT_MEANS. Ausgebbar sind 30 und 58; 59 verlangt BG-19 (Mandat) und wird vom Validator abgewiesen (BR-DE-PM). Der ganze Block hängt weiterhin an der IBAN (Befund N6).

### BG-17 — Überweisung

| BT | Bezeichnung | Kard. | Herkunft (DB) | CII | UBL | Status |
|---|---|---|---|---|---|---|
| BT-84 | IBAN des Zahlungskontos | 1..1 | INVOICE.COMPANY_IBAN / COMPANY.IBAN | `…/ram:ApplicableHeaderTradeSettlement/ram:SpecifiedTradeSettlementPaymentMeans/ram:PayeePartyCreditorFinancialAccount/ram:IBANID` | `cac:PaymentMeans/cac:PayeeFinancialAccount/cbc:ID` | ✅ ausgegeben |
| BT-85 | Name des Kontoinhabers | 0..1 | — | — | — | — nicht unterstützt |
| BT-86 | BIC des Zahlungsdienstleisters | 0..1 | INVOICE.COMPANY_BIC / COMPANY.BIC | `…/ram:ApplicableHeaderTradeSettlement/ram:SpecifiedTradeSettlementPaymentMeans/ram:PayeeSpecifiedCreditorFinancialInstitution/ram:BICID` | `cac:PaymentMeans/cac:PayeeFinancialAccount/cac:FinancialInstitutionBranch/cbc:ID` | ✅ ausgegeben |

- **BT-84** — Ohne IBAN entsteht gar kein BG-16 — der Validator meldet das als Fehler, nicht als Warnung (Befund N6).
- **BT-85** — Kontoinhaber ist implizit der Verkäufer (BT-27); ein abweichender Name wird nicht erfasst.

### BG-19 — Lastschrift

| BT | Bezeichnung | Kard. | Herkunft (DB) | CII | UBL | Status |
|---|---|---|---|---|---|---|
| BT-89 | Mandatsreferenz (Lastschrift) | 0..1 | — | — | — | — nicht unterstützt |
| BT-90 | Gläubiger-Identifikationsnummer | 0..1 | INVOICE."COMPANY_CREDITOR-ID" | — | — | ⚠️ geladen, ungenutzt |
| BT-91 | Belastetes Konto (Lastschrift) | 0..1 | — | — | — | — nicht unterstützt |

- **BT-89** — Lastschrift wird nicht unterstützt — die Zahlungsart ist fest 58.
- **BT-90** — Wird geladen und von keinem Builder ausgegeben (Befund S3). Sinnvoll erst mit einer Lastschrift-Zahlungsart.

### BG-20 — Nachlässe auf Dokumentenebene

| BT | Bezeichnung | Kard. | Herkunft (DB) | CII | UBL | Status |
|---|---|---|---|---|---|---|
| BT-92 | Betrag des Nachlasses | 1..1 | INVOICE.DISCOUNT_1 / INVOICE.DISCOUNT_2 | `…/ram:ApplicableHeaderTradeSettlement/ram:SpecifiedTradeAllowanceCharge/ram:ActualAmount` | `cac:AllowanceCharge/cbc:Amount` | ✅ ausgegeben |
| BT-93 | Grundbetrag des Nachlasses | 0..1 | abgeleitet: Betrag / Prozentsatz | `…/ram:ApplicableHeaderTradeSettlement/ram:SpecifiedTradeAllowanceCharge/ram:BasisAmount` | `cac:AllowanceCharge/cbc:BaseAmount` | ✅ ausgegeben |
| BT-94 | Prozentsatz des Nachlasses | 0..1 | INVOICE.DISCOUNT_1_PERCENT / DISCOUNT_2_PERCENT | `…/ram:ApplicableHeaderTradeSettlement/ram:SpecifiedTradeAllowanceCharge/ram:CalculationPercent` | `cac:AllowanceCharge/cbc:MultiplierFactorNumeric` | ✅ ausgegeben |
| BT-95 | Umsatzsteuerkategorie des Nachlasses | 1..1 | abgeleitet: Kategorie des Belegs | `…/ram:ApplicableHeaderTradeSettlement/ram:SpecifiedTradeAllowanceCharge/ram:CategoryTradeTax/ram:CategoryCode` | `cac:AllowanceCharge/cac:TaxCategory/cbc:ID` | ✅ ausgegeben |
| BT-96 | Umsatzsteuersatz des Nachlasses | 0..1 | abgeleitet: Satz des Belegs | `…/ram:ApplicableHeaderTradeSettlement/ram:SpecifiedTradeAllowanceCharge/ram:CategoryTradeTax/ram:RateApplicablePercent` | `cac:AllowanceCharge/cac:TaxCategory/cbc:Percent` | ✅ ausgegeben |
| BT-97 | Grund des Nachlasses | 0..1 | INVOICE.DISCOUNT_1_REASON / DISCOUNT_2_REASON | `…/ram:ApplicableHeaderTradeSettlement/ram:SpecifiedTradeAllowanceCharge/ram:Reason` | `cac:AllowanceCharge/cbc:AllowanceChargeReason` | ✅ ausgegeben |
| BT-98 | Code für den Grund des Nachlasses | 0..1 | fest: 95 (Rabatt) | `…/ram:ApplicableHeaderTradeSettlement/ram:SpecifiedTradeAllowanceCharge/ram:ReasonCode` | `cac:AllowanceCharge/cbc:AllowanceChargeReasonCode` | ✅ ausgegeben |

### BG-21 — Zuschläge auf Dokumentenebene

| BT | Bezeichnung | Kard. | Herkunft (DB) | CII | UBL | Status |
|---|---|---|---|---|---|---|
| BT-99 | Betrag des Zuschlags | 1..1 | — | — | — | — nicht unterstützt |
| BT-100 | Grundbetrag des Zuschlags | 0..1 | — | — | — | — nicht unterstützt |
| BT-101 | Prozentsatz des Zuschlags | 0..1 | — | — | — | — nicht unterstützt |
| BT-102 | Umsatzsteuerkategorie des Zuschlags | 1..1 | — | — | — | — nicht unterstützt |
| BT-103 | Umsatzsteuersatz des Zuschlags | 0..1 | — | — | — | — nicht unterstützt |
| BT-104 | Grund des Zuschlags | 0..1 | — | — | — | — nicht unterstützt |
| BT-105 | Code für den Grund des Zuschlags | 0..1 | — | — | — | — nicht unterstützt |

- **BT-99** — Zuschläge auf Dokumentenebene gibt es im Datenmodell nicht; BT-108 wird deshalb immer 0 ausgegeben.

### BG-22 — Gesamtbeträge

| BT | Bezeichnung | Kard. | Herkunft (DB) | CII | UBL | Status |
|---|---|---|---|---|---|---|
| BT-106 | Summe der Positionsbeträge (netto) | 1..1 | abgeleitet: Summe der Positionen | `…/ram:ApplicableHeaderTradeSettlement/ram:SpecifiedTradeSettlementHeaderMonetarySummation/ram:LineTotalAmount` | `cac:LegalMonetaryTotal/cbc:LineExtensionAmount` | ✅ ausgegeben |
| BT-107 | Summe der Nachlässe (netto) | 0..1 | abgeleitet: Summe DISCOUNT_1 + DISCOUNT_2 | `…/ram:ApplicableHeaderTradeSettlement/ram:SpecifiedTradeSettlementHeaderMonetarySummation/ram:AllowanceTotalAmount` | `cac:LegalMonetaryTotal/cbc:AllowanceTotalAmount` | ✅ ausgegeben |
| BT-108 | Summe der Zuschläge (netto) | 0..1 | fest: 0 | `…/ram:ApplicableHeaderTradeSettlement/ram:SpecifiedTradeSettlementHeaderMonetarySummation/ram:ChargeTotalAmount` | `cac:LegalMonetaryTotal/cbc:ChargeTotalAmount` | ✅ ausgegeben |
| BT-109 | Gesamtbetrag ohne Umsatzsteuer | 1..1 | INVOICE.TOTAL_AMOUNT_NET | `…/ram:ApplicableHeaderTradeSettlement/ram:SpecifiedTradeSettlementHeaderMonetarySummation/ram:TaxBasisTotalAmount` | `cac:LegalMonetaryTotal/cbc:TaxExclusiveAmount` | ✅ ausgegeben |
| BT-110 | Gesamtbetrag der Umsatzsteuer | 0..1 | INVOICE.TAX_AMOUNT_NET | `…/ram:ApplicableHeaderTradeSettlement/ram:SpecifiedTradeSettlementHeaderMonetarySummation/ram:TaxTotalAmount` | `cac:TaxTotal/cbc:TaxAmount` | ✅ ausgegeben |
| BT-111 | Umsatzsteuerbetrag in Buchungswährung | 0..1 | — | — | — | — nicht unterstützt |
| BT-112 | Gesamtbetrag mit Umsatzsteuer | 1..1 | INVOICE.TOTAL_AMOUNT_GROSS | `…/ram:ApplicableHeaderTradeSettlement/ram:SpecifiedTradeSettlementHeaderMonetarySummation/ram:GrandTotalAmount` | `cac:LegalMonetaryTotal/cbc:TaxInclusiveAmount` | ✅ ausgegeben |
| BT-113 | Bereits gezahlter Betrag | 0..1 | abgeleitet: Summe der VEREINNAHMTEN Abschläge (brutto abzüglich Einbehalt) | `…/ram:ApplicableHeaderTradeSettlement/ram:SpecifiedTradeSettlementHeaderMonetarySummation/ram:TotalPrepaidAmount` | `cac:LegalMonetaryTotal/cbc:PrepaidAmount` | ✅ ausgegeben |
| BT-114 | Rundungsbetrag | 0..1 | — | — | — | — nicht unterstützt |
| BT-115 | Fälliger Zahlungsbetrag | 1..1 | abgeleitet: BT-112 − BT-113 | `…/ram:ApplicableHeaderTradeSettlement/ram:SpecifiedTradeSettlementHeaderMonetarySummation/ram:DuePayableAmount` | `cac:LegalMonetaryTotal/cbc:PayableAmount` | ✅ ausgegeben |

- **BT-108** — Immer 0 — siehe BG-21.
- **BT-109** — Gespeicherter Wert schlägt die Berechnung — eine gespeicherte 0 ist eine Aussage, kein fehlender Wert (Befund R9).
- **BT-111** — Siehe BT-6.
- **BT-113** — Maßgeblich ist das Vereinnahmte, nicht das Fakturierte: § 14 Abs. 5 UStG verlangt den Abzug der vereinnahmten Teilentgelte. Der Sicherheitseinbehalt war nie gezahlt und zählt deshalb nicht mit (Befund N10).
- **BT-115** — Der Sicherheitseinbehalt wird hier NICHT abgezogen — er ist eine Zahlungsmodalität, keine Rechnungsgröße, und ein Abzug verletzt BR-CO-16. Er steht als Hinweis mit Betreffcode PMT im Dokument (Befund N10).

### BG-23 — Aufschlüsselung der Umsatzsteuer

| BT | Bezeichnung | Kard. | Herkunft (DB) | CII | UBL | Status |
|---|---|---|---|---|---|---|
| BT-116 | Steuerbasisbetrag je Kategorie | 1..1 | INVOICE.TOTAL_AMOUNT_NET | `…/ram:ApplicableHeaderTradeSettlement/ram:ApplicableTradeTax/ram:BasisAmount` | `cac:TaxTotal/cac:TaxSubtotal/cbc:TaxableAmount` | ✅ ausgegeben |
| BT-117 | Steuerbetrag je Kategorie | 1..1 | INVOICE.TAX_AMOUNT_NET | `…/ram:ApplicableHeaderTradeSettlement/ram:ApplicableTradeTax/ram:CalculatedAmount` | `cac:TaxTotal/cac:TaxSubtotal/cbc:TaxAmount` | ✅ ausgegeben |
| BT-118 | Code der Umsatzsteuerkategorie | 1..1 | INVOICE.VAT_CATEGORY | `…/ram:ApplicableHeaderTradeSettlement/ram:ApplicableTradeTax/ram:CategoryCode` | `cac:TaxTotal/cac:TaxSubtotal/cac:TaxCategory/cbc:ID` | ✅ ausgegeben |
| BT-119 | Umsatzsteuersatz je Kategorie | 0..1 | INVOICE.VAT_PERCENT | `…/ram:ApplicableHeaderTradeSettlement/ram:ApplicableTradeTax/ram:RateApplicablePercent` | `cac:TaxTotal/cac:TaxSubtotal/cac:TaxCategory/cbc:Percent` | ✅ ausgegeben |
| BT-120 | Grund der Steuerbefreiung (Text) | 0..1 | INVOICE.VAT_EXEMPTION_REASON_TEXT, ersatzweise Standardtext je Kategorie | `…/ram:ApplicableHeaderTradeSettlement/ram:ApplicableTradeTax/ram:ExemptionReason` | `cac:TaxTotal/cac:TaxSubtotal/cac:TaxCategory/cbc:TaxExemptionReason` | ✅ ausgegeben |
| BT-121 | Code für den Grund der Steuerbefreiung | 0..1 | INVOICE.VAT_EXEMPTION_REASON_CODE | `…/ram:ApplicableHeaderTradeSettlement/ram:ApplicableTradeTax/ram:ExemptionReasonCode` | `cac:TaxTotal/cac:TaxSubtotal/cac:TaxCategory/cbc:TaxExemptionReasonCode` | ✅ ausgegeben |

- **BT-118** — Codeliste UNTDID 5305 — zulässige Werte und Regeln je Kategorie in codelists.js.
- **BT-119** — Bei jeder Kategorie außer S zwingend 0 — der gespeicherte Satz wird dann überschrieben.
- **BT-120** — Standardtexte stehen in codelists.UNTDID_5305 — eine Stelle, nicht zwei.

### BG-24 — Anlagen

| BT | Bezeichnung | Kard. | Herkunft (DB) | CII | UBL | Status |
|---|---|---|---|---|---|---|
| BT-122 | Kennung der Anlage | 1..1 | EINVOICE_ATTACHMENT.DOCUMENT_REFERENCE | `…/ram:ApplicableHeaderTradeAgreement/ram:AdditionalReferencedDocument/ram:IssuerAssignedID` | `cac:AdditionalDocumentReference/cbc:ID` | ✅ ausgegeben |
| BT-123 | Beschreibung der Anlage | 0..1 | EINVOICE_ATTACHMENT.DESCRIPTION | `…/ram:ApplicableHeaderTradeAgreement/ram:AdditionalReferencedDocument/ram:Name` | `cac:AdditionalDocumentReference/cbc:DocumentDescription` | ✅ ausgegeben |
| BT-124 | Externer Verweis auf die Anlage (URI) | 0..1 | — | — | — | — nicht unterstützt |
| BT-125 | Eingebetteter Anlageninhalt | 0..1 | EINVOICE_ATTACHMENT (Objektspeicher, base64) | `…/ram:ApplicableHeaderTradeAgreement/ram:AdditionalReferencedDocument/ram:AttachmentBinaryObject` | `cac:AdditionalDocumentReference/cac:Attachment/cbc:EmbeddedDocumentBinaryObject` | ✅ ausgegeben |

- **BT-124** — Anlagen werden eingebettet, nicht verlinkt — ein Link wäre für den Empfänger nicht dauerhaft erreichbar.
- **BT-125** — Dateiname und MIME-Typ stehen als Attribute (filename, mimeCode) am selben Element. Anlagen ohne Inhalt werden ausgelassen statt als literal 'undefined' geschrieben (Befund R5). Der Vorgabewert application/octet-stream ist weiterhin offen — BT-125 ist codelistenbeschränkt.

### BG-25 — Rechnungsposition

| BT | Bezeichnung | Kard. | Herkunft (DB) | CII | UBL | Status |
|---|---|---|---|---|---|---|
| BT-126 | Kennung der Position | 1..1 | abgeleitet: laufende Nummer | `…/ram:IncludedSupplyChainTradeLineItem/ram:AssociatedDocumentLineDocument/ram:LineID` | `cac:InvoiceLine/cbc:ID` | ✅ ausgegeben |
| BT-127 | Anmerkung zur Position | 0..1 | abgeleitet: Nebenkosten bzw. Stundenzahl und Satz | `…/ram:IncludedSupplyChainTradeLineItem/ram:AssociatedDocumentLineDocument/ram:IncludedNote/ram:Content` | `cac:InvoiceLine/cbc:Note` | ✅ ausgegeben |
| BT-128 | Objektkennung der Position | 0..1 | — | — | — | — nicht unterstützt |
| BT-129 | Menge der Position | 1..1 | abgeleitet: 1 (Pauschal) bzw. Summe BOOKING.QUANTITY_INT (Stunden) | `…/ram:IncludedSupplyChainTradeLineItem/ram:SpecifiedLineTradeDelivery/ram:BilledQuantity` | `cac:InvoiceLine/cbc:InvoicedQuantity` | ✅ ausgegeben |
| BT-130 | Code der Mengeneinheit | 1..1 | abgeleitet: HUR bei Stundenpositionen, sonst LS | `…/ram:IncludedSupplyChainTradeLineItem/ram:SpecifiedLineTradeDelivery/ram:BilledQuantity` *(@unitCode)* | `cac:InvoiceLine/cbc:InvoicedQuantity` *(@unitCode)* | ✅ ausgegeben |
| BT-131 | Nettobetrag der Position | 1..1 | INVOICE_STRUCTURE.AMOUNT_NET + AMOUNT_EXTRAS_NET | `…/ram:IncludedSupplyChainTradeLineItem/ram:SpecifiedLineTradeSettlement/ram:SpecifiedTradeSettlementLineMonetarySummation/ram:LineTotalAmount` | `cac:InvoiceLine/cbc:LineExtensionAmount` | ✅ ausgegeben |
| BT-132 | Referenz auf die Bestellposition | 0..1 | — | — | — | — nicht unterstützt |
| BT-133 | Buchungsreferenz der Position | 0..1 | — | — | — | — nicht unterstützt |

- **BT-129** — Bei Storno wird die MENGE negativ, nicht der Einzelpreis — BR-27 verbietet negative Einzelpreise (Befund N3).
- **BT-130** — Codeliste UN/ECE Rec. 20. Buchungsarten ohne Stundencharakter (UNIT, LUMP_*) erzwingen LS — eine HUR-Position wäre dort irreführend.

### BG-26 — Zeitraum der Position

| BT | Bezeichnung | Kard. | Herkunft (DB) | CII | UBL | Status |
|---|---|---|---|---|---|---|
| BT-134 | Beginn des Leistungszeitraums der Position | 0..1 | INVOICE.BILLING_PERIOD_START | `…/ram:IncludedSupplyChainTradeLineItem/ram:SpecifiedLineTradeSettlement/ram:BillingSpecifiedPeriod/ram:StartDateTime/udt:DateTimeString` | `cac:InvoiceLine/cac:InvoicePeriod/cbc:StartDate` | ✅ ausgegeben |
| BT-135 | Ende des Leistungszeitraums der Position | 0..1 | INVOICE.BILLING_PERIOD_FINISH | `…/ram:IncludedSupplyChainTradeLineItem/ram:SpecifiedLineTradeSettlement/ram:BillingSpecifiedPeriod/ram:EndDateTime/udt:DateTimeString` | `cac:InvoiceLine/cac:InvoicePeriod/cbc:EndDate` | ✅ ausgegeben |

### BG-27 — Nachlässe auf Positionsebene

| BT | Bezeichnung | Kard. | Herkunft (DB) | CII | UBL | Status |
|---|---|---|---|---|---|---|
| BT-136 | Betrag des Positionsnachlasses | 1..1 | — | — | — | — nicht unterstützt |
| BT-137 | Grundbetrag des Positionsnachlasses | 0..1 | — | — | — | — nicht unterstützt |
| BT-138 | Prozentsatz des Positionsnachlasses | 0..1 | — | — | — | — nicht unterstützt |
| BT-139 | Grund des Positionsnachlasses | 0..1 | — | — | — | — nicht unterstützt |
| BT-140 | Code für den Grund des Positionsnachlasses | 0..1 | — | — | — | — nicht unterstützt |

- **BT-136** — Nachlässe auf Positionsebene gibt es im Datenmodell nicht — Nachlässe liegen auf Dokumentenebene (BG-20).

### BG-28 — Zuschläge auf Positionsebene

| BT | Bezeichnung | Kard. | Herkunft (DB) | CII | UBL | Status |
|---|---|---|---|---|---|---|
| BT-141 | Betrag des Positionszuschlags | 1..1 | — | — | — | — nicht unterstützt |
| BT-142 | Grundbetrag des Positionszuschlags | 0..1 | — | — | — | — nicht unterstützt |
| BT-143 | Prozentsatz des Positionszuschlags | 0..1 | — | — | — | — nicht unterstützt |
| BT-144 | Grund des Positionszuschlags | 0..1 | — | — | — | — nicht unterstützt |
| BT-145 | Code für den Grund des Positionszuschlags | 0..1 | — | — | — | — nicht unterstützt |

### BG-29 — Detailinformationen zum Preis

| BT | Bezeichnung | Kard. | Herkunft (DB) | CII | UBL | Status |
|---|---|---|---|---|---|---|
| BT-146 | Einzelpreis (netto) | 1..1 | abgeleitet: Positionsbetrag / Menge | `…/ram:IncludedSupplyChainTradeLineItem/ram:SpecifiedLineTradeAgreement/ram:NetPriceProductTradePrice/ram:ChargeAmount` | `cac:InvoiceLine/cac:Price/cbc:PriceAmount` | ✅ ausgegeben |
| BT-147 | Nachlass auf den Einzelpreis | 0..1 | — | — | — | — nicht unterstützt |
| BT-148 | Listenpreis (brutto) | 0..1 | — | — | — | — nicht unterstützt |
| BT-149 | Basismenge zum Einzelpreis | 0..1 | fest: 1 | `…/ram:IncludedSupplyChainTradeLineItem/ram:SpecifiedLineTradeAgreement/ram:NetPriceProductTradePrice/ram:BasisQuantity` | `cac:InvoiceLine/cac:Price/cbc:BaseQuantity` | ✅ ausgegeben |
| BT-150 | Code der Einheit zur Basismenge | 0..1 | abgeleitet: wie BT-130 | `…/ram:IncludedSupplyChainTradeLineItem/ram:SpecifiedLineTradeAgreement/ram:NetPriceProductTradePrice/ram:BasisQuantity` *(@unitCode)* | `cac:InvoiceLine/cac:Price/cbc:BaseQuantity` *(@unitCode)* | ✅ ausgegeben |

- **BT-146** — Darf nach BR-27 nie negativ sein — auch beim Storno nicht (Befund N3).
- **BT-149** — Fest 1, nicht die Rechnungsmenge — sonst wäre Einzelpreis × Basismenge nicht der Positionsbetrag (Befund N4).

### BG-30 — Umsatzsteuerangaben der Position

| BT | Bezeichnung | Kard. | Herkunft (DB) | CII | UBL | Status |
|---|---|---|---|---|---|---|
| BT-151 | Umsatzsteuerkategorie der Position | 1..1 | INVOICE.VAT_CATEGORY | `…/ram:IncludedSupplyChainTradeLineItem/ram:SpecifiedLineTradeSettlement/ram:ApplicableTradeTax/ram:CategoryCode` | `cac:InvoiceLine/cac:Item/cac:ClassifiedTaxCategory/cbc:ID` | ✅ ausgegeben |
| BT-152 | Umsatzsteuersatz der Position | 0..1 | INVOICE.VAT_PERCENT | `…/ram:IncludedSupplyChainTradeLineItem/ram:SpecifiedLineTradeSettlement/ram:ApplicableTradeTax/ram:RateApplicablePercent` | `cac:InvoiceLine/cac:Item/cac:ClassifiedTaxCategory/cbc:Percent` | ✅ ausgegeben |

### BG-31 — Artikelangaben

| BT | Bezeichnung | Kard. | Herkunft (DB) | CII | UBL | Status |
|---|---|---|---|---|---|---|
| BT-153 | Bezeichnung des Artikels | 1..1 | PROJECT_STRUCTURE.ABBR + NAME | `…/ram:IncludedSupplyChainTradeLineItem/ram:SpecifiedTradeProduct/ram:Name` | `cac:InvoiceLine/cac:Item/cbc:Name` | ✅ ausgegeben |
| BT-154 | Beschreibung des Artikels | 0..1 | — | — | — | — nicht unterstützt |
| BT-155 | Artikelnummer des Verkäufers | 0..1 | — | — | — | — nicht unterstützt |
| BT-156 | Artikelnummer des Käufers | 0..1 | — | — | — | — nicht unterstützt |
| BT-157 | Internationale Artikelnummer | 0..1 | — | — | — | — nicht unterstützt |
| BT-158 | Klassifizierung des Artikels | 0..n | — | — | — | — nicht unterstützt |
| BT-159 | Ursprungsland des Artikels | 0..1 | — | — | — | — nicht unterstützt |
| BT-160 | Merkmalsname des Artikels | 0..n | — | — | — | — nicht unterstützt |
| BT-161 | Merkmalswert des Artikels | 0..n | — | — | — | — nicht unterstützt |

- **BT-154** — Erläuterungen stehen in BT-127 (Positionsanmerkung).

## Strukturelemente ohne eigenen Business Term

Elemente, die die jeweilige Syntax verlangt, die aber kein Feld der EN 16931
tragen. Die Rückwärtsprüfung würde sie sonst als unbeanspruchte Elemente melden —
wer hier einträgt statt eine Feldzeile anzulegen, muss begründen warum.

| Pfad | Warum kein BT |
|---|---|
| `…/ram:IncludedSupplyChainTradeLineItem/ram:SpecifiedLineTradeSettlement/ram:ApplicableTradeTax/ram:TypeCode` | Fest 'VAT' — benennt das Steuerschema, nicht einen Wert des Belegs. |
| `…/ram:ApplicableHeaderTradeSettlement/ram:ApplicableTradeTax/ram:TypeCode` | Fest 'VAT' — siehe oben. |
| `…/ram:ApplicableHeaderTradeSettlement/ram:SpecifiedTradeAllowanceCharge/ram:CategoryTradeTax/ram:TypeCode` | Fest 'VAT' — siehe oben. |
| `…/ram:ApplicableHeaderTradeSettlement/ram:SpecifiedTradeAllowanceCharge/ram:ChargeIndicator/udt:Indicator` | Unterscheidet Nachlass (false, BG-20) von Zuschlag (true, BG-21); kein eigener BT. |
| `…/ram:ApplicableHeaderTradeAgreement/ram:AdditionalReferencedDocument/ram:TypeCode` | Fest '916' (zugehöriges Dokument) — von der CII-Syntax verlangt, in der EN 16931 kein BT. |
| `…/ram:ApplicableHeaderTradeAgreement/ram:SpecifiedProcuringProject/ram:Name` | Die CII-Syntax verlangt neben der Projekt-ID einen Namen; wir spiegeln die Projektnummer aus BT-11. |
| `…/ram:ApplicableHeaderTradeSettlement/ram:SpecifiedTradePaymentTerms/ram:ApplicableTradePaymentDiscountTerms/ram:BasisPeriodMeasure` | Strukturierte Skontofrist. Das Skonto selbst trägt BT-20 als KoSIT-Konvention; CII führt es zusätzlich maschinenlesbar. |
| `…/ram:ApplicableHeaderTradeSettlement/ram:SpecifiedTradePaymentTerms/ram:ApplicableTradePaymentDiscountTerms/ram:CalculationPercent` | Siehe BasisPeriodMeasure. |
| `cac:AllowanceCharge/cbc:ChargeIndicator` | Gegenstück zu ram:ChargeIndicator — Nachlass (false) statt Zuschlag. |
| `cac:AllowanceCharge/cac:TaxCategory/cac:TaxScheme/cbc:ID` | Fest 'VAT' — benennt das Steuerschema. |
| `cac:TaxTotal/cac:TaxSubtotal/cac:TaxCategory/cac:TaxScheme/cbc:ID` | Fest 'VAT' — siehe oben. |
| `cac:InvoiceLine/cac:Item/cac:ClassifiedTaxCategory/cac:TaxScheme/cbc:ID` | Fest 'VAT' — siehe oben. |
| `cac:AccountingSupplierParty/cac:Party/cac:PartyTaxScheme/cac:TaxScheme/cbc:ID` | Unterscheidet USt-IdNr (VAT, BT-31) von Steuernummer (FC, BT-32). |
| `cac:AccountingCustomerParty/cac:Party/cac:PartyTaxScheme/cac:TaxScheme/cbc:ID` | Wie beim Verkäufer — hier immer VAT (BT-48). |

## Codelisten

Wertevorräte, die nicht plan&simple vergibt, sondern die Norm. Quelle:
`backend/einvoice/codelists.js`.

### UNTDID 1001 — Belegart (BT-3)

| Code | Bedeutung | Syntax |
|---|---|---|
| `326` | Abschlagsrechnung | UBL |
| `380` | Rechnung | CII, UBL |
| `381` | Gutschrift | CII, UBL |
| `384` | Rechnungskorrektur / Storno | CII, UBL |
| `875` | Abschlagsrechnung (Bau) | CII |
| `876` | Teilschlussrechnung (Bau) | CII |
| `877` | Schlussrechnung (Bau) | CII |

### UNTDID 5305 — Umsatzsteuerkategorie (BT-118 / BT-151)

| Code | Bedeutung | Satz 0? | Befreiungsgrund nötig? | Standardtext |
|---|---|---|---|---|
| `S` | Regelsteuersatz | nein | nein | — |
| `Z` | Nullsatz | ja | nein | — |
| `E` | Steuerbefreit | ja | ja | Steuerbefreite Leistung |
| `AE` | Reverse Charge (§13b UStG) | ja | ja | Steuerschuldnerschaft des Leistungsempfängers gem. §13b UStG |
| `K` | Innergemeinschaftlich (EU-Lieferung) | ja | ja | Innergemeinschaftliche Lieferung — steuerfrei nach §6a UStG |
| `G` | Ausfuhrlieferung (Drittland) | ja | ja | Ausfuhrlieferung — steuerfrei nach §6 UStG |
| `O` | Nicht steuerbar (z.B. §19 Kleinunternehmer) | ja | ja | Kein Ausweis von Umsatzsteuer gem. §19 UStG (Kleinunternehmer) |

### UNTDID 4461 — Zahlungsart (BT-81)

| Code | Bedeutung |
|---|---|
| `30` | Überweisung |
| `58` | SEPA-Überweisung |
| `59` | SEPA-Lastschrift |

plan&simple erzeugt ausschließlich `58`.

### UN/ECE Rec. 20 — Mengeneinheit (BT-130 / BT-150)

| Code | Bedeutung |
|---|---|
| `HUR` | Stunde |
| `LS` | Pauschale |
| `C62` | Stück (Einheit) |

### UNTDID 4451 — Betreffcode der Anmerkung (BT-21)

| Code | Bedeutung |
|---|---|
| `REG` | Regulatorische Angaben zum Verkäufer |
| `PMT` | Zahlungsinformationen |

