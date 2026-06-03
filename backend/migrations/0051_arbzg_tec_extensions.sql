-- Migration 0051 — ArbZG Phase 1c: TEC extensions
--
-- Erweitert die Buchungstabelle TEC um ArbZG-relevante Felder:
-- - ENTRY_KIND:                 'WORK' (Default) oder 'BREAK' (Pause-Block)
-- - IS_SUNDAY / IS_HOLIDAY:     Tag-Flags zum schnellen Auditing
-- - EXCEEDS_8H:                 Tagesarbeitszeit > 8 h (§ 16 Abs. 2 ArbZG)
-- - PAUSE_AUTO_DEDUCTED_MIN:    Minuten, die das System bei Tagesfreigabe
--                               automatisch abgezogen hat
-- - CONFIRMED_BY_EMPLOYEE_AT:   Zeitpunkt der ausdrücklichen
--                               Mitarbeiter-Bestätigung (BAG-2025-konform)
--
-- Bestehende TEC-Zeilen erhalten implizit ENTRY_KIND='WORK', alle Flags FALSE.

ALTER TABLE "TEC"
  ADD COLUMN IF NOT EXISTS "ENTRY_KIND"               TEXT        NOT NULL DEFAULT 'WORK',
  ADD COLUMN IF NOT EXISTS "IS_SUNDAY"                BOOLEAN     NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS "IS_HOLIDAY"               BOOLEAN     NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS "EXCEEDS_8H"               BOOLEAN     NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS "PAUSE_AUTO_DEDUCTED_MIN"  INTEGER     NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "CONFIRMED_BY_EMPLOYEE_AT" TIMESTAMPTZ;

-- ENTRY_KIND-Werte validieren
ALTER TABLE "TEC"
  DROP CONSTRAINT IF EXISTS chk_tec_entry_kind;
ALTER TABLE "TEC"
  ADD CONSTRAINT chk_tec_entry_kind
  CHECK ("ENTRY_KIND" IN ('WORK', 'BREAK'));

-- Index für die Tages-Aggregation pro Mitarbeiter & Tag.
CREATE INDEX IF NOT EXISTS "idx_tec_emp_date_kind"
  ON "TEC" ("EMPLOYEE_ID", "DATE_VOUCHER", "ENTRY_KIND");
