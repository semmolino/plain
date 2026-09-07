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

Die Empfehlung in einem Satz: **denselben Farbton behalten, die Sättigung von
C\* 80 auf C\* 46 nehmen, die Helligkeit lassen** — und diesen einen Wert dann
überall einsetzen, wo heute vier verschiedene stehen. Vorschlag: **`#2d66b1`**.

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
Anwendung ist **schon** in dieser Farbtonfamilie. Auch die Landingpage liegt bei
h 281–283. Der einzige Ausreißer ist die 295er-Gruppe: Logo-Ampersand, `theme-color`
und `--btn` (`#1a1a2e`, h 295).

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

## 4 · Die Markenfamilie

Eine Farbe reicht nicht: Marketing braucht dunkle Flächen, die Anwendung braucht
Tönungen. Alles im selben Farbton h 280, Sättigung nach Helligkeit gestaffelt —
viel Chroma nur, wo die Fläche klein ist.

| Stufe | Wert | L\* | C\* | auf `#fff` | Verwendung |
|---|---|---|---|---|---|
| `brand-50` | `#f4f6fe` | 97 | 4 | — | Marketing: sehr helle Abschnittsfläche |
| `brand-100` | `#e6ebfa` | 93 | 8 | — | `--accent-bg` (Chips, aktive Zeile) |
| `brand-200` | `#cdd7f5` | 86 | 16 | — | `--accent-bg2`, Ränder |
| `brand-400` | `#8aa0d5` | 66 | 30 | 2,60 | nur Deko/Ränder — **nicht für Text** |
| **`brand-600`** | **`#2d66b1`** | 43 | 46 | **5,76** | **`--accent` · alles Interaktive** |
| `brand-700` | `#17559a` | 36 | 44 | 7,49 | `--accent-dark`, Hover |
| `brand-800` | `#114076` | 27 | 36 | 10,40 | Marketing: dunkle Hero-/Fußzeilenfläche |
| `brand-900` | `#173056` | 20 | 26 | 13,18 | Marken-Tinte: Überschriften, Wortmarke im Druck |

**Der Dark-Theme-Akzent gehört mit in die Familie.** Er ist heute `#9a9ade` —
L\* 66, C\* 38, **h 294**, also ein Lavendel und farbtonmäßig gar nicht die
Marke; dazu ΔE 11,0 zum dortigen `--accent2`. Im selben Farbton:

| | Wert | L\* | C\* | schlechtester dunkler Grund | dunkle Schrift darauf |
|---|---|---|---|---|---|
| heute | `#9a9ade` | 66 | 38 | — | — |
| Vorschlag | **`#a0b5ec`** | 74 | 30 | **7,50** | **9,00** |

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
| `--accent-bg` | `#eff6ff` | `#e6ebfa` | Familie |
| `--accent-bg2` | `#dbeafe` | `#cdd7f5` | Familie |
| `--accent-tint…3`, `--accent-ring`, `--accent-rgb` | `37,99,235` | `45,102,177` | folgen dem Akzent |
| `--nav-active` | `#2563eb` | `#2d66b1` | folgt dem Akzent |
| `--info` | `#1d4ed8` | `#17559a` (= `brand-700`) | Befund 2: `--info` und `--accent` waren bei ΔE 9,2 zwei Namen für dieselbe Farbe. Ein Hinweis in Markenblau ist die verbreitete Konvention; zwei fast gleiche Blaus mit angeblich verschiedener Bedeutung sind keine. |
| dark `--accent` / `--nav-active` / `--btn` / `--cta` | `#9a9ade` / `#7a7ac6` | `#a0b5ec` / `#7e94d8` | §4, behebt Befund 3 |
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
größer, als die Studie hergibt. Sondern weil in Variante B die Markenfarbe im
Produkt fast keine Fläche mehr hat und die Frage „welche Farbe hat plan&simple?"
dann ehrlicherweise mit „weiß" zu beantworten wäre.

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

1. **Farbabstand auch für UI-Farben.** `--accent`, `--accent2`, `--info` und die
   vier `--kpi-*` gegeneinander, Minimum über Normalsicht/Protanopie/Deuteranopie,
   Schwelle ΔE 15 wie bei den Diagrammreihen — je Theme. Genau diese Prüfung findet
   `#2563eb`/`#6d28d9` bei 5,6.
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
| 1 | Palette als **zusätzliches** Theme `trust` einhängen, in `ThemeOptions.tsx` sichtbar | 1 Token-Block, 1 Zeile | keins — nichts Bestehendes ändert sich |
| 2 | **Eine Woche echt benutzen** — Desktop *und* Handy, Listen, Wizards, Dialoge, Systemleiste | — | das ist der Schritt, der beim letzten Mal fehlte |
| 3 | Prüfregeln aus §8 ergänzen; Befunde 1–3 werden dann rot | `scripts/check-design-system.mjs` | Befunde im Bestand sind zu erwarten und sollen sichtbar werden |
| 4 | Entscheidung zur Hauptaktion (§5 A oder B) umsetzen | `--btn`/`--cta` | sichtbar in Anmeldung und Dialogen |
| 5 | Theme `trust` wird das `light`-Theme; `trust` verschwindet aus der Auswahl | Token-Block | Bestandsnutzer sehen die Änderung |
| 6 | Logo-Dateien neu ausgeben, Vektor- und Einfarbfassung anlegen (§6) | `public/brand/` | — |
| 7 | Landingpage auf die Familie ziehen (§7.1) | `docs/marketing/landingpage/index.html` | — |
| 8 | `theme-color` aus `index.html` entfernen | 1 Zeile | — |

Schritt 1 und 2 sind die eigentliche Prüfung. Alles ab 5 ist erst danach sinnvoll.

**RBAC:** kein mutierender Endpunkt, kein neues Bedienelement — keine neue
Permission (`docs/RBAC_DEVELOPMENT_CHECKLIST.md`).
**Hilfetexte:** Ein zusätzliches Theme in einer bestehenden Auswahlliste ist eine
selbsterklärende Standardinteraktion; nach `docs/HELP_TOOLTIP_CONCEPT.md` kein
neuer Eintrag nötig.

---

## 10 · Was ich von dir brauche

1. **Hauptaktion: A oder B?** (§5) — die einzige Entscheidung, die das Aussehen
   spürbar ändert. Empfehlung A.
2. **Wortmarke: Schrift auf `brand-900` umstellen?** (§6) Das berührt das Logo, also
   Briefkopf, Visitenkarte, alles Gedruckte. Wenn die Marke unverändert bleiben soll,
   funktioniert das Konzept auch mit `#23262b` weiter — dann bleibt ein Ton bei
   h 270 stehen, was messbar, aber nicht sichtbar ist.
3. **Wettbewerbsvergleich nachholen?** (§1, Kasten) Eine halbe Stunde Screenshots.
   Ändert die Empfehlung nicht, macht aber eine Aussage belegbar, die derzeit
   geliehen ist.

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
