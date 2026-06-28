-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 0090: Geführter Datenimport — Domäne Projekte (Stammdaten/Kopf)
-- ─────────────────────────────────────────────────────────────────────────────
-- Macht die PROJECT-Tabelle für den Import-Assistenten rollback-fähig. Phase 2a
-- importiert nur den Projekt-Kopf (Nummer, Name, Status, Typ, Projektleiter,
-- Bauherr). Leistungsstruktur, Verträge und Honorarsummen folgen separat
-- (Struktur wird perspektivisch aus HOAI-Vorlage generiert, nicht importiert).
-- Keine neue Permission nötig (Import-Bereich via 'import.manage' gegated).
-- Manuell im Supabase SQL-Editor ausführen. Siehe docs/DATA_IMPORT_CONCEPT.md.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE "PROJECT" ADD COLUMN IF NOT EXISTS "IMPORT_BATCH_ID" INTEGER;
CREATE INDEX IF NOT EXISTS idx_project_import_batch ON "PROJECT"("IMPORT_BATCH_ID");
