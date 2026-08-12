# Migration Supabase → Scalingo

Stand: 2026-08-06 · Zielarchitektur beschlossen · noch nicht begonnen

---

## Zielbild

```
                    ┌──────────────────────────────┐
   Browser ────────▶│  plan&simple (Node/Express)  │   Scalingo-App #1
                    │  + SPA aus frontend-react    │   Buildpack: apt + nodejs
                    └──────────────┬───────────────┘
                                   │ @supabase/supabase-js  (unveraendert!)
                                   │ JWT pro Request: { role, tenant_id }
                                   ▼
                    ┌──────────────────────────────┐
                    │          PostgREST           │   Scalingo-App #2
                    └──────────────┬───────────────┘
                                   │ SET ROLE plain_app
                                   ▼
                    ┌──────────────────────────────┐
                    │   PostgreSQL + RLS aktiv     │   Scalingo-Addon
                    └──────────────────────────────┘

   Dateien ────────▶ S3-kompatibler Objektspeicher (extern, kein Scalingo-Addon)
```

**Der Kerngedanke:** `supabase-js` ist nur ein HTTP-Client für PostgREST. Betreiben
wir PostgREST selbst, bleiben alle **750 Aufrufstellen in 118 Dateien** unverändert.
Der Umzug wird dadurch ein Infrastruktur-Projekt statt einer Neuschreibung.

**Der Nebeneffekt, der den Ausschlag gibt:** Weil PostgREST pro Request ein JWT
mitbringt, werden die 26 vorhandenen RLS-Policies zum ersten Mal wirksam. Die
Mandantentrennung wandert von der Anwendung in die Datenbank — und die gesamte
Cross-Tenant-Fehlerklasse aus dem Pentest vom 06.08.2026 verschwindet strukturell,
statt an 43 Stellen einzeln nachgezogen zu werden.

---

## Ausgangslage — drei Dinge, die den Plan bestimmen

**1. Das Schema existiert nur in Supabase.**
18 der 19 Kerntabellen (`COMPANY`, `EMPLOYEE`, `ADDRESS`, `CONTRACT`, `INVOICE`,
`OFFER`, `TEC`, `ASSET`, …) haben kein `CREATE TABLE` im Repository. Die 119
Migrationen sind Deltas auf einem 2025 von Hand angelegten Fundament. Der
Ausgangspunkt ist deshalb ein `pg_dump` der laufenden Datenbank — nicht das Repo.

**2. Scalingo kennt keine Dockerfiles.**
Deployment läuft ausschließlich über Buildpacks. Das vorhandene `Dockerfile`
wird dort nicht verwendet. Konkret fehlen: ein `package.json` im Root (sonst
erkennt Scalingo Node.js nicht), ein `Procfile`, und ein Ersatz für die
`apt-get`-Zeile, die Chromium für die PDF-Erzeugung vorbereitet.

**3. Das Dateisystem ist flüchtig — ohne Ausnahme.**
Scalingo bietet kein persistentes Volume. `backend/uploads/` ist nach jedem
Neustart leer. Was im Pentest noch ein Risiko war, ist hier ein harter Blocker:
Ohne Objektspeicher ist die Anwendung auf Scalingo nicht betriebsfähig.

---

## Phasen

### Phase 0 — Bestandsaufnahme (vor allem anderen)

Ohne diesen Schritt plant man ins Blaue, weil niemand das vollständige Schema kennt.

```
backend/scripts/migration/01_inventory.sql   → im Supabase SQL Editor ausführen
```

Liefert: alle Tabellen mit Zeilenzahl, welche eine `TENANT_ID` haben, den
Fremdschlüssel-Graph, Views/Funktionen/Trigger/Sequenzen, installierte
Extensions, den RLS-Status und eine Mandantenübersicht.

**Ergebnis sichern.** Abschnitt 2 (Tabellen ohne `TENANT_ID`) und Abschnitt 5
(Extensions) werden in Phase 2 und 3 gebraucht.

**Die eine Frage, die Abschnitt 5 beantworten muss:** Nutzt die Datenbank
Extensions außerhalb der Standardliste? Scalingo unterstützt PostGIS,
TimescaleDB, pgvector und Anonymizer — alles darüber hinaus lässt den Restore
scheitern und muss vorher geklärt werden.

---

### Phase 1 — Scalingo einrichten

```bash
# CLI installieren (Windows: Git-Bash wird von Scalingo empfohlen)
scalingo login

# App + Datenbank
scalingo create plain-app
scalingo --app plain-app addons-plans postgresql        # Plaene auflisten
scalingo --app plain-app addons-add postgresql <plan-id>

# Verbindung von lokal
scalingo --app plain-app db-tunnel SCALINGO_POSTGRESQL_URL
# -> erreichbar unter 127.0.0.1:10000
```

Die Zugangsdaten stehen in der App-Variable `SCALINGO_POSTGRESQL_URL`.
PostgreSQL-Versionen 14–17 stehen zur Wahl, Standard ist 17.

> **Versionshinweis:** Supabase läuft auf 15. Ein Dump von 15 lässt sich in 17
> einspielen, umgekehrt nicht. Beim Anlegen also **nicht** unter die Quellversion
> gehen. `pg_dump` sollte mindestens so neu sein wie die Quelldatenbank.

---

### Phase 2 — Schema und Daten übernehmen

```bash
export SRC="postgresql://postgres:PASS@db.<ref>.supabase.co:5432/postgres"
cd backend/scripts/migration
./02_export.sh 1 4 7        # die Mandanten-IDs, die mitkommen sollen
```

Das Skript zieht das Schema in zwei Abschnitten (`pre-data` = Tabellen,
`post-data` = Constraints/Indizes) und die Daten mandantengefiltert als CSV.

**Warum die Aufteilung:** Die Daten werden geladen, solange es noch keine
Fremdschlüssel gibt. Damit spielt die Ladereihenfolge der Tabellen keine Rolle
und es braucht keine Superuser-Rechte auf der Zielseite — beides Fallstricke,
an denen Teilmengen-Migrationen üblicherweise scheitern.

**Zwei Handgriffe vor dem Import, die nicht automatisierbar sind:**

1. **`export/tabellen_global.txt` durchsehen.** Darin stehen alle Tabellen ohne
   `TENANT_ID` — vermischt: echte Stammdaten (`VAT`, `BILLING_TYPE`,
   `PERMISSION`, `LICENSE_PLAN`) gehören vollständig mit, Logs
   (`LANDING_EVENT`) will man nicht, und Kindtabellen wie `OFFER_STRUCTURE`
   hängen über einen Fremdschlüssel am Mandanten und müssten eigentlich
   gefiltert werden. Nur du kennst die fachliche Bedeutung.

2. **Supabase-Reste im Dump suchen:**
   ```bash
   grep -nE 'auth\.|storage\.|supabase|extensions\.|anon|service_role' export/01_schema_pre.sql
   ```
   Erwartbar sind Treffer bei `current_tenant_id()` (nutzt `auth.jwt()`) und in
   den RLS-Policies. Beides wird in Phase 3 ohnehin ersetzt.

Import gegen den Tunnel:

```bash
export DST="postgresql://USER:PASS@127.0.0.1:10000/DBNAME"
psql "$DST" -v ON_ERROR_STOP=1 -f export/01_schema_pre.sql
psql "$DST" -v ON_ERROR_STOP=1 -f export/02_load_data.sql
psql "$DST" -v ON_ERROR_STOP=1 -f export/03_schema_post.sql
psql "$DST" -v ON_ERROR_STOP=1 -f export/04_sequences.sql
```

`04_sequences.sql` ist der Schritt, den man gerne vergisst: ohne ihn stehen alle
Sequenzen auf 1 und der erste Datensatz kollidiert mit bestehenden IDs.

---

### Phase 3 — PostgREST davorstellen

**Hier liegt das einzige echte Umsetzungsrisiko des Plans.** PostgREST ist ein
Haskell-Binary; ohne Dockerfile-Support braucht es einen Binary- oder
APT-Buildpack, der es beim Build lädt. Der Weg ist gangbar, aber nicht
dokumentiert — das ist der Punkt, den ich als Erstes praktisch ausprobieren
würde, bevor der Rest geplant wird.

Falls es sich als zu sperrig erweist, gibt es zwei Rückfallebenen:
- PostgREST bei einem Anbieter mit Container-Unterstützung betreiben und per
  privater Verbindung anbinden
- doch auf direktes SQL wechseln (dann greift die verworfene Option B mit 750
  Aufrufstellen)

Konfiguration, sobald es läuft:

```
PGRST_DB_URI          = <SCALINGO_POSTGRESQL_URL>
PGRST_DB_SCHEMA       = public
PGRST_DB_ANON_ROLE    = plain_app
PGRST_JWT_SECRET      = <neues, langes Geheimnis>
PGRST_SERVER_PORT     = $PORT
```

Dann die Datenbankseite scharf schalten:

```
backend/scripts/migration/03_rls_postgrest.sql
```

Das Skript legt die Rollen an (`plain_app`, `plain_system`, `authenticator`),
stellt `current_tenant_id()` von `auth.jwt()` auf
`current_setting('request.jwt.claims')` um, aktiviert RLS auf allen Tabellen mit
`TENANT_ID` und enthält vier Nachweise, dass es wirkt — inklusive des wichtigsten:
ohne Claim liefert die Datenbank **keine** Zeilen.

---

### Phase 4 — Anwendung anpassen

Der Anwendungscode ändert sich an überraschend wenigen Stellen:

| Was | Wo | Umfang |
|---|---|---|
| `SUPABASE_URL` → PostgREST-URL | Railway-/Scalingo-Variablen | trivial |
| Service-Key → JWT pro Request | `server.js:51-54` | **der Kern** |
| `supabase.auth.admin.createUser` entfernen | `routes/auth.js:428-453`, `demo/createDemoTenant.js` | klein |
| ~~Uploads auf S3 umstellen~~ | **erledigt 12.08.** — Adapter `services/objectStorage.js`, alle 9 Stellen umgestellt, Anbieter Impossible Cloud. Siehe [OBJECT_STORAGE.md](OBJECT_STORAGE.md) | ~~mittel~~ |
| `package.json` im Root + `Procfile` | neu | klein |
| `Aptfile` für Chromium-Bibliotheken | neu | mittel, fehleranfällig |

**Der Kern in Phase 4** ist der Wechsel vom global geteilten Client
(`server.js:51-54`) auf eine Fabrik, die pro Request einen Client mit einem
frisch signierten JWT liefert:

```js
// Skizze — gehoert in eine eigene Datei, z.B. backend/db.js
function clientFor(req) {
  const token = jwt.sign(
    { role: 'plain_app', tenant_id: req.tenantId },
    process.env.PGRST_JWT_SECRET,
    { expiresIn: '5m' }
  )
  return createClient(process.env.POSTGREST_URL, token, {
    global: { headers: { Authorization: `Bearer ${token}` } }
  })
}
```

Die wenigen mandantenübergreifenden Vorgänge bekommen `role: 'plain_system'`:
der Signup (legt einen neuen Mandanten an), die sechs Hintergrund-Checker und
die Owner-Konsole. **Diese Liste kurz zu halten ist die eigentliche
Sicherheitsarbeit** — jede Erweiterung schwächt die Trennung wieder auf.

---

### Phase 5 — Deployment umstellen

```bash
scalingo integrations-add github
scalingo --app plain-app integration-link-create --auto-deploy --branch main <repo-url>
```

Vorher im Repository anlegen:

- **`package.json` im Root** — ohne das erkennt Scalingo Node.js nicht.
  Sinnvoll: `engines.node` festnageln und einen `postinstall`, der Frontend-Build
  und `playwright install chromium` auslöst.
- **`Procfile`** — `web: node backend/server.js`
- **`Aptfile`** — die Bibliotheksliste aus dem heutigen `Dockerfile`
  (`libnss3`, `libatk1.0-0`, `libgbm1`, … ), gelesen vom APT-Buildpack
- **`.buildpacks`** — apt- und nodejs-Buildpack in dieser Reihenfolge

Das `Dockerfile` bleibt bestehen, solange Railway parallel läuft.

---

## Was bewusst NICHT mitwandert

| | Begründung |
|---|---|
| Supabase Auth | Wird nur beim Signup aufgerufen; der Login läuft über `EMPLOYEE.PASSWORD` + eigenes JWT. Ersatzlos streichbar. |
| Supabase Storage | Wird nirgends genutzt — Dateien liegen im Dateisystem. |
| Schemas `auth`, `storage`, `graphql`, `realtime`, `vault` | Supabase-intern, für die Anwendung ohne Bedeutung. |
| Rollen `anon`, `authenticated`, `service_role` | Werden durch `plain_app` / `plain_system` ersetzt. |
| Policies aus Migration 0035 | Blockieren `anon`/`authenticated` — Rollen, die es nicht mehr gibt. |

---

## Offene Punkte

1. **PostgREST auf einem Buildpack** — als Erstes praktisch verifizieren. Davon
   hängt die Tragfähigkeit der gesamten Architektur ab.
2. **Welche Mandanten kommen mit?** IDs aus `01_inventory.sql`, Abschnitt 8.
3. ~~**Objektspeicher-Anbieter wählen.**~~ **Entschieden 12.08.: Impossible
   Cloud** (Hamburg, S3-kompatibel, kein US-Subprozessor). Adapter gebaut,
   Bestandsumzug offen — siehe [OBJECT_STORAGE.md](OBJECT_STORAGE.md).
   Ursprüngliche Notiz: Scalingo hat keinen eigenen; empfohlen
   werden Outscale OOS, S3, GCS, Azure Blob oder OVH. Für eine deutsche
   Kundschaft ist der Serverstandort ein Auswahlkriterium.
4. **Extensions gegenprüfen** (Inventar Abschnitt 5).
5. **Chromium unter Buildpack** — die PDF-Erzeugung ist geschäftskritisch und
   der fehleranfälligste Teil der Umstellung. Früh testen.
6. **Alte Supabase-Instanz.** Erst löschen, wenn alles läuft — aber dann
   wirklich. Solange sie existiert, ist der in der Git-Historie liegende
   Service-Key gültig (siehe Pentest-Bericht, Befund 0.1).

---

## Reihenfolge der Risiken

Nicht chronologisch, sondern nach „was kippt den Plan":

1. **PostgREST lässt sich nicht betreiben** → Architektur fällt, zurück auf Option B
2. **Chromium läuft nicht unter Buildpack** → PDF-Erzeugung fällt aus
3. **Extension fehlt bei Scalingo** → Schema-Restore scheitert
4. **RLS bricht Endpunkte** → jeder Endpunkt muss einmal durchgetestet werden
5. **Objektspeicher-Umstellung** → berührt vier Dateien, gut abgrenzbar

Punkt 1 und 2 sind an einem Nachmittag prüfbar und sollten vor jeder weiteren
Planung stehen.
