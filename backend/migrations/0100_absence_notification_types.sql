-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 0100: Notification-Typen fuer Abwesenheit/Urlaub
-- ─────────────────────────────────────────────────────────────────────────────
-- Registriert zwei In-App-Notification-Typen im Katalog (Migration 0055), damit
-- sie in den Notification-Einstellungen erscheinen und pro Mandant abschaltbar
-- sind. Empfaenger werden im Code aufgeloest (Genehmiger via absence.approve
-- bzw. der Antragsteller) -> DEFAULT_AUDIENCE_KIND = 'managed_by_rule',
-- SUPPORTS_AUDIENCE_OVERRIDE = FALSE (wie budget_warning).
--
-- Optional: Der Versand funktioniert dank explizit gesetzter USER_ID auch ohne
-- diese Migration (Legacy-Pfad). Sie ergaenzt nur den Ein-/Aus-Schalter im UI.
-- Manuell im Supabase SQL-Editor ausfuehren.
-- ─────────────────────────────────────────────────────────────────────────────

INSERT INTO "NOTIFICATION_TYPE"
  ("TYPE_KEY", "CATEGORY", "TITLE_DE", "DESCRIPTION_DE", "DEFAULT_ENABLED", "DEFAULT_AUDIENCE_KIND", "SUPPORTS_AUDIENCE_OVERRIDE", "SORT_ORDER")
VALUES
  ('absence_request',  'employees', 'Neuer Abwesenheitsantrag',
   'Ein Mitarbeiter hat Urlaub/Abwesenheit beantragt. Geht an alle mit dem Recht „Abwesenheiten genehmigen".',
   TRUE, 'managed_by_rule', FALSE, 60),

  ('absence_decision', 'employees', 'Antwort auf Abwesenheitsantrag',
   'Der eigene Antrag wurde genehmigt, abgelehnt oder es gibt eine Rückfrage. Geht an den Antragsteller.',
   TRUE, 'managed_by_rule', FALSE, 70)
ON CONFLICT ("TYPE_KEY") DO NOTHING;
