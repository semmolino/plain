-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 0078: RBAC — Permission fuer PDF-Dokumentvorlagen
-- ─────────────────────────────────────────────────────────────────────────────
-- Neue Permission `settings.document_templates.edit` fuer die Verwaltung der
-- PDF-Dokumentvorlagen (Layout, Logo, Farben, Schrift, Bausteine). Konfigurations-
-- Funktion -> nur Administrator bekommt sie per Default (analog settings.email.edit,
-- 0075; Geschaeftsleitung ist laut 0062 bewusst "keine Konfiguration"). Andere
-- Rollen koennen sie ueber die Rollen-Verwaltung gezielt zugewiesen bekommen.
--
-- Abgrenzung zu bestehenden Permissions:
--   settings.text_templates.edit  -> Kopf-/Fusstexte (TEXT_TEMPLATE), inhaltlich
--   settings.document_templates.edit (NEU) -> Layout/Branding der PDF (DOCUMENT_TEMPLATE)
-- ─────────────────────────────────────────────────────────────────────────────

INSERT INTO "PERMISSION" ("KEY", "MODULE", "ACTION", "LABEL_DE", "DESCRIPTION_DE", "CATEGORY", "POSITION") VALUES
('settings.document_templates.edit', 'settings', 'edit', 'Dokumentvorlagen bearbeiten', 'Layout, Logo, Farben und Schrift der PDF-Vorlagen (Rechnungen, Angebote, …)', 'editing', 765)
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
  perm_tpl_edit INT;
BEGIN
  SELECT "ID" INTO perm_tpl_edit FROM "PERMISSION" WHERE "KEY" = 'settings.document_templates.edit';

  INSERT INTO "ROLE_PERMISSION" ("ROLE_ID","PERMISSION_ID")
    SELECT "ID", perm_tpl_edit
    FROM "USER_ROLE" WHERE "IS_SYSTEM" = TRUE AND "NAME_SHORT" = 'Administrator'
  ON CONFLICT DO NOTHING;
END $$;
