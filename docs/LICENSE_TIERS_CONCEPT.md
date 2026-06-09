# Lizenz-Stufen für PlaIn — Konzept

> Status: **Konzeptphase**, noch nicht implementiert.
> Diese Notiz beschreibt eine pragmatische Architektur, mit der wir PlaIn
> zukünftig in unterschiedlichen Lizenz-Stufen anbieten können, ohne das
> existierende RBAC-System brechen zu müssen.

---

## Leitprinzipien

1. **RBAC steuert WAS jemand darf**, Lizenz steuert **OB der Tenant es überhaupt nutzen kann**. Beide Ebenen sind orthogonal.
2. **Lizenz ist tenantweit**, nicht userweit. Der Tenant kauft, alle User profitieren.
3. **Soft-Lock statt Hard-Lock**: bei Lizenz-Downgrade nicht Daten löschen, sondern Features deaktivieren und User informieren.
4. **Klare Mappings**: jedes Feature gehört zu genau einer Lizenz-Stufe.
5. **Bezahlmodell-agnostisch**: Konzept funktioniert für monatlich / jährlich / per-Seat / Flatrate.

---

## Vorgeschlagene Lizenz-Stufen

| Tier | Zielgruppe | Preis (Beispiel) |
|---|---|---|
| **Free** | Solo-Architekten, Testphase | 0 € |
| **Basic** | 1-5 Mitarbeiter, Standardabläufe | ~29 €/Monat/Tenant |
| **Pro** | 5-25 Mitarbeiter, vollständige Abwicklung | ~99 €/Monat/Tenant |
| **Enterprise** | 25+ Mitarbeiter, individuelle Anpassungen, SLA | individuell |

Konkrete Feature-Verteilung folgt unten.

---

## Daten-Modell

```sql
-- Stufen-Katalog (System-fest, nicht tenant-änderbar)
CREATE TABLE LICENSE_TIER (
  ID            SERIAL PRIMARY KEY,
  KEY           VARCHAR(20) UNIQUE NOT NULL,   -- 'free', 'basic', 'pro', 'enterprise'
  NAME_DE       TEXT NOT NULL,
  PRICE_MONTHLY DECIMAL(10,2),
  PRICE_YEARLY  DECIMAL(10,2),
  IS_ACTIVE     BOOLEAN NOT NULL DEFAULT TRUE,
  POSITION      INTEGER NOT NULL DEFAULT 0
);

-- Feature-Katalog (System-fest)
CREATE TABLE LICENSE_FEATURE (
  ID         SERIAL PRIMARY KEY,
  KEY        VARCHAR(80) UNIQUE NOT NULL,   -- 'e-invoice.peppol', 'hoai.calculator', ...
  LABEL_DE   TEXT NOT NULL,
  CATEGORY   VARCHAR(50)
);

-- Welche Features sind in welchem Tier? n:m
CREATE TABLE LICENSE_TIER_FEATURE (
  TIER_ID    INT REFERENCES LICENSE_TIER(ID) ON DELETE CASCADE,
  FEATURE_ID INT REFERENCES LICENSE_FEATURE(ID) ON DELETE CASCADE,
  -- Optionale Numeric-Limits pro Feature in diesem Tier
  -- (z.B. 'employees.count' Limit, 'projects.count' Limit, 'storage.mb' Limit)
  NUMERIC_LIMIT INTEGER,
  PRIMARY KEY (TIER_ID, FEATURE_ID)
);

-- Tenant-Lizenz: was hat der Tenant gerade?
CREATE TABLE TENANT_LICENSE (
  TENANT_ID         INT PRIMARY KEY,
  TIER_ID           INT NOT NULL REFERENCES LICENSE_TIER(ID),
  STARTS_AT         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  VALID_UNTIL       TIMESTAMPTZ,                 -- NULL = unbegrenzt (z.B. Enterprise)
  TRIAL_UNTIL       TIMESTAMPTZ,                 -- für Probemonat-Mechanik
  EXTERNAL_REF      TEXT,                        -- Stripe Subscription ID etc.
  GRACE_UNTIL       TIMESTAMPTZ,                 -- Zahlung in Verzug? Bis hier weiter nutzbar
  STATE             VARCHAR(20) NOT NULL DEFAULT 'active',  -- active|trial|past_due|expired
  UPDATED_AT        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- (Optional) Verbindung Rollen <-> Features:
-- "Diese Rolle benötigt, dass folgende Features lizensiert sind"
CREATE TABLE USER_ROLE_FEATURE_REQUIREMENT (
  ROLE_ID    INT REFERENCES USER_ROLE(ID) ON DELETE CASCADE,
  FEATURE_ID INT REFERENCES LICENSE_FEATURE(ID) ON DELETE CASCADE,
  PRIMARY KEY (ROLE_ID, FEATURE_ID)
);
```

---

## Vorgeschlagener Feature-Katalog

Aus den existierenden Modulen abgeleitet — kann sich entwickeln:

### Kern (in jedem Tier)
- `core.projects` — Projekte
- `core.invoices.basic` — einfache Rechnungen
- `core.addresses` — Adressbuch
- `core.bookings` — Stunden buchen

### Erweitert (ab Basic)
- `invoices.partial` — Abschlagsrechnungen
- `invoices.final` — Teil-/Schlussrechnung
- `invoices.credit` — Gutschrift
- `dunning.basic` — einfache Mahnungen
- `offers.basic` — Angebote
- `reports.standard` — Standard-Reports

### Pro
- `einvoice.xrechnung` — XRechnung-XML
- `einvoice.zugferd` — ZUGFeRD-Hybrid
- `einvoice.peppol` — Peppol BIS 3.0
- `hoai.calculator` — HOAI-Honorarberechnung
- `security_retention` — Sicherheitseinbehalte
- `attachments.embed` — Anlagen in E-Rechnung einbetten
- `dunning.email` — Mahnungen per E-Mail
- `reports.advanced` — Trends, Projekt-Forecasting, Company-KPIs
- `cost_rate.calculator` — Kostensatz-Rechner
- `monatsabschluss.auto` — Automatischer Monatsabschluss
- `notifications.advanced` — Konfigurierbare Benachrichtigungen
- `text_templates` — Textvorlagen
- `arbzg.compliance` — ArbZG-Validierung + Audit

### Enterprise
- `multi_company` — mehrere Unternehmen pro Tenant
- `custom_pdf_templates` — eigene Rechnungs-Templates
- `api.access` — API-Token für externe Systeme
- `sso.saml` — SAML/OIDC-Login
- `priority_support` — SLA-basiert

### Numeric Limits (Beispiele)
Diese werden in `LICENSE_TIER_FEATURE.NUMERIC_LIMIT` abgelegt:

| Tier | Mitarbeiter | Aktive Projekte | Storage |
|---|---|---|---|
| Free | 1 | 3 | 100 MB |
| Basic | 5 | 25 | 1 GB |
| Pro | 25 | 200 | 10 GB |
| Enterprise | unbegrenzt | unbegrenzt | individuell |

---

## Wie greifen RBAC und Lizenz ineinander?

Pseudocode für Permission-Check ab Lizenz-Phase:

```
hasAccess(user, requirement):
  if requirement is permission_key:
    return user.permissions.has(requirement)
  if requirement is feature_key:
    return tenant.license.features.has(requirement)
  if requirement is both:
    return user.permissions.has(perm) AND tenant.license.features.has(feat)
```

Konkret in Code:
- **Permissions** entscheiden, ob ein Button gerendert wird (RBAC).
- **Features** entscheiden, ob die Permission im aktuellen Lizenzstatus überhaupt sinnvoll wäre.

Beispiel: ein User hat `invoices.create_credit` (Permission), aber der Tenant hat nur Free (Feature `invoices.credit` nicht enthalten) → Tab „Gutschrift" wird ausgeblendet UND Backend antwortet 402 Payment Required.

---

## Backend-Architektur

**Middleware-Chain** (zusätzlich zu auth + permissions):

```js
app.use("/api/v1/...", authMiddleware, permissionsMiddleware, licenseMiddleware, routes);
```

`licenseMiddleware`:
- Lädt `tenant.license` einmal pro Request (gecached via TTL ~60s)
- Setzt `req.license = { tier, features: Set<string>, limits: Map<string,number> }`
- Setzt `req.hasFeature(key)` Helper

**Route-Guards**:
```js
router.post("/:id/einvoice/peppol",
  requirePermission("invoices.download_xml"),
  requireFeature("einvoice.peppol"),
  handler);
```

`requireFeature` antwortet bei fehlendem Feature mit `402 Payment Required` + JSON-Payload:
```json
{
  "error": "Feature nicht in deiner Lizenz enthalten",
  "feature": "einvoice.peppol",
  "current_tier": "basic",
  "upgrade_to": "pro",
  "upgrade_url": "/admin?tab=lizenz"
}
```

**Numeric Limits**:
- Bei `POST /projekte` prüft Server, ob Tenant noch unter `projects.count` Limit ist
- Bei Überschreitung: `402` mit Hinweis

---

## Frontend-Architektur

**LicenseStore** (Zustand-Slice analog PermissionsStore):
```ts
interface LicenseState {
  tier: 'free' | 'basic' | 'pro' | 'enterprise'
  features: Set<string>
  limits: Map<string, number>
  state: 'active' | 'trial' | 'past_due' | 'expired'
  validUntil: string | null
}
```

**Hooks**:
```ts
useFeature('einvoice.peppol')  // boolean
useLimit('projects.count')     // { current: 17, max: 25, exceeded: false }
useLicenseTier()               // tier object
```

**Wrapper**:
```tsx
<HasFeature feature="hoai.calculator" fallback={<UpgradeHint />}>
  ...content...
</HasFeature>
```

**UpgradeHint**: kleines Banner „Diese Funktion gibt es im Pro-Tarif" + CTA zum Upgrade.

**Combined mit Can**:
```tsx
<Can permission="invoices.download_xml">
  <HasFeature feature="einvoice.peppol">
    <button>Peppol-XML</button>
  </HasFeature>
</Can>
```

---

## Migration & Rollout

### Phase 5 — Lizenz-Foundation (zukünftig)
1. DB-Tabellen anlegen
2. Bestehende Tenants automatisch auf **Pro** (oder höher) — niemand verliert Features
3. `licenseMiddleware` einbauen, aber `requireFeature` noch nicht angewendet
4. Admin-UI: Lizenz-Status anzeigen
5. Stripe / Zahlungs-Integration

### Phase 6 — Soft-Enforcement
1. Frontend `<HasFeature>` an einzelnen Stellen
2. Upgrade-Hints werden angezeigt
3. Backend bleibt offen → wer Permission hat, kann nutzen

### Phase 7 — Hard-Enforcement
1. Backend antwortet 402 wenn Feature fehlt
2. Numeric-Limits werden bei Mutations geprüft
3. Lizenz-Downgrade-Flow: existierende Daten bleiben, Erstellung neuer Items wird gesperrt

### Phase 8 — Zahlungs-Integration
1. Stripe Webhooks pflegen `TENANT_LICENSE.STATE`
2. `past_due`-Logik mit Grace-Period
3. Automatische Mahnung / Suspendierung

---

## Bezahlmodelle

Das Konzept ist absichtlich zahlungsmodell-agnostisch. Mögliche Optionen:

- **Per Tier** (Flatrate): „Pro für 99 €/Monat, beliebig viele User"
- **Per Seat**: „Pro für 19 €/Monat/User"
- **Mischmodell**: Basis-Flatrate + Aufpreis ab gewisser Mitarbeiter-Anzahl
- **Add-Ons**: Pro + Peppol-Add-On für +20 €/Monat (über `LICENSE_TIER_FEATURE` darstellbar mit eigenem „Bundle"-Tier)

Empfehlung: **Pro Tier + Seat-basiert mit Mengenrabatt**. Skaliert mit Größe des Kunden, einfach zu verstehen.

---

## Was ist NICHT Teil dieses Konzepts

- **DSGVO / Datenexport bei Tenant-Löschung**: separates Thema
- **Geo-Pricing / Mehrere Währungen**: später bei Internationalisierung
- **Self-Service Tier-Wechsel-Flow**: UI-Teil, separat zu spezifizieren
- **Discount-Coupons / Promo-Codes**: Stripe-seitig
- **Multi-Tenant pro User**: erst relevant wenn ein Mensch in mehreren Tenants Mitglied ist

---

## Offene Fragen

1. **Welche Features konkret in welcher Stufe?** Die obige Aufteilung ist mein Vorschlag — muss kommerziell validiert werden.
2. **Preise?** Stark vom Wettbewerb abhängig (vergleichbar: Adler-Software, Aboweb, Pirelli-Plan).
3. **Probemonat?** Wenn ja: wie lang, welcher Tier?
4. **Wie strikt bei Downgrade?** Verlorene Features sofort weg vs. Grace-Period?
5. **Hardware-Limits via Stripe-Metering oder eigener Logik?**

---

## Empfohlene nächste Schritte (wenn implementiert wird)

1. **Marktanalyse**: 3-5 ähnliche Tools anschauen, Preise + Feature-Pakete protokollieren
2. **Feature-Mapping finalisieren**: mit konkreten Permission- und Modul-Bezügen aus dem aktuellen Code
3. **Erstellt prototypische Stripe-Integration** in einem Sandbox-Tenant
4. **Phase 5 implementieren** (Foundation, ohne Enforcement) — analog wie wir RBAC ausgerollt haben
5. **Pricing-Test** mit existierenden Kunden / Beta-Gruppe

Aufwand für eine erste Phase: ~3-5 Tage Backend + Frontend + Stripe-Anbindung.
