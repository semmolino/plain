-- ============================================================================
-- 0185_beleg_aufbau.sql — Aufbau je Projekt und je Beleg
--
-- WARUM
--   Seit Stufe 2 des Vorlagen-Plans legt die Firmenvorlage den Aufbau jeder
--   Belegart fest (theme.bodyByCategory). Öffentliche Auftraggeber verlangen
--   aber oft je Projekt eine feste Form, und einzelne Rechnungen brauchen
--   einen zusätzlichen Hinweis oder einen anderen Kopftext.
--
-- FORM
--   PROJECT.DOCUMENT_LAYOUT_JSON         { "<kategorie>": Abweichung, … }
--   INVOICE/ADVANCE_INVOICE
--     .DOCUMENT_LAYOUT_JSON              Abweichung dieses Belegs
--     .DOCUMENT_LAYOUT_SNAPSHOT_JSON     { "project": … } — beim Buchen
--                                        eingefroren, damit ein später
--                                        geänderter Projekt-Aufbau einen
--                                        gebuchten Beleg nicht mehr ändert
--   Eine Abweichung hat die Form aus services/documentLayout.js
--   (order/hidden/pageBreaks/payment/texts/introText/closingText) und läuft
--   beim Schreiben und Rendern durch sanitizeLayoutOverride.
--
-- MANDANTENTRENNUNG
--   Nur Spalten an bestehenden Tabellen mit RLS. Reines DDL, kein Claim nötig.
-- ============================================================================

ALTER TABLE "PROJECT"         ADD COLUMN IF NOT EXISTS "DOCUMENT_LAYOUT_JSON" jsonb;
ALTER TABLE "INVOICE"         ADD COLUMN IF NOT EXISTS "DOCUMENT_LAYOUT_JSON" jsonb;
ALTER TABLE "INVOICE"         ADD COLUMN IF NOT EXISTS "DOCUMENT_LAYOUT_SNAPSHOT_JSON" jsonb;
ALTER TABLE "ADVANCE_INVOICE" ADD COLUMN IF NOT EXISTS "DOCUMENT_LAYOUT_JSON" jsonb;
ALTER TABLE "ADVANCE_INVOICE" ADD COLUMN IF NOT EXISTS "DOCUMENT_LAYOUT_SNAPSHOT_JSON" jsonb;

COMMENT ON COLUMN "PROJECT"."DOCUMENT_LAYOUT_JSON" IS
  'Aufbau der Belege dieses Projekts je Kategorie (Abweichung von der Firmenvorlage).';
COMMENT ON COLUMN "INVOICE"."DOCUMENT_LAYOUT_JSON" IS
  'Aufbau dieses Belegs (Abweichung von Firmenvorlage und Projekt). Nach dem Buchen unveränderlich.';
COMMENT ON COLUMN "INVOICE"."DOCUMENT_LAYOUT_SNAPSHOT_JSON" IS
  'Beim Buchen eingefrorener Projekt-Aufbau: {"project": …}.';
COMMENT ON COLUMN "ADVANCE_INVOICE"."DOCUMENT_LAYOUT_JSON" IS
  'Aufbau dieses Belegs (Abweichung von Firmenvorlage und Projekt). Nach dem Buchen unveränderlich.';
COMMENT ON COLUMN "ADVANCE_INVOICE"."DOCUMENT_LAYOUT_SNAPSHOT_JSON" IS
  'Beim Buchen eingefrorener Projekt-Aufbau: {"project": …}.';
