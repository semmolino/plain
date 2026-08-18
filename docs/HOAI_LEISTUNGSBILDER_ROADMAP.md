# Leistungsbilder im Kalkulationsmodul — Bestand, Lücken, Reihenfolge

Stand: 18.08.2026 (Geotechnik ergänzt)

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

## 2. Was fehlt: HOAI Anlage 1

Nicht abgebildet ist **Anlage 1 — Weitere Fachplanungs- und
Beratungsleistungen** (§ 3 Abs. 1). Sieben Honorartafeln:

| HOAI | Leistungsbild | Zonen | Bemessungsgrundlage | Tafelbereich | Status |
|---|---|---|---|---|---|
| 1.1.2 | Umweltverträglichkeitsstudie | 3 | Fläche (ha) | 50–10.000 ha | offen |
| 1.2.3 | Wärmeschutz und Energiebilanzierung | 5 | anrechenbare Kosten (€) | 250 T–25 Mio | **erledigt** (0116) |
| 1.2.4 | Bauakustik | 3 | anrechenbare Kosten (€) | 250 T–25 Mio | **erledigt** (0116) |
| 1.2.5 | Raumakustik | 5 | anrechenbare Kosten (€), je Innenraum | 50 T–7,5 Mio | **erledigt** (0116) |
| 1.3.4 | Geotechnik | 5 | anrechenbare Kosten (€) | 50 T–25 Mio | **erledigt** (0117) |
| 1.4.8 (1) | Ingenieurvermessung — Planungsbegleitende Vermessung | 5 | **Verrechnungseinheiten** | 6–11.726 VE | offen |
| 1.4.8 (2) | Ingenieurvermessung — Bauvermessung | 5 | anrechenbare Kosten (€) | 50 T–10 Mio | offen |

Quelle: HOAI vom 10.07.2013 (BGBl. I S. 2276; Anlage 1: BGBl. I 2013,
2306–2323), zuletzt geändert durch Art. 3 G v. 22.03.2023 — die als
„HOAI 2021" bekannte Fassung. Seit 2021 sind die Honorarspannen
**Orientierungswerte**, keine verbindlichen Mindest-/Höchstsätze.

---

## 3. Bekannte Modell-Lücken

Diese Punkte sind der eigentliche Aufwand — der reine Stammdaten-Import ist
der kleinere Teil.

### 3.1 `BASE_TYPE` kennt nur `cost_eur` und `area_ha`

Die Ingenieurvermessung (1.4.8 Abs. 1) rechnet in **Verrechnungseinheiten**.
Betroffen: `chk_fee_masters_base_type` (Migration 0054/0115), der
`FeeBaseType`-Union in `api/fee.ts`, die Einheitenbeschriftung im
`HonorarWizard` und die PDF-Vorlage `honorar.njk`.

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
unten).

### 3.4 Zuschlagskatalog ist leer

`FEE_SURCHARGES` enthält keine Zeile. Umbau-/Modernisierungszuschlag (§ 6),
Instandsetzung, Nebenkosten (§ 14) und Mehrfachbeauftragung (§ 11) tippt
heute jede Nutzerin frei ein — je Berechnung neu, ohne Prozentvorschlag.

### 3.5 Honorarzonen-Einstufung

Die Zone wird direkt gewählt. Die Punktbewertung nach den
Bewertungsmerkmalen der Anlagen (§ 5) gibt es nicht — eigenes Feature, nicht
Teil dieser Reihe.

---

## 4. Erledigt: Anlage 1.2 Bauphysik, Anlage 1.3 Geotechnik

Migrationen `0115` (Schema + Bestand) und `0116` (Bauphysik).

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

1. ~~Anlage 1.2 Bauphysik~~ — erledigt (0115/0116)
2. ~~Anlage 1.3 Geotechnik~~ — erledigt (0117), inkl. `SORT_ORDER` (3.2)
3. **Anlage 1.1 Umweltverträglichkeitsstudie** — `area_ha`, Modell trägt das schon
4. **Anlage 1.4 Ingenieurvermessung** — braucht 3.1 (`BASE_TYPE`), zwei Tafeln
5. **Zuschlagskatalog** (3.4) — kleiner Aufwand, wirkt auf jede Berechnung
6. **HOAI 2013** als zweite `FEE_GROUPS`-Zeile — Altverträge rechnen weiter
   nach der Fassung, die bei Vertragsschluss galt. Das Modell trägt mehrere
   Fassungen bereits; zu klären ist die Vorbelegung nach Vertragsdatum.
7. **AHO-Hefte und weitere Kalkulationstypen** — Projektsteuerung (Heft 9),
   SiGeKo (Heft 15), Brandschutz (Heft 17) u. a. Diese rechnen nicht nach
   Honorartafel, sondern meist als Prozentsatz der Baukosten oder nach
   Zeithonorar. Ob das noch in `FEE_TABLES` passt oder einen eigenen
   Kalkulationstyp braucht, ist vor Beginn zu entscheiden — offene Frage.

---

## 7. Werte pflegen

Die Tafelwerte wurden maschinell aus dem amtlichen Volltext übernommen, nicht
abgetippt: Parser + Round-Trip-Prüfung gegen die Quelle (Bandgrenzen
lückenlos, jede Zelle verglichen, Phasensummen = 100). Bei weiteren
Leistungsbildern denselben Weg gehen — Zahlen dieser Größenordnung von Hand
zu übertragen hält keiner Prüfung stand.
