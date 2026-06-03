-- Migration 0052 — ArbZG Phase 1d: Audit-Log + 2-Jahres-Löschsperre
--
-- § 16 Abs. 2 ArbZG verlangt die Aufzeichnung jeder Arbeitszeit, die die
-- gesetzliche werktägliche Arbeitszeit überschreitet, sowie Sonn- und
-- Feiertagsarbeit. Die Aufzeichnungen sind mindestens 2 Jahre aufzubewahren.
--
-- Die Tabelle ARBZG_AUDIT wird vom Backend-Validator und vom
-- Tagesabschluss befüllt. Ein DB-Trigger verhindert das Löschen von
-- Einträgen, die jünger als 2 Jahre sind — auch Tenant-Admins können diese
-- Pflicht nicht umgehen.
--
-- EVENT_TYPE-Werte (Wertebereich wird im Backend gepflegt):
--   'BOOKING_CONFIRMED' | 'OVER_8H' | 'OVER_10H' | 'BREAK_MISSING' |
--   'REST_LT_11H'       | 'SUNDAY_WORK' | 'HOLIDAY_WORK' |
--   'PAUSE_AUTO_DEDUCT' | 'MANUAL_OVERRIDE'

CREATE TABLE IF NOT EXISTS "ARBZG_AUDIT" (
  "ID"           SERIAL PRIMARY KEY,
  "TENANT_ID"    INTEGER     NOT NULL,
  "EMPLOYEE_ID"  INTEGER     NOT NULL,
  "DATE_VOUCHER" DATE        NOT NULL,
  "EVENT_TYPE"   TEXT        NOT NULL,
  "SEVERITY"     TEXT        NOT NULL DEFAULT 'INFO',
    -- 'INFO' | 'WARN' | 'BLOCK'
  "DETAILS"      JSONB       NOT NULL DEFAULT '{}',
  "TEC_ID"       INTEGER,
  "CREATED_AT"   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS "idx_arbzg_audit_lookup"
  ON "ARBZG_AUDIT" ("TENANT_ID", "EMPLOYEE_ID", "DATE_VOUCHER");

CREATE INDEX IF NOT EXISTS "idx_arbzg_audit_event"
  ON "ARBZG_AUDIT" ("TENANT_ID", "EVENT_TYPE", "CREATED_AT");

ALTER TABLE "ARBZG_AUDIT"
  DROP CONSTRAINT IF EXISTS chk_arbzg_audit_severity;
ALTER TABLE "ARBZG_AUDIT"
  ADD CONSTRAINT chk_arbzg_audit_severity
  CHECK ("SEVERITY" IN ('INFO', 'WARN', 'BLOCK'));

-- ── 2-Jahres-Löschsperre (§ 16 Abs. 2 ArbZG) ────────────────────────────────
CREATE OR REPLACE FUNCTION protect_arbzg_audit_retention()
RETURNS trigger AS $$
BEGIN
  IF OLD."CREATED_AT" > NOW() - INTERVAL '2 years' THEN
    RAISE EXCEPTION
      'ArbZG § 16 Abs. 2: Audit-Einträge dürfen vor Ablauf von 2 Jahren nicht gelöscht werden (Eintrag vom %)',
      OLD."CREATED_AT";
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_arbzg_audit_no_delete ON "ARBZG_AUDIT";
CREATE TRIGGER trg_arbzg_audit_no_delete
  BEFORE DELETE ON "ARBZG_AUDIT"
  FOR EACH ROW EXECUTE FUNCTION protect_arbzg_audit_retention();

-- UPDATE ebenfalls sperren (Audit-Integrität): nur DETAILS dürfen ergänzt
-- werden, der ursprüngliche EVENT_TYPE / SEVERITY / TEC_ID bleibt fix.
CREATE OR REPLACE FUNCTION protect_arbzg_audit_immutability()
RETURNS trigger AS $$
BEGIN
  IF NEW."TENANT_ID"    <> OLD."TENANT_ID"
  OR NEW."EMPLOYEE_ID"  <> OLD."EMPLOYEE_ID"
  OR NEW."DATE_VOUCHER" <> OLD."DATE_VOUCHER"
  OR NEW."EVENT_TYPE"   <> OLD."EVENT_TYPE"
  OR NEW."SEVERITY"     <> OLD."SEVERITY"
  OR NEW."CREATED_AT"   <> OLD."CREATED_AT"
  OR COALESCE(NEW."TEC_ID", -1) <> COALESCE(OLD."TEC_ID", -1) THEN
    RAISE EXCEPTION
      'ArbZG-Audit: Schlüsselfelder eines Eintrags dürfen nicht geändert werden';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_arbzg_audit_immutable ON "ARBZG_AUDIT";
CREATE TRIGGER trg_arbzg_audit_immutable
  BEFORE UPDATE ON "ARBZG_AUDIT"
  FOR EACH ROW EXECUTE FUNCTION protect_arbzg_audit_immutability();
