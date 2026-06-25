-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 0082: Buchungstextvorlagen — globale Ebene zusätzlich zur persönlichen
-- ─────────────────────────────────────────────────────────────────────────────
-- Die persönlichen Buchungstexte (0081, BOOKING_TEXT_SNIPPET) werden um eine
-- GLOBALE Ebene erweitert: admin-definierte Beschreibungstexte, die allen
-- Mitarbeitern in allen Projekten beim Buchen zur Auswahl stehen.
--   SCOPE = 'employee'  persönlich (EMPLOYEE_ID gesetzt) — bestehend
--   SCOPE = 'global'    admin-weit  (EMPLOYEE_ID = NULL)
-- Projektbezogene Ebene bewusst (noch) nicht.
-- Manuell im Supabase SQL-Editor ausführen.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE "BOOKING_TEXT_SNIPPET" ADD COLUMN IF NOT EXISTS "SCOPE" TEXT NOT NULL DEFAULT 'employee';
ALTER TABLE "BOOKING_TEXT_SNIPPET" ALTER COLUMN "EMPLOYEE_ID" DROP NOT NULL;
UPDATE "BOOKING_TEXT_SNIPPET" SET "SCOPE" = 'employee' WHERE "SCOPE" IS NULL;
CREATE INDEX IF NOT EXISTS idx_booking_text_snippet_scope ON "BOOKING_TEXT_SNIPPET"("TENANT_ID", "SCOPE");

-- ── Permission für die Verwaltung der globalen Buchungstextvorlagen ──────────
INSERT INTO "PERMISSION" ("KEY", "MODULE", "ACTION", "LABEL_DE", "DESCRIPTION_DE", "CATEGORY", "POSITION") VALUES
('settings.booking_text_templates.edit', 'settings', 'edit', 'Buchungstextvorlagen verwalten', 'Globale Beschreibungstexte (Textbausteine) für Buchungen pflegen', 'editing', 767)
ON CONFLICT ("KEY") DO UPDATE SET
  "LABEL_DE"       = EXCLUDED."LABEL_DE",
  "DESCRIPTION_DE" = EXCLUDED."DESCRIPTION_DE",
  "MODULE"         = EXCLUDED."MODULE",
  "ACTION"         = EXCLUDED."ACTION",
  "CATEGORY"       = EXCLUDED."CATEGORY",
  "POSITION"       = EXCLUDED."POSITION";

-- Default-Zuweisung: jede Rolle, die schon Stammdaten pflegen darf.
DO $$
DECLARE
  perm_id INT;
BEGIN
  SELECT "ID" INTO perm_id FROM "PERMISSION" WHERE "KEY" = 'settings.booking_text_templates.edit';
  INSERT INTO "ROLE_PERMISSION" ("ROLE_ID","PERMISSION_ID")
    SELECT rp."ROLE_ID", perm_id
    FROM "ROLE_PERMISSION" rp
    JOIN "PERMISSION" p ON p."ID" = rp."PERMISSION_ID"
    WHERE p."KEY" = 'settings.basedata.edit'
  ON CONFLICT DO NOTHING;
END $$;
