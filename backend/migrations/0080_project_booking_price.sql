-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 0080: Projektbezogene Preise für Buchungsarten (Preislisten)
-- ─────────────────────────────────────────────────────────────────────────────
-- Pendant zu EMPLOYEE2PROJECT (Stundensatz je Mitarbeiter/Projekt): erlaubt, den
-- Standardpreis einer (globalen) Buchungsart projektbezogen zu überschreiben.
-- Greift kein Override, gilt BOOKING_TYPE.DEFAULT_SP_RATE/DEFAULT_CP_RATE.
-- Manuell im Supabase SQL-Editor ausführen.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "PROJECT_BOOKING_PRICE" (
  "ID"              SERIAL PRIMARY KEY,
  "TENANT_ID"       INTEGER NOT NULL,
  "PROJECT_ID"      INTEGER NOT NULL,
  "BOOKING_TYPE_ID" INTEGER NOT NULL,
  "SP_RATE"         NUMERIC,
  "CP_RATE"         NUMERIC,
  UNIQUE ("PROJECT_ID", "BOOKING_TYPE_ID")
);
CREATE INDEX IF NOT EXISTS idx_project_booking_price_project ON "PROJECT_BOOKING_PRICE"("PROJECT_ID");
CREATE INDEX IF NOT EXISTS idx_project_booking_price_tenant  ON "PROJECT_BOOKING_PRICE"("TENANT_ID");
