-- 0039: Link HOAI calculations to offers (pre-project)
-- Run manually in Supabase SQL editor

ALTER TABLE "FEE_CALCULATION_MASTER"
  ADD COLUMN IF NOT EXISTS "OFFER_ID"                     INTEGER REFERENCES "OFFER"("ID") ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS "ATTACH_TO_OFFER_STRUCTURE_ID" INTEGER REFERENCES "OFFER_STRUCTURE"("ID") ON DELETE SET NULL;

-- Require either PROJECT_ID or OFFER_ID (no standalone calcs)
-- Existing rows satisfy this because they already have PROJECT_ID set.
ALTER TABLE "FEE_CALCULATION_MASTER"
  ADD CONSTRAINT chk_fee_calc_master_source
  CHECK ("PROJECT_ID" IS NOT NULL OR "OFFER_ID" IS NOT NULL);
