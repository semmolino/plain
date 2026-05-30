-- Migration 0040: Add LPH_FILTER and CALC_MODE to FEE_CALCULATION_SURCHARGES
-- LPH_FILTER: JSON array of FEE_CALCULATION_PHASE IDs to include in base; NULL = all phases
-- CALC_MODE: 'parallel' (each surcharge uses same base) | 'cumulative' (surcharge N uses base + sum of 0..N-1)

ALTER TABLE "FEE_CALCULATION_SURCHARGES"
  ADD COLUMN IF NOT EXISTS "LPH_FILTER" TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS "CALC_MODE"  TEXT NOT NULL DEFAULT 'parallel';
