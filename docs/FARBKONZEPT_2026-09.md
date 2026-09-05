# Farbkonzept plan&simple — September 2026

**Stand:** 05.09.2026 · **Branch:** `claude/projektcontrolling-color-palettes-n9tb7u` · **Basis:** 4.689 Zeilen `globals.css`, 11 Theme-Blöcke, 7 auswählbare Themes

Alle Kontrast- und Farbabstandswerte in diesem Dokument sind gerechnet, nicht geschätzt. Nachrechnen:

```bash
node frontend-react/scripts/color-check.mjs --series
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
| 3 | **Vier Themes verletzen den eigenen AA-Anspruch** in Details (Nav-Text, Akzent auf Zebrastreifen) | 4 von 11 Blöcken, 6 Paare | Mittel |

Empfehlung in einem Satz: **Ebenen trennen** (Marke / Bedeutung / Daten), die Bedeutungsebene neu und controlling-spezifisch bauen, und für die Markenebene aus vier durchgerechneten Paletten wählen — Vorschlag **C „Blaupause"**.

---

## 1 · Ausgangslage — was heute da ist

**11 Theme-Blöcke, 7 auswählbar** (`components/layout/ThemeOptions.tsx`): `light`, `dark` und fünf Branchen-Themes (Architektur, Tiefbau, Stadt- und Verkehr, TGA, Tragwerk). Die Blöcke `modern`, `forest`, `earth`, `winter` liegen noch in `globals.css`, stehen aber in keiner Auswahl mehr — ~180 Zeilen toter Code.

**Der Standard ist generisches Tailwind-Blau.** `--accent: #2563eb` ist `blue-600`. Die Farbe ist fachlich unauffällig und trägt keine Aussage über das Produkt — sie ist der Vorgabewert, den jedes Framework mitbringt. Alle fünf Branchen-Themes haben dagegen eine erkennbare Identität (Terrakotta, Ocker, Petrol). Ausgerechnet die Palette, die den meisten Nutzern zuerst begegnet, ist die einzige ohne Haltung.

**Die Statusebene ist UI-Semantik, nicht Fach-Semantik:**

```
--success  #15803d   gespeichert · gebucht · bezahlt · rentabel?
--danger   #dc2626   Fehler · löschen · überfällig · unrentabel?
--warning  #b45309   Hinweis · Entwurf · Mahnstufe · knapp?
--info     #1d4ed8   Hinweis
```

Vier Farben tragen zwei getrennte Bedeutungswelten. Im Controlling ist das ein Problem, siehe §4.

**Die Diagrammfarben sind Tailwind-Vollton** (`theme/chartTheme.ts`, `SERIES_LIGHT`). Sie sind explizit *nicht* aus den Statustokens abgeleitet — das ist richtig entschieden und im Code auch so begründet. Nur ist der gewählte Satz nicht auf Farbfehlsichtigkeit geprüft, siehe §5.

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
--kpi-good:      #15803d;   /* über Ziel — Deckungsbeitrag über Plan       */
--kpi-plan:      #1f6f8b;   /* im Plan — bewusst blau, keine Abstufung von Gelb */
--kpi-watch:     #a15c07;   /* beobachten — Abweichung ohne Handlungsdruck */
--kpi-critical:  #b91c1c;   /* Handlungsbedarf — jetzt, nicht im Quartal   */
```

Gemessene Kontraste (Textfarbe, Schwelle AA 4,5:1):

| Token | auf `--surface` (#fff) | auf `--bg` (#f4f6fb) |
|---|---|---|
| `--kpi-good` | 5,02 ✓ | 4,64 ✓ |
| `--kpi-plan` | 5,67 ✓ | 5,24 ✓ |
| `--kpi-watch` | 5,19 ✓ | 4,80 ✓ |
| `--kpi-critical` | 6,47 ✓ | 5,98 ✓ |

Im Dark-Theme aufgehellt, alle ≥ 6,1:1 auf `#1c1c21`:

```css
[data-theme="dark"] {
  --kpi-good: #4ade80;  --kpi-plan: #7cc4dd;
  --kpi-watch: #fbbf24; --kpi-critical: #f87171;
}
```

### 4.3 Die Schwellen gehören nicht in den Code

Wann ein Projekt „beobachten" ist, ist eine kaufmännische Entscheidung des Büros, keine Konstante. Ein Generalplaner rechnet mit anderen Margen als ein Zwei-Personen-Büro. Die Schwellen gehören deshalb als `TENANT_SETTINGS`-Zeilen unter Einstellungen → Vorbelegungen (keine Migration nötig, siehe CLAUDE.md):

```
kpi_db_watch_percent      Standard  5    → DB-Abweichung ab der markiert wird
kpi_db_critical_percent   Standard 15
kpi_overdue_watch_days    Standard 14    → Forderung ab X Tagen überfällig
kpi_overdue_critical_days Standard 30
```

Und, aus derselben Logik wie beim WIP-Report: **ohne gepflegte Einstellung bleibt die Einfärbung ganz aus**, statt eine erfundene Schwelle zu behaupten.

### 4.4 Doppelkodierung ist Pflicht

Jede farbcodierte Aussage braucht einen zweiten Kanal. Konkret:

- Deltas: Vorzeichen **und** Pfeil (`▲ +4,2 %` / `▼ −8,1 %`) — Lucide `TrendingUp`/`TrendingDown`, nie Unicode-Dreiecke (siehe Icon-Regeln in CLAUDE.md)
- Zeilenstatus: der farbige Randstreifen links (`.row-status-*`) bleibt, bekommt aber zusätzlich ein Icon in der Statusspalte
- Ampel-Punkte in Listen: `title`-Attribut mit Klartext (`„beobachten: DB 6,8 % unter Plan"`) — trägt Screenreader *und* Maus-Hover

Das ist nicht nur Barrierefreiheit. Ein Delta mit Pfeil ist auch für Normalsichtige im Augenwinkel schneller erfassbar als ein Farbwechsel.

---

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
blau       #0072b2    fakturiert
grün       #009e73    bezahlt
orange     #e69f00    Backlog
zinnober   #d55e00    Kosten
purpur     #cc79a7    Stunden
himmelblau #56b4e9    Deckungsbeitrag
```

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

### 6.0 · Eine Nebenbedingung, die vor der Geschmacksfrage kommt

Wenn Ebene 2 (§4) eingeführt wird, darf der Markenakzent nicht wie eine Bedeutungsfarbe aussehen. Ein Knopf in derselben Farbe wie „im Plan" wird als Statusanzeige gelesen. Gemessener Farbabstand ΔE zwischen Akzent und der nächstliegenden KPI-Farbe:

| Palette | Akzent | nächste KPI-Farbe | ΔE |
|---|---|---|---|
| A · Kontor | `#0e5a6e` | `--kpi-plan` | **9,6** ✗ |
| B · Reißbrett | `#33556e` | `--kpi-plan` | **13,3** ✗ |
| **C · Blaupause** | `#1b4f8f` | `--kpi-plan` | **29,4** ✓ |
| D · Bilanz | `#0f6b5c` | `--kpi-plan` | 28,2 ✓ · zu `--kpi-good` 32,4 ✓ |
| *heute* | `#2563eb` | `--kpi-plan` | 68,3 ✓ |

A und B sind damit nicht ausgeschlossen — aber sie kosten eine Zusatzentscheidung: `--kpi-plan` müsste von Petrol weg, etwa auf ein kühleres `#2a5fa5`. Das ist machbar, verschiebt aber die Bedeutungsebene wegen einer Geschmacksfrage. C und D brauchen das nicht.

### A · „Kontor" — Petrol + Kupfer

Kaufmännisch-warm. Petrol als Struktur, Kupfer als CTA — ein Kontrastpaar, das die Hauptaktion herausspringen lässt, ohne dass die Fläche unruhig wird. Nächste Verwandtschaft zum bestehenden TGA-Theme. **Kollidiert mit `--kpi-plan`** (ΔE 9,6, §6.0) — bei dieser Wahl muss die KPI-Zwischenstufe ausweichen.

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

Die konsequenteste Umsetzung des Recherche-Befunds „ruhige Struktur, Farbe nur für Daten". Warmneutraler Papiergrund, Graphit-Chrome, ein einziger zurückgenommener Akzent. Wirkt am wenigsten nach „Software", am meisten nach Werkzeug — und lässt die KPI-Farben aus §4 maximal wirken, weil sie die einzige Sättigung auf dem Schirm sind. Zwei Nachteile: geringste Wiedererkennung, im Screenshot-Vergleich mit Wettbewerbern der unauffälligste — und **Kollision mit `--kpi-plan`** (ΔE 13,3, §6.0), dieselbe Ausweichentscheidung wie bei A.

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

**Warum diese als Empfehlung:** Sie bedient die belegbare Konvention (Blau im B2B/Finanzkontext ist erwartungskonform), löst zugleich das Austauschbarkeitsproblem aus §2 (Herkunft statt Framework-Vorgabe) und hat mit ΔE 29,4 den größten Abstand aller vier zur nächsten KPI-Farbe (§6.0) — sie erzwingt als einzige *keine* Folgeentscheidung auf der Bedeutungsebene.

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

**Einschränkung, die vor der Wahl bekannt sein sollte:** Der gemessene Abstand zu `--kpi-good` ist mit ΔE 32,4 unkritisch — das Problem ist nicht Verwechslung, sondern **Konnotation**. Grün ist in der Anwendung als „erledigt / bezahlt / gebucht" belegt; ein grüner „Speichern"-Knopf liest sich für den Bruchteil einer Sekunde wie eine Erfolgsmeldung. Das ist ein weicheres Argument als die Zahlenkollision bei A und B, aber es ist eins.

---

## 7 · Prüfregeln

Ergänzt die bestehenden Design-Token-Regeln in CLAUDE.md. Alle Regeln sind maschinell geprüft durch `frontend-react/scripts/color-check.mjs`.

**Kontrast** — jedes Paar aus der Liste in `PAIRS` muss in **jedem** Theme über der Schwelle liegen, nicht nur im Default. Neu gegenüber heute: `--accent` wird auch gegen `--surface-2` geprüft (Zebrastreifen in Tabellen — dort steht Akzenttext, und vier Themes fallen aktuell durch), und `--nav-inactive` gegen `--chrome`.

**Farbabstand** — zwei Diagrammreihen müssen nach Simulation für Protanopie und Deuteranopie mindestens ΔE 15 auseinanderliegen. Tritanopie wird ausgewiesen, aber nicht erzwungen (Begründung §5.2).

**Doppelkodierung** — keine Aussage allein über Farbe (§4.4).

**Rot-Sparsamkeit** — `--kpi-critical` und `--danger` nur bei Handlungsbedarf. Kein rotes Dauerelement in Listen; Kostenreihen sind neutral einzufärben.

**Ist-Zustand beim Anlegen dieses Konzepts** (`node scripts/color-check.mjs --series`):

```
modern:      --nav-inactive auf --chrome         3,00 < 4,5
earth:       --nav-inactive auf --chrome         3,32 < 4,5
civil:       --accent auf --surface-2            4,18 < 4,5
civil-foto:  --accent auf --surface-2            4,18 < 4,5
tga:         --accent auf --surface-2            4,14 < 4,5
tga-foto:    --accent auf --surface-2            4,14 < 4,5
SERIES_LIGHT: Deuteranopie dE=1,1 · Protanopie dE=6,6 · Tritanopie dE=7,9
SERIES_DARK:  Deuteranopie dE=2,2 · Protanopie dE=6,2 · Tritanopie dE=9,3
```

`modern` und `earth` sind tote Blöcke (§1) — dort genügt Löschen statt Reparieren.

---

## 8 · Umsetzung in Schritten

Bewusst so geschnitten, dass jeder Schritt für sich Nutzen bringt und die Palettenwahl **nicht** blockiert.

| # | Schritt | Umfang | Hängt an Palettenwahl? |
|---|---|---|---|
| 1 | Diagrammfarben auf Okabe-Ito umstellen (§5.2), Linien-/Flächenvariante trennen | `theme/chartTheme.ts`, ~30 Zeilen | nein |
| 2 | KPI-Tokens einführen (§4.2), Kostenreihe entröten | `globals.css` + `chartTheme.ts` | nein |
| 3 | `color-check.mjs` in den CI-Job hängen (neben `security-scan.mjs`) | `.github/workflows` | nein |
| 4 | Tote Theme-Blöcke `modern`/`forest`/`earth`/`winter` entfernen | −180 Zeilen `globals.css` | nein |
| 5 | Vier Befunde aus §7 in den Branchen-Themes beheben | 4 Token-Werte | nein |
| 6 | **Gewählte Palette als neues `light`-Theme einsetzen** | 1 Token-Block | **ja** |
| 7 | Schwellen als `TENANT_SETTINGS` + Einfärbung in Reporting/Projektliste (§4.3) | `VorbelegungenSection` + Reportseiten | nein |
| 8 | Hilfetexte für die KPI-Ampel (`helpContent.tsx`, Regel aus CLAUDE.md) | 4 Einträge | nein |

Die Schritte 1–5 würde ich unabhängig von der Farbfrage machen — Schritt 1 behebt einen Barrierefreiheitsfehler, der heute im Produkt steht.

**RBAC:** Keiner der Schritte legt einen mutierenden Endpunkt oder ein neues sichtbares Bedienelement an. Schritt 7 schreibt in `TENANT_SETTINGS` über den bestehenden `PUT /stammdaten/defaults` — die dort geltende Permission deckt das ab, eine neue ist nicht nötig.

---

## 9 · Was ich von dir brauche

1. **Palette** — A, B, C oder D? Mein Vorschlag ist C „Blaupause" (Begründung in §6). B ist die richtige Wahl, wenn dir maximale Ruhe wichtiger ist als Wiedererkennung — kostet dann aber die Ausweichentscheidung bei `--kpi-plan` aus §6.0.
2. **Ersetzen oder ergänzen?** Soll die gewählte Palette das `light`-Theme *ersetzen* (alle Bestandsnutzer sehen die Änderung) oder als achtes Theme *danebenstehen* (niemand wird überrascht, aber die Auswahlliste wächst weiter)?
3. **Schritt 1 sofort?** Die Diagrammfarben sind für Rot-Grün-schwache Nutzer heute defekt. Ich kann das unabhängig von der Palettenentscheidung sofort umsetzen.

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

Simulation der Farbfehlsichtigkeit nach Viénot, Brettel & Mollon (1999), implementiert in `frontend-react/scripts/color-check.mjs`.
