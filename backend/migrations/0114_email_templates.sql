-- Migration 0114: E-Mail-Textvorlagen fuer Rechnungs- und Mahnungsversand
-- Run manually in Supabase SQL editor
--
-- Je Mandant genau eine Vorlage pro Versandart. TEMPLATE_KEY:
--   'invoice' — Rechnungen (inkl. Abschlags-/Schluss-/Gutschrift)
--   'dunning' — Mahnungen / Zahlungserinnerungen
--
-- Betreff und Text duerfen Platzhalter {{token}} enthalten; sie werden beim
-- Versand gegen die Werte des jeweiligen Belegs aufgeloest (siehe
-- backend/services/emailTemplates.js). Fehlt eine Zeile, greift der im Code
-- hinterlegte Standardtext — die Tabelle darf also leer bleiben.
CREATE TABLE IF NOT EXISTS "EMAIL_TEMPLATE" (
  "ID"           SERIAL PRIMARY KEY,
  "TENANT_ID"    INTEGER NOT NULL,
  "TEMPLATE_KEY" TEXT    NOT NULL,
  "SUBJECT"      TEXT,
  "BODY"         TEXT,
  "UPDATED_AT"   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE ("TENANT_ID", "TEMPLATE_KEY")
);

CREATE INDEX IF NOT EXISTS "IDX_EMAIL_TEMPLATE_TENANT"
  ON "EMAIL_TEMPLATE" ("TENANT_ID");
