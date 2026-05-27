-- Migration 0038: Text Templates for document PDFs (invoices + dunning)
-- Run manually in Supabase SQL editor

-- Header / footer text templates per document type per tenant
-- DOCUMENT_TYPE values:
--   'invoice_abschlags'  — Abschlags-/Anzahlungsrechnung
--   'invoice_rechnung'   — Rechnung
--   'invoice_schluss'    — Schluss-/Teilschlussrechnung
--   'invoice_storno'     — Stornierung
CREATE TABLE IF NOT EXISTS "TEXT_TEMPLATE" (
  "ID"            SERIAL PRIMARY KEY,
  "TENANT_ID"     INTEGER NOT NULL,
  "DOCUMENT_TYPE" TEXT    NOT NULL,
  "HEADER_TEXT"   TEXT,
  "FOOTER_TEXT"   TEXT,
  UNIQUE ("TENANT_ID", "DOCUMENT_TYPE")
);
