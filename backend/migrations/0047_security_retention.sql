-- Migration: Sicherheitseinbehalt (Security Retention / SE)
-- Phase 1 — adds SE configuration to CONTRACT and SE amounts to
-- PARTIAL_PAYMENT + INVOICE.
--
-- Model (per user spec):
-- - ONE SE percentage per contract (no Vertragserfüllung/Mängelansprüche split)
-- - No Bürgschaft, no Sperrkonto tracking
-- - Each Abschlagsrechnung holds back X % of Brutto (or Netto)
-- - At Schluss-/Teilschlussrechnung the accumulated SE is "released"
--   (= added to the customer's payment demand) via SE_RELEASED_BY_INVOICE_ID
-- - SE does NOT reduce the VAT base — full USt due on the gross amount
--
-- Phase 2 will add an SE_RELEASE audit table.

-- ── Contract-level SE configuration ─────────────────────────────────────────
ALTER TABLE "CONTRACT"
  ADD COLUMN IF NOT EXISTS "SE_ENABLED"         BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS "SE_PERCENT"         DECIMAL(5,2),
  ADD COLUMN IF NOT EXISTS "SE_BASIS"           TEXT DEFAULT 'BRUTTO',  -- 'BRUTTO' | 'NETTO'
  ADD COLUMN IF NOT EXISTS "SE_LEGAL_REFERENCE" TEXT;

-- Same for CONTRACTS table (legacy name fallback used in some queries)
ALTER TABLE IF EXISTS "CONTRACTS"
  ADD COLUMN IF NOT EXISTS "SE_ENABLED"         BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS "SE_PERCENT"         DECIMAL(5,2),
  ADD COLUMN IF NOT EXISTS "SE_BASIS"           TEXT DEFAULT 'BRUTTO',
  ADD COLUMN IF NOT EXISTS "SE_LEGAL_REFERENCE" TEXT;

-- ── Abschlagsrechnung — per-invoice SE held ────────────────────────────────
ALTER TABLE "PARTIAL_PAYMENT"
  ADD COLUMN IF NOT EXISTS "SE_PERCENT"                DECIMAL(5,2),
  ADD COLUMN IF NOT EXISTS "SE_BASIS"                  TEXT,            -- 'BRUTTO' | 'NETTO'
  ADD COLUMN IF NOT EXISTS "SE_BASIS_AMT"              DECIMAL(14,2),   -- the amount the percent was applied to
  ADD COLUMN IF NOT EXISTS "SE_AMOUNT"                 DECIMAL(14,2),   -- the held amount
  ADD COLUMN IF NOT EXISTS "SE_RELEASED_BY_INVOICE_ID" INTEGER REFERENCES "INVOICE"("ID");
-- NULL on SE_RELEASED_BY_INVOICE_ID = still held / open
-- Set = the (Teil)Schlussrechnung that released this SE

-- ── Rechnung — per-invoice SE held + SE released by this invoice ───────────
ALTER TABLE "INVOICE"
  ADD COLUMN IF NOT EXISTS "SE_PERCENT"        DECIMAL(5,2),
  ADD COLUMN IF NOT EXISTS "SE_BASIS"          TEXT,
  ADD COLUMN IF NOT EXISTS "SE_BASIS_AMT"      DECIMAL(14,2),
  ADD COLUMN IF NOT EXISTS "SE_AMOUNT"         DECIMAL(14,2),
  ADD COLUMN IF NOT EXISTS "SE_RELEASE_TOTAL"  DECIMAL(14,2);
-- SE_RELEASE_TOTAL = sum of SE released by THIS invoice (only on Schluss-/Teilschluss)
-- SE_AMOUNT = SE held by THIS invoice (relevant for Einzelrechnung / Abschlag-type INVOICE)
