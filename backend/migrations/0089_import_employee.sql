-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 0089: Geführter Datenimport — Domäne Mitarbeiter
-- ─────────────────────────────────────────────────────────────────────────────
-- Macht die EMPLOYEE-Tabelle für den Import-Assistenten rollback-fähig (jede
-- importierte Zeile trägt die IMPORT_BATCH_ID ihres Stapels). Keine neue
-- Permission nötig — der gesamte Import-Bereich ist bereits via 'import.manage'
-- (Migration 0088) gegated.
-- Manuell im Supabase SQL-Editor ausführen. Siehe docs/DATA_IMPORT_CONCEPT.md.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE "EMPLOYEE" ADD COLUMN IF NOT EXISTS "IMPORT_BATCH_ID" INTEGER;
CREATE INDEX IF NOT EXISTS idx_employee_import_batch ON "EMPLOYEE"("IMPORT_BATCH_ID");
