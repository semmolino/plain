-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 0072: Achievement-Beschreibung "Strukturelement" -> "Projektelement"
-- ─────────────────────────────────────────────────────────────────────────────
-- Folgeaenderung zur UI-Umbenennung Strukturelement -> Projektelement.
-- Die Achievement-Beschreibung (aus 0067) sprach noch von "Strukturelement".
-- ACHIEVEMENT ist ein globaler Katalog (kein TENANT_ID) -> Update global.
-- Idempotent: setzt den Zieltext fix, unabhaengig vom aktuellen Wert.
-- KEY und TITLE bleiben unveraendert (KEY ist intern, TITLE nutzt nur "Struktur").
-- ─────────────────────────────────────────────────────────────────────────────

UPDATE "ACHIEVEMENT"
SET "DESCRIPTION" = 'Erstes Projekt mit mindestens einem Projektelement.'
WHERE "KEY" = 'first_project_with_structure';
