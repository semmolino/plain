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
