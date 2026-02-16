-- Stage C1: XRechnung (UBL) XML snapshot support for invoices
-- Adds XML snapshot columns on INVOICE so booked documents are immutable.
-- Note: tables are quoted UPPERCASE in this project.

ALTER TABLE "INVOICE"
  ADD COLUMN IF NOT EXISTS "DOCUMENT_XML_ASSET_ID" INTEGER;

ALTER TABLE "INVOICE"
  ADD COLUMN IF NOT EXISTS "DOCUMENT_XML_PROFILE" TEXT;

ALTER TABLE "INVOICE"
  ADD COLUMN IF NOT EXISTS "DOCUMENT_XML_RENDERED_AT" TIMESTAMPTZ;
