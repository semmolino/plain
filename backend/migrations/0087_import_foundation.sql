-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 0087: Geführter Datenimport — Fundament (Import-Stapel + Rollback)
-- ─────────────────────────────────────────────────────────────────────────────
-- Jeder Import läuft als nachvollziehbarer "Stapel" (IMPORT_BATCH). Alle dabei
-- angelegten Datensätze tragen dessen IMPORT_BATCH_ID — dadurch ist ein sauberer
-- Rollback ("letzte Importschritte zurücksetzen") möglich, ohne live in der App
-- angelegte Daten zu treffen (die haben IMPORT_BATCH_ID = NULL).
--
-- Phase 0 (Fundament) + Phase 1 Domäne 'address'. Weitere Domänen docken nur die
-- nullable IMPORT_BATCH_ID-Spalte ihrer Tabelle an.
-- Manuell im Supabase SQL-Editor ausführen. Siehe docs/DATA_IMPORT_CONCEPT.md.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Import-Stapel ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "IMPORT_BATCH" (
  "ID"              SERIAL  PRIMARY KEY,
  "TENANT_ID"       INTEGER NOT NULL,
  "DOMAIN"          TEXT    NOT NULL,                    -- 'address', 'employee', ...
  "STATUS"          TEXT    NOT NULL DEFAULT 'committed',-- committed | rolled_back
  "SOURCE_FILENAME" TEXT,
  "MAPPING_JSON"    JSONB,                               -- gewählte Spaltenzuordnung
  "ROW_TOTAL"       INTEGER NOT NULL DEFAULT 0,
  "ROW_OK"          INTEGER NOT NULL DEFAULT 0,
  "ROW_SKIPPED"     INTEGER NOT NULL DEFAULT 0,          -- Dubletten/abgewählt
  "ROW_ERROR"       INTEGER NOT NULL DEFAULT 0,
  "SUMMARY_JSON"    JSONB,
  "CREATED_BY"      INTEGER,
  "CREATED_AT"      TIMESTAMPTZ NOT NULL DEFAULT now(),
  "ROLLED_BACK_AT"  TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_import_batch_tenant ON "IMPORT_BATCH"("TENANT_ID");
CREATE INDEX IF NOT EXISTS idx_import_batch_status ON "IMPORT_BATCH"("TENANT_ID","STATUS");

-- ── 2. Rollback-Markierung auf importierbaren Tabellen ───────────────────────
-- Phase 1: Adressen. (Weitere Tabellen analog in späteren Migrationen.)
ALTER TABLE "ADDRESS" ADD COLUMN IF NOT EXISTS "IMPORT_BATCH_ID" INTEGER;
CREATE INDEX IF NOT EXISTS idx_address_import_batch ON "ADDRESS"("IMPORT_BATCH_ID");
