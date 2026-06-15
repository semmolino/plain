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

## Setup

```bash
cd owner-console
cp .env.example .env        # ausfüllen (eigenes CONSOLE_JWT_SECRET!)
npm install

# Voraussetzung: Migration 0070/0070b in Supabase eingespielt.
npm run create-admin -- admin@example.com "ein-langes-passwort"
#  -> otpauth-URL/Secret in Authenticator-App eintragen

npm start                    # Port aus CONSOLE_PORT (default 4000)
curl localhost:4000/health
```

## Nächster Schritt (L1-UI)

Kleine React/Vite-App (`owner-console/web/`) mit:
- Login (inkl. 2FA-Code-Feld)
- Matrix-Grid (Plan × Capability, Häkchen + Limit-Felder)
- Plan-Verwaltung, Inbox ungemappter Capabilities, Tenant-Overrides, Audit-Log

Danach: **L2** (Entitlement-Laufzeit + Frontend Soft-Gating) in der Hauptanwendung.
