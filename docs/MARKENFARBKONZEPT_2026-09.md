# Markenfarbkonzept plan&simple — September 2026

**Stand:** 07.09.2026 · **Branch:** `claude/controlling-color-concept-724q02`
**Aufgabe:** Ebene 1 (Marke) für Anwendung **und** Marketing — die einzige offene
Ebene aus `docs/FARBKONZEPT_2026-09.md` §9.

> **Verhältnis zum bestehenden Konzept.** `FARBKONZEPT_2026-09.md` hat drei Ebenen
> getrennt — Marke / Bedeutung / Daten. Ebene 2 (Controlling-Ampel, Geld-Konvention)
> und Ebene 3 (Okabe-Ito-Diagrammfarben) sind umgesetzt und im Produkt; sie werden
> hier **nicht angetastet**. Offen war Ebene 1: Palette C war zwei Tage im Produkt
> und wurde zurückgenommen (§6.2 dort). Dieses Dokument beantwortet die offene Frage
> und erweitert sie um das, was im alten Konzept ganz fehlte: **Marketing, Logo, Druck.**

**Sichtbare Vorschau:** <https://claude.ai/code/artifact/fed51da4-b3e9-411c-82e4-3bd718ebc4f2>
— mit dem, was der Vorschau von Palette C gefehlt hat: ganze Arbeitsfläche statt
Ausschnitt, Handy samt Systemleiste, Marketingflächen.

Alle Zahlen sind gerechnet, nicht geschätzt — mit derselben Farbmathematik wie
`frontend-react/scripts/check-design-system.mjs` (Kontrast nach WCAG 2.1,
Farbabstand als CIE76-ΔE, Farbfehlsichtigkeit simuliert nach Viénot, Brettel &
Mollon 1999).

---

## Kurzfassung

Die Frage war: welche Farben tragen „Sicherheit und Zuverlässigkeit"? Die Antwort
aus der Recherche ist unbequem, aber brauchbar: **„Sicherheit" ist kein Farbton.**
Der am besten belegte Zusammenhang der Farbpsychologie läuft nicht über die Farbe,
sondern über zwei Stellgrößen — **Helligkeit und Sättigung** (Valdez & Mehrabian
1994). Vertrauen entsteht bei *hellen* Flächen und *geringer* Sättigung. Der
Farbton entscheidet, in welche Kategorie man gehört; er entscheidet nicht, ob man
seriös wirkt.

Damit ist der Fall für plan&simple klar: Der Farbton ist ungefähr richtig, die
**Sättigung ist der Fehler**.

| | L\* | C\* | h° |
|---|---|---|---|
| App `--accent` `#2563eb` | 46 | **80** | 293 |
| Logo-Ampersand `#2a55d4` | 41 | **76** | 295 |
| PWA `theme-color` `#2b54e0` | 42 | **84** | 296 |
| Landingpage `#2E5496` | 36 | 41 | 283 |

Vier Blaus in vier Werten — und zwei getrennte Farbwelten: die Anwendung fährt bei
C\* 76–84 (sehr gesättigt), das Marketing bei C\* 41 (gedeckt). Die drei Produkt-Blaus
liegen bei ΔE 7,0–7,6 auseinander: **zu nah, um als System zu wirken, zu weit, um
gleich zu sein.** Das liest sich nicht als Marke, sondern als Unachtsamkeit.

Drei Befunde, die unabhängig von der Palettenwahl gelten und die im alten Konzept
nicht auftauchen, weil dort nur die Diagrammreihen auf Farbfehlsichtigkeit geprüft
wurden:

| # | Befund | Messwert | Schwere |
|---|---|---|---|
| 1 | **`--accent` und `--accent2` fallen bei Rot-Grün-Blindheit zusammen** — Markenblau `#2563eb` gegen den Zweitakzent `#6d28d9` (Abwesenheiten) | ΔE **5,6** bei Deuteranopie (Schwelle 15) | Hoch |
| 2 | **`--accent` und `--info` sind fast dieselbe Farbe** — schon normalsichtig | ΔE **9,2** | Mittel |
| 3 | Dasselbe im Dark-Theme: `--accent` `#9a9ade` gegen `--accent2` `#c4b5fd` | ΔE **11,0** | Mittel |

Die Empfehlung in einem Satz: **die Sättigung radikal senken, die Helligkeit
lassen, die Flächen nicht anfassen** — und den Farbton dorthin legen, wo das
Produkt noch keine Bedeutung vergeben hat. Das ist **nicht** Blau, sondern
**Petrol: `#0d6b74`**.

> **Korrigiert am 07.09.2026, §3a.** Dieses Dokument hat zuerst `#2d66b1`
> empfohlen — ein entsättigtes Blau im selben Farbton wie heute. Das war
> falsch, und zwar aus einem Grund, der sich messen lässt: `#2d66b1` liegt bei
> Deuteranopie **ΔE 4,1** von `#0072b2`, der Diagrammreihe „Honorar /
> Deckungsbeitrag" — der wichtigsten Datenreihe des Produkts. Der Korridor in
> §3 war gegen `--kpi-plan` und `--accent2` geprüft, **nie gegen die
> Diagrammfarben.** Ausgerechnet die Entsättigung, die das Konzept trägt, hat
> die Marke in die Datenreihe hineingeschoben. §3a führt das aus.

---

## 1 · Was die Evidenz hergibt — und was nicht

Das alte Konzept hat die Literatur schon einmal sortiert (§2 dort) und ist zum
Schluss gekommen: „die Markenfarbe entscheidet fast nichts". Das war richtig gegen
die Agenturbehauptungen („Blau steigert Vertrauen um 42 %") und zu pauschal gegen
die Primärliteratur. Es gibt vier Arbeiten, die tragen, und sie sagen etwas
Konkreteres als „nimm Blau".

**① Helligkeit und Sättigung schlagen den Farbton.** Valdez & Mehrabian (1994)
haben Farbwirkung im Pleasure-Arousal-Dominance-Modell gemessen und
Regressionsgleichungen veröffentlicht:

```
Pleasure  =  .69·Helligkeit + .22·Sättigung
Arousal   = −.31·Helligkeit + .60·Sättigung
Dominance = −.76·Helligkeit + .32·Sättigung
```

Lesart für ein Controlling-Werkzeug: Wer eine Fläche als angenehm empfinden soll,
braucht **Helligkeit** (Koeffizient 0,69 — der größte Einzelwert im ganzen Modell).
Wer Ruhe statt Aufregung will, braucht **niedrige Sättigung** (Arousal hängt mit
0,60 an ihr). Der Farbton ist innerhalb der angenehmen Töne nachrangig — Blau,
Blaugrün, Grün und Blauviolett liegen dort alle vorn, Gelb und Gelbgrün hinten.
Nebenbefund, der später wichtig wird: unter den unbunten Farben ist **Schwarz das
aufregendste und dominanteste**, nicht das ruhigste.

**② Gesättigte Oberflächen wirken weniger vertrauenswürdig.** Skulmowski et al.
(2016) haben Websites in gesättigten und entsättigten Varianten bewerten lassen.
Die entsättigten Fassungen bekamen durchgehend bessere Werte für
Vertrauenswürdigkeit, visuelle Attraktivität und wahrgenommene Bedienbarkeit. Die
Erklärung der Autoren: übersättigte Farben weichen von den Farbverhältnissen der
realen Welt ab.

**③ Der Farbton entscheidet die Kategorie.** Labrecque & Milne (2010) haben Farbtöne
auf Markenpersönlichkeits-Dimensionen abgebildet: Rot → *Excitement*, Blau →
*Competence*. Wichtiger als der Farbton ist ihr zweiter Befund: **hohe Sättigung
zieht zu *Excitement* und *Ruggedness*, niedrige Sättigung zu *Sincerity* und
*Sophistication*.* Ein hochgesättigtes Blau ist also nicht „doppelt kompetent",
sondern zieht in zwei Richtungen gleichzeitig. Genau dort steht plan&simple heute.

**④ Blau ist im Vertrauenskontext gemessen vorn — Schwarz hinten.** Alberts & van
der Geest (2011) haben mit über 200 Teilnehmern Finanz-, Rechts- und Medizin-Websites
in vier Farbschemata bewerten lassen. Reihenfolge der wahrgenommenen
Vertrauenswürdigkeit: **Blau > Grün > Rot > Schwarz.** Broeder & Snijder (2019)
ergänzen für Kontexte mit hoher Beteiligung (finanziell, riskant): dort trägt das
**dunklere** Blau besser als das hellere.

**Was weiterhin nicht trägt**, und das bleibt so: die Wirkungsversprechen mit
Prozentzahlen. Ebenso die Idee, man müsse nur „genug Blau" nehmen — über 70 % der
SaaS-Anbieter tun das bereits, weshalb Blau als Vertrauenssignal in dieser Kategorie
kaum noch Trennschärfe hat.

**Zur Kategoriefrage gibt es eine belastbare Arbeit mit einer unangenehmen Pointe.**
Labrecque & Milne (2013) haben Farbhomogenität in 15 Produktkategorien gegen
Markenstärke gerechnet. Ergebnis: Farbliche Abgrenzung nützt in manchen Kategorien
und **schadet in Kategorien mit einem dominanten Marktführer, besonders bei hoher
Kaufbeteiligung**. Bürosoftware für Planungsbüros ist eine Kategorie mit hoher
Kaufbeteiligung — und sie hat seit dem Zusammengehen von untermStrich und KOBOLD
einen dominanten Anbieter. Nach dieser Arbeit ist Normkonformität also eher
vorteilhaft.

Das steht in Spannung zur eigenen Positionierung („anders als die etablierten
Suiten", `docs/marketing/Positionierung_Messaging.md` §1). Die Auflösung ist keine
Kompromissfarbe, sondern eine Aufteilung: **Normkonform im Farbton — kühles Blau,
also Kategoriezugehörigkeit. Abweichend in allem anderen** — Sättigung, Weißraum,
Papiergründe, Diagramme als Bildsprache. Der Preis der Abgrenzung wird dort bezahlt,
wo die Arbeit von 2013 keine Strafe misst.

> **Grenze der Recherche, offen benannt:** Ich konnte die Markenfarben der
> Wettbewerber in dieser Umgebung nicht selbst messen — der Netzwerkzugriff auf
> ihre Seiten ist gesperrt, und ich schreibe keine Hex-Werte hin, die ich nicht
> gesehen habe. Die Aussage „Blau ist in dieser Kategorie besetzt" stützt sich auf
> die allgemeine SaaS-Zahl, nicht auf einen eigenen Wettbewerbsvergleich. Nachholen
> lässt sich das in einer halben Stunde: Screenshots der sechs Seiten
> (PROJEKT PRO, untermStrich, Kobold Control, California, projo, plansync), Farben
> mit einer Pipette abnehmen, in dieselbe LCh-Tabelle wie oben eintragen. Erst dann
> ist der Satz belegt. **Er ändert die Empfehlung nicht** — sie folgt aus ①–④ und
> aus den Messungen am eigenen Bestand, nicht aus dem Wettbewerb.

---

## 2 · Warum Palette C gescheitert ist — die Evidenz erklärt das Feedback

Das ist der wichtigste Abschnitt, weil er verhindert, dass derselbe Fehler ein
zweites Mal gemacht wird. Palette C („Blaupause", `#1b4f8f`) wurde nach zwei Tagen
mit drei Rückmeldungen zurückgenommen. Zwei davon sind aus der Literatur oben
vorhersagbar:

| Rückmeldung | Was tatsächlich geändert wurde | Was die Evidenz dazu sagt |
|---|---|---|
| „Der weiße Hintergrund sah besser aus, jetzt ist alles so grau." | `--bg` `#f4f6fb` → `#eef2f7`, `--surface-2` `#f8f9fb` → `#e3e9f1` | **Pleasure = .69·Helligkeit.** Die Arbeitsfläche ist die größte Fläche im Bild; ihre Helligkeit zu senken ist der teuerste mögliche Eingriff. |
| „Das Blau ist zu dunkel." | `#2563eb` (L\* 46) → `#1b4f8f` (L\* 34) | 12 Punkte L\* sind erheblich. Broeder & Snijder sprechen für *dunkleres* Blau — aber auf **kleinen** Flächen, nicht als Gesamteindruck. |
| „Auf dem Handy ist die Menüleiste ausgeblendet." | `--chrome` → `#10233d`, damit auch `theme-color` | Systemleiste und Bottom-Nav wurden ein zusammenhängendes dunkles Band. |

**Der Konstruktionsfehler war, Helligkeit und Sättigung gemeinsam zu senken.**
Palette C hat beides getan: L\* 46 → 34 *und* C\* 80 → 41. Vom Vertrauensgewinn
kommt der Nutzen aus der Sättigung, die Ablehnung kam aus der Helligkeit. Man kann
das eine ohne das andere haben — und genau das ist der Vorschlag hier.

Daraus die Regel, die dieses Konzept tragen muss:

> **Fläche und Marke sind zwei verschiedene Aufträge.**
> Große Flächen (Grund, Karten, Zebrastreifen) folgen der Helligkeit — sie bleiben
> nahezu weiß und werden **nicht** angefasst. Kleine Flächen (Akzent, Knopf,
> aktiver Navigationsbalken, Wortmarke, Marketing-Kopfzeile) folgen dem Farbton
> und dürfen tief sein.

**Und die Regel gilt eine Ebene tiefer auch für die Tints.** Beim Ansehen des
Vorschau-Themes im laufenden Produkt fiel auf, dass der Anmeldegrund spürbar
dunkler wurde: `--accent-bg` trägt dort einen Verlauf, und der erste Entwurf hatte
den Wert von L\* 96,6 auf 93,1 gezogen — dieselbe Flächenwirkung wie bei Palette C,
nur kleiner und leichter zu übersehen. `--accent-bg` und `--accent-bg2` behalten
deshalb **exakt die Helligkeit der heutigen Werte** und ändern nur Farbton und
Sättigung. Aufgefallen ist das nicht beim Rechnen, sondern beim Hinsehen — genau
dafür läuft die Palette erst als Theme daneben.

Das heißt konkret: Von den heutigen Tokens ändern sich `--bg`, `--surface`,
`--surface-2`, `--surface-3`, `--text` und `--chrome` **überhaupt nicht**. Der
Vorschlag ist deutlich kleiner als Palette C — und die drei zurückgemeldeten Punkte
können nicht wiederkehren, weil ihre Ursachen unberührt bleiben.

---

## 3 · Der Zielkorridor — vier Messungen, eine Box

Statt Paletten zum Aussuchen anzubieten (das war die Methode beim letzten Mal, und
sie hat eine Geschmacksdiskussion erzeugt) wird der zulässige Bereich hier
**eingegrenzt**. Vier Bedingungen, jede gerechnet, jede aus einer anderen Richtung:

| Grenze | Wert | Woher |
|---|---|---|
| L\* **≤ 47** | bei L\* 48 fällt `--accent` als Text auf `--surface-2` (`#f8f9fb`) auf 4,45:1 | WCAG AA, geprüft von `check:design`. Der Zebrastreifen trägt Akzenttext (verlinkte Projekt- und Rechnungsnummern). |
| L\* **≥ 42** | Palette C lag bei 33,6 und wurde als „zu dunkel" abgelehnt | Rückmeldung aus dem Produkt, §2 |
| C\* **≥ 46** | bei C\* 44 sinkt der Abstand zu `--kpi-plan` (`#1d6883`, Petrol) auf ΔE 24, bei C\* 36 auf ΔE 15 | §6.0 des alten Konzepts: der Markenakzent darf nicht wie eine Bedeutungsfarbe aussehen |
| C\* **≤ ~52** | darüber zurück in den Bereich, den ② und ③ als weniger vertrauenswürdig messen — und außer Reichweite des Vierfarbdrucks (§7) | Skulmowski et al., Labrecque & Milne, Drucktechnik |
| h **276–286** | unter 276 Richtung Petrol (`--kpi-plan`), über 286 Richtung Violett (`--accent2`) — dort steht der heutige Akzent und fällt bei Deuteranopie mit ΔE 5,6 zusammen | Befund 1 der Kurzfassung |

Bemerkenswert ist, dass die Sättigung **von unten** begrenzt ist. Der Reflex
„je gedeckter, desto seriöser" hat eine harte Grenze: Unter C\* 46 wandert das
Markenblau in das Petrol, das im Produkt bereits „läuft nach Plan" bedeutet. Ein
Knopf in der Farbe einer Kennzahlenstufe wird als Statusanzeige gelesen. Die
Bedeutungsebene steht seit Block 2 im Produkt und wird nicht für eine
Geschmacksfrage verschoben.

Der Farbton **h 280** hat außerdem einen Vorzug, der beim Rechnen aufgefallen ist
und nicht geplant war: `--text` (`#111827`) liegt bei h 280 — die Schriftfarbe der
Anwendung ist **schon** in dieser Farbtonfamilie. Der einzige Ausreißer ist die
295er-Gruppe: Logo-Ampersand, `theme-color` und `--btn` (`#1a1a2e`, h 295).

**Die Wahl hängt nicht am Landingpage-Entwurf.** Dass der auch bei h 281–283 liegt,
ist Bestätigung, kein Argument — er ist ein Entwurf und wird ohnehin nachgezogen
(§7.1). Tragend sind die beiden produktinternen Gründe: die eigene Schriftfarbe
liegt dort, und der Korridor ist von beiden Seiten durch **Tokens im Produkt**
begrenzt (`--kpi-plan` unten, `--accent2`/`--info` oben). Nimmt man den Entwurf aus
der Betrachtung heraus, ändert sich am Ergebnis nichts.

### Die Wahl

**`--accent: #2d66b1`** — L\* 43 · C\* 46 · h 280.

| Prüfung | heute `#2563eb` | Vorschlag `#2d66b1` |
|---|---|---|
| schlechtester Standard-Grund (AA ≥ 4,5) | 4,78 | **5,33** |
| `#fff` auf dem Akzent (Knopf) | 5,17 | **5,76** |
| ΔE zu `--kpi-plan` (≥ 25) | 62 | 27 |
| ΔE zu `--accent2`, min. über Protanopie/Deuteranopie (≥ 15) | **5,6** ✗ | **33** ✓ |
| ΔE zu `--info` | **9,2** ✗ | 36 ✓ |

Der Vorschlag ist in **jeder** geprüften Dimension besser als der heutige Wert —
auch im Kontrast, obwohl er weniger gesättigt ist. Das ist kein Zufall: Sättigung
trägt nichts zur Leuchtdichte bei, aus der der Kontrastwert gerechnet wird.

---

## 3a · Korrektur: der Korridor war geerbt, nicht hergeleitet

Auf die Frage, ob diese Wahl auch auf einem leeren Blatt herauskäme, lautet die
ehrliche Antwort: **nein.** Zwei der fünf Grenzen in §3 sind keine Messungen,
sondern **übernommene Entscheidungen** — und eine dritte, entscheidende Prüfung
fehlte ganz.

### Was geerbt war

| Grenze in §3 | Was sie wirklich ist |
|---|---|
| C\* ≥ 46 („sonst zu nah an `--kpi-plan`") | `--kpi-plan` = `#1d6883` ist ein Petrol, das im vorigen Konzept gewählt wurde. Es steht im Code an **genau einer Stelle**: `KPI_COLOR.plan` in `utils/kpiLevel.ts`. |
| h ≤ 286 („sonst zu nah an `--accent2`") | `--accent2` = `#6d28d9` ist die Farbe für Abwesenheiten — ebenfalls frei gewählt. Auf einem leeren Blatt wählt man den Zweitakzent **nach** der Marke. |
| L\* ≥ 42 („Palette C war zu dunkel") | Rückmeldung zu einer Palette, die gleichzeitig die *Flächen* verdunkelt hat. Über die zulässige Helligkeit des **Akzents** sagt sie nichts. |

Bleiben als echte Grenzen: L\* ≤ 47 (AA auf dem Zebrastreifen) und C\* ≤ ~52
(Vertrauensforschung, Vierfarbdruck). Das ist kein Korridor, das ist eine
Obergrenze — der Farbton war die ganze Zeit frei.

### Was fehlte

Der Satz, der auf einem leeren Blatt **wirklich** feststeht, ist ein anderer:

1. **Die sechs Okabe-Ito-Diagrammfarben.** Man erfindet sie nicht selbst; jede
   eigene Erweiterung zerstört die CVD-Abstände (nachgerechnet in
   `FARBKONZEPT_2026-09.md` §5.3).
2. **Rot = Handlungsbedarf, Bernstein = beobachten.** Gelernte Konvention.

Gegen diesen Satz hatte ich nie gerechnet. Nachgeholt, engster Abstand im hellen
Theme (Minimum über Normalsicht / Protanopie / Deuteranopie):

| Akzent | L\* | C\* | schl. Grund | engster fester Ton |
|---|---|---|---|---|
| heute `#2563eb` | 46 | 80 | 4,78 | Serie Blau ΔE 38 — *aber* `--accent2` ΔE **6** ✗ |
| ~~`#2d66b1`~~ | 43 | 46 | 5,33 | **Serie Blau ΔE 4** ✗ |
| **`#0d6b74`** | 41 | **25** | **5,76** | Serie Purpur ΔE **17** ✓ |

Unter Deuteranopie wird `#2d66b1` zu `#5858b2` und `#0072b2` zu `#5e5eb3`.
Dieselbe Farbe. Für rund 8 % der männlichen Nutzer wäre ein Verweis nicht von
der Honorarkurve zu unterscheiden.

### Die Freiraumkarte

Rechnet man den Mindestabstand zum festen Satz über alle Farbtöne, ist das
Ergebnis überraschend flach: fast jeder Farbton erreicht bei mäßiger Sättigung
ΔE 18–24. **Der Abstand entscheidet den Farbton also nicht.** Was ihn
entscheidet, ist die **Bedeutung**, die im Produkt schon vergeben ist:

- **Rot / Ziegel** (h 350–40) — Rot heißt „Handlungsbedarf". Ausgeschlossen.
- **Bernstein / Oliv** (h 50–110) — heißt „beobachten". Ausgeschlossen.
- **Grün** (h 130–170) — heißt „bezahlt / gebucht / gebucht"; dazu ISO 7010
  Grün = Rettungsweg. Für Ingenieure doppelt belegt. Ausgeschlossen.
- **Magenta / Pflaume** (h 310–340) — frei, aber liest sich nach Fintech-Start-up,
  nicht nach Planungsbüro. Schwach auf dem Ziel „Zuverlässigkeit".
- **Petrol / Blaugrün** (h 190–230) — **frei.** Kühl, technisch, ohne
  Zweitbedeutung.
- **Blau / Indigo** (h 250–290) — frei von Bedeutung, aber die Heimat der
  wichtigsten Diagrammreihe, und die Farbe von über 70 % der SaaS-Anbieter.

Petrol ist damit die einzige kühle Familie, die keine Bedeutung mitschleppt und
nicht mit den Daten kollidiert. Es ist zugleich die Verschiebung um 15–30°, die
die Differenzierungsempfehlung ohnehin nahelegt.

### Der Preis, offen benannt

Petrol ist nur frei, **wenn `--kpi-plan` aufhört, Petrol zu sein.** Und dafür
gibt es einen Grund, der unabhängig von der Markenfarbe gilt:

> `cpiLevel()` gibt für **jedes gesunde Projekt** `'plan'` zurück, und
> `KpiValue` färbt das petrol. Jede gesunde Zeile der Projektliste trägt also
> eine Farbe. Das ist genau die Alarmmüdigkeit, gegen die
> `FARBKONZEPT_2026-09.md` §2 argumentiert — nur in Petrol statt in Grün.
> Dasselbe Dokument begründet in §4.2 ausführlich, warum `--kpi-good` **nie**
> vergeben wird („ein Projekt, das seine Kosten deckt, ist der Normalfall und
> keine Auszeichnung"). Für `plan` gilt dasselbe Argument, es wurde dort nur
> nicht gezogen.

Die Empfehlung ist deshalb: **`KPI_COLOR.plan` auf die normale Textfarbe.**
Markiert wird „beobachten" und „Handlungsbedarf" — nichts sonst. Die Liste wird
ruhiger, `--kpi-plan` wird überhaupt nicht mehr gebraucht, und der Farbton ist
frei. Eine Zeile Code.

**Was gegen Petrol spricht**, damit es vollständig ist: Alberts & van der Geest
haben Blau vorn gemessen, nicht Petrol — sie haben Petrol aber auch nie
getestet, es waren vier grobe Schemata (rot / blau / grün / schwarz). Ein
messbarer Vertrauensnachteil für einen kühlen Nachbarton von Blau lässt sich
daraus nicht ableiten, ein Vorteil aber auch nicht. Und Petrol ist inzwischen
die häufigste „Nicht-Blau"-Wahl im B2B-SaaS — der Differenzierungsgewinn ist
kleiner, als er aussieht. Dazu ist es für das bestehende Logo der größere
Eingriff: aus einem lebhaften Indigo wird ein tiefes Blaugrün, das ist eine
neue Marke und keine Nachjustierung.

Im Dark-Theme liegt **jeder** helle Akzent nahe an einer Reihe (heute ΔE 5,
Blau ΔE 9, Petrol ΔE 10) — das ist kein Argument für oder gegen Petrol, sondern
eine Warnung, die für alle drei gilt.

---

## 4 · Die Markenfamilie

Eine Farbe reicht nicht: Marketing braucht dunkle Flächen, die Anwendung braucht
Tönungen. Alles im selben Farbton h 280, Sättigung nach Helligkeit gestaffelt —
viel Chroma nur, wo die Fläche klein ist.

| Stufe | Wert | L\* | C\* | auf `#fff` | Verwendung |
|---|---|---|---|---|---|
| `brand-50` | `#f2f5ff` | 97 | 5 | — | `--accent-bg` (Chips, aktive Zeile, Anmeldegrund) |
| `brand-100` | `#e0e7fb` | 92 | 11 | — | `--accent-bg2` |
| `brand-200` | `#cdd7f5` | 86 | 16 | — | Ränder, Marketing-Abschnittsfläche |
| `brand-400` | `#8aa0d5` | 66 | 30 | 2,60 | nur Deko/Ränder — **nicht für Text** |
| **`brand-600`** | **`#2d66b1`** | 43 | 46 | **5,76** | **`--accent` · alles Interaktive** |
| `brand-700` | `#17559a` | 36 | 44 | 7,49 | `--accent-dark`, Hover |
| `brand-800` | `#114076` | 27 | 36 | 10,40 | Marketing: dunkle Hero-/Fußzeilenfläche |
| `brand-900` | `#173056` | 20 | 26 | 13,18 | Marken-Tinte: Überschriften, Wortmarke im Druck |

**Der Dark-Theme-Akzent gehört mit in die Familie.** Er ist heute `#9a9ade` —
L\* 66, C\* 38, **h 294**, also ein Lavendel und farbtonmäßig gar nicht die
Marke; dazu ΔE 11,0 zum dortigen `--accent2`.

> **Korrigiert am 07.09.2026.** Der erste Wert an dieser Stelle war `#a0b5ec`
> (L\* 74, C\* 30) — nur nach Kontrast gewählt. Beim Gegenrechnen der Prüfregel aus
> §8 fiel auf, dass er den Abstand zu `--accent2` (`#c4b5fd`) auf **ΔE 4,9** drückt
> und damit **schlechter** ist als die 11,0 von heute. Ursache: Im Dark-Theme kann
> der Farbton die beiden nicht trennen — unter Deuteranopie laufen Blau und Violett
> zusammen, **es trennt nur die Helligkeit.** `#a0b5ec` lag mit L\* 74 zu dicht an
> den L\* 77 von `--accent2`. Der Akzent muss deshalb im Dark-Theme *dunkler und
> bunter* werden, nicht heller.

| | Wert | L\* | C\* | ΔE zu `--accent2` | schl. dunkler Grund | dunkle Schrift darauf |
|---|---|---|---|---|---|---|
| heute | `#9a9ade` | 66 | 38 | 11,0 ✗ | — | — |
| ~~erster Vorschlag~~ | ~~`#a0b5ec`~~ | 74 | 30 | **4,9** ✗ | 7,50 | 9,00 |
| **Vorschlag** | **`#6b96df`** | 62 | 42 | **16,0** ✓ | **5,13** | **6,15** |

`#6b96df` trägt im Dark-Theme **alle vier Rollen** und ersetzt damit die heutigen
zwei Werte (`--accent` `#9a9ade` und `--btn`/`--cta`/`--nav-active` `#7a7ac6`):
als Text 5,13:1 auf `--surface-2`, auf der Kopfzeile 6,47:1, mit `--btn-fg`
(`#14141c`) darauf 6,15:1. `--accent2` bleibt violett — es muss nicht ausweichen.

### Das Warmneutral — der Gegenpart fürs Marketing

Ein einziges Blau auf Weiß ist für eine Website zu wenig. Der Gegenpart ist
bewusst **kein zweiter Signalton**, sondern eine warme Neutrale: Kalkstein, Papier,
Sichtbeton — die Materialien der Zielgruppe. Farbton h 75, Chroma unter 11, damit
es eine Neutrale bleibt und keine Bedeutung beansprucht.

| Stufe | Wert | L\* | C\* | Verwendung | ΔE zur nächsten App-Bedeutungsfarbe |
|---|---|---|---|---|---|
| `sand-50` | `#faf2ea` | 96 | 5 | Hero-Grund, Abschnittswechsel | — |
| `sand-100` | `#f3e6d9` | 92 | 8 | Karten auf Sand, Zitatflächen | 53 |
| `sand-200` | `#e1d2c2` | 85 | 10 | Ränder, Trennlinien | 46 |
| `sand-500` | `#7c7063` | 48 | 9 | Meta-Text, Bildunterschriften (4,82:1 auf Weiß) | — |
| `sand-800` | `#4f453b` | 30 | 8 | Fußzeile, wenn nicht `brand-800` | 16 |

### Warum es keine dritte Farbe gibt

Naheliegend wäre ein warmer Signalton (Kupfer, Ocker) für Marketing-CTAs. Gerechnet:
ein Kupfer bei L\* 48 / C\* 48 liegt **ΔE 8 von `--danger`** entfernt, sobald man
Rot-Grün-Schwäche mitsimuliert. Im Marketing trägt das keine Bedeutung und wäre
verkraftbar — aber es untergräbt die Disziplin, mit der die Bedeutungsebene im
Produkt gebaut ist, und die Rückmeldungen aus ② und ③ sprechen ohnehin gegen mehr
Sättigung. **Farbe kommt im Marketing aus den Daten**, nicht aus der Dekoration:

> Die Bildsprache von plan&simple sind **Diagramme und Kennzahlen aus dem eigenen
> Produkt** — die Okabe-Ito-Reihen und die Controlling-Ampel. Das ist die
> Abgrenzung, die Labrecque & Milne 2013 erlaubt: nicht der Farbton weicht ab,
> sondern das Motiv. Und es passt zur Kernaussage („Endlich sehen, ob Ihre
> Projekte Geld verdienen"): Das Versprechen *ist* die Zahl.

Diese Farben sind bereits geprüft (CVD-tauglich, kontrastgerechnet) und müssen
nicht neu erfunden werden.

---

## 5 · Was sich in der Anwendung ändert

Absichtlich klein. Sechs Token-Werte, keine Struktur.

| Token | heute | neu | Grund |
|---|---|---|---|
| `--accent` | `#2563eb` | `#2d66b1` | §3 |
| `--accent-dark` | `#1d4ed8` | `#17559a` | Familie, §4 |
| `--accent-bg` | `#eff6ff` | `#f2f5ff` | Familie — **gleiche Helligkeit wie heute** (L\* 96,6) |
| `--accent-bg2` | `#dbeafe` | `#e0e7fb` | Familie — **gleiche Helligkeit wie heute** (L\* 91,7) |
| `--accent-tint…3`, `--accent-ring`, `--accent-rgb` | `37,99,235` | `45,102,177` | folgen dem Akzent |
| `--nav-active` | `#2563eb` | `#2d66b1` | folgt dem Akzent |
| `--info` | `#1d4ed8` | `#17559a` (= `brand-700`) | Befund 2: `--info` und `--accent` waren bei ΔE 9,2 zwei Namen für dieselbe Farbe. Ein Hinweis in Markenblau ist die verbreitete Konvention; zwei fast gleiche Blaus mit angeblich verschiedener Bedeutung sind keine. |
| dark `--accent` / `--nav-active` / `--btn` / `--cta` | `#9a9ade` / `#7a7ac6` | **`#6b96df`** (ein Wert für alle vier) | §4, behebt Befund 3 |
| dark `--info` | `#93c5fd` | `#6b96df` (= dark `--accent`) | lag bei ΔE 3,0 zu `--accent2` — der schlechteste Wert im ganzen Tokensatz |
| `theme-color` in `index.html` | `#2b54e0` | *entfernen* | `syncThemeColor()` in `ThemeOptions.tsx` überschreibt den Wert ohnehin beim Start aus `--chrome`. Der feste Wert ist ein vierter Blauton, der nur bis zum ersten Frame sichtbar ist. |

**Nicht angetastet:** `--bg`, `--surface`, `--surface-2`, `--surface-3`, `--text`,
`--chrome` und alle fünf Branchen-Themes. Die Branchen-Themes überschreiben `--accent`
mit eigenen Tönen — der Markenakzent muss deshalb nur auf den vier
Standard-Gründen tragen, und dort tut er es mit 5,33:1.

### Eine echte Entscheidung: die Farbe der Hauptaktion

`--btn` (`#1a1a2e`, fast schwarz, **h 295**) ist der Hintergrund von `.btn-primary`
und damit der Hauptaktion in der ganzen Anwendung. `--cta` (blau) steht nur an zwei
Stellen. **Die Handlungsfarbe des Produkts ist also faktisch Schwarz, nicht Blau** —
und im Marketing ist es umgekehrt.

Beides ist verteidigbar, aber nicht gleichzeitig:

- **A — Hauptaktion wird Markenblau** (`--btn` = `--cta` = `#2d66b1`).
  Eine Handlungsfarbe, gleiche Aussage in App und Marketing, die Marke bekommt
  überhaupt Fläche. Dafür spricht ④ (Schwarz lag im Vertrauensvergleich hinten) und
  der Nebenbefund aus ① (Schwarz ist unter den unbunten Farben das dominanteste).
  Sichtbar geändert: Anmeldung, alle Bestätigungsknöpfe in Dialogen.
- **B — Hauptaktion bleibt Tinte, Blau bleibt Verweisfarbe.**
  Ruhiger, werkzeughafter, keine Doppelbedeutung von Blau („Verweis" *und*
  „Hauptaktion"). Dann muss aber der Marketing-CTA mitziehen — sonst bleibt die
  Inkohärenz, nur mit vertauschten Rollen. Und `--btn` müsste von h 295 auf h 280
  wandern (`#171b2e`), damit es dieselbe Tintenfamilie ist.

**Empfehlung: A.** Nicht wegen der Vertrauensstudie allein — der Unterschied
zwischen „schwarzer Knopf in blauer Oberfläche" und „schwarzes Farbschema" ist
größer, als die Studie hergibt. Zwei Gründe wiegen schwerer:

1. **Das Produkt widerspricht sich hier schon selbst.** `--cta` ist bereits blau und
   steht auf `.wizard-step.active` und `.tbr-next` — dem „nächsten Schritt", also der
   handlungsförmigsten Aktion, die es gibt. `--btn` ist fast schwarz und steht auf
   allem anderen. Es gibt bereits zwei Antworten auf dieselbe Frage; A vereinheitlicht
   auf die, die an der wichtigsten Stelle schon gilt. B müsste dagegen auch `--cta`
   umstellen und wäre damit der größere Eingriff, nicht der kleinere.
2. In Variante B hat die Markenfarbe im Produkt fast keine Fläche mehr — die Frage
   „welche Farbe hat plan&simple?" wäre ehrlicherweise mit „weiß" zu beantworten.

Für B spricht, dass ein fast schwarzer Hauptknopf ein bewusster, verbreiteter Stil
ist. Wer ihn behalten will, sollte ihn aber von h 295 auf die Tintenfamilie ziehen
(`#1a1a2e` → `#171b2e`, h 288) und `--cta` mitnehmen — sonst bleibt die
Widersprüchlichkeit, nur mit vertauschten Rollen.

---

## 6 · Logo und Wortmarke

Der Bestand: `plan&simple` in `#23262b` (L\* 15, C\* 3,8, **h 270**), das Ampersand
in `#2a55d4`. Das App-Icon ist das Ampersand weiß auf `#2a55d4`.

Die Konstruktion ist gut und bleibt: Die Wortmarke ist ruhig, das Ampersand trägt
die Farbe — genau die Sparsamkeit, die ② und ③ belohnen. Zu ändern sind nur die
Werte:

| Element | heute | neu | Grund |
|---|---|---|---|
| Wortmarke-Schrift | `#23262b` | `#173056` (`brand-900`) | Eine Tintenfamilie statt Schwarz neben Blau. Kontrast auf Weiß steigt nicht (13,2 statt 14,8) und bleibt weit über AA. |
| Ampersand | `#2a55d4` | `#2d66b1` (`brand-600`) | derselbe Wert wie `--accent` — die Marke im Produkt und die Marke auf dem Briefkopf sind dann dieselbe Farbe |
| App-Icon-Grund | `#2a55d4` | `#2d66b1` | Weiß darauf: 5,76:1 (heute 6,27:1) — beide AA |

Zu erzeugende Dateien (alle bestehen bereits, nur neu auszugeben):
`wordmark-color.png`, `ampersand.png`, `icon-192/256/512.png`,
`apple-touch-icon.png`, `favicon-16/32/48.png`.

**Das Ampersand ist keine Marketingaufgabe, sondern Teil der Umstellung.** Die
Wortmarke steht in der App-Kopfzeile unmittelbar neben der Navigation, und die
trägt den Akzent. Zwischen dem heutigen Ampersand `#2a55d4` und `#2d66b1` liegen
**ΔE 34** — das sind sichtbar zwei verschiedene Blaus im selben Bild. Heute fällt
das nicht auf, weil `#2a55d4` und `#2563eb` nur ΔE 7,0 auseinanderliegen. Die
beiden PNGs gehören deshalb in denselben Schritt wie der Tokenwechsel (§9 Schritt 4).
Die **Schriftfarbe** der Wortmarke (`#23262b` → `#173056`) kann dagegen warten: sie
berührt Briefkopf und Druck und ist eine Marketingentscheidung.

**Fehlende Fassungen, die für Marketing gebraucht werden** und heute nicht
existieren: eine **Vektorfassung** (SVG für Web, EPS/PDF für Druck — PNG skaliert
nicht auf ein Messebanner), eine **einfarbige** Fassung (für Prägung, Fax, Stempel,
fremde Partnerlogo-Leisten) und eine **Negativfassung auf `brand-800`**.
`wordmark-white.png` deckt den letzten Fall halb ab.

---

## 7 · Marketing: Web, Dokument, Druck

### 7.1 Web

Die Landingpage (`docs/marketing/landingpage/index.html`) fährt heute eigene Werte
(`#1F3864`, `#2E5496`, `#3B6BB5`). Die gute Nachricht: sie liegt im richtigen
Korridor — h 281–283, C\* 30–45. Sie ist dem Produkt nicht gefolgt, sondern das
Produkt muss ihr folgen. Ersetzt wird:

| Landingpage heute | wird | L\* |
|---|---|---|
| `#1F3864` | `#173056` (`brand-900`) | 24 → 20 |
| `#2E5496` | `#114076` (`brand-800`) | 36 → 27 |
| `#3B6BB5` | `#2d66b1` (`brand-600`) | 45 → 43 |

Gerechnete Paare für die typischen Marketing-Kombinationen:

| Paar | Wert | |
|---|---|---|
| Marken-Tinte auf Weiß | 13,18 | AA |
| Marken-Tinte auf `sand-50` | 11,89 | AA |
| Akzent auf Weiß | 5,76 | AA |
| Akzent auf `sand-100` | 4,70 | AA |
| Weiß auf `brand-800` (dunkler Hero) | 10,40 | AA |
| `sand-50` auf `brand-800` | 9,39 | AA |
| `sand-500` als Meta-Text auf Weiß | 4,82 | AA |

**Flächenregel fürs Marketing, aus §2 übernommen:** Dunkle Flächen (`brand-800`,
`brand-900`) sind für **abgegrenzte Abschnitte** — Kopfzeile, Fußzeile, ein
Zitatband. Nicht für den Grund einer ganzen Seite. Was in der Anwendung eine
Ablehnung ausgelöst hat, gilt auf einer Website nicht anders; dort ist es nur
leichter, es nicht zu merken, weil niemand acht Stunden darin arbeitet.

### 7.2 Dokumente aus dem Produkt — Abgrenzung, die leicht schiefgeht

Die PDF-Vorlagen in `backend/templates/modern_a/` erzeugen **Angebote und Rechnungen
des Kunden an dessen Bauherrn**. Sie tragen die Farbe des Mandanten
(`DokumentvorlagenSection`, Akzentpalette), nicht die von plan&simple. Das ist
richtig und bleibt so:

> **Die Markenfarbe von plan&simple erscheint in keinem Dokument, das ein Mandant
> nach außen gibt.** Ein Architekt, der seine Schlussrechnung stellt, wirbt nicht
> für seine Bürosoftware. Umgekehrt heißt das: Die Marken-Blaufamilie darf nicht
> als Vorgabewert in die Mandanten-Akzentpalette wandern.

Eigene Dokumente von plan&simple — Angebot an den Interessenten, Rechnung an den
Mandanten, Whitepaper, der E-Rechnungs-Check in `docs/marketing/` — tragen dagegen
die Markenfamilie.

### 7.3 Druck

Hier hat der heutige Wert ein Problem, das auf dem Bildschirm unsichtbar ist:

| | C\* | Vierfarbdruck |
|---|---|---|
| Logo heute `#2a55d4` | **76** | weit außerhalb — druckt stumpf und kippt Richtung Violett |
| App heute `#2563eb` | **80** | weit außerhalb |
| Vorschlag `#2d66b1` | 46 | plausibel innerhalb |
| Marken-Tinte `#173056` | 26 | unkritisch |

Hochgesättigte RGB-Blaus liegen außerhalb des CMYK-Farbraums; sie verschieben sich
im Vierfarbdruck nach Violett oder Marine. Wer heute eine Visitenkarte oder einen
Messeaufsteller mit `#2a55d4` bestellt, bekommt eine andere Farbe zurück als auf
dem Schirm — und niemand merkt, woran es lag. Die Entsättigung auf C\* 46 löst
diesen Nebenschauplatz mit.

**Das ist ein Indikator, kein Beweis.** Chroma sagt, wie wahrscheinlich eine Farbe
im Vierfarbraum liegt, nicht ob. Verbindlich ist ein Softproof im Zielprofil
(ISO Coated v2 für gestrichenes Papier, PSO Uncoated für ungestrichenes) und bei
größeren Auflagen ein Proof. Wenn die Farbe exakt sitzen muss — Messestand,
Fahrzeug — gehört ein Schmuckfarben-Äquivalent dazu; das ist eine Aufgabe für den
Druckdienstleister mit einem Fächer in der Hand, nicht für dieses Dokument.

---

## 8 · Prüfregeln — Ergänzungen

`check-design-system.mjs` prüft heute Kontrast je Theme und Farbabstand der
Diagrammreihen. Es prüft **nicht**, ob die UI-Farben untereinander unterscheidbar
sind — deshalb sind die Befunde 1–3 der Kurzfassung durchgekommen. Vorschlag:

1. **Farbabstand auch für UI-Farben — aber eng gefasst.**

   > **Korrigiert am 07.09.2026.** Hier stand zuerst: „`--accent`, `--accent2`,
   > `--info` und die vier `--kpi-*` gegeneinander, Schwelle ΔE 15". Gerechnet
   > **fällt diese Regel in allen sieben Themes durch** — und zwar zu Recht:
   > `--kpi-watch` (`#8f5206`) und `--kpi-critical` (`#b91c1c`) liegen unter
   > Rot-Grün-Schwäche bei **ΔE 2,8**. Das ist der Ampel-Metapher inhärent: Orange
   > und Rot *sind* für rot-grün-schwache Nutzer kaum trennbar. Genau deshalb
   > verlangt §4.4 des alten Konzepts dort Symbol **und** Klartext. Eine Regel, die
   > eine bewusst doppelkodierte Farbe wie eine alleinstehende prüft, ist nicht
   > streng, sondern falsch — und wäre am ersten Tag deaktiviert worden.

   Die Regel muss auf das zielen, was sie meint: **Farben, die eine Unterscheidung
   allein tragen.**

   | Paar | Regel | heute | Vorschlag |
   |---|---|---|---|
   | `--accent` / `--accent2` | **Fehler** unter ΔE 15 — ein Verweis und ein Abwesenheits-Chip unterscheiden sich durch nichts als die Farbe | 5,6 (hell) · 11,0 (dunkel) ✗ | 33 (hell) · 16,0 (dunkel) ✓ |
   | `--kpi-*` untereinander | **ausgenommen**, mit Begründung im Code: doppelkodiert durch Symbol + Klartext (§4.4). Stattdessen ist die Doppelkodierung zu prüfen, nicht der Abstand | 2,8 | 2,8 |
   | `--info` | **ausgenommen**: absichtlich derselbe Ton wie der Akzent (§5), keine zwei Farben mit behauptetem Unterschied | ΔE 9,2 zum Akzent, aber als *eigene* Farbe deklariert | ein Wert |
   | alles Übrige | **Warnung**, kein Fehler — z. B. dark `--accent2`/`--kpi-plan` bei ΔE 11,6: verschiedene Ansichten, KPI trägt Text | — | 11,6 ⚠ |

   So gefasst ist die Regel **heute rot und nach der Umstellung grün** — die
   Reihenfolge, die ein Regressionstest braucht. Landet sie vor der Umstellung im
   CI, bricht der Build.
2. **Ein Markenblau, nicht vier.** Der Akzentwert steht an drei Orten außerhalb von
   `globals.css` (`index.html`, die Logo-Dateien, die Landingpage). Prüfbar ist
   mindestens `index.html`: kein `theme-color` mit festem Wert, weil
   `syncThemeColor()` es ohnehin setzt.
3. **Sättigungsdeckel.** `--accent` über C\* 55 ist ein Befund. Nicht wegen der
   Zugänglichkeit — wegen §1 ② und dem Druck. Eine Regel, die sich sonst über zwei
   Jahre lautlos zurückdreht.

Die bestehenden Regeln bleiben unverändert; keine wird gelockert.

---

## 9 · Umsetzung in Schritten

Der Schnitt folgt der Lehre aus §6.2 des alten Konzepts: **erst als Theme daneben,
auf einem echten Gerät benutzen, dann ersetzen.** Nicht umgekehrt.

| # | Schritt | Umfang | Risiko |
|---|---|---|---|
| **Produkt** | | | |
| 1 | Palette als **zusätzliches** Theme `trust` einhängen, in `ThemeOptions.tsx` sichtbar | 1 Token-Block, 1 Zeile | keins — nichts Bestehendes ändert sich |
| 2 | **Eine Woche echt benutzen** — Desktop *und* Handy, Listen, Wizards, Dialoge, Systemleiste | — | das ist der Schritt, der beim letzten Mal fehlte |
| 3 | `trust` wird das `light`-Theme, Dark-Theme mitziehen (`#6b96df`), `--info` zusammenlegen, **Logo-PNGs neu ausgeben**, `theme-color` aus `index.html` entfernen | Token-Blöcke, `public/brand/`, 1 Zeile HTML | Bestandsnutzer sehen die Änderung |
| 4 | Prüfregel aus §8 ergänzen — **erst jetzt**: vorher bricht sie den Build | `scripts/check-design-system.mjs` | wird mit Schritt 3 grün |
| 5 | Hauptaktion (§5 A oder B) | `--btn`/`--cta` | sichtbar in Anmeldung und Dialogen — eigener Commit, allein zurücknehmbar |
| **Marketing, im Anschluss** | | | |
| 6 | Wortmarken-Schrift auf `brand-900`, Vektor- und Einfarbfassung anlegen (§6) | `public/brand/` + Druckvorlagen | berührt Briefkopf |
| 7 | Landingpage auf die Familie ziehen (§7.1) | `docs/marketing/landingpage/index.html` | — |
| 8 | Druckfarbe im Softproof bestätigen (§7.3) | Dienstleister | — |

Schritt 1 und 2 sind die eigentliche Prüfung — sie kosten nichts und sind
zurücknehmbar. Alles ab 3 ist erst danach sinnvoll, und alles ab 6 erst, wenn die
Farbe im Produkt steht: Logo und Website folgen der Anwendung, nicht umgekehrt.

**RBAC:** kein mutierender Endpunkt, kein neues Bedienelement — keine neue
Permission (`docs/RBAC_DEVELOPMENT_CHECKLIST.md`).
**Hilfetexte:** Ein zusätzliches Theme in einer bestehenden Auswahlliste ist eine
selbsterklärende Standardinteraktion; nach `docs/HELP_TOOLTIP_CONCEPT.md` kein
neuer Eintrag nötig.

---

## 10 · Empfehlung und offene Entscheidungen

**Produkt zuerst, Marketing im Anschluss** — in dieser Reihenfolge, weil die
Markenfarbe im Produkt entschieden werden muss, bevor Logo und Website ihr folgen
können. Umgekehrt geht es nicht.

### Was ich empfehle

| | Empfehlung | Begründung |
|---|---|---|
| **Akzent** | **`#0d6b74`** (Petrol) | §3a. `#2d66b1` liegt bei Deuteranopie ΔE 4 von der Diagrammreihe „Honorar/DB" — der Korridor in §3 war geerbt, nicht hergeleitet. |
| **`KPI_COLOR.plan`** | normale Textfarbe | §3a — der Normalfall hört auf, farbig zu sein. Gilt unabhängig von der Markenfarbe und macht den Farbton frei. |
| **Dark-Theme** | `#6b96df` für alle vier Rollen | §4 — behebt zugleich den schlechtesten Abstand im Tokensatz (dark `--info`/`--accent2`, ΔE 3,0) |
| **Hauptaktion** | **A — Markenblau** | `--cta` ist dort schon blau, wo es am meisten Handlung ist (§5) |
| **Logo-PNGs** | mit umstellen | ΔE 34 zwischen altem Ampersand und neuem Akzent, in derselben Kopfzeile (§6) |
| **Wortmarken-Schrift** | zurückstellen | berührt Druck und Briefkopf → Marketingphase |
| **Wettbewerbsvergleich** | zurückstellen | Marketing; ändert die Empfehlung nicht (§1) |

### Offen für dich

1. **Hauptaktion A oder B?** (§5) Die einzige Entscheidung, die das Aussehen der
   Anwendung spürbar ändert — Anmeldung und alle Bestätigungsknöpfe in Dialogen.
2. **Freigabe für Schritt 1–2** (§9): Palette als *zusätzliches* Theme einhängen und
   eine Woche auf einem echten Gerät benutzen, Desktop **und** Handy. Das kostet
   nichts und ist zurücknehmbar, weil sich am Bestand nichts ändert. Erst danach
   Schritt 4.

Nicht mehr offen: die Palettenwahl. Sie ist keine Geschmacksfrage mehr, sondern das
Ergebnis der Box aus §3 — bei fünf gerechneten Grenzen bleibt kein Spielraum für
eine zweite Meinung, nur für einen anderen Punkt in derselben Box.

---

## Quellen

Recherche vom 07.09.2026. Primärliteratur zuerst — die Reihenfolge ist die
Belastbarkeit.

- Valdez, P. & Mehrabian, A. (1994): *Effects of color on emotions.* Journal of
  Experimental Psychology: General, 123(4), 394–409. — [PubMed](https://pubmed.ncbi.nlm.nih.gov/7996122/)
- Skulmowski, A. et al. (2016): *The negative impact of saturation on website
  trustworthiness and appeal: A temporal model of aesthetic website perception.*
  Computers in Human Behavior. — [ScienceDirect](https://www.sciencedirect.com/science/article/abs/pii/S0747563216302254)
- Alberts, W. A. & van der Geest, T. M. (2011): *Color Matters: Color as
  Trustworthiness Cue in Web Sites.* Technical Communication 58(2). — [University of Twente](https://research.utwente.nl/en/publications/color-matters-color-as-trustworthiness-cue-in-web-sites)
- Labrecque, L. I. & Milne, G. R. (2010): *Exciting red and competent blue: the
  importance of color in marketing.* Journal of the Academy of Marketing Science. — [Springer](https://link.springer.com/article/10.1007/s11747-010-0245-y)
- Labrecque, L. I. & Milne, G. R. (2013): *To be or not to be different: Exploration
  of norms and benefits of color differentiation in the marketplace.* Marketing
  Letters 24(2), 165–176. — [Springer](https://link.springer.com/article/10.1007/s11002-012-9210-5)
- Broeder, P. & Snijder, H. (2019): *Colour in Online Advertising: Going for Trust,
  Which Blue is a Must?* Marketing from Information to Decision Journal 2(1). — [PDF](https://econ.ubbcluj.ro/mid/journal/papers/2-1/Broeder%20and%20Snijder%20-%20MID%202019%202(1).pdf)
- Jonauskaite, D. et al.: *Universal Patterns in Color-Emotion Associations Are
  Further Shaped by Linguistic and Geographic Proximity.* — [Übersicht](https://www.researchgate.net/publication/344171453_Universal_Patterns_in_Color-Emotion_Associations_Are_Further_Shaped_by_Linguistic_and_Geographic_Proximity)
- Kim, J. & Moon, J. Y. (1998): *Designing towards emotional usability in customer
  interfaces — trustworthiness of cyber-banking system interfaces.* Interacting with
  Computers 10(1), 1–29.
- Kategoriehinweis „über 70 % der SaaS-Anbieter nutzen Blau": [Tentackles, B2B SaaS Color Palettes 2026](https://tentackles.com/blog/b2b-saas-color-palettes-2026-that-stand-out) — Branchenblog, nicht begutachtet; als Größenordnung verwendet, nicht als Messwert.
- Marktkonsolidierung untermStrich / KOBOLD: [bidequity.de](https://bidequity.de/de/announcement_untermstrich)
- Farbverschiebung gesättigter Blaus im Vierfarbdruck: [Printing For Less](https://www.printingforless.com/blog/why-is-my-blue-purple-rgb-v-cmyk/), [Rapid Color](https://rapidcolor.com/color-matching-in-print-pantone-cmyk-and-rgb-explained/)
- DIN EN ISO 7010 Sicherheitsfarben (Blau = Gebot, Grün = Rettung, Gelb = Warnung): [iso7010.de/farbtabelle](http://www.iso7010.de/farbtabelle/) — nicht in die Empfehlung eingegangen, aber der Grund, warum in dieser Zielgruppe Grün als Markenfarbe belastet ist.
- BFSG: B2B-Angebote sind von der Pflicht ausgenommen, wenn die Ausrichtung
  erkennbar ist. Zugänglichkeit bleibt für plan&simple damit **Vertriebsargument bei
  öffentlichen Auftraggebern** (EN 301 549), nicht gesetzliche Pflicht für das
  Produkt — das alte Konzept formuliert das in §2 zu scharf. [IHK Darmstadt](https://www.ihk.de/darmstadt/produktmarken/recht-und-fair-play/online-auftritt/barrierfreiheitsstaerkungsgesetz-6247610)

Simulation der Farbfehlsichtigkeit nach Viénot, Brettel & Mollon (1999),
implementiert in `frontend-react/scripts/check-design-system.mjs`.
