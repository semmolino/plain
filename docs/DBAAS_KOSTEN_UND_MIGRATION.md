# Datenbank-Umzug zu einem deutschen Anbieter — Kosten und Ablauf

Stand: 2026-08-07 · Anbieter in engerer Wahl: **plusserver** · noch keine Festlegung

> **Kurzfassung zu plusserver:** Die Kombination trägt. Datenbank, PostgREST und
> Anwendung können alle in Köln oder Hamburg laufen — damit löst sich der
> Latenzpunkt, der bei getrennten Standorten (App in Paris, Datenbank in
> Deutschland) das größte technische Problem gewesen wäre. Die Extensions-Frage
> ist geklärt: euer Schema braucht keine. Offen bleiben die Preise oberhalb der
> Einstiegsstufe und die Betriebsform für PostgREST. Details in **Abschnitt 8**.

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

| # | Frage | Stand |
|---|---|---|
| 1 | **Souveränität oder DSGVO?** | plusserver erfüllt beides — Frage entschärft |
| 2 | **Wo läuft die Anwendung?** | **offen** — Kernentscheidung, siehe Abschnitt 8 |
| 3 | **Kann der Anbieter PostgREST hosten?** | ja, über PSKE (Kubernetes) |
| 4 | **Hochverfügbarkeit ab wann?** | offen, Preis erfragen |
| 5 | **Welche Extensions nutzt die DB?** | **geklärt: keine** (Abschnitt 8), Restbestätigung über das Inventar |
| 6 | **demo1 mitnehmen?** | offen — 8.888 Zeilen Seed-Daten |

---

## 8. plusserver im Detail

### Was bestätigt ist

| | |
|---|---|
| Produkt | PostgreSQL as a Service, Managed |
| Standorte | Köln, Hamburg (eigene deutsche Rechenzentren) |
| Postgres-Versionen | **15 – 18** |
| Kleinster Knoten | b2-4 — 2 vCPU, 4 GB RAM |
| Abrechnung | Pay-as-you-go, keine Mindestlaufzeit |
| Skalierung | CPU, RAM und Speicher jederzeit änderbar |
| Redundanz | Cluster/HA, bis zu **drei Read-Replicas**, Multi-AZ konfigurierbar |
| Backups | täglich automatisch, 7 Tage Standardaufbewahrung |
| Inklusive | Setup, Patching, Backup, Monitoring, Betrieb |

Preise aus dem Anbietervergleich (**nicht** aus plusservers Preisliste):
0,11 €/h ≈ **80,52 €/Monat** für b2-4, **14,30 € je 50 GB** Speicher im Monat.

### Der entscheidende Fund: plusserver hat auch Compute

plusserver betreibt die **Kubernetes Engine (PSKE)** — CNCF-zertifiziert, auf
Basis von SAP Gardener, mit Autoscaling und Hibernation. Workloads laufen in der
BSI-C5-geprüften *pluscloud open* an vier deutschen Standorten; als Cluster-Regionen
stehen Köln und zwei Hamburger Standorte zur Wahl.

Das beantwortet die Frage aus Abschnitt 5, die wichtiger war als der Preis:

```
     bisher geplant                     mit plusserver möglich
  ┌──────────────────────┐          ┌──────────────────────────┐
  │ App (Scalingo/Paris) │          │ App        (Köln)        │
  │        ↕ ~10 ms      │          │ PostgREST  (Köln)        │
  │ DB  (Deutschland)    │          │ PostgreSQL (Köln)        │
  └──────────────────────┘          └──────────────────────────┘
   200 ms Aufschlag je Seite         alles im selben RZ, < 20 ms
```

Damit ist der gesamte Stack deutsch **und** ko-lokalisiert — die technisch
sauberste Variante.

### Der Preis dafür ist nicht in Euro

Kubernetes ist betrieblich etwas völlig anderes als Scalingos Buildpack-Modell.
Was ihr heute mit `git push` erledigt, bedeutet dort: Container-Images bauen,
Manifeste pflegen, Ingress und TLS konfigurieren, Secrets verwalten, Deployments
und Rollbacks selbst fahren.

Für ein kleines Team ist das ein realer, dauerhafter Aufwand — er taucht in keiner
Preisliste auf, kostet aber Zeit, die sonst ins Produkt fließt. Das gehört gegen
den Vorteil „alles aus einer Hand in Deutschland" abgewogen.

Zwischenlösung, falls das zu viel ist: **Datenbank bei plusserver, Anwendung
bleibt bei Scalingo.** Dann bleibt der Latenzaufschlag — er ist bei sechs
Mandanten und moderater Nutzung verkraftbar, wächst aber mit jedem Nutzer.

### Extensions: geprüft, kein Risiko

Der Punkt, der einen Restore am ehesten scheitern lässt, ist geklärt. Prüfung
gegen alle 119 Migrationen:

| Extension | verwendet? |
|---|---|
| `gen_random_uuid`, `uuid-ossp`, `pgcrypto` | nein |
| `pg_trgm`, `citext`, `unaccent` | nein |
| `postgis`, `vector`, `hstore`, `ltree` | nein |
| `CREATE EXTENSION` überhaupt | **kein einziges Vorkommen** |

Euer Schema ist reines Standard-Postgres. UUIDs werden node-seitig über
`crypto.randomUUID()` erzeugt, nicht in der Datenbank.

> **Ein Rest bleibt:** Das Basis-Schema stammt nicht aus den Migrationen, sondern
> wurde von Hand in Supabase angelegt. Theoretisch könnte dort eine Spalte einen
> Extension-Default tragen, den die Migrationen nicht zeigen. Abschnitt 5 des
> Inventar-Skripts beantwortet das endgültig — das ist ohnehin der erste Schritt.

### Was du im Angebotsgespräch klären solltest

Nach Wichtigkeit sortiert:

1. **Preisliste oberhalb b2-4.** Für die Szenarien B–D brauche ich die Stufen mit
   8, 16, 32 und 64 GB RAM. Öffentlich ist nur der Einstieg dokumentiert.
2. **Was kostet Hochverfügbarkeit?** Faktor 2 oder Faktor 3 gegenüber einem
   einzelnen Knoten — das entscheidet Szenario B mit.
3. **Verbindung von außen.** Erreichbar über einen öffentlichen Endpunkt mit TLS,
   oder nur aus dem eigenen Netz? Bestimmt, ob Anwendung und Datenbank zwingend
   bei plusserver zusammenliegen müssen.
4. **Extensions-Liste.** Auch wenn ihr aktuell keine braucht — für später
   relevant, etwa `pg_trgm` für bessere Volltextsuche.
5. **Point-in-Time-Recovery.** Dokumentiert sind tägliche Backups mit 7 Tagen
   Aufbewahrung. Für eine Anwendung, die Rechnungen führt, ist PITR die
   interessantere Größe — gibt es das, und bis zu welcher Granularität?
6. **Verbindungs-Pooler.** Ist PgBouncer o. ä. inklusive, oder müsst ihr das
   selbst betreiben? Ab Szenario C nicht mehr optional.
7. **Kubernetes-Kosten (PSKE).** Falls ihr den gesamten Stack dorthin verlagert:
   Was kostet der Cluster zusätzlich zur Datenbank?
8. **Migrationsunterstützung.** Manche Anbieter helfen beim Erstimport — bei
   einem Dump dieser Größe ist das in einer Stunde erledigt, aber fragen kostet
   nichts.

### Empfehlung

**Datenbank bei plusserver ist eine gute Wahl.** Deutsche Rechenzentren, aktuelle
Postgres-Versionen, HA und Read-Replicas verfügbar, pay-as-you-go ohne
Mindestlaufzeit — und für euren Bedarf reicht auf Jahre die kleinste Stufe.

**Ob auch die Anwendung dorthin sollte, ist die eigentliche Frage** — und sie ist
keine Kostenfrage, sondern eine Frage eurer Betriebskapazität. Der Scalingo-Test
hat gerade gezeigt, wie viel Reibung schon ein Plattformwechsel erzeugt;
Kubernetes ist noch einmal eine andere Größenordnung.

Mein Vorschlag: **erst die Datenbank umziehen, Anwendung vorerst bei Scalingo
lassen.** Damit ist der Supabase-Ausstieg erledigt (und der kompromittierte
Service-Key endgültig entwertet), ihr sammelt Erfahrung mit plusserver, und die
Latenz ist bei der aktuellen Größe unkritisch. Der Umzug der Anwendung bleibt
danach jederzeit möglich — und ist dann eine Entscheidung mit Betriebserfahrung
statt auf Verdacht.
