-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 0094: Datenimport — Anfangsbestände „bereits bezahlt" (Zahlungen)
-- ─────────────────────────────────────────────────────────────────────────────
-- Optional zum berechneten Anfangsbestand kann auch der bezahlte Betrag als
-- echte Zahlung (PAYMENT + PAYMENT_STRUCTURE) gegen den importierten Beleg
-- gebucht werden, damit offene Posten/Restforderung ab Tag 1 stimmen. Damit der
-- Import rückgängig gemacht werden kann, tragen beide Tabellen die IMPORT_BATCH_ID.
-- Keine neue Permission nötig (Import-Bereich via 'import.manage' gegated).
-- Manuell im Supabase SQL-Editor ausführen. Siehe docs/DATA_IMPORT_CONCEPT.md §10.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE "PAYMENT"           ADD COLUMN IF NOT EXISTS "IMPORT_BATCH_ID" INTEGER;
CREATE INDEX IF NOT EXISTS idx_payment_import_batch ON "PAYMENT"("IMPORT_BATCH_ID");

ALTER TABLE "PAYMENT_STRUCTURE" ADD COLUMN IF NOT EXISTS "IMPORT_BATCH_ID" INTEGER;
CREATE INDEX IF NOT EXISTS idx_payment_structure_import_batch ON "PAYMENT_STRUCTURE"("IMPORT_BATCH_ID");
