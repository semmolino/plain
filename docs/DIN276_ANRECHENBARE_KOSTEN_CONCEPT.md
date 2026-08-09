# Konzept — DIN-276-Kostenermittlung & anrechenbare Baukosten (HOAI-Modul)

> Status: **Entwurf / Konzept** — noch nicht implementiert. Dieses Dokument
> ist die fachliche und technische Grundlage für ein neues Modul. Vor der
> Umsetzung sind die mit ⚠️ markierten Punkte gegen den HOAI-Gesetzestext und
> DIN 276-1:2008-12 final zu verifizieren.

---

## 1. Ziel & Abgrenzung

Die **anrechenbaren Baukosten** sind die erste und wichtigste Eingangsgröße
jeder HOAI-Honorarberechnung — aus ihnen wird über die Honorartafel das
Grundhonorar interpoliert. Heute werden sie in plan&simple **als fertige
€-Beträge (K0–K4) manuell eingetippt**; die Ableitung aus den Baukosten nach
DIN 276 passiert außerhalb des Systems (im Kopf oder in Excel).

**Ziel des Moduls:** Eine strukturierte **DIN-276-Kostenermittlung** im Produkt,
aus der die anrechenbaren Kosten **regelbasiert und nachvollziehbar** berechnet
und in die Honorarberechnung übernommen werden.

**Nutzen:**
- Nachvollziehbarkeit (prüffähige Herleitung, auch fürs Honorar-PDF / gegenüber Auftraggeber)
- Weniger Fehler (die §-Regeln je Leistungsbild sind nicht trivial)
- Wiederverwendung: **eine** Kostenermittlung speist **mehrere** Leistungsbilder
  (Gebäude, Tragwerk, TGA) mit ihren jeweils eigenen Anrechenbarkeits-Regeln
- Konsistenz mit Kostenstufen (Kostenschätzung → Kostenberechnung)

**Nicht Ziel (Abgrenzung):**
- Keine vollständige Kostenplanungs-/AVA-Software (Mengen, LV, Vergabe). Es geht
  um die **Kostenermittlung auf KG-Ebene** als Honorargrundlage, nicht um
  Positions-Kalkulation.
- Der **Umbau-/Modernisierungszuschlag** (§ 6 Abs. 2 / Leistungsbild-§§) wirkt
  auf das **Honorar**, nicht auf die anrechenbaren Kosten — er ist im bestehenden
  Zuschlags-Modell bereits abgebildet und bleibt dort.

---

## 2. Ist-Zustand in plan&simple

Relevante Strukturen (Stand heute):

- **`FEE_CALCULATION_MASTER`** trägt fünf Kostenbasen und die daraus berechneten
  Honorarbasen:
  - `CONSTRUCTION_COSTS_K0 … _K4` — anrechenbare Kosten (heute manuell)
  - `REVENUE_K0 … _K4` — aus der Honorartafel interpolierter Tafelwert je Basis
- **`FEE_CALCULATION_PHASE`** hat je Leistungsphase ein Feld **`KX`** (`'K0'..'K4'`)
  → jede LPH rechnet gegen genau eine der fünf Basen. Damit kann heute schon
  abgebildet werden, dass verschiedene Phasen auf unterschiedlichen anrechenbaren
  Kosten beruhen (z. B. Bestand vs. Neubau, Teilmaßnahmen).
- **`FEE_MASTERS.BASE_TYPE`** = `'cost_eur'` (Baukosten €, K0–K4 sichtbar) oder
  `'area_ha'` (Plangebiet in ha, nur K0) — Bauleitplanung u. Ä.
- Berechnung: `services/stammdaten.js` → `calculateRevenueFields` interpoliert
  je Basis linear über `FEE_TABLES` (Honorartafel des Leistungsbilds, Zone + Zonen-%).
- Eingabe: `HonorarWizard.tsx`, Schritt „Basis" (Felder K0–K4).
- Verwendung der Baukosten außerhalb der Tafel: Zuschläge/Besondere Leistungen
  vom Typ `pct_baukosten` rechnen `PERCENT × CONSTRUCTION_COSTS_Kx`.

**Kernaussage:** Das Zielmodell (K0–K4) existiert bereits. Das neue Modul
**ersetzt die manuelle Eingabe dieser Werte durch eine berechnete Herleitung**
und lässt die manuelle Eingabe als Fallback bestehen (Rückwärtskompatibilität).

---

## 3. Fachliche Grundlagen

### 3.1 Maßgebliche DIN-276-Fassung

- § 4 Abs. 1 HOAI: Anrechenbare Kosten werden **auf Grundlage der Kostenberechnung
  nach DIN 276** ermittelt; maßgeblich ist die **DIN 276-1:2008-12** (Hochbau).
  Das gilt auch unter HOAI 2013 und HOAI 2021 fort. ⚠️ Fassung/Version im Code
  als Konstante hinterlegen; DIN 276:2018 hat eine leicht andere Gliederung
  (relevant, falls später wählbar).

### 3.2 Kostengruppen (KG) — DIN 276-1:2008-12, Hochbau

Achtstellige Hunderter-Systematik, je dreistellig weiter unterteilbar:

| KG | Bezeichnung | Kurz |
|----|-------------|------|
| 100 | Grundstück | Kauf, Nebenkosten |
| 200 | Herrichten und Erschließen | Abbruch, Baufeld, Erschließung |
| 300 | Bauwerk – Baukonstruktionen | Rohbau, Ausbau, Tragwerk baulich |
| 400 | Bauwerk – Technische Anlagen | Heizung, Lüftung, Sanitär, Elektro, Aufzüge … |
| 500 | Außenanlagen | Freiflächen, Wege, Bepflanzung |
| 600 | Ausstattung und Kunstwerke | Mobiliar, Kunst |
| 700 | Baunebenkosten | Honorare, Gebühren, Finanzierung |

Bezugseinheiten (DIN 276 Tab. 2–4): KG 100/200 → Grundstücksfläche (GF);
KG 300/400/600/700 → Brutto-Grundfläche (BGF); KG 500 → Außenanlagenfläche (AF).
(Für dieses Modul zunächst **€-Beträge je KG** als Eingabe; Mengen×Kennwert ist
eine optionale Ausbaustufe, siehe §6.)

### 3.3 Kostenermittlungsstufen (Zeitpunkt & Genauigkeit)

- **Kostenschätzung** (i. d. R. Ende LPH 2 „Vorplanung") — grob, KG 1. Ebene
- **Kostenberechnung** (Ende LPH 3 „Entwurfsplanung") — genauer, KG 2. Ebene;
  **maßgeblich für die anrechenbaren Kosten** (§ 4 HOAI)
- Später: Kostenanschlag / Kostenfeststellung — für Honorar i. d. R. nicht mehr relevant

**Für das Modul:** Eine Kostenermittlung trägt eine **Stufe** (Schätzung/Berechnung).
Mehrere Stufen je Projekt möglich (Historie); die Honorarberechnung referenziert
eine bestimmte Stufe. Übliche HOAI-Praxis: Honorar auf Basis der Kostenberechnung,
in frühen Phasen ersatzweise Schätzung.

### 3.4 Anrechenbarkeits-Regeln — je Leistungsbild verschieden ⚠️

Dies ist der fachliche Kern. **Aus derselben KG-Aufstellung ergeben sich je
Leistungsbild unterschiedliche anrechenbare Kosten.** Auszug (gegen Gesetzestext
zu verifizieren):

**Gebäude & Innenräume (§ 33 HOAI 2021):**
- **KG 300: vollständig** (100 %) anrechenbar.
- **KG 400 – Technische Anlagen:**
  - Technische Anlagen, die der Auftragnehmer **selbst fachlich plant/überwacht**
    → **vollständig** anrechenbar.
  - Technische Anlagen, die er **nicht** selbst plant/überwacht →
    - **bis 25 %** der *sonstigen anrechenbaren Kosten*: **vollständig**,
    - der **25 % übersteigende Betrag**: **zur Hälfte (50 %)**.
  - *Sonstige anrechenbare Kosten* = KG 300 + mitverarbeitete Bausubstanz.
- **Bedingt anrechenbar (nur wenn geplant/überwacht/mitgewirkt):** Teile aus
  KG 200 (Herrichten), KG 600 (Ausstattung/Kunstwerke).
- **Nicht anrechenbar:** KG 100, Baunebenkosten (KG 700), nichtöffentliche
  Erschließung, öffentliche Erschließung.

**Tragwerksplanung (§ 50/§ 51 HOAI 2021):** ⚠️
- **55 % der KG 300** + **10 % der KG 400** als anrechenbare Kosten;
- zusätzlich **bestimmte tragwerksrelevante Teile der KG 400 vollständig**
  (z. B. konstruktive Anteile). Exakte KG-Zuordnung und Prozentsätze aus dem
  Gesetzestext übernehmen.

**Technische Ausrüstung / TGA (§ 53 HOAI 2021):** ⚠️
- Anrechenbar sind die **Kosten der jeweils geplanten Anlagengruppen der KG 400**
  (je Anlagengruppe getrennt), i. d. R. vollständig; ggf. anteilige KG 300/500.

**Freianlagen (§ 39/§ 40 HOAI 2021):** ⚠️
- Im Kern **KG 500** sowie anteilige KG 200/300, soweit den Freianlagen zugehörig.

**Weitere (optional, später):** Ingenieurbauwerke (§ 41 ff.), Verkehrsanlagen —
jeweils eigene Regeln.

**Konsequenz fürs Design:** Die Anrechenbarkeit ist **kein fester Wert, sondern
ein Regelwerk `(Leistungsbild) → Formel über KG-Beträge + Flags`.** Das Modul
braucht eine kleine **Regel-Engine**, die je Leistungsbild anwendbar ist.

### 3.5 Mitverarbeitete Bausubstanz (§ 4 Abs. 3 HOAI)

Bei Umbau/Modernisierung im Bestand: vorhandene, technisch oder gestalterisch
**mitverarbeitete Bausubstanz** ist **angemessen** in die anrechenbaren Kosten
einzubeziehen (schriftlich zu vereinbaren). Fließt in die *sonstigen anrechenbaren
Kosten* ein (u. a. Basis für die 25 %-Schwelle bei KG 400).
→ Eigenes Eingabefeld je Kostenermittlung.

### 3.6 Umbau-/Modernisierungszuschlag — Abgrenzung

Wirkt als **Zuschlag auf das Honorar** (Prozentsatz), **nicht** auf die
anrechenbaren Kosten. Bereits über das bestehende Zuschlags-Modell
(`FEE_CALCULATION_SURCHARGES`) abgebildet — **bleibt dort**, ist nicht Teil dieses
Moduls.

---

## 4. Modul-Konzept

### 4.1 Datenmodell (Vorschlag)

Neue Tabellen (mandantengetrennt, `TENANT_ID` + RLS wie üblich):

**`DIN276_COST_ESTIMATE`** — eine Kostenermittlung
```
ID, TENANT_ID,
PROJECT_ID (nullable), OFFER_ID (nullable),   -- Kontext, analog FEE_CALCULATION_MASTER
NAME_SHORT, NAME_LONG,
STAGE            -- 'schaetzung' | 'berechnung'
DIN_VERSION      -- '2008-12' (Default; Zukunft: '2018-12')
STATUS           -- 'draft' | 'final'
created_at
```

**`DIN276_COST_GROUP`** — Beträge je Kostengruppe
```
ID, TENANT_ID, ESTIMATE_ID (FK),
KG_CODE          -- '300', '410', … (3-stellig; 1. Ebene = '300'/'400'…)
LABEL            -- optionaler Freitext/Katalog-Bezeichnung
AMOUNT           -- € (Netto)
IS_PLANNED_SELF  -- boolean: vom AN fachlich geplant/überwacht (für §33 KG400, KG200/600)
SORT_ORDER
```
> Ebenentiefe: Start mit **1. Ebene (100–700)** genügt für die Regeln;
> **2. Ebene (z. B. 410–480)** optional, um Anlagengruppen der KG 400 (TGA) und
> tragwerksrelevante Anteile sauber zu trennen. Empfehlung: 2. Ebene zulassen,
> Aggregation auf 1. Ebene für die Regeln.

**`DIN276_ATTRIBUTES`** (oder Felder am ESTIMATE) — Sonderwerte
```
MITVERARBEITETE_BAUSUBSTANZ_AMOUNT   -- § 4 (3)
… ggf. weitere (z. B. „vorhandene Bausubstanz" separat)
```

**Anrechenbarkeits-Regelwerk** — zwei Optionen:
- **(A) Code-basiert:** Regeln je Leistungsbild fest als Funktionen im Backend
  (schnell, wartbar zentral, aber Änderungen nur per Deploy).
- **(B) Datenbasiert/konfigurierbar:** Tabelle `DIN276_ANRECHENBARKEIT_RULE`
  (`FEE_MASTER_ID` bzw. Leistungsbild-Typ, `KG_CODE`, `PERCENT`, `CAP_TYPE`,
  `CAP_PERCENT`, `CONDITION`) — flexibel, aber komplex und fehleranfällig.
- **Empfehlung:** **(A) mit versionierten Regelsätzen** je HOAI-Fassung; die
  wenigen echten Parameter (z. B. 25 %-Schwelle, 55 %/10 % Tragwerk) als
  benannte Konstanten. Konfigurierbarkeit (B) erst, wenn ein realer Bedarf
  besteht. (Analog zur Entscheidung bei den LPH-Blöcken abzuwägen.)

**Verknüpfung zur Honorarberechnung:**
- `FEE_CALCULATION_MASTER` bekommt optional `DIN276_ESTIMATE_ID` (+ je KX eine
  Herkunft). Beim Berechnen werden `CONSTRUCTION_COSTS_K0..K4` **aus der
  Kostenermittlung + Leistungsbild-Regel gefüllt** statt getippt.
- Mapping **anrechenbare Kosten → KX**: Das Regelergebnis liefert die
  anrechenbaren Kosten für das Leistungsbild dieser Berechnung; sie landen im
  KX-Slot, den die Phasen referenzieren (Default K0). Mehrere Slots, wenn das
  Projekt mehrere Kostenstände/Teilmaßnahmen führt.
- **Rückwärtskompatibel:** Ohne verknüpfte Kostenermittlung bleibt die manuelle
  K0–K4-Eingabe unverändert.

### 4.2 Rule-Engine (Kern)

Reine Funktion, pro Leistungsbild:
```
anrechenbareKosten(estimate, leistungsbildRegel) →
   { betrag, herleitung[] }        // herleitung = nachvollziehbare Zeilen
```
Eingang: KG-Beträge (+ `IS_PLANNED_SELF`), mitverarbeitete Bausubstanz.
Ausgang: **ein €-Betrag** + eine **Herleitungstabelle** (KG, Ansatz %, Kappung,
Zwischensumme). Die Herleitung ist zentral für Vertrauen/Prüfbarkeit und wird in
UI und Honorar-PDF ausgegeben.

Beispiel Gebäude (§33):
```
KG300 (voll)                            1.000.000
mitverarb. Bausubstanz (voll)             100.000
  → sonstige anrechenbare Kosten        1.100.000
KG400 selbst geplant (voll)               120.000
KG400 fremd geplant                       400.000
  davon bis 25% v. 1.100.000 = 275.000 → 275.000 (100%)
  Rest 125.000 → 62.500 (50%)             337.500
────────────────────────────────────────────────
anrechenbare Kosten Gebäude             1.557.500
```

### 4.3 UI-Konzept

- **Neuer Bereich „Kostenermittlung (DIN 276)"** — je Projekt/Angebot, mit
  Auswahl der **Stufe** (Schätzung/Berechnung) und einer KG-Tabelle (Beträge
  eingeben, KG 400 & bedingte Gruppen mit „selbst geplant?"-Schalter).
- **Integration in den HonorarWizard:** Im Schritt „Basis" statt reiner
  K0–K4-Felder ein Umschalter **„aus DIN-276-Kostenermittlung übernehmen"** vs.
  **„manuell eingeben"**. Bei „übernehmen": Kostenermittlung wählen → die
  anrechenbaren Kosten werden je Leistungsbild-Regel berechnet, die Herleitung
  eingeblendet, K0–K4 read-only gefüllt.
- **Transparenz:** Herleitungstabelle sichtbar (aufklappbar) und optional im
  Honorar-PDF (Anlage „Ermittlung der anrechenbaren Kosten").
- **Empty States / Hilfe:** Tooltips gemäß `HELP_TOOLTIP_CONCEPT.md`
  (anrechenbare Kosten, mitverarbeitete Bausubstanz, KG-400-Regel, Kostenstufe).

### 4.4 RBAC & Querschnitt

- Bearbeiten hinter bestehender **`projects.calculations.edit`** (Kostenermittlung
  gehört zur Kalkulation). Prüfen, ob eine feinere Permission gewünscht ist
  (→ Rückfrage, RBAC-Regel aus CLAUDE.md).
- Hilfe-Tooltips (siehe oben), Mandantentrennung (`TENANT_ID` + `.eq`), RLS-Policy.
- PDF: Herleitung als optionaler Block im Honorar-Template (`honorar.njk`).

---

## 5. Umsetzungs-Bausteine (Vorschlag, iterativ)

1. **Datenmodell + Rule-Engine Gebäude (§33)** — Migration, Backend-Service
   `anrechenbareKosten`, Unit-Tests mit Referenzbeispielen. Höchster Nutzen,
   klar abgegrenzt.
2. **UI Kostenermittlung + Übernahme in HonorarWizard (Gebäude)** — KG-Editor,
   Herleitung, K0–K4 berechnet. End-to-end für das häufigste Leistungsbild.
3. **Weitere Leistungsbild-Regeln** — Tragwerksplanung (§50/51), TGA (§53),
   Freianlagen (§39/40), je mit Referenz-Tests.
4. **PDF-Herleitung** + Kostenstufen-Historie (Schätzung→Berechnung) + Feinschliff.
5. **Optional/später:** Mengen×Kennwert (BGF/BRI) statt reiner €-Beträge;
   DIN 276:2018 wählbar; Kostenverfolgung gegen Ist (Anbindung ans bestehende
   Projekt-/Reporting-Modul).

---

## 6. Offene Entscheidungen (vor Umsetzung zu klären)

1. **KG-Tiefe:** Reicht die 1. Ebene (100–700) für den Start, oder gleich die
   2. Ebene (Anlagengruppen 410–480 etc.)? (Empfehlung: 2. Ebene zulassen,
   Regeln auf aggregierter Ebene.)
2. **Regelwerk code- vs. datenbasiert:** feste Regeln je Leistungsbild
   (Empfehlung) oder konfigurierbare Regeltabelle?
3. **HOAI-/DIN-Fassung:** Nur DIN 276-1:2008-12 + HOAI 2021 zum Start, oder
   Mehrfassungs-Fähigkeit von Anfang an (Datenfeld ist vorgesehen, Regeln aber Aufwand)?
4. **Umfang Leistungsbilder Phase 1:** Nur Gebäude (§33) zuerst — Reihenfolge
   der weiteren (Tragwerk/TGA/Freianlagen)?
5. **Mengenbasierte Eingabe** (BGF × €/m²) — Teil des MVP oder spätere Ausbaustufe?
6. **Permission:** bestehende `projects.calculations.edit` ausreichend oder eigene?

---

## 7. Quellen (Recherche)

- HOAI § 4 (anrechenbare Kosten, DIN 276-Grundlage), § 33 (Gebäude),
  § 50/51 (Tragwerksplanung), § 53 (Technische Ausrüstung), § 39/40 (Freianlagen)
  — gesetze-im-internet.de / nwb / lexmea
- Anrechenbare Kosten & DIN 276 im Überblick: plansync.de/hoai/anrechenbare-kosten,
  factro.de/blog/kostengruppen-hoai, bauprofessor.de, phase0.com/blog/anrechenbare-kosten
- DIN 276 Kostengruppen & Kostenermittlung: baunetzwissen.de, gripsware.de/din276
- Merkblatt Kostenberechnung: Bayerische Architektenkammer (byak.de)

> ⚠️ **Verbindlich ist ausschließlich der HOAI-Gesetzestext und DIN 276-1:2008-12.**
> Alle Prozentsätze/Regeln oben sind Rechercheergebnisse und vor der
> Implementierung 1:1 gegen die Primärquellen zu prüfen und mit Referenzbeispielen
> per Unit-Test abzusichern.
