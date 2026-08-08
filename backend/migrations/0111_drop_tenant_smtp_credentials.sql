-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 0111: Per-Tenant SMTP-Zugangsdaten entfernen
-- ─────────────────────────────────────────────────────────────────────────────
-- SMTP-Zugangsdaten (Host/Port/Secure/User/Passwort) kommen jetzt ausschliesslich
-- aus den globalen ENV-Variablen (SMTP_HOST, SMTP_PORT, SMTP_SECURE, SMTP_USER,
-- SMTP_PASS — z.B. Eusend). Mandanten koennen nur noch ihre Absenderidentitaet
-- (SMTP_FROM/FROM_NAME/REPLY_TO) ueberschreiben, siehe emailSettingsService.js.
--
-- SMTP_PASS_ENC enthielt nie im Klartext lesbare Werte (AES-256-GCM via
-- secretCrypto), wird hier aber trotzdem mit entfernt, da es keine Verwendung
-- mehr hat.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE "TENANT_EMAIL_SETTINGS"
  DROP COLUMN IF EXISTS "SMTP_HOST",
  DROP COLUMN IF EXISTS "SMTP_PORT",
  DROP COLUMN IF EXISTS "SMTP_SECURE",
  DROP COLUMN IF EXISTS "SMTP_USER",
  DROP COLUMN IF EXISTS "SMTP_PASS_ENC";
