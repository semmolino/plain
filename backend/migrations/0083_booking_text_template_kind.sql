-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 0083: Buchungstextvorlagen — Bezug zu Buchungsart/-typ
-- ─────────────────────────────────────────────────────────────────────────────
-- Globale Buchungstextvorlagen können optional an einen Kontext gebunden werden,
-- damit beim Buchen nur die passenden Bausteine erscheinen:
--   KIND IN ('WORK','UNIT','LUMP_COST','LUMP_REVENUE')  -> für eine ganze Art
--   BOOKING_TYPE_ID = <Katalog-Buchungsart>             -> für eine konkrete Art
--   beide NULL                                           -> allgemein (überall)
-- Persönliche Schnell-Bausteine bleiben allgemein (NULL/NULL).
-- Manuell im Supabase SQL-Editor ausführen.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE "BOOKING_TEXT_SNIPPET" ADD COLUMN IF NOT EXISTS "KIND"            TEXT;
ALTER TABLE "BOOKING_TEXT_SNIPPET" ADD COLUMN IF NOT EXISTS "BOOKING_TYPE_ID" INTEGER;
