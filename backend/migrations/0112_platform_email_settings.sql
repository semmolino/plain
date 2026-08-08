-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 0112: Plattform-weite SMTP-Konfiguration (Owner-Konsole)
-- ─────────────────────────────────────────────────────────────────────────────
-- Zentrale, ueber die Owner-Konsole verwaltete SMTP-Konfiguration fuer die
-- gesamte Plattform (Ersatz fuer reine ENV-Variablen). Backend UND
-- Owner-Konsole lesen/schreiben diese Tabelle direkt (dieselbe Supabase-DB,
-- kein HTTP-Aufruf zwischen den Diensten).
--
-- SMTP_PASS_ENC ist AES-256-GCM-verschluesselt (Format "iv:tag:ciphertext",
-- alle base64) mit dem Schluessel aus der ENV-Variable PLATFORM_ENC_KEY
-- (siehe owner-console/services/platformCrypto.js + backend/services/platformCrypto.js).
-- PLATFORM_ENC_KEY selbst wird NIE in der DB gespeichert.
--
-- Es existiert bewusst nur EINE Zeile (ID=1) -- ein globaler Absender fuer die
-- gesamte Plattform. Fehlt SMTP_HOST (Migration noch nicht eingespielt, oder
-- Zeile leer), faellt backend/services/emailService.js auf die globalen
-- SMTP_*-ENV-Variablen zurueck.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "PLATFORM_EMAIL_SETTINGS" (
  "ID"            SERIAL PRIMARY KEY,
  "SMTP_HOST"     TEXT,
  "SMTP_PORT"     INTEGER NOT NULL DEFAULT 465,
  "SMTP_SECURE"   BOOLEAN NOT NULL DEFAULT TRUE,
  "SMTP_USER"     TEXT,
  "SMTP_PASS_ENC" TEXT,                            -- AES-256-GCM Blob, niemals Klartext
  "SMTP_FROM"     TEXT,
  "FROM_NAME"     TEXT,
  "UPDATED_AT"    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Nur eine Zeile erlaubt.
INSERT INTO "PLATFORM_EMAIL_SETTINGS" ("ID") VALUES (1) ON CONFLICT DO NOTHING;
