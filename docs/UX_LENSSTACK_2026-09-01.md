# Systemanalyse Oberfläche — Linsen-Stapel, 01.09.2026

**Methode:** Wie im Vormonat. plan&simple wurde mit der Demo-Fixture
(`tests/fixtures/demoData.ts`) unter Playwright gerendert und im Browser vermessen —
Spaltenpositionen, `elementFromPoint`, Containerbreiten, Trefferflächen — in beiden
Projekten (desktop 1280×800, mobile 390×844). Dazu die statischen Auszählungen des
Vormonatsberichts über `frontend-react/src` (42.588 Zeilen TSX, 4.667 Zeilen
`globals.css`). Alle Zahlen sind gemessen; die Befehle stehen im Anhang.

**Browser-Messung: gelaufen.** Chromium in der zum installierten Playwright passenden
Fassung ließ sich nicht laden (`cdn.playwright.dev` von der Netzwerkrichtlinie geblockt);
gemessen wurde mit dem im Sandkasten vorhandenen `chromium-1194` über
`launchOptions.executablePath`. 12 + 8 + 8 Messläufe, alle bestanden. Es fehlt keine
Kennzahl.

**Zeitraum ehrlich benannt:** Zwischen dem Vormonatsbericht (`451d79e`, 24.08.) und heute
liegen 27 Commits — aber alle vom 24. bis **26.08.**. Seit dem 26.08. hat niemand mehr am
Frontend gearbeitet. Die Delta-Tabelle misst also *zwei Arbeitstage*, nicht einen Monat.
Das ist bei der Bewertung der Bewegung zu berücksichtigen: dass etwas „steht", heißt hier
nicht, dass es einen Monat lang liegengeblieben ist.

---

## Kurzfassung

Die Umsetzungsrunde vom 24.–26.08. hat den kritischen Befund des Vormonats **auf der
Rechnungsliste beseitigt** — dort ist heute nichts mehr verdeckt, die Tabelle passt exakt
(1048 px in 1048 px), Trefferflächen auf dem Handy sind durchgängig 44×44. Das ist die
sauberste Einzelkorrektur seit Beginn dieser Reihe.

Derselbe Fehler steht jedoch **unverändert in der Angebotsliste**, und die dafür
geschriebene Regressionsprüfung greift dort nicht. Zwei weitere Fehler derselben Familie
kommen dazu — beide sind Nebenwirkungen der Korrektur, nicht Altbestand.

| # | Befund | Messwert | Schwere |
|---|---|---|---|
| 1 | **Angebotsliste: Kopfzeile und Aktionsspalte stehen an verschiedenen Stellen.** Über den Aktionsknöpfen steht der Kopf „Angebotsdatum" bzw. „Gültig bis"; 69 px Angebotsdatum und 45 px Gültig-bis liegen unter den Knöpfen | `td.doc-actions` sticky z1 bei 1150–1264, `th` bei 1307–1421 (nicht horizontal fixiert); `elementFromPoint` an allen drei Kopfpunkten: „Angebotsdatum", „Angebotsdatum", „Gültig bis" | **Kritisch — Fehler** |
| 2 | **Angebotsliste mobil: die Aktionsspalte liegt 737 px außerhalb des Sichtbereichs.** Die Links-Anheftung für Handys greift nicht, weil die Spalte im Markup hinten steht | `td.doc-actions` 1103–1259 bei Container 366; die Kante (`data-more-right`) sitzt an dieser unsichtbaren Zelle und ist damit ebenfalls unsichtbar | **Hoch — Fehler** |
| 3 | **Rechnungsliste mobil: nach dem Rechtsscrollen steht über der angehefteten ⋯-Spalte der Kopf „Projekt".** `position: static !important` hebt auch das *horizontale* Anheften der Kopfzelle auf | `globals.css:3344`; gemessen nach `scrollLeft = scrollWidth`: `th` bei −438…−373 static, `td` bei 12…78 sticky | **Hoch — Fehler** |
| 4 | **Die Angebotsliste passt weiterhin nicht** — Spaltenprioritäten und Detailzeile wurden nur in Rechnungs- und Projektliste eingebaut | 1205 px in 1048 px (**+15 %**, unverändert), mobil 1247 px in 366 px (**3,4×**, unverändert) | Hoch |
| 5 | **Zeilenziele auf dem Desktop: 5 von 5 unter der eigenen 44-px-Regel**; das Hauptziel der Zeile ist 15 px hoch | /projekte 1280×800: Projektnummer 68×**15**, Intern-Kästchen 16×16, drei Icon-Knöpfe 30×30. Auf dem Handy: 0 von 5 unter 44 | Mittel |
| 6 | **Der Wächter ist unverändert dreiteilig.** Die vier Erosionsklassen, die er nicht sieht, bewegen sich weiter — langsam, aber in dieselbe Richtung | `check-design-system.mjs`: 197 Zeilen, 3 Prüfungen. `title=` 311→**315**, rohe px in CSS 1.898→**1.936** | Mittel |
| 7 | **Einstellungen: 600 px von 1.080 px ungenutzt, 6 von 14 Reitern außerhalb des Bildes** (mobil 11 von 14) | `.admin-block` 480 px in `.app-main` 1080 px | Mittel |

Befunde 1–3 sind Fehler, keine Geschmacksurteile. Befund 1 betrifft die Liste, aus der
heraus Aufträge angenommen werden.

---

## Linse 0 · Delta zum 24.08.

Dieselben Befehle, ausgeführt am Vormonats-Commit `451d79e` und am heutigen Stand. Wo die
Zahl des Vormonatsberichts von meiner Nachmessung an seinem eigenen Commit abweicht, steht
meine Nachmessung — sie ist die vergleichbare.

| Kennzahl | 24.08. | 01.09. | Richtung |
|---|---|---|---|
| **`aria-live`-Regionen** | 0 | **2** (`Toast.tsx:42/43`) | **gelöst ✓** |
| **Natives `confirm()`** | 6 | **0** (`hooks/useConfirm.tsx`) | **gelöst ✓** |
| **Rechnungsliste, Tabellenbreite Desktop** | 1279 in 1048 (+22 %) | **1048 in 1048 (0 %)** | **gelöst ✓** |
| **Verdeckte Geldspalten /rechnungen** | 3 Spalten (SEB, Forderung, Offene Posten) | **0** | **gelöst ✓** |
| **Trefferflächen Zeile, mobil** | 30×30 | **44×44 (5 von 5)** | **gelöst ✓** |
| **Zeilenhöhen /projekte mobil** | 220–250 px, schwankend | **62 px, konstant** | **gelöst ✓** |
| Kante am Tabellenüberlauf | keine | `useScrollEdges` + `data-more-right` in 3 Listen | ✓ |
| `--space-*`-Nutzung | 64 | **77** | +20 % ✓ |
| `aria-sort` (echte Verwendungen) | 3 | **4** | +1 |
| `SortTh`-Kopien | 5 | **4** | −1 |
| Unicode statt Lucide | 60 in 12 Dateien | **58 in 10 Dateien** | −3 % |
| `onClick` auf `div`/`tr`/`span` | 25 | **10** | −60 % ✓ |
| Inline-Styles | 2.224 | **2.225** | **+1 — steht** |
| Hex-Farben in TSX | 224 | **224** | **unverändert** |
| `htmlFor` / `<label>` | 52 / 425 | **53 / 426** | **unverändert** |
| `FormField` / rohe Felder | 121 / 600 | **121 / 600** | **unverändert** |
| `invalidateQueries` | 241 | **241** | unverändert |
| `onMutate` / `setQueryData` | 0 | **0** | **unverändert** |
| Virtualisierung | 0 | **0** | unverändert |
| `<caption>` bei 88 Tabellen | 0 | **0** | unverändert |
| Command-Palette / globale Suche | 0 | **0** | unverändert |
| „Rückgängig" | 0 | **0** | unverändert |
| `useTabParam` (drei Reiter-Mechanismen) | 0 | **0** | unverändert |
| Breakpoints (distinct px in `@media`) | 12 | **12** | unverändert |
| **`title=` als einzige Erklärung** | 311 | **315** | **+4 ✗** |
| **Rohe px in `globals.css`** | 1.898 | **1.936** | **+38 (+2 %) ✗** |
| **Angebotsliste, Tabellenbreite Desktop** | 1205 in 1048 (+15 %) | **1205 in 1048 (+15 %)** | **unverändert ✗** |
| **Prüfungen in `check:design`** | 3 | **3** | **unverändert ✗** |

`npm run check:design` läuft durch: *„Design-System in Ordnung — 92 Tokens, 7 Themes, 638
Klassen geprüft."*

**Was *gewachsen* ist** — das eigentliche Frühwarnsignal:

- `title=` +4 und rohe px +38 in zwei Arbeitstagen. Hochgerechnet ist das dieselbe
  Erosionsgeschwindigkeit wie im August; der Unterschied zum Vormonat („Inline-Styles
  +6 %") ist allein, dass in diesen zwei Tagen fast ausschließlich am Backend
  (E-Rechnung) gearbeitet wurde. Die Erosion kommt mit der nächsten Frontend-Runde
  zurück, weil der Wächter sie weiterhin nicht sieht.
- Neu und gewachsen ist die **Ungleichbehandlung der Listen**: Rechnungs- und
  Projektliste haben jetzt `useFitColumns` + `RowDetailRow`, Angebots- und Adressliste
  nicht. Was vorher ein gemeinsamer Befund war, ist jetzt eine Spaltung — und die
  Regressionsprüfung deckt nur die migrierte Hälfte ab.

**Zwei Korrekturen am Messprotokoll** (damit der nächste Lauf nicht darauf hereinfällt):

1. Die Unicode-Zeile aus dem Aufgabentext liefert ohne UTF-8-Locale **30.184** statt 58 —
   `grep -E` vergleicht dann byteweise und trifft Teilbytes beliebiger Mehrbyte-Zeichen.
   `LC_ALL=C.UTF-8` voranstellen.
2. `grep -roE '(window\.)?\bconfirm\('` liefert heute **11**, davon **0 nativ**: fünf
   Treffer sind Doku-Kommentare in `hooks/useConfirm.tsx`, sechs sind Aufrufe des
   eigenen, versprechensbasierten `confirm({…})`. Die Zahl allein liest sich als
   Verschlechterung (6 → 11) und ist in Wahrheit die vollständige Lösung. Der Befehl
   muss auf `window\.confirm\(` verengt werden.

---

## Linse 1 · Datentabellen

### 1.1 Angebotsliste — Kopf und Körper zeigen auf verschiedene Spalten (Fehler)

Gemessen bei 1280×800, Startzustand (`scrollLeft = 0`), Container 1048 px:

| Element | left | right | position | z-index |
|---|---|---|---|---|
| `td.doc-actions` (die Knöpfe) | **1150** | **1264** | **sticky** | 1 |
| `th` „Aktionen" | **1307** | **1421** | statisch (nur vertikal sticky) | 2 |
| `td` „01.07.2025" (Angebotsdatum) | 1110 | 1219 | statisch | auto |
| `td` „01.09.2025" (Gültig bis) | 1219 | 1307 | statisch | auto |

`elementFromPoint` auf Höhe der **Kopfzeile**, an den drei x-Positionen der Aktionszelle:
`["Angebotsdatum", "Angebotsdatum", "Gültig bis"]`. Über den Knöpfen ✎ 📄 ⋯ steht also die
Überschrift einer fremden Spalte. Unter den Knöpfen liegen **69 px** des Angebotsdatums und
**45 px** des Gültig-bis-Datums.

**Ursache, eindeutig:** `AngeboteListe.tsx:250` schreibt
`<th scope="col"><span className="sr-only">Aktionen</span></th>` — **ohne** die Klasse
`doc-actions`. Die Regel `globals.css:1700` heftet nur `th.doc-actions` und `td.doc-actions`
an. Die Datenzelle wird angeheftet, die Kopfzelle nicht.

Dass der Verdeckungsmechanismus selbst richtig ist, steht ausführlich im Kommentar bei
`globals.css:1707–1722` — die Spalte *darf* überdecken, solange die Kante es anzeigt. Der
Fehler ist nicht das Überdecken, sondern dass Kopf und Körper auseinanderlaufen.

**Warum es nicht auffiel:** `tests/tables.spec.ts:63` prüft genau diesen Fall
(„die fixierte Kopfzelle deckt die Spalten darunter ab") — aber nur für die
Rechnungsliste. Der Selektor `.master-table--sticky-actions thead th.doc-actions` findet in
der Angebotsliste nichts; der Test läuft dort gar nicht. Die Kanten-Prüfung darüber läuft
für beide Listen und ist grün, weil die Kante existiert.

**Vorschlag (XS):** `className="doc-actions"` an das `th` in `AngeboteListe.tsx:250`, und
den Kopfzellen-Test in `tables.spec.ts` über dieselbe Liste `UEBERLAUFENDE_LISTEN` laufen
lassen wie die Kanten-Prüfung — dann ist die Lücke zugleich geschlossen und bewacht.

### 1.2 Angebotsliste mobil — die Aktionsspalte ist gar nicht erreichbar (Fehler)

`globals.css:4565–4573` heftet die Aktionsspalte auf Handys **links** an, mit einer
ausformulierten Begründung: rechts läge sie „am Ende einer rund 1200px breiten Tabelle und
wäre ohne Seitwärts-Scrollen nicht erreichbar".

Genau das ist in der Angebotsliste der Fall. Gemessen bei 390×844:

| | Angebotsliste | Rechnungsliste |
|---|---|---|
| `td.doc-actions` | **1103–1259** | **12–78** |
| Container | 366 | 366 |
| Abstand zum sichtbaren Rand | **+737 px** | angeheftet |

`position: sticky` kann ein Element nie **vor** seine natürliche Position im Fluss ziehen.
Die Rechnungsliste stellt die Aktionszelle auf schmalen Geräten deshalb im Markup nach
vorne (`RechnungenListe.tsx:1011–1013`, `narrow ? … : …`); die Angebotsliste rendert sie
immer als letzte Zelle. `left: 0` bleibt dort wirkungslos.

Zweite Folge: die Überlauf-Kante hängt an derselben, unsichtbaren Zelle. `data-more-right`
ist gesetzt (gemessen: `true`) — sichtbar ist davon nichts. Auf dem Handy zeigt die
Angebotsliste zwei Spalten (Nr., Titel), die dritte ist am Rand abgeschnitten, und es gibt
keinen Hinweis, dass acht weitere folgen.

**Vorschlag (S):** Das `narrow`-Muster der Rechnungsliste übernehmen. Es ist bereits
gebaut, kommentiert und getestet.

### 1.3 Rechnungsliste mobil — der Kopf über der ⋯-Spalte lügt nach dem Scrollen (Fehler)

```css
/* globals.css:3344 */
@media (max-width: 1023px) { .master-table th { position: static !important; } }
```

Die Regel soll den **vertikal** klebenden Tabellenkopf auf kleinen Geräten abschalten (so
steht es auch in CLAUDE.md unter „Sticky table headers … desktop only"). Mit
`position: static !important` schaltet sie aber auch das **horizontale** Anheften der
Aktions-Kopfzelle ab, das die Regel bei `globals.css:4566` gerade erst gesetzt hat.

Gemessen auf /rechnungen bei 390×844 nach `scrollLeft = scrollWidth`:

| Element | left | right | position |
|---|---|---|---|
| `td.doc-actions` (die ⋯-Knöpfe) | 12 | 78 | **sticky** |
| `th.doc-actions` | **−438** | **−373** | **static** |
| Kopf, der tatsächlich über den ⋯-Knöpfen steht | — | — | **„Projekt"** |

Im Ausgangszustand stimmt es (beide bei 14–79); nach dem ersten Seitwärtsscrollen läuft der
Kopf weg und die Spalte bleibt. Der Screenreader-Name der Spalte (`sr-only` „Aktionen")
bleibt korrekt zugeordnet — sichtbar ist der Widerspruch.

**Vorschlag (XS):** Die Ausnahme präzisieren, statt sie zu erweitern —
`@media (max-width:1023px) { .master-table th:not(.doc-actions) { position: static !important } }`,
oder besser die Kopfzeile über `top: auto` entkleben statt über `position`. Dann trifft die
Regel nur, was sie treffen soll.

### 1.4 Was die Umstellung gebracht hat — und wo sie aufhört

Tabellenbreite gegen Containerbreite, beide Viewports:

| Seite | Desktop 1280 | Mobil 390 | Spalten Desktop → Mobil | Detailzeile |
|---|---|---|---|---|
| /rechnungen | **1048 in 1048 (0 %)** | 818 in 366 (2,2×) | 7 → 6 | ✓ |
| /projekte | **1048 in 1048 (0 %)** | 785 in 366 (2,1×) | 6 → 5 | ✓ |
| /angebote | **1205 in 1048 (+15 %)** | 1247 in 366 (**3,4×**) | 10 → 10 | ✗ |
| /adressen | 1048 in 1048 (0 %) | 580 in 366 (1,6×) | 5 → 5 | ✗ |

`useFitColumns` steckt in `ProjekteListe.tsx` und `RechnungenListe.tsx`, `RowDetailRow` in
denselben beiden. Die Angebotsliste hat nur `useScrollEdges` — die Kante, nicht die Lösung.
Sie ist mit **10 Spalten** die breiteste Liste im Produkt und die einzige, die ihre Spalten
weder reduziert noch aufklappbar macht.

**Hinweis zur Vergleichbarkeit /adressen:** Der Vormonatswert („400 in 366, 1,1×") wurde an
einer **leeren** Tabelle gemessen — die Fixture lieferte damals keine Adressen
(`64bb0a9`: „Adressliste war in jedem Test leer — Route und Feldnamen falsch", 25.08.).
Die 580 px von heute sind kein Wachstum, sondern die erste gültige Messung. Ab jetzt
vergleichbar.

**Ebenso /projekte mobil** (679 → 785 px): Das ist keine Regression, sondern der Preis der
Trefferflächen. Drei Zeilenknöpfe von 30 auf 44 px plus die neue Aufklapp-Spalte ergeben
rechnerisch +86 px; gemessen sind es +106 px. Der Tausch ist richtig — er sollte nur
bewusst als Tausch verbucht werden.

### 1.5 Abgeschnittener Text ohne Auslassungszeichen — geprüft, entwarnt

Die Projektspalte in /rechnungen zeigt „P-2024-001 Neubau Kindertagesstätte Sonnenblu" und
bricht ab; gemessen 314 px sichtbar gegen 447 px nötig. Nachgeprüft:
`text-overflow: ellipsis`, `overflow: hidden` sind gesetzt (`globals.css:1752–1757`), der
Volltext steht im `title`. Das Auslassungszeichen fällt im Screenshot nur deshalb nicht
auf, weil es unmittelbar an der Spaltengrenze sitzt. **Kein Fehler.**

---

## Linse 2 · Bedienökonomie

Unverändert gegenüber dem 24.08. — hier steht nichts Neues, aber der Stand gehört in die
Reihe, weil er die Vorschlagsliste trägt:

| Befund | 24.08. | 01.09. |
|---|---|---|
| Command-Palette / globale Suche | 0 | **0** |
| `onMutate` / `setQueryData` | 0 / 0 | **0 / 0** |
| `invalidateQueries` | 241 | **241** |
| „Rückgängig" | 0 | **0** |
| Reiter-Zustand in der URL | 3 Mechanismen | **3 Mechanismen** |

`AdminPage.tsx:4298` liest weiterhin `const [searchParams] = useSearchParams()` **ohne
Setter**; `AngebotePage.tsx` und `DatenPage.tsx` haben gar kein `useSearchParams`. Damit
sind die Einstellungen — 14 Reiter, davon 6 auf dem Desktop und 11 auf dem Handy außerhalb
des Bildes — weiterhin nicht verlinkbar, und die Zurück-Taste überspringt den ganzen
Bereich.

Ein Nebenbefund aus dieser Messung, der die Dringlichkeit erhöht: von 14 Reitern sind auf
390 px **3 sichtbar**. Verborgen sind unter anderem *Rollen & Berechtigungen*,
*Nummernkreise*, *Mahnungen*, *Arbeitszeiten* und *Dokumentvorlagen* — also die Einträge,
die man gezielt sucht statt zu durchblättern.

---

## Linse 3 · Visuelle Hierarchie

### 3.1 Einstellungen nutzen 44 % der Breite (unverändert)

Gemessen bei 1280×800: `.app-main` 1080 px, jeder `.admin-block` **480 px**, alle acht
gleich breit. **600 px bleiben leer.** Auf 390 px sind die Blöcke 366 px breit
(24 px ungenutzt) und die Seite 2.382 px hoch.

Der Nebenbefund des Vormonats ist **erledigt**: die verwaisten grauen Beschriftungen
(„Abteilung", „Typ") stehen jetzt über ihrem Feld, nicht mehr neben dem Knopf.

**Vorschlag (S)** unverändert: `grid-template-columns: repeat(auto-fill, minmax(420px, 1fr))`
für die Blockliste. Bei 1080 px ergibt das zwei Spalten und halbiert die Seitenhöhe.

### 3.2 Vier Bauformen für „auswählen" (unverändert)

Auf der Übersicht stehen weiterhin innerhalb von rund 120 px übereinander:
„Ansicht wechseln" (Umriss-Knopf, oben rechts), ein `<select class="inline-select">` von
**143 px Breite in einer eigenen Leiste über 1048 px**, und ein Segmentband mit gefüllter
Pille. Auf /projekte ist Auswahl ein unterstrichener Reiter.

Die 143 px in 1048 px sind der greifbarste Teil davon: eine volle Bildschirmzeile für ein
einziges Bedienelement, das 14 % davon füllt.

### 3.3 Die Übersicht führt heute mit einem Onboarding-Block

Neu gegenüber dem Vormonatsbericht (dort nicht erwähnt): Über den Kennzahlen steht ein
Willkommensblock mit vier nummerierten Schritten und dem einzigen dunkel gefüllten Knopf
der Seite („Los geht's", `rgb(26,26,46)`). Er belegt die obersten rund 310 px.

Das ist für den ersten Tag richtig. Ob er sich abschalten lässt, sobald das Büro arbeitet,
war mit der Fixture nicht prüfbar — **nicht gemessen**, deshalb hier nur als Frage: Wenn
der Block dauerhaft steht, ist der lauteste Knopf der Startseite auf Dauer eine
Einführungshilfe.

Der Vormonatsbefund zum Stempeluhr-Knopf (grün gefüllt, lauteste Fläche über dem Falz)
besteht unverändert.

---

## Linse 4 · Erosion — was der Wächter nicht sieht

`scripts/check-design-system.mjs` hat weiterhin **197 Zeilen und drei Prüfungen**:
undefinierte CSS-Variablen, undefinierte CSS-Klassen, Kontrast je Theme. Vorschlag 11 des
Vormonats (Wächter erweitern) ist nicht umgesetzt.

| Klasse | 24.08. | 01.09. | geprüft? |
|---|---|---|---|
| Inline-Styles | 2.224 | 2.225 | nein |
| Hex in TSX | 224 | 224 | nein |
| `rgba(` in TSX | — | 71 | nein |
| Schrift unter dem eigenen Minimum | 8 CSS-Regeln + 14 inline | **8 CSS-Regeln (10 px ×7, 9 px ×1) + 11 inline (10 px)** | nein |
| Rohe px in `globals.css` | 1.898 | **1.936** | nein |
| `--space-*`-Nutzung | 64 | **77** | nein |

Die Schriftgrößen unter dem eigenen Minimum stehen namentlich in
`globals.css:1018, 1242, 2231, 2471, 2832, 2984, 3978, 4069` (`2832` ist mit **9 px** der
härteste Fall) sowie inline in `RollenSection.tsx:150/155`, `Buchungen.tsx:638/643` und
sieben Stellen in `MitarbeiterPage.tsx`. CLAUDE.md setzt 13 px für Fließtext und 11 px für
Meta.

Zwei Reste der Zentralisierung, beide mit Zahl:

- **`SortTh` liegt noch 4× lokal**: `HonorarWizard.tsx`, `EinzelprojektTab.tsx`,
  `ProjektlisteTab.tsx`, `MahnungenListe.tsx` (Vormonat: 5). `aria-sort` steht damit an
  **2 von 88 Tabellen** (`components/ui/SortTh.tsx:39`, `DashboardPage.tsx:151`).
- **Das Lupen-Icon des Suchfelds ist weiterhin nicht theme-fähig**: `globals.css:1543`
  und `1551` betten das SVG als Data-URI mit fest kodiertem `stroke='%236b7280'` bzw.
  `%23909090` ein. In sechs Themes bleibt die Lupe grau. Vorschlag 7 des Vormonats,
  Aufwand XS, nicht umgesetzt.

**`FormField` deckt weiterhin 20 % ab:** 121 Verwendungen gegen 600 rohe
`<input>`/`<select>`/`<textarea>`. Ein typisches Beispiel steht direkt neben korrektem
Code — `BuchungsartenSection.tsx:194–196` hat ein `<label>Art*</label>` ohne `htmlFor` über
einem `<select>`, zwei Zeilen darunter zwei saubere `<FormField>`. Die Komponente ist da,
sie wird nur beim Danebenschreiben nicht genommen.

---

## Linse 5 · Barrierefreiheit

**Gelöst und bestätigt:** `Toast.tsx:42/43` rendert jetzt zwei Live-Regionen dauerhaft —
`role="status" aria-live="polite"` für Meldungen, `role="alert" aria-live="assertive"` für
Fehler. Beide existieren ab Seitenaufbau, unabhängig davon, ob eine Meldung ansteht. Damit
sind die Vormonatsbefunde „`aria-live` 0" und „`ToastContainer` entsteht erst mit der
Meldung" beide erledigt.

**Ebenfalls gelöst:** `onClick` auf `div`/`tr`/`span` von 25 auf **10** (−60 %).

Offen bleibt, was pro Feld und pro Tabelle einzeln anzufassen ist:

| Befund | Messwert | unverändert seit |
|---|---|---|
| `<label>` ohne `htmlFor` | 53 von 426 verknüpft (**88 % offen**) | 07.08. |
| `title=` als einzige Erklärung | **315** (24.08.: 311, 07.08.: 293) | wächst |
| `<caption>` in Tabellen | 0 von 88 | 07.08. |
| `aria-sort` | 4 Treffer, davon 2 echte Verwendungen bei 88 Tabellen | 24.08. |

**Geprüft und entwarnt:** In der Rechnungsliste messen auf dem Handy zwei Zeilenknöpfe
(„Details zu …", „PDF zu …") **0×0 px** — das sieht nach fokussierbaren Geisterzielen aus.
Nachgemessen: `checkVisibility() === false`, `offsetParent === null`. Sie stehen unter
`.doc-actions-inline { display: none }` (`globals.css:4582`) und sind damit aus
Tab-Reihenfolge und Screenreader-Ausgabe heraus — genau wie der Kommentar dort behauptet.
**Kein Fehler.**

---

## Linse 6 · Skalierung

Unverändert: Virtualisierung 0, `<table>`-Vorkommen 88, Chip-Filter laut CLAUDE.md immer
clientseitig, Filterwerte aus den geladenen Daten abgeleitet. Der Vorschlag aus dem
Vormonat (erst auf 200 Zeilen begrenzen, dann virtualisieren, dann Facetten-Endpunkt)
steht unverändert und ist unverändert richtig. Neu gemessen wurde hier nichts — die
Fixture liefert 8 Projekte und 12 Rechnungen, daraus lässt sich zum Verhalten bei 2.000
Adressen nichts messen, nur rechnen.

---

## Vorschläge

### Sofort — klein und klar umrissen

| # | Maßnahme | Ort | Aufwand |
|---|---|---|---|
| 1 | `className="doc-actions"` an die Aktions-Kopfzelle — **Kopf und Körper zeigen derzeit auf verschiedene Spalten** | `AngeboteListe.tsx:250` | XS |
| 2 | Kopfzellen-Test über dieselbe Liste laufen lassen wie die Kanten-Prüfung, damit die Lücke bewacht bleibt | `tests/tables.spec.ts:63` | XS |
| 3 | `th:not(.doc-actions)` in der Handy-Regel — **sonst steht nach dem Scrollen „Projekt" über den ⋯-Knöpfen** | `globals.css:3344` | XS |
| 4 | Aktionsspalte der Angebotsliste auf schmalen Geräten nach vorne stellen (`narrow`-Muster) — **derzeit 737 px außerhalb des Bildes** | `AngeboteListe.tsx`, Vorbild `RechnungenListe.tsx:1011` | S |
| 5 | Lupen-Icon des Suchfelds auf `currentColor` statt fester Data-URI | `globals.css:1543/1551` | XS |
| 6 | Die acht Schriftgrößen unter dem eigenen Minimum auf 11 px heben | `globals.css:1018, 1242, 2231, 2471, 2832, 2984, 3978, 4069` | XS |

Punkte 1, 3 und 4 sind Fehlerkorrekturen, keine Gestaltungsvorschläge.

### Als Nächstes — messbarer Alltagsgewinn

| # | Maßnahme | Wirkung |
|---|---|---|
| 7 | **`useFitColumns` + `RowDetailRow` auf die Angebotsliste** ziehen | Die letzte Liste mit +15 % Desktop-Überlauf und 10 unveränderten Spalten; die Mechanik ist gebaut und getestet |
| 8 | **Wächter erweitern** um Farbliterale in `style={{}}`, Unicode-Icons und Mindestschriftgröße — je mit Bestandsgrenze | Die vier Klassen, die er nicht sieht, sind exakt die vier, die nicht kleiner werden |
| 9 | **`useTabParam`** für die sieben Reiterseiten | 14 Einstellungsreiter werden verlinkbar; drei Mechanismen werden einer |
| 10 | **Optimistische Updates** (`useOptimisticPatch`) für Inline-Edit, Statuswechsel, Häkchen | 0 von 241 Mutationen aktualisieren lokal; jede wartet auf Server + Refetch |
| 11 | **`Ctrl/Cmd+K`-Sprungfeld** über die fünf Objektarten und die Einstellungen | Kürzt den häufigsten Weg im Produkt von vier Schritten auf einen |
| 12 | **`SortTh`: die 4 Kopien migrieren** | `aria-sort` und Tastaturbedienung für alle Tabellen statt für zwei |
| 13 | **`FormField` in den 15 Dateien mit den meisten rohen Feldern** | 121 von 600 — danach lässt sich `'label'` aus `KNOWN_GAPS` in `axe.spec.ts` streichen |
| 14 | **Zeilenziele auf dem Desktop auf 40–44 px** und Löschen hinter das ⋯-Menü | /projekte: 5 von 5 Zielen unter der eigenen Regel, das Hauptziel 15 px hoch |

### Konzeptarbeit — vorher besprechen

| # | Maßnahme | Warum eine Entscheidung, keine Korrektur |
|---|---|---|
| 15 | **Einstellungen in 5 Gruppen** mit Suche, zwei Spalten (600 von 1.080 px sind leer), `AdminPage.tsx` aufteilen | Ändert die gewohnte Reihenfolge für Bestandsnutzer |
| 16 | **Auswahl-Bauformen auf drei Regeln festlegen** und in `globals.css` verankern | Betrifft jede Seite; einmal entscheiden, dann durchhalten |
| 17 | **Listen bei 200 Zeilen abschneiden**, danach Virtualisierung, danach Facetten-Endpunkt | Stufe 3 bricht mit „Chip-Filter immer clientseitig" aus CLAUDE.md |
| 18 | **Rückgängig-Toast** statt Bestätigungsdialog für umkehrbare Aktionen | Bei harten Löschungen ist der Dialog die einzige Bremse — das ist eine Produktentscheidung |
| 19 | **Willkommensblock der Übersicht**: Abschaltweg festlegen | Er trägt heute den einzigen gefüllten Knopf der Startseite |

---

## Was ausdrücklich gut ist

Damit die Verhältnismäßigkeit stimmt — und damit Gelöstes nicht erneut angefasst wird:

- **Der kritische Befund des Vormonats ist auf der Rechnungsliste vollständig weg.** Nicht
  durch einen z-index-Kniff, sondern durch die schwierigere, richtige Lösung: Die Tabelle
  misst ihre Spalten selbst (`useFitColumns`), lässt weg, was nicht passt, und zeigt das
  Weggelassene in einer aufklappbaren Detailzeile. Gemessen: 1279 px in 1048 px wurden
  1048 px in 1048 px, drei verdeckte Geldspalten wurden null.
- **Die Trefferflächen auf dem Handy stimmen.** 5 von 5 Zielen in der Projektzeile messen
  44×44; im Vormonat waren es 30×30. Die eigene Regel wird auf dem Gerät eingehalten, für
  das sie geschrieben wurde.
- **Die Zeilenhöhen sind konstant.** /projekte mobil: 62 px in allen acht Zeilen, vorher
  220–250 px mit Umbruch mitten in der Projektnummer.
- **`Toast.tsx`** rendert zwei dauerhafte Live-Regionen mit richtig getrennten Rollen —
  `status` für Meldungen, `alert` für Fehler. Genau so war es vorgeschlagen.
- **`useConfirm.tsx`** ersetzt die sechs nativen `confirm()` durch eine versprechensbasierte
  Rückfrage, die sich in `async`-Code einfügt — mit einem Doku-Kommentar, der das Vorher
  und das Nachher nebeneinanderstellt.
- **Die Kommentare erklären weiterhin Entscheidungen, nicht Syntax.** Der Block bei
  `globals.css:1707–1722` benennt ausdrücklich, dass die überdeckende Spalte *kein*
  Stapelfehler ist und der eigentliche Fehler war, dass es unsichtbar geschah. Solche
  Kommentare sind der Grund, warum die drei Fehler dieses Berichts in Minuten statt
  Stunden zu belegen waren.
- **`document.body.scrollWidth` entspricht auf allen sechs geprüften Seiten in beiden
  Viewports exakt der Viewportbreite.** Die Kernregel hält, auch nach dem Umbau.
- **Die Fixture wurde geschärft statt geschmeichelt.** Der Kommentar in `demoData.ts`
  („Wer hier kürzt, nimmt den Breiten-Tests die Aussagekraft") und die Korrektur der leeren
  Adressliste (`64bb0a9`) sind der Grund, warum dieser Bericht überhaupt etwas messen kann.

Das Muster des Vormonats gilt weiter, nur eine Ebene höher: Was zentral zu lösen war,
wurde gelöst — sehr gut sogar. Was jetzt fehlt, ist das **Nachziehen der zweiten
Verwendungsstelle**: dieselbe Mechanik in der Angebotsliste, derselbe Test über beide
Listen, dieselbe Ausnahme in der Handy-Regel. Drei der sieben Kurzfassungsbefunde sind
genau das.

---

## Anhang · Messbefehle mit den heutigen Ergebnissen

```bash
cd frontend-react
export LC_ALL=C.UTF-8            # sonst zaehlt die Unicode-Zeile Bytes: 30184 statt 58

# Linse 0 — Erosionskennzahlen
grep -ohE '#[0-9a-fA-F]{6}' -r --include='*.tsx' src | wc -l        # 224
grep -ro 'style={{'            src --include='*.tsx' | wc -l        # 2225
grep -ro 'htmlFor'             src --include='*.tsx' | wc -l        # 53
grep -ro '<label'              src --include='*.tsx' | wc -l        # 426
grep -ro 'aria-live'           src --include='*.tsx' | wc -l        # 3 (2 echte Regionen)
grep -ro 'aria-sort'           src --include='*.tsx' | wc -l        # 4 (2 echte Verwendungen)
grep -ro 'title='              src --include='*.tsx' | wc -l        # 315
grep -ro 'onMutate\|setQueryData'  src --include='*.tsx' | wc -l    # 0
grep -ro 'invalidateQueries'       src --include='*.tsx' | wc -l    # 241
grep -ro 'window\.confirm('        src --include='*.tsx' | wc -l    # 0  (siehe Hinweis)
grep -o  'var(--space-'  src/styles/globals.css | wc -l             # 77
grep -oE '[0-9]+px'      src/styles/globals.css | wc -l             # 1936
grep -c  '<table'  -r src --include='*.tsx' | awk -F: '{s+=$2} END {print s}'   # 88

# Hinweis: 'confirm(' ohne 'window\.' liefert 11 — 5 Doku-Kommentare und 6 Aufrufe
# des eigenen hooks/useConfirm.tsx. Nativ sind es 0.

# Unicode statt Lucide-Icons — 58 in 10 Dateien
grep -rlE '[✕✓✔✖▶⏭⏹✎🗑📋⚠★]' src --include='*.tsx' | while read f; do
  echo "$f $(grep -oE '[✕✓✔✖▶⏭⏹✎🗑📋⚠★]' "$f" | wc -l)"; done
# TimerBar 19 · MitarbeiterPage 15 · AdminPage 6 · SchlussrechnungWizard 4 ·
# DashboardPage 4 · RechnungWizard 3 · AbschlagWizard 3 · SaveBadge 2 ·
# BatchEmailModal 1 · Buchungen 1

# Schrift unter dem eigenen Minimum
grep -nE 'font-size:\s*([0-9]|10)px' src/styles/globals.css   # 8 Regeln: 1018 1242 2231
                                                              # 2471 2832(9px) 2984 3978 4069
grep -rnE 'fontSize:\s*(10|9|8)\b'   src --include='*.tsx'    # 11 Stellen

# Kopierte Bausteine statt gemeinsamer Komponenten
for c in SortTh FilterChip RowMenu StepIndicator FormField; do
  echo "$c zentral: $(grep -rl "components/ui/$c" src --include='*.tsx' | wc -l)  \
lokal: $(grep -rln "function $c(\|const $c = " src --include='*.tsx' | grep -v "ui/$c" | wc -l)"
done
# SortTh zentral 4 / lokal 4  ·  FilterChip 11/0  ·  RowMenu 3/0
# StepIndicator 5/0  ·  FormField 15/0   (121 <FormField> gegen 600 rohe Felder)

npm run check:design
# Design-System in Ordnung — 92 Tokens, 7 Themes, 638 Klassen geprueft.  (3 Pruefungen)
```

**Browser-Messung** (Playwright + `tests/fixtures/demoData`, Projekte `desktop` 1280×800
und `mobile` 390×844). Das Messskript lag temporär unter `tests/zz-lens-*.spec.ts` und ist
nach der Auswertung entfernt; im Sandkasten ist
`launchOptions.executablePath: '/opt/pw-browsers/chromium'` nötig, weil der Download der
passenden Chromium-Fassung von der Netzwerkrichtlinie geblockt wird.

| Messung | Ergebnis |
|---|---|
| `body.scrollWidth` vs. `clientWidth`, 6 Seiten × 2 Viewports | 12 × identisch ✓ |
| Tabellenbreite in Container, Desktop | /rechnungen 1048/1048 · /projekte 1048/1048 · /adressen 1048/1048 · **/angebote 1205/1048** |
| Tabellenbreite in Container, Mobil | /adressen 580/366 · /projekte 785/366 · /rechnungen 818/366 · **/angebote 1247/366** |
| Angebote: `td.doc-actions` vs. `th`, Desktop | 1150–1264 sticky z1 · 1307–1421 nicht fixiert |
| Angebote: Kopf über den Aktionsknöpfen | „Angebotsdatum", „Angebotsdatum", „Gültig bis" |
| Angebote: verdeckte Datenbreite | Angebotsdatum 69 px · Gültig bis 45 px |
| Angebote mobil: `td.doc-actions` | 1103–1259 bei Container 366 (+737 px außerhalb) |
| Rechnungen mobil nach Rechtsscrollen | `td` 12–78 sticky · `th` −438…−373 static · Kopf darüber: „Projekt" |
| Trefferflächen /projekte Desktop | 68×**15** · 16×16 · 30×30 · 30×30 · 30×30 (5 von 5 unter 44) |
| Trefferflächen /projekte Mobil | 44×44 ×4 + 68×44 (0 von 5 unter 44) |
| Zeilenhöhen /projekte | Desktop 47–48 px · Mobil 62 px, jeweils konstant |
| `.admin-block` in `.app-main` | 480 px in 1080 px (600 px ungenutzt) · mobil 366 in 390 |
| Einstellungsreiter sichtbar | Desktop 8 von 14 · Mobil 3 von 14 |
| Zeitraum-Auswahl auf der Übersicht | `select` 143 px in einer Leiste von 1048 px |
