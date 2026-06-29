-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 0095: Datenimport — Kosten-Anfangsbestände (Kostenblöcke), TEC
-- ─────────────────────────────────────────────────────────────────────────────
-- Für Stunden-/TEC-Projekte werden KEINE Einzelbuchungen importiert, sondern
-- aggregierte Kostenblöcke: je Projekt eine LUMP_COST-Buchung (Pauschalsumme →
-- Kosten), damit Deckungsbeitrag/Wirtschaftlichkeit ab Tag 1 stimmt. Damit der
-- Import rückgängig gemacht werden kann, trägt die TEC-Zeile die IMPORT_BATCH_ID.
-- Keine neue Permission nötig (Import-Bereich via 'import.manage' gegated).
-- Manuell im Supabase SQL-Editor ausführen. Siehe docs/DATA_IMPORT_CONCEPT.md §10.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE "TEC" ADD COLUMN IF NOT EXISTS "IMPORT_BATCH_ID" INTEGER;
CREATE INDEX IF NOT EXISTS idx_tec_import_batch ON "TEC"("IMPORT_BATCH_ID");
