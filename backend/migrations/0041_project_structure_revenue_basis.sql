-- Add REVENUE_BASIS to PROJECT_STRUCTURE
-- REVENUE_BASIS = the honorar entered by the user (before surcharges)
-- REVENUE      = REVENUE_BASIS + SURCHARGES_TOTAL  (maintained by backend)
-- This way all existing reports/invoices use REVENUE and automatically see the post-surcharge value.

ALTER TABLE "PROJECT_STRUCTURE"
  ADD COLUMN IF NOT EXISTS "REVENUE_BASIS" DECIMAL(14,4);

-- Backfill: existing rows had no surcharges, so REVENUE_BASIS = REVENUE
UPDATE "PROJECT_STRUCTURE"
  SET "REVENUE_BASIS" = "REVENUE"
  WHERE "REVENUE_BASIS" IS NULL;
