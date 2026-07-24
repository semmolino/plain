-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 0102: Härtung des Lizenz-Layers + Owner-Konsole
-- ─────────────────────────────────────────────────────────────────────────────
-- Behebt die in der Konsolen-Analyse gefundenen Lücken:
--
--  1. Mandanten ohne Lizenzzeile  — seit 0070 registrierte Tenants hatten keine
--     TENANT_LICENSE-Zeile. Folge: sie fehlten in der Konsole UND galten wegen
--     des Soft-Fails in backend/middleware/license.js als „unbeschränkt".
--     -> Standard-Plan kennzeichnen (IS_DEFAULT) + Bestand nachziehen.
--  2. Fehlende referenzielle Integrität auf TENANTS (Phantom-Lizenzen möglich).
--  3. Plan-Versionierung: LICENSE_PLAN.VERSION wurde nie hochgezählt, obwohl
--     TENANT_LICENSE.PLAN_VERSION eine gepinnte Version vorgibt.
--     -> Trigger zählt hoch, sobald sich der Inhalt eines Plans ändert.
--  4. Audit-Log: fehlende Felder für sprechende Anzeige und Nachvollziehbarkeit.
--
-- Idempotent — mehrfaches Ausführen ist unschädlich.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Standard-Plan für neue Registrierungen ────────────────────────────────

ALTER TABLE "LICENSE_PLAN"
  ADD COLUMN IF NOT EXISTS "IS_DEFAULT" BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN "LICENSE_PLAN"."IS_DEFAULT" IS
  'Plan, den ein neu registrierter Mandant automatisch erhält (genau einer).';

-- Genau ein Standard-Plan.
CREATE UNIQUE INDEX IF NOT EXISTS uq_license_plan_default
  ON "LICENSE_PLAN" ("IS_DEFAULT") WHERE "IS_DEFAULT";

-- Startwert: der interne 'full'-Plan, solange keine Verkaufspläne existieren.
-- Damit ändert sich das heutige Verhalten (alles frei) NICHT — die Zeile macht
-- den Zustand nur explizit und sichtbar.
UPDATE "LICENSE_PLAN" SET "IS_DEFAULT" = TRUE
WHERE "KEY" = 'full'
  AND NOT EXISTS (SELECT 1 FROM "LICENSE_PLAN" WHERE "IS_DEFAULT");

-- ── 2. Bestehende Mandanten ohne Lizenz nachziehen ───────────────────────────

INSERT INTO "TENANT_LICENSE" ("TENANT_ID","PLAN_ID","PLAN_VERSION","STATE","STARTS_AT")
SELECT t."ID", p."ID", COALESCE(p."VERSION",1), 'active', NOW()
FROM "TENANTS" t
CROSS JOIN LATERAL (SELECT "ID","VERSION" FROM "LICENSE_PLAN" WHERE "IS_DEFAULT" LIMIT 1) p
WHERE NOT EXISTS (SELECT 1 FROM "TENANT_LICENSE" tl WHERE tl."TENANT_ID" = t."ID")
ON CONFLICT ("TENANT_ID") DO NOTHING;

-- ── 3. Referenzielle Integrität ──────────────────────────────────────────────
-- Vorher konnte PATCH /tenants/:id/plan eine Lizenz für eine beliebige Zahl
-- anlegen. Verwaiste Zeilen zuerst entfernen, dann FK setzen.

DELETE FROM "TENANT_LICENSE" tl
WHERE NOT EXISTS (SELECT 1 FROM "TENANTS" t WHERE t."ID" = tl."TENANT_ID");

DELETE FROM "TENANT_ENTITLEMENT_OVERRIDE" o
WHERE NOT EXISTS (SELECT 1 FROM "TENANTS" t WHERE t."ID" = o."TENANT_ID");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_tenant_license_tenant'
  ) THEN
    ALTER TABLE "TENANT_LICENSE"
      ADD CONSTRAINT fk_tenant_license_tenant
      FOREIGN KEY ("TENANT_ID") REFERENCES "TENANTS"("ID") ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_entitlement_override_tenant'
  ) THEN
    ALTER TABLE "TENANT_ENTITLEMENT_OVERRIDE"
      ADD CONSTRAINT fk_entitlement_override_tenant
      FOREIGN KEY ("TENANT_ID") REFERENCES "TENANTS"("ID") ON DELETE CASCADE;
  END IF;
END $$;

-- ── 4. Plan-Version zählt bei Inhaltsänderung hoch ───────────────────────────
-- TENANT_LICENSE.PLAN_VERSION pinnt eine Version; ohne Hochzählen war dieser
-- Pin bedeutungslos. Jetzt erkennt die Konsole „Plan seit Zuweisung geändert".
-- (Echtes Grandfathering mit Versions-Snapshots: docs/LICENSE_TIERS_CONCEPT.md)

CREATE OR REPLACE FUNCTION bump_license_plan_version() RETURNS TRIGGER AS $$
DECLARE
  target_plan INTEGER := COALESCE(NEW."PLAN_ID", OLD."PLAN_ID");
BEGIN
  UPDATE "LICENSE_PLAN"
     SET "VERSION" = "VERSION" + 1, "UPDATED_AT" = NOW()
   WHERE "ID" = target_plan;
  RETURN NULL;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_plan_capability_bump ON "PLAN_CAPABILITY";
CREATE TRIGGER trg_plan_capability_bump
  AFTER INSERT OR UPDATE OR DELETE ON "PLAN_CAPABILITY"
  FOR EACH ROW EXECUTE FUNCTION bump_license_plan_version();

-- ── 5. Audit-Log erweitern ───────────────────────────────────────────────────
-- CONTEXT: sprechende Zusatzangaben (Mandantenname, Planname) für die Anzeige,
-- damit die Liste nicht nur technische IDs zeigt.
-- IP/USER_AGENT: Control-Plane-Zugriffe müssen zuordenbar sein.

ALTER TABLE "LICENSE_CHANGE_LOG"
  ADD COLUMN IF NOT EXISTS "CONTEXT"    JSONB,
  ADD COLUMN IF NOT EXISTS "IP"         TEXT,
  ADD COLUMN IF NOT EXISTS "USER_AGENT" TEXT;

CREATE INDEX IF NOT EXISTS idx_license_change_log_entity
  ON "LICENSE_CHANGE_LOG"("ENTITY", "AT" DESC);
CREATE INDEX IF NOT EXISTS idx_license_change_log_actor
  ON "LICENSE_CHANGE_LOG"("ACTOR");

-- Anmeldungen an der Konsole sind sicherheitsrelevant und werden ab sofort
-- ebenfalls protokolliert (ENTITY='CONSOLE_AUTH'). Kein Schema nötig.

-- ── 6. Fehlende Indizes auf den Lizenz-Tabellen ──────────────────────────────

CREATE INDEX IF NOT EXISTS idx_plan_capability_cap  ON "PLAN_CAPABILITY"("CAPABILITY_KEY");
CREATE INDEX IF NOT EXISTS idx_tenant_license_plan  ON "TENANT_LICENSE"("PLAN_ID");
CREATE INDEX IF NOT EXISTS idx_tenant_license_state ON "TENANT_LICENSE"("STATE");
