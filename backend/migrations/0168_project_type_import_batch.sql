-- ============================================================================
-- Migration 0168: Stapel-Kennung auf PROJECT_TYPE
--
-- Der kombinierte Projektimport legt einen unbekannten Projekttyp an — wie der
-- Mitarbeiter-Import eine unbekannte Abteilung (Migration 0165). Ohne
-- Stapel-Kennung waere davon nichts zuruecknehmbar: ein Zuruecksetzen wuerde
-- entweder den Typ stehen lassen oder, schlimmer, einen loeschen, den es schon
-- vorher gab.
--
-- Reines DDL. Die Tabelle traegt ihre RLS-Policy bereits.
-- ============================================================================

ALTER TABLE "PROJECT_TYPE" ADD COLUMN IF NOT EXISTS "IMPORT_BATCH_ID" INTEGER;
CREATE INDEX IF NOT EXISTS idx_project_type_batch ON "PROJECT_TYPE"("IMPORT_BATCH_ID");
