-- Migration 0056 — Notification-Schedules (zeitgesteuerte Reminder)
--
-- Generische Tabelle fuer Reminder-Typen, die zu bestimmten Tagen im
-- Monat feuern. Aktuell verwendet von 'leistungsstand_reminder'.
--
-- Schedule:
--   SCHEDULE_DAYS INT[]        -- Tage 1..31. Treffer = heute.getDate() in der Liste.
--   SCHEDULE_LAST_DAY BOOLEAN  -- zusaetzlich am letzten Tag des Monats feuern.
--
-- Empfaenger:
--   NOTIFY_PROJECT_PM BOOLEAN  -- pro Projekt eine Notification an PROJECT.PROJECT_MANAGER_ID
--   AUDIENCE_*                 -- zusaetzliche tenantweite Empfaenger (OR-verknuepft)
--
-- Filter:
--   PROJECT_STATUS_IDS INT[]   -- nur Projekte mit diesen Status_IDs.
--                                  NULL/leer => alle aktiven Projekte.
--
-- LAST_FIRED_DATE                Anti-Doppel-Feuer-Pruefung pro Tag.

CREATE TABLE IF NOT EXISTS "NOTIFICATION_SCHEDULE_CONFIG" (
  "ID"                    SERIAL PRIMARY KEY,
  "TENANT_ID"             INTEGER NOT NULL,
  "TYPE_KEY"              TEXT NOT NULL REFERENCES "NOTIFICATION_TYPE"("TYPE_KEY") ON DELETE CASCADE,
  "ENABLED"               BOOLEAN NOT NULL DEFAULT TRUE,
  "SCHEDULE_DAYS"         INTEGER[],
  "SCHEDULE_LAST_DAY"     BOOLEAN NOT NULL DEFAULT FALSE,
  "NOTIFY_PROJECT_PM"     BOOLEAN NOT NULL DEFAULT TRUE,
  "PROJECT_STATUS_IDS"    INTEGER[],
  "AUDIENCE_ROLES"        TEXT[],
  "AUDIENCE_DEPARTMENTS"  INTEGER[],
  "AUDIENCE_EMPLOYEES"    INTEGER[],
  "LAST_FIRED_DATE"       DATE,
  "CREATED_AT"            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "UPDATED_AT"            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "UPDATED_BY"            INTEGER REFERENCES "EMPLOYEE"("ID"),
  CONSTRAINT uq_notif_schedule UNIQUE ("TENANT_ID", "TYPE_KEY")
);
CREATE INDEX IF NOT EXISTS idx_notif_schedule_tenant ON "NOTIFICATION_SCHEDULE_CONFIG"("TENANT_ID");

-- Neuer Notification-Typ: per-Projekt-PM-managed,
-- SUPPORTS_AUDIENCE_OVERRIDE=false weil Empfaenger im Schedule-Block eingestellt werden.
INSERT INTO "NOTIFICATION_TYPE"
  ("TYPE_KEY", "CATEGORY", "TITLE_DE", "DESCRIPTION_DE",
   "DEFAULT_ENABLED", "DEFAULT_AUDIENCE_KIND", "SUPPORTS_AUDIENCE_OVERRIDE", "SORT_ORDER")
VALUES
  ('leistungsstand_reminder', 'reminder',
   'Erinnerung: Leistungsstand pflegen',
   'Monatliche Erinnerung, die Leistungsstaende der laufenden Projekte zu pflegen. Empfaenger und Zeitpunkt werden im Reminder-Bereich konfiguriert.',
   TRUE, 'managed_by_rule', FALSE, 60)
ON CONFLICT ("TYPE_KEY") DO NOTHING;
