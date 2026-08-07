# UX/UI-Audit plan&simple — August 2026

**Stand:** 07.08.2026 · **Branch:** `feature/ux-ui-audit` · **Basis:** 102 TSX-Komponenten, 3.425 Zeilen `globals.css`, 6 Themes

Alle Zahlen in diesem Dokument sind gemessen, nicht geschätzt. Die Messbefehle stehen bei den jeweiligen Befunden, damit sich der Fortschritt später nachprüfen lässt.

---

## Kurzfassung

plan&simple ist **funktional weit** und hat eine **überdurchschnittlich gute Token-Basis** (6 Themes, semantische Farb- und Typo-Tokens, konsistente Listen-Konventionen in CLAUDE.md). Das Problem ist nicht fehlendes Design-Denken — es ist **Erosion**: Die dokumentierten Regeln existieren, aber der Code hält sich zunehmend nicht daran, und dem Token-System fehlen drei Ebenen (Abstand, Radius, Status), sodass Entwickler bei jedem neuen Feature zu Inline-Styles und Hex-Werten greifen *müssen*.

Die vier Kernbefunde:

| # | Befund | Messwert | Schwere |
|---|---|---|---|
| 1 | **Theming ist zur Hälfte umgangen** — hartkodierte Farben ignorieren alle 6 Themes | 812 Hex-Werte, 2.100 Inline-Styles, 45 Dateien | Kritisch |
| 2 | **Tastaturbedienung faktisch nicht vorhanden** — keine Fokus-Ringe, keine Escape-Taste, keine Fokus-Falle | 3 `:focus-visible`-Regeln bei 633 Buttons | Kritisch |
| 3 | **Kontrast unter WCAG AA** in Tokens *und* hartkodierten Farben | 8 von 11 Top-Farben unter 4,5:1 im Dark-Theme | Kritisch |
| 4 | **Token-System hat Löcher** — kein Abstand/Radius/Status, 2 Variablen undefiniert | 14 Radius-Werte, 0 Spacing-Tokens | Hoch |

**Rechtlicher Kontext:** Der European Accessibility Act gilt seit dem 28.06.2025; in Deutschland umgesetzt über das BFSG. Reines B2B ist nicht automatisch erfasst, aber die Abgrenzung ist unscharf, sobald Endnutzer im Angestelltenverhältnis mit dem Produkt arbeiten — und öffentliche Auftraggeber (bei Architekturbüros ein realer Kundenkreis) fordern EN 301 549 / WCAG 2.1 AA regelmäßig in Vergabeverfahren. Die Befunde 2 und 3 sind damit nicht nur Qualitäts-, sondern potenzielle **Vertriebsblocker**.

---

## 1 · Theming wird zur Hälfte umgangen — Kritisch

Die App hat 6 Themes (`default`, `modern`, `forest`, `earth`, `winter`, `dark`). Parallel dazu stehen **812 hartkodierte Hex-Farben** im TSX-Code, die sich bei keinem Theme-Wechsel ändern.

```bash
grep -ohE "#[0-9a-fA-F]{6}" -r --include="*.tsx" frontend-react/src | sort | uniq -c | sort -rn | head
```

| Farbe | Verwendungen | Was sie ist |
|---|---|---|
| `#6b7280` | 180 | Tailwind gray-500 — Sekundärtext |
| `#dc2626` | 61 | red-600 — Fehler/Löschen |
| `#e5e7eb` | 52 | gray-200 — Rahmen |
| `#374151` | 44 | gray-700 — Text auf Badges |
| `#9ca3af` | 40 | gray-400 |
| `#16a34a` | 30 | green-600 — Erfolg |

**Warum das systemisch ist, nicht kosmetisch:** Es handelt sich fast durchgängig um die Tailwind-Palette — obwohl das Projekt kein Tailwind nutzt. Es sind Ersatzwerte für Tokens, die es **nicht gibt**: Es existiert kein `--success`, `--danger`, `--warning`, kein neutraler Grauwert für Badges. Entwickler haben korrekt gehandelt und den nächstbesten Wert genommen. Der Fehler liegt im Token-System, nicht in den Entwicklern.

**Konkrete Folge im Dark-Theme** (`--surface: #1c1c21`):

| Hartkodiert | Kontrast auf Dark-Surface | WCAG AA (4,5:1) |
|---|---|---|
| `#6b7280` (180×) | **3,51** | ✗ |
| `#374151` (44×) | **1,65** | ✗ unlesbar |
| `#4b5563` | **2,25** | ✗ |
| `#dc2626` (61×) | **3,51** | ✗ |
| `#b91c1c` (39×) | **2,62** | ✗ |
| `#166534` (15×) | **2,38** | ✗ |
| `#92400e` (19×) | **2,39** | ✗ |
| `#2563eb` (17×) | **3,28** | ✗ |

`#374151` bei 1,65:1 ist im Dark-Theme praktisch unsichtbar. Dazu kommen Badge-Paare wie `{ bg: '#f3f4f6', fg: '#6b7280' }` (`MasterySection.tsx`, `MyAbsencesPanel.tsx`) — hellgraue Chips, die im Dark-Theme als grelle weiße Inseln stehen bleiben.

**Empfehlung:** Status-Token-Ebene einführen (siehe §4), dann die 45 Dateien mechanisch migrieren. Reihenfolge nach Häufigkeit: `#6b7280` → `var(--text-3)`, `#dc2626`/`#b91c1c` → `var(--danger)`/`var(--danger-strong)`, `#16a34a` → `var(--success)`, `#e5e7eb` → `var(--border)`.

---

## 2 · Tastatur- und Screenreader-Bedienung — Kritisch

### 2.1 Fokus-Indikatoren fehlen fast vollständig

Bei **633 Buttons** und 411 Formularfeldern existieren im gesamten Stylesheet **3 `:focus-visible`-Regeln** — zwei davon nur für die Navigation.

Gravierender: Zentrale Eingabefelder setzen `outline: none` **ohne Ersatz**:

| Selektor | Zeile | Ersatz-Fokusstil? |
|---|---|---|
| `.list-search` | 2086 | ✓ box-shadow |
| `.form-group input` | ~704 | ✗ **keiner** |
| `.form-group select` | ~1126 | ✗ **keiner** |
| `.list-toolbar input/select` | ~714 | ✗ **keiner** |
| `.admin-single-input` | 1352 | ✗ **keiner** |

Wer per Tastatur durch ein Stammdaten-Formular oder die Filterleiste navigiert, sieht **nicht**, wo der Fokus steht. Das ist WCAG 2.4.7 (Focus Visible, Level AA) — und für Poweruser, die Formulare per Tab ausfüllen, auch ohne Behinderung ein täglicher Reibungspunkt.

### 2.2 Modals sind nicht bedienbar und nicht angekündigt

`Modal.tsx` und `ConfirmModal.tsx` — die Basis für praktisch jeden Dialog der App — haben:

- ✗ **Kein Escape-Schließen.** `useBackdropClose` behandelt ausschließlich `onMouseDown`/`onClick`. Ein Dialog lässt sich per Tastatur nicht schließen.
- ✗ **Keine Fokus-Falle.** Tab führt hinter das Modal in die darunterliegende Seite.
- ✗ **Kein Fokus-Setzen beim Öffnen** und **keine Rückgabe** an das auslösende Element beim Schließen.
- ✗ **Kein `role="dialog"`, kein `aria-modal`, kein `aria-labelledby`.** Screenreader kündigen den Dialog nicht als solchen an und lesen den Titel nicht vor.
- ✗ **Kein `inert`/`aria-hidden`** auf dem Hintergrund.

Das betrifft auch `ConfirmModal` — den Dialog für **Löschvorgänge**. Ein Screenreader-Nutzer bekommt die Sicherheitsabfrage nicht mit.

### 2.3 Weitere Befunde

| Befund | Messwert |
|---|---|
| Kein Skip-Link | 0 — Tastaturnutzer durchlaufen Header + 10 Nav-Punkte auf **jeder** Seite |
| `aria-describedby` (Feldfehler/Hilfetexte anbinden) | **0** von 411 Labels |
| `aria-labelledby` | **0** |
| `<th scope>` | **2** von 467 — Screenreader können Zellen keinen Spalten zuordnen |
| `<caption>` in Tabellen | **0** von 79 Tabellen |
| `htmlFor` vs. `<label>` | 38 vs. 411 — **~90 % der Labels sind nicht mit ihrem Feld verknüpft** |
| `title=` als einzige Erklärung | **293** — auf Touch-Geräten und per Tastatur nicht erreichbar |
| `prefers-reduced-motion` | **0** bei 44 Transitions/Animationen |

Die 293 `title`-Attribute sind bemerkenswert, weil das Projekt mit `HelpHint`/`InfoHint` bereits **bessere eigene Bausteine** hat (siehe `docs/HELP_TOOLTIP_CONCEPT.md`). Auf Tablets — dem realistischen Zweitgerät auf der Baustelle — ist ein `title` schlicht unsichtbar.

**Positiv:** `SideNav` nutzt korrekt `<nav aria-label>`, `NavLink` liefert `aria-current="page"` automatisch, `<main>` ist vorhanden, `ToastContainer` nutzt `role="alert"`, das Lizenz-Banner `role="status"`. Die Grundlagen sind da — sie sind nur nicht ausgerollt.

---

## 3 · Kontrast der eigenen Tokens — Kritisch

Nicht nur die hartkodierten Farben, auch die **Design-Tokens selbst** unterschreiten AA.

### Light-Theme (`--text-N` = `rgba(17,24,39,α)`)

| Token | α | auf `--surface` | auf `--bg` | AA |
|---|---|---|---|---|
| `--text-2` | 0,70 | 6,60 | 6,31 | ✓ |
| `--text-3` | 0,55 | **3,96** | **3,88** | ✗ |
| `--text-4` | 0,45 | **2,92** | **2,88** | ✗ |
| `--text-5` | 0,38 | **2,41** | **2,37** | ✗ |

### Dark-Theme

| Token | Wert | auf `--surface` | AA |
|---|---|---|---|
| `--text-3` | `#808080` | **4,30** | ✗ knapp |
| `--text-4` | `#666666` | **2,96** | ✗ |
| `--text-5` | `#555555` | **2,28** | ✗ |
| `--nav-inactive` | `#666666` | 3,35 (auf Chrome) | ✗ |

**Das ist deshalb schwerwiegend, weil `--text-3`/`--text-4` genau dort eingesetzt werden, wo die Schrift ohnehin am kleinsten ist:**

- `.master-table th` → `--text-3` bei 12 px — **alle Spaltenüberschriften der App**
- `.list-info` → `--text-4` bei 12 px
- `.kpi-meta` → `--text-5` bei 10 px — 2,41:1
- `input::placeholder` → `--text-4`
- `--fs-label: 11px` ist explizit für Feld-/Kennzahl-Labels vorgesehen

Kleine Schrift **und** schwacher Kontrast verstärken sich gegenseitig. Betroffen ist nicht nur ein Randnutzerkreis: Bildschirmarbeit bei Tageslicht, ältere Bürokolleginnen und -kollegen, günstige Monitore.

### Theme-Akzente

| Theme | Weiß auf Akzent | Akzent als Text |
|---|---|---|
| default `#2563eb` | 5,17 ✓ | 5,17 ✓ |
| forest `#174d38` | 9,74 ✓ | 9,74 ✓ |
| earth `#a35e47` | 4,94 ✓ | 4,94 ✓ |
| winter `#4f7c82` | 4,63 ✓ | 4,63 ✓ |
| **modern `#d4714e`** | **3,35 ✗** | **2,87 ✗** |
| **dark `#7a7ac6`** | **3,87 ✗** | **4,39 ✗** |

Im Theme *modern* ist **jeder Primärbutton** unter AA — weiße Schrift auf Terrakotta bei 3,35:1. Im Dark-Theme ebenso. Beide Akzentfarben müssen abgedunkelt werden (bzw. für *modern* dunkle statt weißer Buttonschrift), ohne den Markencharakter zu verlieren.

---

## 4 · Löcher im Token-System — Hoch

### 4.1 Zwei Variablen werden benutzt, aber nie definiert

```bash
grep -c "^\s*--accent-rgb\|^\s*--hover-bg" globals.css   # → 0
```

| Variable | Verwendungen | Fallback | Folge |
|---|---|---|---|
| `--accent-rgb` | 3 | `59,130,246` | Der **Fokusring ist in allen 6 Themes blau** — auch in forest (grün), earth (braun), winter (petrol), modern (terrakotta). |
| `--hover-bg` | 4 | `rgba(0,0,0,0.06)` | Im **Dark-Theme wird Hover dunkler statt heller** — Rückmeldung nahezu unsichtbar auf `.row-action-btn` und `.dash-subnav-btn`. |

Beides sind echte Bugs, keine Stilfragen — und mit je einer Zeile behoben.

### 4.2 Es gibt keine Abstands-, Radius-, Schatten- und Status-Tokens

`:root` definiert Farben und Typografie — sonst nichts. Ergebnis:

- **14 verschiedene `border-radius`-Werte**: 2, 3, 4, 5, 6, 7, 8, 10, 12, 14, 16, 18, 20, 999 px. Radius 6 (30×), 8 (36×), 10 (26×), 12 (23×) konkurrieren ohne erkennbare Regel. Buttons sind mal 10, mal 12 px rund.
- **12 Schriftgrößen im CSS + 12 in Inline-Styles**, darunter 8, 9 und 10 px.
- **0 Abstands-Tokens** → 2.100 Inline-Styles mit handgesetzten `padding`/`margin`/`gap`.

Das ist die eigentliche Ursache von Befund 1: Wer ein Feature baut, findet kein Token und schreibt eine Zahl hin.

### 4.3 Der globale `button`-Reset ist zu aggressiv

```css
button {
  box-shadow: 0 8px 22px rgba(17,24,39,0.06);
  transition: transform .12s, box-shadow .12s, background .12s;
}
button:hover { transform: translateY(-1px); box-shadow: 0 10px 28px rgba(17,24,39,0.10); }
```

Das trifft **jeden** `<button>` — auch 30×30 px Icon-Buttons in Tabellenzeilen. Ein Schlagschatten mit 22 px Weichzeichnung an einem Icon-Button wirkt unruhig; das Anheben bei Hover in dichten Tabellen erzeugt Flimmern. Der Schatten ist zudem hartkodiert schwarz — im Dark-Theme unsichtbar, im Light-Theme durchgängig präsent. Deshalb müssen Komponenten wie `.bottom-nav-item`, `.row-action-btn` und `.btn-small` den Effekt einzeln zurücksetzen (`transform: none; box-shadow: none`) — ein Zeichen dafür, dass der Default falsch herum gesetzt ist.

**Empfehlung:** Basis-`button` neutral halten; Erhebung/Schatten nur explizit über `.btn-primary`/`.btn-elevated`.

---

## 5 · Informationsarchitektur & Navigation — Hoch

### 5.1 Desktop- und Mobil-Navigation sind auseinandergelaufen

`SideNav.tsx` und `BottomNav.tsx` pflegen **zwei getrennte, hartkodierte `NAV_ITEMS`-Arrays** — mit unterschiedlicher Reihenfolge:

| Pos. | SideNav (Desktop) | BottomNav (Mobil) |
|---|---|---|
| 6 | Angebote | **Einstellungen** |
| 7 | Nachträge | Mitarbeiter |
| 8 | Mitarbeiter | Angebote |
| 9 | Service | Nachträge |
| 10 | **Einstellungen** | Service |

„Einstellungen" springt von Position 10 auf 6. Wer zwischen Desktop und Tablet wechselt, verliert die Ortskenntnis — und jede künftige Navigationsänderung muss an zwei Stellen gepflegt werden (die Permission- und Feature-Listen sind ebenfalls dupliziert, inklusive der 13-Einträge-Liste für Einstellungen).

### 5.2 Die mobile Navigation überläuft

`.bottom-nav` ist `display: flex` mit `flex: 1` je Element, feste Höhe 58 px. Bei einem Administrator mit allen Rechten werden **10 Einträge** gerendert:

- 390 px (iPhone 14) ÷ 10 = **39 px Breite je Ziel**
- Das Projekt-Regelwerk in CLAUDE.md fordert **44 × 44 px**; WCAG 2.5.8 (AA) fordert mindestens 24 × 24 px
- `.bn-label` ist **9 px** groß — die eigene Regel lautet „Minimum meta/label text: 11px"
- „Einstellungen" (13 Zeichen) in 39 px bei 9 px Schrift läuft zwangsläufig um oder wird abgeschnitten

CLAUDE.md dokumentiert „`.bottom-nav-item` items are currently 58px" — das ist die **Höhe**; die Breite wurde nie geprüft. Fünf Einträge wären unkritisch, zehn sind es nicht.

**Empfehlung:** Auf Mobil die 4–5 wichtigsten Einträge zeigen, Rest hinter „Mehr". Alternativ horizontal scrollbare Leiste mit fester Mindestbreite von 64 px je Ziel.

### 5.3 Zehn gleichrangige Hauptbereiche ohne Gruppierung

Übersicht, Adressen, Projekte, Reporting, Rechnungen, Angebote, Nachträge, Mitarbeiter, Service, Einstellungen — flach nebeneinander. Für ein Werkzeug mit dieser fachlichen Tiefe wäre eine Bündelung naheliegend (z. B. *Akquise*: Angebote + Nachträge · *Abrechnung*: Rechnungen + Mahnungen + Sicherheitseinbehalte). Das ist eine Produktentscheidung, keine Fehlfunktion — aber der Einstieg für neue Nutzer wird mit jedem weiteren Modul schwerer.

---

## 6 · Datentabellen — die Hauptarbeitsfläche — Hoch

79 Tabellen sind die zentrale Oberfläche der App.

| Befund | Detail |
|---|---|
| **Schriftgröße 12 px** | `.master-table { font-size: 12px }` — die eigene Regel fordert 13 px Minimum. Betrifft **jede** Tabelle. |
| **Spaltenköpfe unter AA** | `th` nutzt `--text-3` → 3,96:1 bei 12 px |
| **Kein mobiles Layout** | Einzige Strategie ist `overflow-x: auto`. Keine Karten-/Stapelansicht, kein `data-label`-Muster. |
| **Sticky Header mobil deaktiviert** | `@media (max-width:1023px) { th { position: static !important } }` — beim horizontalen *und* vertikalen Scrollen auf dem Tablet geht der Spaltenbezug verloren |
| **`min-width: 400px`** | erzwingt horizontales Scrollen unterhalb von 400 px |
| **Keine Zebrastreifen** | nur `tr:hover` — bei 10+ Spalten wandert das Auge in der Zeile leicht ab |
| **Keine Semantik** | 2 `scope` bei 467 `th`, 0 `<caption>` |

Auf einem Tablet — dem realistischen mobilen Arbeitsgerät für Architekten — bedeutet das: 12-px-Text, seitliches Scrollen, ohne mitlaufende Spaltenköpfe.

---

## 7 · Zustände, Rückmeldung, wahrgenommene Geschwindigkeit — Mittel

| Befund | Messwert | Bewertung |
|---|---|---|
| Skeleton-Screens | **0** | Ladezustände sind reine Textzeilen („Laden …", 59×) |
| `aria-busy` | **0** | Ladevorgänge für Screenreader stumm |
| Leerzustände | 108 Treffer | ✓ gut ausgebaut |
| Ladezustände behandelt | 476 | ✓ konsequent |
| Fehlerbehandlung | 180 | ✓ vorhanden |

Die Zustandslogik ist **gut abgedeckt** — die *Darstellung* ist der schwache Punkt. `<div style={{padding:40, textAlign:'center', color:'#6b7280'}}>Laden …</div>` (`ProtectedRoute.tsx`) ist der Standard. Skeletons, die das kommende Layout andeuten, senken die wahrgenommene Wartezeit deutlich und verhindern das Springen des Layouts beim Eintreffen der Daten.

Zudem: `role="alert"` für **alle** Toasts. Für Fehler richtig, für Erfolgsmeldungen zu aufdringlich — dort gehört `role="status"` hin.

---

## 8 · Konsistenz & Wartbarkeit — Mittel

### 8.1 Kopierte Komponenten statt gemeinsamer Bausteine

| Komponente | Kopien |
|---|---|
| `FilterChip` | **10** |
| `SortTh` | **8** |
| `StepIndicator` | **5** |
| `StatusBadge`, `SegmentNav`, `RowMenu`, `KpiCard` | je 2 |

CLAUDE.md schreibt dieses Vorgehen sogar fest: *„Local component defined per-page (copy pattern from `HonorarWizard.tsx`)"*. Das garantiert Auseinanderdriften: Zehn Filterchips heißt zehnmal eigenes Tastaturverhalten, zehnmal eigene ARIA-Semantik, zehn Stellen für jede Korrektur. `components/ui/` existiert bereits und ist der richtige Ort.

### 8.2 Der Code weicht von den eigenen Regeln ab

| Regel in CLAUDE.md | Verstöße |
|---|---|
| „Never use emoji or Unicode characters as UI icons" | **226** in 47 Dateien (`✕`, `✓`, `▾`, `⋯`, `→`) — inklusive der Schließen-Buttons in `Modal`, `ConfirmModal`, `TimerBar` |
| „Minimum body text: 13px" | `.master-table` = 12 px (alle Tabellen) |
| „Minimum meta/label text: 11px" | 14 Inline-Styles mit 8–10 px, `.bn-label` = 9 px |
| „Minimum 44 × 44 px touch targets" | Bottom-Nav bei 10 Einträgen ≈ 39 px |
| „`lucide-react` is the only icon library" | eingebettete Inline-SVGs, z. B. `AppLayout.tsx` UserMenu |

Bemerkenswert: Die Regeln sind **gut und richtig**. Sie werden nur nicht durchgesetzt. Ein Lint-Regelsatz (`no-restricted-syntax` für Hex-Literale in `style={{}}`, Unicode-Icon-Prüfung) würde die Erosion an der Wurzel stoppen.

### 8.3 Zwölf Breakpoints ohne Skala

520, 600, 640, 680, 700, 768, 900, 1023, 1024, 1280 px — teils `min-width`, teils `max-width`, gemischt. Vier Werte (600/640/680/700) liegen so dicht beieinander, dass sie kein unterscheidbares Layout ergeben, aber vier separate Testfälle erzeugen.

---

## Priorisierte Maßnahmen

### Sofort — in diesem Branch umgesetzt ✓

| # | Maßnahme | Ergebnis |
|---|---|---|
| 1 | `--accent-rgb`, `--hover-bg` definiert (+ `--btn-fg`, `--accent-fg`, `--shadow-color`) | Fokusring folgt jetzt dem Theme statt immer blau; Hover im Dark-Theme hellt auf statt abzudunkeln |
| 2 | Globales `:focus-visible` für Buttons, Links, Felder | Vorher 3 Regeln bei 633 Buttons; Felder mit `outline:none` ohne Ersatz haben wieder eine sichtbare Rückmeldung |
| 3 | `useDialog`-Hook in `Modal` + `ConfirmModal` | Escape, Fokus-Falle, Fokus-Rückgabe, Scroll-Sperre, `role="dialog"`, `aria-modal`, `aria-labelledby`; `ConfirmModal` zusätzlich `aria-describedby` |
| 4 | Skip-Link auf `#hauptinhalt` | Erster Tab springt direkt in den Inhalt |
| 5 | `prefers-reduced-motion` | Alle 44 Transitions/Animationen respektieren die Systemeinstellung |
| 6 | Token-Ebenen Abstand / Radius / Schatten / Status ergänzt | Basis, damit neue Features keine Hex-Werte mehr brauchen |
| 7 | `--text-2/-3/-4` in allen 6 Themes korrigiert | text-2 und text-3 durchgängig ≥ 4,5:1, text-4 ≥ 3:1 — **geprüft, siehe Tabelle unten** |
| 8 | Akzente *modern*, *dark*, *earth*, *winter* angehoben | Alle 6 Themes erfüllen AA für Buttons und Akzent-als-Text |
| 9 | Navigation aus einer Quelle (`navItems.ts`); Bottom-Nav auf 5 + „Mehr" | Touch-Target von 39 px auf 65 px; Reihenfolge zwischen Desktop und Mobil identisch |
| 10 | Basis-`button` entschärft, `.btn-elevated` für bewusste Erhebung | Kein Schlagschatten mehr an Icon-Buttons in Tabellen |
| 11 | Tabellen: 13 px statt 12 px, Kopfzeile auf `--text-2`, Zebrastreifen | Hauptarbeitsfläche erfüllt die eigene Typo-Regel |
| 12 | `✕` in Modals → `lucide-react`-`X` | Entspricht der eigenen Icon-Regel |
| 13 | Regressionstests `tests/a11y.spec.ts` | 12 neue Tests halten die Punkte 1–4 und 9 fest |

**Gemessenes Ergebnis nach den Änderungen** (Minimum aus `--surface` und `--bg`, Zielwerte: Text 4,5:1 · text-4 3:1):

| Theme | text-2 | text-3 | text-4 | Button | Akzent als Text |
|---|---|---|---|---|---|
| default | 6,31 | 4,53 | 3,04 | 17,06 | 4,78 |
| modern | 5,38 | 4,61 | 3,01 | 10,85 | 4,73 |
| forest | 6,07 | 4,55 | 3,00 | 9,74 | 8,70 |
| earth | 8,07 | 4,83 | 3,17 | 9,44 | 4,77 |
| winter | 5,67 | 4,59 | 3,17 | 14,45 | 4,74 |
| dark | 10,57 | 5,32 | 3,33 | 4,73 | 6,51 |

Testlage: 126 Playwright-Tests (114 vorher + 12 neue) und 172 Backend-Jest-Tests grün, `tsc -b` und Produktions-Build fehlerfrei.

**Bewusste Design-Entscheidungen dabei** (bitte gegenprüfen):
- Die Akzentfarbe des Themes *modern* wurde von `#d4714e` auf `#b04824` abgedunkelt, *earth* von `#a35e47` auf `#9d5943`, *winter* von `#4f7c82` auf `#4a747a`. Farbton bleibt jeweils erhalten, der Eindruck wird etwas kräftiger.
- Im Dark-Theme haben Primärbuttons jetzt **dunkle statt weißer** Schrift — anders ist die helle Akzentfläche nicht AA-fähig.
- „Service" ist auf dem Handy hinter „Mehr" gewandert. Der zugehörige Test in `service.spec.ts` wurde entsprechend angepasst.

### Kurzfristig — eigene Iteration

11. 812 Hex-Werte → Tokens (45 Dateien, mechanisch, nach Häufigkeit)
12. Tabellen: 13 px, Zebrastreifen, `scope`, `caption`
13. `FilterChip`/`SortTh`/`StepIndicator` nach `components/ui/` heben
14. 226 Unicode-Icons → `lucide-react`
15. Skeleton-Komponente statt „Laden …"
16. `htmlFor`/`id` für die restlichen ~370 Labels; `aria-describedby` für Feldfehler

### Mittelfristig — Konzeptarbeit

17. Mobiles Tabellenlayout (Karten statt Seitwärts-Scrollen)
18. Breakpoints auf 3–4 Stufen reduzieren
19. Navigation gruppieren (10 flache Bereiche)
20. 293 `title` → `HelpHint`/`InfoHint`
21. Lint-Regeln gegen erneute Erosion
22. Automatisierte a11y-Prüfung (`@axe-core/playwright`) in die bestehenden Playwright-Tests

---

## Was ausdrücklich gut ist

Damit die Verhältnismäßigkeit stimmt — dieses Fundament ist besser als bei den meisten Produkten dieser Größe:

- **Sechs vollständig durchdeklinierte Themes** mit semantischen Farbrollen (`--chrome`, `--accent-tint`, `--nav-active`) statt roher Farbwerte
- **Zentrale Typo-Skala** (`--fs-page-title` … `--fs-label`) mit bewusster Begründung im Kommentar
- **Selbst gehostete variable Schrift** mit `font-display: swap` und geklärter Lizenz
- **Durchgängiges RBAC- und Lizenz-Gating** direkt in der Navigation
- **Ausgebaute Leer- und Ladezustände** (108 bzw. 476 Stellen)
- **Eigenes Hilfe-System** (`HelpHint`/`InfoHint`, `helpContent.tsx`) mit Konzeptdokument
- **`useBackdropClose`** löst ein echtes, oft übersehenes Problem (versehentliches Schließen beim Textmarkieren) sehr sauber
- **Playwright-Smoke-Tests** mit dokumentierten Responsive-Regeln
- **Barrierefreiheits-Grundlagen vorhanden**: `<main>`, `<nav aria-label>`, `role="alert"`/`role="status"`, `aria-label` auf Icon-Buttons

Das Problem ist nicht das Fundament. Es ist die fehlende Durchsetzung — und dass drei Token-Ebenen fehlen, die Entwickler zum Improvisieren zwingen.

---

## Quellen

- [WCAG 2.2 (W3C Recommendation)](https://www.w3.org/TR/WCAG22/) — 2.4.11 Focus Not Obscured, 2.4.13 Focus Appearance, 2.5.7 Dragging Movements, 2.5.8 Target Size
- [What's new in WCAG 2.2 — TetraLogical](https://tetralogical.com/blog/2023/10/05/whats-new-wcag-2.2/)
- [European Accessibility Act — Eye-Able](https://eye-able.com/compliance/european-accessibility-act-eaa)
- [EAA-Vorbereitung für SaaS-Anbieter — Accessible.org](https://accessible.org/saas-companies-europe-eaa-prepare/)
- [EAA & EN 301 549 für SaaS — Accessibility.Works](https://www.accessibility.works/blog/saas-eaa-compliance-european-accessibility-act-en-301-549-requirements/)
