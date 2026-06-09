-- Migration 0060: E-Rechnung Anlagen (Branch 9)
-- Bettet Begleitdokumente (Stundenzettel, Aufmaß, Verträge, Fotos) als
-- BG-24 EN16931 ADDITIONAL_DOCUMENT_REFERENCE in die XRechnung / ZUGFeRD XML.

CREATE TABLE IF NOT EXISTS "INVOICE_ATTACHMENT" (
  "ID"                    SERIAL PRIMARY KEY,
  "TENANT_ID"             INTEGER NOT NULL,
  "INVOICE_ID"            INTEGER REFERENCES "INVOICE"("ID") ON DELETE CASCADE,
  "PP_ID"                 INTEGER REFERENCES "PARTIAL_PAYMENT"("ID") ON DELETE CASCADE,
  "ASSET_ID"              INTEGER REFERENCES "ASSET"("ID") ON DELETE CASCADE,
  "DESCRIPTION"           TEXT,
  "ATTACHMENT_TYPE_CODE"  VARCHAR(10) DEFAULT '916',  -- 916 = Related Document (UN/CEFACT 1001)
  "DOCUMENT_REFERENCE"    TEXT,                       -- Externe Ref-ID falls vorhanden (BT-122)
  "POSITION"              INTEGER NOT NULL DEFAULT 0, -- Sortierung
  "CREATED_AT"            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_invoice_attachment_source CHECK (
    ("INVOICE_ID" IS NOT NULL AND "PP_ID" IS NULL) OR
    ("INVOICE_ID" IS NULL AND "PP_ID" IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_invoice_attachment_inv ON "INVOICE_ATTACHMENT"("INVOICE_ID");
CREATE INDEX IF NOT EXISTS idx_invoice_attachment_pp  ON "INVOICE_ATTACHMENT"("PP_ID");
CREATE INDEX IF NOT EXISTS idx_invoice_attachment_tenant ON "INVOICE_ATTACHMENT"("TENANT_ID");
