# Konkrete UI-Verbesserungen — Bestandsaufnahme an echten Screens

**Stand:** 07.08.2026 · **Branch:** `feature/ux-ui-audit`

Grundlage sind Screenshots der echten Oberfläche mit realistischen Daten
(`frontend-react/tests/fixtures/demoData.ts`) in Desktop 1280×720 und Mobil 390×844.
Vorher liefen alle Test-Mocks auf `{ data: [] }` — Listen zeigten nur ihren Leerzustand,
Dichte und Spaltenbreiten waren damit gar nicht beurteilbar.

Legende: **[erledigt]** = in diesem Branch umgesetzt · **[offen]** = Vorschlag, noch nicht umgesetzt.

---

## 1 · Formensprache: alles ist eine Pille

**Befund.** Auf der Projekte-Seite wurden **8 verschiedene Button-Geometrien** gemessen
(Höhe / Radius / Schriftgröße / Gewicht):

| Anzahl | Geometrie | Was es ist |
|---|---|---|
| 24× | 30px · r4 · 14px · 600 | Zeilen-Aktionen |
| 9× | 30px · r20 · 12px · 700 | Tabs, Filter-Chips |
| 8× | 22px · r8 · 11px · 700 | Status-Badges |
| 4× | 27px · r16 · 12px · 600 | Toolbar |
| 2× | 38px · r50% | Rund (Avatar/Bell) |
| 2× | 28px · r10 · 12px · 600 | — |
| 1× | 30px · r6 | — |
| 1× | 32px · r6 | — |

Radien im Einsatz: 4, 6, 8, 10, 16, 20, 50 %. Höhen: 22, 25, 27, 28, 30, 32, 38 — auf **einer** Seite.

**Ursache** war zu einem großen Teil, dass die Varianten-Klassen gar nicht existierten
(`.btn`, `.btn-secondary`, `.btn-danger`, `.btn-sm`, `.link-btn`) und alles auf die globale
`button`-Regel plus Inline-Styles zurückfiel. **[erledigt]**

**Vorschlag für die verbleibende Vereinheitlichung [offen]:**

| Rolle | Höhe | Radius | Schrift |
|---|---|---|---|
| Primäraktion / Sekundär | 38 px | `--radius-md` (10) | 13 px / 600 |
| Kompakt (Toolbar, Zeile) | 30 px | `--radius-sm` (6) | 12 px / 600 |
| Icon-Button (Zeile) | 30×30 | `--radius-sm` | — |
| Filter-Chip | 30 px | `--radius-pill` | 12 px / 600 |
| Status-Badge (kein Button!) | 20 px | `--radius-pill` | 11 px / 700 |

**Regel:** Die Pillenform ist **reserviert für Filter und Status**. Alles Anklickbare mit
Aktionscharakter bekommt `--radius-md` bzw. `--radius-sm`. Das trennt „ich filtere" von
„ich löse etwas aus" — heute sehen beide gleich aus.

---

## 2 · Konkurrierende Primäraktionen

**Befund.** In der Projekte-Toolbar standen nebeneinander:
- aktiver Tab „Liste" als **gefüllte dunkle Pille**
- „+ Neues Projekt" als **gefüllte dunkle Pille**

Zwei völlig verschiedene Bedeutungen (Wo bin ich? vs. Was tue ich?) mit identischem Gewicht.

**[erledigt]** Tabs tragen jetzt einen Unterstrich statt einer Füllung. Die einzige gefüllte
dunkle Fläche auf der Seite ist damit die Primäraktion.

**[offen]** Gleiches Muster prüfen bei `.seg-nav-btn` (Mitarbeiter, Service) und
`.dash-subnav-btn` (Dashboard) — dort ist der aktive Zustand ebenfalls eine gefüllte Fläche.

---

## 3 · Destruktive Aktion war das lauteste Element der Seite

**Befund.** Jede Projektzeile trug einen **dauerhaft rot umrandeten, rot gefüllten**
Papierkorb — 8 Zeilen = 8 rote Signale. Die eigentliche Hauptaktion („Öffnen") war ein
dezenter, umrandeter Knopf. Das Auge wurde also systematisch auf „Löschen" gezogen.

Verschärfend: `ConfirmModal` nutzt `btn-danger` als Default — und diese Klasse war
**nicht definiert**. Im Löschdialog sah „Bestätigen" damit genauso aus wie „Abbrechen".

**[erledigt]** Zeilen-Löschen ist im Ruhezustand neutral und färbt sich erst bei
Hover/Fokus rot (17 Stellen). `btn-danger` ist definiert; im Dark-Theme sorgt `--danger-fg`
für lesbare Schrift (weiß lag dort bei 2,77:1).

---

## 4 · Zeilen-Aktionen: zu viel, zu ähnlich, zu weit rechts

**Befund Projekte.** Pro Zeile: Checkbox „Intern" · Stift · Kopieren · Papierkorb · „Öffnen".
Fünf Ziele pro Zeile, davon vier Icons ohne Text.

**Befund Rechnungen.** Die Aktionsspalte wird **am rechten Rand abgeschnitten** —
„Details | PDF | …" läuft aus dem Viewport. Ausgerechnet die Interaktionsspalte ist das,
was zuerst verschwindet.

**Vorschläge [offen]:**

1. **Zeile als Ganzes anklickbar** → „Öffnen" entfällt als Wiederholung in jeder Zeile.
   Das Muster existiert bereits (Mitarbeiter-Liste), ist aber nicht durchgezogen.
2. **Nur die häufigste Aktion inline**, alles Weitere hinter `MoreHorizontal` (⋯).
   Ziel: max. 2 sichtbare Ziele pro Zeile.
3. **Aktionsspalte rechts fixieren** (`position: sticky; right: 0`) — dann bleibt sie beim
   horizontalen Scrollen erreichbar.
4. **Boolean-Spalten nicht als scharfe Checkbox** rendern. „Intern" ist eine Stammdaten-
   eigenschaft; eine Checkbox in jeder Zeile lädt zum versehentlichen Umschalten ein.
   Besser: Symbol/Badge, Änderung über die Detailansicht oder Inline-Edit mit Bestätigung.

---

## 5 · Positionierung in der Toolbar

**Befund.** Reihenfolge auf Projekte:
`[Suchen…] [Status▾] [Typ▾] [Leitung▾] [Intern▾]` — Zeilenumbruch —
`[Spalten] 8 Projekte · Seite 1/1 [+ Neues Projekt]`

Probleme:
- Die Trefferzahl steht **zwischen** zwei Bedienelementen und ist vertikal nicht auf deren
  Grundlinie ausgerichtet (auf Adressen sichtbar: „0 Einträge" sitzt höher als die Knöpfe).
- „Spalten" (Ansichtseinstellung) steht neben „+ Neues Projekt" (Datenaktion) — zwei Klassen
  von Bedienelementen ohne Trennung.
- Auf Adressen liegt zwischen ihnen noch „CSV" (Export) — dritte Klasse.

**Vorschlag [offen]:** feste Zonen, immer gleich:

```
┌─────────────────────────────────────────────────────────────┐
│ [Suchen…]  [Filter▾] [Filter▾]              [⚙ Ansicht] [+ Neu] │
└─────────────────────────────────────────────────────────────┘
   Trefferzahl direkt über der Tabelle, linksbündig, als Meta-Zeile
```
- **links**: Suche + Filter (Daten einschränken)
- **rechts**: Ansicht (Spalten, Export) + Primäraktion, in dieser Reihenfolge
- **Trefferzahl** gehört zur Tabelle, nicht in die Bedienleiste

---

## 6 · Paginierung, die keine ist

**Befund.** Bei 8 Einträgen auf einer Seite steht unter der Tabelle
„← Zurück" / „Weiter →" — beide funktionslos, linksbündig, mit Unicode-Pfeilen
(entgegen der eigenen Icon-Regel).

**Vorschlag [offen]:** Blätter-Elemente nur zeigen, wenn es mehr als eine Seite gibt.
Pfeile über `lucide-react` (`ChevronLeft`/`ChevronRight`).

---

## 7 · Bester Platz, leerer Inhalt

**Befund Rechnungen.** Ganz oben, über der eigentlichen Liste, sitzt das Panel
„Abrechenbare Projekte" und meldet: „Kein Abrechnungspotenzial — alle Projekte sind
vollständig fakturiert." Der wertvollste Bereich des Bildschirms zeigt also im Normalfall,
dass es nichts zu tun gibt.

**Vorschlag [offen]:** Panel einklappen, wenn leer (nur Kopfzeile mit Zähler „0"),
und automatisch aufklappen, sobald Potenzial besteht. Alternativ unter die Liste.

---

## 8 · Spalten, die nichts zeigen

**Befund.** In der Projektliste enthält die Spalte „Leitung" nur ein Aufklapp-Chevron,
ohne Wert — obwohl Projektleiter hinterlegt sind. Ebenso wirkt „Intern" als schmale
Checkbox-Spalte ohne erkennbaren Bezug.

**Vorschlag [offen]:** Für Inline-Edit-Spalten immer den aktuellen Wert anzeigen und das
Chevron nur als Affordanz danebenstellen — ein leeres Feld mit Pfeil liest sich als Fehler.

---

## 9 · Uneinheitliche Symbole für dieselbe Funktion

**Befund.** „Spalten" trägt auf Projekte ein `SlidersHorizontal`, auf Rechnungen ein
Zahnrad. Gleiche Funktion, zwei Symbole.

**Vorschlag [offen]:** `SlidersHorizontal` überall (steht so schon in CLAUDE.md unter
„Column chooser"). Zahnrad bleibt den Einstellungen vorbehalten.

---

## 10 · Vertikaler Platz auf dem Handy

**Befund vorher (390×844).** Kopfzeile + Seitentitel (32 px) + **drei Zeilen Tabs** +
zwei Zeilen Filter + Toolbar = der Inhalt begann bei rund einem Drittel der Bildschirmhöhe.

**[erledigt]** Titel auf die Token-Größe (20 px), Tabs auf eine seitlich scrollende Zeile.
Gewinn: rund 215 px, entspricht drei zusätzlichen Datenzeilen.

**[offen]** Filterleiste auf dem Handy hinter einen „Filter"-Knopf mit Zähler legen
(`Filter (2)`), statt vier Chips über zwei Zeilen zu verteilen.

---

## 11 · Suche

**Befund.** Das Suchfeld ist sehr breit (≈ 360 px auf Desktop), hat kein Symbol und keine
Möglichkeit, die Eingabe zu löschen.

**Vorschlag [offen]:** Lupe (`Search`) links im Feld, `×` zum Leeren sobald Text drin steht,
Breite auf ca. 280 px begrenzen — der gewonnene Platz geht an die Filter.

---

## Reihenfolge für die Umsetzung

**Als Nächstes (hoher Nutzen, klar umrissen)**
1. Zeile anklickbar + Aktionen auf max. 2 sichtbare reduzieren (§4)
2. Aktionsspalte rechts fixieren, damit sie nicht abgeschnitten wird (§4)
3. Toolbar-Zonen vereinheitlichen, Trefferzahl an die Tabelle (§5)
4. Paginierung nur bei > 1 Seite (§6)

**Danach**
5. Formensprache konsequent (Pille nur für Filter/Status) (§1)
6. Mobile Filterleiste einklappen (§10)
7. Suchfeld mit Symbol und Löschen (§11)
8. „Abrechenbare Projekte" einklappen, wenn leer (§7)

**Kleinigkeiten**
9. Einheitliches Spalten-Symbol (§9)
10. Inline-Edit-Spalten mit Wert statt nacktem Chevron (§8)

---

## Anmerkung zur Methode

Zwei der gravierendsten Befunde dieser Runde (`.master-title` und die fehlenden
Button-Klassen) waren **keine Gestaltungsfehler, sondern Lücken**: im Code benutzte
Klassen, die im Stylesheet nie existierten und still auf Browser-Defaults zurückfielen.
Ein Abgleich „im TSX verwendet vs. im CSS definiert" fand 72 solcher Namen — nach Abzug
der Parser-Artefakte bleiben rund ein Dutzend echte. Derselbe Abgleich für CSS-Variablen
hatte zuvor neun undefinierte Tokens gefunden.

**Empfehlung:** beide Prüfungen als Lint-Schritt in CI aufnehmen. Sie sind billig und
hätten jeden dieser Fehler beim Entstehen gemeldet.

---

## Nachtrag August 2026 — Angebote-Liste und offene Punkte

Die Angebote-Liste war bis dahin **nie sichtbar geprüft**, weil die
Test-Fixture keine Angebote lieferte. Nach Ergänzung der Fixture zeigte
sich:

| Befund | Status |
|---|---|
| Zeilenhöhen schwankten zwischen 56 und 96 px (Titel brach bis vierzeilig um) | behoben — einzeilig mit Auslassung, Volltext im `title` |
| „Öffnen" in jeder Zeile wiederholt | behoben — Zeile anklickbar, Nr. als Link |
| Trefferzahl in der Bedienleiste statt an der Tabelle | behoben |
| Tabelle überläuft **schon auf dem Desktop** (1204 px in 1048 px Container) | offen |
| Keine Filter-Chips (nur Suche + eine Checkbox) — anders als alle anderen Listen | behoben — Status und Ansprechpartner in einer `FilterBar` |

**Warum die fixierte Aktionsspalte hier (noch) nicht geht:** Die Zeilen
zeigen je nach Status unterschiedlich viele Knöpfe (Beauftragen, Ablehnen,
Projekt öffnen). Die Spalte bekommt dadurch pro Zeile eine andere Breite
und überlappt fixiert die Daten — im Versuch reproduziert und wieder
zurückgenommen. Voraussetzung wäre ein **konstanter Satz Inline-Aktionen
plus ⋯-Menü**, wie in der Rechnungsliste.

Dem steht entgegen, dass `RowMenu` **zweimal lokal implementiert** ist
(`RechnungenListe.tsx` und `MahnungenListe.tsx`, mit unterschiedlichen
Signaturen). Der sinnvolle nächste Schritt ist daher: `RowMenu` nach
`components/ui/` heben, dann Angebote darauf umstellen. Damit ließe sich
auch die Aktionsspalte fixieren.

Weitere offene Punkte in derselben Kerbe:
- Dialog-Fußzeilen: erledigt, siehe unten.
- Wizards (Abschlags-/Schlussrechnung) sind auf dem Handy nie geprüft
  worden; `StepIndicator` liegt 5× kopiert vor.

### Nachgezogen: FilterChip zusammengeführt

`FilterChip` lag **zehnmal lokal** in den Seiten — die frühere CLAUDE.md
schrieb das sogar so vor („copy pattern from `HonorarWizard.tsx`"). Die
Kopien waren nicht identisch: eine ohne `type="button"` (löst in einem
Formular ein Absenden aus), eine mit `{value,label}`-Optionen, eine mit
„Zurücksetzen" im Menü statt als ×, unterschiedliche Prop-Namen
(`active` vs. `selected`). Keine reagierte auf Escape.

Alle elf Verwendungen hängen jetzt an `components/ui/FilterChip.tsx`.
Zwei Trefferflächen, die dadurch an einer Stelle korrigierbar wurden:

| Element | vorher | jetzt |
|---|---|---|
| ×-Feld am aktiven Chip | 18 × 18 px | 24 × 24 (Touch: 28 × 28) |
| Zeilen im Aufklappmenü | 32 px | 44 px auf Touch-Geräten |

18 × 18 lag unter der Untergrenze aus WCAG 2.5.8; die Menüzeilen liegen
direkt übereinander, ein Fehlgriff wählte den Nachbarfilter.

`tests/filters.spec.ts` deckt das Verhalten seitdem ab (Eingrenzen,
Zähler, Escape mit Fokusrückgabe, Zurücksetzen) — auf beiden Viewports.

### Nachgezogen: Dialog-Fußzeilen vereinheitlicht

Der eigentliche Befund war nicht die Duplizierung, sondern die **Reihenfolge**.
`ConfirmModal` — mit 24 Verwendungen die Fußzeile, die man im Produkt am
häufigsten sieht — setzt Abbrechen links, die Aktion rechts. **13 Dialoge
machten es genau umgekehrt**: Speichern links, Abbrechen rechts. Wer im
Adressbuch speichert und danach in den Einstellungen speichert, trifft
dieselbe Position mit gegenteiliger Wirkung.

Alle 22 Fußzeilen laufen jetzt über `components/ui/DialogFooter.tsx`.
Verbindlich: **Abbrechen links, Hauptaktion rechts.**

Nebenbefunde, die dabei sichtbar wurden:

| Befund | Korrektur |
|---|---|
| Abbrechen war mal `.btn-secondary`, mal `.btn`, mal ein Knopf **ohne Klasse** | überall `.btn-secondary` (`.btn` ist damit identisch definiert) |
| Knöpfe unterschiedlich hoch: 38 px (`.btn-secondary`) neben 43 px (`.btn-primary`) | beide 40 px, auf Touch 44 px |
| Auf 390 px drängten sich beide in den rechten 190 px, keiner erreichte 44 px | teilen sich auf dem Handy die volle Breite |
| Drei lange Knöpfe (Storno-Dialog) wären auf je 110 px gequetscht worden | Basis 140 px — der lange Knopf bricht auf eine eigene Zeile um |
| „Schliessen" statt „Schließen" in `ValidationModal` | korrigiert |
| Mehrere Knöpfe ohne `type="button"` | ergänzt (in einem `<form>` wäre das ein Absenden) |

Nicht migriert, weil es keine Dialog-Fußzeilen sind: die Speicherzeile in
den Einstellungen (`AdminPage`), der Aktionsblock der Budget-Regeln und
der PDF-Knopf über dem Honorar-Wizard. Dort wäre der am unteren
Dialogrand klebende Balken falsch.

`tests/dialogs.spec.ts` prüft Reihenfolge, gleiche Höhe und 44 px auf dem
Handy.

### Nachgezogen: Ladezustände

Das Produkt hatte **keinen einzigen Ladeplatzhalter**. An 52 Stellen stand
nur „Laden …" — als 13-px-Zeile links oben in einer rund 500 px hohen
leeren Fläche (gemessen auf `/projekte` und `/rechnungen`).

Der schwerere Befund kam beim Nachsehen ans Licht: die Trefferzahl in der
Bedienleiste rendert unabhängig vom Ladezustand und behauptete währenddessen
**„0 Einträge"**. Auf einer langsamen Verbindung liest sich das nicht als
„lädt", sondern als „du hast keine Rechnungen". Jetzt steht dort
„… Einträge", bis die Daten da sind.

Umgesetzt:

| Ort | vorher | jetzt |
|---|---|---|
| 10 Listen | „Laden …" | Platzhaltertabelle in Form der kommenden Liste |
| Übersicht | zentriertes „Laden …" | Kennzahlkacheln + Platzhaltertabelle |
| Trefferzahl (3 Listen) | „0 Einträge" | „… Einträge" |
| Screenreader | keine Ansage | `role="status"` + „Liste wird geladen …" |

Der Platzhalter selbst trägt `aria-hidden` — eine Reihe leerer Kästen ist
für Screenreader wertlos, die Ansage übernimmt die Statuszeile. Unter
`prefers-reduced-motion` läuft kein Schimmern; die globale Regel setzt die
Dauer nur auf 0,01 ms, wodurch der Verlauf an beliebiger Stelle stehen
bliebe — deshalb dort ausdrücklich eine ruhige Fläche.

Nicht umgestellt: `AdminPage` (dort folgt ein Formular, keine Tabelle).

**Zwei Funde als Nebenwirkung.** Damit der Ladezustand der Übersicht
überhaupt sichtbar wird, musste die Test-Fixture eine Dashboard-Rolle
setzen — vorher zeigte die Seite im Test nur die Rollenauswahl, das
eigentliche Dashboard war **nie geprüft**. Dabei fielen auf:

1. `snapshot?.kpis.auftragsreichweite` — die Optional-Kette schützte nur
   `snapshot`, nicht `kpis`. Eine unvollständige Antwort riss die ganze
   Übersicht mit einem Laufzeitfehler ab (weiße Seite). An 4 Stellen
   nachgezogen.
2. Zwei Barrierefreiheits-Verstöße, die der bestehende axe-Test nicht sehen
   konnte: das Auswahlfeld „Zeitraum" hatte keinen zugänglichen Namen
   (`select-name`, kritisch — die Beschriftung ist ein `<span>`, kein
   `<label>`), und die drei Chart.js-Diagramme rendern ein
   `<canvas role="img">` ohne Alternativtext (`role-img-alt`).

`tests/loading.spec.ts` deckt Platzhalter, Trefferzahl und die
Screenreader-Ansage ab.
