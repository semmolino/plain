-- Migration 0015: Stornorechnungen (cancellation documents)
--
-- Adds:
--   INVOICE.CANCELS_INVOICE_ID         – FK to the original invoice being cancelled
--   PARTIAL_PAYMENT.CANCELS_PARTIAL_PAYMENT_ID – FK to the original AR being cancelled
--
-- STATUS_ID = 3 ("Storniert") is used on the original document once the
-- cancellation is booked. No schema change needed for STATUS_ID since it is
-- an unconstrained integer column.
--
-- INVOICE_TYPE = 'stornorechnung' is a new allowed value. No check constraint
-- exists on that column so no schema change is required there either.

-- 1. Cancellation FK on INVOICE (self-referential)
ALTER TABLE "INVOICE"
  ADD COLUMN IF NOT EXISTS "CANCELS_INVOICE_ID" INTEGER
  REFERENCES "INVOICE"("ID") ON DELETE SET NULL;

-- 2. Cancellation FK on PARTIAL_PAYMENT (self-referential)
ALTER TABLE "PARTIAL_PAYMENT"
  ADD COLUMN IF NOT EXISTS "CANCELS_PARTIAL_PAYMENT_ID" INTEGER
  REFERENCES "PARTIAL_PAYMENT"("ID") ON DELETE SET NULL;

-- 3. Index for fast "is this document already cancelled?" lookups
CREATE INDEX IF NOT EXISTS idx_invoice_cancels_invoice_id
  ON "INVOICE"("CANCELS_INVOICE_ID")
  WHERE "CANCELS_INVOICE_ID" IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_pp_cancels_pp_id
  ON "PARTIAL_PAYMENT"("CANCELS_PARTIAL_PAYMENT_ID")
  WHERE "CANCELS_PARTIAL_PAYMENT_ID" IS NOT NULL;