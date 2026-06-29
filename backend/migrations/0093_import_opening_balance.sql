-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 0093: Datenimport — Anfangsbestände (Altrechnungen), Phase 3 (Vorb.)
-- ─────────────────────────────────────────────────────────────────────────────
-- Anfangsbestände werden als echte, gebuchte Referenz-Belege angelegt (damit sie
-- das Self-Healing-Recompute der App überleben). Damit dieser Import wieder
-- zurückgesetzt werden kann, tragen Beleg + Beleg-Struktur die IMPORT_BATCH_ID.
-- (Die eigentliche opening_balance-Domäne folgt; book…() unterstützt bereits
-- skipDocuments für den Import ohne PDF/XRechnung.)
-- Keine neue Permission nötig (Import-Bereich via 'import.manage' gegated).
-- Manuell im Supabase SQL-Editor ausführen. Siehe docs/DATA_IMPORT_CONCEPT.md §10.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE "PARTIAL_PAYMENT"           ADD COLUMN IF NOT EXISTS "IMPORT_BATCH_ID" INTEGER;
CREATE INDEX IF NOT EXISTS idx_partial_payment_import_batch ON "PARTIAL_PAYMENT"("IMPORT_BATCH_ID");

ALTER TABLE "PARTIAL_PAYMENT_STRUCTURE" ADD COLUMN IF NOT EXISTS "IMPORT_BATCH_ID" INTEGER;
CREATE INDEX IF NOT EXISTS idx_pps_import_batch ON "PARTIAL_PAYMENT_STRUCTURE"("IMPORT_BATCH_ID");

ALTER TABLE "INVOICE"                   ADD COLUMN IF NOT EXISTS "IMPORT_BATCH_ID" INTEGER;
CREATE INDEX IF NOT EXISTS idx_invoice_import_batch ON "INVOICE"("IMPORT_BATCH_ID");

ALTER TABLE "INVOICE_STRUCTURE"         ADD COLUMN IF NOT EXISTS "IMPORT_BATCH_ID" INTEGER;
CREATE INDEX IF NOT EXISTS idx_invoice_structure_import_batch ON "INVOICE_STRUCTURE"("IMPORT_BATCH_ID");
