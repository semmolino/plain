# PlaIn — Owner-Konsole (Lizenz-Control-Plane)

Eigenständige Admin-App zur Verwaltung des Lizenz-Layers. **Strikt getrennt von
der Tenant-App** (eigene Auth, eigenes Secret, eigener Deploy). „God Mode" —
nur für den Plattformbetreiber.

> Architektur & Phasen: [`../docs/LICENSE_TIERS_CONCEPT.md`](../docs/LICENSE_TIERS_CONCEPT.md)
> Status: **L1-Foundation** — Backend-API steht; React-UI (Matrix-Grid) folgt.

## Was sie kann (Stand jetzt — API)

| Methode | Pfad | Zweck |
|---|---|---|
| POST | `/api/console/auth/login` | Login (Passwort + TOTP-2FA) |
| GET | `/api/console/auth/me` | Aktueller Admin |
| GET | `/api/console/capabilities` | Capability-Katalog (aus Code-Manifest) |
| GET | `/api/console/plans` | Pläne inkl. zugeordneter Capabilities |
| GET | `/api/console/matrix` | Plan × Capability als Grid (+ Limits) |
| GET | `/api/console/inbox` | Capabilities ohne Plan-Zuordnung |
| POST | `/api/console/plans` | Plan anlegen |
| PATCH | `/api/console/plans/:id` | Plan bearbeiten |
| PUT | `/api/console/plans/:id/capabilities/:capKey` | Matrix-Zelle setzen/entfernen |
| GET | `/api/console/tenants` | Tenant-Lizenzen |
| POST | `/api/console/tenants/:id/overrides` | Per-Tenant Add-On / Sonderdeal |

Alle mutierenden Aktionen werden in `LICENSE_CHANGE_LOG` auditiert.
Capabilities sind **read-only** (Quelle = Code-Manifest der Hauptanwendung).

## Sicherheit

- Eigene Identität `PLATFORM_ADMIN` (kein Tenant-`EMPLOYEE`).
- Eigenes `CONSOLE_JWT_SECRET`, eigene JWT-Audience (`owner-console`).
- **TOTP-2FA** Pflicht, sobald ein Secret hinterlegt ist.
- helmet, CORS-Allowlist, Rate-Limit auf Login, `trust proxy`.

## Woher die Konsole ihre Daten liest

Die Anwendung spricht ihre Datenbank seit dem Umzug nach Scalingo über
PostgREST an, und PostgREST lauscht im Container **nur auf `127.0.0.1`** — von
außen gibt es dorthin keinen Weg. Die Konsole läuft aber auf dem Arbeitsplatz.
Sie bekommt deshalb ihr **eigenes PostgREST**, das durch einen SSH-Tunnel auf
dieselbe Datenbank zeigt:

```
node scripts/start.js
  ├─ scalingo db-tunnel   →  127.0.0.1:10000   (Scalingo-PostgreSQL)
  ├─ PostgREST (lokal)    →  127.0.0.1:3011    (JWT-Geheimnis je Start neu)
  └─ node server.js       →  localhost:4000
```

Die Konsole trägt dabei den `sys`-Claim — sie arbeitet per Definition
mandantenübergreifend und ist neben dem Signup und den Hintergrund-Checkern der
dritte Träger dieses Claims (`backend/scripts/migration/05_rls_scalingo.sql`).

**Deshalb wird sie mit `npm start` gestartet und nicht mehr mit
`node server.js`.** Ohne `POSTGREST_URL` bricht sie ab, statt auf den alten
Supabase-Zugang zurückzufallen: genau dieser stille Rückfall hat dazu geführt,
dass die Konsole nach dem Umzug monatelang den Datenstand einer abgehängten
Datenbank anzeigte — sichtbar wurde es erst, als die Lizenz-Inbox den heutigen
Code gegen ein Schema von vor den Umbenennungen hielt und 37 Befunde meldete,
die es nicht gab. Welche Datenbank gerade dahintersteckt, steht jetzt im
Startprotokoll, unter `/health` und in der Kopfzeile der Oberfläche.

`SUPABASE_URL` / `SUPABASE_SERVICE_KEY` werden **nicht mehr benutzt** und
können aus der `.env` verschwinden.

## Setup

```bash
cd owner-console
cp .env.example .env        # ausfüllen (eigenes CONSOLE_JWT_SECRET!)
npm install
npm run postgrest           # holt bin/postgrest.exe + libpq (einmalig)

npm start                   # Tunnel + PostgREST + Konsole, Port aus CONSOLE_PORT
curl localhost:4000/health  # zeigt auch, an welcher Datenbank sie hängt

# Admin anlegen — braucht den laufenden Stapel, also in einem ZWEITEN Fenster:
npm run create-admin -- admin@example.com "ein-langes-passwort"
#  -> otpauth-URL/Secret in Authenticator-App eintragen
```

**Voraussetzungen** (einmalig, alles andere holt sich `npm start` selbst):

| | |
|---|---|
| Scalingo-CLI, angemeldet | `scalingo login` — der Ordner muss **nicht** im PATH liegen: gesucht wird auch in `~/bin` und `~/.local/bin`, sonst `SCALINGO_CLI` setzen |
| SSH-Schlüssel, bei Scalingo hinterlegt | `ssh-keygen -t ed25519` + `scalingo keys-add arbeitsplatz ~/.ssh/id_ed25519.pub` |
| `libpq` für Windows | wird aus einer vorhandenen PostgreSQL-/TablePlus-/pgAdmin-Installation kopiert; sonst `winget install PostgreSQL.PostgreSQL` oder `PGRST_LIBPQ_DIR` setzen |

Der Scalingo-Client sucht seinen Schlüssel sonst nur unter `~/.ssh/id_rsa` und
meldet bei einem ed25519-Schlüssel daneben „fail to read SSH private key" —
`scripts/start.js` sucht deshalb selbst und übergibt ihn mit `--identity`.

Stellschrauben (alle optional, in der `.env`): `SCALINGO_APP` (Standard
`planandsimple`), `SCALINGO_CLI`, `SCALINGO_SSH_IDENTITY`,
`KONSOLE_TUNNEL_PORT`, `KONSOLE_PGRST_PORT`, `KONSOLE_BROWSER=aus`,
`PGRST_LIBPQ_DIR`.

> **Warum das Startskript so viel selbst sucht.** Die Git-Bash bringt Dinge
> mit, die in der Eingabeaufforderung fehlen: sie hängt `~/bin` an den PATH
> (dort liegt `scalingo.exe`) und `mingw64/bin` (dort liegt zufällig
> `libwinpthread-1.dll`, die `libintl` braucht). Beides ließ den Start im
> Entwickler-Terminal funktionieren und beim Doppelklick auf
> `start-konsole.cmd` scheitern — einmal mit „nicht angemeldet", einmal mit
> Exitcode `0xC0000135` und sonst nichts. Deshalb sucht `scripts/start.js`
> CLI und SSH-Schlüssel selbst, und `npm run postgrest` prüft das Binary
> bewusst mit dem **kleinstmöglichen PATH**: was dort startet, startet
> überall.

## Web-UI (`owner-console/web/`)

React/Vite/TS-App für die Konsole. Dev-Server proxyt `/api/console` → `:4000`.

```bash
cd owner-console/web
npm install
npm run dev          # http://localhost:4173  (Backend muss auf :4000 laufen)
```

Enthalten:
- **Login** mit 2FA-Feld (erscheint, sobald das Backend `totp_required` meldet)
- **Matrix** (Plan × Capability, Häkchen + Limit-Felder für metered; speichert je Zelle, auditiert)
- **Inbox** der nicht paketierten Capabilities

Noch offen (Folge-Iteration): Plan anlegen/bearbeiten-UI, Tenant-Overrides-UI, Audit-Log-Ansicht.

## Nächster Schritt

**L2** in der Hauptanwendung: Entitlement-Laufzeit (`licenseMiddleware`) + Frontend Soft-Gating (`HasFeature`, Upgrade-Hinweise) — siehe `../docs/LICENSE_TIERS_CONCEPT.md`.
