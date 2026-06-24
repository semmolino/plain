# Konzept: Individualisierbare PDF-Dokumente (plan&simple)

Stand: 2026-06-24 · Status: Konzept / zur Abstimmung

Ziel: Nutzer (typischerweise Controller / Geschäftsleitung — **keine Designer, keine
Entwickler**) sollen selbst bestimmen können, **welche Inhalte/Anhänge** ihre PDFs
enthalten und **wie sie aussehen** — ohne sich ein Dokument „kaputt designen" zu können.

---

## 1. Ausgangslage — was es heute schon gibt

Wir bauen **nicht** auf der grünen Wiese. Vorhandenes Fundament (Migration `0002`, `0038`,
`services_pdf_render.js`):

| Baustein | Heute |
|---|---|
| `DOCUMENT_TEMPLATE` | Tabelle pro Company × DOC_TYPE: `LAYOUT_KEY`, `THEME_JSON` (jsonb), `LOGO_ASSET_ID`, `IS_DEFAULT` |
| `THEME_JSON` | Teilweise genutzt: `brand.{primaryColor,accentColor,fontFamily,fontScale}`, `header.{showLogo,logoMaxHeightMm}`, `footer.showPageNumbers`, `blocks.{showProjectStructure,showTec}` |
| `TEXT_TEMPLATE` | Kopf-/Fußtext pro Tenant × Dokumenttyp (`HEADER_TEXT`, `FOOTER_TEXT`) |
| Logo / Signatur | Upload als `ASSET`, base64-Cache in `TENANT_SETTINGS` pro Company |
| Fußzeile | Wird aus Stammdaten (Name, Bank, Steuer, Gläubiger-ID) als Spalten gebaut |
| Templates | Nunjucks in `templates/modern_a/`: invoice, partial_payment, storno, offer, auftragsbestaetigung, monatsabschluss, mahnung, honorar |
| **Snapshot** | `INVOICE`/`PARTIAL_PAYMENT` haben `DOCUMENT_*_SNAPSHOT`-Spalten → Layout+Theme werden beim Buchen eingefroren |

**Konsequenzen für das Konzept:**
- Wir erweitern das `THEME_JSON`-Schema und die Block-Logik — **kein Bruch**, sondern Ausbau.
- Der Snapshot-Mechanismus ist bereits da und ist die wichtigste Sicherheits-Eigenschaft
  (siehe §3). Er muss konsequent auf alle neuen Optionen ausgedehnt werden.
- Latente Lücke: `defaultTheme()` liefert aktuell **kein** `brand.*`, obwohl `base.css` es
  referenziert (`--primary` etc. landen leer). Das wird im Zuge der Umsetzung mitgefixt.

---

## 2. Leitprinzipien (für genau diese Zielgruppe)

1. **Vorlagen statt leere Leinwand.** Ein Controller will kein Designprogramm. Er will aus
   wenigen guten, fertig wirkenden Looks wählen und Details anpassen. Start = „sieht sofort
   professionell aus", nicht „weißes Blatt".
2. **Geführte Konfiguration statt Freihand-Drag&Drop.** Pixelgenaues Verschieben auf einem
   Rechtsdokument ist für Laien eine Falle (Überlappungen, abgeschnittene Felder, DIN-Verstöße).
   Wir bieten **strukturierte Optionen + Live-Vorschau**, keine freie Positionierung.
3. **Man kann nichts kaputt machen.** Pflicht-Bausteine (Rechnungsnummer, Beträge, USt,
   Pflichtangaben §14 UStG) sind **nicht abschaltbar**. Optionen, die rechtlich/optisch riskant
   wären, gibt es gar nicht erst.
4. **Live-Vorschau immer sichtbar.** Jede Änderung sofort am echten (oder Beispiel-)Beleg sehen.
   Das ersetzt „Design-Verständnis" durch „sehen, was passiert".
5. **Trennung Stammdaten ↔ Gestaltung.** Bankverbindung, USt-IdNr., Adresse = Stammdaten (zentral,
   einmal). Logo, Farbe, Schrift, Reihenfolge = Gestaltung. Nicht vermischen.
6. **Unveränderlichkeit gebuchter Belege.** Was gebucht/versendet wurde, sieht für immer gleich
   aus (Snapshot). Neue Vorlagen wirken nur auf neue Belege.
7. **Vererbung mit Override.** Tenant-Default → Company-Vorlage → (optional) Dokumenttyp-Override.
   90 % stellen es einmal ein und nie wieder.

---

## 3. Praxis-Recherche — wie andere es lösen

| Tool | Ansatz | Lehre für uns |
|---|---|---|
| **lexoffice / Lexware Office** | Standard-Vorlage + Personalisierung im **Vorschau-Schritt**; „für echte Menschen ohne technisches Wissen" | Vorschau-zentriert; bewusst **wenige** Stellschrauben. Erfolg = Einfachheit, nicht Mächtigkeit. |
| **sevdesk** | „In < 2 Min ein eigenes Layout"; geführte UI; Logo per Drag&Drop **hochladen** (nicht platzieren) | Drag&Drop nur fürs **Hochladen** von Assets, nicht fürs Positionieren von Feldern. Geschwindigkeit als Versprechen. |
| **zistemo** | Expliziter Drag&Drop-Element-Builder (Felder ziehen) | Mächtig, aber zielt eher auf Power-User. Für unsere Zielgruppe **zu offen** → bewusst nicht Phase 1. |
| **Canva (Invoice-Templates)** | Galerie professioneller Vorlagen, design-first | Bestätigt: **Vorlagengalerie** ist der intuitivste Einstieg. Look-Auswahl schlägt Eigenbau. |
| **Odoo** | Templates + Felder + Design, aber technischer (z. T. Entwickler nötig) | Negativbeispiel für unsere Zielgruppe: zu nah am Code. |
| **Block-Editoren** (WordPress Gutenberg, Shopify Sections/Blocks, BlockNote) | Sektionen/Blöcke **an-/abschalten + per Liste umsortieren** (List View), nicht frei auf Canvas | Das ist das **goldene Mittelmaß**: Bausteine als Liste mit Auge-Icon (sichtbar/aus) und Drag-Handle zum Umsortieren — vertraut, sicher, kein Layout-Chaos. |

**Synthese / Designentscheidung:** Der intuitivste *und* sicherste Weg für Controller ist die
Kombination aus **(a) Vorlagengalerie** (1-Klick-Look) + **(b) strukturiertem Konfigurator mit
Block-Liste** (an/aus + umsortieren) + **(c) durchgehender Live-Vorschau**. **Kein** freies
Canvas-Drag&Drop. „Verschieben einzelner Felder" lösen wir über **Layout-Varianten/Presets**
(z. B. Logo links/rechts/zentriert), nicht über Pixel-Positionierung — siehe §5.4.

**Deutsche Norm als Leitplanke (Verkaufsargument):** Das Adressfeld muss in das Sichtfenster von
Briefumschlägen passen (DIN 5008 / DIN 676 Form A & B). Genau **deshalb** ist freie Positionierung
ein Risiko und eine geführte Lösung ein Qualitätsmerkmal: „passt garantiert ins Fensterkuvert".

---

## 4. Das UX-Modell: drei Ebenen (zunehmende Tiefe, abnehmende Häufigkeit)

```
┌─────────────────────────────────────────────────────────────────┐
│ Ebene 1 — STIL-VORLAGEN (Themes)         „Wähle einen Look"      │  ← 1 Klick, 90 % bleiben hier
│   Karten mit Vorschaubild: Modern · Klassisch · Kompakt · Mono   │
├─────────────────────────────────────────────────────────────────┤
│ Ebene 2 — KONFIGURATOR (Live-Vorschau)   „Pass es an"           │  ← 10 Min einmalig
│   Linke Spalte = Optionen (Tabs)  │  Rechte Spalte = echte PDF-  │
│                                    │  Vorschau, live              │
│   Tabs: Branding · Kopf/Fuß · Bausteine · Anhänge · Felder       │
├─────────────────────────────────────────────────────────────────┤
│ Ebene 3 — PRO/ERWEITERT (optional, später)  „Feinheiten"        │  ← selten, ggf. lizenzgated
│   eigene Schriftarten hochladen, mehrere Vorlagen/Marken, …      │
└─────────────────────────────────────────────────────────────────┘
```

Einstieg über **Einstellungen → Dokumentvorlagen**. Vorschau nutzt einen **echten Beispielbeleg**
(oder den geöffneten Beleg) und rendert über die bestehende `renderDocumentPdf`-Pipeline → die
Vorschau ist **pixelidentisch** mit dem späteren PDF (kein separater Vorschau-Renderer, der abweicht).

### Live-Vorschau — technisch
- Frontend schickt das (ungespeicherte) `THEME_JSON` an einen **Preview-Endpoint**
  (`POST /document-templates/preview`), der gegen einen Demo-/Beispielbeleg rendert und das PDF/PNG
  zurückgibt. Debounce ~300 ms.
- Optional schneller: Vorschau-Modus rendert **HTML statt PDF** (Playwright weglassen) in einen
  `<iframe srcdoc>` — < 100 ms, identisches CSS. PDF-Roundtrip nur beim finalen „So sieht's gedruckt aus".

---

## 5. Flexible Bestandteile — vollständiger Katalog

Gruppiert nach Konfigurator-Tab. Jede Option lebt im `THEME_JSON` (Schema §7).

### 5.1 Branding (Tab „Branding")
- **Logo**: Upload (vorhanden), max. Höhe (mm), Position (links | rechts | zentriert — Preset).
- **Akzentfarbe** (`primaryColor`) + optional zweite Farbe (`accentColor`). Farbwähler **mit
  Palette guter Defaults** + Eingabe HEX. Live an Überschriften/Linien/Summenbox.
- **Schriftart**: Auswahl aus kuratierter Liste websicherer/eingebetteter Fonts
  (z. B. Inter, Source Sans, Lato, Merriweather, PT Serif) — **keine** beliebigen System-Fonts
  (sonst weicht das Rendering ab). Eigene Fonts hochladen = Ebene 3.
- **Schriftgröße/Dichte** (`fontScale`): Kompakt / Normal / Großzügig (3 Stufen statt Slider).
- **Eckenradius / Linienstil**: dezent (Modern) vs. kantig (Klassisch) — Teil des Themes, optional einzeln.

### 5.2 Kopf- & Fußzeile (Tab „Kopf/Fuß")
- **Kopftext** und **Fußtext** pro Dokumenttyp (baut auf `TEXT_TEMPLATE` auf), mit **Platzhaltern**
  (`{{Projektname}}`, `{{Rechnungsnummer}}`, `{{Datum}}`, `{{Ansprechpartner}}`, …) — Einfügen per
  Klick-Chips, nicht frei tippen müssen.
- **Fußzeilen-Spalten**: heute aus Stammdaten generiert. Neu: an/aus pro Spalte (Bank / Steuer /
  Adresse / Sonstiges) + Reihenfolge; freie Zusatzspalte möglich.
- **Seitenzahlen** an/aus (`footer.showPageNumbers`, vorhanden).
- **Kleingedrucktes / Rechtshinweise** (z. B. Gerichtsstand) als optionaler Fußblock.

### 5.3 Bausteine / Sektionen (Tab „Bausteine") — Kern der Inhaltssteuerung
Liste mit **Auge-Icon (sichtbar/aus)** + **Drag-Handle (Reihenfolge)**, je Dokumenttyp.
Pflicht-Bausteine sind fixiert (Schloss-Icon, nicht abschaltbar). Beispiele:

| Baustein | Typ | Abschaltbar? |
|---|---|---|
| Briefkopf (Logo + Absender) | alle | nein |
| Empfänger-/Adressblock (DIN-Fenster) | alle | nein |
| Betreff / Dokumenttitel + Nummer + Datum | alle | nein |
| Anrede + Einleitungstext | alle | ja (Text leer = aus) |
| Positions-/Leistungstabelle | Rechnung/Angebot | nein |
| Projektstruktur-Übersicht | Rechnung | ja (`blocks.showProjectStructure`, vorhanden) |
| Zuschlagsübersicht | Rechnung | ja |
| TEC/Stundennachweis inline | Rechnung | ja (`blocks.showTec`, vorhanden) |
| Abschlags-/Zahlungshistorie | Schluss/Teilschluss | ja |
| Skonto-/Rabattzeile | Rechnung | ja (datengetrieben) |
| Sicherheitseinbehalt | Rechnung | ja (datengetrieben) |
| Bankverbindung + GiroCode/EPC-QR | zahlbare Belege | QR an/aus |
| Schlusstext / Grußformel | alle | ja |
| Unterschrift (Bild) | Angebot/AB | ja |

### 5.4 Felder & Layout-Varianten (Tab „Felder")
„Verschiebung einzelner Felder" — **ehrliche Empfehlung:** nicht als Freihand, sondern als wenige
**Layout-Presets** je Zone, weil das Ergebnis garantiert sauber/DIN-konform bleibt:
- **Logo-Position**: links | rechts | zentriert.
- **Absenderzeile** über Adressfeld: an/aus, Inhalt aus Stammdaten.
- **Meta-Block** (Nr./Datum/Projekt/Kunden-Nr.): welche Felder anzeigen (Checkliste) + 1-/2-spaltig.
- **Kunden-/Projektreferenzen**: welche Referenzfelder erscheinen (Auftrags-Nr., Bestell-Nr.,
  Leistungszeitraum, Bearbeiter …).
- **Spalten der Positionstabelle**: an/aus (Menge, Einzelpreis, §-Phase, MwSt-Satz …) + Reihenfolge.

Freie Pixel-Positionierung bewusst **nicht** in Phase 1–3. Falls je gewünscht: nur Ebene 3, mit
Snap-Raster + Kollisionsschutz + DIN-Schutzzonen.

---

## 6. Anhänge-Konzept

Anhänge = **zuschaltbare Anhang-Module**, die als zusätzliche Seiten an das PDF angehängt werden
(eigene Seitenumbrüche, eigene Überschrift). Pro Dokumenttyp einzeln an/aus + Reihenfolge.

| Anhang | Datenquelle (vorhanden) | Optionen |
|---|---|---|
| **Projektübersicht** | `projectStructureRows`, `structureTotals` | Detailtiefe (nur Hauptphasen / alle Elemente), Spaltenwahl, mit/ohne Beträge |
| **Stundenübersicht** | `loadTecRows` (gruppiert je Element, Summen) | gruppiert/chronologisch, mit/ohne Stundensatz, Zeitraum |
| **HOAI-/Kalkulation** | `honorarCalcs` (FEE_CALCULATION_MASTER) | je Kalkulation, Kurz/Detailliert, anonymisiert |
| **(neu denkbar)** Zahlungshistorie als Anhang | `projectPayments` | — |
| **(neu denkbar)** AGB / Anlagen-PDF | Upload als `ASSET` | statisches PDF anhängen (PDF-Merge) |
| **(neu denkbar)** Leistungsnachweis / Aufmaß | projektabhängig | — |

Technisch: Anhänge sind eigene Nunjucks-Partials, die **schon existieren** (Projektstruktur, TEC,
Honorar werden heute teils inline gerendert) — wir machen sie zu **eigenständigen, schaltbaren
Blöcken** mit `page-break-before`. Statische Upload-PDFs (AGB) per `pdf-lib`/`pdf-merge` nach dem
Playwright-Render zusammenführen.

---

## 7. Datenmodell — Erweiterung (kein Bruch)

`THEME_JSON` wird zum versionierten Konfigurationsobjekt. Vorschlag:

```jsonc
{
  "version": 2,
  "themePreset": "modern",            // Ebene-1-Auswahl
  "brand": {
    "primaryColor": "#1e3a5f",
    "accentColor":  "#c8a45c",
    "fontFamily":   "Inter",
    "fontScale":    1.0,              // 0.92 | 1.0 | 1.08
    "cornerStyle":  "soft"           // soft | square
  },
  "header": { "showLogo": true, "logoMaxHeightMm": 20, "logoPosition": "left" },
  "footer": { "showPageNumbers": true,
              "columns": ["address","bank","tax"],   // an/aus + Reihenfolge
              "legalNote": "" },
  "blocks": {                          // sichtbarkeit + reihenfolge je Baustein
    "order": ["intro","positions","structure","surcharges","tec","payments","totals","closing","signature"],
    "intro": true, "structure": true, "surcharges": true, "tec": false,
    "payments": true, "closing": true, "signature": false,
    "giroCode": true
  },
  "fields": {
    "meta": ["number","date","project","customerNo","period"],
    "tableColumns": ["pos","desc","qty","price","total"]
  },
  "attachments": {
    "order": ["projectOverview","hours","hoai"],
    "projectOverview": { "on": true, "detail": "phases", "amounts": true },
    "hours":           { "on": false, "grouped": true, "rate": true },
    "hoai":            { "on": true, "detail": "short" },
    "files": [ /* {assetId, label} statische PDFs */ ]
  }
}
```

**Migrationen (neu, manuell in Supabase — Konvention `0078_…`):**
- `THEME_JSON` bleibt jsonb → **keine** Schema-Migration nötig fürs Theme selbst; nur ein
  **Default-Theme v2** als Seed + Backfill-Funktion `migrateThemeV1toV2()` im Renderer
  (analog `deepMerge(defaultTheme(), …)` heute).
- `ATTACHMENT_FILE`/statische PDFs nutzen vorhandene `ASSET`-Tabelle.
- Optional `DOCUMENT_TEMPLATE.DOC_TYPE` erweitern für fehlende Typen (OFFER existiert via Code-Default;
  AB/Storno/Mahnung sollten eigene Default-Rows bekommen, statt nur über Code-Fallback zu laufen).

**Snapshot-Pflicht:** Beim Buchen wird `THEME_JSON` v2 **vollständig** in
`DOCUMENT_THEME_SNAPSHOT_JSON` eingefroren (Mechanik existiert). Anhänge, die Live-Daten ziehen
(z. B. Stundenübersicht), werden zum Buchungszeitpunkt **materialisiert** mitgespeichert, damit ein
Nachdruck identisch bleibt.

---

## 8. Dokumenttypen — Abdeckung

Alle gewünschten Varianten + die vergessenen. „Teilt Theme" = erbt Branding/Kopf-Fuß vom
Company-Default; nur Bausteine/Anhänge typ-spezifisch.

| Dokumenttyp | Template heute | Besonderheit |
|---|---|---|
| Angebot | `offer.njk` | Bausteine: Leistungsbeschreibung, HOAI-Kalkulation, Unterschrift |
| Auftragsbestätigung | `auftragsbestaetigung.njk` | wie Angebot + Auftragsbezug |
| Abschlags-/Anzahlungsrechnung | `partial_payment.njk` | kumulative AR-Sicht, SE |
| Rechnung | `invoice.njk` | Standard |
| Teilschluss-/Schlussrechnung | `invoice.njk` (Typ-Feld) | Abzug bisheriger Abschläge, SE-Auflösung |
| Stornorechnung | `storno.njk` | Bezug auf Originalrechnung, kein QR |
| **Mahnung / Zahlungserinnerung** | `mahnung.njk` | Mahnstufen-Text (existiert) — in Konfigurator aufnehmen |
| **Monatsabschluss** | `monatsabschluss.njk` | interner Report — Branding mitnutzen |
| *Vergessen / sinnvoll ergänzend* | — | **Lieferschein/Leistungsnachweis**, **Gutschrift** (echte Gutschrift ≠ Storno), **Kostenvoranschlag**, **Zahlungsquittung** |

Empfehlung: zentraler **Dokument-Registry** (`DOC_TYPES`-Map: key → {title, template, erlaubte
Blöcke, erlaubte Anhänge}), damit ein neuer Typ = ein Registry-Eintrag, nicht verstreute `if`-Logik.

---

## 9. Technische Umsetzung (Renderer)

- **Bausteine als Partials:** `invoice.njk` etc. werden in `{% include %}`-Blöcke zerlegt
  (`_block_intro.njk`, `_block_positions.njk`, `_block_structure.njk`, `_block_tec.njk`,
  `_attach_hours.njk`, …). Ein **Master-Template** iteriert über `theme.blocks.order` und rendert
  nur eingeschaltete Blöcke. → Reihenfolge/Sichtbarkeit aus JSON, ohne Template-Wildwuchs.
- **Layout-Key bleibt** der grobe „Look" (modern_a, classic_a, …); `themePreset` mappt darauf +
  setzt Brand-Defaults. Mehrere Looks = mehrere CSS-Basisdateien, gleiche Partials.
- **Live-Vorschau** über bestehende Pipeline (s. §4), Demo-Beleg aus dem geplanten Demo-Mandanten
  (siehe `project_demo_tenant`).
- **Fonts** vorab als `@font-face` (base64/lokal) eingebettet → konsistenter Druck, kein CDN.
- **Defaults/Merge** wie heute: `deepMerge(defaultThemeV2(), tpl.THEME_JSON)` — alte v1-Themes
  werden beim Laden transparent hochgezogen.

---

## 10. Pflichten aus CLAUDE.md (mitlaufen lassen)

- **RBAC:** Permission **`settings.document_templates.edit`** (Migration `0078`, Default nur
  **Administrator** — analog `settings.email.edit`; Geschäftsleitung ist in `0062` bewusst „keine
  Konfiguration", kann es per Rollenverwaltung erhalten). Konventionskonform im Modul `settings`,
  abgegrenzt von `settings.text_templates.edit` (Kopf-/Fußtexte). Die `/document-templates`-Routes
  sind damit gegated; das **PDF-Rendering selbst** liest `DOCUMENT_TEMPLATE` direkt im Render-Service
  und ist NICHT betroffen (normale Nutzer erzeugen weiter PDFs). Frontend: `<Can
  permission="settings.document_templates.edit">`.
- **In-Product-Hilfe:** jede Einstellung im Konfigurator ist erklärungsbedürftig → `helpContent.tsx`
  Einträge `vorlagen.*` (Logo, Akzentfarbe, Bausteine, Anhänge, Platzhalter) via `<HelpHint>`;
  Leerzustand „Noch keine eigene Vorlage — so wirkt der Standard".
- **Icons:** Lucide (z. B. `Palette`, `LayoutTemplate`, `Eye`/`EyeOff`, `GripVertical`, `Type`,
  `Image`). Keine Emojis.
- **Responsive/Modal-Regeln:** Konfigurator als eigene Seite (nicht Modal) — Vorschau braucht Platz;
  auf Mobile Vorschau unter die Optionen stapeln.

---

## 11. Phasenplan (jede Phase einzeln auslieferbar)

| Phase | Inhalt | Nutzen |
|---|---|---|
| **P0** | `defaultTheme()` → v2, `brand.*` korrekt befüllen (Bugfix), Snapshot v2 absichern | sofort konsistente Farben/Fonts |
| **P1 — Branding** | Tab Branding: Logo-Position, Akzentfarbe (Palette), Schriftart/-größe, Live-Vorschau (HTML-iframe) | „sieht nach uns aus", 1 Tag Sichtbarkeit |
| **P2 — Stil-Vorlagen** | Ebene 1: 3–4 Themes als Karten mit Vorschaubild | 1-Klick-Look |
| **P3 — Kopf/Fuß + Platzhalter** | `TEXT_TEMPLATE` in Konfigurator, Platzhalter-Chips, Fußspalten an/aus | individuelle Texte ohne Risiko |
| **P4 — Bausteine** | Block-Liste (Auge + Drag), Master-Template-Refactor, Pflicht-Sperren | Inhalt steuern |
| **P5 — Anhänge** | Projektübersicht / Stunden / HOAI als schaltbare Anhang-Module + statische PDFs | der eigentliche „Anhänge"-Wunsch |
| **P6 — Felder/Varianten** | Meta-/Tabellen-Spaltenwahl, Layout-Presets | Feinschliff |
| **P7 (optional/Pro)** | mehrere Marken/Vorlagen, eigene Fonts, ggf. Lizenz-Gating | Power-User, Monetarisierung |

Empfohlener Startpunkt: **P0 + P1** (kleiner, sichtbarer Gewinn, schafft die Vorschau-Infrastruktur,
auf der alles Weitere aufsetzt).

---

## 12. Entscheidungen

**Bereits entschieden (2026-06-24):**
- ✅ **Feld-Layout = Layout-Presets**, kein Freihand-Drag&Drop (sicher, DIN-konform). Freies
  Positionieren bleibt allenfalls Ebene-3-Option mit Schutzzonen.
- ✅ **Live-Vorschau gegen Demo-Beispielbeleg** (aus Demo-Mandant, immer verfügbar, zeigt alle
  Bausteine) — nicht gegen den jeweils offenen Beleg.
- ✅ **Eine Vorlage pro Company** je Dokumenttyp (wie heute). Mehrmarken = später / Pro.

**Ebenfalls entschieden (2026-06-24):**
- ✅ **Erstes Release = P0 + P1** (Theme-v2-Bugfix + Branding-Tab mit Live-Vorschau). Stil-Vorlagen
  (P2) und Bausteine/Anhänge (P4/P5) folgen danach.
- ✅ **Permission `settings.document_templates.edit`** (Default Administrator) — siehe §10.
- ✅ **Live-Vorschau = synthetisches Demo-View-Model** (im Code hinterlegter Beispiel-Beleg, keine
  DB-Abhängigkeit, zeigt alle Bausteine).

**Bestandsaufnahme Backend (vorgefunden, nicht neu zu bauen):**
Es existiert bereits ein **vollständiger CRUD** für `DOCUMENT_TEMPLATE` (`routes/controllers/services
documentTemplates.js`) mit **Lifecycle DRAFT → PUBLISHED → ARCHIVED**, **Versionierung** (`FAMILY_ID`/
`VERSION`), `duplicate`, `set-default`. Das deckt die Unveränderlichkeit elegant ab (editieren nur am
DRAFT, `publish` macht live, `set-default` aktiviert). Bisher **nicht** im Frontend genutzt und war
**ungegated**. Achtung: dieser Service hat eine **zweite `defaultTheme()`** mit abweichender Form
(`footer.textLeft/Right`, `blocks.showProject…`) als der Render-Service — beim Frontend-Bau auf die
**eine kanonische v2-Form** (Render-Service) vereinheitlichen.

**Umsetzungsstand — P0 + P1 KOMPLETT (Branch `feature/pdf-template-customization`):**
- ✅ **P0**: kanonisches `defaultTheme()` v2 (`services_theme_defaults.js`) — Defaults reproduzieren
  exakt den heutigen Look (Null-Regression).
- ✅ **P1-Security**: Migration `0078` (Permission `settings.document_templates.edit`) +
  `requirePermission`-Gating der `/document-templates`-Routes.
- ✅ **P1-Backend**: Branding in die ECHTEN Templates verdrahtet (`_theme_head.njk` in
  invoice/storno/offer/auftragsbestaetigung/partial_payment) → Schrift, Akzentfarbe (`.doc-title`),
  Logo-Position wirken jetzt real. (`base.css` war toter, nirgends eingebundener Code.) Plus
  `POST /document-templates/preview` (synthetischer Beispiel-Beleg → JSON `{ html }`) und
  vereinfachter `GET/PUT /document-templates/branding` (eine Marke für alle Belegtypen).
- ✅ **P1-Frontend**: Einstellungen-Tab „Dokumentvorlagen" (Hausfarbe, Schrift, Logo-Position) mit
  Live-Vorschau (iframe), `<HelpHint>` (`vorlagen.*`), gegated via PAGE_TABS-Permission.
- **Verifiziert:** 52/52 Jest, Preview-Smoke + Template-Compile grün, `npx tsc -b` sauber, voller
  vite-Build grün.

**Offene To-dos für den Nutzer:** Migration `0078` manuell in Supabase einspielen. Branch ist NICHT
auf `main` → kein Railway-Deploy (Merge/PR auf Wunsch).

**Nächste Phasen (noch offen):** P2 Stil-Vorlagen (Karten), P3 Kopf/Fuß + Platzhalter, P4 Bausteine
(an/aus + Reihenfolge), P5 Anhänge (Projektübersicht/Stunden/HOAI), P6 Felder/Varianten,
P7 Pro (Mehrmarken/eigene Fonts). Optional später: echte Webfont-Einbettung (@font-face), damit
benannte Schriftarten statt nur Serif/Sans möglich sind; Logo-Position auch für `partial_payment`
(nutzt `.headerRow .logoBox` statt `.logo-area`).

---

*Recherche-Quellen: lexoffice/Lexware Office Hilfe, sevdesk Produktseiten, zistemo Invoice Creator,
Canva Invoice-Templates, Odoo-Customization-Guide, Block-Editor-Muster (WordPress Gutenberg,
Shopify Sections/Blocks, BlockNote).*
