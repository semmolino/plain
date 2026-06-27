-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 0085: Beschaeftigungszeitraum pro Mitarbeiter
-- ─────────────────────────────────────────────────────────────────────────────
-- ENTRY_DATE -> Eintrittsdatum (Beschaeftigungsbeginn), optional
-- EXIT_DATE  -> Austrittsdatum (Beschaeftigungsende), optional
--
-- Beide nullable; reine Stammdaten. Versachlicht spaeter die Aktiv/Inaktiv-
-- Logik (heute nur EMPLOYEE.ACTIVE 1/2) und erlaubt zeitraumbezogene
-- Auswertungen. Keine neue Permission noetig (Teil der Stammdaten).
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public."EMPLOYEE" ADD COLUMN IF NOT EXISTS "ENTRY_DATE" DATE;
ALTER TABLE public."EMPLOYEE" ADD COLUMN IF NOT EXISTS "EXIT_DATE"  DATE;
