# Systemanalyse Oberfläche — Linsen-Stapel, 01.10.2026

**Methode:** Wie in den Vormonaten. plan&simple wurde mit der Demo-Fixture
(`tests/fixtures/demoData.ts`) unter Playwright gerendert und im Browser vermessen —
Spaltenpositionen, `elementFromPoint`, Containerbreiten, Trefferflächen — in beiden
Projekten. Dazu dieselben statischen Auszählungen wie im Vormonat, diesmal **an beiden
Commits ausgeführt** statt aus dem Bericht übernommen: alle 23 Vormonatswerte haben sich
am Commit `126af56` exakt reproduzieren lassen, die Delta-Tabelle ist damit belastbar.

**Browser-Messung: gelaufen.** 12 + 12 + 1 + 8 Messläufe, alle bestanden; es fehlt keine
Kennzahl. Wie im Vormonat ließ sich die zum installierten Playwright passende
Chromium-Fassung nicht laden (`cdn.playwright.dev` von der Netzwerkrichtlinie geblockt,
Fehlermeldung *„Failed to download Chrome for Testing 148.0.7778.96"*); gemessen wurde mit
`chromium-1194` aus dem Sandkasten über `launchOptions.executablePath`.

**Eine Korrektur am Messprotokoll:** Das Desktop-Projekt ist `devices['Desktop Chrome']`
und misst **1280 × 720**, nicht 1280 × 800 wie in den beiden Vorberichten angegeben. Für
alle Breitenbefunde ist das folgenlos (die Breite stimmt), für Höhenangaben nicht — die
Zeilen „Seitenhöhe 720" unten sind der *Viewport*, nicht die Dokumenthöhe.

**Zeitraum:** Zwischen dem Vormonatsbericht (`126af56`, 01.09.) und heute liegen
**149 Commits an 13 Arbeitstagen**, davon 71 am Frontend — die UI-Pilot-Runden 4 bis 12.
Das ist der bewegteste Monat dieser Reihe, und das prägt den Bericht: Der Bestand hat sich
an mehreren Stellen deutlich verbessert, während **alle drei Fehler des Vormonats
unverändert stehen**.

---

## Kurzfassung

Die zwölf Pilot-Runden haben die Erosionslage umgekehrt. Hartkodierte Farben sind um 82 %
gefallen, Inline-Styles um 42 %, verknüpfte Formularbeschriftungen von 12 % auf 54 %
gestiegen — und der Wächter prüft das jetzt selbst, statt dass ein Monatsbericht es zählt.
Das ist der größte Sprung seit Beginn dieser Reihe und steht ausführlich unter
„Was ausdrücklich gut ist".

Die drei als Fehler markierten Befunde des Vormonats sind davon **keiner** berührt. Alle
drei messen heute **dieselben Zahlen auf den Pixel genau**. Ein vierter Fehler derselben
Familie kommt dazu, neu gemessen in der Adressliste.

| # | Befund | Messwert | Schwere |
|---|---|---|---|
| 1 | **Angebotsliste: Kopfzeile und Aktionsspalte stehen an verschiedenen Stellen.** Über den Knöpfen ✎ 📄 ⋯ steht „Angebotsdatum" bzw. „Gültig bis"; 69 px Angebotsdatum und 45 px Gültig-bis liegen unter den Knöpfen | `td.doc-actions` sticky z1 bei **1150–1264**, `th` bei **1307–1421**; `elementFromPoint` an den drei Kopfpunkten: `["Angebotsdatum", "Angebotsdatum", "Gültig bis"]` — **identisch zum 01.09.** | **Kritisch — Fehler, 2. Monat** |
| 2 | **Angebotsliste mobil: die Aktionsspalte liegt 737 px außerhalb des Sichtbereichs.** Sichtbar sind 2 von 10 Spalten, ohne jeden Hinweis auf die übrigen | `td.doc-actions` **1103–1259** bei Container **366** — identisch zum 01.09. | **Hoch — Fehler, 2. Monat** |
| 3 | **Rechnungsliste mobil: nach dem Rechtsscrollen steht über der angehefteten ⋯-Spalte der Kopf „Projekt"** | nach `scrollLeft = 452`: `td` **12–78** sticky, `th` **−438…−373** static; `elementFromPoint`: `["Projekt","Projekt","Projekt"]` — identisch zum 01.09. | **Hoch — Fehler, 2. Monat** |
| 4 | **Adressliste mobil: die Aktionsspalte ist beim Laden außerhalb des Bildes — und als einzige überlaufende Liste ohne Überlauf-Kante.** „Kontakte", „Bearbeiten", „Löschen" sind unerreichbar, bis jemand blind nach rechts wischt | Tabelle **577 px in 366 px (+58 %)**, `td.doc-actions` **390–589**; `data-more-right` **nicht gesetzt** (kein `useScrollEdges` in `AdressenPage.tsx`), Kantenregel greift nur auf `.master-table--sticky-actions` | **Hoch — Fehler, neu** |
| 5 | **`title=` wächst schneller als der Code.** Die einzige Erosionsklasse, die sich gegen den allgemeinen Trend bewegt | 315 → **435** (+38 %) bei +19 % TSX-Zeilen; Dichte **7,40 → 8,59 je 1.000 Zeilen (+16 %)** | Mittel |
| 6 | **Einstellungen: 7 von 14 Reitern nutzen weiterhin 480 von 1.048 px** (568 px leer). Zwei Reiter sind auf das neue Muster umgestellt und nutzen 960 px — der Rest nicht | `.admin-block` 480 px auf 7 Reitern, `.ws-form`/`.form-section` 960 px auf 2; Reiterband **1834 px in 1048 px**, 8 von 14 sichtbar (mobil 2–3) | Mittel |
| 7 | **Zeilenziele auf dem Desktop bleiben unter der eigenen 44-px-Regel**, in allen vier Listen. Das Hauptziel der Zeile ist 15–17 px hoch | /projekte **68×15**, /angebote **69×15**, /rechnungen **302×15**, /adressen **108×17**; dazu je 2–3 Knöpfe 30×30. Auf dem Handy dagegen **0 von 5 unter 44** (/adressen: 1 von 4) | Mittel |

Befunde 1–4 sind Fehler, keine Geschmacksurteile. Befund 1 betrifft die Liste, aus der
heraus Aufträge angenommen werden; seine Ursache ist **ein fehlendes Klassenattribut**.

---

## Linse 0 · Delta zum 01.09.

Dieselben Befehle, ausgeführt am Vormonats-Commit `126af56` und am heutigen Stand
(`adb9742`). Beide Spalten sind nachgemessen, nicht abgeschrieben.

Bezugsgrößen: **TSX 42.588 → 50.611 Zeilen (+18,8 %)**, **`globals.css` 4.667 → 6.352
Zeilen (+36,1 %)**. Wo eine absolute Zahl mit dem Code mitwächst, steht die Dichte daneben.

### Gelöst oder deutlich verbessert

| Kennzahl | 01.09. | 01.10. | Richtung |
|---|---|---|---|
| **Hex-Farben in TSX** | 224 | **40** | **−82 % ✓✓** |
| **Inline-Styles (`style={{`)** | 2.225 | **1.289** | **−42 % ✓✓** |
| **`htmlFor` / `<label>`** | 53 / 426 = **12,4 %** | 248 / 458 = **54,1 %** | **×4,4 ✓✓** |
| **`var(--space-*)`-Nutzung** | 77 | **509** | **×6,6 ✓✓** |
| **Wächter: Zeilen / Prüfungen** | 197 / **3** | 450 / **8** | **+5 Prüfungen ✓✓** |
| **Unicode statt Lucide** | 58 in 10 Dateien | **21 in 11 Dateien** | **−64 % ✓** |
| **Inline-Schrift unter dem Minimum** | 12 Stellen | **3 Stellen** | **−75 % ✓** |
| `rgba(` in TSX | 71 | **46** | −35 % ✓ |
| `aria-live` (Rohtreffer) | 3 | **10** | ✓ |
| `<HelpHint>` / `<InfoHint>` | 106 | **145** | +37 % ✓ |
| `FormSection` (gemeinsamer Baustein) | 0 | **51** | neu ✓ |
| `SortTh` zentral / lokal | 4 / 6 | **8 / 5** | ✓ |
| rohe `<input|select|textarea>` | 600 | **576** | −4 % |
| `<caption>` | 0 von 88 | **1 von 90** | +1 |
| Reiter-Zustand der Einstellungen in der URL | nein | **`/admin?tab=…`** | ✓ |
| Willkommensblock abschaltbar | **nicht gemessen** (offene Frage) | **ja** („Verstanden" + Schließen) | ✓ |

### Unverändert

| Kennzahl | 01.09. | 01.10. |
|---|---|---|
| Natives `window.confirm(` | 0 | **0** |
| `aria-sort` (Rohtreffer) | 4 | **4** |
| Virtualisierung | 0 | **0** |
| Command-Palette / globale Suche | 0 | **0** |
| „Rückgängig" | 0 echte Umsetzung | **0** |
| `invalidateQueries` | 241 | **246** |
| `onMutate` / `setQueryData` | 0 | **1** |
| `<table>`-Vorkommen | 88 | **90** |
| `onClick` auf `div`/`tr`/`span` | 10 | **11** |
| **Angebotsliste, Tabellenbreite Desktop** | 1205 in 1048 (+15 %) | **1205 in 1048 (+15 %)** |
| **Angebotsliste, Tabellenbreite mobil** | 1247 in 366 (3,4×) | **1247 in 366 (3,4×)** |
| **Zeitraum-Auswahl der Übersicht** | 143 px in einer Leiste von 1048 px | **143 px in 1048 px** |

### Was *gewachsen* ist — das Frühwarnsignal

| Kennzahl | 01.09. | 01.10. | absolut | Dichte je 1.000 Zeilen |
|---|---|---|---|---|
| **`title=` als einzige Erklärung** | 315 | **435** | **+38 %** | 7,40 → **8,59 (+16 %) ✗** |
| **Rohe px in `globals.css`** | 1.936 | **2.776** | +43 % | 414,8 → **437,0 (+5,4 %)** |
| **`@media`-Blöcke** | 31 | **90** | **×2,9** | 6,6 → **14,2 (×2,1) ✗** |
| Breakpoint-Werte (distinct) | 12 | **14** | +2 | — |
| CSS-Regeln unter der eigenen Mindestschrift | 8 | **9** | +1 | — |
| `<FormField>`-Verwendungen | 121 | **80** | −34 % | siehe unten |

Drei Anmerkungen dazu, weil die nackte Zahl in zwei Fällen in die Irre führt:

- **`title=` ist die einzige echte Erosion.** Alle anderen gewachsenen Zahlen wachsen
  langsamer als der Code oder haben eine Erklärung; `title=` wächst **schneller**. Es ist
  zugleich die Klasse, die der erweiterte Wächter weiterhin nicht sieht.
- **Die rohen px sind relativ fast stabil** (+5,4 % Dichte) — bei gleichzeitig
  versechsfachter `--space-*`-Nutzung. Das Verhältnis Token zu rohem px ging von
  **1 : 25 auf 1 : 5,5**. Der absolute Anstieg ist der Preis von 36 % mehr CSS, nicht
  nachlassende Disziplin.
- **`<FormField>` −34 % ist keine Verschlechterung.** Die verknüpften Beschriftungen sind
  im selben Zeitraum von 53 auf 248 gestiegen und von 5 auf **47 Dateien** gestreut: Die
  neuen Formulare verknüpfen `<label htmlFor>` direkt, statt durch `FormField` zu gehen.
  Das Ziel (Beschriftung am Feld) wird erreicht, nur über einen zweiten Weg. Zu
  entscheiden bleibt, ob beide Wege nebeneinander bestehen sollen — als
  Barrierefreiheits-Kennzahl ist das Ergebnis eindeutig besser.

**Neu und erklärungsbedürftig: `@media`-Blöcke ×2,9 bei nur +2 Breakpoints.** Die beiden
neuen Werte sind **639px** und **1200px** — Nachbarn der vorhandenen 640px/641px bzw.
1280px. Damit stehen jetzt **drei Breakpoints innerhalb von 2 px** nebeneinander
(639/640/641). Das ist noch kein Fehler, aber genau die Form, in der Breakpoint-Drift
beginnt.

`npm run check:design` **läuft durch**: *„Design-System in Ordnung — 105 Tokens, 9 Themes,
1224 Klassen geprueft."* Eine Warnung steht daneben (SERIES-Kontrast zweier Diagrammfarben
auf Weiß), sie ist im Skript begründet und schlägt bewusst nicht fehl.

---

## Linse 1 · Datentabellen

### 1.1 Die drei Fehler des Vormonats stehen unverändert — mit identischen Zahlen

Das ist der Kern dieses Berichts. Keine der sechs „Sofort"-Maßnahmen des Vormonats
(Aufwand XS bis S) ist umgesetzt. Nachgewiesen je Maßnahme:

| Vormonat | Maßnahme | Ort heute | Stand |
|---|---|---|---|
| 1 | `className="doc-actions"` an die Aktions-Kopfzelle | `AngeboteListe.tsx:216` — `<th scope="col"><span className="sr-only">Aktionen</span></th>`, weiterhin ohne Klasse | **offen** |
| 2 | Kopfzellen-Test über beide Listen laufen lassen | `tables.spec.ts:65` — weiterhin `page.goto('/rechnungen')`, während `UEBERLAUFENDE_LISTEN` (Zeile 22) beide Listen führt | **offen** |
| 3 | `th:not(.doc-actions)` in der Handy-Regel | `globals.css:3100` — `.master-table th { position: static !important; }` unverändert | **offen** |
| 4 | Aktionsspalte der Angebotsliste mobil nach vorne (`narrow`-Muster) | `narrow` steht in `RechnungenListe.tsx:345/1011`, in `AngeboteListe.tsx` **nicht** | **offen** |
| 5 | Lupen-Icon auf `currentColor` | `globals.css:1472/1479` — `stroke='%236b7280'` / `%23909090` unverändert | **offen** |
| 6 | Acht Schriftgrößen unter dem Minimum auf 11 px | jetzt **neun**: `globals.css:986, 1220, 2164, 2396, 2774 (9 px), 3728, 3819, 4995, 5008` | **offen, +1** |

Die Messwerte zu 1–3 sind oben in der Kurzfassung; sie stimmen mit denen des 01.09. auf
den Pixel überein. Zu Befund 1 kommt eine Beobachtung dazu, die ihn schärfer macht:

**Nach vollständigem Rechtsscrollen stimmt die Zuordnung.** Gemessen auf /angebote
desktop, `scrollLeft = 157` (Maximum): `th` und `td.doc-actions` liegen beide bei
**1150–1264**, und `elementFromPoint` meldet dreimal „Aktionen". Der Fehler zeigt sich
also **genau im Ausgangszustand** — dem einzigen, den jemand ohne Zutun sieht. Eine
Prüfung, die nach dem Scrollen misst, wäre grün.

### 1.2 Adressliste — dieselbe Familie, bisher nicht gemessen (Fehler, neu)

Die Adressliste ist mit **577 px in 366 px (+58 %)** die schmalste der vier überlaufenden
Listen und deshalb bislang durchgerutscht. Gemessen bei 390 × 844:

| | Messwert |
|---|---|
| `td.doc-actions` („Kontakte", Bearbeiten, Löschen) | **390–589** bei Container **366** |
| `data-more-right` | **nicht gesetzt** |
| `useScrollEdges` in `AdressenPage.tsx` | **nicht importiert** (nur Angebote, Projekte, Rechnungen) |
| Tabellenklasse | `master-table` — **ohne** `--sticky-actions` |

Zwei Gründe, warum hier gar nichts auf den Überlauf hinweist, und beide sind nötig: Die
Liste ruft den Hook nicht auf, der das Attribut setzt — **und** die Schattenregel
(`globals.css:1659–1662`) greift ohnehin nur auf `.master-table--sticky-actions`, das die
Adresstabelle nicht trägt. Selbst ein nachgerüsteter Hook bliebe ohne Wirkung.

Im Screenshot ist das Ergebnis eindeutig: sichtbar sind Name, Ort, Land und ein
abgeschnittenes „Kundennr."; die drei Zeilenaktionen beginnen 24 px hinter dem Rand, und
nichts deutet darauf hin. Die Adressliste ist die Liste, über die Kontakte gepflegt
werden — „Kontakte" ist dort die häufigste Handlung.

**Vorschlag (S):** `useScrollEdges` **und** `master-table--sticky-actions` an die
Adressliste, oder — konsequenter — die Kantenregel von der Klasse `--sticky-actions`
lösen und an `[data-more-right]` allein hängen. Dann gilt sie für jede überlaufende
Tabelle, auch die nächste.

### 1.3 Breiten und Spalten — die Umstellung steht weiterhin bei zwei von vier Listen

| Seite | Desktop 1280 | Mobil 390 | Spalten D → M | `useFitColumns` | Detailzeile | Kante |
|---|---|---|---|---|---|---|
| /rechnungen | **1048 in 1048 (0 %)** | 818 in 366 (2,2×) | 7 → 6 | ✓ | ✓ | ✓ |
| /projekte | **1048 in 1048 (0 %)** | 785 in 366 (2,1×) | 6 → 5 | ✓ | ✓ | ✓ |
| /adressen | 1048 in 1048 (0 %) | 577 in 366 (1,6×) | 5 → 5 | ✗ | ✗ | **✗** |
| /angebote | **1205 in 1048 (+15 %)** | **1247 in 366 (3,4×)** | 10 → 10 | ✗ | ✗ | ✓ |

Alle vier Werte sind identisch zum Vormonat (±3 px bei /adressen). Die Angebotsliste ist
mit **10 Spalten** unverändert die breiteste Liste im Produkt und die einzige, die ihre
Spalten weder reduziert noch aufklappbar macht.

### 1.4 Zeilenhöhen und Trefferflächen — mobil gelöst, Desktop offen

**Zeilenhöhen sind in allen vier Listen konstant**: Desktop 47–48 px, mobil 61–62 px, ohne
Ausreißer. Der Vormonatsbefund bleibt erledigt.

Trefferflächen in der ersten Tabellenzeile, gemessen je Liste:

| Liste | Desktop | Mobil |
|---|---|---|
| /projekte | 68×**15** · 30×30 · 30×30 · 30×30 → **4 von 4 unter 44** | 44×44 ×4 + 68×44 → **0 von 5 unter 44 ✓** |
| /angebote | 69×**15** · 30×30 ×3 → **4 von 4 unter 44** | 69×44 + 44×44 ×3 → **0 von 4 ✓** |
| /rechnungen | 24×24 · 302×**15** · 30×30 ×2 · 37×30 → **5 von 5 unter 44** | 44×44 ×2 + 302×44 → **0 von 3 ✓** |
| /adressen | 108×**17** · 71×30 · 30×30 ×2 → **4 von 4 unter 44** | **57×37** · 71×44 · 44×44 ×2 → **1 von 4 unter 44** |

Zwei Dinge fallen auf. Erstens: Auf dem Handy hält die eigene Regel, auf dem Desktop in
keiner einzigen Liste — und das Hauptziel der Zeile (der Link auf den Datensatz) ist
überall **15–17 px hoch**. Zweitens: `/adressen` mobil hat mit **57×37** das einzige
Handy-Ziel unter 44 px; die übrigen drei Listen sind dort sauber. Das passt zum Bild aus
1.2 — die Adressliste hat die Pilot-Runde nicht in derselben Tiefe mitgemacht.

**Geprüft und entwarnt (wie im Vormonat):** In der Rechnungsliste messen auf dem Handy
zwei Zeilenknöpfe 0×0 px. Nachgemessen: `checkVisibility() === false`. Sie stehen unter
`.doc-actions-inline { display: none }` und sind damit aus Tab-Reihenfolge und
Screenreader-Ausgabe heraus. **Kein Fehler.**

### 1.5 Vorlauf bis zur ersten Datenzeile (neu gemessen)

Wie viel Platz verbraucht eine Liste, bevor die ersten Daten kommen?

| Liste | Desktop (von 720 px) | Mobil (von 844 px) | Werkzeugleiste mobil |
|---|---|---|---|
| /angebote | 117 px | **161 px** | 94 px |
| /projekte | 153 px | **216 px** | 94 px |
| /adressen | 153 px | **268 px** | **146 px** |
| /rechnungen | 215 px | **326 px (39 % des Bildschirms)** | 90 px |

Auf /rechnungen stehen auf dem Handy über der ersten Rechnung: Reiterband, der
zugeklappte Block „Abrechenbare Projekte", Suchfeld, Filterzeile und Tabellenkopf. Das ist
kein Fehler — jedes Element ist begründet —, aber **39 % des Bildschirms vor der ersten
Zeile** ist eine Zahl, die man kennen sollte, bevor ein weiteres Element dazukommt.

Bei /adressen ist die Werkzeugleiste mit **146 px** um 60 % höher als bei den anderen
drei: Sie bricht auf dem Handy in drei Zeilen um (Suche · Filter + Spalten + CSV +
Anzahl · „+ Neu" allein in der dritten).

---

## Linse 2 · Bedienökonomie

### 2.1 Gelöst: die Einstellungen sind verlinkbar

`AdminPage.tsx:3443` liest jetzt `const [params, setParams] = useSearchParams()` — **mit**
Setter. Gemessen: Ein Klick auf „Datenimport" führt zu `/admin?tab=datenimport`, auf
„Vorbelegungen" zu `/admin?tab=vorbelegungen`. Alle 14 Reiter tragen ihren Zustand in der
URL. Der Vormonatsbefund („nicht verlinkbar, Zurück-Taste überspringt den ganzen Bereich")
ist erledigt.

Was bleibt: Einen **gemeinsamen** `useTabParam`-Hook gibt es weiterhin nicht (0 Treffer);
jede Reiterseite löst es selbst. Die Zahl der Mechanismen ist damit nicht gesunken,
sondern gestiegen — nur ist jetzt jeder einzelne richtig.

### 2.2 Unverändert: keine optimistischen Updates, keine globale Suche

| Befund | 01.09. | 01.10. |
|---|---|---|
| `onMutate` / `setQueryData` | 0 | **1** |
| `invalidateQueries` | 241 | **246** |
| Command-Palette / globale Suche | 0 | **0** |
| „Rückgängig" | 0 | **0** |

245 von 246 Mutationen warten weiterhin auf Server **und** Neuladen, bevor die Oberfläche
reagiert. `Ctrl/Cmd+K` existiert, aber nur lokal: `AngebotHeader.tsx:116` öffnet damit den
Angebotswechsler, `ProjektHeader` entsprechend. Beide Umsetzungen sind gut — sie zeigen,
dass das Muster im Haus bekannt ist und nur nicht global angeboten wird.

---

## Linse 3 · Visuelle Hierarchie

### 3.1 Einstellungen — halb umgestellt, und die Hälften sind messbar verschieden

Alle 14 Reiter einzeln vermessen (Desktop, `.app-main` = 1.080 px, Inhaltsbereich
1.048 px):

| Muster | Reiter | Inhaltsbreite | ungenutzt |
|---|---|---|---|
| **neu** (`.ws-form` / `.form-section`) | Stammdaten, Vorbelegungen | **960 px** | 88 px (8 %) |
| **alt** (`.admin-block`) | Datenimport, Benachrichtigungen, Unternehmen, E-Mail-Versand, Nummernkreise, Dokumentvorlagen, Arbeitszeiten | **480 px** | **568 px (54 %)** |
| weder/noch | Monatsabschluss, Mahnungen, Kostensatz-Rechner, Rollen & Berechtigungen, Engagement | — | — |

Der Vormonatsbefund („600 von 1.080 px ungenutzt") gilt also nicht mehr pauschal, sondern
**auf 7 von 14 Reitern** — und dort mit 568 px fast unverändert. Die zwei umgestellten
Reiter zeigen, wie es aussehen soll: `.ws-form` mit `FormSection`, 960 px, zwei Spalten ab
900 px.

Das Reiterband selbst ist unverändert: **1834 px in 1048 px**, 8 von 14 sichtbar, mobil
2–3. Neu ist immerhin ein sichtbarer `›`-Knopf am rechten Rand des Bandes — die versteckten
Reiter sind jetzt wenigstens angedeutet. Verborgen bleiben unter anderem *Rollen &
Berechtigungen*, *Nummernkreise*, *Mahnungen* und *Dokumentvorlagen*: die Einträge, die man
gezielt sucht, statt sie zu durchblättern.

### 3.2 Gelöst: der Willkommensblock lässt sich abschalten

Die offene Frage des Vormonats ist beantwortet. `.welcome-panel` misst **301 px auf dem
Desktop, 551 px auf dem Handy** und trägt zwei Auswege: einen Schließen-Knopf
(`welcome-panel-close`) und „Verstanden" (`btn-secondary btn-small`). Der frühere dunkle
„Los geht's"-Knopf ist weg; der Block führt nicht mehr mit der lautesten Fläche der Seite.

Ein Nebenbefund dazu: Der Schließen-Knopf misst auf dem Desktop **28 × 28 px**, auf dem
Handy 44 × 44. Das ist dieselbe Desktop-Lücke wie in Linse 1.4 und hier besonders ungünstig,
weil er die einzige Möglichkeit ist, 301 px zurückzugewinnen.

Der einzige gefüllte Knopf der Übersicht ist heute **„Zeit buchen"** (484 × 40,
`rgb(26, 26, 46)`, 183 px von oben). Das ist eine vertretbare Wahl — Zeit buchen ist die
häufigste tägliche Handlung —, und es ist genau **ein** Knopf, nicht drei konkurrierende.
Der Vormonatsbefund zum grün gefüllten Stempeluhr-Knopf ist damit erledigt.

### 3.3 Unverändert: die Zeitraum-Leiste

`.dash-filter-bar` misst **1048 × 49 px** und enthält ein einziges Bedienelement von
**143 px** — 14 % der Breite, eine volle Bildschirmzeile. Gemessen identisch zum Vormonat.

---

## Linse 4 · Erosion — was der Wächter jetzt sieht

`scripts/check-design-system.mjs` ist von **197 auf 450 Zeilen** gewachsen und prüft statt
drei jetzt **acht** Dinge: undefinierte CSS-Variablen · undefinierte CSS-Klassen · fehlende
Tokens je Theme · WCAG-Kontrast je Theme · **hartkodierte Farben in TSX** · **eigene
Währungsformatierer** · **CSS-Variablen als Diagrammfarbe** · **Farbabstand der
Diagrammreihen bei Farbfehlsichtigkeit**.

Die Wirkung ist in den Zahlen ablesbar — das ist der stärkste Zusammenhang in diesem
Bericht:

| Klasse | 01.09. | 01.10. | geprüft? |
|---|---|---|---|
| **Hex in TSX** | 224 | **40** | **ja (neu) → −82 %** |
| **`rgba(` in TSX** | 71 | **46** | mittelbar → −35 % |
| **Eigene Währungsformatierer** | — | 0 Befunde | **ja (neu)** |
| **CSS-Variable als Diagrammfarbe** | — | 0 Befunde | **ja (neu)** |
| Inline-Styles | 2.225 | **1.289** | nein → −42 % |
| Unicode-Icons | 58 | **21** | nein → −64 % |
| Schrift unter dem Minimum (CSS) | 8 | **9** | nein → **+1** |
| Schrift unter dem Minimum (inline) | 12 | **3** | nein → −75 % |
| `title=` als einzige Erklärung | 315 | **435** | nein → **+38 %** |
| Rohe px in `globals.css` | 1.936 | **2.776** | nein → +43 % (Dichte +5,4 %) |

Die vier ungeprüften Klassen, die *trotzdem* kleiner wurden (Inline-Styles, Unicode,
Inline-Schriftgrößen), sind Mitnahmeeffekte der Pilot-Runden — nicht bewacht. Die beiden,
die **wuchsen**, sind genau die, an die beim Umbauen niemand denkt: eine CSS-Regel mit
10 px und ein `title=` statt eines Hilfetexts. Das Muster des Vormonats hält: *was geprüft
wird, fällt; was nicht geprüft wird, hängt am Zufall der Runde.*

**Zwei kleine Unstimmigkeiten im Wächter selbst:**

1. Der Kopfkommentar (`check-design-system.mjs:12`) sagt weiterhin „**Vier** Pruefungen"
   und listet vier auf — es sind acht. Wer die Datei liest, um zu entscheiden, ob seine
   Klasse geprüft wird, bekommt die falsche Antwort.
2. Die neun CSS-Regeln unter der eigenen Mindestschrift stehen in `globals.css:986, 1220,
   2164, 2396, **2774 (9 px)**, 3728, 3819, 4995, 5008`; inline bleiben drei
   (`DokumentvorlagenSection.tsx:59` = **8 px**, `RollenSection.tsx:150/155` = 10 px).
   CLAUDE.md fordert 13 px für Fließtext und 11 px für Meta. Die 8 px sind unverändert der
   härteste Einzelfall und stehen seit mindestens drei Berichten.

**Die Bausteine ziehen sich zusammen — bis auf einen:**

| Baustein | zentral bezogen | lokale Kopien |
|---|---|---|
| `FilterChip` | 13 | **0** |
| `RowMenu` | 15 | **0** |
| `StepIndicator` | 4 | **0** |
| `FormField` | 14 | **0** |
| **`SortTh`** | 8 (war 4) | **5** (war 6) |

Die fünf `SortTh`-Kopien stehen in `EinzelprojektTab.tsx`, `TeilfertigeLeistungenTab.tsx`
(**neu dazugekommen**), `ProjektlisteTab.tsx`, `DashboardPage.tsx` und
`MahnungenListe.tsx`. `HonorarWizard.tsx` und `AdressenPage.tsx` sind seit dem Vormonat
migriert — aber mit `TeilfertigeLeistungenTab.tsx` ist in derselben Zeit eine neue Kopie
entstanden. Netto −1 bei 71 Frontend-Commits.

**Die Folge bleibt die des Vormonats, nur mit anderer Besetzung:** `tabIndex` und
`onKeyDown` stehen ausschließlich in `components/ui/SortTh.tsx`. In vier der fünf Kopien
gibt es **null** Treffer für beides — Sortieren ist dort reine Mausfunktion.
`DashboardPage.tsx` meldet weiterhin `aria-sort` an Screenreader für eine Sortierung, die
per Tastatur nicht änderbar ist.

**Zwei Namen für dieselbe Bedienleiste** (Vormonat: drei): `.list-toolbar` (13 Stellen,
17 CSS-Regeln) und `.pl-toolbar` (10 Stellen, 15 Regeln). `.ls-toolbar` ist aus dem TSX
verschwunden, hat aber **noch 2 CSS-Regeln** ohne Verwender. Gemessen stehen beide Leisten
nebeneinander im Produkt: /angebote nutzt `.list-toolbar`, die anderen drei Listen
`.pl-toolbar` — bei identischer Höhe (38 px Desktop) und identischem Zweck.

---

## Linse 5 · Barrierefreiheit

**Der größte Einzelfortschritt dieses Monats.** Verknüpfte Formularbeschriftungen:

| | 01.09. | 01.10. |
|---|---|---|
| `htmlFor` | 53 | **248** |
| `<label>` | 426 | 458 |
| **Quote** | **12,4 %** | **54,1 %** |
| Dateien mit `htmlFor` | 5 | **47** |

Von „fünf Dateien haben es, der Rest nicht" zu „47 Dateien haben es". Das ist die
Kennzahl, an der `axe.spec.ts` sein `KNOWN_GAPS`-Eintrag `'label'` hängt.

Was offen bleibt, mit Zahl:

| Befund | Messwert | Stand |
|---|---|---|
| `<label>` ohne `htmlFor` | **210 von 458 (45,9 %)** | war 88 % |
| `title=` als einzige Erklärung | **435** | wächst (315 → 435) |
| `<caption>` in Tabellen | **1 von 90** (`AbwesenheitenTab.tsx:282`, `sr-only`) | war 0 von 88 |
| `aria-sort` | **4 Rohtreffer** bei 6 Sortierkopf-Varianten | unverändert |
| **Sortieren per Tastatur** | **1 von 6** Umsetzungen | war 1 von 7 |
| `onClick` auf `div`/`tr`/`span` | 11 | war 10 |
| `aria-live`-Regionen | 10 Rohtreffer | war 3 |

Die erste `<caption>` des Produkts ist bemerkenswert, weil sie richtig gebaut ist:
`sr-only`, mit Monat und Jahr im Text — ein Screenreader bekommt damit die Tabelle benannt,
ohne dass die Oberfläche sich ändert. Sie ist die Vorlage für die übrigen 89.

---

## Linse 6 · Skalierung

Virtualisierung unverändert **0**. `<table>`-Vorkommen 88 → **90**. Chip-Filter laut
CLAUDE.md weiterhin immer clientseitig. Die Fixture liefert 8 Projekte, 12 Rechnungen,
8 Adressen und 5 Angebote — zum Verhalten bei 2.000 Adressen lässt sich daraus nichts
messen, nur rechnen. Der Vorschlag der Vormonate (erst auf 200 Zeilen begrenzen, dann
virtualisieren, dann Facetten-Endpunkt) steht unverändert.

**Neu in dieser Linse: die Breakpoint-Dichte.** `@media`-Blöcke in `globals.css` 31 → **90
(×2,9)**, Breakpoint-Werte 12 → **14**. Die zwei neuen sind `639px` und `1200px`. Damit
stehen **639px, 640px und 641px** nebeneinander — drei Grenzen innerhalb von 2 px, bei
denen niemand mehr sagen kann, welche gewinnt, wenn sich zwei Regeln widersprechen.
Das ist kein heutiger Fehler, sondern der Zeitpunkt, zu dem man es billig festlegt.

---

## Vorschläge

### Sofort — klein und klar umrissen

Die Punkte 1–6 sind **unverändert die des Vormonats**. Sie sind hier nicht wiederholt,
weil sie wichtig klingen, sondern weil sie gemessen offen sind und zusammen auf einen
halben Tag kommen.

| # | Maßnahme | Ort | Aufwand |
|---|---|---|---|
| 1 | `className="doc-actions"` an die Aktions-Kopfzelle — **Kopf und Körper zeigen auf verschiedene Spalten** | `AngeboteListe.tsx:216` | XS |
| 2 | Kopfzellen-Test über `UEBERLAUFENDE_LISTEN` laufen lassen statt nur über /rechnungen — sonst bewacht nichts die Korrektur aus 1 | `tables.spec.ts:65` | XS |
| 3 | `th:not(.doc-actions)` in der Handy-Regel — **sonst steht nach dem Scrollen „Projekt" über den ⋯-Knöpfen** | `globals.css:3100` | XS |
| 4 | Aktionsspalte der Angebotsliste auf schmalen Geräten nach vorne (`narrow`-Muster) — **derzeit 737 px außerhalb des Bildes** | `AngeboteListe.tsx`, Vorbild `RechnungenListe.tsx:1011` | S |
| 5 | Lupen-Icon des Suchfelds auf `currentColor` statt fester Data-URI | `globals.css:1472/1479` | XS |
| 6 | Die neun Schriftgrößen unter dem eigenen Minimum auf 11 px heben; die 8 px zuerst | `globals.css:986, 1220, 2164, 2396, 2774, 3728, 3819, 4995, 5008` · `DokumentvorlagenSection.tsx:59` | XS |
| **7** | **Überlauf-Kante der Adressliste** — `useScrollEdges` dort ergänzen **und** die Kantenregel von `.master-table--sticky-actions` auf `[data-more-right]` umhängen, damit sie für jede überlaufende Tabelle gilt | `AdressenPage.tsx`, `globals.css:1659–1662` | S |
| **8** | **Kopfkommentar des Wächters** auf acht Prüfungen bringen — er sagt „Vier" | `check-design-system.mjs:12` | XS |
| **9** | **`.ls-toolbar`** aus `globals.css` entfernen: 2 Regeln, 0 Verwender | `globals.css` | XS |

Punkte 1, 3, 4 und 7 sind Fehlerkorrekturen, keine Gestaltungsvorschläge.

### Als Nächstes — messbarer Alltagsgewinn

| # | Maßnahme | Wirkung, mit Zahl |
|---|---|---|
| 10 | **`useFitColumns` + `RowDetailRow` auf die Angebotsliste** | Die letzte Liste mit +15 % Desktop-Überlauf und 10 unveränderten Spalten (mobil 3,4×); die Mechanik ist seit zwei Monaten gebaut und getestet |
| 11 | **Wächter erweitern** um `title=`, Mindestschriftgröße und Unicode-Icons — je mit Bestandsgrenze | Die drei Klassen, die er nicht sieht und die seit dem Vormonat **nicht** gefallen sind; `title=` ist mit +38 % die einzige echte Erosion im Bericht |
| 12 | **Die restlichen 7 Einstellungen-Reiter auf `.ws-form` + `FormSection`** ziehen | 568 von 1.048 px ungenutzt auf 7 Reitern; die zwei umgestellten zeigen das Ziel (960 px) |
| 13 | **`SortTh`: die 5 Kopien migrieren** — zuerst `TeilfertigeLeistungenTab.tsx` (neu entstanden) | Sortieren ist in 5 von 6 Umsetzungen reine Mausfunktion; `DashboardPage.tsx` meldet eine Sortierrichtung, die per Tastatur nicht änderbar ist |
| 14 | **Zeilenziele auf dem Desktop auf 40–44 px**, Löschen hinter das ⋯-Menü | 4 von 4 Zielen unter der eigenen Regel in **allen vier** Listen; das Hauptziel ist 15–17 px hoch |
| 15 | **Optimistische Updates** für Inline-Edit, Statuswechsel, Häkchen | 245 von 246 Mutationen warten auf Server + Neuladen |
| 16 | **Die restlichen 210 `<label>` ohne `htmlFor`** nachziehen | 54,1 % verknüpft (war 12,4 %); danach lässt sich `'label'` aus `KNOWN_GAPS` in `axe.spec.ts` streichen |
| 17 | **`.list-toolbar` und `.pl-toolbar` zusammenlegen** (13 + 10 Stellen, 17 + 15 CSS-Regeln) | Zwei Namen, eine Bedeutung, identische Höhe — und CLAUDE.md benennt genau diesen Fall als gelöst, was er nicht ist |

### Konzeptarbeit — vorher besprechen

| # | Maßnahme | Warum eine Entscheidung, keine Korrektur |
|---|---|---|
| 18 | **`FormField` oder `<label htmlFor>` — einen Weg festlegen** | Beide wachsen gerade nebeneinander (`FormField` −34 %, `htmlFor` ×4,7). Das Ergebnis ist in beiden Fällen richtig; zwei Wege zu pflegen ist die Entscheidung, die niemand getroffen hat |
| 19 | **Breakpoints auf einen Satz festlegen** (heute 14 Werte, darunter 639/640/641) | Betrifft 90 `@media`-Blöcke; billig solange es 14 sind |
| 20 | **Einstellungen in 5 Gruppen** mit Suche statt 14 Reitern in einem 1834-px-Band | Ändert die gewohnte Reihenfolge für Bestandsnutzer |
| 21 | **`Ctrl/Cmd+K` global** über die fünf Objektarten und die Einstellungen | Das Muster ist in `AngebotHeader.tsx:116` bereits gebaut — die Entscheidung ist, ob es global gilt |
| 22 | **Listen bei 200 Zeilen abschneiden**, danach Virtualisierung, danach Facetten-Endpunkt | Stufe 3 bricht mit „Chip-Filter immer clientseitig" aus CLAUDE.md |
| 23 | **Rückgängig-Toast** statt Bestätigungsdialog für umkehrbare Aktionen | Bei harten Löschungen ist der Dialog die einzige Bremse — eine Produktentscheidung |
| 24 | **Vorlauf auf dem Handy begrenzen** (/rechnungen: 326 px = 39 % vor der ersten Zeile) | Jedes Element darüber ist einzeln begründet; die Summe ist es nicht |

---

## Was ausdrücklich gut ist

Damit die Verhältnismäßigkeit stimmt — und damit Gelöstes nicht erneut angefasst wird:

- **Der Wächter ist von drei auf acht Prüfungen gewachsen, und die Zahlen folgen ihm.**
  Hartkodierte Farben 224 → **40 (−82 %)**, seit `check-design-system.mjs` sie prüft. Das
  ist nicht nur der größte Einzelfortschritt dieses Monats, sondern der Beleg für die
  These, die diese Berichtsreihe seit August vertritt: *Eine Klasse, die gemessen wird,
  fällt; eine, die nur im Bericht steht, nicht.* Vorschlag 8 des Vormonats war genau das
  — er ist umgesetzt, und zwar gründlicher als vorgeschlagen (Währungsformatierer und
  Diagrammfarben standen nicht einmal auf der Liste).
- **Die Begründungen im `COLOR_EXEMPT`-Block sind vorbildlich.** Drei Ausnahmen, jede mit
  Satz: Canvas versteht kein `var()`, gespeicherte Farbwerte sind keine CSS-Variablen,
  Papiervorschauen dürfen im Dark-Theme nicht mitkippen. Eine Ausnahmeliste, die begründet,
  warum sie existiert, lässt sich in einem Jahr noch prüfen.
- **Formularbeschriftungen: von 12,4 % auf 54,1 % verknüpft**, verteilt von 5 auf 47
  Dateien. Das ist die mühsamste Art von Fortschritt — es gibt keinen zentralen Ort, an
  dem man das einmal löst.
- **`var(--space-*)` von 77 auf 509.** Das Verhältnis zu rohen px ging von 1 : 25 auf
  1 : 5,5. Die absolute px-Zahl ist gestiegen, die Disziplin trotzdem deutlich besser.
- **Der Willkommensblock hat einen Ausweg bekommen** — und der frühere dunkle
  „Los geht's"-Knopf ist weg. Die Übersicht hat heute genau **einen** gefüllten Knopf
  statt dreier konkurrierender Bauformen. Die offene Frage des Vormonats ist beantwortet,
  und zwar richtig.
- **Die Einstellungen stehen in der URL.** 14 Reiter, alle verlinkbar, Zurück-Taste
  funktioniert. Dazu ein sichtbarer `›` am Rand des Reiterbandes — die versteckten
  Reiter sind wenigstens angedeutet.
- **Die zwei umgestellten Einstellungen-Reiter zeigen das Ziel.** `.ws-form` mit
  `FormSection`, 960 von 1.048 px, und ein Leerzustand, der „noch keine Daten" erklärt
  *samt Warum* („Legen Sie z. B. ‚Hochbau' an, um Projekte und Mitarbeiter:innen danach
  zu filtern") — genau wie CLAUDE.md es verlangt.
- **Trefferflächen und Zeilenhöhen auf dem Handy halten**, jetzt über alle vier Listen:
  0 von 5 Zielen unter 44 px (außer /adressen mit 1 von 4), Zeilenhöhen konstant 61–62 px.
- **`document.body.scrollWidth` entspricht auf allen sechs geprüften Seiten in beiden
  Viewports exakt der Viewportbreite.** Zwölf von zwölf. Die Kernregel hält auch nach
  zwölf Pilot-Runden.
- **Die erste `<caption>` ist richtig gebaut** (`sr-only`, mit Monat und Jahr) und taugt
  als Vorlage für die übrigen 89.
- **Die Kommentare erklären weiterhin Entscheidungen, nicht Syntax.** `useScrollEdges.ts`
  führt drei Entwurfsentscheidungen samt dem Fehler auf, der jede gekostet hat — und
  genau dieser Kommentar war der Grund, warum Befund 4 dieses Berichts in Minuten statt
  Stunden zu belegen war: Er sagt, was das Attribut leisten soll, und man sieht sofort,
  wo es fehlt.

Das Muster des Vormonats hat sich umgedreht, und das ist die eigentliche Nachricht: Nicht
mehr „zentral gelöst, Verwendungsstellen fehlen", sondern **„breit gelöst, vier benannte
Fehler stehen seit zwei Monaten"**. Die sechs XS/S-Punkte aus der Sofort-Liste des
Vormonats kosten zusammen weniger als eine der zwölf Pilot-Runden.

---

## Anhang · Messbefehle mit den heutigen Ergebnissen

```bash
cd frontend-react
export LC_ALL=C.UTF-8            # sonst zaehlt die Unicode-Zeile Bytes: 30184 statt 21

# Linse 0 — Erosionskennzahlen            (01.09. -> 01.10.)
grep -ohE '#[0-9a-fA-F]{6}' -r --include='*.tsx' src | wc -l   # 224 ->   40
grep -ro 'style={{'            src --include='*.tsx' | wc -l   # 2225 -> 1289
grep -ro 'htmlFor'             src --include='*.tsx' | wc -l   #  53 ->  248
grep -ro '<label'              src --include='*.tsx' | wc -l   # 426 ->  458
grep -ro 'aria-live'           src --include='*.tsx' | wc -l   #   3 ->   10
grep -ro 'aria-sort'           src --include='*.tsx' | wc -l   #   4 ->    4
grep -ro 'title='              src --include='*.tsx' | wc -l   # 315 ->  435   <- einzige echte Erosion
grep -ro 'onMutate\|setQueryData'  src --include='*.tsx' | wc -l   # 0 ->    1
grep -ro 'invalidateQueries'       src --include='*.tsx' | wc -l   # 241 -> 246
grep -ro 'window\.confirm('        src --include='*.tsx' | wc -l   #   0 ->   0
grep -o  'var(--space-'  src/styles/globals.css | wc -l        #  77 ->  509
grep -oE '[0-9]+px'      src/styles/globals.css | wc -l        # 1936 -> 2776
grep -c  '<table'  -r src --include='*.tsx' | awk -F: '{s+=$2} END {print s}'   # 88 -> 90
grep -ro 'rgba('         src --include='*.tsx' | wc -l         #  71 ->   46
grep -ro '<caption'      src --include='*.tsx' | wc -l         #   0 ->    1

# Hinweis (aus 09/2026, gilt weiter): 'confirm(' ohne 'window\.' liefert 54 — alles
# Aufrufe des eigenen hooks/useConfirm.tsx (30 Dateien) und dessen Doku. Nativ: 0.

# Bezugsgroessen — ohne sie ist jede absolute Zahl wertlos
find src -name '*.tsx' | xargs cat | wc -l   # 42588 -> 50611  (+18,8 %)
wc -l < src/styles/globals.css               #  4667 ->  6352  (+36,1 %)

# Unicode statt Lucide-Icons — 58 in 10 Dateien -> 21 in 11 Dateien
grep -rlE '[✕✓✔✖▶⏭⏹✎🗑📋⚠★]' src --include='*.tsx' | while read f; do
  echo "$f $(grep -oE '[✕✓✔✖⏭⏹✎🗑📋⚠★▶]' "$f" | wc -l)"; done
# TimerBar 8 · SaveBadge 2 · DashboardPage 2 · EmployeeHistory 2 · Disclosure 1 ·
# BatchEmailModal 1 · ArbeitszeitmodelleSection 1 · ProjektrollenEditor 1 ·
# StammdatenPage 1 · AdminPage 1 · SchlussrechnungWizard 1

# Schrift unter dem eigenen Minimum (CLAUDE.md: 13px Text, 11px Meta)
grep -nE 'font-size:\s*([0-9]|10)px' src/styles/globals.css
# 9 Regeln (war 8): 986 1220 2164 2396 2774(9px) 3728 3819 4995 5008
grep -rnoE 'fontSize:\s*(10|9|8)\b'  src --include='*.tsx'
# 3 Stellen (war 12): DokumentvorlagenSection:59 = 8px · RollenSection:150/155 = 10px

# Kopierte Bausteine statt gemeinsamer Komponenten
for c in SortTh FilterChip RowMenu StepIndicator FormField; do
  echo "$c zentral: $(grep -rl "components/ui/$c" src --include='*.tsx' | wc -l)  \
lokal: $(grep -rlE "(function|const) $c\b" src --include='*.tsx' | grep -v "ui/$c" | wc -l)"
done
# SortTh 8/5 (war 4/6) · FilterChip 13/0 · RowMenu 15/0 · StepIndicator 4/0 · FormField 14/0
# SortTh-Kopien: EinzelprojektTab · TeilfertigeLeistungenTab (NEU) · ProjektlisteTab ·
#                DashboardPage · MahnungenListe
# Tastatur in den Kopien: 4 von 5 ohne tabIndex UND ohne onKeyDown.

# Skalierung / Breakpoints  (neu in dieser Reihe)
grep -c '@media' src/styles/globals.css                                  # 31 -> 90
grep -oE '@media[^{]*' src/styles/globals.css | grep -oE '[0-9]+px' | sort -u | wc -l   # 12 -> 14
# neu: 639px, 1200px  — damit stehen 639/640/641 nebeneinander

# Bedienleisten-Namen (CLAUDE.md nennt diesen Fall als geloest — er ist es halb)
for c in list-toolbar pl-toolbar ls-toolbar; do
  echo "$c: TSX $(grep -ro "$c" src --include='*.tsx' | wc -l)  CSS $(grep -c "\.$c" src/styles/globals.css)"; done
# list-toolbar 13/17 · pl-toolbar 10/15 · ls-toolbar 0/2  (2 Regeln ohne Verwender)

npm run check:design
# Design-System in Ordnung — 105 Tokens, 9 Themes, 1224 Klassen geprueft.  (8 Pruefungen)
# + 1 begruendete Warnung (SERIES-Kontrast auf Weiss), schlaegt bewusst nicht fehl.
```

**Browser-Messung** (Playwright + `tests/fixtures/demoData`, Projekte `desktop`
**1280 × 720** und `mobile` 390 × 844). Die Messskripte lagen temporär unter
`tests/zz-lens-*.spec.ts` und sind nach der Auswertung entfernt; im Sandkasten ist
`launchOptions.executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'`
nötig, weil der Download der passenden Chromium-Fassung von der Netzwerkrichtlinie
geblockt wird.

| Messung | Ergebnis |
|---|---|
| `body.scrollWidth` vs. `clientWidth`, 6 Seiten × 2 Viewports | **12 × identisch ✓** |
| Tabellenbreite in Container, Desktop | /rechnungen 1048/1048 · /projekte 1048/1048 · /adressen 1048/1048 · **/angebote 1205/1048 (+15 %)** |
| Tabellenbreite in Container, Mobil | /adressen 577/366 · /projekte 785/366 · /rechnungen 818/366 · **/angebote 1247/366 (3,4×)** |
| **Angebote: `td.doc-actions` vs. `th`, Desktop, Ausgangszustand** | **1150–1264 sticky z1 · 1307–1421** |
| **Angebote: Kopf über den Aktionsknöpfen** | **„Angebotsdatum", „Angebotsdatum", „Gültig bis"** |
| Angebote: verdeckte Datenbreite | Angebotsdatum 69 px · Gültig bis 45 px |
| Angebote: dieselbe Messung nach `scrollLeft = 157` (Max.) | beide 1150–1264, Kopf „Aktionen" ×3 — der Fehler zeigt sich **nur** im Ausgangszustand |
| **Angebote mobil: `td.doc-actions`** | **1103–1259 bei Container 366 (+737 px außerhalb)** |
| **Rechnungen mobil nach `scrollLeft = 452`** | **`td` 12–78 sticky · `th` −438…−373 static · Kopf darüber: „Projekt" ×3** |
| **Adressen mobil: `td.doc-actions`** | **390–589 bei Container 366; `data-more-right` nicht gesetzt** |
| Trefferflächen Zeile 1, Desktop | /projekte 68×**15** + 30×30 ×3 · /angebote 69×**15** + 30×30 ×3 · /rechnungen 24×24 + 302×**15** + 30×30 ×2 + 37×30 · /adressen 108×**17** + 71×30 + 30×30 ×2 |
| Trefferflächen Zeile 1, Mobil | /projekte 44×44 ×4 + 68×44 · /angebote 44×44 ×3 + 69×44 · /rechnungen 44×44 ×2 + 302×44 · **/adressen 57×37** + 71×44 + 44×44 ×2 |
| Zeilenhöhen, alle vier Listen | Desktop 47–48 px · Mobil 61–62 px, jeweils konstant |
| Vorlauf bis zur ersten Datenzeile, Mobil | /angebote 161 · /projekte 216 · /adressen 268 · **/rechnungen 326 (39 % von 844)** |
| Werkzeugleiste mobil | /rechnungen 90 · /projekte 94 · /angebote 94 · **/adressen 146 px (3 Zeilen)** |
| **Einstellungen: Inhaltsbreite je Reiter** | **7 × `.admin-block` 480 px · 2 × `.ws-form`/`.form-section` 960 px · 5 × keins** — in `.app-main` 1080 px / Inhalt 1048 px |
| Einstellungen: Reiterband | **1834 px in 1048 px**, 8 von 14 sichtbar (mobil 2–3), `›`-Knopf am Rand |
| Einstellungen: URL-Zustand | `/admin?tab=datenimport`, `?tab=vorbelegungen`, … — **alle 14 ✓** |
| Übersicht: `.welcome-panel` | **301 px Desktop / 551 px Mobil**, mit „Verstanden" + Schließen (28×28 Desktop) |
| Übersicht: einziger gefüllter Knopf | „Zeit buchen" 484×40, `rgb(26, 26, 46)`, 183 px von oben |
| Übersicht: `.dash-filter-bar` | **1048 × 49 px für ein `select` von 143 px (14 %)** |
