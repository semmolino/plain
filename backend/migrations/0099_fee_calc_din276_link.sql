-- Migration 0099: Honorarberechnung ↔ DIN-276-Kostenermittlung verknüpfen
--
-- Merkt sich, aus welcher DIN-276-Kostenermittlung (und mit welchem
-- Leistungsbild-Regelsatz) die anrechenbaren Kosten (K0) einer
-- Honorarberechnung abgeleitet wurden. So kann die Herleitung reproduzierbar
-- im Honorar-PDF ausgewiesen werden.
--
-- Konzept: docs/DIN276_ANRECHENBARE_KOSTEN_CONCEPT.md
-- Manuell im Supabase SQL-Editor ausführen.

ALTER TABLE "FEE_CALCULATION_MASTER"
  ADD COLUMN IF NOT EXISTS "DIN276_ESTIMATE_ID" INTEGER
    REFERENCES "DIN276_COST_ESTIMATE"("ID") ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS "DIN276_LEISTUNGSBILD" TEXT;  -- 'gebaeude' | 'tragwerk' | 'freianlagen'
