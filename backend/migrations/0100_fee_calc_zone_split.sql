-- Migration 0100: Zonenanteile für das TGA-Mischhonorar (§ 54 Abs. 3 HOAI)
--
-- Gehören die Anlagen einer Anlagengruppe verschiedenen Honorarzonen an, wird
-- die anrechenbare Kostensumme (K0) auf mehrere Honorarzonen aufgeteilt. Je
-- Zeile: eine Honorarzone + der auf sie entfallende Kostenanteil. Die
-- anrechenbaren Gesamtkosten (K0) ergeben sich dann als Summe der Anteile; das
-- Grundhonorar (REVENUE_K0) wird als gewichtetes Mischhonorar berechnet.
--
-- Ohne Zeilen für eine Berechnung: unverändertes Einzelzonen-Verhalten.
--
-- Konzept: docs/HOAI_MISCHHONORAR_TGA_CONCEPT.md
-- Manuell im Supabase SQL-Editor ausführen.

CREATE TABLE IF NOT EXISTS "FEE_CALC_ZONE_SPLIT" (
  "ID"                 SERIAL PRIMARY KEY,
  "TENANT_ID"          INTEGER NOT NULL,
  "FEE_CALC_MASTER_ID" INTEGER NOT NULL REFERENCES "FEE_CALCULATION_MASTER"("ID") ON DELETE CASCADE,
  "ZONE_ID"            INTEGER NOT NULL REFERENCES "FEE_ZONES"("ID"),
  "ZONE_PERCENT"       DECIMAL(6,2) NOT NULL DEFAULT 0,   -- Position im Zonenband (0..100)
  "AMOUNT"             DECIMAL(14,2) NOT NULL DEFAULT 0,   -- anrechenbare Kosten dieser Zone (€)
  "SORT_ORDER"         INTEGER NOT NULL DEFAULT 0,
  "created_at"         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS "idx_fee_calc_zone_split_master"
  ON "FEE_CALC_ZONE_SPLIT" ("TENANT_ID", "FEE_CALC_MASTER_ID");

ALTER TABLE "FEE_CALC_ZONE_SPLIT" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_isolation" ON "FEE_CALC_ZONE_SPLIT";
CREATE POLICY "tenant_isolation" ON "FEE_CALC_ZONE_SPLIT"
  USING  ("TENANT_ID" = public.current_tenant_id())
  WITH CHECK ("TENANT_ID" = public.current_tenant_id());
