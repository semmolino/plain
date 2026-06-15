# Lizenzierung für PlaIn — Architektur & Konzept

> **Status (2026-06-15):** Beschlossen. Phase **L0 (Foundation, ohne Enforcement)** wird auf
> Branch `feature/license-tiers` umgesetzt. Dieses Dokument ist die maßgebliche
> Beschreibung der Architektur. Der **Funktionskatalog** wird nicht hier von Hand
> gepflegt, sondern aus dem Code-Manifest generiert → siehe
> [LICENSE_CAPABILITIES.md](LICENSE_CAPABILITIES.md) (auto-generiert).
> Der Entwickler-Workflow steht in [LICENSE_DEVELOPMENT_CHECKLIST.md](LICENSE_DEVELOPMENT_CHECKLIST.md).

PlaIn bekommt zusätzlich zum bestehenden **RBAC** (siehe Migration `0062`,
`docs/RBAC_DEVELOPMENT_CHECKLIST.md`) ein **Lizenz-Layer**. Beide Ebenen sind
orthogonal und greifen klar definiert ineinander.

---

## 1. Leitprinzipien

1. **RBAC = WAS darf ein _User_**, **Lizenz = OB der _Tenant_ es überhaupt nutzen kann.** Orthogonal.
2. **Lizenz ist tenantweit.** Der Tenant kauft, alle User profitieren.
3. **Soft-Lock statt Hard-Lock.** Downgrade löscht nie Daten — Features werden deaktiviert, Neuanlage gesperrt, Lesezugriff bleibt.
4. **Server ist die Wahrheit.** Frontend-Gating ist nur UX; durchgesetzt wird ausschließlich serverseitig.
5. **Quelle der Wahrheit getrennt nach Änderungsrhythmus:**
   - **Capabilities (was das Produkt kann)** → **Code-Manifest** (versioniert, reviewbar, drift-geprüft).
   - **Packaging (was in welchem Plan steckt) + Preise** → **DB** (über das Owner-Tool änderbar, **ohne Deploy**).
   - **Tenant ↔ Plan-Zuordnung** → **DB** (später von Stripe getrieben).
6. **Bezahlmodell-agnostisch.** Funktioniert für monatlich / jährlich / per-Seat / Flatrate / Add-Ons.
7. **Fail-safe, nicht fail-open.** Bei nicht auflösbarem Entitlement wird auf das _zuletzt bekannte / sichere_ Niveau zurückgefallen — nie still alles freigeschaltet.

---

## 2. Begriffe

| Begriff | Bedeutung |
|---|---|
| **Module** | Oberkategorie für die UI-Gruppierung (z. B. „Rechnungen", „E-Rechnung"). Nur Gruppierung. |
| **Capability** | Feingranulare, lizenzierbare Fähigkeit (z. B. `einvoice.peppol`, `reports.advanced`). **Einzige Enforcement-Granularität.** `boolean` oder `metered` (mit Zahl-Limit). |
| **Plan** (Stufe/Tier) | Vermarktbares Paket (`free`, `basic`, `pro`, `enterprise`, `full`). Bündel von Capabilities. |
| **Entitlement** | Die effektiv freigeschalteten Capabilities eines Tenants. |
| **Override** | Per-Tenant-Ausnahme (`grant`/`revoke`) für Sonderdeals/Add-Ons. |
| **Permission** | Bestehendes RBAC-Recht (`modul.aktion`). Eine Capability _gated_ ggf. mehrere Permissions. |

---

## 3. Wie RBAC und Lizenz ineinandergreifen

Die Capability-Ebene wirkt **vor** der RBAC-Ebene: nicht lizenzierte Capabilities
entfernen die zugehörigen Permissions aus dem effektiven Set des Users.

```
effektiveCapabilities(tenant) =
    Plan-Capabilities
  ∪ Override(grant)
  − Override(revoke)

effektivePermissions(user) =
    RollenPermissions(user)
  ∩ { p | p wird von einer lizenzierten Capability freigeschaltet
          ODER p hängt an keiner Capability (immer erlaubt) }

darfTun(user, perm)      = perm ∈ effektivePermissions(user)
darfNutzen(tenant, cap)  = cap  ∈ effektiveCapabilities(tenant)
```

Beispiel: User hat Rolle mit `invoices.create_credit`, Tenant-Plan enthält aber
nicht die Capability `invoices.credit` → der Tab „Gutschrift" verschwindet **und**
das Backend antwortet `402 Payment Required`. Die Verknüpfung
Capability→Permission(s) liegt in `CAPABILITY_PERMISSION`.

> Ungemappte Permissions (keiner Capability zugeordnet) bleiben immer durch RBAC steuerbar.
> So bricht das Hinzufügen des Lizenz-Layers kein bestehendes Recht.

---

## 4. Datenmodell (Migration `0070`)

```sql
LICENSE_MODULE (KEY pk, LABEL_DE, POSITION)
LICENSE_CAPABILITY (KEY pk, MODULE_KEY→LICENSE_MODULE, LABEL_DE,
                    TYPE 'boolean'|'metered', UNIT, POSITION)
LICENSE_PLAN (ID pk, KEY unique, NAME_DE, DESCRIPTION_DE, POSITION,
              IS_ACTIVE, PRICE_MONTHLY, PRICE_YEARLY, VERSION)
PLAN_CAPABILITY (PLAN_ID→LICENSE_PLAN, CAPABILITY_KEY→LICENSE_CAPABILITY,
                 NUMERIC_LIMIT, pk(PLAN_ID,CAPABILITY_KEY))   -- die Matrix
CAPABILITY_PERMISSION (CAPABILITY_KEY→LICENSE_CAPABILITY,
                       PERMISSION_KEY→PERMISSION, pk(beide))   -- Layer-Verknüpfung
TENANT_LICENSE (TENANT_ID pk, PLAN_ID, PLAN_VERSION, STATE,
                STARTS_AT, VALID_UNTIL, TRIAL_UNTIL, GRACE_UNTIL,
                EXTERNAL_REF, UPDATED_AT)
TENANT_ENTITLEMENT_OVERRIDE (ID pk, TENANT_ID, CAPABILITY_KEY,
                MODE 'grant'|'revoke', NUMERIC_LIMIT, REASON,
                EXPIRES_AT, CREATED_AT, CREATED_BY)            -- Add-Ons/Sonderdeals
LICENSE_CHANGE_LOG (ID pk, ACTOR, ENTITY, ENTITY_REF, ACTION,
                BEFORE jsonb, AFTER jsonb, AT)                 -- Audit Control-Plane
PLATFORM_ADMIN (ID pk, EMAIL unique, PASSWORD_HASH, TOTP_SECRET,
                IS_ACTIVE, LAST_LOGIN_AT, CREATED_AT)          -- Owner-Konsole (L1)
```

**Quelle-der-Wahrheit-Regel:**
`LICENSE_MODULE`, `LICENSE_CAPABILITY`, `CAPABILITY_PERMISSION` sind **Spiegel des
Code-Manifests** und werden aus diesem generiert (Seed `0070b`, Sync-Tooling). Im
Owner-Tool sind sie **read-only**. Editierbar sind nur `LICENSE_PLAN`,
`PLAN_CAPABILITY`, `TENANT_*`.

**Plan-Versionierung:** Ein Plan ist ein Snapshot. Ändert man „Pro", gilt das **ab
jetzt**; bestehende Abonnenten sind über `TENANT_LICENSE.PLAN_VERSION` gepinnt
(Grandfathering). So ändert eine Packaging-Anpassung nie still den Umfang
zahlender Kunden.

---

## 5. Capability-Manifest + Drift-Check (der „Zwischen-Layer")

**Manifest:** `backend/licensing/capabilities.manifest.js` — einzige Quelle der
Wahrheit für Module + Capabilities + deren `permissions`-Verknüpfung. Versioniert,
im Review, drift-geprüft.

**Drift-Check** (`backend/licensing/driftCheck.js`, als Jest-Test in CI + CLI
`npm run license:check`) meldet:

1. **Undeklariert** — Code nutzt `requireFeature('x')` / `<HasFeature feature="x">`, aber `x` fehlt im Manifest → **Fehler (CI rot)**.
2. **Unbekannte Permission** — eine Capability referenziert eine Permission, die nicht im Katalog (`0062`/`0063`) existiert → **Fehler**.
3. **Nicht paketiert** — Capability im Manifest, aber keinem Plan zugeordnet → **Inbox** im Owner-Tool (= „neue Funktion dazugekommen"-Signal; du entscheidest die Zuordnung).
4. **Verwaist/tot** — Capability im Manifest, aber im Code nie als Gate referenziert → **Warnung** (erst aktiv, sobald Enforcement existiert).

**Generatoren** (`npm run license:gen`):
- `backend/licensing/generateSeedSql.js` → `backend/migrations/0070b_license_capabilities_seed.sql` (Module/Capabilities/Permission-Links/Full-Plan).
- `backend/licensing/generateDocs.js` → `docs/LICENSE_CAPABILITIES.md` (generierter Katalog).

So gibt es **keine** Doppelpflege: Manifest ändern → `license:gen` → Seed + Doku sind aktuell, Drift-Check bewacht den Rest.

---

## 6. Owner-Tool / Control-Plane (separate Konsole — beschlossen)

Eine **eigenständige Admin-Konsole**, strikt von der Tenant-App getrennt:

- **Eigene Identität** `PLATFORM_ADMIN` (kein Tenant-`EMPLOYEE` mit Extra-Rechten — vermeidet Privileg-Vermischung), eigene JWT-Audience, **2FA (TOTP) Pflicht**, kurze Session, optional IP-Allowlist.
- **Eigener Deploy/Domain** (z. B. `console.…`), greift auf dieselbe Supabase zu.
- **Funktionen:**
  - Matrix **Plan × Capability** (Häkchen-Grid; Modul-Häkchen = alle Capabilities des Moduls) → schreibt `PLAN_CAPABILITY`.
  - **Pläne anlegen/bearbeiten** (`LICENSE_PLAN`) — ohne Deploy.
  - **Per-Tenant-Overrides & Add-Ons** (`TENANT_ENTITLEMENT_OVERRIDE`).
  - **Tenant-Lizenz-Übersicht** (Plan, State, Trial/Grace).
  - **Inbox** ungemappter Capabilities (aus Drift-Check).
  - **Audit-Log** (`LICENSE_CHANGE_LOG`), idealerweise append-only + Rollback.
- **Capabilities sind read-only** (kommen aus dem Manifest) — keine Phantom-Features.

---

## 7. Laufzeit-Enforcement (Phasen L2–L3)

**Backend** — zusätzliche Middleware nach auth + permissions:

```js
app.use("/api/v1/...", authMiddleware, permissionsMiddleware, licenseMiddleware, routes);
```

`licenseMiddleware` lädt das Tenant-Entitlement **server-seitig pro Request**
(kurzer TTL-Cache ~60s, **Bump-on-Change** bei Plan-/Override-Mutation — **nicht**
ins langlebige JWT backen, sonst stale nach Up-/Downgrade) und setzt
`req.license = { plan, capabilities:Set, limits:Map, state }` + `req.hasFeature(key)`.

Route-Guard analog zu `requirePermission`:

```js
router.post("/:id/einvoice/peppol",
  requirePermission("invoices.download_xml"),
  requireFeature("einvoice.peppol"),
  handler);
```

`requireFeature` → bei fehlender Capability `402 Payment Required`:

```json
{ "error": "Feature nicht in deiner Lizenz enthalten",
  "feature": "einvoice.peppol", "current_plan": "basic",
  "upgrade_to": "pro", "upgrade_url": "/einstellungen/lizenz" }
```

**Metered Limits** (z. B. `limits.projects_active`) werden bei Mutationen geprüft
(`POST /projekte` → unter Limit?). `NULL` = unbegrenzt.

**Fail-safe:** Kann das Entitlement nicht geladen werden → letztes bekanntes
gecachtes Entitlement; sonst sicheres Minimum des Tenant-Plans — **nie** voll offen,
**nie** komplett zu (würde zahlende Kunden im Outage aussperren).

**Frontend** — `licenseStore` (Zustand, analog `permissionsStore`):

```ts
useFeature('einvoice.peppol')   // boolean
useLimit('limits.projects_active') // { current, max, exceeded }
<HasFeature feature="hoai.calculator" fallback={<UpgradeHint/>}>…</HasFeature>
```

Kombiniert mit RBAC: `<Can permission="…"><HasFeature feature="…">…</HasFeature></Can>`.

---

## 8. Lizenz-Zustände (State Machine)

`TENANT_LICENSE.STATE`:

```
trial ──(Kauf)──► active ──(Zahlung überfällig)──► past_due ──► grace ──► expired
  │                  ▲                                                      │
  └──(Trial-Ende)────┘◄──────────────────(Reaktivierung)──────────────────┘
```

| State | Zugriff |
|---|---|
| `trial` | voller Plan-Umfang bis `TRIAL_UNTIL` |
| `active` | voller Plan-Umfang |
| `past_due` | voll, aber Banner + Zahlungsaufforderung |
| `grace` | voll bis `GRACE_UNTIL` (letzte Frist) |
| `expired` | auf Free/Minimum zurück, Daten bleiben (Soft-Lock) |

---

## 9. Beispiel-Pläne & Packaging

> Konkrete Aufteilung = **kommerzielle Entscheidung im Owner-Tool**, nicht im Code.
> Das hier ist der Startvorschlag. (Generierter Capability-Katalog:
> [LICENSE_CAPABILITIES.md](LICENSE_CAPABILITIES.md).)

| Plan | Zielgruppe | Preis (Beispiel) |
|---|---|---|
| **Free** | Solo, Testphase | 0 € |
| **Basic** | 1–5 MA, Standardabläufe | ~29 €/Monat |
| **Pro** | 5–25 MA, volle Abwicklung | ~99 €/Monat |
| **Enterprise** | 25+ MA, individuell, SLA | individuell |
| **Full** | _interner Start-Plan_ — alle Capabilities; alle Bestands-Tenants in L0 hierauf | — |

**Bezahlmodelle** (agnostisch): per Plan (Flatrate), per Seat, Mischmodell, Add-Ons.
Empfehlung: **Plan + Seat-basiert mit Mengenrabatt**.

---

## 10. Rollout-Phasen

| Phase | Inhalt | Verhaltensänderung |
|---|---|---|
| **L0** | Manifest + DB-Tabellen (`0070`/`0070b`) + Drift-Check (CI) + generierte Doku; alle Tenants auf `full` | **keine** |
| **L1** | Owner-Konsole: Matrix, Pläne, Overrides, Inbox, Audit | keine (nur Admin-seitig) |
| **L2** | `licenseMiddleware` lädt Entitlement; Frontend Soft-Gating (`HasFeature`, UpgradeHints) | nur UI |
| **L3** | Backend Hard-Enforcement (`requireFeature` 402, metered Limits), Fail-safe, Capability→Permission-Filter aktiv | **hart** |
| **L4** | Stripe → Subscription→Entitlement, Grace/Dunning, Self-Service Up-/Downgrade | Billing |

Risiko wird **zuletzt** eingeführt und ist bis L3 voll reversibel.

---

## 11. Sicherheit (Pflicht, weil Lizenz = Geld)

- Enforcement **nur serverseitig**; Frontend = UX.
- Control-Plane physisch/logisch isoliert (eigene Identität, 2FA, Audit, append-only History, Rollback).
- Entitlement nicht ins langlebige JWT — TTL-Cache + Bump-on-Change.
- Fail-safe-Richtung dokumentiert (§7).
- Idempotente Stripe-Webhooks (L4); Entitlement wird aus Subscription _abgeleitet_, nie ad-hoc gesetzt.
- **Vor erstem echten Verkauf** die in `CLAUDE.md` gelisteten offenen Lücken schließen: JWT-Secret-Fallback, offenes CORS, fehlendes Rate-Limiting.

---

## 12. Automatisierung & Pflege

- **Deterministischer Kern in CI:** Drift-Check als Jest-Test (läuft bei jedem Push/PR auf `main`) + `npm run license:check`.
- **Cowork/geplante Tasks obendrauf** (sobald L0 steht): unzugeordnete Capabilities erklären + Paket-Vorschlag posten, Doku regenerieren, Issue/PR öffnen. Einrichtbar via `/schedule`.

---

## 13. Offene kommerzielle Fragen (nicht-technisch)

1. Konkrete Capability→Plan-Verteilung (im Owner-Tool, nicht im Code).
2. Preise (wettbewerbsabhängig).
3. Probemonat: Länge, welcher Plan.
4. Downgrade-Strenge (sofort vs. Grace).
5. Metered Limits via Stripe-Metering oder eigene Logik.

---

## 14. Nicht Teil dieses Konzepts

DSGVO/Datenexport bei Tenant-Löschung · Geo-Pricing/Mehrwährung · Discount-Coupons
(Stripe-seitig) · Multi-Tenant-pro-User.
