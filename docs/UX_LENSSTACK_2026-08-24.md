# Systemanalyse Oberfläche — Linsen-Stapel, 24.08.2026

**Methode:** Die App wurde mit der bestehenden Demo-Fixture gerendert (Playwright, 1280×800 und 390×844) und im Browser vermessen — Spaltenpositionen, Containerbreiten, Trefferflächen. Dazu statische Auszählungen über `frontend-react/src` (35.707 Zeilen TSX, 4.466 Zeilen `globals.css`). Alle Zahlen sind gemessen; die Messbefehle stehen jeweils dabei.

**Abgrenzung:** Das [UX/UI-Audit vom 07.08.2026](UX_UI_AUDIT_2026-08.md) und [UI_VERBESSERUNGEN_KONKRET.md](UI_VERBESSERUNGEN_KONKRET.md) sind bekannt. Dieses Dokument wiederholt sie nicht, sondern misst den **Fortschritt seit dem 07.08.** und ergänzt Linsen, die dort nicht angelegt waren: Bedienökonomie, Zustandsführung in der URL, wahrgenommene Geschwindigkeit, Skalierung mit der Datenmenge.

---

## Kurzfassung

In drei Wochen ist viel Richtiges passiert: Die Farb-Erosion wurde zu **72 % zurückgebaut**, Fokus, Dialoge, Ladeplatzhalter und Navigation sind saniert, und mit `check:design` hängt jetzt ein Wächter im Build. Das Fundament ist heute besser als bei den meisten Produkten dieser Größe.

Was der Aufräum-Durchgang **nicht** erreicht hat, liegt eine Ebene tiefer und ist mit Tokens nicht zu lösen:

| # | Befund | Messwert | Schwere |
|---|---|---|---|
| 1 | **Drei Geldspalten sind beim Öffnen von /rechnungen unsichtbar** — die fixierte Aktionsspalte liegt darüber, ohne jeden Hinweis auf verborgenen Inhalt | Aktionen 1100–1264 px über SEB/Forderung/Offene Posten 1081–1330 px, `z-index: 1` vs. `auto` | **Kritisch** |
| 2 | **Die Haupttabellen passen schon auf dem Desktop nicht** | /rechnungen 1279 px in 1048 px (+22 %), /angebote 1205 px (+15 %); mobil 3,2× bzw. 3,4× Containerbreite | Hoch |
| 3 | **Keine globale Suche, kein Sprung-Befehl** | 0 Treffer für Command-Palette/Global-Search; jedes Ziel nur über Navigation → Reiter → Filter | Hoch |
| 4 | **Keine optimistischen Updates** — jede Eingabe wartet auf Server + Refetch | 0 `onMutate`, 0 `setQueryData`, 241 `invalidateQueries` | Hoch |
| 5 | **Inline-Styles sind trotz Aufräumens gewachsen** — der Wächter deckt diese Erosionsklasse nicht ab | 2.225 (Audit: 2.100), `--space-*` 64× vs. 1.898 rohe px | Hoch |
| 6 | **Reiter-Zustand folgt drei verschiedenen Mechanismen**, Einstellungen sind nicht verlinkbar | URL / `useState` / gelesen-aber-nie-geschrieben | Mittel |
| 7 | **Listen rendern und filtern alles im Browser** — ohne Paginierung, ohne Virtualisierung | 0 Virtualisierung, 7 Paginierungs-Treffer bei 88 Tabellen | Mittel |

Befund 1 ist ein Fehler, kein Geschmacksurteil, und betrifft die Bildschirmseite, auf der Geld gezählt wird.

---

## Linse 0 · Was sich seit dem 07.08. bewegt hat

Fairer Vergleich mit den Original-Messbefehlen des Audits:

| Kennzahl | 07.08. | 24.08. | |
|---|---|---|---|
| Hex-Farben in TSX (`#[0-9a-fA-F]{6}`) | 812 | **224** | −72 % ✓ |
| `:focus-visible`-Regeln | 3 | global gesetzt | ✓ |
| Dialoge mit Escape/Fokusfalle/`role="dialog"` | 0 | alle (`useDialog`) | ✓ |
| Skip-Link | 0 | 1 | ✓ |
| Abstand/Radius/Schatten/Status-Tokens | 0 | 92 Tokens, 7 Themes | ✓ |
| Navigation aus einer Quelle | 2 Arrays | `navItems.ts` | ✓ |
| Ladeplatzhalter | 0 | 10 Listen | ✓ |
| `FilterChip`-Kopien | 10 | 0 | ✓ |
| Dialog-Fußzeilen uneinheitlich | 13 falsch herum | 0 (`DialogFooter`) | ✓ |
| **Inline-Styles** | 2.100 | **2.225** | **+6 % ✗** |
| **`htmlFor` vs. `<label>`** | 38 / 411 | **52 / 425** | fast unverändert ✗ |
| **`aria-live`-Regionen** | 0 | **0** | unverändert ✗ |
| **`SortTh`-Kopien** | 8 | **5** | teilmigriert |
| **Unicode statt Lucide** | 226 | **63** in 14 Dateien | −72 %, Rest sitzt prominent |
| Breakpoints (distinct px) | 12 | 12 | unverändert |

**Die Lesart:** Alles, was *einmalig zentral* korrigierbar war, ist korrigiert. Alles, was **Disziplin an 100 Stellen** verlangt, steht — und die Inline-Styles sind sogar gewachsen. Das ist kein Verschulden, das ist ein Governance-Befund: `scripts/check-design-system.mjs` prüft undefinierte Variablen, undefinierte Klassen und Kontrast. Es prüft **nicht** Hex-Literale in `style={{}}`, Unicode-Icons, Schriftgrößen unter dem eigenen Minimum oder Abstände außerhalb der Skala. Genau die vier Klassen wachsen weiter.

---

## Linse 1 · Datentabellen — die eigentliche Arbeitsfläche

### 1.1 Verdeckte Geldspalten auf /rechnungen — kritisch

Gemessen bei 1280 × 800, Startzustand der Seite (`scrollLeft = 0`):

| Spalte | left | right | position |
|---|---|---|---|
| Netto € | 898 | 990 | static |
| Brutto € | 990 | 1081 | static |
| **SEB €** | **1081** | **1130** | static, `z-index: auto` |
| **Forderung €** | **1130** | **1222** | static, `z-index: auto` |
| **Offene Posten €** | **1222** | **1330** | static, `z-index: auto` |
| **Aktionen** | **1100** | **1264** | **sticky, `z-index: 1`** |

Die fixierte Aktionsspalte liegt über den drei letzten Wertspalten. Wer `/rechnungen` öffnet, sieht anstelle von Sicherheitseinbehalt, Forderung und Offenem Posten eine Reihe von `Details`/`PDF`/`⋯`-Knöpfen.

Nach vollständigem Rechtsscrollen (231 px) ordnet sich alles korrekt — die Spalten sind also **erreichbar, aber im Ausgangszustand unsichtbar**. Verschärfend:

```css
.table-scroll { overflow-x: auto; }   /* globals.css:2128 — mehr steht dort nicht */
```

Kein Schatten, kein Verlauf, keine gestaltete Bildlaufleiste. Unter Windows und macOS mit überlagerten Scrollbalken gibt es **keinen einzigen Hinweis**, dass 231 px Inhalt vorhanden sind. Das ist die Konstellation, vor der `UI_VERBESSERUNGEN_KONKRET.md` bei den Angeboten gewarnt und die fixierte Spalte dort deshalb zurückgenommen hat — in der Rechnungsliste ist sie aktiv.

**Vorschlag (klein, sofort):**
1. `z-index` der fixierten Zellen auch auf die `<td>` der Datenspalten legen (bzw. Aktionen auf einen eigenen Stapelkontext heben, Datenzellen `position: relative; z-index: 2`) — behebt die Verdeckung.
2. Scroll-Schatten am rechten Rand des `.table-scroll`, solange `scrollLeft + clientWidth < scrollWidth`. Eine `::after`-Regel mit `background: linear-gradient(...)`, gesteuert über eine Klasse aus dem vorhandenen `ResizeObserver`-Muster in `Tabs.tsx` — das Verhalten ist dort schon einmal richtig gelöst und lässt sich übernehmen.

### 1.2 Die Tabellen passen nicht — auch nicht auf dem Desktop

Gemessen: Tabellenbreite gegen Containerbreite.

| Seite | 1280 px Desktop | 390 px Mobil |
|---|---|---|
| /rechnungen | 1279 in 1048 (**+22 %**) | 1169 in 366 (**3,2×**) |
| /angebote | 1205 in 1048 (**+15 %**) | 1247 in 366 (**3,4×**) |
| /projekte | passt | 679 in 366 (1,9×) |
| /adressen | passt | 400 in 366 (1,1×) |

Die Regel „kein horizontaler Seitenlauf" **hält** — `document.body.scrollWidth` entspricht auf allen sechs geprüften Seiten exakt der Viewportbreite. Der Überlauf steckt sauber im Container. Nur: auf dem Handy bedeutet „sauber im Container" für eine Rechnungszeile **3,2 Bildschirmbreiten seitwärts pro Zeile**, mit deaktiviertem Sticky-Header (`@media (max-width:1023px)`). Der Spaltenbezug ist damit weg, sobald man scrollt.

Das ist der Punkt, an dem der Spaltenwähler („Spalten") nicht mehr genügt: Er ist eine Einstellung, die der Nutzer erst finden, verstehen und pro Liste pflegen muss. Nötig ist eine **Voreinstellung, die von sich aus passt**.

**Vorschlag:** Prioritätsgesteuertes Ausblenden statt Seitwärtsrollen.
Jede Spalte bekommt eine Stufe (1 = immer, 2 = ab Tablet, 3 = ab Desktop, 4 = nur über Spaltenwähler). Unterhalb der Schwelle klappt die Zeile auf Tipp/Klick zu einer Detailzeile auf, die die ausgeblendeten Felder als Paare zeigt. Das ist deutlich weniger Aufwand als ein zweites Kartenlayout, arbeitet mit der vorhandenen `hiddenCols`-Mechanik (`useStickyState`) zusammen und erhält die Tabelle als eine Implementierung.
Für /rechnungen wäre Stufe 1: Nummer, Datum, Status, Projekt, Brutto. Alles andere aufklappbar.

### 1.3 Zeilenaktionen unter der eigenen Trefferflächen-Regel

`/projekte`, erste Zeile, gemessen:

| Element | Größe | CLAUDE.md fordert |
|---|---|---|
| Bearbeiten | 30 × 30 | 44 × 44 |
| Kopieren | 30 × 30 | 44 × 44 |
| Löschen | 30 × 30 | 44 × 44 |
| Projektnummer (Hauptziel der Zeile) | 68 × **15** | 44 × 44 |

WCAG 2.5.8 (24 px) ist erfüllt, die **eigene** 44-px-Regel nicht. Der Link auf die Projektnummer — das eigentliche Ziel der Zeile — ist 15 px hoch.

Dazu die Gestaltung: Drei gleich große, gleich graue Icons nebeneinander, das dritte ist **Löschen**. `UI_VERBESSERUNGEN_KONKRET.md` §4 hat das bereits benannt; in der Projektliste steht es unverändert. Die Rechnungsliste macht es mit `RowMenu` schon richtig vor.

**Vorschlag:** Projektliste auf dasselbe Muster ziehen — Zeile anklickbar (ist sie in Angebote und Rechnungen bereits), sichtbar nur `Bearbeiten`, Rest in `⋯`. Löschen gehört grundsätzlich hinter das Menü, nicht in die Zeile. Zeilenhöhe 47 px trägt einen 40-px-Knopf problemlos.

### 1.4 Mobil bricht die Projektnummer um

Im 390-px-Screenshot bricht `P-2023-088` am Bindestrich in zwei Zeilen (`P-2023-` / `088`), Zeilenhöhen schwanken dadurch zwischen 220 und 250 px. Fünf Zeilen füllen den ganzen Bildschirm.

**Vorschlag:** Auf Kennungsspalten `white-space: nowrap` und `font-variant-numeric: tabular-nums`. Die Angebote-Liste hat für Titel bereits „einzeilig mit Auslassung" — dieselbe Behandlung fehlt bei den Nummern.

---

## Linse 2 · Bedienökonomie — Wege pro Aufgabe

### 2.1 Es gibt keinen direkten Weg zu einem bekannten Objekt

Gesucht, nicht gefunden: Command-Palette, globale Suche, Sprungfeld (`grep -ril "commandpalette|cmdk|globalsearch"` → 0).

Wer die Rechnung `RE-2025-0043` öffnen will, geht: Navigation → *Rechnungen* → Reiter *Rechnungsliste* → Suchfeld → tippen → Zeile. Vier Interaktionen plus Ladezeit für ein Ziel, dessen Namen der Nutzer bereits kennt. Bei zehn Hauptbereichen mit je 6–14 Reitern ist das der teuerste wiederkehrende Weg im Produkt.

Die Kopfzeile hat den Platz dafür: zwischen Stempeluhr und Glocke stehen auf 1280 px rund **900 px ungenutzt**.

**Vorschlag:** `Ctrl/Cmd + K` öffnet ein Sprungfeld über allem. Es durchsucht Projekte, Angebote, Rechnungen, Adressen, Mitarbeiter **und** die Reiter/Einstellungen selbst („Nummernkreise", „Rollen"). Das Backend braucht dafür einen `GET /suche?q=` über die fünf Tabellen mit `LIMIT 5` je Typ; RBAC filtert wie überall über `requirePermission`. Im Kopf steht sichtbar ein `⌘K`-Feld, damit die Funktion auch ohne Kürzel gefunden wird.

Das ist der Vorschlag mit dem höchsten Verhältnis von täglicher Zeitersparnis zu Aufwand in dieser Liste.

### 2.2 Jede Eingabe wartet auf den Server

```
onMutate:          0
setQueryData:      0
invalidateQueries: 241
```

Kein einziges optimistisches Update. Jede Statusänderung in einer Liste, jede Inline-Bearbeitung, jedes Häkchen läuft: Klick → Request → Antwort → `invalidateQueries` → **kompletter Refetch der Liste** → Neuaufbau. Bei einer Verbindung mit 150 ms Latenz sind das zwei Rundläufe (300 ms+) bis sich sichtbar etwas tut — bei einer Aktion, deren Ergebnis vorher feststeht.

Genau dieses Muster sitzt an den Stellen, die am häufigsten benutzt werden: `InlineEdit` in fünf Listen, Status-Dropdowns, Buchungsmaske.

**Vorschlag:** Optimistisches Update für die drei Mutationsarten, deren Ergebnis lokal berechenbar ist — Inline-Edit, Statuswechsel, Häkchen. Tanstack Query v5 bietet das Muster fertig an (`onMutate` schreibt in den Cache, `onError` stellt den Schnappschuss wieder her, `onSettled` invalidiert). Als gemeinsamer Hook `useOptimisticPatch(queryKey, apply)` einmal gebaut, an fünf Stellen verwendet.

Zweiter Hebel derselben Art: Nach einer Mutation wird oft die **ganze** Liste invalidiert, obwohl eine Zeile betroffen ist. Wo der Server das aktualisierte Objekt zurückgibt, reicht `setQueryData` — kein Refetch.

### 2.3 Der Reiter-Zustand folgt drei verschiedenen Regeln

| Seite | Mechanismus | Verlinkbar | Zurück-Taste |
|---|---|---|---|
| /projekte, /rechnungen, /mitarbeiter | `useSearchParams` (Lesen **und** Schreiben) | ✓ | ✓ |
| /angebote, /daten | `useState` + Navigations-State | ✗ | ✗ |
| **/admin** | `searchParams` beim Start gelesen, **nie zurückgeschrieben** | ✗ | ✗ |

`AdminPage.tsx:4290` liest `?tab=`, aber `const [searchParams] = useSearchParams()` hat keinen Setter — der Reiter landet nie in der Adresse. Konkrete Folgen: Man kann Kollegen keinen Link auf „Einstellungen → Rollen & Berechtigungen" schicken; die Zurück-Taste überspringt die gesamte Administration; ein Neuladen wirft auf *Stammdaten* zurück. Bei 14 Reitern hinter einer scrollenden Leiste ist das spürbar.

**Vorschlag:** Ein Hook `useTabParam(defaultId)`, der `?tab=` liest **und** per `replace: true` zurückschreibt. Alle sieben Reiterseiten darauf umstellen — das vereinheitlicht drei Muster zu einem und macht jeden Bereich der App verlinkbar. Aufwand: eine Datei plus sieben Einzeiler.

### 2.4 Kein Rückgängig

`grep -ro "Rückgängig|undo"` → **0**. Absicherung erfolgt durchgängig über Bestätigungsdialoge. Bei einer harten Löschung (Soft-Delete ist laut CLAUDE.md bewusst nicht im Einsatz) ist ein Dialog die einzige Bremse — und Dialoge werden bei Routine weggeklickt.

**Vorschlag:** Für die häufigen, umkehrbaren Fälle (Inline-Edit, Statuswechsel, Zeile entfernen aus einer Auswahl) den Bestätigungsdialog durch ein **Toast mit „Rückgängig"** und 5 Sekunden Frist ersetzen. Der Toast-Container ist vorhanden; nötig ist nur eine Aktions-Schaltfläche darin. Für echte Löschungen bleibt der Dialog.

### 2.5 Drei native `confirm()` in Wizard und Struktur

`Budget.tsx`, `HonorarWizard.tsx`, `ProjektStruktur.tsx` nutzen an 6 Stellen das Browser-`confirm()` — ungestyled, außerhalb des Themes, mit englischen Systemknöpfen je nach Browsersprache, und dem Produktnamen als Herkunftsangabe. Die App hat mit `ConfirmModal` an 22 Stellen ihren eigenen, korrekten Dialog.

**Vorschlag:** Sechs Aufrufe auf `ConfirmModal` umstellen. Rein mechanisch.

---

## Linse 3 · Visuelle Hierarchie

### 3.1 Das lauteste Element ist eine Nebenfunktion

Auf jeder Seite ist der grüne **Start**-Knopf der Stempeluhr das einzige vollflächig gesättigte Element über dem Falz. Die Primäraktion der Seite (`+ Neues Projekt`, dunkel gefüllt) sitzt darunter und wirkt ruhiger.

Das ist keine Token-Frage — `--timer-color` ist sauber definiert — sondern eine Frage der Rangfolge. Die Stempeluhr ist eine Dauerfunktion, keine Handlungsaufforderung.

**Vorschlag:** Start als Umriss-Knopf mit grünem Icon und grüner Schrift; die volle Fläche erst im **laufenden** Zustand, wo sie als Statusanzeige gerechtfertigt ist („läuft seit 02:14"). Das dreht die Sättigung genau dann auf, wenn sie Information trägt.

### 3.2 Einstellungen nutzen 44 % der Fläche

`/admin` bei 1280 px gemessen: `.app-main` ist 1080 px breit, die Einstellungskarten sind **480 px** (die Trennlinien dazwischen 1048 px). 568 px bleiben leer, während die Seite vertikal über mehrere Bildschirme läuft, weil in *Stammdaten* drei Bereiche (Abteilungen, Projekttypen, Rollen) plus Leistungsphasen-Blöcke und Arbeitszeitmodelle untereinander gestapelt sind.

Dazu ein sichtbarer Layout-Fehler: Rechts neben den `Hinzufügen`-Knöpfen hängen verwaiste graue Beschriftungen („Abteilung", „Typ") ohne erkennbaren Bezug — das Label rendert nach dem Knopf statt am Feld.

**Vorschlag:**
- Karten in zwei Spalten setzen (`grid-template-columns: repeat(auto-fill, minmax(420px, 1fr))`). *Stammdaten* passt damit auf einen Bildschirm.
- Verwaiste Labels an ihr Feld binden — das erledigt zugleich einen Teil der `htmlFor`-Lücke aus Linse 5.

### 3.3 Vierzehn flache Reiter ohne Gruppierung und ohne Suche

Die Einstellungen sind ein eigenes Produkt in der Produktmitte: 14 Reiter, davon 8 sichtbar, Rest hinter dem Scrollpfeil; 4.350 Zeilen in einer Datei. Zwischen *Stammdaten*, *Vorbelegungen*, *Nummernkreise*, *Dokumentvorlagen* und *E-Mail-Versand* muss man wissen, wo etwas liegt — es gibt keine Suche über Einstellungen.

**Vorschlag:** Auf Desktop eine gruppierte linke Spalte statt einer Reiterleiste, mit einem Suchfeld darüber:

```
Büro          Stammdaten · Unternehmen · Nummernkreise
Vorgaben      Vorbelegungen · Dokumentvorlagen · E-Mail-Versand
Abrechnung    Mahnungen · Monatsabschluss · Kostensatz-Rechner
Personal      Arbeitszeiten · Rollen & Berechtigungen
System        Datenimport · Benachrichtigungen · Engagement
```

Fünf Gruppen statt vierzehn Gleichrangigen. Auf Mobil bleibt die scrollende Leiste. Zusammen mit `useTabParam` (2.3) wird jede Einstellung direkt verlinkbar. Der Dateisplit von `AdminPage.tsx` in `pages/admin/*` fällt dabei nebenbei ab — die Sektionen sind bereits als eigene Komponenten geschrieben.

### 3.4 Drei Bauformen für dieselbe Handlung „auswählen"

Auf der Übersicht stehen innerhalb von 120 px übereinander: `Ansicht wechseln` (Umriss-Knopf, oben rechts), `Zeitraum` (**natives** `<select>` in eigener Leiste über die volle Breite für ein einziges Bedienelement) und ein Segmentband (blau gefüllte Pille für aktiv). Auf `/projekte` bedeutet Auswahl dagegen einen **unterstrichenen Reiter**.

Vier Bauformen für „hier wählt man aus". Ein neuer Nutzer lernt keine Regel, sondern vier Sonderfälle.

**Vorschlag:** Eine Regel festschreiben und in `globals.css` hinterlegen — *Reiter wechseln den Inhaltsbereich (unterstrichen), Segmente filtern denselben Inhalt (Pille), Dropdowns wählen aus vielen Werten*. Das native `<select>` für den Zeitraum durch die vorhandene gestylte Variante ersetzen und in die Kopfzeile des Kennzahlenbereichs setzen, statt ihm eine eigene Leiste zu geben.

### 3.5 Vier parallele Status-Kodierungen in einer Zeile

Eine Rechnungszeile trägt gleichzeitig: farbigen linken Rand (grün/orange), Chip *Gebucht*, Chip *Überfällig*, Spalte *Typ* (Storno/Abschlag/Schluss). Der linke Rand ist dabei **reine Farbe ohne Text** — WCAG 1.4.1 (Use of Color) verlangt ein zweites Merkmal.

**Vorschlag:** Farbrand behalten, aber an eine Bedeutung binden, die auch im Text steht (Storno ⇒ Rand + Typ-Spalte trägt es bereits ⇒ zulässig, wenn dokumentiert). Zwei Chips nebeneinander auf einen zusammenziehen: *Überfällig* ersetzt *Gebucht*, statt es zu ergänzen — überfällig impliziert gebucht.

---

## Linse 4 · Erosion — was der Wächter nicht sieht

`npm run check:design` läuft im Build und meldet „in Ordnung — 92 Tokens, 7 Themes, 630 Klassen". Er prüft undefinierte Variablen, undefinierte Klassen und Kontrast. Vier Erosionsklassen fallen durch das Raster:

| Klasse | Heute | Prüfung |
|---|---|---|
| Inline-Styles | 2.225 (AdminPage 393, MitarbeiterPage 282) | keine |
| Hex/rgba in `style={{}}` | 224 + 71 | keine |
| Schrift unter dem eigenen Minimum | 8 Regeln in CSS (10 px, 9 px) + 14 inline (8–10 px) | keine |
| Abstände außerhalb der Skala | `--space-*` 64× vs. 1.898 rohe px; 5, 7, 11, 13 px liegen neben dem 4er-Raster | keine |

Dazu die Reste der Zentralisierung:

- **`SortTh` liegt noch 5× lokal** — mit **drei verschiedenen Prop-Signaturen** (`field/current/onSort`, `k/sortKey/onClick`, `col/children/right`) und **drei verschiedenen Sortier-Zeichen** (`▲▼`, `↑↓`, `↕`). Nur 3 Listen nutzen `components/ui/SortTh`. Folge: `aria-sort` steht an **2 von 88 Tabellen**; in den fünf Kopien ist Sortieren reine Mausfunktion, weil das `<th>` keinen Tabstopp hat.
- **63 Unicode-Zeichen als Icons** in 14 Dateien. Die Hälfte davon sitzt in `TimerBar.tsx` (▶ ⏭ ⏹ ✕ ✓ ✎ 🗑 📋) — der Komponente, die auf **jeder** Seite in der Kopfzeile steht. Auch `Toast.tsx` schließt noch mit `✕`, und `SortTh` selbst nutzt `▲▼`.
- **Das Suchfeld-Icon ist nicht theme-fähig:** `globals.css:1543/1551` bettet das Lupen-SVG als Data-URI mit fest kodiertem `stroke='%236b7280'` bzw. `%23909090` ein. In sechs Themes bleibt die Lupe grau.
- **`FormField` deckt 20 % ab:** 121 Verwendungen bei 600 rohen `<input>`/`<select>`/`<textarea>`.

**Vorschlag — Wächter erweitern statt Regeln predigen.** Drei zusätzliche Prüfungen in `check-design-system.mjs`, jeweils mit Bestandsgrenze („nicht schlimmer als heute"), damit der Build nicht sofort rot wird:

```js
// 1. Farbliterale in Inline-Styles      → Ist-Stand 224, Grenze fällt pro Sprint
// 2. Unicode-Icons in JSX-Textknoten    → Ist-Stand 63, Grenze 0 für neue Dateien
// 3. fontSize < 11 in style={{}} + CSS  → Ist-Stand 22, Grenze 0
```

Das ist derselbe Mechanismus, der die Kontrastprüfung erfolgreich gehalten hat, angewandt auf die vier Klassen, die weiter wachsen. Ohne ihn wird jede Aufräumrunde von der nächsten Feature-Runde eingeholt — die +6 % Inline-Styles in drei Wochen sind der Beleg.

---

## Linse 5 · Barrierefreiheit — der zweite Halbkreis

Was der August-Durchgang erledigt hat (Fokus, Dialoge, Skip-Link, Kontrast, Ladeansagen), hält. Offen ist das, was pro Feld und pro Tabelle einzeln anzufassen ist:

| Befund | Messwert | Wirkung |
|---|---|---|
| `<label>` ohne `htmlFor` | 52 von 425 verknüpft (**88 % offen**) | Klick aufs Label fokussiert das Feld nicht; Screenreader liest „Eingabefeld" ohne Namen. In `axe.spec.ts` als `KNOWN_GAPS` deaktiviert. |
| `aria-live`-Regionen | **0** | Erfolgs- und Fehlermeldungen erreichen Screenreader nur, wenn sie zufällig als `role="alert"` durchkommen |
| `ToastContainer` | `if (!toasts.length) return null` | Die Live-Region **entsteht erst mit der Meldung**. Screenreader beobachten Regionen, die beim Laden vorhanden sind — eine neu eingefügte wird typischerweise **nicht** vorgelesen. Der `role="alert"` im Toast läuft dadurch ins Leere. |
| `role="alert"` für Erfolgsmeldungen | alle Toasts | unterbricht den Vorlesefluss; für „Gespeichert" gehört `role="status"` hin (steht schon so im August-Audit) |
| `Tabs`: ARIA unvollständig | `role="tablist"`/`tab` ohne `aria-controls`, ohne `tabpanel`, ohne Pfeiltasten | Wer das Tab-Muster angekündigt bekommt, erwartet Links/Rechts-Navigation; hier tabbt man durch alle 14 Reiter einzeln |
| `title=` als einzige Erklärung | 311 (Audit: 293 — **gewachsen**) | auf Touch und per Tastatur unerreichbar; `HelpHint`/`InfoHint` wären da |
| `<caption>` in Tabellen | 0 von 88 | Tabelle ohne Namen in der Elementliste des Screenreaders |
| `onClick` auf `div`/`tr`/`span` | 25 Stellen | kein Tabstopp, keine Enter-Auslösung |

**Zwei davon sind billig und wirken sofort:**

1. **`ToastContainer` immer rendern**, Liste leer lassen: `<div className="toast-container" role="status" aria-live="polite">`. Fehler-Toasts behalten innen `role="alert"`. Eine Zeile, und die Live-Region existiert ab Seitenaufbau.
2. **`FormField` konsequent verwenden** — die Komponente vergibt `id`/`htmlFor` bereits korrekt. Statt 373 Labels einzeln nachzuziehen: die 15 Dateien mit den meisten rohen Feldern auf `FormField` heben. Danach lässt sich `'label'` aus `KNOWN_GAPS` in `axe.spec.ts` streichen — und der Test hält das Ergebnis.

---

## Linse 6 · Skalierung mit der Datenmenge

Die App ist mit 8 Projekten und 6 Rechnungen geprüft. Für ein Büro mit drei Jahren Historie gilt:

| Befund | Messwert |
|---|---|
| Virtualisierung / Windowing | **0** |
| Paginierung | 7 Treffer bei 88 Tabellen |
| Chip-Filter | laut CLAUDE.md **immer clientseitig** |
| Filterwerte | aus den geladenen Daten abgeleitet |

`AdressenPage` rendert `filtered.map(...)` ohne `slice` — jede Adresse wird zu DOM. Weil die Filterwerte aus den geladenen Daten stammen, ist serverseitiges Nachladen mit dem aktuellen Filterkonzept auch nicht ohne Weiteres nachrüstbar: Ein Chip kann nur anbieten, was schon im Browser liegt.

Das ist heute kein Problem und in 18 Monaten eines. 2.000 Adressen × ~12 Zellen sind 24.000 DOM-Knoten pro Liste — dort fängt jede Tastatureingabe im Suchfeld an zu ruckeln.

**Vorschlag — in dieser Reihenfolge, nicht alles auf einmal:**
1. **Jetzt:** Anzeige auf die ersten 200 Zeilen begrenzen, mit Fußzeile „200 von 1.847 — weitere anzeigen". Zehn Zeilen Code, verschiebt die Grenze um eine Größenordnung.
2. **Wenn es eng wird:** `@tanstack/react-virtual` für die vier großen Listen. Passt zum vorhandenen Tabellen-Markup.
3. **Konzeptionell:** Filterwerte aus einem eigenen, schlanken `GET /…/facetten`-Endpunkt beziehen statt aus den Zeilendaten. Erst das entkoppelt die Chips von „alles muss geladen sein" und macht serverseitiges Filtern später möglich.

**Nebenbefund Auslieferung:** `dist/assets/index-*.css` ist **119 KB in einer Datei** und wird auf jeder Seite geladen — auch auf `/login`, wo nichts davon gebraucht wird. Der Einstiegs-Chunk liegt bei 315 KB. Der Rest ist sauber pro Route geteilt (14 `lazy()`-Routen), Chart.js (192 KB) lädt nur mit dem Reporting. Ein `login.css`-Split wäre die einzige lohnende Ergänzung. *(Geprüft und entwarnt: `ReactQueryDevtools` landet nicht im Produktions-Bundle.)*

**Nebenbefund Abhängigkeiten:** `@supabase/supabase-js` steht in `frontend-react/package.json`, wird in `src/` aber nirgends importiert. Reine Hygiene — es wird nicht mitgebündelt.

---

## Vorschläge, nach Verhältnis Wirkung zu Aufwand

### Sofort — kleine, klar umrissene Korrekturen

| # | Maßnahme | Ort | Aufwand |
|---|---|---|---|
| 1 | `z-index` der Datenzellen über die fixierte Aktionsspalte — **drei Geldspalten sind derzeit unsichtbar** | `globals.css`, `.master-table--sticky-actions` | XS |
| 2 | Scroll-Schatten am `.table-scroll`, solange rechts Inhalt liegt | `globals.css` + kleiner Hook | S |
| 3 | `ToastContainer` immer rendern, `aria-live="polite"` | `Toast.tsx` | XS |
| 4 | 6 × natives `confirm()` → `ConfirmModal` | Budget, HonorarWizard, ProjektStruktur | XS |
| 5 | Kennungsspalten `nowrap` + `tabular-nums` (mobiler Zeilenumbruch) | `globals.css` | XS |
| 6 | Verwaiste Labels in `AdminPage` ans Feld binden | `AdminPage.tsx` | XS |
| 7 | Lupen-Icon des Suchfelds auf `currentColor` statt fester Data-URI | `globals.css:1543/1551` | XS |

### Als Nächstes — messbarer Alltagsgewinn

| # | Maßnahme | Wirkung |
|---|---|---|
| 8 | **`Ctrl/Cmd+K`-Sprungfeld** über Projekte, Angebote, Rechnungen, Adressen, Mitarbeiter **und** Einstellungen | Kürzt den häufigsten Weg im Produkt von vier Schritten auf einen |
| 9 | **Optimistische Updates** für Inline-Edit, Statuswechsel, Häkchen (`useOptimisticPatch`) | Entfernt 300 ms Wartezeit aus den meistbenutzten Interaktionen |
| 10 | **`useTabParam`** für alle sieben Reiterseiten | Jeder Bereich verlinkbar, Zurück-Taste funktioniert, drei Muster werden eins |
| 11 | **Wächter erweitern** um Farbliterale, Unicode-Icons, Mindestschriftgröße — mit Bestandsgrenze | Stoppt die Erosion, die in drei Wochen +6 % Inline-Styles erzeugt hat |
| 12 | **Projektliste auf `RowMenu`** — Zeile klickbar, sichtbar nur *Bearbeiten*, Löschen ins Menü, Knöpfe 40 px | Schließt §4 aus `UI_VERBESSERUNGEN_KONKRET.md` |
| 13 | **`SortTh`: die 5 Kopien migrieren** | `aria-sort` und Tastaturbedienung für alle Tabellen statt für zwei |
| 14 | **`FormField` in den 15 Dateien mit den meisten rohen Feldern** | Löst `'label'` aus `KNOWN_GAPS` — der axe-Test hält es danach |
| 15 | **Rückgängig-Toast** für umkehrbare Aktionen | Ersetzt weggeklickte Bestätigungsdialoge durch eine echte Sicherung |

### Konzeptarbeit — vorher besprechen

| # | Maßnahme | Warum eine Entscheidung, keine Korrektur |
|---|---|---|
| 16 | **Spaltenprioritäten + aufklappbare Detailzeile** statt Seitwärtsrollen | Betrifft alle 88 Tabellen; die Stufe je Spalte ist eine fachliche Setzung |
| 17 | **Einstellungen in 5 Gruppen** mit Suche, `AdminPage.tsx` aufteilen | Ändert die gewohnte Reihenfolge für Bestandsnutzer |
| 18 | **Auswahl-Bauformen auf drei Regeln festlegen** und in `globals.css` verankern | Betrifft jede Seite; muss einmal entschieden und dann durchgehalten werden |
| 19 | **Listen bei 200 Zeilen abschneiden**, danach Virtualisierung, danach Facetten-Endpunkt | Stufe 3 bricht mit „Chip-Filter immer clientseitig" aus CLAUDE.md |
| 20 | **Stempeluhr-Knopf entsättigen**, volle Fläche nur im laufenden Zustand | Sichtbarste Änderung im Produkt; Geschmacksfrage mit Begründung |

---

## Was ausdrücklich gut ist

Damit die Verhältnismäßigkeit stimmt — vieles davon ist in den letzten drei Wochen entstanden:

- **`Tabs.tsx`** ist ein Musterbeispiel: `ResizeObserver` statt `window.resize`, aktiver Reiter wird ins Bild geholt, Pfeile sind bewusst `aria-hidden` mit begründetem Kommentar. Das Scroll-Schatten-Problem aus Linse 1 ist hier bereits richtig gelöst — es muss nur auf Tabellen übertragen werden.
- **`navItems.ts`** — eine Quelle für beide Navigationen, `mobileRank` mit ausgerechneter Begründung im Kommentar (39 px vs. 65 px).
- **`check:design` im Build** ist die richtige Antwort auf Erosion. Er greift zu kurz, aber er greift.
- **`useDialog`, `DialogFooter`, `FilterChip`, `RowMenu`, `StepIndicator`** sind konsolidiert und dokumentiert — mit dem *Warum* im Kommentar, nicht nur dem *Was*.
- **Die Kommentare erklären Entscheidungen, nicht Syntax.** „Ohne Skip-Link müssen Tastaturnutzer auf jeder Seite Header und Navigation komplett durchtabben." Das ist selten und macht den Code für Nachfolger lesbar.
- **Der Ladezustand ist ehrlich:** „… Einträge" statt „0 Einträge" während des Ladens. Ein Detail, das die meisten Produkte falsch machen.
- **`document.body.scrollWidth` entspricht auf allen sechs geprüften Seiten exakt der Viewportbreite** — die eigene Kernregel hält, in beiden Viewports.

Das Problem ist nach wie vor nicht das Fundament. Es ist, dass die Aufräumarbeit dort aufhört, wo sie nicht mehr an einer Stelle erledigt werden kann — und dass genau diese Stellen bisher nicht überwacht werden.

---

## Anhang · Messbefehle

```bash
cd frontend-react

# Linse 0 — Erosionskennzahlen
grep -ohE "#[0-9a-fA-F]{6}" -r --include="*.tsx" src | wc -l          # 224
grep -ro "style={{" src --include="*.tsx" | wc -l                     # 2225
grep -ro "htmlFor" src --include="*.tsx" | wc -l                      # 52
grep -ro "<label"  src --include="*.tsx" | wc -l                      # 425
grep -ro "aria-live" src --include="*.tsx" | wc -l                    # 0
grep -o "var(--space-" src/styles/globals.css | wc -l                 # 64
grep -oE "[0-9]+px" src/styles/globals.css | wc -l                    # 1898

# Linse 2 — wahrgenommene Geschwindigkeit
grep -ro "onMutate\|setQueryData" src --include="*.tsx" | wc -l       # 0
grep -ro "invalidateQueries"      src --include="*.tsx" | wc -l       # 241

# Linse 1/6 — im Browser gemessen (Playwright + tests/fixtures/demoData)
#   Tabellenbreite gegen Containerbreite, Spaltenpositionen, Trefferflächen.
#   Das Messskript lag temporär unter tests/zz-lens-*.spec.ts und wurde
#   nach der Auswertung entfernt; es ist aus den Zahlen oben rekonstruierbar.
```
