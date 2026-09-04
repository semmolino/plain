# Konzept — Report „Teilfertige Leistungen"

Status: **Entwurf, wartet auf Freigabe**
Autor: Claude Code · Stand: 2026-09-04
Branch: `claude/report-teilfertige-leistungen-iy8lgp`

---

## 1. Warum

Zum Monats-, Quartals- und Jahresabschluss braucht jedes Planungsbüro eine Zahl,
die plan&simple bisher nicht liefert: **den Wert der erbrachten, aber noch nicht
abgerechneten Leistungen**. Steuerberater und Bank fragen sie an, sie steht in
der Bilanz, und ohne sie ist das Ergebnis eines Planungsbüros systematisch
falsch — Kosten sind in der GuV, der zugehörige Erlös noch nicht.

Die Branche nennt den Posten „teilfertige Leistungen", „unfertige Leistungen"
oder „nicht abgerechnete Leistungen"; gemeint ist immer dasselbe.

plan&simple hat alle Rohdaten dafür bereits: Leistungsstand je Projektelement,
gebuchte Kosten je Stunde/Fremdleistung, kumuliert abgerechnete Beträge mit
Belegdatum. Es fehlt die kaufmännische Verdichtung auf einen Stichtag.

---

## 2. Fachliche Grundlage

| Regel | Fundstelle | Konsequenz für den Report |
|---|---|---|
| Bilanzposten „unfertige Leistungen" im Umlaufvermögen | § 266 Abs. 2 B I 2 HGB | Aktivposten, projektweise ermittelt |
| Bewertung zu **Herstellungskosten** | § 255 Abs. 2 HGB | Pflicht: Einzelkosten + angemessene Gemeinkosten. Verbot: Vertriebskosten (S. 4). Wahlrecht: allg. Verwaltung |
| **Realisationsprinzip** — kein anteiliger Gewinn | § 252 Abs. 1 Nr. 4 HGB | Der HGB-Wert enthält **keine** Marge. Der Leistungswert (PoC-Sicht) schon → beide getrennt ausweisen |
| **Verlustfreie Bewertung** (strenges Niederstwertprinzip) | § 253 Abs. 4 HGB | Ansatz höchstens mit dem noch erzielbaren Erlös → Deckelung |
| Drohverlustrückstellung | § 249 Abs. 1 HGB | Überhang über die Deckelung ist ein Warnsignal, kein Vorratsposten |
| **Erhaltene Anzahlungen** | § 266 Abs. 3 C 3, § 268 Abs. 5 S. 2 HGB | Wenn mehr abgerechnet als geleistet: Passivposten, kein negativer Vorrat |
| **Saldierungsverbot** | § 246 Abs. 2 HGB | Aktiv- und Passivüberhänge **projektweise** trennen und getrennt summieren — niemals über Projekte hinweg verrechnen |
| Bestandsveränderung in der GuV | § 275 Abs. 2 Nr. 2 HGB (GKV) | Der eigentlich gebuchte Wert ist die **Differenz zweier Stichtage** → Vergleichsstichtag ist Pflichtfunktion, kein Extra |

Für Architekten und Ingenieure ist der Leistungsfortschritt üblicherweise über
die HOAI-Leistungsphasen bzw. Teilleistungen definiert — exakt das, was
plan&simple je Projektelement als Leistungsstand pflegt.

---

## 3. Rechenmodell

Alle Größen netto, je Projekt, zum Stichtag **T**.

### 3.1 Basisgrößen (aus dem Bestand, stichtagsscharf)

| Symbol | Bedeutung | Quelle |
|---|---|---|
| `B` | Auftragswert (Honorar + Nebenkosten + Zuschläge) | `BUDGET_TOTAL_NET` + Zuschläge der Nicht-Blattknoten |
| `L` | Leistungswert = erbrachte Leistung zu Auftragspreisen | `LEISTUNGSSTAND_VALUE` (BT 1: Leistungsstand % × Honorar; BT 2: gebuchter Stundenerlös) |
| `R` | kumuliert abgerechnet | `BILLED_NET_TOTAL` = Abschlagsrechnungen + (Teil-)Schlussrechnungen − Stornos, Belegdatum ≤ T |
| `K` | angefallene Kosten | `COST_TOTAL` = Σ `TEC.CP_TOT` mit `DATE_VOUCHER` ≤ T (Stunden zum Vollkostensatz **plus** Fremdleistungen/Auslagen als Spezialbuchungsarten) |
| `Z` | bezahlt | `PAYED_NET_TOTAL` (nur informativ) |

Belegdatum-Logik: Abschlagsrechnung → `PARTIAL_PAYMENT_DATE`, Rechnung →
`INVOICE_DATE`. Schlussrechnungen tragen in `TOTAL_AMOUNT_NET` bereits den um
die Abschläge **gekürzten** Restbetrag (`services/finalInvoices.js`,
`recomputeTotal`), Stornos tragen negative Beträge — die Summe `R` ist damit
ohne Sonderbehandlung das kumulierte Abrechnungsvolumen.

### 3.2 Ableitung

```
Abrechnungsgrad          q    = L > 0 ? min(1, R / L) : (R > 0 ? 1 : 0)

Unfertiger Leistungsanteil
(zu Auftragspreisen)     U    = max(0, L − R)

Erhaltene Anzahlung      A    = max(0, R − L)            → Passivseite

Kosten der unfertigen
Leistung                 K_u  = K × (1 − q) × f          f = Bewertungsfaktor (s. 3.3)

Teilfertige Leistung
— HGB (Herstellkosten)   TFL_HK    = min(K_u, U)         ← verlustfreie Bewertung
— Controlling (Erlös)    TFL_ERLOES = U

Abwertung / Drohverlust  D    = max(0, K_u − U)
Nicht realisierter Gewinn G   = U − TFL_HK               (nur Anzeige, PoC-Sicht)
```

Sonderfall `L = 0 ∧ R = 0 ∧ K > 0` (Kosten gebucht, Leistungsstand nie
gepflegt): `q = 0`, also `K_u = K × f`, aber `U = 0` und damit `TFL_HK = 0`.
Das wäre stillschweigend falsch — die Zeile wird deshalb mit dem Hinweis
**„Leistungsstand nicht gepflegt"** markiert und in einer eigenen Summenzeile
„nicht bewertbar" ausgewiesen, statt sie unter den Tisch fallen zu lassen.

### 3.3 Bewertungsfaktor `f`

`TEC.CP_RATE` ist der **Vollkostensatz** aus der Kostensatzrechnung
(`services/costRateCalc.js`): Direktkosten je produktiver Stunde plus
umgelegte Gemeinkosten aus `COST_RATE_CONFIG`. In dieser Umlage stecken je
nach Pflege auch Vertriebs- und allgemeine Verwaltungskosten — Vertriebskosten
sind nach § 255 Abs. 2 S. 4 HGB **nicht aktivierungsfähig**.

Statt zu raten, welcher Anteil das ist, bekommt der Mandant einen Stellhebel:
`f` = `wip_cost_factor_percent` (TENANT_SETTINGS, Default **100 %**). Der
Steuerberater gibt den Prozentsatz vor, der Report rechnet damit und weist ihn
in Kopf und PDF aus. Keine Migration nötig (Muster: Vorbelegungen).

### 3.4 Verdichtung

Getrennt, wegen § 246 Abs. 2 HGB:

* **Σ Teilfertige Leistungen** (Aktiva, Vorräte) = Σ `TFL_HK` bzw. Σ `TFL_ERLOES`
* **Σ Erhaltene Anzahlungen** (Passiva) = Σ `A`
* **Σ Drohverlust-Hinweis** = Σ `D` → Prüfhinweis auf Rückstellungsbedarf
* **Bestandsveränderung** = Σ TFL(T) − Σ TFL(T₋₁) → der GuV-Buchungswert

---

## 4. Stichtagsfähigkeit und Datenqualität

Der stichtagsbezogene Leistungswert kommt aus `PROJECT_PROGRESS` — der
Snapshot-Historie, die der Monatsabschluss (`services/monatsabschluss.js`) oder
ein manueller Projekt-Snapshot schreibt. Die bestehende RPC
`fn_project_list_report(p_tenant_id, p_as_of, …)` liest je Blattknoten den
letzten Snapshot ≤ Stichtag und fällt für Budget auf `PROJECT_STRUCTURE`
zurück. Kosten, Rechnungen und Zahlungen werden über ihre Belegdaten gefiltert,
sind also ohne Snapshot stichtagsscharf.

Daraus folgt eine harte Regel für diesen Report: **ohne Snapshot ≤ Stichtag
gibt es keinen belastbaren historischen Leistungsstand.** Der Report darf das
nicht verschweigen. Deshalb:

* Je Zeile wird das **Snapshot-Datum** ausgewiesen (letzter `PROJECT_PROGRESS`
  ≤ T über die Blattknoten des Projekts) — oder „kein Snapshot".
* Stichtag = heute nutzt den Live-Stand (Modus `now`), ohne Warnung.
* Kopfzeile zeigt „**n von m Projekten ohne Snapshot zum Stichtag**" mit
  Direktlink zu Einstellungen → Monatsabschluss.
* Aktion **„Stichtag festschreiben"** (nur für heute, Recht
  `settings.monthly_close.edit`) ruft den bestehenden Lauf
  `POST /stammdaten/monatsabschluss/run` und erzeugt die fehlenden Snapshots.

Weitere Zeilen-Marker: `R > L` → „Erhaltene Anzahlung"; `K_u > U` →
„Drohender Verlust"; `L = 0 ∧ K > 0` → „Leistungsstand nicht gepflegt".

---

## 5. Umsetzung

### 5.1 Backend

**Kein neues SQL für die Berechnung** — die vorhandene RPC liefert alle
Basisgrößen stichtagsscharf.

* `backend/services/wipReport.js` — gesamte Rechenlogik als reine Funktionen
  (`computeWipRow`, `aggregateWip`), damit sie ohne Datenbank testbar ist,
  plus `buildWipReport(supabase, tenantId, opts)` für die Datenbeschaffung.
* `backend/routes/reports.js`:
  * `GET /reports/wip` — Parameter `as_of` (Default heute), `compare_to`
    (optional), `cost_factor` (optional, sonst TENANT_SETTINGS),
    `status_ids` (optional). Antwort: `{ asOf, compareTo, costFactor, rows[], totals, dataQuality }`.
  * `GET /reports/wip/pdf` — gleiche Parameter, `reports.export`.
* Datenbeschaffung: `fn_project_list_report` je Stichtag (zweimal bei
  Vergleichsstichtag), Zuschläge der Nicht-Blattknoten wie in `/projects/list`
  über `loadParentSurchargesByProject`, dazu eine Abfrage auf
  `PROJECT_PROGRESS` für das Snapshot-Datum je Projekt.
* PDF: `backend/templates/modern_a/wip.njk` (Aufbau analog `monatsabschluss.njk`),
  `renderWipPdf` in `services_pdf_render.js` — Kopf mit Stichtag, Methode und
  Bewertungsfaktor, Projekttabelle, Summenblock, Fußnote zur Bewertungsmethode.
  Das ist das Blatt, das an den Steuerberater geht.
* Tests: `backend/tests/wipReport.test.js` — Grenzfälle `R > L`, `L = 0`,
  Drohverlust-Deckelung, Storno, Bewertungsfaktor, Rundung auf `fmt2`,
  Bestandsveränderung über zwei Stichtage.

### 5.2 Einstellungen (TENANT_SETTINGS, ohne Migration)

| Key | Default | Bedeutung |
|---|---|---|
| `wip_cost_factor_percent` | `100` | Anteil der gebuchten Vollkosten als Herstellungskosten |
| `wip_method_default` | `hk` | Vorbelegte Bewertungsmethode |
| `wip_status_ids` | leer = alle | Projektstatus, die in den Abschluss einfließen |

Gepflegt in Einstellungen → Vorbelegungen, jeweils mit `HelpHint`.

### 5.3 Frontend

Neuer Tab **„Teilfertige Leistungen"** in `DatenPage` (Reporting), Datei
`pages/daten/TeilfertigeLeistungenTab.tsx`, Lizenz-Feature `reports.advanced`.

1. **Kopf**: Stichtag (`type="date"`, Default letzter Monatsultimo),
   Vergleichsstichtag (Default Vormonats-/Vorjahresultimo), Umschalter
   Methode „Herstellkosten (HGB)" ↔ „Leistungswert (Controlling)",
   Anzeige Bewertungsfaktor, Datenqualitäts-Banner.
2. **KPI-Kacheln**: Teilfertige Leistungen (Aktiva) · Erhaltene Anzahlungen
   (Passiva) · Bestandsveränderung ggü. Vergleichsstichtag · Drohverlust-Hinweis.
3. **Tabelle** je Projekt nach dem Muster von `ProjektlisteTab`: Suche,
   `FilterChip` für Status/Projektleiter/Typ/Abteilung, Spaltenwähler über
   `useStickyState`, Sortierung, Summenzeile.
   Spalten: Projekt · Status · PL · Auftragswert `B` · Leistungswert `L` ·
   Leistungsstand % · abgerechnet `R` · **unfertig `U`** · Kosten `K` ·
   Kosten unfertig `K_u` · **TFL (HK)** · **erhaltene Anzahlung `A`** ·
   Drohverlust `D` · nicht realisierter Gewinn `G` · Vergleichswert ·
   Veränderung · Snapshot-Datum.
4. **Export**: CSV clientseitig über `utils/exportData.ts`, PDF über den
   Endpoint — beides hinter `reports.export`.
5. Leerzustand „noch keine Projekte" vs. „kein Treffer" getrennt.
6. Design-Tokens, Lucide-Icons (`AlertTriangle`, `Info`), keine festen Farben,
   `DialogFooter` falls Dialoge dazukommen.

### 5.4 In-Product-Hilfe

Neue Einträge in `frontend-react/src/help/helpContent.tsx`:
`report.tfl.was`, `report.tfl.methode`, `report.tfl.anzahlungen`,
`report.tfl.bestandsveraenderung`, `report.tfl.drohverlust`,
`report.tfl.stichtag_snapshot`, `report.tfl.kostenfaktor` — verdrahtet an den
Spalten-Headern (`help?: HelpId`) und an den KPI-Kacheln.

### 5.5 Berechtigungen

Der Report zeigt Kosten, Margen und den nicht realisierten Gewinn je Projekt —
das ist sensibler als die bestehende Projektliste. Vorschlag: eigene Permission
`reports.wip.view` (Migration `0136_rbac_wip_report.sql`), Default-Rollen
**Administrator, Geschäftsleitung, Buchhaltung** — bewusst *nicht*
Projektleiter und Mitarbeiter. Der Endpoint verlangt zusätzlich die
Gesamtsicht: eine auf eigene Projekte gefilterte Abschlusssumme wäre eine
irreführende Zahl, deshalb ist `reports.wip.view` ohne `reports.scope.all`
nicht sinnvoll und der Endpoint antwortet dann mit 403 statt mit einer
Teilsumme. → **Entscheidung durch den Nutzer, siehe Abschnitt 7.**

---

## 6. Optionale Stufe 2 — Abschluss festschreiben

Ein Stichtagswert, der sich im Nachhinein ändert, ist für einen Jahresabschluss
wertlos: nachgebuchte Stunden, ein Storno oder eine Leistungsstandkorrektur
verschieben die Zahl rückwirkend. Für den Monatsabschluss reicht die
Live-Berechnung, für den Jahresabschluss nicht.

* Migration `0137_wip_closing.sql`: `WIP_CLOSING` (Mandant, Stichtag, Methode,
  Bewertungsfaktor, Summen, wer/wann) und `WIP_CLOSING_LINE` (je Projekt alle
  Basis- und Ergebnisgrößen eingefroren), RLS analog zum Bestand.
* `POST /reports/wip/close` schreibt fest, `GET /reports/wip/closings` listet,
  der Tab zeigt festgeschriebene Abschlüsse zur Auswahl und markiert
  Abweichungen zwischen festgeschriebenem und heute berechnetem Wert.

Empfehlung: mitnehmen. Ohne Festschreibung wandert die Bilanzzahl.

---

## 7. Offene Entscheidungen

1. **Berechtigung** — eigene `reports.wip.view` (Empfehlung, Default
   Administrator/Geschäftsleitung/Buchhaltung) oder die bestehende
   `reports.view` wiederverwenden (dann sieht jeder Projektleiter die
   Unternehmenszahlen)?
2. **Umfang** — Stufe 1 (Live-Report, keine Migration außer RBAC) oder
   Stufe 1 + 2 (zusätzlich Festschreiben mit zwei neuen Tabellen)?
3. **Vorbelegte Methode** — „Herstellkosten (HGB)" (Empfehlung, das ist die
   Bilanzzahl) oder „Leistungswert" (die Controlling-Zahl)?

---

## 8. Was dieser Report bewusst nicht tut

* Keine Buchungssätze, kein DATEV-Export — der Report liefert die Werte, die
  Buchung macht der Steuerberater.
* Keine automatische Drohverlustrückstellung — nur der Hinweis auf den
  Prüfbedarf.
* Keine IFRS-PoC-Bilanzierung — der Leistungswert wird als Controlling-Sicht
  ausgewiesen, nicht als Bilanzansatz.
* Keine Änderung an bestehenden Reports oder an der Leistungsstandpflege.
