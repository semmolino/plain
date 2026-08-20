# Datenimport — Bestandsaufnahme & Ausbauplan (20.08.2026)

> Ergänzt [DATA_IMPORT_CONCEPT.md](DATA_IMPORT_CONCEPT.md) (Konzept vom 28.06.2026) um den
> **tatsächlich gebauten Stand**, die gefundenen Defekte und einen Vorschlag für den Ausbau —
> Schwerpunkt: **Vorlagen**, **Projektstrukturen/Bäume**, **Positionsebene** (Rechnungen/Buchungen).

---

## 0  Kurzfazit

Die **Engine ist besser als ihr Ruf**: Registry-Muster, Trockenlauf, Dubletten, Stapel + Rollback,
RBAC — das Fundament trägt und ist erweiterbar. Was fehlt, liegt an drei Stellen:

1. **Ein Blocker:** Die Domäne *Anfangsbestände* (`opening_balance`) läuft seit dem
   Security-Fix vom 09.08.2026 **in jeden Commit-Fehler** (fehlender `tenantId`, s. §2.1).
   Der teuerste Import der Kette ist damit aktuell tot.
2. **Die Vorlagen sind Rohlinge**, keine Arbeitsmittel: eine Zeile Beispiel, keine
   Wertelisten, keine Erklärung, keine Prüfung in Excel — und die Beispielzeile wird
   beim Hochladen **mitimportiert**.
3. **Alles Hierarchische und alles auf Positionsebene fehlt vollständig.**
   Projektstrukturen werden nicht importiert, sondern *generiert* (1 Position oder LP1–9 pauschal
   nach §34-Prozenten). Rechnungen/Zahlungen/Buchungen existieren nur als **eine Summe je Projekt**.

Die Reihenfolge der Arbeit sollte genau diese sein: **erst reparieren, dann Vorlagen, dann Bäume,
dann Positionsebene** (§7).

---

## 1  Ist-Stand

### 1.1  Architektur

| Baustein | Ort |
|---|---|
| Engine (Parser, Mapping, Vorschau, Commit, Rollback, Vorlagen) | [importService.js](../backend/services/importService.js) — 1.422 Zeilen, Domänen-Registry `DOMAINS` |
| Controller / Routen | [importController.js](../backend/controllers/importController.js), [routes/import.js](../backend/routes/import.js) — alle `requirePermission('import.manage')`, multer memoryStorage, 5 MB, csv/xlsx/xls |
| DB | `IMPORT_BATCH` (0087) + nullable `IMPORT_BATCH_ID` auf 12 Tabellen (0087–0095), alle eingespielt |
| RBAC | Permission `import.manage` (0088), Default über `settings.company.edit` |
| UI | [ImportSection.tsx](../frontend-react/src/pages/admin/ImportSection.tsx) — Tab `datenimport` in AdminPage, 455 Zeilen |
| Hilfe | 8 Einträge `import.*` in `helpContent.tsx` |
| Tests | [importService.test.js](../backend/tests/importService.test.js) — 664 Zeilen, **nur reine Funktionen** (Parsing/Mapping/Entry-Bau). Commit/Rollback: 0 Tests |

**Ablauf je Domäne:** `parseBuffer → buildAutoMapping → buildPreview` (Trockenlauf, schreibt nichts)
→ `commit` (legt `IMPORT_BATCH` an, schreibt gültige Zeilen mit `IMPORT_BATCH_ID`)
→ `rollback` (löscht je Stapel, blockiert wenn Live-Daten anhängen).

### 1.2  Die 7 Domänen

| # | Domäne | Was sie wirklich tut | Bewertung |
|---|---|---|---|
| 1 | `address` | 16 Felder, Land-FK, Kategorie-Katalog, Dublette Name 1 + PLZ | **solide** |
| 2 | `contact` | Adresse + Anrede Pflicht, Geschlecht aus Anrede ableitbar | **solide** |
| 3 | `employee` | 10 Felder; **kein** Login, Rolle, Abteilung, Arbeitszeitmodell, Kostensatz | brauchbar, aber der Mitarbeiter ist danach für Zeiterfassung/Kosten **nicht arbeitsfähig** |
| 4 | `project` | Nur Kopf: Nummer, Name, Status, Typ, PL, Bauherr. Status/PL/Bauherr Pflicht + über **Namen** aufgelöst | brauchbar; harte FK-Pflicht macht die Reihenfolge zwingend |
| 5 | `project_fee` | **generiert** Struktur (1 Position *oder* LP1–9 nach §34-Prozenten) + `PROJECT_PROGRESS` + `CONTRACT` | Ersatz für den fehlenden Baum-Import — Kern des Problems |
| 6 | `opening_balance` | 1 Beleg je Projekt (Abschlag *oder* Rechnung) über die echte Beleg-Pipeline `init → Struktur → book(skipDocuments)`, optional Zahlung | konzeptionell richtig, **aktuell defekt** (§2.1) |
| 7 | `opening_cost` | 1 `TEC`-Zeile `LUMP_COST` je Projekt auf dem Blattknoten | funktioniert, sehr grob |

### 1.3  Was es *nicht* gibt

Kein Import für: **Projektstruktur als Baum**, Projektteam (`EMPLOYEE2PROJECT`), Stundensätze/Rollen
(`EMPLOYEE_CP_RATE`, `PROJECT_SP_RATES`, `PROJECT_BOOKING_PRICE`), Arbeitszeitmodelle, Abwesenheiten +
Urlaubsanspruch, **Angebote** (`OFFER` + `OFFER_STRUCTURE`), Nachträge, DIN-276-Kosten, Textbausteine,
eigene Stammdatenlisten (Projekttypen, Buchungsarten), **Einzelbuchungen** (`TEC`), **einzelne
Rechnungen/Positionen**, Zahlungen einzeln, Mahnungen.

Ebenfalls nicht gebaut, obwohl im Konzept zugesagt: **Stichtag/Cut-over-Modell** (kommt nur im
Konzepttext vor), **Zeilen abwählen**, **Dubletten zusammenführen** (`merge`), **Fehlerprotokoll zum
Download**, **Mapping je Mandant merken** (`MAPPING_JSON` wird geschrieben, aber **nie gelesen**),
Einbindung in die Onboarding-Checkliste als eigener Schritt.

---

## 2  Gefundene Defekte

> **Stand 20.08.2026:** §2.1 sowie 2.2 a, b, c und e sind behoben (Stufe I0, s. §7).
> Offen bleiben d, f, g, h, i, j.

### 2.1  BLOCKER — `opening_balance` schlägt bei jedem Commit fehl *(behoben)*

`commitOpeningBalanceRows` ruft:

```js
// importService.js:789 / :799
invSvc.initInvoice(supabase,       { companyId, employeeId, projectId, contractId, invoiceType: null })
ppSvc.initPartialPayment(supabase, { companyId, employeeId, projectId, contractId })
```

Beide Services verlangen seit Commit `13e88c4` („fix(security): Rechnungs-Init an den Mandanten
binden", 09.08.2026) **`tenantId`** und werfen sonst sofort:

```js
if (tenantId == null || tenantId === "") throw new Error("initInvoice: tenantId ist erforderlich")
```

`importService.js` wurde zuletzt am 17.07.2026 angefasst — der Security-Fix hat die Aufrufer nicht
mitgezogen. Folge: jede Zeile bricht mit *„Anfangsbestand für P-… fehlgeschlagen:
initPartialPayment: tenantId ist erforderlich"*, und es bleibt ein **leerer Stapel** zurück, den der
Nutzer von Hand zurücksetzen muss.

**Derselbe Fehler steckt im Demo-Seed** (`backend/demo/seed/generators/invoicing.js:154` und `:296`) —
der Demo-Mandant kann damit keine Belege erzeugen.

*Fix (erledigt):* `tenantId` an allen vier Stellen durchgereicht; abgesichert durch
`backend/tests/importService.commit.test.js` („reicht tenantId an initPartialPayment durch").

### 2.2  Weitere Befunde

| # | Befund | Wirkung |
|---|---|---|
| a | `buildTemplate` schreibt eine **Beispiel-Datenzeile** in die Vorlage | Wer sie stehen lässt, importiert „Mustermann Architekten GmbH" als echten Datensatz |
| b | `commitProjectFeeRows` setzt **kein `SORT_ORDER`** | LP1–9 stehen alle auf `0`; die Struktur-Liste sortiert nach `SORT_ORDER` → **zufällige Reihenfolge** der Leistungsphasen |
| c | `commitProjectFeeRows` setzt **kein `CONTRACT_ID`** auf den Strukturknoten | Fällt heute auf Projektebene zurück (`loadProjectStructuresForContext`), bricht aber bei Mehr-Vertrags-Projekten |
| d | Commit ist **nicht transaktional** — schlägt Zeile 300 fehl, stehen 299 Zeilen bereits | teilweise importierte Stapel; Rollback existiert, aber der Nutzer muss ihn selbst auslösen |
| e | `parseBuffer` liest **nur das erste Tabellenblatt**, ohne Hinweis | Exporte mit Deckblatt/mehreren Blättern scheitern stumm oder importieren das Falsche |
| f | Kontext-Lookups mit `.limit(100000)`, volle Tabellen im Speicher | ab mittleren Beständen teuer; keine Paginierung |
| g | Vorschau max. 200 Zeilen, **keine Zeilenabwahl**, kein Fehlerprotokoll | bei 800 Fehlern keine Arbeitsgrundlage |
| h | Belegdatum bei `opening_balance` ist immer **heute** | Altbelege landen im laufenden Monat → Perioden-/Jahresauswertung verzerrt |
| i | `docNumber` geht ungeprüft in `INVOICE_NUMBER`/`PARTIAL_PAYMENT_NUMBER` | Kollision mit dem Nummernkreis möglich |
| j | `xlsx@0.18.5` (letzte npm-Version von SheetJS) parst **hochgeladene Fremddateien** | CVE-2023-30533 (Prototype Pollution in `XLSX.read`) + CVE-2024-22363 (ReDoS); Fixes liegen nur auf cdn.sheetjs.com, nicht auf npm |

---

## 3  Die Excel-Vorlagen — heute und was sie brauchen

**Heute** (`buildTemplate`): ein Blatt, Zeile 1 = Header (Pflichtfeld mit `*`), Zeile 2 = Beispiel. Sonst nichts.

Was fehlt — jeder Punkt ist ein realer Stolperstein beim ersten Kontakt:

1. **Kein Erklärblatt.** Kein „so gehst du vor", keine Reihenfolge der Bereiche, kein Hinweis, dass
   Adressen vor Projekten kommen müssen.
2. **Keine Wertelisten.** `Status`, `Kategorie`, `Anrede`, `Geschlecht`, `Land`, `Abrechnungsart`
   werden über den **Namen** aufgelöst und sind teils **Pflicht** — der Nutzer sieht die gültigen
   Werte nirgends. Sie sind mandanten- bzw. systemabhängig (`PROJECT_STATUS`, `PROJECT_TYPE`, `GENDER`,
   `SALUTATION`, `COUNTRY`) und gehören **dynamisch** in die Vorlage.
3. **Keine Datenprüfung/Dropdowns** in Excel — im Konzept §2.2 Punkt 1 ausdrücklich vorgesehen.
4. **Beispielzeile ist eine Falle** (§2.2a) — gehört auf ein eigenes Blatt „Beispiel".
5. **Keine Formathinweise** je Spalte (Datum, Dezimaltrennzeichen, netto/brutto, PLZ als Text).
6. **Keine Spaltenbreiten/Formatierung** — die Datei sieht nach Rohausgabe aus, nicht nach Produkt.
7. **Kein Bezug auf den eigenen Bestand.** Beim Projekt-Import müsste die Vorlage die vorhandenen
   Mitarbeiter-Kürzel und Adressnamen als Auswahl mitbringen.
8. **Kein Gesamtpaket.** Sieben Einzeldownloads statt einer Arbeitsmappe „Onboarding" mit einem
   Blatt je Bereich in der richtigen Reihenfolge.
9. **Kein Rückweg.** Fehlerhafte Zeilen kommen nicht als korrigierbare Datei zurück.
10. **Keine Beispieldatei mit echtem Bürofall** (Konzept: „Pilotprojekt").

### Vorschlag „Vorlage 2.0" (serverseitig, `buildTemplate` erweitern)

Eine Arbeitsmappe je Bereich mit vier Blättern — **oder** eine Gesamtmappe mit allen Bereichen:

| Blatt | Inhalt |
|---|---|
| `Anleitung` | Zweck, Reihenfolge/Abhängigkeiten, Pflichtfelder, Formate, „was passiert danach" |
| `Daten` | Header + Datenprüfung (Dropdown aus `Listen`), Spaltenbreite, Zahlen-/Datumsformat, Kommentar je Header, erste Zeile **leer** |
| `Beispiel` | 3–5 realistische Zeilen (wird nie importiert, da eigenes Blatt) |
| `Listen` | Erlaubte Werte **aus dem Mandanten** gezogen (Status, Typ, Anrede, Geschlecht, Land, Kürzel, Adressnamen) — Quelle der Dropdowns |

Technisch mit `xlsx` machbar (`!cols`, Datenprüfung über benannte Bereiche); alternativ `exceljs`
einführen, falls die Validierung mit `xlsx` zu eng wird. **Wichtig:** `parseBuffer` muss dann gezielt
das Blatt `Daten` lesen (heute: `SheetNames[0]`) und bei mehreren Blättern eine Blattauswahl anbieten.

---

## 4  Projektstrukturen / Bäume — der eigentliche Brocken

### 4.1  Warum das schwer ist (Realität im Datenmodell)

`PROJECT_STRUCTURE` ist kein flaches Positionsblatt:

- **Hierarchie über `FATHER_ID`**, die erst nach dem Insert bekannt ist → **2-Pass-Muster**
  (alle Knoten mit `FATHER_ID=null` schreiben, dann per `tmp_key`-Abbildung nachziehen). Vorlagen
  dafür existieren in [projekte.js:186-260](../backend/services/projekte.js#L186-L260) und
  [angebote.js:1174-1250](../backend/services/angebote.js#L1174-L1250).
- **Elternwerte sind abgeleitet, nicht importierbar.** `recalcParent` summiert `REVENUE`, `EXTRAS`,
  `COSTS`, `REVENUE_COMPLETION`, `INVOICED`, `PAYED` **aus den Kindern** und legt die
  **eigenen Zuschläge des Elternknotens** obendrauf (`SURCHARGE_1..3`, kumulativ oder nicht,
  `REVENUE_BASIS` vs. `REVENUE`). Wer Elternsummen aus Excel schreibt, erzeugt Zahlen, die beim
  ersten Speichern im UI überschrieben werden.
- **Ein Blatt mit Werten, das Kinder bekommt, muss seine Werte abgeben** (`checkParentForChild` →
  `needs_transfer` / `blocked`). Ein Baum-Import darf das gar nicht erst provozieren: Werte gehören
  **ausschließlich an die Blätter**.
- **`BILLING_TYPE_ID` ist je Knoten Pflicht** (1 = Pauschal, 2 = Stunden). Bei BT=2 muss
  `REVENUE = 0` bleiben — der Umsatz entsteht aus `TEC` (`recomputeStructure`). Mischbäume
  (Mischhonorar) sind der Normalfall, nicht die Ausnahme.
- **Jeder Knoten braucht eine `PROJECT_PROGRESS`-Zeile** (Leistungsstand-Snapshot), sonst fehlen
  Fortschritt und Reporting.
- Dazu: `SORT_ORDER` (Schrittweite 10), `CONTRACT_ID`, `IS_INTERNAL`, `EXTRAS_PERCENT` (NK),
  optional `FEE_CALC_*`-Verknüpfungen zur HOAI-Kalkulation.

Der heutige Ausweg (`project_fee`: eine Position **oder** LP1–9 nach §34-Standardprozenten) ist
für ein reines HOAI-Gebäudeprojekt vertretbar — er bricht, sobald ein Büro **eigene Gliederungen**
hat (mehrere Leistungsbilder, TGA/Tragwerk, Bauabschnitte, LP-Splits, abweichende Prozentsätze,
Nebenkosten je Knoten, Stunden-Teilbäume). Genau das ist der Regelfall bei Bestandsdaten.

### 4.2  Vorschlag: Domäne `project_structure`

**Dateiformat — eine Zeile je Knoten, Hierarchie über Gliederungsnummer:**

| Projektnummer | Gliederung | Kürzel | Bezeichnung | Abrechnung | Honorar netto | NK % | Zuschlag 1 Text | Zuschlag 1 % |
|---|---|---|---|---|---|---|---|---|
| P-2024-012 | 1 | LB Gebäude | Leistungsbild Gebäude | | | 5 | | |
| P-2024-012 | 1.1 | LP1–4 | Vorplanung bis Genehmigung | Pauschal | 27.000,00 | | | |
| P-2024-012 | 1.2 | LP5 | Ausführungsplanung | Pauschal | 25.000,00 | | Baustellenzuschlag | 3 |
| P-2024-012 | 2 | BL | Besondere Leistungen | Stunden | | | | |

Regeln, die das beherrschbar machen:

1. **Gliederungsnummer (`1`, `1.1`, `1.1.2`) ist der Schlüssel** — daraus folgen Vater und Reihenfolge.
   Alternativ akzeptieren: Spalte `Ebene` (1/2/3) in Dateireihenfolge oder explizite Spalte
   `Vater-Gliederung`. Beides ohne IDs, rein fachlich lesbar.
2. **Geld nur an Blättern.** Beträge auf Knoten mit Kindern → Warnung, Wert wird ignoriert und aus den
   Kindern gerechnet. Optionale Plausibilitätsprüfung: Elternbetrag ≠ Σ Kinder → Warnung mit Differenz.
3. **`Abrechnung` nur an Blättern Pflicht**, Knoten brauchen keine.
4. **Validierung vor dem Schreiben:** Projekt existiert, keine Lücken (`1.1.1` ohne `1.1`), keine
   doppelten Gliederungsnummern je Projekt, keine Zyklen, Tiefe ≤ 5, Summenkontrolle je Projekt
   gegen eine optionale Spalte `Honorarsumme Projekt`, BT=2-Knoten ohne Betrag.
5. **Commit-Pipeline** (je Projekt, wiederverwendbar aus `projekte.js`):
   Knoten flach einfügen → `FATHER_ID` per `tmp_key` nachziehen → `SORT_ORDER = i*10` je
   Geschwisterebene → `PROJECT_PROGRESS` je Knoten → `recalcParent` **von unten nach oben** →
   Vertrag anlegen/verknüpfen (`CONTRACT_ID` auf die Knoten). Alles mit `IMPORT_BATCH_ID`;
   Rollback-Reihenfolge `PROJECT_PROGRESS → PROJECT_STRUCTURE → CONTRACT` existiert bereits.
6. **Vorschau als Baum, nicht als Liste.** Einrückung + Betragsspalte + Summenzeile je Projekt,
   Fehler am Knoten. Wiederverwendbar: `buildStructureTree`/`flattenTree` aus `utils/treeUtils`.
7. **Vorlagen-Generator aus dem Bestand:** „Struktur-Vorlage für ausgewählte Projekte erzeugen" —
   HOAI-Leistungsbild (Kataloge aus 0115–0128 liegen vor) vorbefüllt als Excel, Nutzer passt Beträge
   an und lädt zurück. Bequemster Weg und nutzt vorhandene Substanz.
8. **`project_fee` bleibt** als einfacher Schnellstart; `project_structure` ist die Ausbaustufe.
   Wer strukturiert importiert, überspringt `project_fee`.

Derselbe Mechanismus deckt später **`OFFER_STRUCTURE`** (Angebote) und **`NACHTRAG_STRUCTURE`** ab —
gleiches Muster, andere Zieltabelle. Das rechtfertigt, einen generischen **Baum-Importer** in der
Engine zu bauen statt einer Einmallösung.

---

## 5  Positionsebene: Rechnungen, Zahlungen, Buchungen

### 5.1  Was heute passiert

Nur Summen: `opening_balance` erzeugt **einen** Beleg je Projekt über die echte Beleg-Pipeline
(`init → *_STRUCTURE-Zeilen → book(skipDocuments)`) und verteilt den Betrag **proportional zur
`REVENUE`** über die BT1-Knoten. Das ist die technisch richtige Entscheidung (§10 des Konzepts):
`finalInvoices.js` rechnet `INVOICED`/`PARTIAL_PAYMENTS` aus den Rohtabellen **neu** — direkt gesetzte
Aggregate würden beim ersten Schlussrechnungslauf überschrieben. **Aber:** ein Beleg, ein Betrag,
Datum = heute, MwSt aus dem Vertrag, keine Historie.

### 5.2  Was echte Belegdaten zusätzlich verlangen

- **Zwei Ebenen in der Datei**: Belegkopf (Nummer, Datum, Typ, Projekt, Adresse/Kontakt, MwSt,
  Skonto, Fälligkeit, bezahlt) und Positionen (Strukturknoten *oder* Freitext, netto, NK-Anteil).
  Praktikabel: **zwei Blätter**, verknüpft über die Belegnummer.
- **Zuordnung Position → Strukturknoten** ist der kritische Punkt: nur über Gliederung/Kürzel lösbar
  → setzt §4 voraus. **Deshalb muss der Baum-Import zuerst kommen.**
- **Belegdatum, MwSt-Satz und Nummer aus der Datei** statt Default/heute — inklusive
  Kollisionsprüfung gegen den Nummernkreis und Anhebung des Zählers.
- **Abschlags-Kette:** Schlussrechnungen ziehen frühere Abschläge ab. Importierte Historie muss
  entweder vollständig sein oder als *ein* Anfangsbestand kommen — Mischformen erzeugen falsche
  Restforderungen. Hier gehört eine harte Regel hin (Stichtag, §6).
- **Zahlungen** je Beleg (`PAYMENT` + `PAYMENT_STRUCTURE`) mit Datum und Betrag; Teilzahlungen.
- **Kein PDF/XRechnung-Nachbau** — bleibt richtig (`skipDocuments`); im UI als „Referenzbeleg"
  kennzeichnen (`IMPORT_BATCH_ID` ist vorhanden, wird aber nirgends angezeigt).

### 5.3  Stunden/Buchungen (`TEC`)

Einzelbuchungen zu importieren heißt: `EMPLOYEE_ID`, `DATE_VOUCHER`, `STRUCTURE_ID`, Menge,
`CP_RATE` (**historischer** Kostensatz, nicht der heutige), `SP_RATE`, Buchungsart — und dabei
Monatsabschlüsse (`EMPLOYEE_MONTH_CLOSE`), ArbZG-Prüfungen und die Zeitkonto-Logik zu umgehen oder
zu bedienen. Empfehlung bleibt **aggregiert**, aber feiner als heute: **je Projekt × Mitarbeiter ×
Monat** statt einer Summe je Projekt. Das genügt für Deckungsbeitrag, Auslastung und Jahresvergleich
und vermeidet die gesamte Validierungs-Kaskade. Ein echter Einzelbuchungs-Import bleibt Ausbaustufe
„auf Wunsch", mit eigener Kennzeichnung (`BOOKING_KIND = 'IMPORT_HISTORY'`) und ohne Zeitkonto-Wirkung.

---

## 6  Querschnitt: was der Bereich insgesamt braucht

| Thema | Heute | Soll |
|---|---|---|
| **Stichtag** | nicht vorhanden | Ein Datum je Mandant (`TENANT_SETTINGS`), sichtbar im Assistenten; alle Anfangsbestände beziehen sich darauf, Belegdatum = Stichtag statt heute |
| **Zeilen abwählen** | nein | Checkbox je Vorschauzeile (Konzept §2.2.4) |
| **Dubletten** | nur „überspringen/trotzdem" | dritter Modus **zusammenführen** (Update statt Insert) |
| **Fehlerprotokoll** | nein | Download der Fehlerzeilen **als Excel mit Fehlerspalte** → korrigieren → erneut hochladen |
| **Mapping merken** | `MAPPING_JSON` wird geschrieben, nie gelesen | letztes Mapping je Mandant + Domäne als Vorschlag laden |
| **Transaktionalität** | Teil-Import möglich | Chunk-Fehler → automatischer Rollback des Stapels, oder „Stapel #N zurücksetzen" direkt im Fehler-Toast |
| **Herkunft sichtbar** | nur in „Letzte Importe" | Badge „importiert" am Datensatz (Adresse, Projekt, Beleg) — `IMPORT_BATCH_ID` liegt vor |
| **Onboarding** | Tab in Einstellungen | eigener Schritt in der Checkliste, „Bereich N von 7", Fortschritt über Domänen |
| **Tests** | nur reine Funktionen | Integrationstests je Domäne für Commit **und** Rollback (hätte §2.1 gefunden) |
| **Grenzen** | 5 MB, 200 Vorschauzeilen, `.limit(100000)` | dokumentieren, Vorschau paginieren, Kontexte gezielt laden |

---

## 7  Vorschlag Reihenfolge

| Stufe | Inhalt | Aufwand |
|---|---|---|
| **I0 — Reparatur** ✅ | `tenantId` in `opening_balance` (+ Demo-Seed), `SORT_ORDER`/`CONTRACT_ID` bei `project_fee`, Beispielzeile auf eigenes Blatt, Blatt-Hinweis im Assistenten, 15 Integrationstests für Commit + Rollback | erledigt 20.08.2026 |
| **I1 — Vorlagen 2.0** | 4-Blatt-Mappe mit Anleitung/Listen/Dropdowns aus dem Mandanten, Blattwahl beim Upload, Fehlerprotokoll als Excel zurück | mittel, **höchster sichtbarer Nutzen** |
| **I2 — Assistent** | Zeilenabwahl, Dubletten „zusammenführen", Mapping merken, Stichtag, Onboarding-Schritte, „importiert"-Badge | mittel |
| **I3 — Baum-Import** | generischer Baum-Importer + Domäne `project_structure` (§4), Vorschau als Baum, Struktur-Vorlage aus HOAI-Katalog generieren | **groß — das Kernstück** |
| **I4 — Belege** | Domäne `invoice_history` (Kopf + Positionen, Datum/MwSt/Nummer aus Datei, Zahlungen), setzt I3 voraus | groß |
| **I5 — Buchungen** | `TEC`-Anfangsbestand je Projekt × Mitarbeiter × Monat; Einzelbuchungen optional | mittel |
| **I6 — Rest** | Projektteam, Sätze/Preise, Abwesenheiten, Angebote/Nachträge (nutzt I3) | je klein |

---

## 8  Offene Entscheidungen — mit Empfehlung

### 8.1  `xlsx` erweitern oder `exceljs` einführen?

**Empfehlung: `exceljs` zum Schreiben einführen, `xlsx` zunächst nur noch lesen — und auch das
zeitnah ablösen.**

- *Fachlich:* Die Vorlage ist das erste Stück plan&simple, das ein Interessent in der Hand hält.
  Eine Vorlage, die falsche Werte gar nicht zulässt, ist Schicht 1 der Mülldaten-Abwehr aus
  Konzept §2.2 — heute existiert diese Schicht nicht.
- *Handhabung:* Dropdown = null Erklärungsbedarf. Ohne Datenprüfung rät der Nutzer den Wert und
  erfährt den Fehler erst nach dem Upload — eine Schleife pro Tippfehler.
- *Technisch:* Die freie SheetJS-Ausgabe (npm `xlsx`) **schreibt keine Data Validation** — mit 0.18.5
  ist das Feature nicht erreichbar, egal wie man es dreht. Dazu ist 0.18.5 die letzte npm-Version und
  trägt CVE-2023-30533 + CVE-2024-22363 (§2.2j), während wir damit **fremde Uploads** parsen.
  `exceljs`: MIT, aktiv auf npm, kann `dataValidation`, Spaltenbreiten, Zahlenformate, Kommentare,
  mehrere Blätter. Aufwand Schreibpfad ≈ 1 Tag.
- *Nebenbefund:* CSV sollte einen **eigenen** Pfad mit expliziter Trennzeichen- und
  Codierungserkennung bekommen — deutsche Exporte kommen häufig als Semikolon + Windows-1252,
  was heute stillschweigend zu Zeichensalat führen kann.

### 8.2  Baum-Notation

**Empfehlung: Gliederungsnummer als Leitformat, Ebenen-Spalte als geduldetes Zweitformat,
Vater-Schlüssel nur intern.**

- *Fachlich:* Büros denken in Gliederungen (LB/LP, Bauabschnitt, DIN-Ziffer). Die Nummer ist
  Hierarchie, Sortierung und Fachbezeichnung in einem und steht in fast jedem Altexport schon drin.
- *Handhabung:* Sie ist im Blatt sichtbar und übersteht Umsortieren — die Nummer gewinnt, nicht die
  Zeilenreihenfolge. Fehler sind lokal erklärbar („1.1.1 hat keinen Vater 1.1"). Die Ebenen-Spalte
  (1/2/3) ist bequem für handgetippte Listen, aber **reihenfolgeabhängig**: Ein Sortierklick in Excel
  zerstört den Baum lautlos → nur akzeptieren, wenn keine Gliederungsspalte da ist, und in der
  Vorschau ausdrücklich anzeigen, dass die Hierarchie aus Ebene + Zeilenreihenfolge gelesen wurde.
- *Technisch:* Ein expliziter Vater-Schlüssel wäre am robustesten, verlangt dem Nutzer aber einen
  zweiten künstlichen Schlüssel je Zeile ab (Tippfehler, Duplikate). Er gehört als `tmp_key` in die
  interne Normalisierung, nicht ins Nutzerformat. Beide Eingänge normalisieren auf
  `{tmp_key, father_tmp_key, sort}`, ab da eine Pipeline. Lücken, Duplikate, Tiefe und Zyklen sind
  bei Gliederungsnummern über Präfix-Logik trivial prüfbar.

### 8.3  Rechnungshistorie: Summe oder Einzelbelege?

**Empfehlung: nach Zahlungsstatus trennen — bezahlte Historie als Summe, offene Posten einzeln.**

- *Fachlich:* Die beiden Bestände haben verschiedene Zwecke. Bezahltes ist nur noch Rechenbasis
  (Schlussrechnungsabzug, Umsatz, Leistungsstand) — dafür genügt eine korrekte Summe. Offenes ist
  **operativ**: Fälligkeiten, Mahnstufen, Zahlungszuordnung, Skonto. Ein Sammelposten „12.400 € offen"
  ist wertlos, sobald zwei Rechnungen mit verschiedenen Fälligkeiten dahinterstehen.
- *Handhabung:* Die Mengen passen zum Aufwand. Offene Belege sind wenige (typisch 1–3 je aktivem
  Projekt) und schnell erfasst; bezahlte Historie sind hunderte Zeilen, die niemand aufbereiten will.
- *Technisch:* Beides läuft über denselben Pfad (`init → *_STRUCTURE → book(skipDocuments)`),
  Unterschied nur in Granularität und Feldern. Für Einzelbelege zusätzlich nötig: Datum, MwSt-Satz,
  Fälligkeit und Nummer aus der Datei, Prüfung gegen den Nummernkreis **plus Anheben des Zählers**,
  sowie eine Warnung im Schlussrechnungs-Wizard, wenn nicht alle Vorbelege eines Projekts vorliegen.

### 8.4  Eigene Permission für den Baum-Import?

**Empfehlung: nein — `import.manage` reicht. Ausnahme: der Beleg-Import (I4).**

- *Fachlich:* `import.manage` heißt bereits „darf Altbestand einspielen" (Default Inhaber/Admin).
  Der Baum-Import schreibt nichts, was `project_fee` nicht schon schreibt (Struktur, Honorar, Vertrag).
- *Handhabung:* Der RBAC-Katalog ist groß genug; jede weitere Zeile ist eine Entscheidung, die ein
  Bürochef treffen muss, ohne dass sich der Personenkreis ändert.
- *Technisch:* Alle Import-Routen tragen `requirePermission('import.manage')` — der Baum-Import erbt
  es ohne Migration.
- *Ausnahme:* Der Beleg-Import erzeugt gebuchte Gelddaten (Forderungen, Zahlungen, Mahngrundlage).
  Dort zusätzlich eine **bestehende** Rechnungs-Permission verlangen (`invoices.create_partial` bzw.
  `invoices.book`) — keine Migration nötig, verhindert aber, dass ein reiner Stammdaten-Importeur
  Umsatzzahlen setzt. Nur wenn eine saubere Trennung gewünscht ist, wäre hier eine neue Permission
  `import.finance` vertretbar — dann per Migration und bewusster Entscheidung.
