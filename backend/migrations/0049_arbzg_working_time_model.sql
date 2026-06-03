-- Migration 0049 — ArbZG Phase 1a: WORKING_TIME_MODEL extensions
--
-- Adds ArbZG-relevant configuration to working-time models:
-- - MODEL_TYPE: 'FIXED' (default) or 'TRUST' (Vertrauensarbeitszeit; Soll
--   wird nicht angezeigt, Erfassung bleibt nach BAG 2022 Pflicht)
-- - BREAK_RULE_ID: link to BREAK_RULE (migration 0050); NULL → tenant default
-- - MAX_DAILY_HOURS: § 3 ArbZG Tageshöchstarbeitszeit (default 10)
-- - MIN_REST_HOURS:  § 5 ArbZG Mindestruhezeit (default 11)
-- - IS_MINOR_PROFILE: JArbSchG U18-Profil
--
-- Bestehende Modelle bleiben funktionsfähig — alle Defaults sind ArbZG-konform.

ALTER TABLE "WORKING_TIME_MODEL"
  ADD COLUMN IF NOT EXISTS "MODEL_TYPE"       TEXT         NOT NULL DEFAULT 'FIXED',
  ADD COLUMN IF NOT EXISTS "BREAK_RULE_ID"    INTEGER,
  ADD COLUMN IF NOT EXISTS "MAX_DAILY_HOURS"  NUMERIC(4,2) NOT NULL DEFAULT 10,
  ADD COLUMN IF NOT EXISTS "MIN_REST_HOURS"   NUMERIC(4,2) NOT NULL DEFAULT 11,
  ADD COLUMN IF NOT EXISTS "IS_MINOR_PROFILE" BOOLEAN      NOT NULL DEFAULT FALSE;

-- MODEL_TYPE-Werte validieren
ALTER TABLE "WORKING_TIME_MODEL"
  DROP CONSTRAINT IF EXISTS chk_working_time_model_type;
ALTER TABLE "WORKING_TIME_MODEL"
  ADD CONSTRAINT chk_working_time_model_type
  CHECK ("MODEL_TYPE" IN ('FIXED', 'TRUST'));
