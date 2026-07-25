-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 0108: Nachträge — Notification-Typen registrieren (Phase N2)
-- ─────────────────────────────────────────────────────────────────────────────
-- Meldet die vom nachtragFristenChecker gefeuerten Typen im NOTIFICATION_TYPE-
-- Katalog an. Damit sind sie in den Benachrichtigungs-Einstellungen sichtbar,
-- ein-/ausschaltbar und mit korrektem Label versehen (statt Legacy-Pfad).
-- Muster: 0055_notification_config.sql.
--
-- Manuell im Supabase SQL-Editor ausführen.
-- ─────────────────────────────────────────────────────────────────────────────

INSERT INTO "NOTIFICATION_TYPE"
  ("TYPE_KEY", "CATEGORY", "TITLE_DE", "DESCRIPTION_DE", "DEFAULT_ENABLED", "DEFAULT_AUDIENCE_KIND", "SUPPORTS_AUDIENCE_OVERRIDE", "SORT_ORDER")
VALUES
  ('nachtrag_review_due', 'nachtrag', 'Nachtrag-Prüffrist wird fällig',
   'Erinnerung 7 / 3 / 1 Tag(e) vor der Prüf-/Entscheidungsfrist offener Nachträge.',
   TRUE, 'tenant_wide', TRUE, 60),

  ('nachtrag_review_overdue', 'nachtrag', 'Nachtrag-Prüffrist überschritten',
   'Hinweis 1 / 7 / 14 Tage nach überschrittener Prüffrist noch offener Nachträge.',
   TRUE, 'tenant_wide', TRUE, 70)
ON CONFLICT ("TYPE_KEY") DO NOTHING;
