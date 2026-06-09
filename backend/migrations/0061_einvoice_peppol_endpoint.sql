-- Migration 0061: Peppol BIS Billing 3.0 (Branch 11)
-- Peppol-Endpoint-Identifier nach EAS-Codeliste (ISO 6523).
-- Wird auf ADDRESS (Kaeufer) UND COMPANY (Verkaeufer) abgelegt.
--
-- Typische SCHEME_ID Werte:
--   0088 = GLN (Global Location Number)
--   0184 = DK CVR
--   0192 = NO Org.nr
--   9930 = DE USt-IdNr.
--   9931 = AT VAT
--   9957 = FR SIRET
--   9959 = BE Enterprise Number

ALTER TABLE "ADDRESS"
  ADD COLUMN IF NOT EXISTS "PEPPOL_ENDPOINT_ID" TEXT,
  ADD COLUMN IF NOT EXISTS "PEPPOL_SCHEME_ID"   VARCHAR(10);

ALTER TABLE "COMPANY"
  ADD COLUMN IF NOT EXISTS "PEPPOL_ENDPOINT_ID" TEXT,
  ADD COLUMN IF NOT EXISTS "PEPPOL_SCHEME_ID"   VARCHAR(10);
