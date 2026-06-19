-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 0076: Per-Tenant Absender-Domain (Resend Domain-Verifizierung)
-- ─────────────────────────────────────────────────────────────────────────────
-- Erweitert TENANT_EMAIL_SETTINGS um die eigene verifizierte Versand-Domain des
-- Mandanten. Der Tenant traegt seine Domain ein, hinterlegt die von Resend
-- gelieferten DNS-Records (SPF/DKIM) und verifiziert. Danach versendet PlaIn
-- Dokumente aus der ECHTEN Adresse des Mandanten (z.B. rechnung@kanzlei.de),
-- DKIM-signiert — ohne Postfach-Passwort.
--
--   RESEND_DOMAIN_ID      — Domain-ID im Resend-Account der Plattform
--   RESEND_DOMAIN_NAME    — die Domain (z.B. kanzlei-mueller.de)
--   RESEND_DOMAIN_STATUS  — not_started | pending | verified | failed | ...
--   RESEND_DOMAIN_RECORDS — von Resend gelieferte DNS-Records (zum Anzeigen)
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE "TENANT_EMAIL_SETTINGS"
  ADD COLUMN IF NOT EXISTS "RESEND_DOMAIN_ID"      TEXT,
  ADD COLUMN IF NOT EXISTS "RESEND_DOMAIN_NAME"    TEXT,
  ADD COLUMN IF NOT EXISTS "RESEND_DOMAIN_STATUS"  TEXT,
  ADD COLUMN IF NOT EXISTS "RESEND_DOMAIN_RECORDS" JSONB;
