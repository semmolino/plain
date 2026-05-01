-- Migration 0018: Add STATUS column to TEC for draft/confirmed timer workflow
-- Existing rows stay CONFIRMED; timer drafts use DRAFT until end-of-day release.

ALTER TABLE "TEC" ADD COLUMN IF NOT EXISTS "STATUS" TEXT NOT NULL DEFAULT 'CONFIRMED';

-- Backfill any NULLs that may exist before the DEFAULT was applied
UPDATE "TEC" SET "STATUS" = 'CONFIRMED' WHERE "STATUS" IS NULL;

CREATE INDEX IF NOT EXISTS idx_tec_status ON "TEC"("STATUS");
CREATE INDEX IF NOT EXISTS idx_tec_employee_date ON "TEC"("EMPLOYEE_ID", "DATE_VOUCHER");