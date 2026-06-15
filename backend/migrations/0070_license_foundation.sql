-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 0070: License Foundation (Phase L0 — KEIN Enforcement)
-- ─────────────────────────────────────────────────────────────────────────────
-- Legt das Lizenz-Layer-Schema an. Es findet KEINE Verhaltensänderung statt:
-- nichts liest diese Tabellen für Enforcement (das kommt in L2/L3). Alle
-- bestehenden Tenants werden auf den internen Plan 'full' (alle Capabilities)
-- gesetzt, damit niemand jemals Features verliert.
--
-- Tabellen aus Code-Manifest gespiegelt (read-only fürs Owner-Tool):
--   LICENSE_MODULE, LICENSE_CAPABILITY, CAPABILITY_PERMISSION
-- Im Owner-Tool editierbar:
--   LICENSE_PLAN, PLAN_CAPABILITY, TENANT_LICENSE, TENANT_ENTITLEMENT_OVERRIDE
--
-- Reihenfolge: 0070 (dieses) erstellt Schema + Plan 'full' + Tenant-Zuweisung.
--              0070b (auto-generiert) füllt Module/Capabilities/Links + Full-Plan-Matrix.
-- Architektur: docs/LICENSE_TIERS_CONCEPT.md
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Katalog-Spiegel (aus Manifest, via 0070b befüllt) ─────────────────────

CREATE TABLE IF NOT EXISTS "LICENSE_MODULE" (
  "KEY"       VARCHAR(50) PRIMARY KEY,
  "LABEL_DE"  TEXT NOT NULL,
  "POSITION"  INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS "LICENSE_CAPABILITY" (
  "KEY"         VARCHAR(100) PRIMARY KEY,
  "MODULE_KEY"  VARCHAR(50) NOT NULL REFERENCES "LICENSE_MODULE"("KEY") ON DELETE RESTRICT,
  "LABEL_DE"    TEXT NOT NULL,
  "TYPE"        VARCHAR(20) NOT NULL DEFAULT 'boolean' CHECK ("TYPE" IN ('boolean','metered')),
  "UNIT"        VARCHAR(50),
  "POSITION"    INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_license_capability_module ON "LICENSE_CAPABILITY"("MODULE_KEY");

CREATE TABLE IF NOT EXISTS "CAPABILITY_PERMISSION" (
  "CAPABILITY_KEY" VARCHAR(100) NOT NULL REFERENCES "LICENSE_CAPABILITY"("KEY") ON DELETE CASCADE,
  "PERMISSION_KEY" VARCHAR(100) NOT NULL REFERENCES "PERMISSION"("KEY")        ON DELETE CASCADE,
  PRIMARY KEY ("CAPABILITY_KEY", "PERMISSION_KEY")
);
CREATE INDEX IF NOT EXISTS idx_capability_permission_perm ON "CAPABILITY_PERMISSION"("PERMISSION_KEY");

-- ── 2. Packaging (im Owner-Tool editierbar) ──────────────────────────────────

CREATE TABLE IF NOT EXISTS "LICENSE_PLAN" (
  "ID"             SERIAL PRIMARY KEY,
  "KEY"            VARCHAR(40) UNIQUE NOT NULL,
  "NAME_DE"        TEXT NOT NULL,
  "DESCRIPTION_DE" TEXT,
  "POSITION"       INTEGER NOT NULL DEFAULT 0,
  "IS_ACTIVE"      BOOLEAN NOT NULL DEFAULT TRUE,
  "PRICE_MONTHLY"  DECIMAL(10,2),
  "PRICE_YEARLY"   DECIMAL(10,2),
  "VERSION"        INTEGER NOT NULL DEFAULT 1,
  "CREATED_AT"     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "UPDATED_AT"     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS "PLAN_CAPABILITY" (
  "PLAN_ID"        INTEGER NOT NULL REFERENCES "LICENSE_PLAN"("ID")           ON DELETE CASCADE,
  "CAPABILITY_KEY" VARCHAR(100) NOT NULL REFERENCES "LICENSE_CAPABILITY"("KEY") ON DELETE CASCADE,
  "NUMERIC_LIMIT"  INTEGER,  -- NULL = unbegrenzt (für metered Capabilities)
  PRIMARY KEY ("PLAN_ID", "CAPABILITY_KEY")
);

-- ── 3. Tenant-Lizenz + Overrides ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "TENANT_LICENSE" (
  "TENANT_ID"    INTEGER PRIMARY KEY,
  "PLAN_ID"      INTEGER NOT NULL REFERENCES "LICENSE_PLAN"("ID"),
  "PLAN_VERSION" INTEGER NOT NULL DEFAULT 1,
  "STATE"        VARCHAR(20) NOT NULL DEFAULT 'active'
                   CHECK ("STATE" IN ('trial','active','past_due','grace','expired')),
  "STARTS_AT"    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "VALID_UNTIL"  TIMESTAMPTZ,
  "TRIAL_UNTIL"  TIMESTAMPTZ,
  "GRACE_UNTIL"  TIMESTAMPTZ,
  "EXTERNAL_REF" TEXT,
  "UPDATED_AT"   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS "TENANT_ENTITLEMENT_OVERRIDE" (
  "ID"             SERIAL PRIMARY KEY,
  "TENANT_ID"      INTEGER NOT NULL,
  "CAPABILITY_KEY" VARCHAR(100) NOT NULL REFERENCES "LICENSE_CAPABILITY"("KEY") ON DELETE CASCADE,
  "MODE"           VARCHAR(10) NOT NULL CHECK ("MODE" IN ('grant','revoke')),
  "NUMERIC_LIMIT"  INTEGER,
  "REASON"         TEXT,
  "EXPIRES_AT"     TIMESTAMPTZ,
  "CREATED_AT"     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "CREATED_BY"     TEXT,
  UNIQUE ("TENANT_ID", "CAPABILITY_KEY")
);
CREATE INDEX IF NOT EXISTS idx_entitlement_override_tenant ON "TENANT_ENTITLEMENT_OVERRIDE"("TENANT_ID");

-- ── 4. Audit + Owner-Konsolen-Identität ──────────────────────────────────────

CREATE TABLE IF NOT EXISTS "LICENSE_CHANGE_LOG" (
  "ID"         SERIAL PRIMARY KEY,
  "ACTOR"      TEXT,          -- PLATFORM_ADMIN.EMAIL oder System
  "ENTITY"     TEXT NOT NULL, -- z.B. 'PLAN_CAPABILITY', 'TENANT_LICENSE'
  "ENTITY_REF" TEXT,          -- betroffener Schlüssel/ID
  "ACTION"     TEXT NOT NULL, -- 'create' | 'update' | 'delete'
  "BEFORE"     JSONB,
  "AFTER"      JSONB,
  "AT"         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_license_change_log_at ON "LICENSE_CHANGE_LOG"("AT");

-- Separate Identität für die Owner-Konsole (NICHT Tenant-EMPLOYEE). Genutzt ab L1.
CREATE TABLE IF NOT EXISTS "PLATFORM_ADMIN" (
  "ID"            SERIAL PRIMARY KEY,
  "EMAIL"         VARCHAR(255) UNIQUE NOT NULL,
  "PASSWORD_HASH" TEXT NOT NULL,
  "TOTP_SECRET"   TEXT,
  "IS_ACTIVE"     BOOLEAN NOT NULL DEFAULT TRUE,
  "LAST_LOGIN_AT" TIMESTAMPTZ,
  "CREATED_AT"    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── 5. Interner Start-Plan 'full' + alle Tenants darauf ──────────────────────
-- 'full' = alle Capabilities, unbegrenzt. Garantiert: keine Verhaltensänderung.
-- Die Capability-Zuordnung des Plans erfolgt in 0070b (CROSS JOIN aller Caps).

INSERT INTO "LICENSE_PLAN" ("KEY","NAME_DE","DESCRIPTION_DE","POSITION","IS_ACTIVE","VERSION")
VALUES ('full', 'Vollzugriff (intern)', 'Interner Start-Plan: alle Funktionen, keine Limits. Bestands-Tenants in L0.', 0, TRUE, 1)
ON CONFLICT ("KEY") DO NOTHING;

-- Bestehende Tenants auf 'full' setzen (idempotent). Tenant-Quelle wie in 0062.
INSERT INTO "TENANT_LICENSE" ("TENANT_ID","PLAN_ID","PLAN_VERSION","STATE","STARTS_AT")
SELECT DISTINCT e."TENANT_ID", p."ID", 1, 'active', NOW()
FROM "EMPLOYEE" e
CROSS JOIN "LICENSE_PLAN" p
WHERE e."TENANT_ID" IS NOT NULL AND p."KEY" = 'full'
ON CONFLICT ("TENANT_ID") DO NOTHING;
