-- Migration 0057 — Workstart-Auto-Popup + Stundenbuchungs-Reminder
--
-- Zwei neue Notification-Typen:
--
-- 1) workstart_autoshow
--      Kein klassischer Reminder, sondern ein tenant-weiter Schalter:
--      wenn aktiviert, oeffnet das Frontend beim Login automatisch das
--      "Arbeitstag starten"-Pop-up, sofern fuer den heutigen Tag noch
--      keine TEC-Buchungen vorliegen.
--      Verwendet nur NOTIFICATION_TYPE_CONFIG.ENABLED, keine Audience,
--      kein Schedule. createNotification wird nie aufgerufen.
--
-- 2) hours_booking_reminder
--      Taeglich zu einer einstellbaren Uhrzeit: alle aktiven Mitarbeiter
--      bekommen eine Erinnerung, die heutigen Stunden zu buchen.
--      Verwendet NOTIFICATION_SCHEDULE_CONFIG.SCHEDULE_TIME_OF_DAY (neu).
--
-- ALTER NOTIFICATION_SCHEDULE_CONFIG: Time-of-Day-Support fuer taegliche
-- Reminder. NULL bedeutet "kein Time-of-Day" und der Schedule laeuft im
-- bestehenden Monatslogik-Modus (SCHEDULE_DAYS / SCHEDULE_LAST_DAY).

ALTER TABLE "NOTIFICATION_SCHEDULE_CONFIG"
  ADD COLUMN IF NOT EXISTS "SCHEDULE_TIME_OF_DAY" TIME;

INSERT INTO "NOTIFICATION_TYPE"
  ("TYPE_KEY", "CATEGORY", "TITLE_DE", "DESCRIPTION_DE",
   "DEFAULT_ENABLED", "DEFAULT_AUDIENCE_KIND", "SUPPORTS_AUDIENCE_OVERRIDE", "SORT_ORDER")
VALUES
  ('workstart_autoshow', 'reminder',
   'Stempeluhr beim Login automatisch oeffnen',
   'Oeffnet das "Arbeitstag starten"-Pop-up automatisch nach dem Login, wenn der Mitarbeiter heute noch keine Zeitbuchung hat. Gilt fuer alle aktiven Mitarbeiter.',
   FALSE, 'tenant_wide', FALSE, 70),

  ('hours_booking_reminder', 'reminder',
   'Erinnerung: Stunden fuer heute buchen',
   'Sendet allen aktiven Mitarbeitern eine Benachrichtigung zu einer einstellbaren Uhrzeit, falls sie heute noch keine Zeitbuchung gemacht haben.',
   FALSE, 'managed_by_rule', FALSE, 80)
ON CONFLICT ("TYPE_KEY") DO NOTHING;
