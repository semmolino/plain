# Konzept — Geführter Datenimport („Onboarding-Import")

> **Status:** Konzept beschlossen (2026-06-28). Implementierung noch nicht begonnen.
> **Strategischer Kontext:** Der geführte Import ist in der [GTM-Strategie](GTM_Strategie_plan_and_simple.md)
> als *der* zentrale Conversion-Hebel (7.1, 7.4) und als eine der vier Differenzierungs-Säulen (3.2)
> benannt. „Aktivierter Trial" = *erster Import + erste Auswertung* (GTM 10.2). Onboarding-Reibung ist
> laut GTM 11 das größte operative Risiko → höchste Produktpriorität.

---

## 0  Grundsatzentscheidungen (2026-06-28)

| Frage | Entscheidung |
|---|---|
| Einstieg | **Vertikaler Durchstich: Adressen.** Phase 0 minimal (Import-Stapel + Validierung + Rollback) + Adressen komplett end-to-end. Dann verallgemeinern. |
| Historische Rechnungen/Zahlungen | **Anfangsbestand/Referenz.** Pro Projekt: berechnet / bezahlt / Restforderung als schreibgeschützte Summen. Kein PDF-/XRechnung-Nachbau. |
| RBAC | **Neue Permission `import.manage`**, default nur Inhaber/Admin (eigene Migration). |

---

## 1  Drei Leitideen

1. **Skelett statt Vollmigration.** Wir bauen die alte Welt nicht 1:1 nach, sondern importieren das
   tragende Gerüst, das ab Tag 1 Nutzen stiftet (Stammdaten + aktive Projekte + offene Posten), und
   führen den Nutzer beim Rest. Deckt sich mit GTM „begleiteter Cut-over mit **einem Pilotprojekt**".
2. **Stichtag-Modell (Cut-over-Datum).** Der Nutzer wählt ein Datum. Alles *davor* = historischer
   **Anfangsbestand** (Referenz, schreibgeschützt). Alles *danach* = **live** in plan&simple erzeugt.
   Dieses eine mentale Modell macht das schwierigste Thema (Rechnungen/Buchungen) beherrschbar.
3. **Nichts wird blind geschrieben.** Jeder Import läuft als *Trockenlauf mit Vorschau* und wird als
   **Import-Stapel** verbucht, der jederzeit rückgängig gemacht werden kann. → technische Antwort auf
   „keine Mülldaten" + „letzte Schritte zurücksetzen".

---

## 2  Technisches Rückgrat: Import-Stapel + Vorschau + Rollback

### 2.1  Datenmodell

Neue Tabelle `IMPORT_BATCH` (pro Mandant):

| Spalte | Zweck |
|---|---|
| `ID`, `TENANT_ID` | Schlüssel + Mandantenisolation |
| `DOMAIN` | z. B. `address`, `employee`, `project`, `opening_balance` |
| `STATUS` | `preview` / `committed` / `rolled_back` |
| `QUELLDATEI` | Originaldateiname |
| `MAPPING_JSON` | gewählte Spaltenzuordnung (wird je Mandant gemerkt) |
| `ZEILEN_GESAMT / OK / UEBERSPRUNGEN / FEHLER` | Kennzahlen |
| `SUMMARY_JSON` | Vorschau-/Ergebnis-Zusammenfassung |
| `ERSTELLT_VON`, `ERSTELLT_AM`, `ROLLED_BACK_AM` | Audit |

Jede importierbare Tabelle (`ADDRESS`, `CONTACT`, `EMPLOYEE`, `PROJECT`, …) erhält eine **nullable**
Spalte `IMPORT_BATCH_ID` (FK auf `IMPORT_BATCH.ID`). Live in der App angelegte Datensätze bleiben `NULL`.

### 2.2  Mülldaten verhindern (5 Schichten)

1. **Vorlagen-first** — vorgefertigte Excel-/CSV-Vorlagen je Domäne: fixe Spalten, Beispielzeile,
   Dropdowns/Datenprüfung für Enums (Status, Abrechnungsart, MwSt). Verhindert Fehler vor Entstehung.
2. **Trockenlauf-Validierung** — jede Zeile bekommt Status `OK / Warnung / Fehler / Duplikat`.
   Pflichtfeld-, Typ- und Formatprüfungen (IBAN, USt-IdNr., Datum, Währung, Dezimal-Komma).
3. **Dublettenerkennung** gegen Bestandsdaten *und* innerhalb der Datei. Match-Schlüssel je Domäne:
   - Adresse: Name + PLZ
   - Mitarbeiter: E-Mail
   - Projekt: Projektnummer
4. **Vorschau-Tabelle** — der Nutzer sieht exakt, was angelegt wird, kann Zeilen abwählen und bei
   Dubletten je Zeile wählen: *überspringen / zusammenführen / neu anlegen*.
5. **Commit nur gültig + ausgewählt** — der Rest landet in einem herunterladbaren Fehlerprotokoll
   (korrigieren → erneut hochladen). **Idempotent** dank Match-Schlüssel: kein Doppelanlegen.

### 2.3  Zurücksetzen (Rollback, LIFO)

- Ansicht **„Letzte Importe"** listet alle Stapel mit Kennzahlen.
- „Rückgängig machen" löscht alle Zeilen mit dieser `IMPORT_BATCH_ID`, in **umgekehrter
  Abhängigkeitsreihenfolge**.
- **Schutz vor Datenverlust:** Hat sich an importierten Daten inzwischen *Live-Arbeit* angehängt
  (z. B. echte Rechnung an importiertem Projekt), wird der Rollback **blockiert mit Erklärung**, was im
  Weg steht — statt still Folgedaten zu zerstören.

---

## 3  Domänen-Landkarte (Nutzen vs. Aufwand)

| Domäne | Nutzen | Aufwand | Modus | Phase |
|---|---|---|---|---|
| Adressen / Kontakte | hoch | niedrig | live | **1** (Durchstich) |
| Mitarbeiter | hoch | niedrig | live | 1 |
| Projekte (Stammdaten) | sehr hoch | mittel | live | 2 |
| Projektstruktur (LP/§) | hoch | mittel–hoch | live (Vorlage generieren) | 2 |
| Verträge / Honorarsumme | hoch | mittel | live | 2 |
| Mitarbeiter↔Projekt | mittel | niedrig | live | 2 |
| Offene Posten / Altrechnungen | hoch | hoch | **Referenz** | 3 |
| Zahlungen | mittel | hoch | Referenz | 3 |
| Stunden/Buchungen (Historie) | mittel | sehr hoch | **Anfangsbestand aggregiert** | 4 (optional) |

Zwei Entscheidungen, die das Projekt machbar machen:

- **Projektstruktur generieren statt importieren.** Fremde LP/§-Hierarchien aus Excel zu parsen ist
  Fehlerquelle Nr. 1. Beim Projektimport eine **HOAI-Standardstruktur als Vorlage** anbieten
  (Leistungsbilder vorhanden). Nutzer importiert nur Projekt-Kopf + Honorarsumme.
- **Historische Finanzdaten als Referenz** (s. 0). Pro aktivem Projekt: berechnet / bezahlt /
  Restforderung als schreibgeschützte Anfangsbestände. Dashboards & offene Posten stimmen ab Tag 1
  ohne jede alte Rechnungszeile.

---

## 4  Der Assistent (ein Flow, je Domäne wiederholt)

```
1. Domäne + Methode wählen   (Vorlage herunterladen  ODER  eigene Datei)
2. Datei hochladen           (CSV / XLSX)
3. Spalten zuordnen          (Auto-Vorschlag per Spaltenname; Mapping wird je Mandant gemerkt)
4. Prüfen & Vorschau         (Zeilenstatus, Dubletten-Behandlung, Zeilen abwählbar)
5. Bestätigen → Import-Stapel anlegen
6. Zusammenfassung + „Das ist Ihr nächster Schritt"
```

Eingebettet in die **bestehende Onboarding-Checkliste** (nicht daneben): jeder abgeschlossene Import
hakt einen Schritt ab und schlägt den nächsten vor.

---

## 5  Wenn etwas nicht (gut) importierbar ist → an die Hand nehmen

- **Stunden-/Buchungshistorie:** Standard-Empfehlung = *nicht* einzeln importieren. „Ihre Zeiterfassung
  beginnt am Stichtag. Bereits geleistete Stunden je Projekt erfassen wir als *eine*
  Anfangsbestands-Zahl." → ein Feld statt tausender Zeilen.
- **Fehlende Pflichtfelder:** Fehlerprotokoll als To-do-Liste mit Hinweis je Zeile, nicht als Sackgasse.
- **Nicht Abbildbares:** Leerzustände + Checklisten-Schritte mit „Warum" (Help-/Tooltip-Regel) führen
  zum manuellen Anlegen (z. B. erstes echtes Angebot direkt im Wizard statt Import).

---

## 6  Roadmap

- **Phase 0 — Fundament (minimal):** `IMPORT_BATCH`, `IMPORT_BATCH_ID`-Spalte(n), Rollback-Engine,
  generischer CSV/XLSX-Parser + Mapping + Validierungs-Framework. Einmal gebaut, tragen es alle Domänen.
- **Phase 1 — Stammdaten:** Adressen (Durchstich) → danach Mitarbeiter.
- **Phase 2 — Skelett:** Projekte + Struktur (Vorlage) + Verträge + Zuordnungen.
- **Phase 3 — Anfangsbestände:** offene Posten / Altrechnungen / Zahlungen als Referenz.
- **Phase 4 — optional:** aggregierte Buchungs-Anfangsbestände; später ggf. Konnektoren (DATEV).

**Vorgehen:** Phase 0 *minimal* + Adressen *komplett* als vertikaler Durchstich — Engine am echten Fall
beweisen, dann verallgemeinern. Nicht die ganze Engine auf Vorrat bauen.

---

## 7  Dienstleistungspakete (Sicherheitsnetz)

> Achtung Positionierung: GTM 5.2 sagt **„geführte Migration *inklusive*, nicht kostenpflichtig"** als
> Wechselhürden-Senker. Self-Service ist also dokumentierte Strategie; Bezahlpakete sind die *Ausnahme*.

| Paket | Preis | Leistung | Voraussetzung |
|---|---|---|---|
| **Geführter Import** (Self-Service) | 0 € (im Plan) | Vorlagen + Assistent: Stammdaten → Projekte → offene Posten | Excel/CSV vorhanden |
| **Starthilfe** (begleitet) | einmalig ~290–490 € | 60–90 Min Screen-Share: echter Export gemeinsam gemappt & importiert, Plausi-Check | strukturierter Export, 1 Ansprechpartner |
| **Komplett-Migration** (für uns) | gestaffelt nach Projektzahl (≤25 / ≤75 / 75+) | Exporte werden geliefert; wir mappen & importieren über internes Bulk-Tool, Abgleichbericht | strukturierter Export; **ausgeschlossen:** Nachbau alter PDFs/XRechnung, Einzelbuchungen (nur Anfangsbestände) |

In der founder-led Pilotphase (GTM Phase 1) ist „Starthilfe" v. a. Lern-Kanal, nicht primär Umsatz.

---

## 8  Pflicht-Häkchen (CLAUDE.md)

- **RBAC:** neue Permission `import.manage`, default Inhaber/Admin. Backend mit `requirePermission`,
  Frontend mit `<Can>` / `useFilterTabs`. Eigene Migration (`INSERT INTO PERMISSION` + `ROLE_PERMISSION`),
  Key in `permissionsStore.ts` ergänzen.
- **Hilfe/Tooltips:** Stichtag-Begriff, „Referenz vs. live", Anfangsbestand, Assistent-Schritte sind
  erklärungsbedürftig → `helpContent.tsx`-Einträge + Leerzustände in jeder Phase.

---

## 9  Konkreter Build-Plan — Phase 0 + Adressen (Durchstich)

**Backend**
- Migration `00XX_import_foundation.sql`: `IMPORT_BATCH` + `ADDRESS.IMPORT_BATCH_ID` (nullable FK).
- Migration `00XX_rbac_import.sql`: Permission `import.manage` + Default-Rollen.
- `services/importService.js`: Parser (CSV/XLSX), Mapping-Anwendung, Validierung, Dubletten-Check,
  Vorschau, Commit (als Batch), Rollback (mit Abhängigkeits-/Schutzprüfung).
- `controllers/importController.js` (thin) + `routes/import.js` (alle `requirePermission('import.manage')`):
  - `POST /import/:domain/preview` (Datei + Mapping → Vorschau-Ergebnis, kein Schreiben)
  - `POST /import/:domain/commit` (legt Batch an, schreibt gültige Zeilen)
  - `GET  /import/batches` (Liste „Letzte Importe")
  - `POST /import/batches/:id/rollback`
  - `GET  /import/:domain/template` (Vorlage herunterladen)

**Frontend**
- `api/import.ts` (typisierte Wrapper).
- `pages/import/`: Assistent (6 Schritte), Vorschau-Tabelle, Ansicht „Letzte Importe".
- Einbindung in Onboarding-Checkliste + SideNav/Settings (hinter `<Can permission="import.manage">`).
- `help/helpContent.tsx`: Einträge `import.*`.
```
