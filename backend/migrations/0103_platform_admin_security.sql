-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 0103: Härtung der Owner-Konsolen-Identität (PLATFORM_ADMIN)
-- ─────────────────────────────────────────────────────────────────────────────
-- Die Konsole steuert ALLE Mandanten — ein kompromittierter Admin-Zugang ist
-- maximal kritisch. Diese Migration schafft die Grundlage für:
--
--  1. Token-Rücknahme / „überall abmelden": SESSION_EPOCH. Jedes ausgegebene
--     Token trägt seinen Ausstellungszeitpunkt; liegt er vor SESSION_EPOCH, ist
--     das Token ungültig. Bei 2FA-Änderung oder manuellem Logout-All wird
--     SESSION_EPOCH hochgesetzt → alle bestehenden Sitzungen sofort ungültig.
--
--  2. Selbst-Einrichtung von 2FA über die Konsole: TOTP_PENDING_SECRET nimmt das
--     noch nicht bestätigte Secret auf, bis der erste gültige Code es aktiviert.
--     (Bisher ging 2FA nur über das CLI-Skript createPlatformAdmin.js.)
--
-- Idempotent.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE "PLATFORM_ADMIN"
  ADD COLUMN IF NOT EXISTS "SESSION_EPOCH"       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS "TOTP_PENDING_SECRET" TEXT;

COMMENT ON COLUMN "PLATFORM_ADMIN"."SESSION_EPOCH" IS
  'Tokens mit iat < SESSION_EPOCH sind ungültig. Hochsetzen = alle Sitzungen abmelden.';
COMMENT ON COLUMN "PLATFORM_ADMIN"."TOTP_PENDING_SECRET" IS
  'Noch nicht bestätigtes TOTP-Secret während der Einrichtung; nach erstem gültigen Code nach TOTP_SECRET verschoben.';
