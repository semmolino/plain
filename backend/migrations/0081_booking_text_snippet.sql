-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 0081: Persönliche Buchungstexte (Textbausteine) für Stunden-Buchungen
-- ─────────────────────────────────────────────────────────────────────────────
-- Jeder Mitarbeiter pflegt eine eigene Liste wiederkehrender Beschreibungstexte
-- und fügt sie beim Buchen schnell in das Feld "Beschreibung" ein.
-- Rein persönlich (EMPLOYEE_ID) — kein gemeinsamer Katalog, keine Permission nötig.
-- Manuell im Supabase SQL-Editor ausführen.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "BOOKING_TEXT_SNIPPET" (
  "ID"          SERIAL PRIMARY KEY,
  "TENANT_ID"   INTEGER NOT NULL,
  "EMPLOYEE_ID" INTEGER NOT NULL,
  "LABEL"       TEXT,
  "TEXT"        TEXT    NOT NULL,
  "SORT_ORDER"  INTEGER DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_booking_text_snippet_emp ON "BOOKING_TEXT_SNIPPET"("EMPLOYEE_ID");
