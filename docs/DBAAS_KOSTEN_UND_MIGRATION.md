# Datenbank-Umzug zu einem deutschen Anbieter — Kosten und Ablauf

Stand: 2026-08-07 · Entscheidungsgrundlage, noch keine Festlegung

> **Zu den Preisen:** Die Zahlen unten stammen aus einem Anbietervergleich, nicht aus
> den Preislisten der Anbieter selbst. Sie taugen zur Größenordnung und für die
> Vorauswahl — vor einer Entscheidung gehören sie mit einem Angebot gegengeprüft.
> Die Datenmengen dagegen sind an eurer laufenden Instanz **gemessen**.

---

## 1. Datengrundlage — gemessen, nicht geschätzt

Abgefragt über die Supabase-REST-API am 2026-08-07:

| Tabelle | Zeilen | | Tabelle | Zeilen |
|---|---:|---|---|---:|
| TEC (Buchungen) | 9.041 | | OFFER_STRUCTURE | 108 |
| NOTIFICATION | 876 | | PROJECT | 60 |
| PROJECT_STRUCTURE | 530 | | CONTRACT | 59 |
| ASSET | 179 | | INVOICE | 43 |
| PARTIAL_PAYMENT | 131 | | OFFER | 35 |
| **Summe** | **≈ 11.100** | | | |

Verteilung über die 6 Mandanten:

| Mandant | Mitarbeiter | Projekte | Buchungen | Rechnungen | Strukturzeilen |
|---|---:|---:|---:|---:|---:|
| ConGrim | 7 | 46 | 66 | 38 | 451 |
| demo1 | 8 | 8 | **8.888** | 1 | 55 |
| Simon Messina | 1 | 5 | 86 | 4 | 12 |
| kringelingling | 2 | 1 | 1 | 0 | 12 |
| Grohningen | 2 | 0 | 0 | 0 | 0 |
| PLAIN | 0 | 0 | 0 | 0 | 0 |

Zwei Beobachtungen, auf denen die Hochrechnung aufbaut:

**`TEC` dominiert mit 81 % aller Zeilen.** Zeitbuchungen sind die einzige Tabelle, die
linear mit Mitarbeitern **und** Zeit wächst. Alles andere skaliert deutlich flacher.

**`demo1` ist die realistische Referenz.** 8 Mitarbeiter, 8.888 Buchungen — das ist
der Seed-Datensatz und simuliert ein Büro, das die Zeiterfassung wirklich nutzt.
ConGrim als echter Pilotkunde zeigt dagegen das andere Extrem: 46 Projekte und
38 Rechnungen, aber erst 66 Buchungen. Die reale Last liegt zwischen beidem.

Buchungszeitraum insgesamt: 2021-09-30 bis 2026-08-06.

---

## 2. Was die Kosten treibt — und was nicht

**Speicher ist bei dieser Anwendung praktisch kostenlos.** Rechnung pro Nutzer und Jahr:

```
Zeitbuchungen   220 Arbeitstage × 3 Buchungen   ≈   660 Zeilen
Zeilengröße     ~30 Spalten + Indexanteil       ≈   0,6 KB
                                                   ─────────
TEC pro Nutzer/Jahr                             ≈   0,4 MB
+ Projekte, Struktur, Rechnungen, Meldungen     ≈   0,6 MB
                                                   ─────────
                                                ≈   1 MB pro Nutzer und Jahr
```

Selbst großzügig mit 3 MB gerechnet ergibt das:

| Nutzer | Büros ca. | nach 3 Jahren | nach 5 Jahren |
|---:|---:|---:|---:|
| 50 | 10 | 0,5 GB | 0,8 GB |
| 250 | 50 | 2,3 GB | 3,8 GB |
| 1.000 | 200 | 9 GB | 15 GB |
| 2.500 | 500 | 23 GB | 38 GB |

Zum Vergleich: Der kleinste Speicherblock bei plusserver umfasst 50 GB für 14,30 €.
Ihr würdet also selbst bei 2.500 Nutzern nach fünf Jahren noch **den kleinsten
Block** bezahlen.

**Die Kosten bestimmt die Instanzgröße** — also RAM und vCPU. Und die hängt an drei
Dingen:

1. **Arbeitsdatenmenge im RAM.** Postgres ist schnell, solange die häufig gelesenen
   Daten im Speicher liegen. Faustregel: RAM ≥ aktive Datenmenge.
2. **Gleichzeitige Verbindungen.** Jede Postgres-Verbindung kostet 5–10 MB.
3. **Abfragelast.** Und hier liegt bei euch ein hausgemachter Faktor — siehe unten.

> **Kostentreiber aus dem Pentest:** `routes/reports.js` hat 22 Endpunkte und
> **keine einzige** Paginierung. `/dashboard/team-hours` mit
> `?date_from=1900-01-01` zieht jede TEC-Zeile des Mandanten in den Node-Prozess
> und aggregiert dort in einer JS-Schleife. Das erzwingt eine größere Instanz, als
> die Datenmenge rechtfertigt. Die Aggregation in die Datenbank zu verlagern ist
> billiger als die nächste Tarifstufe — und zwar dauerhaft.

---

## 3. Kostenszenarien

Die Instanzgrößen sind aus Arbeitsdatenmenge und erwarteter Parallelität
abgeleitet, nicht aus Anbieter-Empfehlungen.

### Szenario A — Pilot: bis 50 Nutzer (≈ 10 Büros)

| | |
|---|---|
| Datenmenge | < 1 GB |
| Instanz | 2 vCPU / 4 GB, einzelner Knoten |
| Verbindungen | < 25 |

| Anbieter | monatlich |
|---|---|
| Sliplane (1 vCPU / 1 GB / 10 GB) | ab 19 € |
| Ubicloud auf Hetzner | ab ca. 15 $ |
| plusserver b2-4 + 50 GB | ca. 95 € |
| STACKIT (3 Knoten Minimum) | ca. 142 € |

**Einordnung:** In dieser Phase ist die Datenbank nicht der Kostenfaktor. Wichtiger
ist, dass der Anbieter mitwachsen kann, ohne dass ihr nochmal umziehen müsst.

### Szenario B — Wachstum: 250 Nutzer (≈ 50 Büros)

| | |
|---|---|
| Datenmenge | 2–4 GB |
| Instanz | 4 vCPU / 8–16 GB |
| Verbindungen | 50–100 |
| Redundanz | ab hier Hochverfügbarkeit erwägen |

Erwartbarer Rahmen: **150–300 €/Monat** einzelner Knoten, **300–600 €** mit HA.

**Einordnung:** Hier fällt die Entscheidung über Hochverfügbarkeit. Bei einer
Anwendung, die Rechnungen schreibt, ist ein Ausfall kein kosmetisches Problem —
aber HA verdoppelt bis verdreifacht den Posten. Alternative: einzelner Knoten mit
Point-in-Time-Recovery und einer belastbaren Wiederherstellungszeit.

### Szenario C — Etabliert: 1.000 Nutzer (≈ 200 Büros)

| | |
|---|---|
| Datenmenge | 9–15 GB |
| Instanz | 8 vCPU / 32 GB |
| Verbindungen | 150–300, Pooler nötig |
| Redundanz | HA nicht mehr verhandelbar |

Erwartbarer Rahmen: **500–1.000 €/Monat** mit HA.

**Einordnung:** Ab hier braucht es einen Verbindungs-Pooler (PgBouncer o. ä.).
PostgREST hält einen eigenen Pool — die Auslegung gehört bei dieser Größe geplant,
nicht geraten.

### Szenario D — Skaliert: 2.500 Nutzer (≈ 500 Büros)

| | |
|---|---|
| Datenmenge | 23–38 GB |
| Instanz | 16 vCPU / 64 GB + Lese-Replikat |
| Redundanz | HA + Replikat für Reporting |

Erwartbarer Rahmen: **1.200–2.500 €/Monat**.

**Einordnung:** In dieser Größe lohnt es, die Reporting-Last auf ein Lese-Replikat
zu legen. Und es lohnt sich, die unpaginierten Berichte vorher zu reparieren —
sonst kauft ihr Hardware für einen Konstruktionsfehler.

### Die Zahl, auf die es ankommt

Absolute Beträge sagen wenig. Entscheidend ist der Anteil am Umsatz:

| Szenario | DB-Kosten | Umsatz bei 25 €/Nutzer | Anteil |
|---|---:|---:|---:|
| A — 50 Nutzer | ~95 € | 1.250 € | 7,6 % |
| B — 250 Nutzer | ~300 € | 6.250 € | 4,8 % |
| C — 1.000 Nutzer | ~750 € | 25.000 € | 3,0 % |
| D — 2.500 Nutzer | ~1.800 € | 62.500 € | 2,9 % |

Der Anteil sinkt mit der Größe — das ist die gesunde Richtung. Die Datenbank wird
nie euer Kostenproblem. Kritisch ist allein die Pilotphase, in der die Fixkosten
auf wenige zahlende Nutzer treffen. Deshalb: **klein anfangen bei einem Anbieter,
der ohne Umzug wachsen kann.**

---

## 4. Anbieter

| Anbieter | Standort | Einstieg | Postgres | Bemerkung |
|---|---|---|---|---|
| **plusserver** | Köln, Hamburg | 80,52 €<br>(2 vCPU/4 GB) | 15–18 | Deutscher Betreiber, Backups/Patching/Monitoring inklusive |
| **STACKIT** | Deutschland | ~142 €<br>(3 Knoten) | 15–18 | Schwarz Gruppe, souveräne Cloud; hoher Einstieg, weil HA-Minimum |
| **IONOS Cloud** | Deutschland | nutzungsbasiert | k. A. | Multi-Node-HA, PITR, Terraform/Ansible; Konsole gilt als sperrig |
| **Sliplane** | Deutschland u. a. | 19 € | k. A. | Günstigster Einstieg, PITR und SSL inklusive, keine Egress-Gebühren |
| **Ubicloud auf Hetzner** | deutsche RZ | ab ~15 $ | 16+ | Läuft in Hetzner-Rechenzentren, Anbieter ist aber US-amerikanisch — bei Souveränität als Kriterium genau prüfen |
| Hetzner direkt | Deutschland | — | — | **Bietet kein Managed Postgres an** (Stand 2026) |

**Wenn Souveränität das Motiv ist**, fallen Ubicloud und teils Sliplane aus der
engeren Wahl — entscheidend ist nicht der Serverstandort, sondern wer die Kontrolle
über den Betreiber hat. Dann bleiben plusserver, STACKIT und IONOS.

**Wenn es um DSGVO-Konformität und EU-Datenhaltung geht**, ist die Auswahl größer
— und dann gehört auch Scalingos eigenes PostgreSQL in den Vergleich (Frankreich,
EU, bereits angebunden, siehe nächster Abschnitt).

---

## 5. Der Punkt, der wichtiger ist als der Preis

**App und Datenbank müssen im selben Rechenzentrum stehen.**

Die Anwendung setzt pro HTTP-Anfrage nicht eine, sondern viele Datenbankabfragen ab
— 750 `supabase.from(...)`-Aufrufstellen, überwiegend nacheinander. Jede zusätzliche
Millisekunde Latenz multipliziert sich mit der Anzahl der Abfragen pro Anfrage.

Ein Rechenbeispiel für einen Endpunkt mit 20 sequenziellen Abfragen:

| Aufstellung | Latenz je Abfrage | Aufschlag je Anfrage |
|---|---:|---:|
| App und DB im selben RZ | < 1 ms | < 20 ms |
| Scalingo (Paris) ↔ Frankfurt | ~10 ms | ~200 ms |
| Scalingo (Paris) ↔ Hamburg | ~15 ms | ~300 ms |

200 ms Aufschlag auf **jede** Seite ist der Unterschied zwischen „reagiert sofort"
und „fühlt sich zäh an" — und zwar bei jedem Klick, dauerhaft.

Daraus folgt eine Kopplung, die in der Anbieterwahl mitentschieden werden muss:

- **Datenbank in Deutschland** → dann sollte auch die Anwendung dorthin. Scalingo
  wäre dann die falsche Plattform, und der gerade erfolgreich abgeschlossene
  Deployment-Test wäre eine Sackgasse.
- **Anwendung bleibt bei Scalingo** (Paris) → dann ist Scalingos eigenes PostgreSQL
  die technisch stimmigste Wahl. Auch EU, auch DSGVO — nur nicht deutsch.

> **Noch nicht gemessen:** Ich wollte die tatsächliche Latenz vom Scalingo-Container
> zu eurer Supabase-Instanz messen; der One-off-Zugang (Port 5000) war nicht
> erreichbar. Die Zahlen oben sind typische RTT-Werte, keine Messung an eurem
> Aufbau. Nachholen mit:
> ```bash
> scalingo --app plain-test run 'curl -s -o /dev/null \
>   -w "%{time_connect} %{time_appconnect} %{time_total}\n" \
>   -H "apikey: $SUPABASE_SERVICE_KEY" "$SUPABASE_URL/rest/v1/"'
> ```

---

## 6. Migrationsablauf

Der Ablauf entspricht weitgehend [SCALINGO_MIGRATION.md](SCALINGO_MIGRATION.md) —
die Datenbank ist eine andere, die Schritte sind dieselben. Die Werkzeuge unter
`backend/scripts/migration/` funktionieren unverändert.

### Phase 0 — Vorbereitung

```
backend/scripts/migration/01_inventory.sql   → im Supabase SQL Editor
```

Liefert das vollständige Schema, das im Repository **nicht** existiert: 18 der 19
Kerntabellen haben kein `CREATE TABLE` in den Migrationen. Abschnitt 5 der Ausgabe
(Extensions) ist der kritische Teil — was dort außerhalb der Standardliste steht,
muss der neue Anbieter unterstützen, sonst scheitert der Restore.

### Phase 1 — Zielsystem anlegen

Postgres-Version **nicht unter** der Quellversion wählen (Supabase läuft auf 15).
Ein Dump von 15 spielt in 17 ein, umgekehrt nicht.

Zugang klären: manche Anbieter erlauben nur Verbindungen aus dem eigenen Netz.
Dann braucht es einen Bastion-Host oder eine IP-Freigabe für die Migration.

### Phase 2 — Schema und Daten

```bash
export SRC="postgresql://postgres:PASS@db.<ref>.supabase.co:5432/postgres"
cd backend/scripts/migration
./02_export.sh 4 6          # die Mandanten-IDs, die mitkommen
```

Zur Auswahl: **ConGrim (4)** ist der echte Pilotkunde. **demo1 (11)** enthält 8.888
Seed-Buchungen — die will man vermutlich nicht in die Produktivdatenbank schleppen,
sondern beim Anbieter neu erzeugen. **PLAIN (3)** und **Grohningen (10)** sind leer.

Import in drei Schritten (Tabellen → Daten → Constraints), damit die
Ladereihenfolge keine Rolle spielt und keine Superuser-Rechte nötig sind. Details
im Skript.

### Phase 3 — PostgREST

Der entscheidende Unterschied zu Supabase: Ein reiner Postgres-Dienst bringt **kein**
PostgREST mit. Ohne Ersatz brechen alle 750 Aufrufstellen.

Zwei Wege:
- **PostgREST selbst betreiben** — dann bleibt der Anwendungscode unangetastet.
  Muss im selben Rechenzentrum laufen wie die Datenbank (siehe Abschnitt 5).
- **Datenzugriff neu schreiben** — 750 Stellen in 118 Dateien, Monate an Arbeit.

Das ist die teuerste Einzelentscheidung des ganzen Vorhabens und sollte **vor** der
Anbieterwahl fallen: Kann der Anbieter neben der Datenbank auch einen Dienst
betreiben? Wenn nicht, braucht ihr eine zweite Plattform daneben — und die sollte
wieder im selben Rechenzentrum stehen.

### Phase 4 — RLS scharf schalten

```
backend/scripts/migration/03_rls_postgrest.sql
```

Der Umzug ist der günstigste Zeitpunkt, die Mandantentrennung von der Anwendung in
die Datenbank zu verlagern. Die 26 Policies existieren bereits; zu ändern ist im
Kern eine Funktion. Damit erledigt sich die gesamte Cross-Tenant-Fehlerklasse aus
dem Pentest strukturell.

### Phase 5 — Umschalten

1. Wartungsfenster ankündigen (bei sechs Mandanten überschaubar)
2. Letzten Delta-Export ziehen
3. `SUPABASE_URL` auf die neue PostgREST-Adresse umstellen
4. Prüfen: Anmeldung, Listen, Rechnung anlegen, PDF, E-Rechnung
5. Supabase-Projekt **löschen** — solange es existiert, ist der in der
   Git-Historie liegende Service-Key gültig (Pentest, Befund 0.1)

---

## 7. Was vor der Entscheidung zu klären ist

| # | Frage | Warum sie zählt |
|---|---|---|
| 1 | **Souveränität oder DSGVO?** | Bestimmt, ob Ubicloud/Sliplane in Frage kommen und ob Scalingo als EU-Anbieter reicht |
| 2 | **Wo läuft die Anwendung?** | Muss zur Datenbank passen, sonst Latenz bei jedem Klick |
| 3 | **Kann der Anbieter PostgREST hosten?** | Sonst zweite Plattform nötig — oder 750 Aufrufstellen umschreiben |
| 4 | **Hochverfügbarkeit ab wann?** | Verdoppelt bis verdreifacht den Posten |
| 5 | **Welche Extensions nutzt die DB?** | Inventar Abschnitt 5 — kann den Restore scheitern lassen |
| 6 | **demo1 mitnehmen?** | 8.888 Zeilen Seed-Daten in der Produktivdatenbank |

**Wenn du mir sagst, welchen Anbieter du dir ansiehst,** rechne ich die Szenarien
mit dessen echter Preisliste durch statt mit Vergleichswerten — und prüfe die
beiden Punkte, die dort scheitern könnten: Extensions und PostgREST-Hosting.
