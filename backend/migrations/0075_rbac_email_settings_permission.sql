-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 0075: RBAC — Permission fuer E-Mail-/SMTP-Einstellungen
-- ─────────────────────────────────────────────────────────────────────────────
-- Neue Permission `settings.email.edit` fuer die in 0074 eingefuehrte
-- Per-Tenant-SMTP-Konfiguration. Sensible Funktion (Zugangsdaten) -> nur
-- Administrator bekommt sie per Default. Andere Rollen koennen sie ueber die
-- Rollen-Verwaltung gezielt zugewiesen bekommen.
-- ─────────────────────────────────────────────────────────────────────────────

INSERT INTO "PERMISSION" ("KEY", "MODULE", "ACTION", "LABEL_DE", "DESCRIPTION_DE", "CATEGORY", "POSITION") VALUES
('settings.email.edit', 'settings', 'edit', 'E-Mail-Versand bearbeiten', 'Eigene SMTP-Zugangsdaten fuer den Versand von Dokumenten und Mahnungen', 'editing', 745)
ON CONFLICT ("KEY") DO UPDATE SET
  "LABEL_DE"       = EXCLUDED."LABEL_DE",
  "DESCRIPTION_DE" = EXCLUDED."DESCRIPTION_DE",
  "MODULE"         = EXCLUDED."MODULE",
  "ACTION"         = EXCLUDED."ACTION",
  "CATEGORY"       = EXCLUDED."CATEGORY",
  "POSITION"       = EXCLUDED."POSITION";

-- ── Default-Zuweisung: nur Administrator ────────────────────────────────────
DO $$
DECLARE
  perm_email_edit INT;
BEGIN
  SELECT "ID" INTO perm_email_edit FROM "PERMISSION" WHERE "KEY" = 'settings.email.edit';

  INSERT INTO "ROLE_PERMISSION" ("ROLE_ID","PERMISSION_ID")
    SELECT "ID", perm_email_edit
    FROM "USER_ROLE" WHERE "IS_SYSTEM" = TRUE AND "NAME_SHORT" = 'Administrator'
  ON CONFLICT DO NOTHING;
END $$;
