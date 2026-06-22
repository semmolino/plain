-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 0077: Echte Umlaute in den Benachrichtigungs-Labels
-- ─────────────────────────────────────────────────────────────────────────────
-- Die Seed-Labels aus 0055 nutzten ausgeschriebene Umlaute (ae/ue/oe), die im
-- Admin-UI (Tab "Benachrichtigungen") direkt sichtbar sind. Hier sauber
-- korrigiert. Idempotent — setzt feste Zielwerte je TYPE_KEY.
-- ─────────────────────────────────────────────────────────────────────────────

UPDATE "NOTIFICATION_TYPE" SET
  "TITLE_DE"       = 'Rechnung wird fällig',
  "DESCRIPTION_DE" = 'Erinnerung 7 / 3 / 1 Tag(e) vor Fälligkeitsdatum gebuchter Rechnungen.'
WHERE "TYPE_KEY" = 'invoice_due';

UPDATE "NOTIFICATION_TYPE" SET
  "TITLE_DE"       = 'Rechnung überfällig',
  "DESCRIPTION_DE" = 'Hinweis 1 / 7 / 14 Tage nach Fälligkeitsdatum, sofern noch nicht bezahlt.'
WHERE "TYPE_KEY" = 'invoice_overdue';

UPDATE "NOTIFICATION_TYPE" SET
  "TITLE_DE"       = 'Mahnung fällig',
  "DESCRIPTION_DE" = 'Nächste Mahnstufe ist fällig — tägliche Prüfung.'
WHERE "TYPE_KEY" = 'mahnung_due';

UPDATE "NOTIFICATION_TYPE" SET
  "DESCRIPTION_DE" = 'Eine Schwellwert-Regel im Projekt-Tab "Budget" wurde überschritten. Empfänger werden pro Regel (PL/Verursacher/CC) konfiguriert.'
WHERE "TYPE_KEY" = 'budget_warning';
