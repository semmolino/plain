-- ============================================================================
-- 0186_verzugszinsen.sql — Verzugszinsen und Verzugspauschale in Mahnungen
--
-- WARUM
--   Vorlagen-Plan Stufe 5 (V7): Mahnungen konnten nur eine feste Mahngebuehr
--   je Stufe ausweisen. § 288 BGB erlaubt Verzugszinsen — 9 Prozentpunkte
--   ueber dem Basiszinssatz, wenn kein Verbraucher beteiligt ist, sonst 5 —
--   und gegenueber Unternehmern eine Pauschale von 40 € (Abs. 5).
--
-- FORM
--   ADDRESS.IS_CONSUMER               Schuldner ist Verbraucher (Privatperson):
--                                     5 statt 9 Prozentpunkte, keine Pauschale
--   MAHNUNG_SETTINGS.CHARGE_INTEREST  Verzugszinsen in dieser Mahnstufe
--   MAHNUNG_SETTINGS.CHARGE_FLAT_FEE  40-€-Pauschale in dieser Mahnstufe
--   Beides ist aus, bis ein Buero es einschaltet. Den Basiszinssatz pflegt
--   das Buero selbst (TENANT_SETTINGS dunning_base_rate_percent/_since) —
--   er aendert sich zum 1.1. und 1.7., ohne ihn rechnet die Mahnung keine Zinsen.
--
-- MANDANTENTRENNUNG
--   Nur Spalten an bestehenden Tabellen mit RLS. Reines DDL, kein Claim noetig.
-- ============================================================================

ALTER TABLE "ADDRESS"          ADD COLUMN IF NOT EXISTS "IS_CONSUMER"     boolean NOT NULL DEFAULT false;
ALTER TABLE "MAHNUNG_SETTINGS" ADD COLUMN IF NOT EXISTS "CHARGE_INTEREST" boolean NOT NULL DEFAULT false;
ALTER TABLE "MAHNUNG_SETTINGS" ADD COLUMN IF NOT EXISTS "CHARGE_FLAT_FEE" boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN "ADDRESS"."IS_CONSUMER" IS
  'Verbraucher (Privatperson): Verzugszinsen 5 statt 9 Prozentpunkte, keine 40-€-Pauschale (§ 288 BGB).';
COMMENT ON COLUMN "MAHNUNG_SETTINGS"."CHARGE_INTEREST" IS 'Verzugszinsen in dieser Mahnstufe ausweisen.';
COMMENT ON COLUMN "MAHNUNG_SETTINGS"."CHARGE_FLAT_FEE" IS 'Verzugspauschale 40 € (§ 288 Abs. 5 BGB) in dieser Mahnstufe — nur gegenueber Unternehmern.';
