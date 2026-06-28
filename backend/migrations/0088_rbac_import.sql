-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 0088: RBAC — Permission 'import.manage' für den Datenimport
-- ─────────────────────────────────────────────────────────────────────────────
-- Eine eigene Permission (default nur Inhaber/Admin). Gilt für alle mutierenden
-- Import-Endpunkte (Vorschau, Commit, Rollback) und den UI-Bereich.
-- Manuell im Supabase SQL-Editor ausführen.
-- ─────────────────────────────────────────────────────────────────────────────

INSERT INTO "PERMISSION" ("KEY","MODULE","ACTION","LABEL_DE","DESCRIPTION_DE","CATEGORY","POSITION") VALUES
('import.manage', 'settings', 'edit', 'Datenimport verwalten',
 'Bestehende Daten per Assistent importieren und Importe zurücksetzen', 'editing', 700)
ON CONFLICT ("KEY") DO UPDATE SET
  "LABEL_DE"       = EXCLUDED."LABEL_DE",
  "DESCRIPTION_DE" = EXCLUDED."DESCRIPTION_DE",
  "MODULE"         = EXCLUDED."MODULE",
  "ACTION"         = EXCLUDED."ACTION",
  "CATEGORY"       = EXCLUDED."CATEGORY",
  "POSITION"       = EXCLUDED."POSITION";

-- Default-Zuweisung: alle Rollen, die Firmen-/Stammdaten pflegen dürfen
-- (typischerweise Inhaber/Admin) bekommen den Import.
DO $$
DECLARE
  perm_import INT;
BEGIN
  SELECT "ID" INTO perm_import FROM "PERMISSION" WHERE "KEY" = 'import.manage';

  INSERT INTO "ROLE_PERMISSION" ("ROLE_ID","PERMISSION_ID")
    SELECT rp."ROLE_ID", perm_import
    FROM "ROLE_PERMISSION" rp JOIN "PERMISSION" p ON p."ID" = rp."PERMISSION_ID"
    WHERE p."KEY" = 'settings.company.edit'
  ON CONFLICT DO NOTHING;
END $$;
