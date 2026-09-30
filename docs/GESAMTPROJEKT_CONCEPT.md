# Gesamtprojekte — mehrere Projekte als eine Einheit

Stand 2026-09-30. Stufe 1 und Stufe 2 sind umgesetzt (Migration `0181`), Stufe 3 ist hier beschrieben.
Offen aus Stufe 2 ist nur der optionale Teil „Angebot merkt sich das Gesamtprojekt" (Auftragsbestand).

## 1. Anforderung

In Planungsbüros entsteht ein Vorhaben oft aus **mehreren Einzelverträgen**:

- **Stufenverträge**: LPH 1–4 wird beauftragt, LPH 5–8 später als eigener Vertrag.
- **Nachträge als eigener Vertrag**: statt einer Erweiterung des bestehenden Vertrags.
- **Andere Rechnungsadresse**: Teilleistungen gehen an einen anderen Rechnungsempfänger (Bauherr und Nutzer, zwei Ämter, eine Fördermaßnahme).

In plan&simple ist jeder davon ein eigenes Projekt, weil zu jedem Projekt genau ein Vertrag gehört. Ausgewertet werden soll aber auch **das Vorhaben als Ganzes**: Honorar, Leistungsstand, Abrechnung und Verlauf über alle Verträge. In einzelnen Bereichen (Projekte, Reporting, Adressen …) sollen die Projekte zusammengefasst **und** einzeln sichtbar sein.

## 2. Verglichene Ansätze

| Ansatz | Warum nicht / warum |
|---|---|
| **Mehrere Verträge je Projekt** | `CONTRACT` hängt zwar über `PROJECT_ID` am Projekt, aber jede Stelle behandelt das als 1:1 (`getContractByProject` und `copyProject` lesen mit `maybeSingle`, `nachtraege.js` mit `limit(1)`). Struktur, Rechnungen, Abzüge der Schlussrechnung (`arDeduction.js`), offener Betrag, E-Rechnung und der Report „Teilfertige Leistungen" rechnen je Projekt. Alles davon müsste nach Vertrag aufgespalten werden. Genau das sollte vermieden werden. |
| **Haupt- und Teilprojekt** (`PROJECT.FATHER_PROJECT_ID`) | Offen bleibt, ob das Hauptprojekt eigene Struktur, Buchungen und Rechnungen hat. Hat es sie, gibt es zwei Arten von Projekten mit unterschiedlichen Regeln. Hat es sie nicht, ist es eine Gruppe mit falschem Namen. Dazu rechnet jede Auswertung rekursiv. |
| **Freie Merkmale (Tags)** | Das ist flexibel, taugt aber nicht als *eine Einheit*: Ein Projekt in zwei Tags zählt in beiden Summen, und es gibt keinen Ort für Name, Auftraggeber und Notizen des Vorhabens. Später wäre es als Ergänzung denkbar (z. B. „Förderprogramm X" quer zu den Vorhaben). |
| **Gespeicherter Filter** im Reporting | Er existiert nur im Reporting. In Projekten, Adressen und Rechnungen wüsste niemand von der Zusammengehörigkeit. |
| **Gesamtprojekt** (flache Gruppe) — **gewählt** | Ein eigenes, schlankes Objekt. Ein Projekt gehört zu höchstens einem Gesamtprojekt, es gibt nur eine Ebene. Jede Summe ist damit eindeutig, und kein bestehendes Modul ändert seine Rechnung. |

Entscheidungen vom 2026-09-30: flache Gruppe, Begriff „Gesamtprojekt" in der Oberfläche (technisch `PROJECT_GROUP`), Recht `projects.edit`.

## 3. Leitgedanke: Klammer, kein Beleg-Träger

Das Gesamtprojekt **trägt keine Belege**. Buchungen, Vertrag, Rechnungen, Nachträge und Leistungsstände bleiben unverändert am einzelnen Projekt. Das Gesamtprojekt ordnet nur zu und summiert.

Daraus folgt, was es bewusst **nicht** tut:
- Es gibt keine Rechnung „über das Gesamtprojekt". Abgerechnet wird je Projekt und damit je Vertrag.
- Die E-Rechnung bleibt, wie sie ist: BT-11 (Projektreferenz) ist weiterhin das Projekt.
- Es gibt keine Struktur und keine Buchungen am Gesamtprojekt.

## 4. Datenmodell (Migration `0181_gesamtprojekt.sql`)

```
PROJECT_GROUP
  ID, TENANT_ID (NOT NULL, DEFAULT current_tenant_id())
  ABBR        text     -- Kürzel, frei (z. B. die Nummer des ersten Projekts)
  NAME        text     -- Pflicht, nicht leer (CHECK)
  ADDRESS_ID  → ADDRESS  ON DELETE SET NULL   -- Auftraggeber/Bauherr, optional
  MANAGER_ID  → EMPLOYEE ON DELETE SET NULL   -- Gesamtverantwortung, optional
  NOTES       text
  created_at, updated_at

PROJECT.PROJECT_GROUP_ID → PROJECT_GROUP ON DELETE SET NULL
```

- **RLS**: `ENABLE` + `FORCE` und die Policy `tenant_isolation` wie in `0137`/`0177`. Das DDL braucht keinen Claim.
- **Keine UNIQUE-Regel** auf Name und Kürzel, weil der Mandant beides selbst vergibt (vgl. `0164`). Bei gleichem Namen fragt die Oberfläche nach.
- **Fremdschlüssel prüfen den Mandanten nicht.** Wer `PROJECT_GROUP_ID` setzt, geht durch `assertOwnGroup` (`services/gesamtprojekte.js`). Das gilt für die Projektdaten (`patchProject`) und für die Zuordnung (`setMembers`).
- **Adresse und Leitung sind reine Angaben.** Wird ein Auftraggeber oder Mitarbeiter gelöscht, leert das das Feld, statt das Löschen zu blockieren. Die Löschprüfungen in `dependencyCheck.js` bleiben deshalb unberührt.

## 5. Fachliche Regeln

1. **Quoten aus Summen, nie als Mittelwert.** Leistungsstand % = Σ Leistungswert / Σ Honorar, Kostenquote = Σ Kosten / Σ Leistungswert. Ein Mittelwert gäbe einem 5.000-€-Nachtrag dasselbe Gewicht wie dem 400.000-€-Hauptvertrag. Serverseitig rechnet `aggregateKpis` (`services/gesamtprojekte.js`), im Report die vorhandenen `renderTotal` je Spalte. Beide sind gleich gebaut, sodass Zwischensumme und Kopf des Gesamtprojekts nicht auseinanderlaufen.
2. **Reporting-Scope.** Summen entstehen nur aus Projekten im Reporting-Bereich des Nutzers (`req.reportScopeProjectIds`, ohne `reports.scope.all` also nur Projekte, die er leitet). Die Antwort sagt, wie viele Projekte fehlen (`members_visible` von `members_total`). Deren Beträge verlassen den Server nicht, auch nicht als Differenz.
3. **Teilfertige Leistungen.** Bewertungseinheit bleibt der einzelne Vertrag, also das Projekt. Innerhalb eines Gesamtprojekts wird **nicht saldiert** (§ 246 Abs. 2 HGB). Aktiv- und Passivseite werden getrennt zwischensummiert (Stufe 2). Ob Stufenverträge desselben Auftraggebers wirtschaftlich *ein* Vertrag sind, ist eine Bilanzfrage für den Steuerberater, keine Programmfunktion.
4. **Löschen.** Ein gelöschtes Gesamtprojekt löst nur die Zuordnung, die Projekte bleiben erhalten. Der Service leert `PROJECT_GROUP_ID` ausdrücklich mit Mandantenfilter, `ON DELETE SET NULL` ist das Netz darunter. Ein gelöschtes Projekt verlässt einfach seine Gruppe.
5. **Leere Gesamtprojekte sind erlaubt.** Die Klammer lässt sich also vor dem ersten Projekt anlegen.
6. **Projekt kopieren.** `copyProject` übernimmt `PROJECT_GROUP_ID`. Die Kopie ist meist die nächste Stufe und gehört deshalb ins selbe Gesamtprojekt.
7. **Mehrere Firmen je Mandant** in einem Gesamtprojekt sind erlaubt. Summen sind netto und in einer Währung. Sollte es je Verträge in verschiedenen Währungen geben, muss die Summe das erkennen (heute gibt es den Fall nicht).
8. **Genau ein Gesamtprojekt je Projekt.** Wer ein Projekt einem anderen zuordnet, hängt es um. Die Oberfläche fragt vorher, die Antwort von `setMembers` nennt die umgehängten Projekte (`moved`).

## 6. Rechte und Lizenz

- **Sehen** der Gesamtprojekte: `projects.view` (die Routen liegen unter `/projekte`).
- **Anlegen, Ändern, Löschen und Zuordnen**: `projects.edit`. Eine Zuordnung ist Pflege der Projektdaten wie Name oder Auftraggeber. Es gibt keine neue Permission, keine Capability und keinen Signup-Seed.
- **Beträge**: `reports.view` sowie der Reporting-Scope (Regel 2). Ohne das Recht fehlen die Kennzahlen, statt Nullen zu zeigen.
- **Tarif**: Das Gesamtprojekt hängt an den bestehenden Rechten und ist damit überall verfügbar, wo Projekte verfügbar sind.

## 7. Oberflächen (Stufe 1)

| Ort | Was |
|---|---|
| Projekte → Reiter **Gesamtprojekte** (`/projekte?tab=gesamtprojekte`) | Liste mit Kürzel, Name, Auftraggeber, Anzahl, Σ Honorar und Σ Abgerechnet (mit „2 von 3", wenn der Scope kürzt). „+ Neues Gesamtprojekt" mit Projektauswahl. Leerzustand mit Begründung. Am Handy eine Liste statt Tabelle. |
| **Gesamtprojekt** (`/projekte?groupId=…&tab=uebersicht\|daten`) | Kopf mit Kennzahlen (Honorar, Leistungsstand, Abgerechnet, Noch abzurechnen, Kostenquote) und Scope-Hinweis. „Übersicht": Projekte mit Beträgen und Summe, „Projekte zuordnen", Verlauf über alle Projekte. „Daten": Name, Kürzel, Auftraggeber, Gesamtverantwortung, Notizen (ActionBar, Rückfrage beim Verlassen). Löschen über das Menü im Kopf. |
| Projekt → **Projektdaten** | Abschnitt „Gesamtprojekt": Auswahl plus „+ Neues Gesamtprojekt anlegen …" (vorbelegt aus dem Projekt). Gespeichert wird wie jedes Feld, und ein Link führt ins Gesamtprojekt. |
| **Projektkopf** | „Teil von *Name* · n Projekte" führt ins Gesamtprojekt. |
| **Projektliste** | Filter „Gesamtprojekt", Abzeichen am Namen, Suche findet auch den Namen des Gesamtprojekts. |
| Reporting → **Alle Projekte** | Filter „Gesamtprojekt". Mit „Nach Gesamtprojekt zusammenfassen" bekommt jedes Gesamtprojekt eine Kopfzeile mit Zwischensumme, danach folgt „Ohne Gesamtprojekt". |
| **Hilfe** | `projects.gesamtprojekt`, `report.gesamtprojekt` (`helpContent.tsx`). |

In Stufe 1 zeigte die Übersicht je Projekt den Auftraggeber. Seit Stufe 2 steht dort der **Rechnungsempfänger** aus dem Vertrag, sofern der Nutzer Verträge sehen darf (siehe Abschnitt 8); sonst bleibt es beim Auftraggeber.

Nebenbei geschlossen: `GET /reports/projects/timeline` beachtete den Reporting-Scope nicht. Ohne `project_ids` lieferte er den Verlauf des ganzen Mandanten, mit `project_ids` den beliebiger Projekte. Der Verlauf des Gesamtprojekts benutzt genau diesen Endpunkt, deshalb schneidet er jetzt mit dem Scope.

## 8. Stufe 2 (umgesetzt)

- **Neue Projekte gleich im Gesamtprojekt.** Drei Wege legen Projekte an: Neuanlage (`createProject`), Beauftragen (`convertOfferToProject`) und Kopieren (`copyProject`). Alle gehen durch **einen** Helfer, `newProjectGroupAndAbbr` in `services/gesamtprojekte.js`. Er prüft das Gesamtprojekt (fremd → 400) und eine vorgegebene Nummer (vergeben → 409), und zwar bevor der Nummernkreis gezogen wird, damit eine abgelehnte Anfrage keine Nummer verbraucht. `PROJECT_GROUP_ID` geht nur mit in die Zeile, wenn gewählt, damit die Neuanlage im Deploy-Fenster nicht scheitert.
  - **Beauftragen:** Der Dialog hat den Abschnitt „Gesamtprojekt". Das ist der Normalfall beim Stufenvertrag.
  - **Neuanlage:** Der Assistent bietet dasselbe an. Aus der Gesamtprojekt-Ansicht („Neues Projekt") ist das Gesamtprojekt vorgewählt und sein Auftraggeber samt Hauptansprechpartner vorbelegt.
  - **Folgeprojekt:** Eine Kopie eines Projekts (Struktur, Team, Vertrag), je Zeile in der Übersicht. Sie bleibt im Gesamtprojekt der Vorlage.
- **Nummern ableiten.** `GET /projekte/gruppen/:id/nummer` schlägt `{Kürzel}-{NN}` vor: zweistellig, die erste Nummer nach der höchsten vergebenen. Das Projekt, das das Kürzel selbst trägt, zählt als 01. Ohne Kürzel gibt es keinen Vorschlag. Der Nutzer wählt zwischen Nummernkreis und abgeleiteter Nummer (`GesamtprojektWahl.tsx`). Der Nummernkreis bleibt bei der abgeleiteten Nummer unberührt.
- **Adressen, „Verwendet in":** Gesamtprojekte mit dieser Adresse als Auftraggeber oder mit einem ihrer Projekte, dazu an jedem Projekt „Teil von …" (`addressLinks`). Im Deploy-Fenster bleibt die Liste leer, statt einen Fehler zu liefern.
- **Rechnungen und Mahnwesen:** Filter „Gesamtprojekt". Die Zuordnung kommt aus der geteilten Projektliste (`['projects-full']`); ohne `projects.view` entfällt der Filter. „Offene Posten" ist dort der Schalter „nur offen".
- **Leistungsphasen über das Gesamtprojekt:** Die Matrix `GET /reports/phases/matrix?group_id=…` rechnet nur über die Projekte des Gesamtprojekts im Reporting-Scope und meldet „n von m". Im Gesamtprojekt ist das ein eigener Reiter (Recht `reports.view`, Tarif `reports.advanced`), im Reporting eine Auswahl. Ein Stufenvertrag zeigt damit LPH 1–4 und 5–8 als ein Bild.
- **Teilfertige Leistungen:** Filter und „Nach Gesamtprojekt zusammenfassen". Die Zwischensummen entstehen aus denselben Spaltensummen wie die Gesamtzeile, Teilfertig und Anzahlungen bleiben also getrennt (Regel 3). Der CSV-Export hat eine Spalte „Gesamtprojekt".
- **Rechnungsempfänger** je Projekt in der Übersicht, aus dem Vertrag. Er kommt nur mit `projects.contracts.view` mit (`getGroup(…, withInvoiceAddress)`).
- **Projektwahl** (Strg+K im Projektkopf, Zeiterfassung, „Eigene Zeit"): Unter jedem Projekt steht das Gesamtprojekt, und die Suche findet es auch darüber. Das hilft beim Buchen auf den richtigen Vertrag. Die Liste für „Eigene Zeit" bleibt ohne Beträge.
- **Nicht gebaut:** Dass sich schon das Angebot das Gesamtprojekt merkt (`OFFER.PROJECT_GROUP_ID`, offene Angebote als Auftragsbestand), ist bewusst ausgelassen. Es wäre eine weitere Spalte mit eigener Pflege, und beim Beauftragen wählt man das Gesamtprojekt ohnehin.

## 9. Stufe 3 (optional)

- **Nachtrag als eigenes Projekt im Gesamtprojekt freigeben.** Das ist die Alternative zum Einhängen in die Struktur, gedacht für einen eigenen Vertrag oder einen anderen Rechnungsempfänger. Heute hängt die Freigabe die Positionen in die bestehende `PROJECT_STRUCTURE` ein.
- **Platzhalter „Bauvorhaben/Gesamtprojekt"** in PDF- und E-Mail-Vorlagen (z. B. „BV: …" auf der Rechnung).
- **Spalte „Gesamtprojekt" im Datenimport** (Projekte).
- **Budget und Budgetwarnung** auf Ebene des Gesamtprojekts.

## 10. Offene Punkte

- **Status des Gesamtprojekts.** Heute gibt es keinen eigenen. Denkbar wäre er abgeleitet („läuft", solange ein Projekt läuft). Ein gepflegter Status würde mit dem der Projekte auseinanderlaufen.
- **Format der abgeleiteten Nummer** (Stufe 2): Trennzeichen und Stellenzahl pro Mandant einstellbar oder fest?
- **Tags zusätzlich?** Nur, wenn Kunden Querschnitte brauchen, die keine Einheit sind (Förderprogramm, Rahmenvertrag über mehrere Vorhaben).
