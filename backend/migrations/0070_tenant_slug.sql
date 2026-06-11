-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 0070: TENANTS.SLUG fuer Login-Branding-Personalisierung
-- ─────────────────────────────────────────────────────────────────────────────
-- Der Slug ist die menschen-lesbare Tenant-Kennung in der Login-URL:
--   https://app.plain.de/login/buero-mueller
-- Backend liefert anhand des Slugs das Login-Hero-Bild ohne Authentifizierung
-- (TENANT_SETTINGS['tenant.hero_asset_id'] -> Custom-Bild, oder
--  TENANT_SETTINGS['tenant.theme_default'] -> Theme-Default-Stockfoto).
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE "TENANTS"
  ADD COLUMN IF NOT EXISTS "SLUG" VARCHAR(60);

-- Eindeutig, aber NULL erlaubt (Tenants ohne Slug fallen auf generisches Login)
CREATE UNIQUE INDEX IF NOT EXISTS ux_tenants_slug
  ON "TENANTS" ("SLUG")
  WHERE "SLUG" IS NOT NULL;
