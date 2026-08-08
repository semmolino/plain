# E-Rechnungs-Analyse — Bestand, Lücken, Empfehlungen

> Stand: Juni 2026.
> Branche: Architekten / Planer.
> Vergleichsbasis: aktuelle Standards XRechnung 3.0.2, ZUGFeRD 2.4 / Factur-X 1.07, Peppol BIS Billing 3.0, EN 16931.

---

## TL;DR

- **Was gut ist**: solide UBL- und CII-XML-Erzeugung, korrekte Profil-IDs, gute Storno- und Schlussrechnungs-Mechanik mit Verweisen (BT-25/26), Snapshot-Persistenz für gebuchte Dokumente, Sicherheitseinbehalt sauber als Notes statt VAT-Manipulation.
- **Was kritisch fehlt**: **PDF/A-3-Embedding (ZUGFeRD ist heute nur Standalone-XML)**, **Leitweg-ID-Feld pro Adresse (BT-10 hat einen `-`-Fallback, der bei Behörden zur Ablehnung führt)**, **Projektreferenz BT-11 (kritisch für Architekten)**, **Schematron-Validierung** (Empfänger könnten generierte XMLs ablehnen), **Reverse-Charge §13b UStG** (Bauleistungen!).
- **Was komplett fehlt**: Peppol-Versand über Access Point, Stundenrechnungen mit Unit-Code HUR, Mehrstufiges Skonto, Anlagen-Embedding, Multi-Currency, echte Gutschriften-UI.

---

## 1. Was wir haben (Bestand)

### 1.1 Format-Output

| Format | Generiert? | Profile | Datei |
|---|---|---|---|
| **XRechnung 3.0 (UBL)** | ja | `urn:cen.eu:en16931:2017#compliant#urn:xeinkauf.de:kosit:xrechnung_3.0` | [services_einvoice_ubl.js](backend/services_einvoice_ubl.js) |
| **ZUGFeRD 2.4 / Factur-X 1.08 (CII)** | ja, aber nur XML | MINIMUM, BASIC_WL, BASIC, EN16931, **EXTENDED** (Default) | [services_einvoice_cii.js](backend/services_einvoice_cii.js) |
| **PDF/A-3 hybrid (ZUGFeRD)** | **NEIN** | — | nicht implementiert |
| **XRechnung 3.0 (CII-Syntax)** | nein | — | nicht implementiert (UBL-only) |
| **Peppol BIS Billing 3.0** | nicht aktiv | (XRechnung enthält den Tag, aber keine eigene Erzeugung/Versand) | nicht implementiert |
| **Peppol Access-Point-Versand** | nein | — | nicht implementiert |

### 1.2 Rechnungs-Typen (Belegart)

| Typ | DB-Wert | CII-Code | UBL-Code | UI-Wizard | Status |
|---|---|---|---|---|---|
| Rechnung | `rechnung` | 380 | 380 | [RechnungWizard.tsx](frontend-react/src/pages/rechnungen/RechnungWizard.tsx) | ✅ vollständig |
| Schlussrechnung | `schlussrechnung` | 877 | 380 | [SchlussrechnungWizard.tsx](frontend-react/src/pages/rechnungen/SchlussrechnungWizard.tsx) | ✅ vollständig, inkl. Abzug bisheriger Abschläge über `INVOICE_DEDUCTION` |
| Teilschlussrechnung | `teilschlussrechnung` | 876 | 380 | derselbe Wizard | ✅ vollständig |
| Abschlagsrechnung | (PARTIAL_PAYMENT) | 875 | 326 | [AbschlagWizard.tsx](frontend-react/src/pages/rechnungen/AbschlagWizard.tsx) | ✅ vollständig |
| Stornorechnung (von Rechnung) | `stornorechnung` | 384 | 384 | aus Rechnungsliste | ✅ inkl. Referenz auf storniertes Dokument |
| Storno einer Abschlagsrechnung | via `CANCELS_PARTIAL_PAYMENT_ID` | 384 | 384 | aus Liste | ✅ |
| **Gutschrift / Credit Note** | `gutschrift` | 381 | 381 | **keine UI** | ⚠️ nur theoretisch im Code, kein Wizard |

### 1.3 Branchen-spezifische Features

| Feature | Status | Wo |
|---|---|---|
| HOAI-Honorarberechnung (Leistungsphasen, Zonen) | ✅ | `FEE_CALCULATION_*`, [HonorarWizard.tsx](frontend-react/src/pages/projekte/HonorarWizard.tsx) |
| Flächenplanung / `area_ha` als Bemessungsgrundlage | ✅ | Migration 0054 |
| Sicherheitseinbehalt (§641 Abs. 3 BGB) | ✅ in XML als `cbc:Note`/`ram:IncludedNote`, Beträge in `PayableAmount` korrigiert, USt unverändert | `services_einvoice_data.js` Phase 12 |
| Auflösung Sicherheitseinbehalt bei Schlussrechnung | ✅ | `SE_RELEASE_TOTAL`, `SE_RELEASED_BY_INVOICE_ID` |
| Abschläge mit prozentualem Aufbau pro Strukturelement | ✅ | `INVOICE_STRUCTURE`, `AMOUNT_NET`, `AMOUNT_EXTRAS_NET` |
| Nebenkosten / Auslagen (Extras) | ✅ als Note in Position | `AMOUNT_EXTRAS_NET` separat geführt |
| Vertrags-Referenz | ✅ BT-12 | `CONTRACT_NUMBER` |
| Skonto | ✅ einstufig | `CASH_DISCOUNT_*` |
| Document-Level Nachlass (2 Stufen) | ✅ | `DISCOUNT_1/2_*` |

### 1.4 Snapshot / Immutability

- Nach Buchung (`STATUS_ID = 2`) wird XML als Asset persistiert (`DOCUMENT_XML_ASSET_ID`, `DOCUMENT_XML_PROFILE`, `DOCUMENT_XML_RENDERED_AT`).
- Bei späterem Download wird der Snapshot zurückgegeben, nicht neu generiert. **Sehr gut**: Rechtssicherheit, gleicher Inhalt wie an Empfänger geschickt.
- Auch für PARTIAL_PAYMENT analog implementiert.

### 1.5 Export-Wege

| Weg | Wo |
|---|---|
| **HTTP Download** (XML inline) | Buttons im Wizard und in Rechnungsliste, `?format=ubl` oder `?format=cii&profile=...` |
| **E-Mail-Versand** mit XML als Anhang | wenn SMTP gesetzt, via Mahnungen/Rechnungen-Endpoints |
| **PDF-Download** (Nunjucks-Template invoice.njk + Playwright) | ja |
| **PDF/A-3 mit eingebettetem XML** | **NEIN** |
| **Peppol-Versand** | **NEIN** |
| **DE-Mail / OZG-RE / ZRE-Portal-Upload** | **NEIN** (User muss XML manuell hochladen) |

---

## 2. Was vorhanden ist, aber Mängel hat

### 2.1 KRITISCH — würde echte Ablehnung verursachen

#### 🔴 **Buyer Reference / Leitweg-ID (BT-10) — `-`-Fallback**

Code:
```js
<ram:BuyerReference>${x(data.buyerReference || '-')}</ram:BuyerReference>
```

Ist technisch valide XRechnung-XML, aber:
- Bei Bundes-/Landesbehörden **Pflichtfeld** mit validem Leitweg-ID-Format (z.B. `991-12345-67`). „-" wird vom OZG-RE/ZRE-Portal als ungültig abgewiesen.
- Es fehlt ein **explizites UI-Feld pro Adresse oder pro Vertrag** für die Leitweg-ID.
- Bei B2B unwichtig — bei B2G **Showstopper**.

**Empfehlung**: ADDRESS-Tabelle um Feld `LEITWEG_ID` erweitern, im Rechnungs-Wizard verpflichtend wenn Empfänger als „Behörde" markiert. Vorher hartes Stop in der UI mit Hinweis.

#### 🔴 **Projekt-Referenz BT-11 wird nicht ins XML geschrieben**

Code lädt `projectNumber` in [services_einvoice_data.js#L367](backend/services_einvoice_data.js#L367), nutzt es aber **nirgendwo im XML**. Sowohl CII (`ram:SpecifiedProcuringProject`) als auch UBL (`cac:ProjectReference`) hätten den passenden Block.

Für Architekten **das wichtigste Strukturfeld überhaupt** — Empfänger ordnen Rechnungen einem Projekt zu.

#### 🔴 **Order Reference BT-13 immer leer**

```js
orderNumber: '',
```

Bei Vergabeverfahren / VOB-Aufträgen ist die Bestellnummer Pflicht. Keine Datenbankfeld, kein UI.

#### 🔴 **Reverse-Charge §13b UStG nicht abbildbar**

VAT-Category-Code wird hartcodiert auf:
```js
const vatCategory = vatPercent > 0 ? 'S' : 'Z';
```

Für Bauleistungen mit Übergang der Steuerschuldnerschaft (§13b UStG) braucht es VAT-Category `AE` plus BT-122 (Exemption Reason Code) und BT-123 (Reason Text). **Für Architekten/Bau zwingend** wenn an Bauträger fakturiert wird.

Ebenfalls fehlend:
- `E` — Tax exempt
- `G` — Export außerhalb EU
- `K` — Reverse charge innergemeinschaftlich
- `O` — Kleinunternehmer §19 UStG

#### 🔴 **Keine Schematron-Validierung**

Wir generieren XML, aber prüfen es nicht gegen die offiziellen Schematron-Regeln (BR-CO-*, BR-DE-* etc.). Es gibt zwar Kommentare im Code zu einzelnen BR-Regeln (z.B. BR-CO-25), aber keinen systematischen Check.

**Konsequenz**: User glaubt „funktioniert", schickt raus, Empfänger lehnt mit kryptischer Fehlermeldung ab.

**Empfehlung**: vor Ausgabe automatisch durch [KoSIT Validator](https://github.com/itplr-kosit/validator) jagen, Fehler hart blockieren.

### 2.2 Wichtig — funktioniert, aber unpräzise

#### 🟠 **Pauschal-Unit „LS" statt HUR für Stundenrechnungen**

```js
unitCode: 'LS',  // hardcoded "lump sum" für jede Zeile
quantity: 1,
```

Bei Stundensatz-Verträgen (BILLING_TYPE_ID=2) sollte:
- `unitCode = "HUR"` (Stunden)
- `quantity = tatsächliche Stundenanzahl`
- `unitPrice = Stundensatz`

Empfänger mit ERP-System tracken Stunden vs. Pauschalen unterschiedlich.

#### 🟠 **Skonto: nur eine Stufe**

`#SKONTO#TAGE=X#PROZENT=Y#` — Convention der KoSIT, aber nur einstufig modelliert. Realität bei Architekten:
- 2 % Skonto bei Zahlung in 14 Tagen
- 1 % bei 30 Tagen
- 60 Tage netto

Wir haben DB-Felder nur für eine Stufe (`CASH_DISCOUNT_PERCENT`, `CASH_DISCOUNT_DAYS`).

#### 🟠 **Document-Level Nachlässe (BT-92 ff.) — Zuschläge fehlen**

Wir haben 2 Allowance-Slots (Nachlässe), aber **keine Charges** (Zuschläge auf Dokumentebene). Für Auslagenpauschale, Anfahrtspauschale etc. wäre `<ram:SpecifiedTradeAllowanceCharge ChargeIndicator=true>` der Weg. Nicht implementiert.

#### 🟠 **Stornorechnung mit positiven Beträgen**

`typeCode 384` ist korrekt, aber wir lassen die Beträge positiv. EN 16931 sagt nicht eindeutig, aber **viele Empfänger erwarten negative Beträge bei Storno**. Sollte konfigurierbar oder per Default negiert sein.

#### 🟠 **Sicherheitseinbehalt: nur als Note, nicht als ChargeIndicator**

Aktuell saubere Lösung (USt korrekt) — aber im EXTENDED-Profil hätten wir den Raum für strukturierte Abbildung mit `<ram:Description>` und definierten Kategorien. Maschinell-lesbar wäre besser.

#### 🟠 **Buyer Contact (BT-56-60) fehlt**

Nur `buyer.email` ist gesetzt — Name/Telefon/Fax des Kundenansprechpartners fehlen. CONTACT-Tabelle hat die Felder, aber sie fließen nicht ins XML.

### 2.3 Eher kosmetisch / Edge Cases

#### 🟡 **Currency hardcoded EUR**

Code unterstützt CURRENCY_ID, aber im praktischen Einsatz nur EUR. Multi-Currency-Mandanten könnten theoretisch auch andere setzen, sind aber wahrscheinlich nicht der Standardfall für deutsche Architekturbüros.

#### 🟡 **REG-Note immer mit Firmenadresse**

Wir packen die Firmenanschrift immer als `<ram:IncludedNote SubjectCode=REG>` rein. Bewährt, aber redundant mit `SellerTradeParty`. Manche Validatoren mögen das nicht.

#### 🟡 **Item Description nur als String, keine Klassifikation**

BT-141 (Item attribute), BT-142 (Item classification — CPV-Code), BT-157 (Item description) — wir geben nur ein Name-Feld. Für öffentliche Auftraggeber mit CPV-Klassifikation könnte das wichtig werden.

---

## 3. Was komplett fehlt

### 3.1 PDF/A-3 hybride Ausgabe (ZUGFeRD-Kern)

**Das größte konzeptionelle Loch.**

ZUGFeRD/Factur-X bedeutet per Definition: **ein PDF, das die XML als Anhang in PDF/A-3-Konformität enthält**. Aktuell:
- Wir liefern ein PDF (visuell) UND ein XML (separat). Empfänger muss beide nehmen.
- Echtes ZUGFeRD = **eine** Datei, die menschen-lesbar (PDF) und maschinen-lesbar (eingebettete XML) ist.

**Empfänger-Erwartung**: PDF an E-Mail anhängen → reicht. Buchhaltungssoftware ziehst die XML automatisch raus.

**Aufwand**: Nunjucks-PDF generiert → durch `pdf-lib` oder `pdfkit` PDF/A-3-Schema konvertieren → XML als `application/xml` Embedded File anhängen → Metadaten (DocumentType, Description) korrekt setzen → Schmellprüfung gegen ZUGFeRD-Validator.

**Branchen-Erwartung**: Architektur-Branche schickt heute überwiegend ZUGFeRD-PDF. Reine XRechnung-XML bekommt eher die öffentliche Hand.

### 3.2 Peppol BIS Billing 3.0 — Format + Versand

Aktuelle Code-Stelle:
```xml
<cbc:ProfileID>urn:fdc:peppol.eu:2017:poacc:billing:01:1.0</cbc:ProfileID>
```

Diese ProfileID ist im XRechnung-XML drin (XRechnung 3.0 IST kompatibel mit Peppol BIS), aber:
- **Wir haben keine Peppol-spezifische Erzeugung**, die sich von XRechnung unterscheidet
- **Wir versenden nicht via Peppol Access Point** (AS4-Protokoll)
- Für reinen B2B-Direktversand (E-Mail-Anhang) ist das egal
- Für **Versand an Kommunen über Peppol-Netzwerk** brauchen wir einen Access-Point-Provider (z.B. Seeburger, Hubbroker, ecosio) und API-Integration

**Empfehlung**: erstmal nicht. Nur wenn konkrete Kunden Peppol-Versand verlangen → später als Add-on (~3-5 Tage Integration mit Provider).

### 3.3 Echte Gutschriften (Credit Note) als separater Beleg-Typ

Code mapt `gutschrift` → TypeCode 381, aber:
- Kein UI-Flow „Gutschrift erstellen" (nur Storno)
- Keine eigene Datenmodellierung
- Eine Gutschrift ist **nicht das Selbe wie ein Storno** — Gutschrift ist eine Korrektur ohne den ursprünglichen Beleg zu „löschen"

Für Architekten relevant z.B. bei nachträglichen Nachlässen oder Anerkennung eines Mangelminderungsbetrags.

### 3.4 Anlagen / Attachments (EXTENDED-Profil)

Können im EXTENDED-Profil eingebettet werden (`ram:AdditionalReferencedDocument` mit `BinaryObject`). Praxis-Anwendung: Stundenzettel, Aufmaß-PDF, Fotos. Aktuell unmöglich.

### 3.5 Despatch / Delivery / Recipient Trade Party

- BT-71 (Despatch advice ref)
- BT-72 (Actual delivery date) — wir nutzen `billingPeriodEnd` als Fallback, ok
- BT-75-78 (Payee party, wenn Empfänger ≠ Verkäufer) — nicht relevant für die meisten Architekten, aber Treuhand-Konten in Bauprojekten kommen vor

### 3.6 Multi-Stage Steuersätze

Aktuell EINE VAT-Rate pro Dokument. Bei gemischten Leistungen (z.B. Planung 19 % + Reisekosten 7 % oder 0 %) bräuchten wir pro Position eine eigene Rate. Code hat `line.vatRate`, aber die zentrale Tax-Summary geht von einer Rate aus.

### 3.7 Validierung / Validator-Integration

Bevor die XML zum Empfänger geht, sollte sie durch:
- **XSD-Validierung** (Strukturkonformität)
- **Schematron** (Geschäftsregeln) — KoSIT-Validator hat alle Regelsätze
- **Peppol-Validator** für Peppol-Versand

Aktuell: nichts. Wir hoffen.

### 3.8 E-Mail-Versand mit korrekter MIME-Struktur

Wir können E-Mail versenden, aber die Anhang-MIME-Type-Definition für „echte E-Rechnung" wäre:
- PDF + XML separat: `application/pdf` + `application/xml`
- ZUGFeRD-Hybrid: `application/pdf` (mit XML inside)
- Reine XRechnung: `application/xml`

Wenn das Postfach des Empfängers automatisch verarbeitet, muss MIME-Type exakt stimmen. Wir setzen das vermutlich richtig, aber: nicht explizit dokumentiert/getestet.

---

## 4. BT-Felder Coverage-Matrix (EN 16931)

Auswahl der praxis-relevanten BT-Felder:

| BT | Feld | Pflicht | Wir | UI editierbar? |
|---|---|---|---|---|
| BT-1 | Invoice number | ✅ | ✅ | auto-generiert |
| BT-2 | Issue date | ✅ | ✅ | ja |
| BT-3 | Invoice type code | ✅ | ✅ | abgeleitet aus INVOICE_TYPE |
| BT-5 | Currency | ✅ | ✅ EUR | nein (hardcoded EUR) |
| BT-6 | VAT accounting currency | optional | nein | — |
| BT-7 | Value added tax point date | optional | **nein** | — |
| BT-8 | VAT point date code | bedingt | **nein** | — |
| BT-9 | Payment due date | bedingt | ✅ | ja |
| **BT-10** | **Buyer reference / Leitweg-ID** | ✅ bei B2G | ⚠️ `-`-Fallback | **fehlt** |
| **BT-11** | **Project reference** | optional, aber wichtig | ⚠️ geladen, **nicht ins XML** | nein |
| BT-12 | Contract reference | optional | ✅ | nein (auto aus Vertrag) |
| **BT-13** | **Purchase order reference** | optional, aber wichtig | ❌ leer | **fehlt** |
| BT-14 | Sales order reference | optional | ❌ | — |
| BT-15-17 | Receipt/Despatch/Tender ref | optional | ❌ | — |
| BT-19 | Buyer accounting reference (Kostenstelle) | optional, aber wichtig | ❌ | **fehlt** |
| BT-20 | Payment terms | bedingt | ⚠️ nur Fallback | nein |
| BT-22 | Invoice note | optional | ✅ | ja (Kommentar-Feld) |
| BT-23 | ProfileID | ✅ | ✅ | nein |
| BT-24 | CustomizationID | ✅ | ✅ XRechnung 3.0 / ZUGFeRD 2.4 | nein |
| BT-27 | Seller name | ✅ | ✅ | ja (Firma) |
| BT-29 | Seller identifier | optional | ❌ | — |
| **BT-30** | **Seller legal registration (HRB-Nr)** | bedingt | ❌ | **fehlt** |
| BT-31 | Seller VAT ID | ✅ wenn ust-pflichtig | ✅ | ja (Firma) |
| BT-32 | Seller tax ID (Steuernummer) | optional | ✅ | ja |
| BT-33 | Seller additional legal info | optional | ❌ | — |
| BT-34 | Seller electronic address | ✅ ab 2024 | ✅ via URIID scheme EM | ja |
| BT-35-37 | Seller postal address | ✅ | ✅ | ja |
| BT-40 | Seller country | ✅ | ✅ | ja |
| BT-41-43 | Seller contact name/phone/email | bedingt | ✅ | ja (Mitarbeiter) |
| BT-44 | Buyer name | ✅ | ✅ | ja (Adresse) |
| BT-45 | Buyer trading name | optional | ❌ | — |
| BT-46 | Buyer identifier | optional | ❌ | — |
| BT-47 | Buyer legal registration | optional | ❌ | — |
| BT-48 | Buyer VAT ID | bedingt | ✅ | ja |
| BT-49 | Buyer electronic address | ✅ ab 2024 | ✅ | ja |
| BT-50-52 | Buyer postal address | ✅ | ✅ | ja |
| BT-55 | Buyer country | ✅ | ✅ | ja |
| BT-56-60 | Buyer contact | optional | ⚠️ nur email | **teilweise** |
| BT-63 | Tax representative | bedingt | ❌ | — |
| BT-72 | Actual delivery date | ✅ wenn Lieferung | ✅ via Period-Ende-Fallback | ja (Leistungszeitraum) |
| BT-73-74 | Invoice period | optional | ✅ | ja |
| BT-75-78 | Payee party | bedingt | ❌ | — |
| BT-81 | Payment means type code | ✅ | ✅ 58 (SEPA) | nein |
| BT-83 | Remittance information (Verwendungszweck) | optional, aber wichtig | ⚠️ nicht gesetzt | **fehlt** |
| BT-84 | Payee account ID (IBAN) | bedingt | ✅ | ja (Firma) |
| BT-85 | Account name | optional | ❌ | — |
| BT-86 | Payment service provider ID (BIC) | optional | ✅ | ja |
| BT-89-93 | Cash discount + Document Allowances | optional | ✅ 1-stufig + 2 Allowances | ja |
| BT-94-100 | **Document Charges (Zuschläge)** | optional, aber wichtig | ❌ | **fehlt** |
| BT-106-115 | Monetary totals | ✅ | ✅ | berechnet |
| BT-116-119 | VAT breakdown | ✅ | ✅ | nur einfach (eine Kategorie) |
| BT-120-121 | VAT category note | optional | ❌ | — |
| **BT-122-123** | **VAT exemption reason** | ✅ bei `AE`/`E`/`G` etc. | ❌ | **fehlt — Reverse Charge unmöglich** |
| BT-126 | Invoice line ID | ✅ | ✅ | auto |
| BT-127 | Invoice line note | optional | ✅ | nein (nur bei Nebenkosten) |
| BT-128 | Invoiced object identifier | optional | ❌ | — |
| BT-129 | Quantity | ✅ | ⚠️ immer 1 (Pauschal) | nein |
| **BT-130** | **Unit code** | ✅ | ⚠️ immer LS | nein (sollte HUR bei Std.) |
| BT-131 | Line net amount | ✅ | ✅ | berechnet |
| BT-132-133 | Order / Buyer accounting ref per line | optional | ❌ | — |
| BT-134-135 | Line invoice period | optional | ✅ | ja |
| BT-136-141 | Line allowances / charges | optional | ❌ | — |
| BT-146 | Item net price | ✅ | ✅ | berechnet |
| BT-149 | Item base quantity | optional | ✅ | nein |
| BT-151 | Item VAT category | ✅ | ✅ aber nur S/Z | nein |
| BT-152 | Item VAT rate | bedingt | ✅ | nein |
| BT-153 | Item name | ✅ | ✅ | nein |
| BT-154 | Item description | optional | ❌ | — |
| BT-155-158 | Item classification (CPV) | optional | ❌ | — |
| BT-161 | Buyer item identifier | optional | ❌ | — |

**Zusammenfassung Coverage**:
- Kerngeschäft (Pflichtfelder EN 16931): **gut abgedeckt**
- Branchen-Spezifika (Projekt, Bestellung, Kostenstelle, Reverse Charge): **lückenhaft**
- Detailfelder (Klassifikation, Anlagen, Mehrstufiges): **fehlend**

---

## 5. Empfehlungen — priorisiert

### P0 — sofort (rechtliche / praktische Showstopper)

1. **Leitweg-ID-Feld an ADDRESS** plus Pflicht-Check im Wizard bei „Behörde-Adresse".
2. **Projekt-Referenz (BT-11) tatsächlich ins XML schreiben** — paar Zeilen Code in beiden Generatoren.
3. **Reverse-Charge §13b** — VAT-Category-Auswahl im UI (S/AE/E/Z/O), BT-122/123 Felder hinzu, Pflicht-Note „Steuerschuldnerschaft des Leistungsempfängers" bei AE.
4. **PDF/A-3 hybride Ausgabe** — der eine Punkt der ZUGFeRD-Ausgabe der jetzt fehlt; mit `pdf-lib` machbar (~2-3 Tage Aufwand).
5. **Schematron-Validierung vor Versand** — KoSIT-Validator als Docker-Container nebenher laufen lassen oder Library einbinden, harte Blockade bei Errors.

### P1 — wichtig (häufig benötigt)

6. **Document Charges (Zuschläge BT-94 ff.)** — symmetrisch zu Allowances.
7. **Buyer Order Reference (BT-13)** — eigenes Feld pro Vertrag oder pro Rechnung.
8. **Buyer Accounting Reference / Kostenstelle (BT-19)** — ähnlich.
9. **Mehrstufiges Skonto** — DB-Erweiterung + UI + XRechnung-Skonto-Notation in Stufen.
10. **Stundenrechnungen mit Unit HUR**, Quantity = Stundenanzahl, Unit-Price = Stundensatz statt Pauschal-LS.
11. **Echte Gutschriften-UI** — Wizard analog zur Storno-Logik, aber als 381 mit positiven Beträgen.
12. **Buyer Contact (BT-56-60)** — vorhandene CONTACT-Felder ins XML durchreichen.

### P2 — gut zu haben

13. **Document-level Charges + Allowances pro Position** (Zeilen-Nachlass / -Zuschlag).
14. **Anlagen-Embedding** im EXTENDED-Profil.
15. **Multi-Currency** wenn ein Mandant es braucht.
16. **Item-Classification CPV-Codes** für öffentliche Auftraggeber.
17. **Sicherheitseinbehalt strukturierter** im EXTENDED-Profil.
18. **Mehrere VAT-Raten pro Dokument** (gemischt 19/7/0).

### P3 — Strategie / Add-on

19. **Peppol-Versand** über Access Point (Provider-Integration).
20. **Direkt-Upload zu OZG-RE / ZRE / LERA** (Behördenportale) per API wenn jemand das wirklich will.
21. **DE-Mail-Versand**.

---

## 6. Bonus: Validator-Tooling

Tools die ich für die Validierung empfehle (alle kostenlos):

- **[KoSIT Validator](https://github.com/itplr-kosit/validator)** — XSD + Schematron in einem. Docker-Image verfügbar. Kann als Sidecar mitlaufen.
- **[Mustangproject](https://www.mustangproject.org)** — Java/CLI, kann ZUGFeRD-PDFs erzeugen UND validieren UND Schematron checken. Sehr nützlich für PDF/A-3-Erzeugung.
- **[Online-Validator KoSIT](https://erechnungsvalidator.service-bw.de)** — schnell zum manuellen Testen einer XML.
- **[FeRD ZUGFeRD-Validator](https://www.ferd-net.de/zugferd/)** — speziell für CII.
- **[Peppol-Validator](https://peppolvalidator.com)** — für den späteren Peppol-Schritt.

---

## 7. Was würde ich konkret zuerst angehen

Wenn du die nächsten Schritte „in Reihenfolge" angegangen willst, vorgeschlagene Reihenfolge:

1. **Eine Migration + eine UI-Erweiterung**: ADDRESS um `LEITWEG_ID` + im Adress-Modal pflichtig machen wenn „Behörde"-Flag. Aufwand: ~2 Std.
2. **Projekt-Referenz BT-11 in XML**: 2 Stellen Code, einmal CII einmal UBL. Aufwand: ~30 Min.
3. **Reverse-Charge §13b**: VAT-Category-Auswahl im Vertrag (Default für alle Rechnungen aus diesem Vertrag) + Pflicht-Note. Aufwand: ~3 Std.
4. **PDF/A-3 hybride Ausgabe**: PDF-Generation umstellen, dass das fertige PDF + die XML in einem PDF/A-3 landen. Aufwand: ~1-2 Tage. Größter Mehrwert für die Praxis.
5. **Schematron-Validator-Integration**: vor Buchung/Snapshot durch KoSIT-Validator jagen. Aufwand: ~1 Tag.

Nach diesen 5 Punkten wäre die E-Rechnung **alltagstauglich für Architekten in DE 2026**.

---

## Quellen (Standards-Recherche)

- [E-Rechnung Bund — Standard XRechnung 3.0.1+](https://e-rechnung-bund.de)
- [XStandards Einkauf — XRechnung Spezifikation](https://xeinkauf.de/xrechnung/)
- [ZUGFeRD 2.4 — FeRD-Net](https://www.ferd-net.de/en/downloads/publications/details/zugferd-233-english)
- [Peppol BIS Billing 3.0](https://docs.peppol.eu/poacc/billing/3.0/)
- [Leitweg-ID — Aufbau und Pflicht (BT-10)](https://leitweg-id.de/en/buyer-reference-bt-10/)
- [E-Rechnungspflicht für Architekten — Bayerische Architektenkammer](https://www.byak.de/aktuelles/newsdetail/einfuehrung-der-e-rechnung.html)
- [E-Rechnung im Bauwesen — BauNetz Wissen](https://www.baunetzwissen.de/controlling-und-management/fachwissen/honorar-und-abrechnung/e-rechnung---x-rechnung-8492454)
- [HOAI.de — E-Rechnung Hintergrund](https://www.hoai.de/allgemein/e-rechnung/)
