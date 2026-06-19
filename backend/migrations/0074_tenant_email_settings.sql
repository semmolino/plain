-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 0074: Per-Tenant E-Mail-/SMTP-Einstellungen
-- ─────────────────────────────────────────────────────────────────────────────
-- Erlaubt jedem Mandanten, eigene SMTP-Zugangsdaten zu hinterlegen, damit
-- Dokumente (Rechnungen, Abschlagsrechnungen, Mahnungen) aus dem EIGENEN
-- Postfach versendet werden. Ist fuer einen Tenant nichts/Disabled hinterlegt,
-- faellt der Versand auf die globalen Railway-ENV-Variablen (SMTP_*) zurueck.
--
-- SICHERHEIT: Das SMTP-Passwort wird NICHT im Klartext gespeichert, sondern
-- AES-256-GCM-verschluesselt (siehe backend/services/secretCrypto.js). Der
-- Schluessel stammt aus der ENV-Variable EMAIL_ENC_KEY (32 Byte, base64).
-- SMTP_PASS_ENC enthaelt den Blob im Format "iv:tag:ciphertext" (alle base64).
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "TENANT_EMAIL_SETTINGS" (
  "ID"            SERIAL PRIMARY KEY,
  "TENANT_ID"     INTEGER NOT NULL,
  "ENABLED"       BOOLEAN NOT NULL DEFAULT FALSE,  -- FALSE => System-Absender (ENV) nutzen
  "SMTP_HOST"     TEXT,
  "SMTP_PORT"     INTEGER NOT NULL DEFAULT 587,
  "SMTP_SECURE"   BOOLEAN NOT NULL DEFAULT FALSE,  -- TRUE = TLS (465), FALSE = STARTTLS (587)
  "SMTP_USER"     TEXT,
  "SMTP_PASS_ENC" TEXT,                            -- AES-256-GCM Blob, niemals Klartext
  "SMTP_FROM"     TEXT,                            -- Absenderadresse (Default: SMTP_USER)
  "FROM_NAME"     TEXT,                            -- Anzeigename (optional)
  "REPLY_TO"      TEXT,                            -- Antwort-an (optional)
  "UPDATED_AT"    TIMESTAMPTZ NOT NULL DEFAULT now(),
  "CREATED_AT"    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE ("TENANT_ID")
);

CREATE INDEX IF NOT EXISTS idx_tenant_email_settings_tenant
  ON "TENANT_EMAIL_SETTINGS"("TENANT_ID");
