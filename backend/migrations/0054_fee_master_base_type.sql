-- Migration 0054 — HOAI: Bemessungsgrundlage pro Leistungsbild
--
-- Bisher rechnen alle Leistungsbilder mit "anrechenbaren Kosten in €"
-- (CONSTRUCTION_COSTS_K0..K4). Für Flächenplanung (Flächennutzungsplan,
-- Bebauungsplan, Landschaftsplan, Grünordnungsplan,
-- Landschaftsrahmenplan, Landschaftspflegerischer Begleitplan,
-- Pflege- und Entwicklungsplan) ist die Bemessungsgrundlage die Fläche
-- in Hektar (ha) — mathematisch identische Interpolation, nur andere
-- Einheit + nur K0 wird befüllt.
--
-- BASE_TYPE steht auf FEE_MASTERS (dem Leistungsbild selbst), damit UI,
-- API und PDF anhand des Werts entscheiden können — ohne IDs oder
-- Namen hardzucoden.
--
-- Werte:
--   'cost_eur' (Default) — anrechenbare Kosten in €, K0..K4 nutzbar
--   'area_ha'            — Fläche in ha, nur K0 nutzbar
--
-- Manuell pro Leistungsbild umzustellen (in Supabase):
--   UPDATE "FEE_MASTERS" SET "BASE_TYPE" = 'area_ha'
--     WHERE "NAME_LONG" IN (
--       'Flächennutzungsplan', 'Bebauungsplan', 'Landschaftsplan',
--       'Grünordnungsplan', 'Landschaftsrahmenplan',
--       'Landschaftspflegerischer Begleitplan',
--       'Pflege- und Entwicklungsplan'
--     );

ALTER TABLE "FEE_MASTERS"
  ADD COLUMN IF NOT EXISTS "BASE_TYPE" TEXT NOT NULL DEFAULT 'cost_eur';

ALTER TABLE "FEE_MASTERS"
  DROP CONSTRAINT IF EXISTS chk_fee_masters_base_type;
ALTER TABLE "FEE_MASTERS"
  ADD CONSTRAINT chk_fee_masters_base_type
  CHECK ("BASE_TYPE" IN ('cost_eur', 'area_ha'));
