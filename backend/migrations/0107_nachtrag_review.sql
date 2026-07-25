-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 0107: Nachträge — Prüfbarkeits-Checkliste & Prüfvermerk (Phase N2)
-- ─────────────────────────────────────────────────────────────────────────────
-- Reaktives NM: eingehende/eigene Nachträge werden auf formelle, inhaltliche und
-- rechnerische Prüfbarkeit geprüft; das Ergebnis ist ein Prüfvermerk mit
-- Empfehlung. Felder am NACHTRAG-Kopf (kein eigenes Table — genau ein Vermerk
-- je Nachtrag). Bearbeitung ist über die Permission nachtraege.review gegatet.
--
-- Manuell im Supabase SQL-Editor ausführen.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public."NACHTRAG" ADD COLUMN IF NOT EXISTS "REVIEW_FORMAL"         boolean DEFAULT FALSE; -- formell prüffähig (Frist/Form/Ankündigung)
ALTER TABLE public."NACHTRAG" ADD COLUMN IF NOT EXISTS "REVIEW_CONTENT"        boolean DEFAULT FALSE; -- inhaltlich schlüssig (Anspruchsgrundlage/Nachweis)
ALTER TABLE public."NACHTRAG" ADD COLUMN IF NOT EXISTS "REVIEW_CALCULATION"    boolean DEFAULT FALSE; -- rechnerisch nachvollziehbar (Mengen/Preise)
ALTER TABLE public."NACHTRAG" ADD COLUMN IF NOT EXISTS "REVIEW_NOTE"           text;                  -- Prüfvermerk (Freitext)
ALTER TABLE public."NACHTRAG" ADD COLUMN IF NOT EXISTS "REVIEW_RECOMMENDATION" text;                  -- ACCEPT | REDUCE | REJECT | QUERY
ALTER TABLE public."NACHTRAG" ADD COLUMN IF NOT EXISTS "REVIEWED_AT"           timestamptz;           -- letzter Prüfstand
ALTER TABLE public."NACHTRAG" ADD COLUMN IF NOT EXISTS "REVIEWED_BY"           bigint;                -- EMPLOYEE_ID des Prüfers
