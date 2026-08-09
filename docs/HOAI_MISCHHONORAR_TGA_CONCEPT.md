# Konzept — TGA-Mischhonorar (verschiedene Honorarzonen je Anlagengruppe)

> Status: **Entwurf / Konzept** — noch nicht implementiert. Fachliche und
> technische Grundlage für die Erweiterung der TGA-Honorarberechnung.
> ⚠️-Punkte sind vor der Umsetzung gegen den HOAI-Gesetzestext (§ 54) zu
> verifizieren. Rechtsquellen (gesetze-im-internet, lxgesetze, dejure) sind aus
> dieser Umgebung per Egress-Policy nicht direkt abrufbar; die Regel wurde aus
> mehreren Fachquellen zusammengetragen.

Ergänzt: `docs/DIN276_ANRECHENBARE_KOSTEN_CONCEPT.md` (dort das Leistungsbild
Technische Ausrüstung, § 53/54, je Anlagengruppe).

---

## 1. Ziel & Abgrenzung

Bei der Technischen Ausrüstung wird das Honorar **je Anlagengruppe** aus deren
anrechenbaren Kosten und der Honorarzone ermittelt. **Mischhonorar** ist der
Sonderfall, dass die Anlagen **einer** Anlagengruppe **unterschiedlichen
Honorarzonen** angehören (§ 54 Abs. 3 HOAI). Dann darf nicht einfach eine Zone
gewählt werden — das Honorar setzt sich aus gewichteten **Einzelhonoraren je
Honorarzone** zusammen.

**Ziel:** Die Honorarberechnung einer TGA-Anlagengruppe kann die anrechenbaren
Kosten auf **mehrere Honorarzonen aufteilen** und das Mischhonorar korrekt (mit
Degressionsvorteil der Gesamtsumme) berechnen — nachvollziehbar und im PDF
ausgewiesen.

**Abgrenzung:**
- **Nicht** dieses Konzept: das **Zusammenfassen mehrerer Anlagengruppen** zu
  einer funktionalen Einheit (§ 54 Abs. 2) — eigenes Thema.
- Die **anrechenbaren Kosten** selbst kommen weiterhin aus der DIN-276-Ermittlung
  (K0). Mischhonorar betrifft nur den Schritt **anrechenbare Kosten → Grundhonorar**.
- Die Mischzonen-Systematik ist nicht TGA-exklusiv (analog bei anderen
  Leistungsbildern), wird hier aber für TGA konzipiert.

---

## 2. Ist-Zustand in plan&simple

- Eine Honorarberechnung (`FEE_CALCULATION_MASTER`) hat **genau eine** Zone:
  `ZONE_ID` (→ `FEE_ZONES`, römisch I–V je Leistungsbild) + `ZONE_PERCENT`
  (0–100, Position innerhalb des Zonenbands min…max).
- `services/stammdaten.js → calculateRevenueFields(feeMasterId, zoneId,
  zonePercent, costsByKey)` interpoliert je Kostenbasis über `FEE_TABLES`
  (Honorartafel): pro Zone gibt es eine `min`- und `max`-Spalte; `zonePercent`
  mischt linear zwischen beiden. Ergebnis `REVENUE_Kx` = Grundhonorar (100 %) bei
  dieser Kostenbasis in dieser Zone.
- Es gibt **keine** Möglichkeit, die anrechenbaren Kosten einer Berechnung auf
  mehrere Zonen zu verteilen.

Kernaussage: Der Interpolations-Baustein `H(kosten, zone, zonePercent)` existiert
und wird für das Mischhonorar **mehrfach** benötigt — pro beteiligter Zone einmal.

---

## 3. Fachliche Grundlagen — § 54 Abs. 3 HOAI

**Regel (sinngemäß, ⚠️ Wortlaut zu bestätigen):** Gehören die Anlagen einer
Anlagengruppe verschiedenen Honorarzonen an, ist das Honorar die **Summe der
Einzelhonorare**. Jedes Einzelhonorar gilt für alle einer Honorarzone
zugeordneten Anlagen und wird so bestimmt:

1. Berechne das Honorar für eine Honorarzone **so, als ob die *gesamten*
   anrechenbaren Kosten der Anlagengruppe dieser Zone angehörten**
   → `H_voll(z) = H(AK_gesamt, z)`.
2. Das Einzelhonorar der Zone ergibt sich nach dem **Verhältnis der
   anrechenbaren Kosten dieser Zone zu den gesamten** anrechenbaren Kosten der
   Anlagengruppe → `E(z) = H_voll(z) × AK_z / AK_gesamt`.
3. **Mischhonorar** `= Σ_z E(z)`.

**Warum so (wirtschaftliche Bedeutung):** Die Degression der Honorartafel (mit
steigenden Kosten sinkt der %-Satz) wird auf die **Gesamtsumme** angewandt, nicht
auf die kleineren Teilbeträge. Würde man je Zone nur deren Teilkosten
interpolieren, ginge der Degressionsvorteil verloren und das Honorar fiele
anders (meist höher) aus. Das Mischhonorar ist damit die gesetzlich
vorgeschriebene, faire Mittelung.

**Rechenbeispiel** (illustrativ, Tafelwerte fiktiv):
Anlagengruppe 420, `AK_gesamt = 500.000 €`; davon `300.000 €` in Zone II,
`200.000 €` in Zone III.

```
H_voll(II)  = Honorar bei 500.000 € in Zone II  = 60.000 €
H_voll(III) = Honorar bei 500.000 € in Zone III = 80.000 €

E(II)  = 60.000 × 300.000/500.000 = 60.000 × 0,60 = 36.000 €
E(III) = 80.000 × 200.000/500.000 = 80.000 × 0,40 = 32.000 €
────────────────────────────────────────────────────────────
Mischhonorar = 36.000 + 32.000                    = 68.000 €
```

`ZONE_PERCENT` je Zone: Auch innerhalb einer Zone gibt es das min…max-Band. Für
`H_voll(z)` wird die Position in der jeweiligen Zone benötigt (Vorschlag: je
Zonenanteil ein eigenes `zonePercent`, Default = Zonenmitte/0).

---

## 4. Modul-Konzept

### 4.1 Datenmodell

Neue Kind-Tabelle zur Honorarberechnung (mandantengetrennt, RLS):

**`FEE_CALC_ZONE_SPLIT`** — Zonenanteile einer Berechnung (bzw. Anlagengruppe)
```
ID, TENANT_ID,
FEE_CALC_MASTER_ID (FK, ON DELETE CASCADE),
ZONE_ID       (FK FEE_ZONES),
ZONE_PERCENT  (0–100, Position im Zonenband),
AMOUNT        (anrechenbare Kosten dieser Zone, €),
SORT_ORDER
```
- **0 Zeilen** → bisheriges Verhalten (einzelne `ZONE_ID`/`ZONE_PERCENT` am Master).
- **≥ 1 Zeile** → Mischhonorar-Modus; `Σ AMOUNT` muss `= AK_gesamt` (K0) sein
  (Validierung im UI + Backend). `ZONE_ID`/`ZONE_PERCENT` am Master werden dann
  ignoriert bzw. als „mehrere Zonen" markiert.

Alternative (verworfen): Splits als JSON-Feld am Master — schlechter abfragbar,
keine Validierung/Constraints.

### 4.2 Berechnung (Backend)

`calculateRevenueFields` (bzw. eine neue Variante) erhält die Splits. Für die
maßgebliche Kostenbasis (K0 = `AK_gesamt`):
```
REVENUE_K0 = Σ_z  H(AK_gesamt, ZONE_ID_z, ZONE_PERCENT_z) × (AMOUNT_z / AK_gesamt)
```
- `H(...)` ist die **bestehende** lineare Interpolation (`calcOne`), nur mehrfach
  aufgerufen — kein neuer Interpolationscode.
- Ohne Splits: unveränderter Einzelzonen-Pfad.
- Ergebnis bleibt ein `REVENUE_K0` → der restliche Ablauf (Leistungsphasen,
  Zuschläge, PDF) ändert sich nicht. Das Mischhonorar ist an genau einer Stelle
  gekapselt.

Reine, testbare Kernfunktion (analog `services/din276.js`):
`mischhonorar({ akGesamt, splits:[{zoneId, zonePercent, amount}], tafelFn }) →
{ honorar, herleitung:[{zone, hVoll, anteil, einzelhonorar}] }`, wobei `tafelFn`
die Tafel-Interpolation kapselt → Unit-Tests mit Referenzbeispielen (wie das
DIN-276-Modul).

### 4.3 UI (HonorarWizard, Basis-Schritt)

- Umschalter/Erweiterung im Basis-Schritt: **„Anrechenbare Kosten auf
  Honorarzonen aufteilen (Mischhonorar)"**.
- Kleiner Editor: Zeilen `{ Honorarzone (Dropdown FEE_ZONES), Betrag € }`,
  Summenzeile mit Live-Abgleich gegen K0 (`Σ = AK_gesamt`?), Add/Remove.
- Live-Vorschau: Einzelhonorare je Zone + Mischhonorar (Herleitung).
- Greift die K0 aus der DIN-276-Übernahme auf (bzw. manuelles K0) als
  `AK_gesamt`.

### 4.4 PDF / Nachvollziehbarkeit

- `services_pdf_render.js` / `honorar.njk`: bei vorhandenen Splits eine
  **Mischhonorar-Herleitung** ausweisen (je Zone: `AK_z`, `H_voll(z)`, Anteil,
  Einzelhonorar; Summe = Grundhonorar-Basis). Fügt sich neben die vorhandene
  DIN-276-Herleitung.

### 4.5 Integration / Rückwärtskompatibilität

- Ohne Splits: exakt heutiges Verhalten. Feature ist rein additiv.
- RBAC: bestehende `projects.calculations.edit`.
- Hilfe-Tooltips (Mischhonorar, Zonenanteil) gemäß `HELP_TOOLTIP_CONCEPT.md`.

---

## 5. Umsetzungs-Bausteine (Vorschlag)

1. **Kernfunktion `mischhonorar(...)` + Unit-Tests** (reine Rechenlogik, gegen
   Referenzbeispiele; Tafel-Interpolation als Parameter).
2. **Datenmodell** `FEE_CALC_ZONE_SPLIT` (Migration, RLS) + Laden/Speichern,
   Validierung `Σ AMOUNT = K0`.
3. **`calculateRevenueFields`-Erweiterung**: Splits → `REVENUE_K0` per
   Mischhonorar; Einzelzonen-Pfad unverändert.
4. **UI im HonorarWizard** (Zonen-Split-Editor + Live-Herleitung).
5. **PDF-Herleitung** + Feinschliff.
6. **Optional/später:** Zusammenfassen mehrerer Anlagengruppen (§ 54 Abs. 2);
   Übertragung der Mischzonen-Logik auf weitere Leistungsbilder.

---

## 6. Offene Entscheidungen (vor Umsetzung)

1. **`ZONE_PERCENT` je Zonenanteil:** eigenes Feld je Split (flexibel) oder
   vereinfachend eine gemeinsame Position? (Empfehlung: eigenes Feld, Default
   Zonenmitte.)
2. **Validierung `Σ AMOUNT = K0`:** hart (Speichern blockieren) oder weich
   (Warnung, Rest automatisch der letzten Zone zuschlagen)? (Empfehlung: weich mit
   deutlichem Hinweis; hart bei „Finalisieren".)
3. **Geltungsbereich:** nur TGA, oder Zonen-Split generisch für alle
   Leistungsbilder anbieten (die Regel ist verallgemeinerbar)? (Empfehlung: Logik
   generisch bauen, UI zunächst für TGA/Kosten-Basis sichtbar machen.)
4. **Verhältnis zu Anlagengruppen:** ein `FEE_CALCULATION_MASTER` = eine
   Anlagengruppe (heutiges Modell) — Splits liegen dann je Anlagengruppen-
   Berechnung. Bestätigen, dass das dem realen Vorgehen entspricht.
5. **Mischbasis:** Mischhonorar nur auf K0 (AK der Anlagengruppe) — oder müssen
   weitere Kx-Basen Splits tragen können?

---

## 7. Quellen (Recherche)

- HOAI § 53/§ 54 (Technische Ausrüstung, anrechenbare Kosten, Mischhonorar) —
  dejure.org, buzer.de, NWB, juraforum.de (Volltext-Fassungen)
- Ermittlung anrechenbare Kosten TGA & Mischhonorar-Mechanik:
  weka.de/architekten-ingenieure/technische-ausruestung-ermittlung-der-anrechenbaren-kosten
- Interpolation/Honorarzonen: bauprofessor.de, phase0.com, plansync.de

> ⚠️ Verbindlich ist der HOAI-Gesetzestext (§ 54). Die hier beschriebene
> Mechanik und das Beispiel sind Rechercheergebnisse und vor der Implementierung
> gegen die Primärquelle zu prüfen sowie per Unit-Test mit einem geprüften
> Referenzfall abzusichern.
