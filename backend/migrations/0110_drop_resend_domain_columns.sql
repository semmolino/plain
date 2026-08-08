-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 0110: Resend-Domain-Spalten entfernen (Wechsel auf Eusend/SMTP)
-- ─────────────────────────────────────────────────────────────────────────────
-- Der Mailversand wurde von Resend (HTTPS-API + Domain-Verifizierung darueber)
-- auf Eusend (SMTP) umgestellt. Die per-Tenant "eigene Absender-Domain" wurde
-- ausschliesslich ueber die Resend-Domains-API verifiziert und hat kein SMTP-
-- Aequivalent in dieser App -- Absender-Domains werden jetzt direkt im
-- Eusend-Dashboard verifiziert (SPF/DKIM), unabhaengig von TENANT_EMAIL_SETTINGS.
--
-- Versand laeuft ab jetzt ausschliesslich ueber SMTP_* (global) bzw. die
-- bestehenden SMTP_HOST/PORT/SECURE/USER/PASS_ENC/FROM-Spalten (Migration 0074).
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE "TENANT_EMAIL_SETTINGS"
  DROP COLUMN IF EXISTS "RESEND_DOMAIN_ID",
  DROP COLUMN IF EXISTS "RESEND_DOMAIN_NAME",
  DROP COLUMN IF EXISTS "RESEND_DOMAIN_STATUS",
  DROP COLUMN IF EXISTS "RESEND_DOMAIN_RECORDS";
