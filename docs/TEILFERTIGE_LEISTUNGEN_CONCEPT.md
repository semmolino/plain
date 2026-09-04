# Konzept — Report „Teilfertige Leistungen"

Status: **freigegeben und umgesetzt** (2026-09-04)
Autor: Claude Code · Stand: 2026-09-04
Branch: `claude/report-teilfertige-leistungen-iy8lgp`

Getroffene Entscheidungen: eigene Permission `reports.wip.view` · Umfang
Stufe 1 + 2 (Live-Report **und** Festschreiben) · vorbelegte Methode
Herstellkosten (HGB).

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
Abrechnungsgrad          q    = L > 0 ? min(1, max(0, R / L)) : (R > 0 ? 1 : 0)

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

`q` ist nach beiden Seiten begrenzt: über 1 wäre nichts mehr unfertig,
unter 0 (Stornos überwiegen die Abrechnungen) stiege der Kostenansatz über die
gebuchten Kosten hinaus.

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
Basisgrößen stichtagsscharf. Dazu kam beim Umsetzen genau eine
Datenbankfunktion, `fn_wip_snapshot_dates` (Migration 0137): PostgREST kann
kein `MAX … GROUP BY`, und das Snapshot-Datum je Projekt ist keine Kür, sondern
die Aussage darüber, ob der Stichtagswert überhaupt belegt ist.

* `backend/services/wipReport.js` — gesamte Rechenlogik als reine Funktionen
  (`computeWipRow`, `aggregateWip`), damit sie ohne Datenbank testbar ist,
  plus `buildWipReport(supabase, tenantId, opts)` für die Datenbeschaffung.
* `backend/routes/reports.js`:
  * `GET /reports/wip` — Parameter `as_of` (Default heute), `compare_to`
    (optional), `cost_factor` (optional, sonst TENANT_SETTINGS),
    `status_ids` (optional). Antwort: `{ asOf, compareTo, costFactor, rows[], totals, dataQuality }`.
  * `GET /reports/wip/pdf` — gleiche Parameter, `reports.export`.
* Datenbeschaffung: `fn_project_list_report` je Stichtag (zweimal bei
  Vergleichsstichtag) für einen Stichtag in der Vergangenheit,
  `VW_REPORT_PROJECT_DETAIL` für „heute" — dieselbe Trennung wie „Aktuell" ↔
  „Stichtag" im übrigen Reporting, weil `PROJECT_STRUCTURE` den letzten
  Snapshot überholen kann. Dazu die Zuschläge der Nicht-Blattknoten und
  `fn_wip_snapshot_dates` für das Snapshot-Datum je Projekt.
* Die Zuschlagskorrektur lag als Closure in `routes/reports.js`. Sie ist beim
  Umsetzen nach `services/reportSurcharges.js` gezogen und an beiden Stellen
  von dort bezogen worden — eine zweite Kopie wäre eine zweite Stelle, an der
  ein künftiger Zuschlagstyp vergessen wird. Der Mandantenfilter ist dabei
  ergänzt worden (vorher trug ihn nur RLS).
* Projekte ohne jede Bewegung zum Stichtag (kein Auftragswert, keine Leistung,
  keine Kosten, keine Abrechnung) fallen aus der Liste — sonst stünden
  Vorlagen und Altbestand im Abschluss.
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

Gepflegt in Einstellungen → Vorbelegungen, jeweils mit `HelpHint`. Ein
vorbelegter Statusfilter ist bewusst entfallen: die Statusauswahl passiert im
Report über Filter-Chips (clientseitig, wie in jeder anderen Liste), eine
zweite Stelle dafür wäre eine zweite Wahrheit.

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
das ist sensibler als die bestehende Projektliste. Umgesetzt als eigene
Permission `reports.wip.view` (Migration `0136_rbac_wip_report.sql`),
Default-Rollen **Administrator, Geschäftsleitung, Buchhaltung** — bewusst
*nicht* Projektleiter und Mitarbeiter. Wichtig dabei: die Rolle
„Projektleiter" bekommt in 0062 pauschal alles aus `MODULE='reports'`, mit
`reports.view` hätte also jeder Projektleiter die Abschlusszahlen.

Der Endpoint verlangt zusätzlich die Gesamtsicht (`reports.scope.all`): eine
auf eigene Projekte gefilterte Abschlusssumme sieht aus wie eine
Bilanzposition, ist aber keine — deshalb 403 statt Teilsumme.

Lizenzseitig hängt `reports.wip.view` im Capability-Manifest an
`reports.advanced` (`backend/licensing/capabilities.manifest.js`, Seed 0070b
und `docs/LICENSE_CAPABILITIES.md` sind daraus neu generiert).

Das Festschreiben (`POST /reports/wip/close`, `DELETE …/closings/:id`) hängt an
der bestehenden `settings.monthly_close.edit` — Festschreiben ist
Abschlussarbeit und braucht kein eigenes Recht.

---

## 6. Stufe 2 — Abschluss festschreiben (umgesetzt)

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

## 7. Entschieden (2026-09-04)

| Frage | Entscheidung |
|---|---|
| Berechtigung | eigene `reports.wip.view`, Default Administrator / Geschäftsleitung / Buchhaltung |
| Umfang | Stufe 1 **und** Stufe 2 — Live-Report plus Festschreiben |
| Vorbelegte Methode | Herstellkosten (HGB); im Report umschaltbar |

### Was beim Umsetzen aufgefallen ist

Der Abrechnungsgrad `q` war zunächst nur nach oben begrenzt (`min(1, R/L)`).
Überwiegen die Stornos die Abrechnungen, wird `R` negativ, `q` damit negativ
und `(1 − q) > 1` — der Kostenansatz lag dann **über** den gebuchten Kosten.
Die Grenze nach unten (`max(0, …)`) ist nachgezogen; der Fall steht als Test
in `backend/tests/wipReport.test.js`.

## 8. Was dieser Report bewusst nicht tut

* Keine Buchungssätze, kein DATEV-Export — der Report liefert die Werte, die
  Buchung macht der Steuerberater.
* Keine automatische Drohverlustrückstellung — nur der Hinweis auf den
  Prüfbedarf.
* Keine IFRS-PoC-Bilanzierung — der Leistungswert wird als Controlling-Sicht
  ausgewiesen, nicht als Bilanzansatz.
* Keine Änderung an bestehenden Reports oder an der Leistungsstandpflege.

---

## 9. Prüfen

* `npx jest tests/wipReport.test.js` — 30 Tests auf den Rechenkern
  (Grenzfälle: `R > L`, `R < 0`, `L = 0`, Drohverlust-Deckelung,
  Bewertungsfaktor, Rundung, Bestandsveränderung, Saldierungsverbot)
* `npx playwright test tests/teilfertig.spec.ts` — der Tab mit gemockter API:
  Aktiva und Passiva getrennt, Bestandsveränderung, Methodenwechsel,
  Snapshot-Marker, kein waagerechter Seitenlauf
* Migrationen **manuell** einspielen, in dieser Reihenfolge:
  `0136_rbac_wip_report.sql`, `0137_wip_closing.sql`

---
