# Leistungsbilder im Kalkulationsmodul — Bestand, Lücken, Reihenfolge

Stand: 18.08.2026 (HOAI 2021 + 2013 vollständig, Objektlisten, AHO Heft 9+17, Zuschlagskatalog; offen: Zonen-Punktesystem, AHO Heft 15)

Was das Kalkulationsmodul heute kann, was fehlt, und in welcher Reihenfolge
die Lücken geschlossen werden. Betrifft `FEE_*`-Stammdaten,
`services/stammdaten.js` (Tafel-Interpolation), `services/din276.js`
(anrechenbare Kosten) und den `HonorarWizard`.

---

## 1. Bestand

Der **preisrechtlich verbindliche Teil der HOAI (Teil 2–4) ist vollständig**
abgebildet — 14 Leistungsbilder:

| Teil | Leistungsbilder | Zonen | Bemessungsgrundlage |
|---|---|---|---|
| 2 Flächenplanung | Flächennutzungsplan (§ 18), Bebauungsplan (§ 19) | 3 | Fläche (ha) |
| 2 Landschaftsplanung | Landschaftsplan (§ 23), Grünordnungsplan (§ 24), Landschaftsrahmenplan (§ 25), Landschaftspflegerischer Begleitplan (§ 26), Pflege- und Entwicklungsplan (§ 27) | 3 | Fläche (ha) |
| 3 Objektplanung | Gebäude, Innenräume (§ 34/35), Freianlagen (§ 39), Ingenieurbauwerke (§ 43), Verkehrsanlagen (§ 47) | 5 | anrechenbare Kosten (€) |
| 4 Fachplanung | Tragwerksplanung (§ 51), Technische Ausrüstung (§ 55) | 5 / 3 | anrechenbare Kosten (€) |

Die Phasenprozentsätze summieren sich bei allen 14 auf exakt 100; die
Tafelgrenzen stimmen mit §§ 35/40/44/48/52/56 überein.

### Datenmodell

```
FEE_GROUPS   Honorarordnung          ("HOAI 2021")
 └ FEE_MASTERS   Leistungsbild        MIN/MAX, BASE_TYPE
    ├ FEE_ZONES    Honorarzonen       NAME_SHORT = I…V (Code mappt darauf!)
    ├ FEE_PHASE    Leistungsphasen    FEE_PERCENT, Summe 100
    └ FEE_TABLES   Honorartafel       BASE + ZONE_1…ZONE_TOP
```

`ZONE_1…ZONE_TOP` sind **Bandgrenzen, keine Zonenwerte**: „bis" der Zone n ist
„von" der Zone n+1. Sechs Spalten tragen damit fünf Zonen; bei dreizonigen
Leistungsbildern bleiben `ZONE_5`/`ZONE_TOP` auf 0. Diese Invariante wurde
gegen den amtlichen Volltext geprüft (200/200 Übergänge lückenlos) — sie ist
Voraussetzung dafür, dass die Spaltenkompression verlustfrei ist.

---

## 2. HOAI Anlage 1 — Weitere Fachplanungs- und Beratungsleistungen

**Anlage 1** (§ 3 Abs. 1) ist mit Migration 0119 vollständig abgebildet.
Sieben Honorartafeln:

| HOAI | Leistungsbild | Zonen | Bemessungsgrundlage | Tafelbereich | Status |
|---|---|---|---|---|---|
| 1.1.2 | Umweltverträglichkeitsstudie | 3 | Fläche (ha) | 50–10.000 ha | **erledigt** (0118) |
| 1.2.3 | Wärmeschutz und Energiebilanzierung | 5 | anrechenbare Kosten (€) | 250 T–25 Mio | **erledigt** (0116) |
| 1.2.4 | Bauakustik | 3 | anrechenbare Kosten (€) | 250 T–25 Mio | **erledigt** (0116) |
| 1.2.5 | Raumakustik | 5 | anrechenbare Kosten (€), je Innenraum | 50 T–7,5 Mio | **erledigt** (0116) |
| 1.3.4 | Geotechnik | 5 | anrechenbare Kosten (€) | 50 T–25 Mio | **erledigt** (0117) |
| 1.4.8 (1) | Ingenieurvermessung — Planungsbegleitende Vermessung | 5 | **Verrechnungseinheiten** | 6–11.726 VE | **erledigt** (0119) |
| 1.4.8 (2) | Ingenieurvermessung — Bauvermessung | 5 | anrechenbare Kosten (€) | 50 T–10 Mio | **erledigt** (0119) |

Quelle: HOAI vom 10.07.2013 (BGBl. I S. 2276; Anlage 1: BGBl. I 2013,
2306–2323), zuletzt geändert durch Art. 3 G v. 22.03.2023 — die als
„HOAI 2021" bekannte Fassung. Seit 2021 sind die Honorarspannen
**Orientierungswerte**, keine verbindlichen Mindest-/Höchstsätze.

---

## 3. Bekannte Modell-Lücken

Diese Punkte sind der eigentliche Aufwand — der reine Stammdaten-Import ist
der kleinere Teil.

### 3.1 `BASE_TYPE` kennt nur `cost_eur` und `area_ha` — gelöst (0119)

Die Ingenieurvermessung (1.4.8 Abs. 1) rechnet in **Verrechnungseinheiten**.
Dritter `BASE_TYPE`-Wert `verrechnungseinheiten` ergänzt:
`chk_fee_masters_base_type` (0119), `FeeBaseType`-Union in `api/fee.ts`,
`HonorarWizard.tsx` (`isSingleValue` ersetzt das bisherige `isAreaHa` an den
Stellen, die nur „ein Basisfeld statt K0..K4" bedeuten; `isAreaHa` bleibt für
die Label-/Filter-Wahl), `services_pdf_render.js` + `honorar.njk` (neuer
Nunjucks-Filter `verrechnungseinheiten`, Suffix „ VE"). Die
Tafel-Interpolation selbst (`calculateRevenueFields` in `stammdaten.js`) war
bereits einheitenagnostisch — keine Änderung nötig.

### 3.2 Leistungsbilder ohne LPH-Nummerierung — gelöst (0117)

`feePhaseSortKey()` in `services/stammdaten.js` zog die erste Zahl aus
`NAME_SHORT` („LPH 1" → 1) und lieferte sonst `MAX_SAFE_INTEGER` — dann
sortierten alle Phasen gleich und die Reihenfolge wurde instabil. Bauphysik
war davon nicht betroffen (LPH 1–7), Geotechnik (Teilleistungen „TL a"/„TL
b"/„TL c", keine Ziffer im Namen) schon. Gelöst durch `FEE_PHASE.SORT_ORDER`
(nullable, Migration 0117): `feePhaseSortKey()` bevorzugt jetzt `SORT_ORDER`,
wenn gesetzt, sonst Namens-Parsing wie bisher — die 17 bestehenden
Leistungsbilder bleiben unverändert (ihr `SORT_ORDER` ist `NULL`). Künftige
Leistungsbilder ohne LPH-Nummerierung setzen `SORT_ORDER` explizit.

### 3.3 Anrechenbare Kosten je Leistungsbild

`RULES` in `services/din276.js` wirft für jeden nicht registrierten Schlüssel.
Jedes neue Leistungsbild braucht seinen eigenen Regelsatz — die Regeln weichen
stärker voneinander ab, als es auf den ersten Blick wirkt (siehe Bauphysik
unten). Stand der Regeln und der bewusst offen gelassenen Sonderfälle: § 12.

### 3.4 Zuschlagskatalog — gelöst (0126)

`FEE_SURCHARGES` war leer; Umbau-/Modernisierungszuschlag (§ 6/§ 36),
Instandsetzung (§ 12), Wiederholungsminderung (§ 11) und Nebenkosten (§ 14)
tippte jede Nutzerin frei ein. Migration 0126 befüllt den Katalog samt
Vorschlagswert, gesetzlicher Obergrenze und Fundstelle — Details in § 13.

### 3.5 Honorarzonen-Einstufung — Objektlisten gelöst (0120/0124), Punktesystem offen

Die Zone wurde bisher immer direkt geschätzt. Wichtige Erkenntnis beim
Startversuch (Tragwerksplanung, siehe § 7 unten): Es gibt **kein
einheitliches Punktesystem über alle Leistungsbilder** — zwei
unterschiedliche Mechanismen:

- **Objektliste** (Zeile auswählen, Zone direkt ablesbar, keine Arithmetik):
  Gebäude/Innenräume (Anlage 10.2/10.3 zu § 35), Freianlagen (11.2 zu § 40),
  Ingenieurbauwerke (12.2 zu § 44), Verkehrsanlagen (13.2 zu § 48),
  Technische Ausrüstung (15.2 zu § 56), Tragwerksplanung (14.2 zu § 52 — trotz
  der Paragraphenformulierung „Bewertungsmerkmale" tatsächlich eine
  Zeilen-Auswahl-Tabelle wie die anderen fünf, keine Punkte-Summierung).
  **Tabelle `FEE_ZONE_LOOKUP` — vollständig befüllt (0120 + 0124).**
- **Numerisches Punktesystem** (mehrere Kriterien einzeln bepunkten, Summe
  bandet in eine Zone): UVS (Anlage 1.1.2), Ingenieurvermessung
  (Anlage 1.4.3/1.4.6), vermutlich auch Bauleitplanung (§ 21) und
  Landschaftsplanung (§ 32) — deren Bewertungsmerkmale sind noch nicht mit
  Primärquelle verifiziert (bisherige Recherche kam aus einer unzuverlässigen
  Zusammenfassung, nicht aus dem Volltext). Braucht eine andere Tabelle
  (Kriterien + Punktwerte je Kriterium + Zonen-Schwellen) — noch nicht
  gebaut.

Wer weitermacht: § 7 unten für den Stand; offen ist nur noch das Punktesystem.

---

## 4. Erledigt: Anlage 1 vollständig (UVS, Bauphysik, Geotechnik, Ingenieurvermessung)

### Anlage 1.1 Umweltverträglichkeitsstudie (Migration 0118)

Reines Datenupdate, keine Codeänderung — strukturell identisch zur
bestehenden Landschaftsplanung: `BASE_TYPE = 'area_ha'` (existiert bereits),
vier LPH-nummerierte Phasen (3/37/50/10 %, wortgleich mit Landschaftsplan),
drei Honorarzonen, keine anrechenbaren Kosten in € → kein Eintrag in
`services/din276.js` nötig. `BASE_TYPE` wird in Frontend (`HonorarWizard.tsx`),
Backend-Controller und PDF-Template durchgehend aus der DB gelesen, nie nach
`FEE_MASTER_ID` verzweigt — ein neues `area_ha`-Leistungsbild erscheint damit
automatisch überall, ohne Codeänderung.

Die Zonen-Einstufung folgt einem Punktesystem (Anlage 1.1.2 Abs. 4–6,
Bewertungsmerkmale × Gewichtung), das die Software nicht abbildet — die
Nutzerin wählt die Zone direkt. Das ist keine UVS-spezifische Lücke, sondern
die allgemeine unter 3.5 dokumentierte.

### Anlage 1.2 Bauphysik (Migrationen 0115/0116)

**Drei getrennte `FEE_MASTERS`**, weil jedes Teilgebiet eine eigene
Honorartafel und eine eigene Zonenanzahl hat. Das Leistungsbild
(Anlage 1.2.2 Abs. 1) ist für alle drei identisch: sieben Leistungsphasen mit
3/20/40/6/27/2/2 Prozent. **LPH 8/9 gibt es nicht** — Bauphysik endet mit der
Mitwirkung bei der Vergabe.

Die anrechenbaren Kosten weichen je Teilgebiet ab:

| Teilgebiet | Regel | Registry-Schlüssel |
|---|---|---|
| Wärmeschutz | anrechenbare Kosten des Gebäudes nach § 33, Honorarzone nach § 35 — erbt die 25-/50-%-Kappung für fremdgeplante KG 400 | `bauphysik_waerme` |
| Bauakustik | KG 300 + KG 400 **voll**, ohne Kappung, ohne selbst/fremd-Unterscheidung | `bauphysik_bauakustik` |
| Raumakustik | **je Innenraum**: (KG 300 + KG 400) × Rauminhalt / Bruttorauminhalt, zzgl. KG 610 des Innenraums voll | `bauphysik_raumakustik` |

Die Kappung des § 33 gilt nur dem Gebäudeplaner — sie auf die Bauakustik zu
übertragen wäre der naheliegende, aber falsche Weg.

Raumakustik braucht zwei Größen, die nicht aus der Kostenermittlung stammen:
Rauminhalt des Innenraums und Bruttorauminhalt des Gebäudes. Beide kommen als
Query-Parameter an `GET /din276/estimates/:id/anrechenbar`. Für mehrere Räume
ist je Raum eine eigene Berechnung anzulegen.

### Anlage 1.3 Geotechnik (Migration 0117)

Fünf Honorarzonen, 50.000–25.000.000 € anrechenbare Kosten. Zwei
Besonderheiten, keine davon ein neuer Regelsatz:

- **Kein LPH-Schema.** Drei Teilleistungen a/b/c (15/35/50 %) statt LPH 1–9 —
  siehe 3.2. `FEE_PHASE.SORT_ORDER` löst das jetzt allgemein, nicht nur für
  Geotechnik.
- **Keine eigene Anrechenbarkeits-Regel.** Anlage 1.3.2 Abs. 1 verweist
  direkt auf „die anrechenbaren Kosten der Tragwerksplanung nach § 50 Absatz
  1 bis 3 für das gesamte Objekt aus Bauwerk und Baugrube". Baugrube ist in
  DIN 276-1:2008-12 KG 310, also bereits Teil von KG 300 — die bestehende
  Tragwerk-Regel (55 % KG 300 + 10 % KG 400) deckt das ab.
  `anrechenbareKostenGeotechnik()` in `services/din276.js` ist deshalb nur
  ein Alias auf `anrechenbareKostenTragwerk()`, Registry-Schlüssel
  `geotechnik`.

### Anlage 1.4 Ingenieurvermessung (Migration 0119)

Zwei Leistungsbilder, zwei Honorartafeln — Planungsbegleitende Vermessung
(1.4.8 Abs. 1, 6–11.726 VE) und Bauvermessung (1.4.8 Abs. 2, 50T–10 Mio €).

- **Dritter `BASE_TYPE`**: `verrechnungseinheiten`. Löst 3.1. Die
  VE-Summe wird direkt eingetragen (VE = Fläche × Punktdichte-Faktor,
  Anlage 1.4.2 Abs. 3 — keine Flächenklassen-Rechenhilfe gebaut, dieselbe
  Vereinfachung wie bei `area_ha`).
- **Bauvermessungs anrechenbare Kosten bewusst NICHT in `din276.js`**:
  Anlage 1.4.5 Abs. 2 verlangt 80 % (Gebäude/Verkehrsanlagen) bzw. 100 %
  (Ingenieurbauwerke) der Herstellungskosten nach § 33/§ 42/§ 46 — wir haben
  aber nur § 33 (`anrechenbareKostenGebaeude`). § 42 (Ingenieurbauwerke) und
  § 46 (Verkehrsanlagen) fehlen **auch für ihre eigenen Leistungsbilder**
  (Masters 11/12 existieren seit 0115, haben aber nie eine DIN276-Regel
  bekommen — Nutzerinnen tragen die anrechenbaren Kosten dort schon heute
  direkt ein). Eine Bauvermessungs-Regel jetzt zu bauen hieße, auf zwei
  fehlenden Regeln aufzusetzen. Zurückgestellt, bis § 42/§ 46 anstehen.
- **Nicht abgebildet**: Anlage 1.4.7 Abs. 4 (LPH 4 bei Gebäuden abweichend
  45–62 % statt pauschal 62 %) — Objektart-Abhängigkeit wie bei den meisten
  Sonderfällen nicht modelliert, manuell in der Berechnung anzupassen.

---

## 5. Bestandskorrekturen in 0115

- **Doppelte Honorarzonen der Technischen Ausrüstung.** `FEE_MASTER_ID` 14
  hatte I/II/III zweimal (IDs 6–8 und 55–57); im Zonen-Dropdown erschien jede
  Zone doppelt. 0115 löscht die Dubletten — aber nur, wenn keine Berechnung
  daran hängt — und legt danach einen Unique-Index, der die Wiederkehr
  verhindert. Der Index entsteht bewusst **nach** dem `DELETE`: davor
  scheiterte er an genau den Zeilen, die er künftig ausschließt.
- **Stammdaten lagen nicht im Repo.** Weder Schema noch Daten der
  `FEE_*`-Referenztabellen waren versioniert — eine frische Datenbank hatte
  null Leistungsbilder. 0115 holt beides nach, idempotent und unter
  Beibehaltung der Produktions-IDs (`FEE_CALCULATION_MASTER` referenziert
  sie).

---

## 6. Reihenfolge

Anlage 1 (1–4) abgeschlossen. Ab hier vom User am 18.08.2026 priorisiert,
„alle vier, von oben nach unten":

1. ~~Anlage 1.2 Bauphysik~~ — erledigt (0115/0116)
2. ~~Anlage 1.3 Geotechnik~~ — erledigt (0117), inkl. `SORT_ORDER` (3.2)
3. ~~Anlage 1.1 Umweltverträglichkeitsstudie~~ — erledigt (0118)
4. ~~Anlage 1.4 Ingenieurvermessung~~ — erledigt (0119), inkl. `BASE_TYPE`
   `verrechnungseinheiten` (3.1). **Anlage 1 ist damit vollständig.**
5. **Honorarzonen-Einstufung** (3.5) — **Objektlisten-Variante vollständig**
   (0120 Tragwerksplanung, 0124 die übrigen sechs Listen für beide
   HOAI-Fassungen). Offen bleibt nur das **numerische Punktesystem**
   (UVS/Ingenieurvermessung/vermutlich Bauleitplanung+Landschaftsplanung) —
   andere Struktur, braucht eine eigene Tabelle (Kriterien + Punktwerte +
   Zonen-Schwellen), siehe § 7.
6. ~~§ 42 (Ingenieurbauwerke) / § 46 (Verkehrsanlagen) in `din276.js`~~ —
   erledigt, siehe § 8 unten. Damit ist eine spätere Bauvermessungs-Regel
   (Anlage 1.4.5 Abs. 2, siehe Anlage-1.4-Abschnitt oben) **nicht mehr
   blockiert** — aber noch nicht gebaut (nicht Teil dieser Anfrage; braucht
   zusätzlich einen Objektart-Selector Gebäude/Ingenieurbauwerk/
   Verkehrsanlage + die 80-/100-%-Regel).
7. **AHO-Hefte und weitere Kalkulationstypen** — Heft 9 (0121) und Heft 17
   (0122) angelegt, siehe § 9 oben. Heft 9 ohne Leistungsphasen (fehlende
   geprüfte Quelle), Heft 17 vollständig inkl. eigener Honorarformel und
   Leistungsphasen (Quelle vorhanden und verifiziert). Heft 15 (SiGeKo)
   zurückgestellt: gezielt gesucht, aber **keine belastbare Quelle** —
   AKBW-PDF ist von 2002 und rät selbst von Tafeln ab, VSGK-Seite enthält
   keine Werte, zwei Online-Rechner (bauformeln.de, sicherheitsingenieur.nrw)
   verbergen die Formel hinter Login/JS. Ohne Quelle nicht bauen.
8. ~~**HOAI 2013** als zweite `FEE_GROUPS`-Zeile~~ — erledigt (0123), siehe
   § 10 unten. **Offen bleibt** die Vorbelegung der Honorarordnung nach
   Vertragsdatum (Verträge vor 2021 → HOAI 2013); aktuell wählt die Nutzerin
   sie im Wizard weiterhin selbst.
9. ~~**Zuschlagskatalog** (3.4)~~ — erledigt (0126), siehe § 13 unten.

### Was danach noch offen ist

| Thema | Warum offen |
|---|---|
| Zonen-**Punktesystem** (UVS, Vermessung, evtl. Bauleitplanung/Landschaftsplanung) | andere Struktur als die Objektliste, braucht eigene Tabelle — § 7 |
| **Vorbelegung Honorarordnung** nach Vertragsdatum | klein, aber erst seit 0123 überhaupt relevant |
| **AHO Heft 15** (SiGeKo), **Heft 9 Leistungsphasen** | keine belastbare Quelle gefunden — nicht ohne bauen |
| **Bauvermessungs-Anrechenbarkeit** (Anlage 1.4.5 Abs. 2) | nicht mehr blockiert (§ 42/§ 46 da), braucht Objektart-Selektor + 80/100-%-Regel |
| **§ 11 Abs. 2** (mehrere Objekte → Summe der anrechenbaren Kosten) | keine Zuschlagszeile, sondern andere Berechnungsgrundlage — § 13 |
| Restliche `⚠️`-Vereinfachungen in `din276.js` | bewusst offen, jeweils im Code begründet — § 12 |

---

## 7. Honorarzonen-Objektliste (Migrationen 0120 + 0124, vollständig)

Neue globale Referenztabelle `FEE_ZONE_LOOKUP` (`FEE_MASTER_ID`, `CATEGORY`,
`DESCRIPTION`, `ZONE_ID`, `SORT_ORDER`) — pro Zeile ein Sachverhalt, der
genau einer Honorarzone zugeordnet ist. Neue Komponente
`ObjektlisteZonePicker.tsx`: Button „Zone anhand Objektliste bestimmen …"
neben dem Zonen-Dropdown im `HonorarWizard` (Schritt Basisdaten), öffnet ein
Modal mit Suche + nach `CATEGORY` gruppierter Liste; ausgewählte Zeile setzt
`ZONE_ID`, bleibt danach im Dropdown frei überschreibbar. Endpoint
`GET /stammdaten/fee-zone-lookup?fee_master_id=…`, fängt eine noch nicht
gelaufene Migration ab (leeres Array statt 500, da Deploy und manuelle
Migration zeitlich auseinanderfallen).

**Befüllt: Tragwerksplanung** (Anlage 14.2 zu § 52), 54 Zeilen in 14
fachlichen Kategorien (Stützwände/Verbau, Gründung, Mauerwerk, Gewölbe,
Deckenkonstruktionen, Verbund-Konstruktionen, Rahmen-/Skelettbauten u. a.),
maschinell aus dem amtlichen Volltext geparst (54/54 Zeilen mit genau einer
Zonen-Markierung, keine Warnungen). `ZONE_ID`-Zuordnung fest verdrahtet auf
die Tragwerksplanung-Zonen aus 0115 (I=50 … V=54) — bei weiteren
Leistungsbildern jeweils die passenden `FEE_ZONES`-IDs für dieses
Leistungsbild nachschlagen, nicht die von Tragwerksplanung wiederverwenden.

### Die übrigen sechs Objektlisten (Migration 0124)

Mit 0124 ist die Objektlisten-Variante **vollständig** — 956 Zeilen, je einmal
für HOAI 2021 und HOAI 2013:

| Anlage | Leistungsbild | Zeilen | Kategorien | Zonen |
|---|---|---|---|---|
| 10.2 | Gebäude | 88 | 9 | 5 |
| 10.3 | Innenräume | 65 | 9 | 5 |
| 11.2 | Freianlagen | 59 | 7 | 5 |
| 12.2 | Ingenieurbauwerke | 170 | 7 Gruppen | 5 |
| 13.2 | Verkehrsanlagen | 35 | 9 | 5 |
| 15.2 | Technische Ausrüstung | 61 | 9 Anlagengr. | **3** |

Drei Eigenheiten, die der erste Parser (nur Anlage 14) noch nicht kannte und
die `parse_objektliste2.js` jetzt abdeckt:

- **Variable Zonenzahl**: TGA hat nur drei Honorarzonen (4 Tabellenspalten
  statt 6), alle übrigen fünf.
- **Eine Liste über mehrere `<table>`-Elemente**: Anlage 12
  (Ingenieurbauwerke) ist im HTML in sieben Tabellen zerlegt — vermutlich
  Seitenumbrüche im Original. Alle sieben gehören zu 12.2.
- **Zwei Kategoriezeilen-Varianten**: fett mit `colspan` (Anlagen
  10/11/13/14/15) *oder* fett mit nur zwei Zellen ohne `colspan`
  (Anlage 12: „Gruppe 1 – …"). Ohne die zweite Variante fielen alle 170
  Ingenieurbauwerk-Zeilen in eine einzige Kategorie.

**Mehrfachzonen sind echter Verordnungsinhalt.** Die HOAI markiert etliche
Objekte in zwei Zonen (z. B. „Einfamilienhäuser … in verdichteter Bauweise" =
III *oder* IV) — gegen das Quell-HTML gegengeprüft, kein Parser-Artefakt.
Abgebildet als je eine Zeile pro Zone; der Picker zeigt die Beschreibung dann
zweimal mit unterschiedlicher Zonenangabe und weist im Hinweistext darauf hin.
Betrifft 29 der 88 Gebäude-Einträge, 12 von 65 bei Innenräumen, 19 von 59 bei
Freianlagen.

**Vorgehen**: Der Parser wurde vorab gegen die bereits eingespielte
Tragwerksplanung-Liste validiert (54/54 Zeilen identisch reproduziert), bevor
er auf die neuen Anlagen losgelassen wurde — so ist ausgeschlossen, dass eine
Parser-Änderung den Bestand still verändert. Nachgelagert geprüft: keine
ID-Duplikate, keine Kollision mit 0120, jede `ZONE_ID` gehört zum jeweiligen
`FEE_MASTER_ID`, keine leeren Beschreibungen.

**Noch offen**: das **numerische Punktesystem** (UVS, Ingenieurvermessung,
vermutlich Bauleitplanung/Landschaftsplanung — Letztere noch nicht mit
Primärquelle verifiziert). Strukturell etwas anderes: mehrere Kriterien
einzeln bepunkten, Summe bandet in eine Zone. Braucht eine eigene Tabelle
(Kriterien + Punktwerte je Kriterium + Zonen-Schwellen), nicht
`FEE_ZONE_LOOKUP`.

---

## 8. § 42 Ingenieurbauwerke / § 46 Verkehrsanlagen in `din276.js`

Beide Leistungsbilder existieren seit Migration 0115 (Masters 11/12), hatten
aber nie eine Anrechenbarkeits-Regel — Nutzerinnen mussten die anrechenbaren
Kosten frei eintippen, ohne DIN276-Editor-Unterstützung.

**Beide Vorschriften (Abs. 1–3) sind im Kostenzuschnitt identisch** und
parallel zu § 33 Gebäude aufgebaut: KG 300 voll, KG 400 selbst geplant voll/
fremd geplant 25-/50-%-Schwelle (dieselben Prozentsätze wie bei Gebäude).
**Ein Unterschied zu Gebäude**: KG 500 (Außenanlagen/Erschließung/Leitungen)
ist hier NICHT grundsätzlich ausgeschlossen wie bei Gebäude, sondern wird —
wie KG 200/600 — anrechenbar, sobald der Auftragnehmer sie selbst plant oder
überwacht.

Trotz identischen Zuschnitts **zwei getrennte Funktionen**, kein Alias: Anders
als bei Geotechnik/Tragwerksplanung verweist der Gesetzestext von § 46 nicht
auf § 42 — die Übereinstimmung ist Zufall der Formulierung, kein rechtlicher
Verweis. Eine Änderung an einer der beiden Vorschriften soll die andere nicht
mitziehen.

**Bewusst nicht abgebildet** (§ 46 Abs. 4/5): Erdarbeiten-Sonderregel (bis
40 % zusätzlich anrechenbar, nur LPH 1–7+9), Zuschlag für nicht selbst
betreute Ingenieurbauwerke (10 %), Degression bei mehrstreifigen
Straßen/mehrgleisigen Bahnanlagen. Alle drei sind leistungsphasen- bzw.
objektabhängig und passen nicht in dieses Modul, das einen einzelnen
K0-Wert liefert statt Werte je LPH — bräuchten eine strukturelle Erweiterung
des DIN276-Moduls, nicht nur eine neue Regel.

**Folge**: Die in Anlage 1.4 zurückgestellte Bauvermessungs-Regel
(80 %/100 % von § 33/§ 42/§ 46 je nach Objektart) ist jetzt nicht mehr
blockiert, aber noch nicht gebaut — kein Teil dieser Anfrage.

---

## 9. AHO-Hefte (begonnen: Heft 9 Migration 0121, Heft 17 Migration 0122)

Erster Schritt Richtung AHO. Wichtiger Unterschied zur HOAI: AHO-Honorare
sind **keine gesetzlich bindende Honorarzonentafel**, sondern eine
Verbandsempfehlung — das Honorar wird meist als frei vereinbarter
Prozentsatz der anrechenbaren Kosten verhandelt (oder als Zeithonorar, das
bereits über `BILLING_TYPE_ID=2`/TEC abgebildet ist). Das bestehende Zonen-/
Tafel-Modell passt hier nicht.

**Architektur** (mit User abgestimmt): vierter `BASE_TYPE`
`percent_of_baukosten` — kein Zonen-Dropdown, `ZONE_PERCENT` wird zum frei
eingetragenen Honorarsatz % zweckentfremdet, Grundhonorar je Kx = Kx ×
Honorarsatz / 100. K0..K4 bleiben nutzbar wie bei `cost_eur` (Kostenschätzung/
-berechnung/-anschlag-Fortschreibung), DIN276-Editor-Button bleibt sichtbar
(anders als bei `area_ha`/`verrechnungseinheiten`, wo er keinen Sinn ergibt).
`calculateRevenueFields()` fragt `FEE_MASTERS.BASE_TYPE` selbst ab
(Soft-Fail, falls Migration noch nicht gelaufen ist) statt dass der Aufrufer
es durchreichen muss.

**⚠️ Quellenlage anders als bei allem bisherigen in dieser Reihe**: AHO-Hefte
sind kostenpflichtige Verbandspublikationen, kein frei zugänglicher
Gesetzestext. Migration 0121 legt bewusst NUR den Kalkulationstyp + das
Leistungsbild „AHO_9 – Projektsteuerung" an — OHNE Leistungsphasen
(Handlungsbereiche A–E, Projektstufen) und OHNE Honorarsatz-Richtwerte, weil
deren genaue Gewichtung/Höhe nicht aus einer geprüften Quelle stammt, sondern
aus allgemeinem Fachwissen. User hat dem nach ausdrücklichem Hinweis auf
dieses Risiko zugestimmt („aus allgemeinem Wissen arbeiten"). Nutzerinnen
tragen den Honorarsatz frei ein — keine erfundene Tafel, die wie ein
geprüfter Wert aussieht, aber keiner ist.

### Heft 17 Brandschutz (Migration 0122) — eigene Honorarformel, keine Tafel

Für Heft 17 lag eine echte Quelle vor (User-Hinweis):
https://www.buero-romig.de/Home/Downloadbereich/downloadbereich.html —
„Leistungsbild und Honorierung gemäß AHO Heft 17 2022" (Stand Dez. 2022), PDF
mit `pdftotext`/`pdftoppm` gelesen statt spekuliert — genau wie bei der HOAI.

**Wichtige Lektion beim Lesen**: `pdftotext -layout` hat die zweispaltigen
Beiwerte-Tabellen (Nutzungsbeiwerte, Schwierigkeitsbeiwerte) beim Extrahieren
falsch ausgerichtet — Werte um 1-2 Zeilen verschoben, ohne dass es wie ein
Fehler aussah. `pdftotext -table` lieferte die korrekte Zuordnung (Summenprobe
LPH-Prozentsätze = 100 bestätigte es zuerst); zur Sicherheit zusätzlich
`pdftoppm` (Poppler, per winget nachinstalliert) zum Rendern einzelner Seiten
als PNG genutzt und visuell mit der `-table`-Ausgabe abgeglichen — exakte
Übereinstimmung. Bei zukünftigen PDF-Quellen: **`-table` bevorzugen, `-layout`
bei mehrspaltigen Tabellen nicht blind vertrauen**, im Zweifel als Bild
gegenprüfen.

**Honorarformel** (Nr. 1.5, visuell verifiziert — keine Interpolation wie bei
der HOAI, eine geschlossene Potenzformel):
- `Aq = Σ(Ai · ni · si)` — Flächenäquivalent aus Bruttogrundfläche ×
  Nutzungsbeiwert × Schwierigkeitsbeiwert je Kalkulationseinheit
- `si = (1,0 + Σsp) · (1,0 + ΣsT)` — Projekt- und Teilflächen-Schwierigkeit
  multiplikativ verknüpft
- `H = 2.600 € + f · Aq^0,61` — f nach Jahr der Beauftragung (2022=170 …
  2028=191)

**Architektur**: neuer, bewusst Heft-17-spezifischer `BASE_TYPE`
`flaechenaequivalent_brandschutz` (keine generische Wiederverwendung wie bei
`percent_of_baukosten` — diese Formel gilt nur hier). K0 = Aq (m², extern
ermittelt und als Summe eingetragen — kein Kalkulationseinheiten-Rechner in
der UI, dieselbe Vereinfachung wie bei Verrechnungseinheiten).
`ZONE_PERCENT` wird zum Faktor f zweckentfremdet, kein Zonen-Konzept. Formel
+ f-Tabelle stehen als Hinweistext im Wizard (echte, geprüfte Werte — anders
als bei Heft 9 bewusst gezeigt).

**Leistungsphasen vollständig** (LPH 1/2/3/4/5/8 = 1/15/19/15/18/32 %,
Summenprobe = 100 ✓; LPH 6+7 nicht Teil der Regelleistungen, keine Zeilen —
wie bei Leistungsbildern ohne vollständige LPH-Reihe).

**Nicht in der DB abgelegt** (zu granular ohne Kalkulationseinheiten-Rechner):
die 20-zeilige Nutzungsbeiwerte-Tabelle und die 8+6 Schwierigkeitsbeiwerte —
vollständig in Migration 0122 als Kommentar dokumentiert, falls später ein
Rechner (mehrere Kalkulationseinheiten mit Fläche + Nutzung-Dropdown +
Kriterien-Checkboxen, automatische Aq-Summierung) gebaut wird.

**Offen**: Leistungsphasen für Heft 9 (Handlungsbereiche/Projektstufen —
weiterhin keine Quelle), danach Heft 15 (SiGeKo).

---

## 10. HOAI 2013 als zweite Honorarordnung (Migration 0123)

Verträge bis 31.12.2020 rechnen weiter nach der Fassung 2013. Rechtlicher
Unterschied: 2013 waren die Tafelwerte **verbindliche Mindest- und
Höchstsätze** („sind in der folgenden Honorartafel festgesetzt"), seit 2021
nur noch **Orientierungswerte**.

**Die Zahlenwerte selbst sind identisch geblieben** — geprüft, nicht
angenommen. Stichprobenvergleich gegen den 2013er Volltext
(hoai.de/hoai/volltext/hoai-2013/) über vier Leistungsbild-Familien mit
unterschiedlicher Bemessungsgrundlage: § 35 Gebäude (€, 60 Werte), § 52
Tragwerksplanung (€, 30 Werte), § 20 Flächennutzungsplan (ha, 48 Werte),
Anlage 1.2.3 Bauphysik Wärmeschutz (€, 36 Werte) und Anlage 1.1.2 UVS (ha,
inkl. Phasensätze 3/37/50/10) — durchgehend deckungsgleich. Auch die
Anlage-1-Struktur ist unverändert (1.1–1.4 mit denselben Unterabschnitten);
abweichend ist nur der Anlagentitel („Beratungsleistungen" 2013 vs „Weitere
Fachplanungs- und Beratungsleistungen" 2021) — rein redaktionell.

Migration 0123 ist deshalb **maschinell aus 0115–0119 generiert** (Skript
`gen_hoai2013_full.js` im Session-Scratchpad): reine ID-Umschreibung, kein
Wert neu erfasst. Anschließend verifiziert: alle 439 FEE_TABLES-Zeilen
wertidentisch zur Quelle, IDs exakt um den Offset verschoben, keine
FK-Verletzungen, keine ID-Kollisionen mit HOAI 2021/AHO, keine Duplikate,
alle 21 Leistungsbilder mit Phasensumme exakt 100.

**ID-Schema** (kollisionsfrei): `FEE_GROUPS` 3 (1 = HOAI 2021, 2 = AHO,
3 = HOAI 2013), `FEE_MASTERS` +1000, `FEE_ZONES`/`FEE_PHASE`/`FEE_TABLES`
+2000. AHO-Leistungsbilder (0121/0122) sind bewusst **nicht** dupliziert —
eigene Schriftenreihe, keine HOAI-Fassung.

**Offen**: Vorbelegung der Honorarordnung nach Vertragsdatum. Das Modell
trägt jetzt mehrere Fassungen, aber der Wizard lässt weiterhin frei wählen —
sinnvoll wäre, bei Projekten/Verträgen mit Datum vor 2021 automatisch HOAI
2013 vorzuschlagen.

---

## 11. Werte pflegen

Die Tafelwerte wurden maschinell aus dem amtlichen Volltext übernommen, nicht
abgetippt: Parser + Round-Trip-Prüfung gegen die Quelle (Bandgrenzen
lückenlos, jede Zelle verglichen, Phasensummen = 100). Bei weiteren
Leistungsbildern denselben Weg gehen — Zahlen dieser Größenordnung von Hand
zu übertragen hält keiner Prüfung stand.

---

## 12. Korrigierte Anrechenbarkeits-Regeln (Migration 0125 + Code, 18.08.2026)

Beim Durchgehen der mit `⚠️` markierten Vereinfachungen in `din276.js` kamen
zwei echte Rechenfehler und eine falsche Rechtsgrundlage heraus. Alle drei
wurden gegen den amtlichen Volltext geprüft, nicht aus dem Gedächtnis
korrigiert.

### 12.1 § 50 Abs. 3 — Tragwerksplanung bei Ingenieurbauwerken (Rechenfehler)

Bisher rechnete `anrechenbareKostenTragwerk()` **immer** mit 55 % KG 300 +
10 % KG 400. Das ist § 50 **Abs. 1** und gilt nur für Gebäude. **Abs. 3**
setzt für Ingenieurbauwerke **90 % + 15 %** an — bei einem Tragwerk für ein
Ingenieurbauwerk lagen die anrechenbaren Kosten damit um rund 40 % zu
niedrig.

Gelöst über einen Objektart-Parameter (`tragwerk:ingenieurbauwerk`), der auch
**Geotechnik** erreicht: Anlage 1.3.2 Abs. 1 verweist ausdrücklich auf „§ 50
Absatz 1 **bis 3**". Im DIN-276-Editor erscheint für beide Leistungsbilder ein
Auswahlfeld „Objektart".

Abs. 2 (bei Gebäuden mit hohem Gründungs-/Tragkonstruktionsanteil darf nach
Abs. 3 gerechnet werden) ist damit ebenfalls bedienbar — dort einfach
„Ingenieurbauwerk" wählen. **Nicht abgebildet** bleiben Abs. 4 (Traggerüste =
Herstellkosten) und Abs. 5 (weitere Kosten bei Mehrleistungen nach § 51):
beides beruht auf einer Vereinbarung im Einzelfall und lässt sich nicht aus
der Kostenermittlung ableiten.

### 12.2 § 38 Abs. 1 — Freianlagen nur soweit selbst geplant

`anrechenbareKostenFreianlagen()` zählte KG 500 immer voll. § 38 Abs. 1
rechnet die Außenanlagen aber nur an, „soweit diese durch den Auftragnehmer
geplant oder überwacht werden". Fremd geplante Anteile zählen hier **gar
nicht** (anders als bei § 33/§ 42/§ 46, wo fremd geplante KG 400 anteilig
eingehen); sie erscheinen in der Herleitung jetzt mit 0 %, damit die Summe
nicht wie ein Rechenfehler wirkt.

**Migration 0125 ist der Bestandsschutz dazu.** Die Checkbox „selbst geplant?"
gab es im Editor nur für KG 200/400/600 — alle vorhandenen KG-5xx-Zeilen
stehen deshalb zwangsläufig auf `FALSE`, nicht aus Absicht, sondern weil das
Feld nicht bedienbar war. Ohne die Migration hätte die korrigierte Regel jede
bestehende Freianlagen-Berechnung still auf 0 € gesetzt. Die Migration setzt
alle **bestehenden** KG-5xx-Zeilen auf `TRUE` (= bisheriges Ergebnis bleibt
erhalten, und fachlich der Regelfall: wer Freianlagenplanung beauftragt, lässt
die Außenanlagen gerade vom Auftragnehmer planen). Neue Zeilen bleiben beim
Default `FALSE`.

§ 38 Abs. 2 (Unter-/Oberbau von Fußgängerbereichen nicht anrechenbar, deren
Oberflächenbefestigung schon) bleibt **nicht abgebildet** — dafür müsste die
Kostenermittlung unterhalb der KG-500-Ebene aufgeteilt werden. Solche Anteile
sind als eigene Kostengruppen-Zeile zu erfassen und „selbst geplant"
abzuwählen.

### 12.3 TGA-Mischhonorar — Rechtsgrundlage war falsch zitiert

Code, Oberfläche, Hilfetext, Konzeptdokument und Migration 0100 führten die
gewichtete Zonenmischung auf **§ 54 Abs. 3** zurück. Der Absatz regelt aber
die **Minderung bei Wiederholungen** (Verweis auf § 11 Abs. 3/4: im
Wesentlichen gleiche Anlagen → Prozentsätze der LPH 1–6 um 50/60/90 %
mindern). Mit gemischten Honorarzonen hat er nichts zu tun. Der Code trug
dazu schon länger den Hinweis „⚠️ § 54 Abs. 3 ist gegen den Gesetzestext zu
bestätigen" — die Prüfung hat ihn widerlegt.

Für die Zonenmischung gibt es im Verordnungstext **keine ausdrückliche
Grundlage**: § 54 Abs. 1 stellt auf die Summe der anrechenbaren Kosten je
Anlagengruppe ab, § 5 Abs. 2 auf die Zuordnung anhand der Bewertungsmerkmale —
beides legt *eine* Zone je Anlagengruppe nahe. Die Mischung ist eine
verbreitete Auslegung, aber nicht aus der HOAI ableitbar.

Das Feature wurde **bewusst nicht entfernt** (es ist in Benutzung, und ob es
fachlich vertretbar ist, entscheidet nicht die Software). Entfernt wurde nur
die falsche Fundstelle; Oberfläche und Hilfetext weisen jetzt auf den
Auslegungscharakter hin. Migration 0100 behält ihren alten Kopfkommentar —
bereits eingespielt, historischer Stand.

### 12.4 Nebenbefund: § 11 Abs. 3/4 fehlt komplett

Beim Prüfen von § 54 Abs. 3 fiel auf, dass die **Wiederholungsminderung**
(§ 11 Abs. 3: Prozentsätze der LPH 1–6 um 50 % ab der ersten, 60 % ab der
fünften, 90 % ab der achten Wiederholung; Abs. 4 auch bei Folgeaufträgen
zwischen denselben Parteien) nirgends abgebildet ist. Das sind konkrete,
verbindliche Zahlen der Verordnung — inhaltlich der nächste Nachbar des noch
offenen Zuschlagskatalogs (3.4) und dort mitzudenken.

---

## 13. Zuschlagskatalog (Migration 0126)

Der Anwendungs-Mechanismus war seit 0039 fertig (`FEE_CALCULATION_SURCHARGES`:
Prozent oder Festbetrag, wahlweise auf einzelne Leistungsphasen oder BL-Posten
begrenzt, parallel/kumulativ). Leer war nur der **Katalog**.

Damit die Vorschläge mehr sind als Namen, hat `FEE_SURCHARGES` drei neue
Spalten: `DEFAULT_PERCENT` (Vorschlagswert), `MAX_PERCENT` (gesetzliche
Obergrenze) und `LEGAL_REF` (Fundstelle). Der Wizard übernimmt den
Vorschlagswert beim Hinzufügen und zeigt Fundstelle + Grenze im Tooltip.

| # | Eintrag | Vorschlag | Max | Fundstelle |
|---|---|---|---|---|
| 1 | Umbauzuschlag | 20 % | 33 % | § 6 Abs. 2, § 36 Abs. 1 |
| 2 | Umbauzuschlag | 20 % | 50 % | § 6 Abs. 2, § 36 Abs. 2 |
| 3 | Instandsetzung | — | 50 % | § 12 Abs. 2 |
| 4 | Wiederholung 1.–4. | **−50 %** | — | § 11 Abs. 3 |
| 5 | Wiederholung 5.–7. | **−60 %** | — | § 11 Abs. 3 |
| 6 | Wiederholung ab 8. | **−90 %** | — | § 11 Abs. 3 |
| 7 | Nebenkosten | — | — | § 14 |

**Die Obergrenze hängt vom Leistungsbild ab** — deshalb zwei Einträge für
denselben Zuschlag:

- **bis 33 %**: Gebäude (§ 36 Abs. 1), Freianlagen (§ 40 Abs. 6 verweist auf
  § 36 Abs. 1), Ingenieurbauwerke (§ 44 Abs. 6), Verkehrsanlagen (§ 48
  Abs. 6), Bauphysik (Anlage 1.2.3/1.2.4/1.2.5 Abs. 3)
- **bis 50 %**: Innenräume (§ 36 Abs. 2), Tragwerksplanung (§ 52 Abs. 4),
  TGA (§ 56 Abs. 5)
- **gar nicht**: Geotechnik, UVS, Ingenieurvermessung — die HOAI sieht dort
  keinen Umbauzuschlag vor, also bewusst nicht verknüpft.

`DEFAULT_PERCENT` ist überall 20 %, weil § 6 Abs. 2 Satz 4 genau das als
vereinbart fingiert, wenn nichts in Textform vereinbart wurde. Die 33/50 %
gelten laut Wortlaut „bei einem durchschnittlichen Schwierigkeitsgrad" und
setzen eine Vereinbarung in Textform voraus.

**Zwei Einträge wirken nur auf bestimmte Leistungsphasen** — die Software kann
das nicht automatisch setzen, der Hinweistext sagt es deshalb an:

- **§ 12 Abs. 2 (Instandsetzung)** erhöht den Prozentsatz der
  Objektüberwachung/Bauoberleitung um bis zu 50 %, nicht das Gesamthonorar →
  LPH-Filter auf die Objektüberwachung setzen. Rechnerisch gleichwertig zu
  einer Erhöhung des Phasen-Prozentsatzes. Nur mit Leistungsbildern verknüpft,
  die überhaupt eine LPH 8 haben (Tragwerksplanung endet bei LPH 6, Bauphysik
  bei 7, Geotechnik/UVS/Vermessung haben keine).
- **§ 11 Abs. 3 (Wiederholung)** ist eine **Minderung** der Leistungsphasen 1
  bis 6 → negativer Prozentsatz, LPH-Filter auf LPH 1–6. § 11 Abs. 3 nennt
  ausdrücklich Gebäude, Ingenieurbauwerke, Verkehrsanlagen und Tragwerke;
  § 54 Abs. 3 erstreckt die Rechtsfolge auf die TGA — genau diese fünf sind
  verknüpft. (Das ist übrigens der tatsächliche Regelungsgehalt von § 54
  Abs. 3, der zuvor fälschlich für das Mischhonorar zitiert wurde, siehe
  § 12.3.)

**Nebenkosten haben bewusst keinen Vorschlagswert.** Die HOAI nennt keinen
Prozentsatz, sondern lässt pauschal oder Einzelnachweis zu (§ 14 Abs. 3). Ein
erfundener Default sähe im Katalog aus wie ein Gesetzeswert.

Der Katalog gilt für beide Fassungen (2021 und die 2013er Leistungsbilder aus
0123) — die Paragraphen sind wortgleich. Die 90 Verknüpfungen sind maschinell
erzeugt (`gen_surcharges.js`), nicht handgetippt.

**Nicht abgebildet**: § 11 Abs. 2 (mehrere vergleichbare Objekte derselben
Honorarzone → Honorar nach der Summe der anrechenbaren Kosten). Das ist keine
Zuschlagszeile, sondern eine andere Berechnungsgrundlage — bräuchte eine
Zusammenfassung mehrerer Objekte in einer Berechnung.
