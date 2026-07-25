# Modul „Nachträge" — Ganzheitliches Konzept für plan&simple

> Status: **Konzept + Foundation begonnen** · Stand: 2026-07-25 · Branch-Vorschlag: `feature/nachtraege`
>
> **Getroffene Entscheidungen (2026-07-25):** ① Scope: **eigene Honorar-Nachträge zuerst** (N1). ② RBAC: `nachtraege.*` wird angelegt, **ohne** Freigabe-Schwellenwert (auf später verschoben). ③ Struktur-Übernahme: **Option A** (synthetischer „Nachträge"-Wurzelknoten). ④ Lizenz: **eine** Capability `nachtraege.management`.
> **Umsetzungsstand (N1 + N2 umgesetzt):** Migrationen `0105` (Schema) + `0106` (RBAC) + `0107` (Prüfbarkeit) + `0108` (Notification-Typen) + `0109` (Lizenz-Seed: Modul/Capability/Plan-Zuordnung, **self-contained**) — **manuell in Supabase in Nummern-Reihenfolge einzuspielen**. Das regenerierte `0070b` ist nur für frische Installs relevant und **keine** Voraussetzung für `0109` (dieses legt die `LICENSE_CAPABILITY`-Zeile selbst an).
> **N1:** Backend (Service/Controller/Route + `server.js`), Frontend (Modul `/nachtraege` + Liste/Anlegen, Detailseite mit Struktur-Editor + Freigabe-Dialog + Historie, Nav-Icon `FileDiff`), Lizenz-Capability `nachtraege.management` (Manifest + Seed, Drift-Check grün), In-Product-Hilfe (`helpContent.tsx`).
> **N2:** Projekt-Detail-Tab „Nachträge"; Prüfbarkeits-Checkliste + Prüfvermerk (`PUT /:id/review`, Permission `nachtraege.review`); Nachtrags-PDF (`nachtrag.njk` + `renderNachtragPdf`, `GET /:id/pdf`); Fristen-Erinnerungen (`nachtragFristenChecker`, täglich, an Prüffrist); KPI-Streifen (Anzahl/offen, Gefordert, Freigegeben/beauftragt, Freigabequote).
> **Bewusst NICHT umgesetzt:** Fremdnachträge (`NACHTRAG_TYPE=MANAGED`, ehem. N3) — laut Produktentscheidung nicht benötigt.
>
> Verwandte Konzepte: [DATA_IMPORT_CONCEPT.md](DATA_IMPORT_CONCEPT.md) · [SERVICE_AREA_CONCEPT.md](SERVICE_AREA_CONCEPT.md) · [LICENSE_TIERS_CONCEPT.md](LICENSE_TIERS_CONCEPT.md) · [HELP_TOOLTIP_CONCEPT.md](HELP_TOOLTIP_CONCEPT.md) · [RBAC_DEVELOPMENT_CHECKLIST.md](RBAC_DEVELOPMENT_CHECKLIST.md)
>
> Fachliche Grundlage: allgemeine Branchenpraxis (HOAI/AHO/VOB/BGB) sowie ein einschlägiges Prozessmodell/Leistungsbild zum Nachtragsmanagement aus einer Dissertation (RWTH Aachen). Personennamen wurden bewusst **nicht** übernommen.

---

## 0. Kurzfassung (TL;DR)

Nachträge sind **nachträgliche Änderungen des vertraglich vereinbarten Leistungs- und Vergütungsumfangs**. Für ein Planungsbüro sind sie doppelt relevant:

1. **Eigene Honorar-Nachträge (AN-Sicht)** — das Büro macht gegenüber dem Bauherrn Mehr- oder Änderungshonorar geltend (geänderte/zusätzliche Leistungen nach § 10 HOAI, Besondere Leistungen, Wiederholungs- und Beschleunigungsleistungen, gestörter Bauablauf). Das ist die natürliche Fortsetzung der bestehenden Kette **Angebot → Projekt → Buchung → Rechnung**.
2. **Nachtragsmanagement als Projektleistung (AG-/Beratungs-Sicht)** — das Büro *managt* im Rahmen der Objektüberwachung (LPH 8) die Nachträge der ausführenden Firmen für den Bauherrn. Genau hier fehlt am Markt ein durchgängiges Werkzeug — das ist die **Differenzierungschance** für plan&simple.

Das Konzept beschreibt beide Sichten, empfiehlt aber einen **vertikalen Durchstich auf Sicht 1 zuerst** (dockt verlustfrei an das bestehende Datenmodell an) und die Sicht 2 als ausbaufähigen Aufsatz (Register, Prüfbarkeit, Fristen, Prozessmodell präventiv/proaktiv/reaktiv).

Technisch ist ein Nachtrag im Kern ein **projektgebundenes Mini-Angebot** (`NACHTRAG` + `NACHTRAG_STRUCTURE`, baugleich zu `OFFER`/`OFFER_STRUCTURE`), das bei **Freigabe** — analog zur bestehenden Funktion `convertOfferToProject` — **ganz oder teilweise in die `PROJECT_STRUCTURE` übernommen** wird. Danach funktionieren **Buchungen** (TEC) und **Abrechnung** (INVOICE) ohne Sonderpfad, weil beide bereits generisch über `PROJECT_STRUCTURE` laufen.

---

## 1. Zielbild und Einordnung

### 1.1 Was das Modul leisten soll

- **Klarheit**: Jeder Nachtrag hat einen eindeutigen Status, eine Anspruchsgrundlage, eine nachvollziehbare Historie und einen klaren Bezug zu Projekt, Vertrag und ggf. Rechnung.
- **Projektstabilität**: Mehrleistungen „versickern" nicht mehr in normalen Stundenbuchungen; der Auftragswert wächst kontrolliert und sichtbar mit jeder Freigabe.
- **Bessere Ergebnisse**: Fristen werden nicht verpasst, Nachträge sind prüffähig aufbereitet, und die **Nachtragsquote** wird messbar (Volumen, Erfolgsquote, Bearbeitungsdauer).

### 1.2 Die zwei Perspektiven (bewusst getrennt halten)

| | **Eigene Honorar-Nachträge** | **Nachtragsmanagement als Leistung** |
|---|---|---|
| Wer stellt? | Das Büro selbst → an den Bauherrn | Die ausführenden Firmen → an den Bauherrn; das Büro **prüft/steuert** |
| Vergütung | Eigenes Mehrhonorar | Prüf-, Bewertungs- und Steuerungsaufwand (eigene Leistung) |
| Rechtsrahmen | § 10 HOAI, § 650b/c BGB, Besondere Leistungen | VOB/B § 2, § 650b/c BGB — geprüft, nicht gestellt |
| plan&simple-Kette | Angebot → Projekt → **Nachtrag** → Rechnung | **Nachtrags-Register** + Prüfbarkeit + Fristen + KPIs |
| Priorität | **Phase 1** (Kern) | **Phase 3** (Differenzierung) |

Ein `NACHTRAG_TYPE`-Feld (`OWN` = eigenes Honorar / `MANAGED` = Fremdnachtrag in Prüfung) hält beide Welten im selben Modul auseinander, ohne zwei getrennte Oberflächen zu bauen.

### 1.3 Abgrenzung zu bestehenden Bausteinen

- **Nicht dasselbe wie ein Angebot**: Ein Angebot ist die Erstbeauftragung (führt zum Projekt). Ein Nachtrag ist eine **Änderung eines bereits laufenden Projekts** und ändert den **Vertragswert** (`CONTRACT`).
- **Nicht dasselbe wie „Sonstige Buchungsarten"** (Pauschalen/Stückleistungen, `UNIT`/`LUMP_*`): Diese buchen Aufwand/Erlös *innerhalb* eines bestehenden Budgets. Ein Nachtrag **erweitert das Budget** und braucht Freigabe.
- **Baut auf** dem 2-Pass-Hierarchiemuster, `BILLING_TYPE_ID` (1 = Pauschal, 2 = Stunden/TEC), Zuschlags-Logik und HOAI-Kalkulation (`FEE_CALCULATION_*`) auf — alles bereits vorhanden.

---

## 2. Fachliche Grundlagen (Branchenpraxis, ohne Namen)

### 2.1 Anlässe und Anspruchsgrundlagen

Ein Nachtrag entsteht typischerweise aus:

- **Geänderten Leistungen** (§ 650b BGB / § 10 Abs. 1 HOAI): Der Bauherr ändert das Planungsziel → Wiederholung/Anpassung bereits erbrachter Leistungen.
- **Zusätzlichen Leistungen** (§ 10 Abs. 2 HOAI, Besondere Leistungen nach Anlage): Leistungen außerhalb des Grundleistungs-Solls.
- **Mengen-/Umfangsänderungen**: höhere anrechenbare Kosten, geänderte Objektanzahl, zusätzliche Bauabschnitte.
- **Gestörtem Bauablauf / Bauzeitverlängerung**: Beschleunigung, Bauzeitverlängerung, Mehrfachvorhaltung (proaktiv/reaktiv).
- **Bauinhalts- vs. Bauumstandsnachträgen** (aus dem Prozessmodell): Änderung *was* gebaut wird vs. Änderung der *Umstände*, unter denen gebaut wird. Als `CATEGORY` abbildbar.

Jeder Nachtrag trägt eine **Anspruchsgrundlage** (Freitext + Kategorie) und eine **Begründung** — das ist zentrale Voraussetzung für Prüffähigkeit.

### 2.2 „Dem Grunde nach" vs. „der Höhe nach"

Baupraktisch werden Nachträge oft **zweistufig** anerkannt:

1. **Dem Grunde nach** — es besteht *überhaupt* ein Anspruch (Berechtigung bejaht).
2. **Der Höhe nach** — die konkrete *Summe* wird verhandelt/anerkannt.

Das Modell muss beides getrennt abbilden können (zwei Status-Flags bzw. eigene Status), weil **oft bereits gearbeitet wird, obwohl die Höhe noch strittig ist** (vorläufige Anordnung).

### 2.3 Prüfbarkeit (formell / inhaltlich / rechnerisch)

Aus dem Leistungsbild (reaktives NM): Eingehende Nachträge werden geprüft auf

- **formelle** Prüfbarkeit (fristgerecht, angekündigt, Form gewahrt),
- **inhaltliche** Prüfbarkeit (Anspruchsgrundlage schlüssig, Nachweisführung),
- **rechnerische** Prüfbarkeit (Kalkulation nachvollziehbar, Mengen/Preise plausibel).

Ergebnis ist ein **Prüfvermerk** mit Empfehlung (anerkennen / kürzen / ablehnen / Rückfrage). → Als strukturierte Checkliste + Prüfvermerk-Feld umsetzbar.

### 2.4 Fristen und Ankündigung

- **Nachtragsankündigung** vor Ausführung, **Behinderungs-/Bedenkenanzeige**, **Fristen zur Vorlage** und **Prüf-/Entscheidungsfristen**.
- Verpasste Fristen sind der häufigste Grund für verlorene Ansprüche → **Fristenmanagement mit Erinnerungen** ist Pflichtfunktion (dockt an den vorhandenen `dueDateChecker`/Notification-Mechanismus an).

### 2.5 Das Prozessmodell: präventiv / proaktiv / reaktiv

Aus dem Prozessmodell (drei Prozessebenen über die HOAI-LPH 1–9 / AHO-Projektstufen):

| Modus | Wann (Projektphase) | Worum es geht | plan&simple-Werkzeug |
|---|---|---|---|
| **Präventiv** | Ausführungs­vorbereitung (LPH 6–7) | Verträge/Leistungsziele so gestalten, dass Nachträge vermeidbar/prüfbar werden; Risikoallokation | Vorlagen-Bibliothek (Klauseln, Checklisten), Nachtragsstrategie je Tenant |
| **Proaktiv** | Ausführung (LPH 8) | Laufende Soll-Ist-Überwachung, **Früh­erkennung** von Nachtrags­anlässen, Steuerung | Soll-Ist-Watchlist (koppelt an bestehende **Budget-Warnungen**), Störungs-/Behinderungserfassung |
| **Reaktiv** | Ausführung/Abschluss (LPH 8–9) | Konkrete Nachträge dokumentieren, **prüfen**, verhandeln, entscheiden | Nachtrags-Register, Prüfbarkeits-Checkliste, Freigabe, Streitfall |

Diese drei Modi sind **keine** getrennten Menüs, sondern **Reifegrade** des Moduls (Phase 1 liefert reaktiv; proaktiv/präventiv folgen).

### 2.6 Organisatorische Implementierung → in einem SaaS = Rollen, nicht Kästchen

Das Prozessmodell beschreibt organisatorisch eine **Zentralisierung** (eine übergreifende Nachtragsmanagement-Stelle) und ein **Projekteinbindungs-Modell** mit *Entscheidungsstelle* (wer darf entscheiden/beauftragen) und *Realisierungsstelle* (wer bearbeitet operativ), jeweils als Haupt-/Hilfsstelle.

In plan&simple übersetzt sich das **nicht** in Organigramme, sondern in:

- **Zentralisierung** → tenant-weite **Nachtragsstrategie, Vorlagen und ein projektübergreifendes Register + KPI-Board** (Einstellungen + globale Modul-Ansicht).
- **Entscheidungsstelle** → Permission **`nachtraege.release`** (Freigabe), optional mit **Betrags-Schwellenwert** (wer bis zu welcher Summe freigeben darf).
- **Realisierungsstelle** → Permission **`nachtraege.create` / `nachtraege.edit`** + ein **Nachtrags-Verantwortlicher je Projekt** (nutzt `EMPLOYEE2PROJECT` bzw. ein Feld am Projekt).

So bleibt die organisatorische Idee erhalten, ohne das Produkt mit Organisationsbürokratie zu überfrachten.

---

## 3. Datenmodell

### 3.1 Grundprinzip

Ein Nachtrag ist strukturell ein **projektgebundenes Angebot**. Wir spiegeln daher `OFFER`/`OFFER_STRUCTURE` (inkl. Zuschlags- und HOAI-Kalkulations-Andockung) und ergänzen nachtragsspezifische Felder (Status-Lebenszyklus, Anspruchsgrundlage, Fristen, Teilfreigaben, Audit).

Alle Tabellen tragen `TENANT_ID` (Mandantentrennung auf App-Ebene, jede Query filtert — siehe CLAUDE.md). Hierarchien folgen dem **2-Pass-Muster** (`FATHER_ID=null` einfügen, dann updaten). Beträge über `fmt2()`.

### 3.2 `NACHTRAG` (Kopf)

```
NACHTRAG
  ID                 bigint PK
  TENANT_ID          bigint
  PROJECT_ID         bigint   -- Pflicht: Nachtrag hängt IMMER an einem Projekt
  CONTRACT_ID        bigint   -- optionaler Bezug auf den geänderten Vertrag
  OFFER_ID           bigint   -- optional: entstand aus einem Angebot
  NAME_SHORT         text     -- Nummer, z. B. "NT-25-003" (Nummernkreis, s. u.)
  NAME_LONG          text     -- Titel/Betreff
  NACHTRAG_TYPE      text     -- 'OWN' | 'MANAGED'  (eigenes Honorar / Fremdnachtrag in Prüfung)
  NACHTRAG_STATUS_ID bigint   -- FK NACHTRAG_STATUS (Lebenszyklus)
  CATEGORY           text     -- 'CHANGED'|'ADDITIONAL'|'QUANTITY'|'SPECIAL'|'DISRUPTION'|'CONTENT'|'CIRCUMSTANCE'
  CLAIM_BASIS        text     -- Anspruchsgrundlage (Freitext, z. B. "§ 650b BGB / § 10 HOAI")
  REASON             text     -- Begründung / Sachverhalt
  IS_GRANTED_BASIS   boolean  -- "dem Grunde nach" anerkannt
  EMPLOYEE_ID        bigint   -- verantwortlicher Bearbeiter
  ADDRESS_ID         bigint   -- Gegenseite (Bauherr bzw. Firma bei MANAGED)
  CONTACT_ID         bigint
  COMPANY_ID         bigint   -- absendende Firma (für Nummernkreis/PDF)
  VAT_ID             bigint
  -- Fristen / Termine
  ANNOUNCED_DATE     date     -- Ankündigung
  SUBMITTED_DATE     date     -- Vorlage/Eingang
  REVIEW_DUE_DATE    date     -- Prüf-/Entscheidungsfrist
  DECISION_DATE      date     -- Entscheidung
  -- Summen (denormalisiert für Listen, analog OFFER)
  AMOUNT_CLAIMED_NET numeric  -- gefordert
  AMOUNT_APPROVED_NET numeric -- freigegeben (Summe aller Teilfreigaben)
  -- Zuschläge (Root-Level, wie OFFER: SURCHARGE_1..3_*)
  SURCHARGE_1_LABEL/PCT/EUR/CUMUL ...  SURCHARGES_TOTAL numeric
  CREATED_AT         timestamptz default now()
```

### 3.3 `NACHTRAG_STRUCTURE` (Positionen)

Baugleich zu `OFFER_STRUCTURE` (Hierarchie, `BILLING_TYPE_ID`, `REVENUE_BASIS/REVENUE/EXTRAS`, Zuschläge, `QUANTITY/SP_RATE`, Rollenfelder) **plus** Teilfreigabe-Felder:

```
NACHTRAG_STRUCTURE
  ... (alle Felder wie OFFER_STRUCTURE) ...
  NACHTRAG_ID            bigint
  APPROVAL_STATE         text     -- 'OPEN' | 'APPROVED' | 'PARTIAL' | 'REJECTED'
  APPROVED_AMOUNT_NET    numeric  -- bei Teilanerkennung der Höhe nach
  RELEASED_STRUCTURE_ID  bigint   -- Rückverweis auf erzeugte PROJECT_STRUCTURE-Zeile (nach Freigabe)
```

Der Struktur-Editor der Angebote (`OFFER_STRUCTURE`-UI inkl. HOAI-`FEE_CALCULATION`-Andockung) wird **wiederverwendet** — kein neuer Editor.

### 3.4 `NACHTRAG_STATUS` (Lebenszyklus)

Globale Lookup-Tabelle (mandantenunabhängig, wie `OFFER_STATUS`/`PROJECT_STATUS`). Stabiler `CODE`-Schlüssel für den Code, `NAME_SHORT` als deutsches Label, plus Flags `IS_TERMINAL` / `ALLOWS_RELEASE`:

```
ENTWURF → ANGEKÜNDIGT → EINGEREICHT → IN_PRÜFUNG →
   ├─ (TEIL)BEAUFTRAGT / FREIGEGEBEN   (→ Übernahme ins Projekt)
   ├─ ABGELEHNT
   ├─ ZURÜCKGEZOGEN
   └─ STRITTIG                          (Verhandlung/Eskalation)
```

Status steuert erlaubte Aktionen (z. B. Freigabe nur ab `IN_PRÜFUNG`; Bearbeiten der Struktur gesperrt ab `BEAUFTRAGT`).

### 3.5 `NACHTRAG_RELEASE` (Teilfreigaben — mehrfach möglich)

Ein Nachtrag kann in mehreren Schritten (teil-)freigegeben werden. Jede Freigabe ist ein eigener, revisionssicherer Datensatz (Muster: `SE_RELEASE_AUDIT` / Grandfathering-Audit aus der Owner-Konsole):

```
NACHTRAG_RELEASE
  ID                bigint PK
  TENANT_ID         bigint
  NACHTRAG_ID       bigint
  RELEASE_NO        int       -- 1, 2, 3 …
  RELEASE_KIND      text      -- 'FULL' | 'PARTIAL' | 'PROVISIONAL' (vorläufige Anordnung)
  RELEASE_BASIS     text      -- 'WRITTEN' | 'ORAL' | 'ORDER' (schriftlich/mündlich/Anordnung)
  AMOUNT_NET        numeric   -- in diesem Schritt freigegebenes Volumen
  RELEASED_BY       bigint    -- EMPLOYEE_ID (Entscheidungsstelle)
  RELEASED_AT       timestamptz
  NOTE              text
```

### 3.6 `NACHTRAG_AUDIT` (Historie/Dokumentation)

Jeder Status-/Betrags-/Freigabe-Schritt wird protokolliert (Aktor, Zeit, Vorher/Nachher) — Grundlage für Nachweisführung und Streitfall. Muster wie bestehende Audit-Tabellen.

### 3.7 Anbindung an vorhandene Tabellen

- **`PROJECT_STRUCTURE`** bekommt eine Spalte **`NACHTRAG_ID bigint NULL`** — markiert Zeilen, die aus einem Nachtrag stammen (Herkunft, Reporting, Rückabwicklung).
- **`TEC`** (Buchungen) braucht *keine* Änderung für die Kernabrechnung (bucht auf `STRUCTURE_ID`). Für **Bearbeitungsaufwand-Buchungen** und Vor-Freigabe-Buchungen empfiehlt sich eine optionale Spalte **`NACHTRAG_ID bigint NULL`** (s. Abschnitt 7).
- **`CONTRACT`**: Bei Freigabe wächst die **Auftrags-/Vertragssumme** um das freigegebene Volumen (Nachtragsvolumen als eigener, ausweisbarer Bestandteil).
- **Nummernkreis**: RPC **`next_nachtrag_number(p_company_id)`** → **`NT-YY-NNN`** firmen-/jahresbezogen über `DOCUMENT_NUMBER_RANGE` (transaktionssicher, exakt analog `next_offer_number`; `DOC_TYPE='NACHTRAG'`). Umgesetzt in `0105`. Eine projektrelative Anzeige („Nachtrag Nr. 3 zum Projekt") kann später als abgeleitetes Label ergänzt werden.

### 3.8 Migrationen (manuell in Supabase, nächste freie Nummer)

Aktuell höchste Migration: `0104`. Vorschlag:

- `0105_nachtrag_foundation.sql` — Tabellen `NACHTRAG`, `NACHTRAG_STRUCTURE`, `NACHTRAG_STATUS`, `NACHTRAG_RELEASE`, `NACHTRAG_AUDIT`; Spalte `PROJECT_STRUCTURE.NACHTRAG_ID`; RPC `next_nachtrag_number`; Seed Default-Status.
- `0106_nachtrag_rbac.sql` — Permissions `nachtraege.*` + Zuordnung zu Default-Rollen (s. Abschnitt 9).
- `0107_nachtrag_tec_link.sql` — optionale Spalte `TEC.NACHTRAG_ID` (für Aufwands-Tracking).
- `0108_nachtrag_license.sql` bzw. Manifest-Regenerierung — Capability `nachtraege.management` (s. Abschnitt 11).

---

## 4. Modulfunktionalität (Überblick)

### 4.1 Zwei Einstiegspunkte

1. **Projekt-Tab „Nachträge"** — im Projekt-Detail neben *Struktur, Leistungsstand, Buchungen, Verträge, Budget, Mitarbeiter, Sicherheitseinbehalte*. Zeigt alle Nachträge **dieses** Projekts, Anlegen im Kontext.
2. **Globales Modul „Nachträge"** — neuer Top-Level-Navigationseintrag (`/nachtraege`) mit projektübergreifendem Register + KPI-Board. Entspricht der „Zentralisierung" aus dem Prozessmodell.

### 4.2 Funktionsumfang

- **Register/Liste** nach den Listen-Standards (Suche + FilterChips: Projekt, Status, Kategorie, Typ, Bearbeiter, Anspruchsgrundlage, Zeitraum; client-seitig gefiltert). Spalten: Nr., Betreff, Projekt, Kategorie, gefordert, freigegeben, Status, Prüf­frist, Bearbeiter.
- **Nachtrag anlegen/bearbeiten** — Kopf + Struktur-Editor (wiederverwendet) + Anspruchsgrundlage/Begründung + Fristen.
- **Prüfbarkeits-Checkliste** (formell/inhaltlich/rechnerisch) + Prüfvermerk + Empfehlung.
- **Freigabe-Dialog** (Voll/Teil/Vorläufig) → Übernahme ins Projekt (Abschnitt 6).
- **Buchungen** auf freigegebene/vorläufige Nachtragspositionen (Abschnitt 7).
- **Abrechnung** — Nachtragspositionen fließen automatisch in die bestehende Abschlags-/Schlussrechnung (kein Sonderpfad).
- **PDF** — „Nachtragsangebot" bzw. „Nachtragsvereinbarung" (Nunjucks-Template `nachtrag.njk`, abgeleitet von `offer.njk`).
- **E-Mail-Versand** (bestehender E-Mail-Service).
- **Dokumente/Anlagen** — Fotos, Schriftverkehr, Anordnungen (bestehender `attachments`-Service).
- **Fristen-Erinnerungen** (bestehender Notification-/`dueDateChecker`-Mechanismus).
- **Reporting/KPIs** — Nachtragsquote, Erfolgsquote, Bearbeitungsdauer, Volumen je Projekt/Kunde.
- **Historie** — vollständiger Audit-Trail je Nachtrag.

---

## 5. Erstellen und Verwalten

### 5.1 Anlege-Wege

- **Von Grund auf** im Projektkontext (Projekt vorbelegt, Gegenseite = Bauherr aus Projekt).
- **Aus Vorlage** (Nachtragsvorlage je §-Typ mit vorbefülltem Text + ggf. Standardpositionen — nutzt `TEXT_TEMPLATE`).
- **Aus einem Angebot** — ein bestehendes Angebot als Nachtrag „andocken" (`OFFER_ID` verknüpfen; Struktur kopieren).
- **Aus einem Anlass** (proaktiv, Phase 3) — aus einer Störungs-/Behinderungserfassung oder einer Budget-Warnung heraus „Nachtrag erzeugen".

### 5.2 Bearbeiten und Status

- Kopf, Struktur, Fristen, Anspruchsgrundlage editierbar **bis** Status `IN_PRÜFUNG`/`BEAUFTRAGT` (danach nur noch über neue Version/Teilfreigabe, damit die Freigabehistorie stimmt).
- **Statuswechsel** sind protokollpflichtig (`NACHTRAG_AUDIT`) und teils permissioniert (z. B. `EINGEREICHT`→`BEAUFTRAGT` nur mit `nachtraege.release`).
- **Löschen** nur im `ENTWURF` und nur mit `nachtraege.delete` (Struktur-Zeilen zuerst, wie bei `deleteOffer`).

### 5.3 Validierung (analog Angebote)

Pflichtfelder: Projekt, Betreff, Kategorie, Anspruchsgrundlage, verantwortlicher Bearbeiter. Nummer via RPC. USt aus `TENANT_SETTINGS.default_vat_id` vorbelegt. Fehler-Pattern: Service wirft `{status, message}`, Controller fängt.

---

## 6. Teilbeauftragung & Freigabe für Projekt (Kernmechanik)

> Vorbild im Code: `convertOfferToProject` in `backend/services/angebote.js` — dieselbe 2-Pass-Übernahme in `PROJECT_STRUCTURE`, aber **inkrementell** und **teilbar**.

### 6.1 Warum getrennt von „Angebot → Projekt"?

Beim Angebot entsteht ein **neues** Projekt. Beim Nachtrag existiert das Projekt schon — die freigegebenen Positionen werden **in die bestehende `PROJECT_STRUCTURE` eingehängt** und der Vertragswert erhöht.

### 6.2 Übernahme-Strategie (**gewählt: Option A** + Herkunfts-Tag)

- **Option A (gewählt)**: Ein synthetischer Wurzelknoten **„Nachträge"** in der `PROJECT_STRUCTURE`; jede Freigabe hängt ihre Positionen als Teilbaum darunter (z. B. „NT-25-003: …"). Vorteile: Struktur bleibt lesbar, Budget/Buchung/Abrechnung laufen unverändert, Nachtragsvolumen ist auf einen Blick separierbar.
- **Option B**: Positionen direkt neben die Ursprungspositionen einsortieren (nur über `NACHTRAG_ID` markiert). Näher an der „gewachsenen" Realität, aber Struktur wird unübersichtlicher.

In **beiden** Fällen trägt jede erzeugte Zeile `NACHTRAG_ID` (Herkunft) und die Quell-Zeile `RELEASED_STRUCTURE_ID` (Rückverweis).

### 6.3 Teilbeauftragung — zwei Dimensionen

1. **Positionsweise** (der Umfang nach): Nur ausgewählte `NACHTRAG_STRUCTURE`-Positionen (`APPROVAL_STATE = APPROVED`) werden übernommen; der Rest bleibt `OPEN`.
2. **Betragsweise** (der Höhe nach): Eine Position wird mit `APPROVED_AMOUNT_NET < gefordert` gekürzt anerkannt.

Mehrere Freigaben nacheinander sind möglich (`NACHTRAG_RELEASE.RELEASE_NO` = 1,2,3…). `AMOUNT_APPROVED_NET` am Kopf = Summe der Freigaben. Status wird `TEIL_BEAUFTRAGT`, bis alles freigegeben/abgelehnt ist.

### 6.4 Vorläufige Beauftragung (baupraktisch wichtig)

`RELEASE_KIND = PROVISIONAL` (z. B. mündliche Anordnung „bitte anfangen"): Positionen werden übernommen und **buchbar**, aber als **„vorläufig/Risiko"** markiert. Reporting weist vorläufig freigegebenes Volumen separat aus (Risiko-Transparenz). Wird die Freigabe zurückgenommen, greift eine kontrollierte Rückabwicklung (s. 6.6).

### 6.5 Vertrags-/Auftragssumme

Nach jeder Freigabe:
- `CONTRACT`-Auftragssumme += freigegebenes Nettovolumen (als ausweisbarer Nachtragsanteil),
- `NACHTRAG.AMOUNT_APPROVED_NET` und `PROJECT`-Wurzelsummen werden neu aggregiert (bestehende `recalc*`-Logik wiederverwenden).

### 6.6 Rückabwicklung / Bestandsschutz

- Solange **keine Buchung/Rechnung** auf einer übernommenen Zeile hängt → Freigabe rücknehmbar (Zeile entfernen, Vertragswert zurück).
- Sobald **gebucht/abgerechnet** → **kein Hard-Delete**, sondern Storno-/Korrektur-Nachtrag (Bestandsschutz — dasselbe Prinzip wie „Grandfathering" in der Owner-Konsole und wie Storno bei Rechnungen).

### 6.7 Ablauf (Sequenz)

```
Nachtrag (IN_PRÜFUNG)
  └─ Freigabe-Dialog: Positionen + Beträge wählen, RELEASE_KIND, RELEASE_BASIS
       → NACHTRAG_RELEASE anlegen (RELEASE_NO, RELEASED_BY, RELEASED_AT)
       → für jede APPROVED-Position: PROJECT_STRUCTURE-Zeile erzeugen
            (2-Pass FATHER_ID, PROJECT_PROGRESS-Zeile, NACHTRAG_ID setzen)
       → NACHTRAG_STRUCTURE.RELEASED_STRUCTURE_ID + APPROVAL_STATE aktualisieren
       → CONTRACT-Auftragssumme erhöhen
       → NACHTRAG_STATUS = (TEIL_)BEAUFTRAGT ; NACHTRAG_AUDIT schreiben
```

---

## 7. Buchungen auf Nachträge

### 7.1 Nach Freigabe: identisch zu normalen Projektbuchungen

Sobald Positionen in `PROJECT_STRUCTURE` stehen, greift die **bestehende** Buchungslogik (`backend/services/buchungen.js`) ohne Änderung:

- **`BILLING_TYPE_ID = 2` (Stunden/TEC)**: Mitarbeiter buchen Stunden auf das Nachtrags-Blatt; `recomputeStructure` rollt Kosten (CP) und Erlös (`SP_TOT`) hoch.
- **`BILLING_TYPE_ID = 1` (Pauschal)**: Der Nachtrags-Knoten trägt das Pauschalhonorar; Leistungsstand wie gewohnt.
- **Sonstige Buchungsarten** (`UNIT`/`LUMP_COST`/`LUMP_REVENUE`) funktionieren ebenfalls (z. B. Fremdrechnung als Kostenpauschale auf den Nachtrag).
- Buchbar nur auf **Blattelemente** (bestehende Prüfung bleibt).

### 7.2 Abrechnung (kein Sonderpfad)

Die Rechnungslogik iteriert bereits generisch über `PROJECT_STRUCTURE` (BT1 über `REVENUE_COMPLETION`-Verteilung, BT2 aus `TEC.SP_TOT` → `INVOICE_STRUCTURE`). Nachtragspositionen werden damit **automatisch** in Abschlags- und Schlussrechnungen berücksichtigt. Optional: Rechnungs-PDF gruppiert „Grundleistungen" vs. „Nachträge" (nutzt `NACHTRAG_ID` am Strukturknoten).

### 7.3 Vor-Freigabe-Buchungen (Aufwands-Tracking, optional)

Zwei praxisrelevante Fälle über **`TEC.NACHTRAG_ID`** (ohne `STRUCTURE_ID` → keine Budgetwirkung):

1. **Vorläufig/Risiko**: Es wird gearbeitet, bevor formal freigegeben ist. Aufwand wird auf den Nachtrag gebucht und als „auf noch nicht beauftragten Nachtrag" markiert → sichtbar im Risiko-Reporting.
2. **Nachtragsbearbeitungs-Aufwand** (Prüfen, Kalkulieren, Verhandeln — bei `MANAGED` die eigentliche Leistung!): Zeit wird dem Nachtrag zugeordnet, um den **NM-Aufwand je Projekt** zu messen — Grundlage für die Wirtschaftlichkeit („lohnt sich unser Nachtragsmanagement?") und ggf. eigene Abrechnung dieses Aufwands.

### 7.4 Budget-Warnungen

Die bestehende `budgetWarnings`-Engine greift automatisch auf den neuen Nachtragsknoten (eigenes Budget = freigegebenes Volumen). Zusätzlich (Phase 3): Wenn Ist > Soll auf **Grundleistungs**-Knoten, schlägt die Watchlist proaktiv „Nachtrag erwägen" vor.

---

## 8. Prozessmodell in plan&simple (Reifegrade)

| Reifegrad | Liefert | Kernfeatures |
|---|---|---|
| **Reaktiv (Phase 1–2)** | Nachträge dokumentieren, prüfen, freigeben, buchen, abrechnen | Register, Struktur-Editor, Prüfbarkeit, Freigabe, Fristen, PDF, KPIs |
| **Proaktiv (Phase 3)** | Anlässe früh erkennen | Soll-Ist-Watchlist (Budget-Warnungen), Störungs-/Behinderungserfassung, „Nachtrag aus Anlass" |
| **Präventiv (Phase 4)** | Nachträge vermeiden/vorbereiten | Vorlagen-/Klausel-Bibliothek, Nachtragsstrategie je Tenant, Risikoallokations-Checklisten |

---

## 9. Organisatorische Implementierung → RBAC & Rollen

> Regel aus CLAUDE.md: Neue mutierende Endpoints / sichtbare UI-Elemente brauchen eine passende Permission — sonst den User fragen. Nachträge ist ein neues Modul → **neue Permissions** (Vorschlag, bestätigungsbedürftig).

### 9.1 Permission-Katalog (Vorschlag, Modul `nachtraege`)

| Key | Aktion | Kategorie |
|---|---|---|
| `nachtraege.view` | Nachträge sehen (Liste/Detail) | reading |
| `nachtraege.create` | Nachtrag anlegen | editing |
| `nachtraege.edit` | Nachtrag/Struktur bearbeiten | editing |
| `nachtraege.submit` | Einreichen/Ankündigen (an Gegenseite) | editing |
| `nachtraege.review` | Prüfbarkeit/Prüfvermerk bearbeiten | editing |
| `nachtraege.release` | **Freigeben/Beauftragen** (Entscheidungsstelle) | editing |
| `nachtraege.delete` | Nachtrag löschen (nur Entwurf) | destructive |
| `nachtraege.send` | Nachtrags-PDF/E-Mail versenden | editing |

### 9.2 Freigabe-Schwellenwert (auf später verschoben)

**Idee:** Die Permission `nachtraege.release` sagt nur *ob* jemand freigeben darf — nicht *bis zu welcher Höhe*. Ein optionaler **Schwellenwert** wäre eine Betragsgrenze obendrauf: Beispiel — ein Projektleiter darf bis 5.000 € selbst beauftragen; ein 12.000-€-Nachtrag überschreitet sein Limit und muss an die Geschäftsleitung (höhere/unbegrenzte Grenze) eskalieren. Fachlich = *Entscheidungshaupt- vs. -hilfsstelle*.

**Entscheidung N1:** **nicht** umgesetzt — `nachtraege.release` ist unbegrenzt. Die Grenze ist Feintuning für größere Büros und kommt bei Bedarf in einer späteren Phase als optionale Einstellung (`TENANT_SETTINGS.nachtrag_release_limit` bzw. je Rolle) hinzu.

### 9.3 Default-Rollen (umgesetzt in `0106`)

- **Administrator**: alle `nachtraege.*`.
- **Geschäftsleitung**: `nachtraege.view` + `nachtraege.release` — **Entscheidungsstelle** (darf beauftragen, keine operative Bearbeitung nötig).
- **Projektleiter**: `view/create/edit/submit/review/send` — **Realisierungsstelle** (bereitet vor & reicht ein, **keine Freigabe** per Default). Bewusste Gewaltenteilung; pro Mandant jederzeit erweiterbar (Rollen sind editierbar). Im Ein-Personen-Büro liegt die Freigabe ohnehin bei der Administrator-Rolle des Inhabers.
- **Buchhaltung**: `nachtraege.view` (Abrechnungsbezug).
- **Mitarbeiter**: standardmäßig kein Zugriff (nur eigene Buchungen auf freigegebene Knoten).

### 9.4 Backend/Frontend-Gating

- Backend: jeder mutierende Endpoint mit `requirePermission('nachtraege.…')`.
- Frontend: `<Can permission="nachtraege.…">` um Buttons/Tabs; Nav-Eintrag + `ProtectedRoute anyOf={['nachtraege.view']}`; Keys in `permissionsStore.ts` ergänzen.

---

## 10. In-Product-Hilfe (verbindlich, siehe HELP_TOOLTIP_CONCEPT.md)

Nachträge sind fachlich nicht-trivial → Hilfe ist Pflicht. Neue Einträge in `frontend-react/src/help/helpContent.tsx` (`<HelpHint id="nachtrag.…">`):

- `nachtrag.anspruchsgrundlage` — was eine tragfähige Anspruchsgrundlage ausmacht (§ 650b BGB / § 10 HOAI, VOB/B § 2).
- `nachtrag.kategorie` — geändert/zusätzlich/Menge/Umstand erklärt.
- `nachtrag.grunde_hoehe` — „dem Grunde nach" vs. „der Höhe nach".
- `nachtrag.pruefbarkeit` — formelle/inhaltliche/rechnerische Prüfung.
- `nachtrag.freigabe` — Voll-/Teil-/vorläufige Freigabe und ihre Wirkung auf Budget/Vertrag.
- `nachtrag.fristen` — Ankündigung/Behinderung/Prüffrist.
- `nachtrag.buchung_vorlaeufig` — Risiko-Buchung auf noch nicht beauftragten Nachtrag.
- **Leerzustände**: „noch keine Nachträge" (mit erster Aktion + Warum) unterscheiden von „kein Treffer" (Filter).
- **KPI-Tooltips**: Nachtragsquote, Erfolgsquote, Bearbeitungsdauer (Report-Kennzahlen sind erklärungspflichtig).

---

## 11. Lizenz-Einordnung (siehe LICENSE_TIERS_CONCEPT.md)

Neues Modul → neue Capability im Manifest (`backend/licensing/capabilities.manifest.js`, dann `npm run license:gen`):

**Entscheidung: eine** Capability für das gesamte Modul.

| Capability | Typ | Enthält |
|---|---|---|
| `nachtraege.management` | boolean | `nachtraege.view/create/edit/submit/review/release/delete/send` — das gesamte Modul, inkl. der späteren `MANAGED`-Fremdnachtrags-Verwaltung (kein separater Premium-Schnitt) |

Nav-Eintrag trägt (wie andere) ein `feature: 'nachtraege.management'`; Plan-Zuordnung erfolgt in der Owner-Konsole (`PLAN_CAPABILITY`). Sollte sich die MANAGED-Verwaltung (Phase N3) später als eigener Premium-Hebel lohnen, kann sie ohne Bruch in eine zweite Capability ausgegliedert werden.

---

## 12. UI/UX & Icons

- **Navigation**: neuer Top-Level-Eintrag „Nachträge" (`/nachtraege`) in `SideNav.tsx` + `BottomNav.tsx`. Icon-Vorschlag **`FileDiff`** (Änderung an einem Vertragsdokument); Alternativen `FilePlus2`, `FileClock` (für Fristen-Sicht). Größen/Strokes gemäß Icon-Standard.
- **Projekt-Tab** „Nachträge" reiht sich in die bestehende Tab-Leiste ein.
- **Listen-Standard**: `list-toolbar` + `list-search` + `FilterChip`-Pattern; keine horizontale Scrollbar; Touch-Targets ≥ 44 px; sticky Header nur Desktop.
- **Formulare**: kontrollierter State + `formRef.requestSubmit()` + `useCtrlS`; `<Modal>` für Dialoge; korrekte Input-Typen (Datum als `type="date"`, Beträge `inputmode`).
- **Mobile**: Nachtrag/Behinderung on-site erfassbar (Foto-Upload), da LPH-8-Nutzung häufig auf der Baustelle.

---

## 13. Umsetzungs-Roadmap (Phasen)

| Phase | Inhalt | Ergebnis |
|---|---|---|
| **N1 — Kern (vertikaler Durchstich)** | Datenmodell (`NACHTRAG*`), Register (Projekt-Tab), Anlegen/Bearbeiten (Struktur-Editor wiederverwendet), **Freigabe (voll/teil)** → `PROJECT_STRUCTURE`, `CONTRACT`-Summe, RBAC, Hilfe, Nummernkreis | Eigene Honorar-Nachträge end-to-end buch- und abrechenbar |
| **N2 — Reaktiv komplett** | Prüfbarkeits-Checkliste + Prüfvermerk, Fristen + Erinnerungen, PDF (`nachtrag.njk`), E-Mail, Anlagen, Audit-Historie, globales Modul + KPI-Board, vorläufige Freigabe | Vollständiges reaktives NM |
| **N3 — Proaktiv & MANAGED** | `NACHTRAG_TYPE=MANAGED` (Fremdnachträge), Soll-Ist-Watchlist (koppelt Budget-Warnungen), Störungs-/Behinderungserfassung, „Nachtrag aus Anlass", Streitfall/Eskalation, Aufwands-Tracking (`TEC.NACHTRAG_ID`) | Differenzierendes Nachtragsmanagement als Leistung |
| **N4 — Präventiv** | Vorlagen-/Klausel-Bibliothek, Nachtragsstrategie je Tenant, Risikoallokations-Checklisten, ggf. Signatur/Nachtragsvereinbarung | Vermeidung + Standardisierung |

---

## 14. Abnahmekriterien / Testszenarien (Phase N1)

1. **Anlegen**: Nachtrag im Projekt anlegen → erhält Nummer `NT-…`, Status `ENTWURF`, erscheint im Projekt-Tab und (falls global) im Register.
2. **Struktur**: BT1- und BT2-Positionen (inkl. Unterpositionen) anlegen; Summen/Zuschläge rechnen wie bei Angeboten.
3. **Teilfreigabe**: Von 3 Positionen 2 freigeben, 1 gekürzt (`APPROVED_AMOUNT_NET`) → nur die 2 landen in `PROJECT_STRUCTURE` unter „Nachträge", `NACHTRAG_ID` gesetzt, `CONTRACT`-Summe erhöht sich exakt um freigegebenes Netto; Status = `TEIL_BEAUFTRAGT`.
4. **Zweite Freigabe**: Restposition später freigeben → `RELEASE_NO=2`, Kopf-Summe = Summe beider Freigaben; Status → `BEAUFTRAGT`.
5. **Buchung**: Stunden auf eine freigegebene BT2-Position buchen → Kosten/Erlös rollen hoch (`recomputeStructure`), Budget-Warnung greift bei Überschreitung.
6. **Abrechnung**: Abschlagsrechnung erzeugen → Nachtragspositionen erscheinen automatisch in `INVOICE_STRUCTURE`.
7. **Bestandsschutz**: Freigabe einer bereits gebuchten Position lässt sich nicht hart löschen (nur Storno-Weg).
8. **RBAC**: Nutzer ohne `nachtraege.release` sieht keinen Freigabe-Button; Nutzer ohne `nachtraege.view` hat weder Nav-Eintrag noch Projekt-Tab.
9. **Mandantentrennung**: Nachträge/Struktur eines fremden Tenants sind nie sichtbar/abrufbar (jede Query mit `TENANT_ID`).
10. **Hilfe**: Tooltips an Anspruchsgrundlage, Kategorie, Freigabe, Fristen vorhanden; Leerzustand mit erster Aktion.

---

## 15. Entscheidungen

**Geklärt (2026-07-25):**

1. ✅ **Scope-Priorität**: N1 = eigene Honorar-Nachträge zuerst; MANAGED erst N3.
2. ✅ **RBAC**: Permission-Satz `nachtraege.*` angelegt (`0106`); **ohne** Freigabe-Schwellenwert (auf später verschoben).
3. ✅ **Struktur-Übernahme**: Option A (synthetischer „Nachträge"-Wurzelknoten je Projekt).
4. ✅ **Lizenz**: eine Capability `nachtraege.management`.
5. ✅ **Nummernkreis**: `NT-YY-NNN` firmen-/jahresbezogen (`0105`).

**Noch offen (spätestens vor dem Freigabe-Service zu klären):**

6. **Vertragswirkung**: Erhöht die Freigabe die `CONTRACT`-Auftragssumme **direkt** (empfohlen — Nachtragsvolumen als ausweisbarer Vertragsbestandteil), oder wird es nur separat geführt und erst bei Schlussrechnung verrechnet? *Vorschlag für N1:* direkte Erhöhung mit separatem Ausweis des Nachtragsanteils.
```
