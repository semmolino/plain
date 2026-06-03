-- Migration: Sicherheitseinbehalt — Release Audit Trail (Phase 2)
-- Each row records one act of releasing SE from a prior Abschlagsrechnung
-- by means of a Schluss-/Teilschlussrechnung.

CREATE TABLE IF NOT EXISTS "SE_RELEASE" (
  "ID"                  SERIAL PRIMARY KEY,
  "TENANT_ID"           INTEGER NOT NULL,
  "PARTIAL_PAYMENT_ID"  INTEGER NOT NULL REFERENCES "PARTIAL_PAYMENT"("ID"),
  "INVOICE_ID"          INTEGER NOT NULL REFERENCES "INVOICE"("ID"),
  "SE_AMOUNT_RELEASED"  DECIMAL(14,2) NOT NULL,
  "RELEASED_AT"         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "CREATED_AT"          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS "idx_se_release_invoice"   ON "SE_RELEASE" ("INVOICE_ID");
CREATE INDEX IF NOT EXISTS "idx_se_release_partial"   ON "SE_RELEASE" ("PARTIAL_PAYMENT_ID");
CREATE INDEX IF NOT EXISTS "idx_se_release_tenant"    ON "SE_RELEASE" ("TENANT_ID");
