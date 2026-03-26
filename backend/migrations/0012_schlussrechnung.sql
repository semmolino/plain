-- Migration: Teil-/Schlussrechnung support
-- Date: 2026-03-25

-- 1. Add INVOICE_TYPE to INVOICE
--    Values: 'rechnung' (regular), 'schlussrechnung', 'teilschlussrechnung'
ALTER TABLE "INVOICE" ADD COLUMN IF NOT EXISTS "INVOICE_TYPE" VARCHAR(30);
UPDATE "INVOICE" SET "INVOICE_TYPE" = 'rechnung' WHERE "INVOICE_TYPE" IS NULL;

-- 2. Add CLOSED_BY_INVOICE_ID to PROJECT_STRUCTURE
--    Set to the INVOICE.ID of the Schluss-/Teilschlussrechnung that definitively closed this phase.
ALTER TABLE "PROJECT_STRUCTURE" ADD COLUMN IF NOT EXISTS "CLOSED_BY_INVOICE_ID" INTEGER;

-- 3. Create INVOICE_DEDUCTION
--    Links a Schluss-/Teilschlussrechnung to the Abschlagsrechnungen being deducted from it.
CREATE TABLE IF NOT EXISTS "INVOICE_DEDUCTION" (
  "ID"                    SERIAL PRIMARY KEY,
  "TENANT_ID"             INTEGER,
  "INVOICE_ID"            INTEGER NOT NULL,
  "PARTIAL_PAYMENT_ID"    INTEGER NOT NULL,
  "DEDUCTION_AMOUNT_NET"  NUMERIC(15,2) NOT NULL DEFAULT 0,
  CONSTRAINT "uq_invoice_deduction" UNIQUE ("INVOICE_ID", "PARTIAL_PAYMENT_ID")
);

-- RLS for INVOICE_DEDUCTION
ALTER TABLE "INVOICE_DEDUCTION" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tenant_isolation" ON "INVOICE_DEDUCTION";
CREATE POLICY "tenant_isolation" ON "INVOICE_DEDUCTION"
  USING ("TENANT_ID" = public.current_tenant_id())
  WITH CHECK ("TENANT_ID" = public.current_tenant_id());
