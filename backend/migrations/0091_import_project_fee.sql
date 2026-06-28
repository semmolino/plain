-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 0091: Datenimport — Projekt-Honorar (Struktur + Vertrag), Phase 2b
-- ─────────────────────────────────────────────────────────────────────────────
-- Der Honorar-Import erzeugt pro Projekt Leistungsstruktur (eine Pauschal-Position
-- ODER HOAI-Leistungsphasen LP1–9), die zugehörigen Fortschritts-Zeilen und einen
-- Vertrag. Damit dieser zusammengesetzte Import wieder rückgängig gemacht werden
-- kann, tragen alle drei Tabellen die IMPORT_BATCH_ID des Stapels.
-- Keine neue Permission nötig (Import-Bereich via 'import.manage' gegated).
-- Manuell im Supabase SQL-Editor ausführen. Siehe docs/DATA_IMPORT_CONCEPT.md.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE "PROJECT_STRUCTURE" ADD COLUMN IF NOT EXISTS "IMPORT_BATCH_ID" INTEGER;
CREATE INDEX IF NOT EXISTS idx_project_structure_import_batch ON "PROJECT_STRUCTURE"("IMPORT_BATCH_ID");

ALTER TABLE "PROJECT_PROGRESS" ADD COLUMN IF NOT EXISTS "IMPORT_BATCH_ID" INTEGER;
CREATE INDEX IF NOT EXISTS idx_project_progress_import_batch ON "PROJECT_PROGRESS"("IMPORT_BATCH_ID");

ALTER TABLE "CONTRACT" ADD COLUMN IF NOT EXISTS "IMPORT_BATCH_ID" INTEGER;
CREATE INDEX IF NOT EXISTS idx_contract_import_batch ON "CONTRACT"("IMPORT_BATCH_ID");
