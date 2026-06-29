-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 0092: Geführter Datenimport — Domäne Kontakte (Ansprechpartner)
-- ─────────────────────────────────────────────────────────────────────────────
-- Kontakte (CONTACTS) gehören zu einer Adresse. Macht die Tabelle für den
-- Import-Assistenten rollback-fähig. Keine neue Permission nötig (Import-Bereich
-- via 'import.manage' gegated).
-- Manuell im Supabase SQL-Editor ausführen. Siehe docs/DATA_IMPORT_CONCEPT.md.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE "CONTACTS" ADD COLUMN IF NOT EXISTS "IMPORT_BATCH_ID" INTEGER;
CREATE INDEX IF NOT EXISTS idx_contacts_import_batch ON "CONTACTS"("IMPORT_BATCH_ID");
