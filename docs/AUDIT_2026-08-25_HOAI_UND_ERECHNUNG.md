# Audit: HOAI-Kalkulation und E-Rechnung

**Datum:** 25.08.2026
**Stand:** Commit `6f82e89`, Branch `design/aeline-preview`, Arbeitsverzeichnis sauber
**Umfang:** Baseline-Audit beider Modulbereiche, kein Diff-Review
**Methode:** Zwei getrennte Review-Durchläufe nach den Vorgaben in `.claude/agents/hoai-kalkulation-reviewer.md` und `.claude/agents/erechnung-reviewer.md`. Der Audit selbst war reines Lesen. Die anschließenden Korrekturen sind in Teil 3 dokumentiert.

## Lesehinweis: Sicherheitsgrade

Die Befunde sind nach Belegbarkeit gekennzeichnet. Das ist wichtiger als ihre Reihenfolge:

- **[verifiziert]** — im Code gegengeprüft, Behauptung und Wirkungskette bestätigt
- **[belegt]** — direkt aus dem gelesenen Code ableitbar
- **[unsicher: …]** — die Aussage steht, die genannte Norm- oder Regelnummer ist **nicht** gesichert und muss vor einer Umstellung gegen die Quelle geprüft werden

Wo eine Regelnummer fehlt, fehlt sie absichtlich.

## Status

Behobene Befunde tragen **✅ BEHOBEN** in der Überschrift und am Ende des Abschnitts eine Notiz, was geändert wurde und wie es geprüft wurde. Alles ohne Markierung ist offen. Teil 3 führt die behobenen Punkte zusätzlich gesammelt auf.

---

# Teil 1 — E-Rechnung

Gelesene Kette: `services_einvoice_data.js` → `services_einvoice_validator.js` → `services_einvoice_cii.js` / `services_einvoice_ubl.js` → `services_einvoice_pdf_embed.js` → `services_bt_mapping.js`, dazu die aufrufenden Controller und `docs/EINVOICE_ANALYSIS.md`.

## Normverstöße

### N1 — Validator und Datenmodell haben unterschiedliche Feldnamen [verifiziert] — ✅ BEHOBEN

`services_einvoice_validator.js:117` prüft `l.name`, `:203` prüft `t.netTotal` / `t.lineNetTotal`.
`services_einvoice_data.js:324` liefert `description`, `:554` liefert `totals.lineTotal`.
`netTotal` und `lineNetTotal` kommen in `services_einvoice_data.js` an **keiner** Stelle vor (per Grep bestätigt).

Folge: BR-22 feuert je Position, BR-12 einmal — für jede real geladene Rechnung. `v.ok` ist **immer** `false`.

Das Buchungs-Gate hängt daran (`services/invoices.js:877`, analog `services/partialPayments.js:726`, `services/finalInvoices.js:475`):

    if (!v.ok && !force) { err.status = 422; throw err; }

Entweder ist Buchen ohne `force=true` unmöglich, oder `force` ist zur Gewohnheit geworden — dann ist die gesamte Vorprüfung faktisch abgeschaltet.

**Warum es nie auffiel:** `tests/einvoice_validator.test.js:15,19,20` baut das Fixture in der Sprache des Validators (`name`, `lineNetTotal`, `netTotal`) — in einer Form, die `loadInvoiceData` nie zurückgibt. Der Test ist grün und beweist nichts.

Syntax: beide (der Validator sitzt vor CII und UBL).

**✅ Behoben am 25.08.2026.** `services_einvoice_validator.js` liest jetzt die Feldnamen, die `loadInvoiceData` tatsächlich liefert:

| vorher | jetzt |
|---|---|
| `l.name` | `l.description` |
| `t.netTotal` / `t.lineNetTotal` | `t.lineTotal` |

Das Fixture in `tests/einvoice_validator.test.js` wurde auf dieselbe Sprache umgestellt — es beschrieb vorher eine Datenstruktur, die nie existiert hat. Zwei Regressionstests halten das fest: BR-22 über `description`, BR-12 über `totals.lineTotal`.

### N2 — Positionssumme wird nie gegen die Steuerbasis geprüft [belegt] — ✅ BEHOBEN

`services_einvoice_validator.js:218` verwendet `t.lineNetTotal ?? t.netTotal ?? lineSum` — da beide Felder fehlen, vergleicht BR-CO-10 `lineSum` mit sich selbst und kann nicht auslösen. Eine Prüfung „Steuerbasis = Positionssumme − Nachlässe + Zuschläge" existiert nicht.

`taxBasis` kommt aus `doc.TOTAL_AMOUNT_NET` (`services_einvoice_data.js:439`), die Positionssumme aus je Position gerundeten Werten (`:296-298`, aufsummiert `:431`). Jede `INVOICE_STRUCTURE`-Zeile kann bis 0,005 EUR driften; ab etwa 5 Strukturelementen reißt das die interne Toleranz von 0,02 EUR. Der Empfänger meldet BR-CO-13 (BT-109) bzw. BR-S-08 (BT-116) und weist ab — intern fällt nichts auf.

Syntax: beide.

**✅ Behoben am 25.08.2026.** `services_einvoice_validator.js` prüft jetzt BR-CO-13 (BT-109 = BT-106 − BT-107 + BT-108) gegen `totals.allowanceTotal` und `totals.chargeTotal`, mit derselben Toleranz von 0,02 EUR. Zwei Tests decken die Abweichung und die korrekte Verrechnung von Nachlässen und Zuschlägen ab.

**Erwartete Nebenwirkung:** BR-CO-10 war durch N1 wirkungslos und ist jetzt zusammen mit BR-CO-13 scharf. Rechnungen mit realer Rundungsdrift über 0,02 EUR werden dadurch beim Buchen abgelehnt. Das ist beabsichtigt — der Empfänger hätte sie ebenfalls abgelehnt —, kann aber bestehende Datenprobleme sichtbar machen.

### N3 — Storno erzeugt negativen Einzelpreis (BT-146) [belegt] — ✅ BEHOBEN

`services_einvoice_data.js:534` → `services_einvoice_cii.js:316` (`ram:ChargeAmount`), `services_einvoice_ubl.js:166` (`cbc:PriceAmount`).

Jede Stornorechnung erzeugt einen negativen `PriceAmount`. BR-27 verbietet den negativen Nettopreis; der negative `LineExtensionAmount` wäre dagegen zulässig. Prüfportale weisen fatal ab.

Syntax: beide.

**✅ Behoben am 25.08.2026.** Der Storno negiert in `services_einvoice_data.js` nicht mehr den Einzelpreis, sondern die Menge. BT-146 bleibt damit positiv (BR-27 erfüllt), die negative Menge BT-129 ist zulässig, und Menge × Preis = Positionsbetrag bleibt rechnerisch konsistent.

### N4 — Preis-Basismenge (BT-149) wird mit der Rechnungsmenge gefüllt [belegt] / [unsicher: Peppol-Regelnummer] — ✅ BEHOBEN

`services_einvoice_cii.js:317` (`ram:BasisQuantity`) und `services_einvoice_ubl.js:167` (`cbc:BaseQuantity`) setzen beide `line.quantity`. BT-149 ist aber die Menge, **auf die sich der Preis bezieht**.

Bei Stundenpositionen (`services_einvoice_data.js:309-320`, `unitCode='HUR'`, `unitPrice = amountNet / hours`) rechnet der Empfänger 37,5 × (120,00 / 37,5) = **120,00 EUR statt 4.500,00 EUR**.

Im EN-16931-Kern wird diese Arithmetik nicht geprüft — es kommt durch die Schemaprüfung und schlägt erst im ERP des Empfängers als falscher Betrag auf. Das ist der teurere Fall. Korrekt wäre `1` oder Weglassen des Elements.

Pauschalpositionen (`LS`, `quantity=1`) sind zufällig richtig. **Nur Stundenrechnungen betroffen** — also der neu gebaute Pfad.

**✅ Behoben am 25.08.2026 — als notwendige Folge von N3.** Beide Builder setzten BT-149 auf `line.quantity`; mit der negierten Storno-Menge aus N3 wäre daraus eine negative Basismenge geworden. `services_einvoice_cii.js:317` und `services_einvoice_ubl.js:167` setzen die Basismenge jetzt fest auf 1.

Verifiziert am erzeugten XML für das Storno einer Stundenrechnung (−37,5 Std. à 120 €):

| | UBL | CII |
|---|---|---|
| Menge (BT-129) | −37.50 | −37.50 |
| Einzelpreis (BT-146) | 120.00 | 120.00 |
| Basismenge (BT-149) | 1.00 | 1.00 |
| Positionsbetrag (BT-131) | −4500.00 | −4500.00 |

−37,5 × 120 ÷ 1 = −4500 — in beiden Syntaxen konsistent, kein negativer Preis mehr.

### N5 — Leere Käuferreferenz wird als leeres Element geschrieben [belegt] / [unsicher: BR-DE-15 vs. BR-DE-1] — ✅ BEHOBEN

`services_einvoice_cii.js:376` und `services_einvoice_ubl.js:224` geben das Element immer aus, notfalls leer.

Zwei Probleme. Der Kommentar in `services_einvoice_validator.js:253` hält fest, BT-10 sei „Pflicht für B2G, optional für B2B" — für die XRechnung-CIUS verlangt das KoSIT-Schematron BT-10 für **jede** XRechnung. Und ein leeres `cbc:BuyerReference` ist schlechter als gar keins, weil es zusätzlich über die Leerelement-Prüfung fällt. Der Validator meldet nur eine Warnung, unter einem vermutlich falschen Regelcode (siehe S4).

Der frühere `-`-Fallback ist beseitigt; das leere Element ist der Nachfolgebefund.

**Behoben am 26.08.2026.** Beide Builder geben das Element nur noch aus, wenn eine Käuferreferenz vorliegt. Der Regelcode der Warnung ist auf `BR-DE-15` korrigiert (siehe S4) — die im Befundtitel offene Frage ist damit im Sinne von BR-DE-15 entschieden, die Nummer selbst bleibt ungeprüft.

**Nicht entschieden:** ob BT-10 zur Hartpflicht werden soll. Der Kommentar im Validator behauptet weiterhin „Pflicht für B2G, optional für B2B"; der Befund hält dagegen, dass das KoSIT-Schematron BT-10 für jede XRechnung verlangt. Das ist eine Entscheidung mit derselben Wirkung wie N6/N7 — sie würde Belege ohne Leitweg-ID vom Buchen aussperren. Bewusst offen gelassen.

Abgesichert durch `tests/einvoice_builders.test.js` (2 Tests: kein leeres Element, vorhandene Referenz bleibt).

Syntax: beide.

### N6 — Ohne IBAN fehlt die komplette Zahlungsinformation (BG-16) [belegt] — ✅ BEHOBEN

`services_einvoice_cii.js:160` bricht ohne IBAN ab, `services_einvoice_ubl.js:297` stellt den gesamten `cac:PaymentMeans`-Block unter dieselbe Bedingung.

Ein Mandant ohne gepflegte IBAN erzeugt eine Rechnung ohne BG-16 → Abweisung. Der Validator prüft die IBAN nur auf Format und nur, wenn sie vorhanden ist (`:247-250`, nur `warning`). Eine fehlende IBAN wird nirgends beanstandet.

**Behoben am 26.08.2026** in `services_einvoice_validator.js`. Die Formatprüfung ist um den Fall „gar keine IBAN" ergänzt, als `error` unter `BR-DE-1`/BT-84 mit dem Hinweis auf die Firmenstammdaten. Eine vorhandene, aber unplausible IBAN bleibt bewusst eine Warnung — sie erzeugt ein BG-16, nur womöglich ein falsches.

Die Builder bleiben unverändert: beide kennen als Zahlungsart nur die SEPA-Überweisung (TypeCode 58), und ohne IBAN ist dieser Block inhaltlich leer. Eine Rechnung ohne Bankverbindung ist damit nicht mehr ohne `force=true` buchbar — das ist gewollt, weil sie beim Empfänger ohnehin durchfällt.

Abgesichert durch 2 Tests (fehlende IBAN → Error, unplausible IBAN → weiterhin nur Warnung).

### N7 — Verkäufer-Ansprechpartner (BG-6) ist optional statt Pflicht [belegt] — ✅ BEHOBEN

`services_einvoice_cii.js:106-111`, `services_einvoice_ubl.js:261-266`: Kontaktblock nur bei vorhandenem `contactName`, Telefon und Mail einzeln bedingt.

Fehlt beim `EMPLOYEE` die Telefonnummer (`services_einvoice_data.js:147`), entsteht ein BG-6 ohne BT-42 → Abweisung. Der Validator prüft BG-6 überhaupt nicht.

**Behoben am 26.08.2026** in `services_einvoice_validator.js`. Alle drei Felder der Gruppe werden jetzt einzeln als `error` geprüft: BT-41 (`BR-DE-5`), BT-42 (`BR-DE-6`), BT-43 (`BR-DE-7`). Die Meldung nennt die Stelle zum Nachpflegen („beim Mitarbeiter hinterlegen"), weil die Daten aus dem `EMPLOYEE` des Belegs stammen.

Die Feldnamen `contactName`/`contactPhone`/`contactEmail` wurden gegen `services_einvoice_data.js:598-600` gegengeprüft — genau die Divergenz, die N1 ausgemacht hat.

**Nicht gesichert:** die Zuordnung der Codes BR-DE-5/6/7 stammt aus der XRechnung-CIUS und ist nicht gegen den aktuellen KoSIT-Katalog geprüft. Ein Kommentar im Code hält das fest. Der Befund selbst (drei Pflichtfelder) hängt nicht daran.

**Auswirkung im Betrieb:** ein Mitarbeiter ohne Telefon oder Mail blockiert das Buchen (422, mit `force=true` übersteuerbar). Die Builder haben diese Rechnung vorher erzeugt — der Empfänger hat sie abgewiesen.

Abgesichert durch 2 Tests.

### N8 — Postleitzahlen werden nicht geprüft, Adressfelder divergieren [belegt] — ✅ BEHOBEN

Der Validator prüft nur die Stadt: `:86` (Verkäufer, `error`), `:102` (Käufer, nur `warning`). PLZ (BT-38, BT-53) wird nie geprüft.

**Divergenz:** CII schreibt `PostcodeCode`, `LineOne`, `CityName` des Verkäufers immer, auch leer (`services_einvoice_cii.js:113-115`); UBL lässt sie bei Leere weg (`services_einvoice_ubl.js:243-245`). Gleiche Datenlage, zwei verschiedene Dokumente.

**Behoben am 26.08.2026**, beide Hälften:

- **Prüfung:** BT-38 (Verkäufer) als `error`, BT-53 (Käufer) als `warning`.
- **Divergenz:** der Verkäuferblock in CII lässt leere Felder jetzt weg, wie UBL es schon tat. Beim Durchsehen zeigte sich, dass der **Käuferblock in CII bereits konditional war** — abgewichen ist nur der Verkäuferblock, nicht die ganze Datei.

**Warum die Schwere ungleich verteilt bleibt:** sie folgt exakt der bestehenden Behandlung der Stadt (Verkäufer `error` in `:86`, Käufer `warning` in `:102`). Diese Asymmetrie ist Teil des Befunds und gehört entschieden, nicht nebenbei mitgeändert: Käuferadressen kommen aus dem Adressbuch und sind bei Bestandsdaten oft unvollständig — ein `error` würde dort Belege sperren, deren Empfänger sie problemlos annimmt. Ein Kommentar im Code hält das fest.

**Nicht gesichert:** die Codes BR-DE-3 und BR-DE-8.

Abgesichert durch 2 Validator-Tests und 2 Builder-Tests.

### N9 — Steuernummer allein erfüllt BR-CO-26 nicht [belegt] — ✅ TEILWEISE BEHOBEN

`services_einvoice_data.js:128-130` → `services_einvoice_cii.js:119-120`, `services_einvoice_ubl.js:248-257`.

BR-CO-26 verlangt mindestens eines aus BT-29, BT-30 oder BT-31. BT-32 (Steuernummer, Schema `FC`) erfüllt sie nicht. Ein Büro ohne USt-IdNr — bei Kleinunternehmern nach §19 UStG der Normalfall, und genau dafür ist Kategorie `O` in `:199` vorgesehen — erzeugt nur `PartyTaxScheme` mit `FC`. BT-29/BT-30 schreibt kein Builder.

**Sichtbar gemacht am 26.08.2026** in `services_einvoice_validator.js`, zweistufig:

| Datenlage | Reaktion | Begründung |
|---|---|---|
| weder BT-31 noch BT-32 | `error` | der Beleg ist sicher unbrauchbar |
| nur BT-32 (Steuernummer) | `warning` | ob es durchgeht, entscheidet der Validator des Empfängers |

**Warum nur teilweise:** die belastbare Lösung ist ein Feld für die Registernummer BT-30, das ein Builder auch ausgibt. Das ist eine Stammdaten-Erweiterung (Migration + Firmenmaske + beide Builder) und keine Validator-Änderung. Bis dahin ist der Kleinunternehmer-Fall gewarnt, nicht gelöst — ein `error` an dieser Stelle würde ihn vom Buchen aussperren, ohne dass er im Produkt etwas dagegen tun kann.

Abgesichert durch 2 Tests (nur Steuernummer → Warnung, keine Kennung → Error).

### N10 — Sicherheitseinbehalt verletzt BR-CO-16 und blockiert die eigene Buchung [belegt] — ✅ BEHOBEN 26.08.2026

`services_einvoice_data.js:500` zieht den Einbehalt direkt vom Zahlbetrag ab, ausgegeben in `cii.js:296` / `ubl.js:322`. BT-114 schreibt kein Builder, der Einbehalt ist in keiner Summenposition abgebildet (bewusst nur als Note).

Beim Empfänger ist BT-115 um den Einbehalt zu niedrig → BR-CO-16, harte Abweisung. Intern reißt dieselbe Differenz die 0,02-EUR-Toleranz (`validator:237-244`) — eine Rechnung mit Sicherheitseinbehalt ist **nur mit `force=true` buchbar**.

**Braucht eine fachliche Entscheidung, keinen Code-Fix:** Einbehalt als dokumentweiter Nachlass (BG-20) mit korrekter USt-Behandlung, als BT-113, oder solche Rechnungen bewusst aus der E-Rechnung heraushalten.

## Messung vom 26.08.2026

Beispiel: Abschlagsrechnung 10.000 € netto, 19 % USt → 11.900 € brutto, Einbehalt 5 % vom Brutto = 595 €. Alle Zahlen durch `validateEInvoiceData` geprüft.

| Variante | BT-109 | BT-112 | BT-113 | BT-115 | buchbar |
|---|---|---|---|---|---|
| **heute** — Einbehalt direkt vom Zahlbetrag | 10.000 | 11.900 | 0 | 11.305 | **nein**, BR-CO-16 |
| **A** — Einbehalt als BT-113 | 10.000 | 11.900 | 595 | 11.305 | ja |
| **B** — Einbehalt als BG-20 (Nachlass) | 9.405 | 11.191,95 | 0 | 11.191,95 | ja |
| **D** — nur im Text, BT-115 bleibt voll | 10.000 | 11.900 | 0 | 11.900 | ja |

**Der Befund gilt in beide Richtungen.** Auch die Auflösung fällt über BR-CO-16: die Schlussrechnung erhöht den Zahlbetrag um den Einbehalt (4.760 € brutto → 5.355 € fällig), und BT-115 ist dann *größer* als BT-112 − BT-113. Das stand so nicht im ursprünglichen Befund.

**Variante B scheidet aus.** Sie senkt die USt von 1.900 € auf 1.786,95 € — 113,05 € Differenz. Das widerspricht der ausdrücklichen Modellvorgabe in `migrations/0047_security_retention.sql`: *„SE does NOT reduce the VAT base — full USt due on the gross amount."* Der Einbehalt ist bereits versteuert; ihn als Nachlass zu führen, würde ihn ein zweites Mal aus der Bemessungsgrundlage nehmen.

**Variante A allein reicht nicht.** Sie löst den Einbehalt, aber die Auflösung bräuchte ein **negatives BT-113** — und BT-113 ist nach BR-2 nicht-negativ. Der hauseigene Validator würde es durchlassen (er prüft nur die Arithmetik), ein echtes Prüfportal nicht.

## Was tatsächlich trägt

Variante A auf der Abschlagsseite, kombiniert mit einer geänderten Definition von BT-113 auf der Schlussrechnung:

| Beleg | BT-113 wird gefüllt mit | BT-112 | BT-113 | BT-115 |
|---|---|---|---|---|
| Abschlagsrechnung | dem einbehaltenen Betrag | 11.900 | 595 | 11.305 |
| Schlussrechnung | dem **tatsächlich geflossenen** Betrag (Abschlag brutto − Einbehalt) | 16.660 | 11.305 | 5.355 |

Beide buchbar, USt unangetastet, keine negativen Beträge, und die Auflösung braucht keinen eigenen Mechanismus mehr — der Einbehalt kommt zurück, weil er nie als gezahlt galt.

**Der entscheidende Punkt: kein einziger Betrag ändert sich.** Heute rechnet die Schlussrechnung 16.660 − 11.900 + 595 = 5.355; neu 16.660 − 11.305 = 5.355. Die Umstellung ist rein darstellerisch — was der Kunde zahlt, bleibt auf den Cent gleich.

**Was bleibt unschön:** auf der Abschlagsrechnung heißt BT-113 „Bezahlter Betrag", der Einbehalt ist aber nicht bezahlt, sondern zurückbehalten. Das ist eine Dehnung der Semantik. Sie wird dadurch abgefedert, dass der bestehende Hinweistext (`buildSecurityRetentionNote`) den Sachverhalt bereits im Klartext erklärt. Die Alternative wäre Variante D — normativ sauberer, aber dann liest das ERP des Empfängers BT-115 = 11.900 und überweist den vollen Betrag.

## Entscheidung: keine der drei Varianten — der Normgeber gibt sie vor

Die offene Frage war, ob BT-113 zulässig ist. Die Antwort kommt nicht aus einer Abwägung, sondern aus der **offiziellen XRechnung-FAQ von XStandards Einkauf**:

> „Sicherheitseinbehalte mindern den Forderungsbetrag einer Rechnung **nicht** und zielen auf eine von der Rechnungsfälligkeit unabhängige Auszahlung ab. In XRechnung können sie daher **nicht** als Nachlass auf Dokumenten- (BG-20) oder Positionsebene (BG-27/BG-DEX-03) ausgedrückt werden."

> „Bürgschaften oder Sicherheitseinbehalte werden im Rahmen der Vertragsschließung zwischen Auftraggeber und Auftragnehmer vereinbart und sind daher von der Rechnungsabwicklung unabhängig zu sehen. **Eine explizite Abbildung ist im semantischen Modell der XRechnung nicht vorgesehen.** Alternativ können diese **nachrichtlich** – bspw. unter Verwendung des Betreffcodes „PMT" (für Payment Information) aus der Codeliste 4451 – als **Invoice Note (BT-21/BT-22)** in den Rechnungen aufgeführt werden."

Damit fallen **alle drei** im Befund vorgeschlagenen Varianten:

| Variante | warum sie ausscheidet |
|---|---|
| BG-20 (Nachlass) | vom Normgeber **ausdrücklich ausgeschlossen**; senkt zudem die USt um 113,05 € |
| BT-113 (bezahlter Betrag) | der Einbehalt ist nicht gezahlt. Der Forderungsbetrag darf nicht gemindert werden — genau das täte BT-113 |
| aus der E-Rechnung heraushalten | unnötig: es gibt einen vorgesehenen Weg |

**Der Einbehalt ist keine Größe der Rechnung, sondern eine Zahlungsmodalität.** Das ist der Punkt, den alle drei Varianten verfehlt haben.

## Umgesetzt

**Abschlagsrechnung** — BT-115 bleibt der volle Bruttobetrag (11.900 €), der Einbehalt wird nirgends abgezogen. Er steht als Hinweis mit Betreffcode **PMT**: in CII strukturiert als `<ram:SubjectCode>PMT</ram:SubjectCode>`, in UBL als `#PMT#`-Präfix vor dem Notentext — so bindet EN 16931 BT-21 in der UBL-Syntax. Der Hinweistext bestand bereits (`buildSecurityRetentionNote`) und nennt Prozentsatz, Basis, Betrag und die Rechtsgrundlage aus dem Vertrag.

**Schlussrechnung** — BT-113 wird mit dem **vereinnahmten** Betrag gefüllt (11.305 €), nicht mit dem fakturierten (11.900 €). Das war schon vorher falsch, unabhängig von N10: der einbehaltene Anteil war in BT-113 enthalten, obwohl er nie geflossen ist. § 14 Abs. 5 UStG verlangt in der Endrechnung ausdrücklich den Abzug der **„vereinnahmten Teilentgelte"**.

Der frühere Auflösungs-Mechanismus im XML entfällt damit ersatzlos: der Einbehalt kommt zurück, **weil er nie als gezahlt galt**.

| Beleg | BT-112 | BT-113 | BT-115 | BR-CO-16 |
|---|---|---|---|---|
| Abschlag mit Einbehalt | 11.900 | 0 | **11.900** | erfüllt |
| Schlussrechnung | 16.660 | **11.305** | 5.355 | erfüllt |

**Der Zahlbetrag der Schlussrechnung ändert sich nicht:** früher 16.660 − 11.900 + 595 = 5.355, jetzt 16.660 − 11.305 = 5.355.

**Was sich sichtbar ändert:** auf der Abschlagsrechnung steht in BT-115 jetzt der volle Betrag, während das PDF weiterhin „Zahlungsbetrag 11.305 €" ausweist. Das ist gewollt und entspricht der Trennung, die der Normgeber macht — die Rechnung *fordert* 11.900, der Auftraggeber *behält* davon 595 ein. Das PDF unterscheidet beides bereits sauber („Rechnungssumme brutto" gegen „Zahlungsbetrag"), es musste nicht angefasst werden. Der Einbehalt ist ohnehin ein Recht des Zahlenden — er übt es selbst aus und überweist nicht versehentlich zu viel.

**Die USt bleibt in jedem Fall unangetastet**, wie es `migrations/0047` vorgibt.

Abgesichert durch 9 Tests; gegen den Stand vor dem Fix schlagen 5 davon fehl.

### N11 — CII: Elementreihenfolge im Settlement-Block [unsicher: gegen XSD prüfen]

`services_einvoice_cii.js:395` (`buildReferencedDocuments`) steht vor `:396` (`buildMonetarySummation`). Nach der D16B-Sequenz folgt `InvoiceReferencedDocument` **nach** `SpecifiedTradeSettlementHeaderMonetarySummation`. Wenn das zutrifft, scheitert das Dokument an der XSD-Prüfung, bevor Schematron läuft — der Empfänger sieht nur „nicht schemakonform".

Auffällig: innerhalb `ApplicableTradeTax` (`:174-182`) folgt die Reihenfolge exakt der Schemasequenz — hier weicht sie punktuell ab.

**Vor einer Umstellung gegen die ZUGFeRD-2.x-XSD prüfen.** Betrifft nur Storno- und Schlussrechnungen mit Referenzen. UBL setzt `cac:BillingReference` (`ubl.js:233`) korrekt.

### N12 — Hybrid-PDF: UBL-XML in einem ZUGFeRD/Factur-X-Container [verifiziert] — ✅ BEHOBEN

`controllers/invoices.js:713-718`, identisch `controllers/partialPayments.js:1031-1036`: bei `format=ubl` wird `generateUblXml` verwendet und die Datei `xrechnung.xml` genannt, sonst CII und `factur-x.xml`.

Damit landet ein UBL-Dokument im PDF, während `services_einvoice_pdf_embed.js:80-86` im XMP `fx:DocumentType=INVOICE` mit dem Factur-X-Namespace deklariert. Der ZUGFeRD-Container ist für CII definiert; ein Reader erkennt am XMP „E-Rechnung", parst als CrossIndustryInvoice und scheitert.

**Ergebnis: der Empfänger behandelt die Datei als reines PDF, die Rechnung gilt als nicht elektronisch.** Zusätzlich sucht kein ZUGFeRD-Reader nach `xrechnung.xml` — etabliert sind `factur-x.xml` und `zugferd-invoice.xml`.

Der CII-Weg (`format=cii`) ist strukturell in Ordnung.

**Behoben am 26.08.2026.** Beide `getPdfHybrid`-Endpunkte erzeugen jetzt ausschließlich CII und benennen die Datei ausschließlich `factur-x.xml`. `format=ubl` wird mit 400 abgelehnt statt still ein Dokument zu erzeugen, das beim Empfänger als reines PDF ankommt.

**Warum ablehnen statt stillschweigend auf CII umstellen:** wer `format=ubl` anfragt, will UBL. Ein Dokument mit anderem Inhalt zurückzugeben, würde denselben Fehler nur besser verstecken. Die Fehlermeldung nennt den richtigen Weg (`/einvoice?format=ubl` liefert reines UBL, unverändert).

Im Frontend ist die `format`-Option aus `downloadInvoicePdfHybrid` und `downloadPpPdfHybrid` (`api/rechnungen.ts`) entfernt. Sie war nie belegt — beide Aufrufstellen in `RechnungenListe.tsx` übergeben keine Optionen und liefen auf den Vorgabewert `cii`. **Der Fehler war also über die Oberfläche nicht erreichbar**, nur über einen direkten API-Aufruf. Das mindert den Befund, hebt ihn aber nicht auf: der Endpunkt ist öffentlich und die Weiche war ausdrücklich vorgesehen.

`npx tsc -b` läuft durch.

### N13 — MIME-Typ des eingebetteten XML [belegt] / [unsicher: keine BR-Nummer, Spezifikationsanforderung] — ✅ BEHOBEN

`services_einvoice_pdf_embed.js:125` setzt `application/xml`. Factur-X/ZUGFeRD schreibt `text/xml` vor. pdf-lib kodiert den Wert korrekt, der Wert selbst ist falsch. Strenge Validatoren beanstanden das, tolerante Reader ignorieren es.

**Korrekt dagegen:** `AFRelationship.Alternative` (`:129`) ist die richtige Deklaration, und pdf-lib trägt den Filespec tatsächlich ins `/AF`-Array des Katalogs ein — der im Kopfkommentar behauptete AF-Eintrag existiert wirklich. `/UF` wird ebenfalls gesetzt.

**Behoben am 26.08.2026:** `mimeType: 'text/xml'` in `services_einvoice_pdf_embed.js`.

Damit schließt sich zugleich die Lücke aus S2 für dieses Modul: `tests/einvoice_pdf_embed.test.js` ist der erste Test, der ein erzeugtes Dokument tatsächlich ansieht statt nur die Vorprüfung. Vier Fälle, gegen die Rohdarstellung des PDF geprüft (pdf-lib kodiert den Schrägstrich als `#2F`):

| geprüft | Erwartung |
|---|---|
| MIME-Typ | `text#2Fxml` vorhanden, `application#2Fxml` **nicht** |
| Dateiname und `/AF` | `factur-x.xml`, `/AF`, `/Alternative` |
| XMP | `fx:DocumentType` und Factur-X-Namespace |
| Ergebnis | wieder ladbar, 1 Seite, Titel gesetzt |

Die zweite Zusicherung im ersten Fall ist die eigentliche Absicherung — ohne sie wäre der Test auch mit dem alten Wert grün geblieben, wenn der Typ irgendwo doppelt stünde.

### N14 — Leere Belegspalte hebelt den Rückgriff auf die Stammdaten aus [verifiziert] — ✅ BEHOBEN 26.08.2026

**Nicht Teil des ursprünglichen Audits — gefunden vom Test aus S2, am Tag seiner Entstehung.**

Die Belege tragen die Stammdaten denormalisiert mit (`COMPANY_*`, `EMPLOYEE_*`, `ADDRESS_*`). An 14 Stellen las `services_einvoice_data.js` sie nach dem Muster

    String(doc.COMPANY_IBAN ?? company?.IBAN ?? '').trim()

`??` greift nur bei `null`/`undefined`. Steht in der Belegspalte ein **leerer String** — bei denormalisierten Spalten der Normalfall, nicht die Ausnahme —, gewinnt dieser leere String, und die gepflegten Stammdaten werden nie gelesen.

Betroffen waren: IBAN, BIC, Telefon und Mail des Ansprechpartners, Käufername, USt-IdNr und Debitorennummer des Käufers sowie Name, Straße, PLZ und Ort **beider** Parteien.

**Warum das jetzt schwerer wiegt als vorher:** solange N6/N7/N8 nicht geprüft wurden, entstand daraus ein unvollständiges XML, das der Empfänger abwies. Seit diese Felder als `error` geprüft werden, **blockiert es das Buchen** — ein Büro mit vollständig gepflegter Firma und Mitarbeiterakte hätte keine Rechnung mehr buchen können, weil eine leere Spalte im Beleg den Rückgriff verhindert. Die drei Korrekturen von heute Vormittag haben diesen latenten Fehler scharf gestellt.

**Behoben** durch einen Helfer `firstNonEmpty(...)`, der über `null`, `undefined` **und** leere bzw. reine Leerzeichen-Strings hinweg zur nächsten Quelle geht. Alle 14 Stellen umgestellt.

Bewusst beibehalten: ein **gefüllter** Belegwert gewinnt weiterhin gegen die Stammdaten — der Beleg friert den Stand zum Buchungszeitpunkt ein, eine spätere Stammdatenänderung darf ihn nicht rückwirkend überschreiben. Ein Test hält das fest.

**Abgrenzung zu R9:** dort ging es um Zahlen, wo `0` ein gültiger Wert ist und deshalb die Rohspalte entscheiden muss. Hier geht es um Text, wo leer nie etwas bedeutet. Gegenläufige Regeln, gleiche Wurzel — ein Fallback, der nicht zwischen „nicht gesetzt" und „auf leer gesetzt" unterscheidet.

Abgesichert durch 5 Tests; gegen den Stand vor dem Fix schlagen 4 der 12 Tests der Datei fehl.

### N15 — BT-126 (Positionsnummer) ungeschützt interpoliert [verifiziert] — ✅ BEHOBEN 26.08.2026

**Nicht Teil des ursprünglichen Audits — gefunden beim Test zu R5.**

`cii.js` schrieb `<ram:LineID>${line.id}</ram:LineID>`, `ubl.js` `<cbc:ID>${line.id}</cbc:ID>` — beide ohne Escaping und ohne Rückfall. Fehlt `line.id`, steht literal `undefined` in **BT-126**, und das ist nach BR-21 ein Pflichtfeld: der Beleg ist damit ungültig, sieht aber vollständig aus.

Dieselbe Klasse wie R5, nur an einer Stelle, die weh tut. Über `loadInvoiceData` ist das Feld heute immer gesetzt (`id: idx + 1`) — der Fehler war also latent, nicht aktiv. Aufgefallen ist er, weil ein Test-Fixture das Feld `position` statt `id` nannte und das erzeugte XML daraufhin `undefined` enthielt.

**Behoben:** `${x(line.id ?? idx + 1)}` in beiden Buildern — escaped, und mit der Position als Rückfall.

**Zweite Lehre aus derselben Stelle:** auch dieses Fixture war von Hand gebaut und benutzte einen Feldnamen, den es nicht gibt. Das ist nach N1 und N14 der dritte Fall — die handgebauten Fixtures der Builder-Tests sind noch nicht durch S2 abgedeckt, weil S2 nur den Validator abdeckt. Ein Test, der `loadInvoiceData` gegen die **Builder** laufen lässt, wäre der nächste konsequente Schritt.

## Risiken

- **R1 — Lieferdatum (BT-72) nur in CII.** ✅ **BEHOBEN 26.08.2026**. `cii.js:146-156` erzeugt `ActualDeliverySupplyChainEvent`, UBL hat kein `cac:Delivery`. Zusätzlich erfindet CII bei fehlendem Leistungszeitraum ein Lieferdatum gleich dem Rechnungsdatum — eine inhaltliche Aussage, die niemand geprüft hat.
  **Behoben, beide Hälften.** UBL hat jetzt `cac:Delivery`/`cbc:ActualDeliveryDate` (zwischen `AccountingCustomerParty` und `PaymentMeans`, wo die UBL-Sequenz es verlangt). Und der Rückfall auf das Rechnungsdatum ist weg: ist der Leistungszeitraum unbekannt, bleibt die Gruppe leer, statt einen Liefertag zu behaupten. BG-13 ist optional — ein fehlendes Datum ist zulässig, ein falsches nicht.
- **R2 — Skonto divergiert.** ✅ **BEHOBEN 26.08.2026**. `cii.js:228-234` gibt einen strukturierten Block und keine `ram:Description`; `ubl.js:203-207` schreibt immer die KoSIT-Konvention in BT-20. Die XRechnung erwartet die Konvention in beiden Syntaxen. Wer das Hybrid-PDF bekommt, sieht das Skonto nur im Fließtext.
  **Behoben an der Wurzel statt an beiden Enden:** BT-20 wird jetzt **einmal** in `loadInvoiceData` gebildet (`data.paymentTermsNote`) und von beiden Buildern gelesen. Vorher baute jede Datei ihren eigenen Text — deshalb konnten sie überhaupt auseinanderlaufen. CII schreibt die KoSIT-Konvention jetzt in `ram:Description` und behält den strukturierten `ApplicableTradePaymentDiscountTerms`-Block zusätzlich.
  Beide Builder haben einen Rückfall auf den früheren Inline-Text, damit handgebaute Datenobjekte weiter funktionieren.
  **[unsicher]** Die Reihenfolge `Description` vor `DueDateDateTime` folgt der D16B-Sequenz, ist aber nicht gegen die XSD geprüft — derselbe Vorbehalt wie bei N11.
- **R3 — Peppol-Endpunkte nur in UBL, Peppol im Validator gar nicht.** `data.js:138-139/169-170` lädt sie, `ubl.js:175-186` nutzt sie, **CII ignoriert sie vollständig**. `validateEInvoiceData` nimmt `opts.profile` entgegen (`:50`), wertet es aber nirgends aus.
- **R4 — Peppol: Gutschrift als Invoice.** `ubl.js:197/219` erzeugt für Typcode 381 immer ein `Invoice`-Wurzelelement; Peppol BIS 3.0 verlangt CreditNote. [unsicher: Peppol-Codeliste lag nicht vor] — für XRechnung ist 381 zulässig, betrifft nur `generatePeppolXml`.
- **R5 — Anhänge.** ✅ **TEILWEISE BEHOBEN 26.08.2026**. `cii.js:254` / `ubl.js:54` setzen `application/octet-stream` als Default; BT-125 ist codelisten-beschränkt [unsicher: keine Regelnummer]. Zusätzlich wird `a.base64` ungeprüft interpoliert — fehlt das Feld, steht literal `undefined` im XML. Der Attachment-Loader fällt weich aus (`data.js:76-81`): fehlt die Migration, gehen Anhänge stillschweigend verloren.
  **Behoben: das `undefined`.** Beide Builder sortieren Anhänge ohne `base64` jetzt über `usableAttachments` aus und melden das. Ein fehlender Anhang ist besser als einer, der wie ein Anhang aussieht und nicht dekodierbar ist.
  **Offen bleibt der MIME-Typ**: `application/octet-stream` als Vorgabewert steht weiterhin da. BT-125 ist codelisten-beschränkt, die Codeliste lag auch dieser Runde nicht vor.
- **R6 — Nur die UBL-Fassung wird eingefroren.** ✅ **BEHOBEN 26.08.2026** (Migration 0133 noch einzuspielen). `services/invoices.js:993-1013` erzeugt beim Buchen ausschließlich UBL und setzt `DOCUMENT_XML_PROFILE` auf `xrechnung-ubl`. Der CII-Endpunkt liefert den Snapshot nur bei Profil `zugferd-*` (`controllers/invoices.js:775`) — trifft nie zu. CII und Hybrid-PDF werden bei **jedem Abruf neu** erzeugt. Sobald einer der obigen Befunde behoben wird, ändert sich rückwirkend das CII-Dokument bereits versendeter Rechnungen, während UBL eingefroren bleibt: zwei widersprüchliche Fassungen desselben Belegs. Der manuelle Snapshot-Endpunkt (`:798-818`) verhält sich dagegen korrekt und überschreibt kein gesetztes Asset.

  **Eingetreten, bevor er behoben war.** Das Audit stellt diesen Punkt bewusst *vor* die Korrekturen (Teil 4, Schritt 5). Gearbeitet wurde in umgekehrter Reihenfolge — N3, N4, N5, N8 und N13 haben CII und Hybrid-PDF bereits gebuchter Belege rückwirkend verändert, während deren UBL eingefroren blieb. **Ohne Schaden, weil zum Zeitpunkt der Korrekturen ausschließlich Testdaten existierten** und noch kein Beleg an einen echten Empfänger gegangen war. Die Reihenfolge war trotzdem falsch herum.

  **Behoben:** die CII-Fassung bekommt eigene Spalten (`DOCUMENT_XML_CII_ASSET_ID`, `_PROFILE`, `_RENDERED_AT`, Migration `0133`) und wird beim Buchen genauso eingefroren wie die UBL-Fassung. Neu ist `services/einvoiceSnapshot.js`; beide Buchungswege rufen es auf, beide CII-Endpunkte und **beide Hybrid-PDF-Endpunkte** lesen es.

  Das Hybrid-PDF hatte vorher überhaupt keine Snapshot-Prüfung — es war der Pfad, der am stärksten driftete, und zugleich der, den die Zielbranche tatsächlich versendet.

  **Bewusst best-effort:** schlägt das Einfrieren fehl, bleibt die Buchung gültig und der Abruf fällt auf den Live-Pfad zurück. Ein Beleg ist fachlich vollständig, sobald PDF und UBL stehen — die Buchung an einer Snapshot-Optimierung scheitern zu lassen wäre die schlechtere Wahl. Alle betroffenen Abfragen nutzen `select("*")`, damit sie ohne die Migration nicht brechen.

  **Bereits gebuchte Belege bekommen ihren CII-Snapshot nicht nachträglich.** Ein Nach-Rendern würde genau den Zustand festschreiben, den die Korrekturen seit dem Audit verändert haben — es sähe nach Konservierung aus und wäre das Gegenteil. Sie laufen weiter über den Live-Pfad; wer sie einfrieren will, nutzt den bestehenden manuellen Snapshot-Endpunkt bewusst und einzeln.

  Abgesichert durch 8 Tests, darunter der eigentliche Zweck: nach dem Einfrieren ändern nachträgliche Änderungen an den Belegdaten das Dokument nicht mehr.

  **⚠️ Migration `0133_einvoice_cii_snapshot.sql` ist noch nicht eingespielt.** Bis dahin verhält sich alles wie bisher, und beim Buchen erscheint je Beleg eine Warnung `[EINVOICE_CII_SNAPSHOT] nicht eingefroren` im Log.
- **R7 — Kategorien G und K ungeprüft, AE/K ohne Käufer-USt-IdNr.** ✅ **BEHOBEN 26.08.2026**. `data.js:189-192` lässt `G`/`K` zu, `validator:140-199` prüft für beide weder Satz 0 noch Befreiungsgrund. Die Konstante `VAT_CATEGORIES_REQUIRE_REASON` (`:31`) ist definiert und wird **nirgends benutzt** — die Kategorienprüfung ist stattdessen als Kette einzelner Blöcke ausgeschrieben, in der `G` und `K` fehlen. Bei Reverse Charge verlangt EN 16931 die USt-IdNr beider Parteien; `buyer.vatId` ist vorhanden (`data.js:165`), wird aber nicht geprüft. Eine §13b-Rechnung ohne Käufer-USt-IdNr — im Baubereich der Normalfall — geht durch und wird abgewiesen.
  **Behoben:** die ausgeschriebene Blockkette ist durch eine Tabelle `VAT_CATEGORY_RULES` ersetzt, die alle sechs Kategorien außer `S` führt; die tote Konstante `VAT_CATEGORIES_REQUIRE_REASON` ist weg. Die Tabelle ist die Struktur, die der Befund verlangt: eine in `data.js` zugelassene Kategorie kann nicht mehr stillschweigend ungeprüft bleiben. `Z` führt bewusst **keinen** Befreiungsgrund — die alte Konstante führte es fälschlich mit, das war der zweite Fehler in derselben Zeile. Für `AE` und `K` wird zusätzlich die USt-IdNr **beider** Parteien verlangt. Abgesichert durch 4 Tests. **Nicht gesichert:** die Codes `BR-G-*` und `BR-IC-*` sowie die Zuordnung der `-02`/`-03`-Varianten.
- **R8 — Nur eine USt-Zeile möglich.** `data.js:502-509` baut `vatBreakdown` immer als genau ein Element. Gemischte Sätze (7 % / 19 %) sind nicht darstellbar. Solange die Erfassung das nicht zulässt, konsistent — sobald doch, entsteht ein stilles Falschdokument statt einer Ablehnung.
- **R9 — Fallbacks überschreiben legitime Nullwerte.** ✅ **BEHOBEN 26.08.2026**. `data.js:439-445` nutzte `||` statt `??`: ein gespeicherter Wert 0 ist falsy und wurde durch die Berechnung ersetzt. Bei einer Nullrechnung oder bewusst auf 0 gesetzter Steuer wich das XML von der Buchhaltung ab.
  **Der vorgeschlagene Fix `??` allein hätte nicht gewirkt:** `toNum(null)` liefert ebenfalls 0, der Nullish-Operator hätte also nie gegriffen. Entscheiden muss die **Rohspalte** vor der Umwandlung — dafür jetzt ein Helfer `stored(v)`, der `null` zurückgibt, wenn die Spalte leer ist, und sonst den gerundeten Wert. Dass die Spalten nullable sind, ist über die Reporting-Views belegt (`COALESCE("TOTAL_AMOUNT_NET", 0)`, u.a. `migrations/0008`): NULL heißt „nicht gerechnet", 0 heißt „wirklich null".

## Sauberkeit

- **S1 — `services_bt_mapping.js` ist toter Code.** `loadBtMapping` hat im gesamten Repository **keinen Aufrufer**; die Mappingdatei liegt vor. Falls reaktiviert, sind die bekannten Schwächen real: `normalizeBt` (`:12-15`) matcht das BT-Muster an beliebiger Stelle, sodass `XBT-1` zu `BT-1` wird; die verbreiteten Schreibweisen mit Leerzeichen, Unterstrich oder Halbgeviertstrich (Excel-Autokorrektur) liefern `null`; `:62` verwirft solche Zeilen ohne Zähler oder Log. Fehlende Zeilen sind ununterscheidbar von nie existierenden. Empfehlung: verankertes Muster plus Rückgabe der verworfenen Zeilennummern. `_cache` (`:10`) wird nie invalidiert.
- **S2 — Keine Tests auf das erzeugte XML.** ✅ **BEHOBEN 26.08.2026**, in zwei Schritten.
  **Zuerst** `tests/einvoice_builders.test.js` (4 Tests auf CII- und UBL-Elemente) und `tests/einvoice_pdf_embed.test.js` (4 Tests auf das erzeugte PDF).
  **Dann der Test, den der Befund selbst als ersten sinnvollen nennt:** `tests/einvoice_data_to_validator.test.js` lässt `loadInvoiceData` gegen ein Fixture laufen und steckt **dessen** Ergebnis in `validateEInvoiceData`. Die zentrale Zusicherung ist, dass ein vollständig gepflegter Beleg **null** Fehler erzeugt; kommt einer, liest eine Regel ein Feld, das das Datenmodell nicht liefert.
  **Gegenprobe gemacht:** mit künstlich wieder eingebautem N1 (`l.description` → `l.name`, `t.lineTotal` → `t.netTotal`) meldet der Test genau die Fehler aus dem Befund — BR-22 je Position und BR-12 einmal. Der Test hätte N1 also gefunden.
  Schon beim Schreiben hat er zwei Dinge geliefert: die echten Spaltennamen (`COMPANY_NAME_1`, `POST_CODE` — nicht die naheliegenden) und den neuen Befund **N14**.
  Ursprünglicher Wortlaut: 33 Testdateien, für die E-Rechnung nur `einvoice_validator.test.js`. Kein Test prüfte ein CII- oder UBL-Element. Der erste sinnvolle Test wäre kein XML-Test, sondern einer, der `loadInvoiceData` gegen ein Fixture laufen lässt und dessen Ergebnis in `validateEInvoiceData` steckt — das hätte N1 sofort gefunden.
- **S3 — Geladene, nie geschriebene Felder.** `seller.creditorId` (BT-90), `seller.postOfficeBox`, `buyer.debitorNumber` (BT-46) werden aus der DB geholt und von keinem Builder ausgegeben. BT-46 wäre der naheliegende Kandidat, um N9 zu entschärfen.
- **S4 — Falscher Regelcode.** ✅ **BEHOBEN 26.08.2026**. `validator:255` führte die Leitweg-ID unter `BR-DE-1`; das ist nach KoSIT die Regel zu den Zahlungsinformationen. Die Warnung läuft jetzt unter `BR-DE-15`, `BR-DE-1` ist an die IBAN-Prüfung aus N6 gegangen — vorher wäre derselbe Code doppelt vergeben gewesen, was erst beim Fix von N6 auffiel. Der Test prüft beides: BR-DE-15 kommt, BR-DE-1 kommt nicht. Die Codenummer selbst bleibt [unsicher].
- **S5 — UBL erfindet einen Handelsnamen.** ✅ **BEHOBEN 26.08.2026**. `ubl.js:241/259` und `:273/286` schreiben denselben String in `cac:PartyName` (BT-28/BT-45) und `RegistrationName` (BT-27/BT-44). Damit wird ein Handelsname behauptet, den niemand erfasst hat. CII gibt nur `ram:Name` aus und ist hier sauberer.
  **Behoben:** `cac:PartyName` ist für Verkäufer und Käufer entfallen. BT-28/BT-45 sind optional; `RegistrationName` (BT-27/BT-44) trägt weiterhin den Namen, den es wirklich gibt.
- **S6 — Doppelte Konstante.** ✅ **BEHOBEN 26.08.2026**. `ubl.js:20` und `:26` definierten zwei Profil-IDs mit identischem Wert; die Fallunterscheidung in `:196` war wirkungslos. Von den beiden Auflösungen, die der Befund anbietet, trifft die zweite zu: die XRechnung verwendet das Peppol-Billing-Profil bewusst mit, die Werte sind also **absichtlich** gleich, nicht versehentlich. Jetzt eine Konstante `BILLING_PROFILE_ID` mit einem Kommentar, der das festhält — und dem Hinweis, dass die Weiche zurückgehört, falls die Werte je auseinanderlaufen. **Am erzeugten XML ändert sich nichts:** der neue Wert ist byteweise identisch mit beiden alten.
- **S7 — `docs/EINVOICE_ANALYSIS.md` ist überholt.** ✅ **BEHOBEN 26.08.2026** — das Dokument trägt jetzt einen Warnkopf, der es als historisch kennzeichnet, die überholten Stellen einzeln benennt und auf dieses Audit verweist. Inhaltlich unverändert gelassen: als Zeitdokument hat es weiterhin Wert, als Referenz nicht. Stand Juni 2026, führt als fehlend auf: PDF/A-3-Einbettung, BT-11, BT-13, HUR-Stundenpositionen, Käuferkontakt und die Kategorien AE/E/G/K/O — alles inzwischen implementiert. Der dort als kritisch zitierte Fallback für BT-10 existiert nicht mehr. Das Dokument führt einen Reviewer aktiv in die Irre und sollte überarbeitet oder als historisch gekennzeichnet werden.
- **S8 — REG-Note dupliziert die Verkäuferadresse.** `cii.js:91-97` schreibt die Firmenanschrift zusätzlich als `IncludedNote`. Nur CII. — **Bewusst nicht geändert (26.08.2026).** Der Subject-Code `REG` ist die anerkannte Stelle für regulatorische Angaben zum Verkäufer; deutsche Prüfportale können eine solche Note erwarten. Sie zu entfernen, um eine Dopplung zu beseitigen, tauscht ein kosmetisches Problem gegen ein mögliches echtes. Die Dopplung kostet nichts — die Divergenz zu UBL bleibt bestehen und ist hier hinnehmbar.
- **S9 — Legacy-Feld.** `data.js:570` existiert nur noch als Fallback in `cii.js:347` und `ubl.js:197`. Wird es entfernt, fällt CII stillschweigend auf den UBL-Typcode zurück.

---

# Teil 2 — HOAI-Kalkulation

## A — Gesichert falsch

### A1 — `s3Cumul` ist nicht deklariert, `computeSurcharges()` wirft bei jedem Aufruf [verifiziert] — BEHOBEN

`services/nachtraege.js:40` liest `s3Cumul`; deklariert waren nur `s1Cumul` (`:24`) und `s2Cumul` (`:27`). Die Zeile läuft unbedingt, nicht nur bei gepflegtem drittem Zuschlag. Das Lesen einer nicht deklarierten Variablen wirft in JavaScript einen `ReferenceError`, unabhängig vom Strict-Mode.

Zum Vergleich: `services/angebote.js:21` deklariert die Variable korrekt — betroffen war nur die Nachtrags-Kopie.

Wirkungskette (Aufrufer `:343` und `:383`) — die Datenbank-Änderung passiert jeweils **vor** dem Absturz:

- `deleteStructureNode` (`:370`): Zeilen sind gelöscht, dann wirft `recalcParent`, `recomputeHeadTotals` (`:371`) läuft nie. **Die geforderte Nachtragssumme bleibt nach dem Löschen einer Unterposition zu hoch.**
- `createStructureNode` (`:290`): Position ist eingefügt, HTTP 500, `AMOUNT_CLAIMED_NET` bleibt stehen.
- `updateStructureNode` (`:343`): jede Betrags-, Zuschlags- oder Nebenkostenänderung wirft vor dem `update` (`:357`) — die Änderung geht verloren.

Zahlenszenario: Gruppenknoten mit zwei Positionen à 5.000 €, `AMOUNT_CLAIMED_NET` = 10.000 €. Eine Position löschen → erwartet 5.000 €, gespeichert bleiben 10.000 €.

Bestehende Rechnungen sind **nicht** betroffen: `release()` (`:500` ff.) überträgt nur Blatt-Positionen mit `node.REVENUE` in `PROJECT_STRUCTURE`. Betroffen sind Nachtrags-Register, KPIs und die geforderte Summe.

Für `services/nachtraege.js` existiert kein Test.

**Status:** behoben, siehe Teil 3.

### A2 — Rechnungsvorschlag und Speichern rechnen unterschiedlich [verifiziert] — ✅ BEHOBEN

`getPhases` (`services/finalInvoices.js:143-148`, `:227-232`) rechnet `INVOICED` / `PARTIAL_PAYMENTS` bewusst aus den Rohdaten neu; der Kommentar in `:143` sagt wörtlich, dass die gecachten Spalten gedriftet sein können. Angezeigt wird das Ergebnis in `:252-253`.

`savePhases` (`:261-289`) bekommt vom Controller nur `structure_ids` (`controllers/finalInvoices.js:19-33`) und rechnet selbst — dabei ausschließlich aus der gecachten Spalte `ps.INVOICED` (`:286`). Der Selbstheilungs-Pfad fehlt hier.

Zahlenszenario: `REVENUE_COMPLETION` 100.000 €, `EXTRAS_PERCENT` 0. Real abgerechnet sind 30.000 €, die gecachte Spalte steht nach einem Storno-Vorgang auf 0.

- Vorschlag zeigt: 70.000 € (neu gerechnet)
- Gespeichert und fakturiert: 100.000 € (aus dem Cache)
- **30.000 € doppelt, ohne Warnung**

Betrifft bestehende Rechnungen, sobald die Cache-Spalte je gedriftet ist — genau der Fall, den der Code selbst als real annimmt. Zu klären: kommen solche Drifts in produktiven Mandanten vor?

**Behoben am 26.08.2026** in `services/finalInvoices.js`.

**Die offene Frage wurde nicht beantwortet, sondern umgangen.** Ob Drifts produktiv vorkommen, ließ sich ohne Produktionsdaten nicht klären — und die Frage entscheidet den Fix auch nicht: dass Vorschlag und Speichern verschieden rechnen, ist unabhängig davon ein Fehler. Ein Betrag anzeigen und einen anderen fakturieren ist in keinem Datenzustand richtig.

Der Selbstheilungs-Block aus `getPhases` liegt jetzt als `recomputeBilledByStructure(supabase, { contractId, excludeInvoiceId })` daneben; beide Wege rufen ihn auf. Bei einem Fehler liefert er `ok: false`, und der Aufrufer fällt wie bisher auf die gecachte Spalte zurück — die Änderung kann also nichts blockieren, was vorher funktioniert hat.

`savePhases` liest zusätzlich `CONTRACT_ID` mit; ohne Vertrag greift die Neuberechnung nicht, dann bleibt es beim alten Verhalten.

**Verifiziert gegen das Szenario aus dem Befund** (`tests/finalInvoices.phases.test.js`, 3 Tests). Die Tests wurden gegen den Stand **vor** dem Fix laufen gelassen — dort schlagen zwei fehl:

| Cache-Spalte | real fakturiert | savePhases vorher | savePhases jetzt |
|---|---|---|---|
| 0 (gedriftet) | 30.000 € | **100.000 €** | 70.000 € |
| 30.000 € (sauber) | 30.000 € | 70.000 € | 70.000 € |

Die erste Zeile ist die Doppelfakturierung aus dem Befund, reproduziert. Der dritte Test prüft die Übereinstimmung selbst: für vier verschiedene Cache-Werte muss `savePhases` genau das liefern, was `getPhases` anzeigt.

### A3 — Zuschläge haben zwei Quellen der Wahrheit [belegt]

- `services_pdf_render.js:1349-1371` (`buildHonorarCalcData`) rechnet jede Zuschlagszeile **zur Renderzeit neu** und ignoriert die gespeicherten Felder `BASE_AMOUNT` / `AMOUNT`.
- `controllers/stammdaten.js:1812-1861` und die Übernahme in die Projektstruktur (`:605-607`, `:1912-1914`) benutzen den **gespeicherten** `AMOUNT`.
- `patchFeeCalcMasterBasis` (`controllers/stammdaten.js:273-330`) schreibt bei Änderung von Kx, Zone oder Zonenprozent zwar `REVENUE_Kx` neu, aber weder `FEE_CALCULATION_PHASE.PHASE_REVENUE` noch `FEE_CALCULATION_SURCHARGES.AMOUNT`.

Der Honorar-Anhang hängt an der Rechnung: `services_pdf_render.js:866` baut ihn live.

Zahlenszenario: Grundhonorar 100.000 €, Umbauzuschlag 20 % → gespeichert 20.000 €. Danach werden die Leistungsphasen neu gespeichert (Grundhonorar 120.000 €), der Zuschlagsschritt wird nicht erneut durchlaufen, Sync erneut ausgelöst:

- Rechnungspositionen: 120.000 + 20.000 = **140.000 €**
- Honorar-Anhang derselben Rechnung: 20 % × 120.000 = **144.000 €**
- Differenz: 4.000 € zwischen Beleg-Anhang und fakturierter Summe

Gebuchte Belege bleiben unverändert — `controllers/invoices.js:603` liefert für `STATUS_ID = 2` das eingefrorene `DOCUMENT_PDF_ASSET_ID`. Betroffen sind Entwürfe und alle Vorschauen vor dem Buchen.

**Nachtrag 26.08.2026 — nicht behoben, aber genauer eingegrenzt.** Bei der Umsetzung von A2 wurde derselbe Fix hier geprüft und **bewusst nicht** angewendet. Zwei Punkte, die der Befund noch nicht hatte:

1. **`AMOUNT` ist kein Nutzereingabefeld.** `saveFeeCalcSurcharges` (`controllers/stammdaten.js:1679`) berechnet es beim Speichern immer als `PERCENT / 100 × BASE_AMOUNT`. Es ist damit derselbe Fall wie `PROJECT_STRUCTURE.INVOICED` in A2: ein zwischengespeichertes Ergebnis, kein Datum. Eine Neuberechnung würde also keine Nutzereingabe verwerfen — das war die Frage, an der der Fix hätte scheitern können.

2. **Die Basis kommt aus dem Frontend, nicht aus dem Backend.** `BASE_AMOUNT` wird im Wizard gerechnet und mitgeschickt (`HonorarWizard.tsx:584` liefert bei kumulativen Zuschlägen die bereits aufgestockte Basis). Das Backend hat **keine eigene Quelle** für die Basis — es glaubt, was ankommt. Deshalb ist A3 nicht der gleiche Handgriff wie A2: dort lag die richtige Rechnung schon im Backend und musste nur an zwei Stellen dieselbe sein. Hier müsste erst entschieden werden, **ob das Backend diese Rechnung überhaupt besitzen soll**.

Das ist eine Architekturentscheidung und gehört zu den offenen Punkten, nicht in eine Aufräumrunde. Empfehlung: die Zuschlagsrechnung ins Backend ziehen (eine Funktion, von Renderer, Sync und Speicherpfad benutzt), das Frontend rechnet dann nur noch für die Anzeige. Solange das nicht entschieden ist, bleibt A3 offen — auch `patchFeeCalcMasterBasis` (dritter Punkt des Befunds) sollte erst danach angefasst werden.

## B — Fachlich zu klären

### B1 — Kumulativer Zuschlag ignoriert den LPH-Filter der vorherigen Zuschläge — ✅ ENTSCHIEDEN 26.08.2026

`services_pdf_render.js:1366-1369` und identisch `frontend-react/src/pages/projekte/HonorarWizard.tsx:108-112`: der laufende Zwischenstand summiert **alle** vorherigen Zuschlagsbeträge, auch solche, die auf andere Leistungsphasen entfallen.

Szenario (der Katalogfall aus Migration 0126): Grundhonorar 100.000 €, LPH 8 = 32.000 €. Umbauzuschlag 20 % über LPH 1–9 → 20.000 €. Danach Instandsetzung 50 %, Filter nur LPH 8, Modus kumulativ:

- tatsächlich: (32.000 + 20.000) × 50 % = **26.000 €**
- fachlich naheliegend wäre der LPH-8-Anteil des ersten Zuschlags: (32.000 + 6.400) × 50 % = **19.200 €**
- Differenz: 6.800 €

Der UI-Hinweis (`HonorarWizard.tsx:1302`) sagt „Honorarbasis + Summe vorheriger Zuschläge" — der Code tut also, was dort steht. Zu entscheiden ist, ob diese Semantik bei abweichenden LPH-Filtern gewollt ist. „Parallel" ist Default, der Fall tritt nur bei bewusster Umschaltung auf.

**Entscheidung: Semantik bleibt, Hinweis wird geschärft.** Die Rechnung ist damit ausdrücklich gewollt und kein Befund mehr — sie muss nur erkennbar sein.

Umgesetzt:

- Kurztext am Schalter: „Summe **aller** vorherigen Zuschläge" statt „Summe vorheriger Zuschläge".
- Neuer Hinweis, der **nur** erscheint, wenn der Fall tatsächlich vorliegt (kumulativ, nicht die erste Zeile, und ein LPH-Filter gesetzt): der Zuschlag stockt auf die volle Summe der vorherigen auf, auch auf deren Anteil für hier nicht ausgewählte Leistungsphasen.
- `helpContent.tsx` → `hoai.zuschlag`: „parallel" und „kumulativ" sind jetzt getrennt erklärt, samt dem Hinweis, dass die Reihenfolge der Zeilen das Ergebnis mitbestimmt.

Der Hinweis erscheint bewusst nicht bei jedem kumulativen Zuschlag — ohne abweichenden LPH-Filter gibt es nichts zu warnen, und ein dauernd sichtbarer Hinweis wird überlesen.

### B2 — Tafel-Ränder werden still auf den Randwert geklemmt — 🔶 RECHTSLAGE GEKLÄRT, Umsetzung offen

`services/stammdaten.js:21-35` (`findBounds`): unterhalb des kleinsten und oberhalb des größten Basiswerts fallen untere und obere Grenze auf dieselbe Zeile zurück, die Interpolation (`:39`) gibt den Randwert zurück. Geprüft mit den echten Tafelwerten aus Migration 0115 (FM 1, Zone III, Zonenprozent 0):

| Eingabe K0 | Ergebnis | Bemerkung |
|---|---|---|
| 10.000 € (unter Tafel) | 4.339 € | Wert der Stützstelle 25.000 € |
| 500.000 € (exakt Stützstelle) | 62.900 € | korrekt |
| 40.000.000 € (über Tafel) | 1.998.153 € | identisch zu 25 Mio € |

Ein 40-Mio-Projekt bekommt dasselbe Grundhonorar wie ein 25-Mio-Projekt, ohne Hinweis.

**Rechtsgrundlage ungeprüft:** die HOAI trifft für Kosten außerhalb der Tafel eine Regelung; der Verordnungstext lag beim Audit nicht vor, deshalb wird bewusst kein Paragraph genannt. Zu klären: welche Behandlung vorgeschrieben ist und ob mindestens eine Warnung angezeigt werden muss. Die Randfälle sind in `tests/stammdaten.service.test.js` nicht abgedeckt.

**Nachgetragen 26.08.2026 — § 7 Abs. 2 HOAI:**

> „Liegen die ermittelten anrechenbaren Kosten oder Flächen außerhalb der in den Honorartafeln dieser Verordnung festgelegten Honorarsätze, sind die Honorare frei vereinbar."

Damit steht fest: **außerhalb der Tafel gibt es kein Tafelhonorar.** Das stille Klemmen auf den Randwert gibt eine Zahl aus, die die Verordnung an dieser Stelle nicht kennt.

**Extrapolieren scheidet aus.** Die Honorartafeln sind in sich geschlossen und enthalten keinen Parameter dafür, wie sich das Honorar oberhalb weiterentwickelt — eine lineare Fortschreibung wäre eine Erfindung, keine Auslegung.

**Entschiedene Richtung: Erweiterungstabellen integrieren.** Für Honorare oberhalb der Tafelwerte gibt es anerkannte, veröffentlichte Tafeln der staatlichen Bauverwaltungen — die **RiFT** (Richtlinien der Staatlichen Vermögens- und Hochbauverwaltung Baden-Württemberg) sowie entsprechende Regelungen in Bayern und Nordrhein-Westfalen. Sie beschreiben je Leistungsbild, wie oberhalb der Tafel weitergerechnet wird, und werden bei Streitigkeiten — besonders bei öffentlichen Auftraggebern — als Grundlage herangezogen.

Das ist ein eigenes Vorhaben, kein Handgriff: es braucht die Tafeldaten selbst, eine Zuordnung je Leistungsbild und eine Entscheidung, welche Landesregelung Vorrang hat. Offen und bewusst nicht nebenbei umgesetzt.

**Bis dahin ungelöst.** Der heutige Zustand — Randwert ohne jeden Hinweis — bleibt bestehen. Ein 40-Mio-Projekt bekommt weiterhin das Honorar eines 25-Mio-Projekts, ein 10.000-€-Projekt das eines 25.000-€-Projekts. Der kleinste sinnvolle Zwischenschritt wäre, den Fall überhaupt zu erkennen und zu kennzeichnen (`findBounds` weiß es bereits, sagt es nur niemandem), damit niemand eine Zahl unterschreibt, die so nicht gilt.

### B3 — `ZONE_PERCENT` wird nirgends auf 0–100 begrenzt — ✅ BEHOBEN 26.08.2026

`services/stammdaten.js:114` und `:130`, serverseitig `controllers/stammdaten.js:301/320` ohne Prüfung, Eingabefeld `HonorarWizard.tsx:888` ohne `min`/`max`.

Szenario: FM 1, Zone III, K0 = 500.000 €, Höchstsatz laut Tafel 78.449 €. Bei `ZONE_PERCENT` = 150 ergeben sich **86.223,50 €** — 7.774,50 € über dem Tafel-Höchstsatz, ohne Warnung.

**Achtung bei einer Korrektur:** das Feld ist für `percent_of_baukosten` und `flaechenaequivalent_brandschutz` bewusst zweckentfremdet (`services/stammdaten.js:56-91`) — eine pauschale Klemmung wäre dort falsch. Analog ist `FEE_SURCHARGES.MAX_PERCENT` laut Migration 0126 ausdrücklich nur ein Oberflächen-Hinweis; `saveFeeCalcSurcharges` (`controllers/stammdaten.js:1673-1690`) nimmt jeden Prozentsatz an.

**Entscheidung: auf 0–100 begrenzen, aber nur bei den Honorartafel-Typen.**

Die Prüfung sitzt als `zonePercentRangeError` in `services/stammdaten.js` — dort, wo `BASE_TYPE` ohnehin gelesen wird, statt in jedem Aufrufer erneut. Die Ausnahmeliste steht als benannte Konstante `ZONE_PERCENT_FREE_BASE_TYPES` daneben, damit ein künftiger zweckentfremdeter Typ an einer Stelle ergänzt wird.

| Fall | Reaktion |
|---|---|
| Honorartafel-Typ, 0–100 | zulässig |
| Honorartafel-Typ, außerhalb | **400**, mit Erklärung was der Wert beschreibt |
| `percent_of_baukosten` (frei vereinbarter Satz) | unbegrenzt |
| `flaechenaequivalent_brandschutz` (Faktor f, 170–191) | unbegrenzt |
| leerer Wert | durchgelassen |
| `BASE_TYPE`-Spalte fehlt | wie Tafel-Typ — dieselbe Annahme, die `calculateRevenueFields` schon trifft |

Zwei Schreibwege sind gesichert: `patchFeeCalcMasterBasis` und `saveFeeCalcZoneSplits` (die Zonenanteile des TGA-Mischhonorars nach § 54 — dort gibt es keinen zweckentfremdeten Typ, die Grenze gilt immer).

**Bewusst nicht mitgeändert:** ein bereits gespeicherter Wert außerhalb der Spanne blockiert nicht das Bearbeiten anderer Felder — geprüft wird nur, was gerade gesetzt wird. Sonst wäre ein Altbestand nicht mehr editierbar.

Im Wizard trägt das Feld `min`/`max` **nur**, wenn es kein zweckentfremdeter Typ ist, plus die Erklärung „0 % = Mindestsatz, 100 % = Höchstsatz".

Abgesichert durch 7 Tests. `FEE_SURCHARGES.MAX_PERCENT` bleibt wie beschrieben ein reiner Oberflächen-Hinweis — das war nicht Teil der Entscheidung.

### B4 — Punktverteilung § 44 vs. § 48 gegenläufig — ✅ GEPRÜFT 26.08.2026: kein Fehler

In `migrations/0127_hoai_zonen_punktesystem.sql`:

| Merkmal | § 44 (FM 11, Z. 191–195) | § 48 (FM 12, Z. 201–205) |
|---|---|---|
| Einbindung in die Umgebung | 5 | **15** |
| fachspezifische Bedingungen | 15 | **5** |

Beide Systeme summieren korrekt auf 40; die im Kopf der Migration beschriebene Summenprüfung kann eine Vertauschung **innerhalb** eines Leistungsbilds prinzipiell nicht entdecken. **Bitte gegen den Volltext von § 48 Abs. 2 prüfen** — hier wird bewusst keine Punktzahl aus dem Gedächtnis zitiert.

**Geprüft am 26.08.2026 gegen den Verordnungstext — die Daten sind korrekt.** Die Punkte stehen in **Absatz 3** (Absatz 2 listet nur die Merkmale, deshalb war der Befund dort nicht zu finden):

| | § 44 Ingenieurbauwerke (FM 11) | § 48 Verkehrsanlagen (FM 12) |
|---|---|---|
| 1 geologische/baugrundtechnische Gegebenheiten | 5 | 5 |
| 2 technische Ausrüstung und Ausstattung | 5 | 5 |
| 3 Einbindung in die Umgebung | **5** | **15** |
| 4 Umfang der Funktionsbereiche | 10 | 10 |
| 5 fachspezifische Bedingungen | **15** | **5** |

Migration `0127` trifft beide exakt, ebenso die Zonenbänder aus Absatz 4 (bis 10 / 11–17 / 18–25 / 26–33 / 34–40) für FM 11 und FM 12.

**Die Gegenläufigkeit ist die Verordnung selbst, nicht ein Tippfehler** — die beiden Leistungsbilder gewichten diese zwei Merkmale bewusst umgekehrt. Erledigt ohne Codeänderung.

Alle übrigen Invarianten wurden maschinell geprüft und halten: 30 Punktesysteme, Summe der Höchstpunktzahlen gleich Obergrenze der höchsten Zone, Bänder lückenlos und überlappungsfrei ab 0, keine Zone ohne Kriterien.

### B5 — Doppelte Honorartafel-Zeilen für FEE_MASTER 1 und 1001 — ✅ ENTSCHIEDEN 26.08.2026: bleibt

`0115_hoai_reference_seed.sql:263-282` wiederholt die Zeilen 243–262 wertgleich unter neuen IDs, weiterhin mit `FEE_MASTER_ID = 1`. Dasselbe in `0123_hoai_2013_fassung.sql:313-332` für FM 1001. FM 1 hat damit 40 statt 20 Tafelzeilen.

Heute **kein** Rechenfehler, weil die Duplikate wertidentisch sind. Das Risiko ist die Zukunft: `findBounds` nimmt bei gleichem Basiswert die erste passende Zeile, `.order("BASE")` hat keinen Tie-Break. Wird eine Tafelkorrektur nur auf eine Kopie angewandt, hängt das Honorar von der Zeilenreihenfolge der Datenbank ab.

Frage: sollen die Duplikate per Migration entfernt werden? (FM 9 „Innenräume" hat mit den Zeilen 181–200 eine eigene, wertgleiche Tafel — das ist konsistent und kein Datenverlust.)

**Entscheidung 26.08.2026: unverändert lassen.** Die Duplikate wurden gegengeprüft und sind wertgleich (Zeilen 21–40 wiederholen 1–20 für FM 1 Wert für Wert), es entsteht heute kein Rechenfehler.

**Damit bleibt die Falle bewusst stehen:** wird eine Tafelzeile je korrigiert, muss die Korrektur auf **beide** Kopien angewandt werden — sonst hängt das Honorar davon ab, welche Zeile `findBounds` zuerst sieht, und `.order("BASE")` hat keinen Tie-Break. Das gehört in die Notiz jeder künftigen Tafel-Migration.

### B6 — Rundung: Verteilungsrest und uneinheitliche `round2`-Varianten — ✅ TEILWEISE BEHOBEN 26.08.2026

- **Verteilungsrest:** die Anteile in `computeSurchargeAllocations` (`controllers/stammdaten.js:1841-1848`) bleiben ungerundet, gerundet wird erst je Strukturzeile (`:605-607`, `:1912-1914`), ohne Restbetrags-Ausgleich. Szenario: 3 LPH à 1.000,00 €, Zuschlag 100,00 € → je 33,333… → 3 × 1.033,33 = **3.099,99 €** statt 3.100,00 €. Ein Cent, aber die Zuschlagszeile im PDF weist 100,00 € aus. `distributeAcrossRemaining` (`services/partialPayments.js:222-231`) macht es richtig und legt den Rest auf die letzte Position — das ist das Vorbild.
- **Zwei `round2`-Varianten:** mit `Number.EPSILON` nur in `din276.js:15` und `mischhonorar.js:36`; ohne in `angebote.js:7/12`, `invoices.js:25`, `finalInvoices.js:21`, `partialPayments.js:25`, `stammdaten.js:66/89/154`, `nachtraege.js:16/21`. Bei Halbwerten laufen die Varianten auseinander. Die als Hausregel gedachte EPSILON-Variante ist die Minderheit.
- **Zwischenrundung:** `computeMischhonorar` (`services/mischhonorar.js:58`) rundet das Einzelhonorar je Zone innerhalb der Schleife und summiert dann gerundete Werte. Bei 2–3 Zonen ≤ 1–2 Cent, widerspricht aber der Regel, Interpolationsergebnisse nicht vorzeitig zu runden.

**Behoben: der Verteilungsrest.** `computeSurchargeAllocations` verteilt jetzt über einen neuen Helfer `distributeWithRemainder`, der alle Anteile bis auf den letzten rundet und dem letzten den Rest gibt — dasselbe Vorgehen wie `distributeAcrossRemaining` in `services/partialPayments.js`, das der Befund als Vorbild nennt. Auch die Aufteilung zwischen Leistungsphasen und Besonderen Leistungen ist so gebildet, dass beide Hälften zusammen exakt den Zuschlag ergeben.

**Beim Testen kam heraus, dass der naheliegende Test nichts beweist.** Die alte Fassung ließ die Anteile *ungerundet*, deren Summe war also exakt — der Cent ging erst verloren, als die Verbraucher (`:605-607`, `:1922`) jede Strukturzeile einzeln runden. Ein Test, der die rohen Anteile summiert, wäre auch vorher grün gewesen. Der Test rundet deshalb jeden Anteil einzeln, so wie es die Verbraucher tun; ein Kommentar im Test hält fest, warum. Gegen den Stand vor dem Fix schlagen 5 der 8 Tests fehl:

| Zuschlag | vorher | jetzt |
|---|---|---|
| 100,00 € auf 3 gleiche LPH | 99,99 € | 100,00 € |
| 987,65 € auf 4 ungleiche LPH | 987,64 € | 987,65 € |
| drei Zuschläge zusammen | 133,35 € | 133,34 € |

Der Fehler ging also in **beide** Richtungen, nicht nur nach unten.

**Offen bleiben die beiden anderen Punkte** — sie gehören zusammen und brauchen eine Festlegung, keine Korrektur:

- **14 Rundungshelfer, 2 davon mit `Number.EPSILON`** (`din276.js`, `mischhonorar.js`). Die EPSILON-Variante rundet Halbwerte zuverlässiger auf und entspricht damit dem kaufmännischen Runden; sie ist aber die Minderheit. Eine Vereinheitlichung verschiebt Ergebnisse an anderer Stelle um Cents — sie gehört bewusst entschieden und nicht nebenbei gemacht.
- **Zwischenrundung im Mischhonorar** hängt an derselben Frage und sollte zusammen mit ihr angefasst werden.

## C — Auslegungsfragen (kein Befund, nur Bestätigung)

- **Gewichtete Zonenmischung TGA** (`services/mischhonorar.js:14-28`, `docs/HOAI_MISCHHONORAR_TGA_CONCEPT.md`): Die frühere Falschangabe „§ 54 Abs. 3" ist korrigiert, Code und Konzept weisen den Auslegungscharakter explizit aus und nennen keine Fundstelle mehr. Das ist die geforderte Behandlung — der Stand sollte so bleiben.
- **Basis der 25-%-Schwelle bei § 33** (`services/din276.js:60-63`): „sonstige anrechenbare Kosten" ohne selbst geplante KG 400. Als Auslegung gekennzeichnet, zentral konstant, im Test mit Referenzbeispiel abgedeckt. In Ordnung.
- **BL-Typ `pct_gesamthonorar`** (`HonorarWizard.tsx:309-319`): Der Zyklus wird aufgelöst, indem die Zuschlagssumme ohne BL als Basis dient. Bewusste, kommentierte Festlegung — sollte im Vertrags- und PDF-Text sichtbar sein, damit die Bezugsgröße nachvollziehbar bleibt.

## Geprüft und unauffällig

Punktesystem-Invarianten aller 30 Systeme; Tafeldaten-Vollständigkeit und Monotonie über alle 885 Zeilen; Zonenbenennungen I–V passend zur jeweiligen Zonenzahl; Zonengrenzen inklusiv/inklusiv und im Code korrekt behandelt (`zoneFromPoints`, mit Grenzfall-Tests); `BASE` ist `numeric`, also numerisch sortiert; Abschlags-Deckel gegen den Leistungsstand (`partialPayments.js:347-350`) inklusive Storno-Saldierung; Einfrieren gebuchter Belege über `DOCUMENT_PDF_ASSET_ID` / `DOCUMENT_XML_ASSET_ID`; `hoai.calculator` unverändert im Modul `projects` (`licensing/capabilities.manifest.js:76`) — keine Verschiebung in eine höhere Tarifstufe.

---

# Teil 3 — Bereits behoben

**Stand 26.08.2026:**

- **E-Rechnung:** N1–N8 (außer dem offenen Teil von N5), N10, N12–N15, R1, R2, R6, R7, R9, S2, S4, S5, S6, S7; N9 und R5 teilweise. S8 bewusst belassen.
- **HOAI:** A1, A2, B1, B3, B5 (entschieden), B4 (geprüft: kein Fehler), B6 teilweise.

| Befund | Geänderte Dateien | Abgesichert durch |
|---|---|---|
| N1 | `services_einvoice_validator.js`, `tests/einvoice_validator.test.js` | 2 Regressionstests |
| N2 | `services_einvoice_validator.js`, `tests/einvoice_validator.test.js` | 2 Tests (Abweichung + Verrechnung) |
| N3 | `services_einvoice_data.js` | XML-Render eines Stornos, beide Syntaxen |
| N4 | `services_einvoice_cii.js`, `services_einvoice_ubl.js` | XML-Render, beide Syntaxen |
| N6 | `services_einvoice_validator.js`, `tests/einvoice_validator.test.js` | 2 Tests (fehlende IBAN → Error, unplausible → Warnung) |
| N7 | `services_einvoice_validator.js`, `tests/einvoice_validator.test.js` | 2 Tests, Feldnamen gegen `services_einvoice_data.js` geprüft |
| N9 (teilweise) | `services_einvoice_validator.js`, `tests/einvoice_validator.test.js` | 2 Tests; BT-30 bleibt offen |
| R7 | `services_einvoice_validator.js`, `tests/einvoice_validator.test.js` | 4 Tests (G, K, Käufer-USt-IdNr, Z ohne Grund) |
| S4 | `services_einvoice_validator.js`, `tests/einvoice_validator.test.js` | Test prüft beide Richtungen |
| N12 | `controllers/invoices.js`, `controllers/partialPayments.js`, `frontend-react/src/api/rechnungen.ts` | `tsc -b` grün; über die Oberfläche war der Pfad nie erreichbar |
| N13 | `services_einvoice_pdf_embed.js`, `tests/einvoice_pdf_embed.test.js` | 4 Tests gegen das erzeugte PDF |
| N5 | `services_einvoice_cii.js`, `services_einvoice_ubl.js`, `tests/einvoice_builders.test.js` | 2 Tests, gegen den Stand vor dem Fix gegengeprüft |
| N8 | `services_einvoice_validator.js`, `services_einvoice_cii.js`, Tests in beiden Dateien | 2 Validator- + 2 Builder-Tests |
| R9 | `services_einvoice_data.js` | Nullable-Annahme über die Reporting-Views belegt |
| S2 | `tests/einvoice_data_to_validator.test.js` | 12 Tests; gegen künstlich wieder eingebautes N1 gegengeprüft |
| N14 | `services_einvoice_data.js`, dieselbe Testdatei | 5 Tests, gegen den Stand vor dem Fix gegengeprüft (4 rot) |
| R6 | `migrations/0133`, `services/einvoiceSnapshot.js`, `services/generatedAssets.js`, beide Buchungs- und beide Lesewege | 8 Tests — **Migration noch einzuspielen** |
| R1, R2, R5, S5, N15 | `services_einvoice_data.js`, `services_einvoice_cii.js`, `services_einvoice_ubl.js`, `tests/einvoice_builders.test.js` | 7 neue Tests; gegen den Stand vor dem Fix gegengeprüft (6 rot) |
| N10 | `services_einvoice_data.js`, beide Builder, `tests/einvoice_security_retention.test.js` | 9 Tests; gegen den Stand vor dem Fix gegengeprüft (5 rot) |
| S6 | `services_einvoice_ubl.js` | neuer Wert byteweise identisch mit beiden alten |
| S7 | `docs/EINVOICE_ANALYSIS.md` | Warnkopf, Inhalt unverändert |
| A1 | `services/nachtraege.js` | Funktion isoliert ausgeführt, 4 Fälle |
| A2 | `services/finalInvoices.js`, `tests/finalInvoices.phases.test.js` | 3 Tests, gegen den Stand vor dem Fix gegengeprüft (2 rot) |
| B1 | `HonorarWizard.tsx`, `help/helpContent.tsx` | `tsc -b` grün; Entscheidung: Semantik bleibt |
| B3 | `services/stammdaten.js`, `controllers/stammdaten.js`, `HonorarWizard.tsx`, `tests/stammdaten.zonepercent.test.js` | 7 Tests, inkl. der beiden Ausnahmetypen |
| B4 | — | gegen § 44/§ 48 Abs. 3 und 4 geprüft, Daten korrekt |
| B6 (Verteilungsrest) | `controllers/stammdaten.js`, `tests/stammdaten.surcharge_alloc.test.js` | 8 Tests, gegen den Stand vor dem Fix gegengeprüft (5 rot) |

Volle Test-Suite nach allen Änderungen: **40 Suites, 573 Tests, alle grün.** (25.08.2026: 32 Suites, 499 Tests.) `npx tsc -b` grün.

## Was die zweite Runde am Buchen ändert

Die Vorprüfung ist ein Gate: `!v.ok && !force` wirft 422 und verhindert das Buchen (`services/invoices.js`, `services/partialPayments.js`, `services/finalInvoices.js`). Drei der neuen Regeln sind `error` und können deshalb Belege blockieren, die gestern noch durchgingen:

| Regel | blockiert, wenn … | im Produkt behebbar unter |
|---|---|---|
| BR-DE-5/6/7 (N7) | dem Mitarbeiter fehlt Name, Telefon oder Mail | Mitarbeiter → Stammdaten |
| BR-DE-1 (N6) | die Firma hat keine IBAN | Einstellungen → Firma |
| BR-CO-26 (N9) | weder USt-IdNr noch Steuernummer | Einstellungen → Firma |

In allen drei Fällen hätte der Empfänger die Rechnung abgewiesen — das Gate zieht die Ablehnung nur nach vorn, an eine Stelle, an der sie noch reparierbar ist. Jede Meldung nennt die Maske zum Nachpflegen. `force=true` bleibt als Notbuchung offen.

**Vor dem Ausrollen prüfenswert:** ob bestehende Mandanten diese Stammdaten gepflegt haben. Ein Mandant ohne IBAN merkt es sonst erst bei der nächsten Buchung.

**Erledigt am 26.08.2026:** der Test, der `loadInvoiceData` gegen `validateEInvoiceData` laufen lässt (S2). Er hat sich sofort bezahlt gemacht — der neue Befund N14 stammt von ihm, und er hätte N1 nachweislich gefunden. Die jetzigen Tests prüfen den Validator gegen ein handgebautes Fixture — dass Fixture und echtes Datenmodell übereinstimmen, prüft weiterhin niemand automatisch. Genau diese Lücke hat N1 so lange verdeckt.

**A1 · `s3Cumul`** — behoben am 25.08.2026 in `backend/services/nachtraege.js`. Die fehlende Zeile wurde eins zu eins aus `services/angebote.js:21` übernommen:

    const s3Cumul = !!(settings?.SURCHARGE_3_CUMUL ?? true);

Die Spalte `SURCHARGE_3_CUMUL` existiert in der Nachtragstabelle (`migrations/0105_nachtrag_foundation.sql:84`, Default TRUE), der Vorgabewert `?? true` passt dazu.

Funktional geprüft, indem die Funktion isoliert ausgeführt wurde:

| Fall | Ergebnis |
|---|---|
| nur Zuschlag 1 (20 % auf 10.000 €) | 2.000 € — vorher `ReferenceError` |
| drei Zuschläge kumulativ (je 10 %) | 1.000 / 1.100 / 1.210 € — korrekte Staffelung |
| Zuschlag 3 nicht kumulativ | 1.000 € auf die Basis statt auf den Zwischenstand |
| keine Zuschläge | alles 0 |

Der dritte Fall belegt, dass das Flag jetzt tatsächlich ausgewertet wird.

**Offen bleibt:** `services/nachtraege.js` hat weiterhin keinen Test. Ein Test für `computeSurcharges` mit genau diesen vier Fällen wäre die passende Absicherung.

---

# Teil 4 — Empfohlene Reihenfolge

1. ~~**N1**~~ ✅ — erledigt, ebenso ~~**N7**~~, ~~**N9**~~ (teilweise), ~~**R7**~~ und als Zugabe ~~**N6**~~ und ~~**S4**~~. Der Validator ist damit auf dem Stand, den er ohne weitere Stammdaten-Erweiterung erreichen kann. Was hier offen bleibt: **BT-30 (Registernummer)** als saubere Lösung von N9 — eine Stammdaten-Erweiterung, keine Validator-Änderung.
2. ~~**A2**~~ ✅ — erledigt. Die vorgeschaltete Frage („kommt die Drift produktiv vor?") wurde übersprungen: sie entscheidet den Fix nicht. Zwei Wege, die denselben Betrag verschieden rechnen, sind unabhängig von der Datenlage falsch. **Offen bleibt trotzdem**, ob produktiv Drifts existieren — das ist jetzt keine Frage der Korrektheit mehr, sondern eine der Datenhygiene (siehe A3, das dieselbe Wurzel hat).
3. ~~**N12 / N13**~~ ✅ — erledigt. Beim Umsetzen kam heraus, dass der fehlerhafte Pfad über die Oberfläche gar nicht erreichbar war (kein Aufrufer übergab `format=ubl`). Der Befund war richtig, seine Dringlichkeit geringer als angenommen.
4. ~~**N3 / N4**~~ ✅ — erledigt.
5. ~~**R6**~~ ✅ — erledigt, aber **in der falschen Reihenfolge**: die Korrekturen kamen zuerst, das Einfrieren danach. Folgenlos geblieben, weil zu dem Zeitpunkt ausschließlich Testdaten existierten und kein Beleg versendet war. Die Frage nach dem Umgang mit bereits ausgelieferten Belegen hat sich damit erübrigt, statt beantwortet zu werden — bei echten Kundendaten wäre sie zu beantworten gewesen. **Migration 0133 noch einzuspielen.**
6. ~~**B1–B6**~~ — am 26.08.2026 entschieden und, wo nötig, umgesetzt. Ergebnis: B1 bleibt wie es ist (Hinweis geschärft), B3 begrenzt, B4 war kein Fehler, B5 bleibt bewusst stehen, B6 zur Hälfte behoben.
   **Offen bleiben zwei Punkte, beide mit klarer nächster Handlung:**
   - **B2** — Rechtslage geklärt (§ 7 Abs. 2 HOAI: außerhalb der Tafel frei vereinbar, Extrapolation unzulässig). Nächster Schritt ist die Integration der RiFT-Erweiterungstabellen; bis dahin ist der Randwert ohne Hinweis weiterhin falsch.
   - **B6 Rundungskonvention** — 14 Rundungshelfer, 2 mit `Number.EPSILON`. Vereinheitlichung verschiebt Cents und braucht eine bewusste Festlegung; die Zwischenrundung im Mischhonorar hängt daran.
7. ~~**N10**~~ ✅ — erledigt. Die erwartete fachliche Abwägung entfiel: die XRechnung-FAQ gibt den Weg vor und schließt zwei der drei im Befund vorgeschlagenen Varianten ausdrücklich aus. **Lehre für die übrigen offenen Punkte:** vor der Abwägung nachsehen, ob der Normgeber die Frage schon beantwortet hat.

## Nicht geprüft

`costRateCalc.js`, `importService.js` und die Migrationen 0039–0100 im Detail (HOAI-Seite). Auf der E-Rechnungs-Seite wurde keine Peppol-Codeliste und keine ZUGFeRD-XSD herangezogen — die drei Befunde, die davon abhängen (N11, R4, R5), sind entsprechend gekennzeichnet.
