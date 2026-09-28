-- ============================================================================
-- 0174_angebot_kalkulation_verknuepfung.sql — Angebotselemente kennen die
-- Kalkulation, aus der sie stammen (UI-Pilot Runde 6)
--
-- WARUM
--   Eine HOAI-Kalkulation im Angebot legt je Leistungsphase und Besondere
--   Leistung ein Angebotselement an. Im Projekt tragen solche Elemente
--   FEE_CALC_MASTER_ID / FEE_CALC_PHASE_ID / FEE_CALC_BL_ID (0041, 0043) —
--   daran haengt „Struktur aktualisieren", wenn sich die Kalkulation aendert.
--   Im Angebot fehlten die Spalten: eine geaenderte Kalkulation zog ihre
--   Elemente nicht mit, und beim Beauftragen ging die Verknuepfung verloren.
--   Dieselben drei Spalten, dieselben Fremdschluessel wie im Projekt.
--
--   Bestehende Angebotselemente bleiben ohne Verknuepfung (NULL) — sie lassen
--   sich nicht sicher zuordnen, der Assistent sagt das.
--
-- RLS
--   Reines DDL auf einer Tabelle mit bestehender Policy — kein Claim noetig,
--   keine Zeile wird gelesen oder geschrieben.
-- ============================================================================

ALTER TABLE "OFFER_STRUCTURE"
  ADD COLUMN IF NOT EXISTS "FEE_CALC_MASTER_ID" INTEGER REFERENCES "FEE_CALCULATION_MASTER"("ID") ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS "FEE_CALC_PHASE_ID"  INTEGER REFERENCES "FEE_CALCULATION_PHASE"("ID")  ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS "FEE_CALC_BL_ID"     INTEGER REFERENCES "FEE_CALCULATION_BL"("ID")     ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS offer_structure_fee_calc_master_idx
  ON "OFFER_STRUCTURE" ("FEE_CALC_MASTER_ID") WHERE "FEE_CALC_MASTER_ID" IS NOT NULL;

COMMENT ON COLUMN "OFFER_STRUCTURE"."FEE_CALC_MASTER_ID" IS
  'Kalkulation, aus der das Element stammt (Übernehmen ins Angebot). „Angebot aktualisieren" gleicht daran ab; beim Beauftragen geht die Verknüpfung ins Projekt über.';
COMMENT ON COLUMN "OFFER_STRUCTURE"."FEE_CALC_PHASE_ID" IS
  'Leistungsphase der Kalkulation (FEE_CALCULATION_PHASE), deren Honorar das Element trägt.';
COMMENT ON COLUMN "OFFER_STRUCTURE"."FEE_CALC_BL_ID" IS
  'Besondere Leistung der Kalkulation (FEE_CALCULATION_BL), deren Honorar das Element trägt.';
