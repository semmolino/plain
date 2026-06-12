-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 0071: TENANTS.SLUG case-insensitive Uniqueness via CHECK
-- ─────────────────────────────────────────────────────────────────────────────
-- Der UNIQUE-Index aus Migration 0070 ist case-sensitiv. Damit ein direkt
-- per SQL eingetragener "Buero-Plain" nicht neben einem API-eingetragenen
-- "buero-plain" existieren kann, erzwingen wir hier per CHECK Constraint
-- dass SLUG in Kleinschreibung gespeichert wird.
--
-- Erlaubt NULL (kein Slug gesetzt) -- die Bedingung lautet:
--    SLUG IS NULL  ODER  SLUG = lower(SLUG)
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE "TENANTS"
  DROP CONSTRAINT IF EXISTS chk_tenants_slug_lowercase;

ALTER TABLE "TENANTS"
  ADD CONSTRAINT chk_tenants_slug_lowercase
  CHECK ("SLUG" IS NULL OR "SLUG" = lower("SLUG"));
