# Farbkonzept plan&simple — September 2026

**Stand:** 06.09.2026 · **Branch:** `claude/projektcontrolling-color-palettes-n9tb7u` · **Basis:** 4.511 Zeilen `globals.css`, 7 Theme-Blöcke, 7 auswählbare Themes

> **Umsetzungsstand.** Die Ebenen 2 und 3 (Bedeutung, Daten) sind umgesetzt und
> im Produkt: Controlling-Ampel, Geld-Konvention, CVD-taugliche Diagrammfarben,
> Prüfregeln. **Ebene 1 — die Markenpalette — ist zurückgesetzt.** Palette C war
> zwei Tage im Produkt und wurde zurückgenommen; die Gründe stehen in §6.2. Das
> helle Theme ist wieder das ursprüngliche mit weißer Kopfzeile.

Alle Kontrast- und Farbabstandswerte in diesem Dokument sind gerechnet, nicht geschätzt. Nachrechnen:

```bash
cd frontend-react && npm run check:design -- -v
```

---

## Kurzfassung

Die Frage war: *welche Farben nutzen ihre psychologische Wirkung in einem Projektcontrolling-Werkzeug?* Die ehrliche Antwort aus der Recherche lautet: **die Markenfarbe entscheidet fast nichts, die Bedeutungsfarben entscheiden fast alles.** Ob der Akzent Blau oder Petrol ist, merkt ein Nutzer in Woche zwei nicht mehr. Ob ein Projekt mit −8 % Deckungsbeitrag rot, orange oder gar nicht markiert ist, entscheidet, ob er es anschaut.

plan&simple hat heute den umgekehrten Zuschnitt: **sieben Markenpaletten, aber keine einzige Controlling-Semantik.** Die Statusfarben stammen aus dem UI-Bereich (`--success` = „gespeichert"), und dieselben vier Farben müssen auch Rentabilität ausdrücken. Ein Projekt mit Kostenüberschreitung wird dadurch mit demselben Rot markiert wie ein fehlgeschlagener Speichervorgang.

Drei Befunde, die unabhängig von der Palettenwahl gelten:

| # | Befund | Messwert | Schwere |
|---|---|---|---|
| 1 | **Diagrammfarben brechen bei Rot-Grün-Blindheit zusammen** — „Deckungsbeitrag" (blau) und „Stunden" (violett) sind bei Deuteranopie nicht unterscheidbar | ΔE = **1,1** (Schwelle 15) | Kritisch |
| 2 | **Keine Controlling-Semantik** — Rentabilität, Auslastung, Fälligkeit teilen sich die UI-Statusfarben | 0 KPI-Tokens | Hoch |
| 3 | **Der Kontrastprüfer hatte blinde Flecken** — Akzenttext auf dem Zebrastreifen und Statusfarben als Text wurden nie geprüft | 22 Verstöße in 6 von 7 Themes | Mittel |

Empfehlung in einem Satz: **Ebenen trennen** (Marke / Bedeutung / Daten), die Bedeutungsebene neu und controlling-spezifisch bauen, und für die Markenebene aus vier durchgerechneten Paletten wählen — Vorschlag **C „Blaupause"**.

---

## 1 · Ausgangslage — was heute da ist

**7 Theme-Blöcke, 7 auswählbar** (`components/layout/ThemeOptions.tsx`): `light`, `dark` und fünf Branchen-Themes (Architektur, Tiefbau, Stadt- und Verkehr, TGA, Tragwerk).

*Beim Anlegen dieses Konzepts waren es 11 Blöcke: `modern`, `forest`, `earth` und `winter` lagen noch in `globals.css`, standen aber in keiner Auswahl mehr. Die 178 Zeilen sind entfernt (§8 Schritt 4).*

**Der Standard ist generisches Tailwind-Blau.** `--accent: #2563eb` ist `blue-600`. Die Farbe ist fachlich unauffällig und trägt keine Aussage über das Produkt — sie ist der Vorgabewert, den jedes Framework mitbringt. Alle fünf Branchen-Themes haben dagegen eine erkennbare Identität (Terrakotta, Ocker, Petrol). Ausgerechnet die Palette, die den meisten Nutzern zuerst begegnet, ist die einzige ohne Haltung.

**Die Statusebene ist UI-Semantik, nicht Fach-Semantik:**

```
--success  #15803d   gespeichert · gebucht · bezahlt · rentabel?
--danger   #dc2626   Fehler · löschen · überfällig · unrentabel?
--warning  #b45309   Hinweis · Entwurf · Mahnstufe · knapp?
--info     #1d4ed8   Hinweis
```

Vier Farben tragen zwei getrennte Bedeutungswelten. Im Controlling ist das ein Problem, siehe §4.

**Die Diagrammfarben waren Tailwind-Vollton** (`theme/chartTheme.ts`, damals `SERIES_LIGHT`/`SERIES_DARK`). Sie sind explizit *nicht* aus den Statustokens abgeleitet — das ist richtig entschieden und im Code auch so begründet. Nur war der gewählte Satz nie auf Farbfehlsichtigkeit geprüft, siehe §5.

---

## 2 · Was die Recherche hergibt — und was nicht

Die Literatur zur „Farbpsychologie" zerfällt in zwei sehr unterschiedliche Hälften, und die Trennlinie ist für Entscheidungen wichtiger als jede einzelne Aussage.

**Belastbar: gelernte Konvention.** Rot = Verlust, Grün = Gewinn, Ampel = Zustand — das sind keine angeborenen Reaktionen, sondern erlernte Codes, die im Rechnungswesen seit Jahrzehnten stabil sind („rote Zahlen"). Wer sie bricht, erzeugt messbar langsamere Erkennung. Wer sie befolgt, bekommt Verständnis geschenkt. Das gilt kulturell begrenzt — im deutschsprachigen Rechnungswesen aber verlässlich.

**Belastbar: Sparsamkeit schlägt Bedeutung.** Der am besten belegte Effekt in der Dashboard-Forschung ist nicht „Blau wirkt seriös", sondern: eine Fläche, auf der alles farbig ist, transportiert nichts. Ampelfarben auf jeder Kennzahl führen zu Alarmmüdigkeit — die Nutzer hören auf, Rot zu lesen. Der Rat aus der Enterprise-UX-Praxis ist durchgehend derselbe: **strikt neutrale Struktur, gesättigte Farbe ausschließlich für Daten und echte Alarme.**

**Belastbar: Doppelkodierung.** Rot-Grün-Sehschwäche betrifft rund 8 % der Männer. Farbe darf deshalb nie der einzige Träger einer Aussage sein — Vorzeichen, Pfeil, Position oder Text müssen die Information mittragen. Das ist zugleich WCAG 1.4.1 und damit über das BFSG/EN 301 549 auch vertriebsrelevant (siehe UX-Audit 08/2026).

**Nicht belastbar: die Wirkungsversprechen der Markenfarbe.** „Blau steigert Vertrauen um 42 %" zirkuliert in Agenturblogs ohne belastbare Primärquelle. Was sich seriös sagen lässt: Blau ist im B2B- und Finanzumfeld die *erwartete* Farbe, und Erwartungskonformität senkt die Einstiegshürde. Das ist ein Argument für Blau — aber ein schwaches, und es ist zugleich das Argument gegen Blau, weil Erwartungskonformität und Austauschbarkeit dasselbe sind.

**Konsequenz für dieses Konzept:** Aufwand dorthin, wo die Wirkung belegt ist. Die Markenpalette wird nach Handwerk entschieden (Kontrast, Ruhe, Passung zur Zielgruppe), nicht nach Wirkungsversprechen. Die Bedeutungspalette wird ernst genommen, weil sie täglich Entscheidungen steuert.

---

## 3 · Kernthese: drei Ebenen, drei Regelwerke

Der eigentliche Konstruktionsfehler ist nicht die Farbwahl, sondern dass **eine Palette drei Aufgaben erledigen muss**. Sie sind zu trennen:

| Ebene | Aufgabe | Wechselt mit dem Theme? | Anzahl Farben |
|---|---|---|---|
| **1 · Marke** | Wiedererkennung, Kopfzeile, Knöpfe, Akzent | **ja** — das ist der Sinn der 7 Themes | 1 Akzent + Chrome |
| **2 · Bedeutung** | „Soll ich hier hinschauen?" — Rentabilität, Auslastung, Fälligkeit | **nein**, nur hell/dunkel angepasst | 4 KPI-Stufen + 2 Delta |
| **3 · Daten** | Reihen in Diagrammen unterscheiden | **nein**, nur hell/dunkel angepasst | 6 kategorial + 1 divergierend |

Warum Ebene 2 und 3 theme-fest sein müssen: Ein Nutzer, der im Tragwerk-Theme lernt, dass Orange „knapp" heißt, darf diese Bedeutung nicht verlieren, wenn ein Kollege das TGA-Theme eingestellt hat und sie gemeinsam auf einen Bildschirm schauen. Bedeutungsfarben sind Vokabular, nicht Dekoration. Genau deshalb bekommen sie eigene Tokens und nicht `--accent`.

Das ist zugleich die Antwort auf die „psychologische Wirkung": **sie steckt in Ebene 2 und 3.** Ebene 1 ist Geschmack mit Kontrast-Nebenbedingung.

---

## 4 · Ebene 2 — Bedeutungsfarben fürs Controlling

### 4.1 Das Problem: Rot ist im Controlling zweideutig

In der Buchhaltung heißt Rot „negativ". In einem Projektcontrolling heißt Rot aber je nach Spalte etwas völlig anderes:

| Kennzahl | Hoher Wert ist … | Farbe heute |
|---|---|---|
| Deckungsbeitrag | gut | grün/rot nach Vorzeichen |
| Kosten | neutral — sie sind geplant | rot (`kosten` in `useSeriesColors`) |
| Offene Forderungen | schlecht ab Fälligkeit | rot |
| Fertigstellungsgrad | neutral | — |
| Auslastung | **beides** — 60 % ist schlecht, 110 % ist auch schlecht | — |

Die Reihe „Kosten" ist heute rot eingefärbt, obwohl geplante Kosten kein Fehler sind. Das ist genau die Alarmmüdigkeit aus §2: Wenn Kosten immer rot sind, verliert Rot seine Warnwirkung für die Fälle, in denen wirklich etwas schiefläuft.

**Regel: Rot markiert Handlungsbedarf, nicht Negativität.** Kosten sind keine Warnung. Ein Deckungsbeitrag von −2 % bei einem Projekt in Phase 2 ist keine Warnung. Eine seit 45 Tagen überfällige Schlussrechnung ist eine.

### 4.2 Vier Stufen statt Ampel

Die klassische dreistufige Ampel zwingt jede Kennzahl in „gut / mittel / schlecht" und produziert dadurch zu viel Gelb. Vier Stufen bilden Controlling-Zustände sauberer ab — und die Zwischenstufe ist bewusst **blau, nicht gelb**, damit „läuft nach Plan" nicht wie eine abgeschwächte Warnung aussieht:

```css
/* Ebene 2 — Controlling-Semantik. Theme-unabhängig, nur hell/dunkel. */
--kpi-good:     #127035;   /* über Ziel                                        */
--kpi-plan:     #1d6883;   /* im Plan — bewusst petrol, keine Abstufung von Gelb */
--kpi-watch:    #8f5206;   /* beobachten — Abweichung ohne Handlungsdruck      */
--kpi-critical: #b91c1c;   /* Handlungsbedarf — jetzt, nicht im Quartal        */
```

Die Werte sind gegen **alle 18 hellen Theme-Untergründe** gerechnet (Karte,
Seitengrund und Zebrastreifen je Theme), nicht nur gegen das Standard-Theme.
Drei der vier naheliegenden Töne fielen dabei durch:

| Token | naheliegend | schlechtester Grund | endgültig | jetzt |
|---|---|---|---|---|
| `--kpi-good` | `#15803d` | 3,76 ✗ | `#127035` | 4,63 ✓ |
| `--kpi-plan` | `#1f6f8b` | 4,24 ✗ | `#1d6883` | 4,68 ✓ |
| `--kpi-watch` | `#a15c07` | 3,88 ✗ | `#8f5206` | 4,66 ✓ |
| `--kpi-critical` | `#b91c1c` | 4,84 ✓ | `#b91c1c` | 4,84 ✓ |

Im Dark-Theme aufgehellt, alle ≥ 5,52:1 auf den drei dunklen Flächen:

```css
[data-theme="dark"] {
  --kpi-good: #4ade80;  --kpi-plan: #7cc4dd;
  --kpi-watch: #fbbf24; --kpi-critical: #f87171;
}
```

**Es gibt bewusst keine Stufe „grün" in der Praxis.** `--kpi-good` existiert als
Token, wird von `cpiLevel()` aber nie vergeben: Ein Projekt, das seine Kosten
deckt, ist der Normalfall und keine Auszeichnung. Färbte man jede gesunde Zeile
grün, wäre die Liste bunt und Rot verlöre seine Wirkung — genau die
Alarmmüdigkeit aus §2. Markiert wird nur, was Aufmerksamkeit braucht.

### 4.3 Die Schwellen gehören nicht in den Code

Wann ein Projekt „beobachten" ist, ist eine kaufmännische Entscheidung des Büros, keine Konstante. Ein Generalplaner rechnet mit anderen Margen als ein Zwei-Personen-Büro. Vorher standen die Grenzen als `0.95` / `0.80` fest in `projectForecasting.ts`.

Jetzt liegen sie als `TENANT_SETTINGS` unter Einstellungen → Vorbelegungen → Controlling-Ampel (keine Migration nötig, siehe CLAUDE.md):

```
kpi_cpi_watch_threshold      Standard 0,95   → ab hier „im Plan"
kpi_cpi_critical_threshold   Standard 0,80   → ab hier „beobachten"
```

**Abweichung von der WIP-Regel, bewusst:** Beim Report „Teilfertige Leistungen" heißt „nichts gepflegt" = „Spalte bleibt aus", weil dort sonst eine erfundene Zahl behauptet würde. Hier existierte die Einfärbung schon — sie bei ungepflegter Einstellung wegzunehmen wäre ein Rückschritt, kein Schutz vor Falschaussagen. Ungepflegt heißt deshalb: die bisherigen Werte gelten weiter.

Unplausible Eingaben fallen auf den Standard zurück, statt die Ampel mit einer kaputten Grenze zu betreiben. Insbesondere muss `critical` unter `watch` liegen — sonst wäre die mittlere Stufe leer und ein Projekt spränge von „im Plan" direkt auf „Handlungsbedarf". Geprüft in `kpiLevel.test.ts`.

### 4.4 Doppelkodierung ist Pflicht

Jede farbcodierte Aussage braucht einen zweiten Kanal. Umgesetzt in `components/ui/KpiValue.tsx`:

- **Symbol** bei den markierten Stufen (`TrendingDown` für „beobachten", `TriangleAlert` für „Handlungsbedarf") — bewusst keins bei „im Plan": ein Zeichen in jeder Zeile ist kein Signal mehr
- **Klartext im `title`**, samt Begründung („beobachten: CPI 0,84 bei Schwelle 0,95 / 0,80") — trägt Maus-Hover und Screenreader gleichermaßen
- **`.sr-only`-Text** mit der Stufe, weil `title` allein nicht von jeder Kombination aus Screenreader und Browser vorgelesen wird

Das ist nicht nur Barrierefreiheit: Ein Wert mit Symbol ist auch für Normalsichtige im Augenwinkel schneller erfassbar als ein Farbwechsel.

### 4.5 Negative Beträge — „rote Zahlen"

Getrennt von der Ampel, aber derselben Ebene zugehörig: **ein negativer Betrag wird rot gesetzt.** Das ist die älteste und stabilste Konvention im Rechnungswesen (§2) und keine Bewertung — sie sagt nichts über Handlungsbedarf, nur über das Vorzeichen.

Sie war im Reporting an genau **einer** Stelle umgesetzt (Deckungsbeitrag im Leistungsphasen-Report). Überall sonst standen negative Beträge schwarz; „Abrechenbar" stand bei Überzahlung sogar blau, weil die Spalte pauschal die Akzentfarbe trug.

`utils/money.ts` stellt zwei Helfer bereit:

```ts
negativeStyle(v)              // rot, wenn v < 0 — sonst nichts
negativeOr(v, 'var(--accent)') // rot bei v < 0, sonst die vorhandene Farbe
```

**Warum `--kpi-critical` und nicht `--danger`:** Ein negativer Betrag ist keine Fehlermeldung. `--danger` heißt „Fehler / löschen"; die Controlling-Farbe gehört zu Ebene 2 und ist gegen alle Theme-Untergründe geprüft. Die bestehende `--danger`-Verwendung im Leistungsphasen-Report ist mitgezogen, damit es nicht zwei fast identische Rottöne für dieselbe Aussage gibt.

**Zweiter Kanal ist das Minuszeichen** — es steht immer im formatierten Text. Deshalb hier kein zusätzliches Symbol wie bei der Ampel; WCAG 1.4.1 ist damit erfüllt.

Umgesetzt in allen sieben Reporting-Ansichten (Projektliste, Einzelprojekt, Leistungsphasen-Report und -Matrix, Teilfertige Leistungen, Trends, Unternehmenskennzahlen). Die Grenze ist `< 0`, nicht `<= 0`: Null ist kein Verlust, sonst wäre jede leere Spalte rot. Geprüft in `money.test.ts`.

**Wo die Ampel steht.** Ersetzt wurden die fünf Stellen, an denen bereits eingefärbt wurde — dieselbe Ampel lag fünfmal als hartkodiertes `#16a34a`/`#b45309`/`#b91c1c` im TSX:

| Datei | Stelle |
|---|---|
| `daten/ProjektlisteTab.tsx` | Spalten CPI und VAC, samt Summenzeile |
| `daten/EinzelprojektTab.tsx` | Prognose-Karte und Leistungsphasen-Tabelle |
| `DashboardPage.tsx` | Projekt-Detaildialog und Risiko-Ansicht |

Bewusst **keine neuen** eingefärbten Orte: Wo heute keine Ampel steht, ist das eine Produktentscheidung und keine Aufräumarbeit.

## 5 · Ebene 3 — Diagrammfarben

### 5.1 Befund: der aktuelle Satz ist nicht CVD-tauglich

`SERIES_LIGHT` in `theme/chartTheme.ts`, simuliert nach Viénot (1999), kleinster Farbabstand ΔE zwischen zwei Reihen:

| Sicht | kleinster Abstand | betroffenes Paar |
|---|---|---|
| Normalsicht | 36,4 ✓ | `#3b82f6` / `#8b5cf6` |
| Protanopie | **6,6** ✗ | `#f59e0b` / `#84cc16` |
| **Deuteranopie** | **1,1** ✗ | `#3b82f6` / `#8b5cf6` |
| Tritanopie | **7,9** ✗ | `#10b981` / `#06b6d4` |

ΔE = 1,1 heißt: **identisch.** Die betroffenen Farben sind in `useSeriesColors` `db` (Deckungsbeitrag) und `stunden` — zwei Reihen, die im Reporting regelmäßig im selben Diagramm stehen. Für rund 8 % der männlichen Nutzer ist die Deckungsbeitragskurve dort nicht von der Stundenkurve zu trennen. `SERIES_DARK` hat denselben Fehler (ΔE 2,2).

### 5.2 Vorschlag: Okabe-Ito als Basis

Okabe-Ito (auch „Wong-Palette", empfohlen von *Nature Methods*) ist der etablierte CVD-sichere Satz. Gemessen mit denselben Schwellen, sechs Reihen ohne Gelb und Schwarz:

```
#0072b2  Blau        Honorar / Deckungsbeitrag
#009e73  Grün        Leistung (Leistungsstand, Leistungswert)
#e69f00  Orange      Auftragsbestand / Stunden
#cc79a7  Purpur      fakturiert / abgerechnet
#56b4e9  Himmelblau  bezahlt
#d55e00  Zinnober    Kosten
```

**Sechs Farben, sieben Kennzahlen.** Der Satz lässt sich nicht einfach
erweitern: Okabe-Ito hat acht Farben, aber Gelb (`#f0e442`) liegt auf weißem
Grund bei 1,1:1 und Schwarz ist die Achsenfarbe — als Linienfarbe fällt beides
aus, und eine selbst erfundene siebte Farbe zerstört die CVD-Abstände (§5.3).
Zwei Paare teilen sich deshalb je eine Farbe. Die Regel dafür ist nicht
„irgendwelche zwei", sondern: **geteilt wird nur, was nie im selben Diagramm
steht.** Honorar (Vertragswert im Projektverlauf) und Deckungsbeitrag
(Ergebnis in den Trends) kommen nie zusammen vor, Auftragsbestand und Stunden
ebenso wenig.

Die Zuordnung steht als `SERIES_ROLE` in `chartTheme.ts` und wird über
`useSeriesColors()` abgerufen — nie über `series[3]`: Der Index sagt nicht,
was er bedeutet, und verschiebt sich beim nächsten Umbau. `chartTheme.test.ts`
führt alle Diagramme mit ihren Reihen auf und lässt jede Kollision
fehlschlagen.

### 5.2a Der teuerste Fehler der Umstellung: `var(--token)` auf dem Canvas

Chart.js zeichnet auf ein `<canvas>`. Dort ist `var(--token)` **kein**
Farbwert — der Browser meldet nichts und nimmt Schwarz. Bei der Umstellung auf
Tokens (§7) wurden die Serienfarben von Projektverlauf, Gesamtverlauf und
Übersicht mit umgeschrieben; aus fünf farbigen Linien wurden fünf schwarze,
Legendenpunkte inklusive.

Bemerkenswert ist, warum nichts davon aufgefallen ist:

- Die Hex-Regel aus §7 hat die Umschreibung nicht nur zugelassen, sondern
  **verlangt** — sie kannte die Ausnahme „Canvas" nur für `chartTheme.ts`.
- `tsc` sah einen `string` und war zufrieden.
- Die Kontrastprüfung liest CSS und kennt kein Canvas.
- Die Playwright-Fixture mockte den Zeitreihen-Endpunkt nicht; das Diagramm
  rendert im Test also gar nicht.

Vier Prüfungen, vier blinde Flecken, exakt an derselben Stelle. Daraus drei
Ergänzungen: `check:design` prüft jetzt die Gegenrichtung mit (jede
CSS-Variable an einer Chart.js-Farboption in einer Diagrammdatei ist ein
Befund — das fand sofort eine dritte, noch nicht gemeldete Stelle auf der
Übersicht), `tests/charts.spec.ts` zählt die Farbtöne auf dem fertigen Canvas,
und die Fixture liefert eine Zeitreihe, damit im Test überhaupt ein Diagramm
entsteht.

Die allgemeine Lehre daneben: Eine Regel, die auf *Schreibweise* prüft
(„kein Hex"), braucht immer die Gegenprüfung auf *Wirkung* („kommt Farbe
heraus"). Sonst verlagert sie den Fehler nur.

| Sicht | kleinster Abstand |
|---|---|
| Normalsicht | 26,4 ✓ |
| Protanopie | 23,2 ✓ |
| Deuteranopie | 16,6 ✓ |
| Tritanopie | 10,9 ⚠ (`orange` / `purpur`) |

**Der Tritanopie-Wert ist eine bewusst akzeptierte Schwäche**, keine Nachlässigkeit: Ich habe fünf Ersatzfarben für `purpur` durchgerechnet — jede verbessert Tritanopie und verschlechtert dabei Protanopie oder Deuteranopie deutlich (bester Alternativkandidat `#7a52c7`: Deuteranopie fällt von 16,6 auf 9,8). Tritanopie betrifft etwa 0,01 % der Bevölkerung, Rot-Grün-Schwäche das 800-Fache. Der Tausch wäre ein schlechtes Geschäft. Okabe-Ito selbst hat dieselbe Schwachstelle.

### 5.3 Warum die Reihen *nicht* auf 3:1 gezogen werden

Naheliegender Reflex: alle Reihenfarben so weit abdunkeln, dass sie auf Weiß 3:1 erreichen. Das habe ich gerechnet — es zerstört die Palette. Okabe-Ito trennt gerade *über* Helligkeitsunterschiede; zieht man alle Farben auf ein Helligkeitsband, fällt der Protanopie-Abstand von 23,2 auf **0,0** (Ocker und Zinnober werden identisch). Man kann nicht beides haben.

Auflösung über die Verwendung statt über die Farbe:

- **Flächen** (Balken, gestapelte Bereiche, Tortensegmente): Vollton wie oben, plus 1px Rand in `--surface`. Große Flächen mit Legende daneben brauchen keine 3:1 gegen den Grund.
- **Dünne Linien und Punkte** (Liniendiagramm, Streuung): abgedunkelte Variante derselben Farbe. Diese Marken sind auf 1–2 px angewiesen und fallen unter WCAG 1.4.11.

Das Skript weist die betroffenen Farben aus (`⚠ unter 3:1 … nur als Fläche mit Rand, nicht als 1px-Linie`).

### 5.4 Abweichungen: divergierend Blau ↔ Orange, nicht Rot ↔ Grün

Für Heatmaps und Abweichungsbalken (Plan/Ist, Auslastung über/unter 100 %) ist Rot-Grün die schlechteste mögliche Wahl — genau in der Mitte des Verwechslungsbereichs. Blau-Orange ist der Standardersatz und für alle CVD-Formen trennbar:

```
#08519c  #4292c6  #c6dbef  #f0f0f0  #fdd0a2  #fd8d3c  #a63603
   ←── unter Plan ──        neutral        ── über Plan ──→
```

Endpunkte als Text auf Weiß: 7,87:1 und 6,67:1 — beide AA-tauglich, falls die Skala auch beschriftete Werte trägt.

**Wichtig zur Abgrenzung:** Das ersetzt nicht Rot/Grün bei *Vorzeichen*. `−12.400 €` bleibt rot, das ist die gelernte Konvention aus §2 und wird durch das Vorzeichen doppelkodiert. Die divergierende Skala ist für Flächen, die nebeneinander liegen und ohne Zahl gelesen werden.

---

## 6 · Ebene 1 — vier Markenpaletten zur Auswahl

Alle vier sind vollständig durchgerechnet; jedes Token-Paar der Prüfliste aus §7 liegt über der Schwelle. Sie ersetzen das heutige `light`-Theme; die fünf Branchen-Themes bleiben unangetastet.

### 6.2 · Palette C ist zurückgesetzt — was die Vorschau nicht gezeigt hat

C war vom 6. bis 8. September im Produkt und ist zurückgenommen. Drei Rückmeldungen,
alle in dieselbe Richtung:

1. **„Der weiße Hintergrund sah insgesamt besser aus, jetzt ist alles so grau."**
   `--bg` ging von `#f4f6fb` (fast weiß) auf `#eef2f7` und `--surface-2` von
   `#f8f9fb` auf `#e3e9f1`. In der Vorschau war das ein Ausschnitt; über eine ganze
   Arbeitsfläche summiert es sich zu einem spürbar grauen Eindruck.
2. **„Das Blau ist zu dunkel."** `#1b4f8f` statt `#2563eb`.
3. **„Auf dem Handy ist die Menüleiste ausgeblendet."** Ein funktionaler Bruch ließ
   sich nicht reproduzieren — die Leiste rendert mit sechs erreichbaren Einträgen.
   Die wahrscheinliche Ursache ist die Farbe: `syncThemeColor()` schreibt `--chrome`
   nach `<meta name="theme-color">`, und damit färbte sich auf dem Handy die
   Browserleiste dunkelblau. Zusammen mit der ebenfalls dunklen Bottom-Navigation
   entsteht unten ein durchgehendes dunkles Band, in dem die Leiste nicht mehr als
   eigenes Bedienelement zu erkennen ist.

**Was daraus zu lernen ist — der Fehler lag in der Methode, nicht im Farbwert.**
Die Vorschau zeigte einen Ausschnitt auf hellem Papiergrund, bei 1280 px, ohne
Systemleiste. Drei Dinge, die eine solche Vorschau nicht zeigen kann und die man
deshalb vorher direkt in der App prüfen muss:

- **Flächenwirkung.** Ein grauer Grund wirkt auf 200 px anders als auf einem
  ganzen Bildschirm voller Listen.
- **Die Systemleiste.** `theme-color` ist Teil der Palette, taucht aber in keinem
  Screenshot der App auf.
- **Das Handy überhaupt.** Die Vorschau war eine Desktop-Ansicht.

Praktisch heißt das: Der nächste Palettenversuch läuft **zuerst als Theme neben
den bestehenden**, wird auf einem echten Gerät benutzt und ersetzt den Standard
erst danach — nicht umgekehrt.

**Was bleibt.** Alles außer den Markenfarben: die Navigations-Korrektur (§6.1),
die Controlling-Ampel (§4), die Geld-Konvention (§4.5), die Diagrammfarben (§5)
und die Prüfregeln (§7). Der inaktive Navigationstext liegt auch im
zurückgesetzten hellen Theme auf 7:1 (`#56575c` statt `#72747a`).

---

### 6.1 · Der Navigationstext — gefunden beim Ansehen, nicht beim Rechnen

Beim Durchklicken der Palettenvorschau fiel auf, dass der Navigationstext auf der
dunklen Kopfzeile schwer zu lesen ist. Die Messung zeigte: Das war **kein Problem
von Palette C**, sondern eines aller sieben Themes.

| Theme | inaktiver Nav-Text vorher | nachher |
|---|---|---|
| Hell | 4,67 | — (Kopfzeile ist jetzt dunkel, neuer Wert 7,05) |
| Dunkel | 4,68 | 7,10 |
| Architektur | 4,61 | 7,07 |
| Tiefbau | 4,66 | 7,04 |
| Stadt und Verkehr | 4,63 | 7,01 |
| TGA | 4,62 | 7,02 |
| Tragwerk | 4,67 | 7,02 |

Alle sieben lagen zwischen 4,61 und 4,68 — **exakt auf die AA-Schwelle getrimmt**.
Das ist kein Zufall, sondern das Ergebnis einer früheren Korrektur, die auf 4,5
optimiert hat statt auf Lesbarkeit. 4,5:1 ist die Untergrenze für Fließtext, kein
Ziel für 11–13-px-Label auf dunklem Grund. Palette C lag mit 5,53 sogar besser als
alles im Produkt und war trotzdem schwer lesbar.

**Die Lösung nutzt, was schon da war.** Der aktive Eintrag hat in `SideNav.tsx`
längst einen Balken links in `--nav-active`. Der Balken kann die Identität tragen,
dann muss die Schriftfarbe es nicht:

- aktives Label → `--chrome-text` (weiß; 7,7–15,8:1 je nach Theme)
- inaktive Label → 7:1 statt 4,6
- Balken bleibt `--nav-active`, die Akzentfarbe ist also weiter sichtbar

Die Bottom-Navigation hat dieselbe Behandlung bekommen, mit dem Balken oben statt
links. Dort war der aktive Zustand vorher **reine Farbe** — nach dem Anheben des
inaktiven Texts wäre er in fünf Themes sogar dunkler gewesen als seine Nachbarn.
Zugleich war das ein WCAG-1.4.1-Verstoß, den bis dahin niemand gemeldet hatte.

Damit es nicht zurückfällt, verlangt `check-design-system.mjs` für
`--nav-inactive` jetzt **7:1** statt 4,5:1.

---

### 6.0 · Eine Nebenbedingung, die vor der Geschmacksfrage kommt

Wenn Ebene 2 (§4) eingeführt wird, darf der Markenakzent nicht wie eine Bedeutungsfarbe aussehen. Ein Knopf in derselben Farbe wie „im Plan" wird als Statusanzeige gelesen. Gemessener Farbabstand ΔE zwischen Akzent und der nächstliegenden KPI-Farbe:

| Palette | Akzent | nächste KPI-Farbe | ΔE |
|---|---|---|---|
| A · Kontor | `#0e5a6e` | `--kpi-plan` | **7,1** ✗ |
| B · Reißbrett | `#33556e` | `--kpi-plan` | **10,8** ✗ |
| **C · Blaupause** | `#1b4f8f` | `--kpi-plan` | **28,5** ✓ |
| D · Bilanz | `#0f6b5c` | `--kpi-good` | 26,6 ✓ |
| *heute* | `#2563eb` | `--kpi-plan` | 68,4 ✓ |

A und B sind damit nicht ausgeschlossen — aber sie kosten eine Zusatzentscheidung: `--kpi-plan` müsste von Petrol weg, etwa auf ein kühleres `#2a5fa5`. Das ist machbar, verschiebt aber die Bedeutungsebene wegen einer Geschmacksfrage — und die steht seit Block 2 im Produkt. C und D brauchen das nicht.

### A · „Kontor" — Petrol + Kupfer

Kaufmännisch-warm. Petrol als Struktur, Kupfer als CTA — ein Kontrastpaar, das die Hauptaktion herausspringen lässt, ohne dass die Fläche unruhig wird. Nächste Verwandtschaft zum bestehenden TGA-Theme. **Kollidiert mit `--kpi-plan`** (ΔE 7,1, §6.0) — bei dieser Wahl muss die KPI-Zwischenstufe ausweichen.

```css
:root {
  --bg: #f2f5f6;  --surface: #ffffff;  --surface-2: #e8edef;  --surface-3: #f2f5f6;
  --text: #16232b;
  --text-2: rgba(22,35,43,0.74);  --text-3: rgba(22,35,43,0.66);
  --text-4: rgba(22,35,43,0.52);  --text-5: rgba(22,35,43,0.38);
  --border: rgba(22,35,43,0.10);  --border-2: rgba(22,35,43,0.08);
  --border-3: rgba(22,35,43,0.06); --border-4: rgba(22,35,43,0.05);
  --accent: #0e5a6e;  --accent-dark: #0a4557;
  --accent-bg: #e6f2f5; --accent-bg2: #cfe6ec;
  --accent-tint: rgba(14,90,110,0.04);  --accent-tint2: rgba(14,90,110,0.08);
  --accent-tint3: rgba(14,90,110,0.10); --accent-ring: rgba(14,90,110,0.28);
  --accent-rgb: 14,90,110;
  --chrome: #16232b;  --chrome-text: #ffffff;  --chrome-icon: rgba(255,255,255,0.68);
  --chrome-hover-bg: rgba(255,255,255,0.10); --chrome-border: rgba(255,255,255,0.08);
  --nav-active: #7fc4d4;  --nav-inactive: #8fa3ab;
  --btn: #16232b;  --btn-h: #24363f;
  --cta: #a85528;  --cta-h: #8c451f;
  --hover-bg: rgba(22,35,43,0.06);  --shadow-color: 22,35,43;
  --dim: rgba(22,35,43,0.04);  --dim-2: rgba(22,35,43,0.025);
}
```

| Paar | Wert |
|---|---|
| `--text` auf `--bg` | 14,64 ✓ |
| `--accent` als Text auf `--surface` | 7,76 ✓ |
| `--accent` als Text auf `--surface-2` | 6,57 ✓ |
| `#fff` auf `--cta` | 5,26 ✓ |
| `--nav-inactive` auf `--chrome` | 6,11 ✓ |

### B · „Reißbrett" — Graphit + gedecktes Stahlblau

Die konsequenteste Umsetzung des Recherche-Befunds „ruhige Struktur, Farbe nur für Daten". Warmneutraler Papiergrund, Graphit-Chrome, ein einziger zurückgenommener Akzent. Wirkt am wenigsten nach „Software", am meisten nach Werkzeug — und lässt die KPI-Farben aus §4 maximal wirken, weil sie die einzige Sättigung auf dem Schirm sind. Zwei Nachteile: geringste Wiedererkennung, im Screenshot-Vergleich mit Wettbewerbern der unauffälligste — und **Kollision mit `--kpi-plan`** (ΔE 10,8, §6.0), dieselbe Ausweichentscheidung wie bei A.

```css
:root {
  --bg: #f5f5f4;  --surface: #ffffff;  --surface-2: #ececea;  --surface-3: #f5f5f4;
  --text: #1c1c1a;
  --text-2: rgba(28,28,26,0.72);  --text-3: rgba(28,28,26,0.63);
  --text-4: rgba(28,28,26,0.49);  --text-5: rgba(28,28,26,0.38);
  --border: rgba(28,28,26,0.11);  --border-2: rgba(28,28,26,0.08);
  --border-3: rgba(28,28,26,0.06); --border-4: rgba(28,28,26,0.04);
  --accent: #33556e;  --accent-dark: #27435a;
  --accent-bg: #eaeff4; --accent-bg2: #d5e0e9;
  --accent-tint: rgba(51,85,110,0.04);  --accent-tint2: rgba(51,85,110,0.08);
  --accent-tint3: rgba(51,85,110,0.10); --accent-ring: rgba(51,85,110,0.28);
  --accent-rgb: 51,85,110;
  --chrome: #26262b;  --chrome-text: #ffffff;  --chrome-icon: rgba(255,255,255,0.68);
  --chrome-hover-bg: rgba(255,255,255,0.09); --chrome-border: rgba(255,255,255,0.08);
  --nav-active: #8fb3cc;  --nav-inactive: #96969e;
  --btn: #26262b;  --btn-h: #37373e;
  --cta: #33556e;  --cta-h: #27435a;
  --hover-bg: rgba(28,28,26,0.06);  --shadow-color: 28,28,26;
  --dim: rgba(28,28,26,0.04);  --dim-2: rgba(28,28,26,0.025);
}
```

| Paar | Wert |
|---|---|
| `--text` auf `--bg` | 15,65 ✓ |
| `--accent` als Text auf `--surface` | 7,88 ✓ |
| `#fff` auf `--cta` | 7,88 ✓ |
| `--nav-inactive` auf `--chrome` | 5,13 ✓ |

### C · „Blaupause" — Cyanotypie-Blau ⭐ Empfehlung

Das Blau, das die Recherche als B2B-Erwartung nahelegt — aber in der Variante, die dieser Zielgruppe gehört: der Ton der Blaupause. Es löst das Austauschbarkeitsproblem aus §2, ohne die Vertrauens-Konvention aufzugeben: kein `blue-600` aus dem Framework, sondern eine Farbe mit Herkunft aus dem Planungshandwerk. Kühler Papiergrund, tiefe Nachtblau-Chrome.

```css
:root {
  --bg: #eef2f7;  --surface: #ffffff;  --surface-2: #e3e9f1;  --surface-3: #eef2f7;
  --text: #10233d;
  --text-2: rgba(16,35,61,0.74);  --text-3: rgba(16,35,61,0.66);
  --text-4: rgba(16,35,61,0.52);  --text-5: rgba(16,35,61,0.38);
  --border: rgba(16,35,61,0.11);  --border-2: rgba(16,35,61,0.08);
  --border-3: rgba(16,35,61,0.06); --border-4: rgba(16,35,61,0.04);
  --accent: #1b4f8f;  --accent-dark: #143a6b;
  --accent-bg: #e8eefa; --accent-bg2: #cfdcf3;
  --accent-tint: rgba(27,79,143,0.04);  --accent-tint2: rgba(27,79,143,0.08);
  --accent-tint3: rgba(27,79,143,0.10); --accent-ring: rgba(27,79,143,0.28);
  --accent-rgb: 27,79,143;
  --chrome: #10233d;  --chrome-text: #ffffff;  --chrome-icon: rgba(255,255,255,0.68);
  --chrome-hover-bg: rgba(255,255,255,0.10); --chrome-border: rgba(255,255,255,0.08);
  --nav-active: #8ab4e8;  --nav-inactive: #8e9aab;
  --btn: #10233d;  --btn-h: #1d3654;
  --cta: #1b4f8f;  --cta-h: #143a6b;
  --hover-bg: rgba(16,35,61,0.06);  --shadow-color: 16,35,61;
  --dim: rgba(16,35,61,0.04);  --dim-2: rgba(16,35,61,0.025);
}
```

| Paar | Wert |
|---|---|
| `--text` auf `--bg` | 14,05 ✓ |
| `--accent` als Text auf `--surface` | 8,20 ✓ |
| `--accent` als Text auf `--surface-2` | 6,71 ✓ |
| `#fff` auf `--cta` | 8,20 ✓ |
| `--nav-inactive` auf `--chrome` | 5,53 ✓ |

**Warum diese als Empfehlung:** Sie bedient die belegbare Konvention (Blau im B2B/Finanzkontext ist erwartungskonform), löst zugleich das Austauschbarkeitsproblem aus §2 (Herkunft statt Framework-Vorgabe) und hat mit ΔE 28,5 den größten Abstand aller vier zur nächsten KPI-Farbe (§6.0) — sie erzwingt als einzige *keine* Folgeentscheidung auf der Bedeutungsebene.

### D · „Bilanz" — Petrolgrün + Sand

Grün trägt im Finanzumfeld die Assoziation Wachstum/Ertrag; als gedecktes Petrolgrün auf Sandgrund wirkt es wertiger als das übliche Fintech-Grün.

```css
:root {
  --bg: #f5f4f0;  --surface: #ffffff;  --surface-2: #eceae3;  --surface-3: #f5f4f0;
  --text: #1b2a28;
  --text-2: rgba(27,42,40,0.74);  --text-3: rgba(27,42,40,0.66);
  --text-4: rgba(27,42,40,0.52);  --text-5: rgba(27,42,40,0.38);
  --border: rgba(27,42,40,0.11);  --border-2: rgba(27,42,40,0.08);
  --border-3: rgba(27,42,40,0.06); --border-4: rgba(27,42,40,0.04);
  --accent: #0f6b5c;  --accent-dark: #0b5347;
  --accent-bg: #e5f2ef; --accent-bg2: #c8e4dd;
  --accent-tint: rgba(15,107,92,0.04);  --accent-tint2: rgba(15,107,92,0.08);
  --accent-tint3: rgba(15,107,92,0.10); --accent-ring: rgba(15,107,92,0.28);
  --accent-rgb: 15,107,92;
  --chrome: #1b2a28;  --chrome-text: #ffffff;  --chrome-icon: rgba(255,255,255,0.68);
  --chrome-hover-bg: rgba(255,255,255,0.10); --chrome-border: rgba(255,255,255,0.08);
  --nav-active: #6ec8b4;  --nav-inactive: #98a3a1;
  --btn: #1b2a28;  --btn-h: #2b403d;
  --cta: #0f6b5c;  --cta-h: #0b5347;
  --hover-bg: rgba(27,42,40,0.06);  --shadow-color: 27,42,40;
  --dim: rgba(27,42,40,0.04);  --dim-2: rgba(27,42,40,0.025);
}
```

| Paar | Wert |
|---|---|
| `--text` auf `--bg` | 13,55 ✓ |
| `--accent` als Text auf `--surface` | 6,41 ✓ |
| `#fff` auf `--cta` | 6,41 ✓ |
| `--nav-inactive` auf `--chrome` | 5,74 ✓ |

**Einschränkung, die vor der Wahl bekannt sein sollte:** Der gemessene Abstand zu `--kpi-good` ist mit ΔE 26,6 unkritisch — das Problem ist nicht Verwechslung, sondern **Konnotation**. Grün ist in der Anwendung als „erledigt / bezahlt / gebucht" belegt; ein grüner „Speichern"-Knopf liest sich für den Bruchteil einer Sekunde wie eine Erfolgsmeldung. Das ist ein weicheres Argument als die Zahlenkollision bei A und B, aber es ist eins.

---

## 7 · Prüfregeln

Ergänzt die bestehenden Design-Token-Regeln in CLAUDE.md. Alle Regeln sind maschinell geprüft durch `frontend-react/scripts/check-design-system.mjs` (`npm run check:design`), das bereits im CI-Job `frontend-typecheck` läuft.

*Ursprünglich stand hier ein eigenes Skript `color-check.mjs`. Das war ein Duplikat — die Kontrastprüfung gab es schon. Die neuen Prüfungen sind in den bestehenden Prüfer eingebaut, das Zweitskript ist gelöscht.*

**Kontrast** — jedes Paar aus der Liste in `PAIRS` muss in **jedem** Theme über der Schwelle liegen, nicht nur im Default. Neu gegenüber heute: `--accent` wird auch gegen `--surface-2` geprüft (Zebrastreifen in Tabellen — dort steht Akzenttext, und vier Themes fallen aktuell durch), und `--nav-inactive` gegen `--chrome`.

**Farbabstand** — zwei Diagrammreihen müssen nach Simulation für Protanopie und Deuteranopie mindestens ΔE 15 auseinanderliegen. Tritanopie wird ausgewiesen, aber nicht erzwungen (Begründung §5.2).

**Doppelkodierung** — keine Aussage allein über Farbe (§4.4).

**Rot-Sparsamkeit** — `--kpi-critical` und `--danger` nur bei Handlungsbedarf. Kein rotes Dauerelement in Listen. Die Kostenreihe trägt Zinnober (`#d55e00`), nicht die Fehlerfarbe: Abstand ΔE 30 zu `--danger` `#bd2121`. Ein wirklich neutrales Grau wäre semantisch noch sauberer, kollidiert im Dark-Theme aber mit der Purpur-Reihe (ΔE 6,2 bei Deuteranopie) — gemessen, verworfen.

**Ist-Zustand beim Anlegen dieses Konzepts** — 22 Verstöße, gefunden erst durch
die neuen Prüfungen:

```
6 Themes: --accent als Text auf --surface-2   4,13 – 4,28
6 Themes: --success/--danger/--warning als Text auf getöntem --bg   3,96 – 4,47
SERIES_LIGHT: Deuteranopie dE=1,1 · Protanopie dE=6,6
SERIES_DARK:  Deuteranopie dE=2,2 · Protanopie dE=6,2
```

Der zweite Block war die Überraschung: Die Statusfarben stehen nur auf `:root`,
die Branchen-Themes haben aber getönte Hintergründe (`#efe8db`, `#e4ebf0`). Ein
Fehlertext lag dort bei 3,96:1. Selbst im Standard-Theme war `--danger` mit
4,47:1 knapp unter AA. Behoben durch drei global abgedunkelte Werte statt
fünfzehn Theme-Überschreibungen:

| Token | vorher | nachher | schlechtester Grund jetzt |
|---|---|---|---|
| `--success` | `#15803d` | `#126e34` | 4,76 ✓ |
| `--danger` | `#dc2626` | `#bd2121` | 4,62 ✓ |
| `--warning` | `#b45309` | `#9b4708` | 4,77 ✓ |

Dazu vier Branchen-Akzente farbtonerhaltend abgedunkelt (`#9d6046`→`#945a42`,
`#84633b`→`#7a5c37`, `#82682b`→`#796028`, `#856237`→`#7b5b33`).

**Es bleibt eine gemeldete Warnung**, und zwar absichtlich: Orange (`#e69f00`)
und Himmelblau (`#56b4e9`) liegen auf Weiß unter 3:1. Sie abzudunkeln würde den
Deuteranopie-Abstand von 16,2 auf 4,3 drücken (§5.3) — der Kompromiss wäre
schlechter als das Problem. Ausgeglichen wird am Verwendungsort: Flächen mit
Rand, Linien ab 3px (in `TrendsTab.tsx` umgesetzt).


---

## 8 · Umsetzung in Schritten

Bewusst so geschnitten, dass jeder Schritt für sich Nutzen bringt und die Palettenwahl **nicht** blockiert.

| # | Schritt | Umfang | Stand |
|---|---|---|---|
| 1 | Diagrammfarben auf Okabe-Ito umstellen (§5.2) | `theme/chartTheme.ts` | **erledigt** |
| 2 | Prüfregeln in den bestehenden Prüfer einbauen (§7) | `scripts/check-design-system.mjs` | **erledigt** |
| 3 | Kontrastbefunde beheben (Statusfarben, Branchen-Akzente) | 7 Token-Werte in `globals.css` | **erledigt** |
| 4 | Tote Theme-Blöcke entfernen | −178 Zeilen `globals.css` | **erledigt** |
| 5 | Backlog-Linie auf 3px (Ausgleich für §5.3) | `TrendsTab.tsx` | **erledigt** |
| 6 | KPI-Tokens einführen (§4.2), fünf hartkodierte Ampeln ersetzen | `globals.css`, `utils/kpiLevel.ts`, `ui/KpiValue.tsx`, 3 Seiten | **erledigt** |
| 7 | Schwellen als `TENANT_SETTINGS` (§4.3) | `VorbelegungenSection` | **erledigt** |
| 8 | Hilfetexte für die KPI-Ampel (`helpContent.tsx`) | 4 Einträge | **erledigt** |
| 8b | Negative Beträge rot in allen Reporting-Ansichten (§4.5) | `utils/money.ts` + 7 Ansichten | **erledigt** |
| 9 | **Gewählte Palette als neues `light`-Theme einsetzen** | 1 Token-Block | wartet auf Entscheidung |

Ein CI-Schritt war nicht nötig: `npm run check:design` läuft bereits im Job
`frontend-typecheck` und ist zusätzlich `build`-Voraussetzung.

Schritt 9 ist die einzige verbleibende Entscheidung. Die Ampel aus Schritt 6 wurde bewusst nur dort eingebaut, wo vorher schon eingefärbt wurde — sie an neuen Stellen zu zeigen ist eine Produktentscheidung und gehört in eine eigene Iteration.

**RBAC:** Keiner der Schritte legt einen mutierenden Endpunkt oder ein neues sichtbares Bedienelement an. Schritt 7 schreibt in `TENANT_SETTINGS` über den bestehenden `PUT /stammdaten/defaults` — die dort geltende Permission deckt das ab, eine neue ist nicht nötig.

---

## 9 · Was ich von dir brauche

1. ~~**Palette**~~ — C war entschieden und ist **zurückgesetzt** (§6.2). Offen ist
   damit wieder: A, B, D — oder beim heutigen Blau bleiben. Der nächste Versuch
   läuft als Theme daneben, nicht als Ersatz.
   Damit hat jedes der sieben Themes eine dunkle Kopfzeile. Das hat nebenbei die
   Wortmarken-Regel vereinfacht: Der Selektor `[data-theme]` nahm ausgerechnet das
   Default-Theme aus — mit dunkler Kopfzeile hätte dort der farbige Schriftzug
   dunkel auf dunkel gestanden.
2. ~~**Ersetzen oder ergänzen?**~~ — ersetzt. Bestandsnutzer sehen die Änderung;
   wer die alte helle Kopfzeile will, hat keine Entsprechung mehr. Das war die
   bewusste Entscheidung gegen ein achtes Theme in einer ohnehin langen Liste.
3. **Soll die Ampel an weitere Stellen?** Sie ersetzt derzeit nur die fünf Orte, an denen vorher schon eingefärbt wurde (§4.4). Kandidaten wären die Rechnungsliste (Fälligkeit) und die Kostenquote-Spalte — beides bräuchte eigene Schwellen und ist deshalb bewusst nicht mitgelaufen.

---

## Quellen

Recherche vom 05.09.2026.

- [Best Color Palettes for Financial Dashboards — Phoenix Strategy Group](https://phoenixstrategy.group/blog/best-color-palettes-for-financial-dashboards)
- [Psychology of color in financial app design — Windmill Digital](https://windmill.digital/insights/psychology-of-color-in-financial-app-design)
- [Farbe und Vertrauen: Blau in Banken und Tech-Unternehmen — Lazi Akademie](https://www.lazi-akademie.de/wiki/grundlagen-gestaltung/farbpsychologie/farbe-vertrauen/)
- [B2B Branding: Farbwelten für Ihre Marke — effecticore](https://www.effecticore.de/b2b-marketing-blog/marke-corporate-design/farbwelten-im-b2b-branding/)
- [Examining Data Viz Rules: Don't Use Red/Green Together — Tableau](https://www.tableau.com/blog/examining-data-viz-rules-dont-use-red-green-together)
- [Okabe-Ito Palette Hex Codes — Complete Reference](https://conceptviz.app/blog/okabe-ito-palette-hex-codes-complete-reference)
- [Colorblind-Friendly Palettes for Web Design — AudioEye](https://www.audioeye.com/post/colorblind-friendly-palettes/)
- [Performance Reporting: Traffic Light Colours and RAG Ratings — Bernard Marr](https://bernardmarr.com/performance-reporting-how-to-use-traffic-light-colours-and-rag-ratings-in-dashboards/)
- [Color Theory for Data Visualization Dashboards](https://coloracci.ai/blog/color-theory-for-data-visualization-dashboards)
- [Enterprise UI Design in 2026: Principles, Trends & Best Practices — Hashbyt](https://hashbyt.com/blog/enterprise-ui-design)
- [Accessible Color Tokens for Enterprise Design Systems — Aufait UX](https://www.aufaitux.com/blog/color-tokens-enterprise-design-systems-best-practices/)
- [accessible colours — data.europa.eu Data Visualisation Guide](https://data.europa.eu/apps/data-visualisation-guide/accessible-colours)

Simulation der Farbfehlsichtigkeit nach Viénot, Brettel & Mollon (1999), implementiert in `frontend-react/scripts/check-design-system.mjs`.
