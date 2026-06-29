-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 0096: RBAC — Permissions für den neuen Top-Level-Bereich „Service"
-- ─────────────────────────────────────────────────────────────────────────────
-- Drei nutzerseitige Sub-Bereiche (je eigene Permission) + eine Admin-Permission
-- für die Festlegung des „Produkt-Sprechers" (siehe docs/SERVICE_AREA_CONCEPT.md).
--
--   service.suggestions.view  — Vorschlagsportal sehen + eigene Vorschläge + einreichen
--   service.feedback.use      — Feedback & Kontakt senden
--   service.support.use       — Unterstützung anfragen
--   service.suggestions.admin — Produkt-Sprecher festlegen / org-weite Vorschläge sehen
--
-- Voten/Kommentieren ist KEINE eigene Permission, sondern an die Einstellung
-- TENANT_SETTINGS.suggestion_delegate_employee_id gebunden (genau ein Sprecher
-- pro Organisation — RBAC ist rollenbasiert und kann „genau einer" nicht garantieren).
--
-- Manuell im Supabase SQL-Editor ausführen.
-- ─────────────────────────────────────────────────────────────────────────────

INSERT INTO "PERMISSION" ("KEY","MODULE","ACTION","LABEL_DE","DESCRIPTION_DE","CATEGORY","POSITION") VALUES
('service.suggestions.view',  'service', 'view',   'Vorschlagsportal nutzen',
 'Funktionswünsche einsehen und einreichen', 'reading', 1000),
('service.feedback.use',      'service', 'create', 'Feedback & Kontakt senden',
 'Rückmeldungen und Kontaktanfragen an plan&simple senden', 'editing', 1001),
('service.support.use',       'service', 'create', 'Unterstützung anfragen',
 'Hilfe-/Support-Anfragen an plan&simple senden', 'editing', 1002),
('service.suggestions.admin', 'service', 'admin',  'Produkt-Sprecher festlegen',
 'Den abstimmungs-/kommentarberechtigten Mitarbeiter der Organisation festlegen und org-weite Vorschläge sehen',
 'administration', 1003)
ON CONFLICT ("KEY") DO UPDATE SET
  "LABEL_DE"       = EXCLUDED."LABEL_DE",
  "DESCRIPTION_DE" = EXCLUDED."DESCRIPTION_DE",
  "MODULE"         = EXCLUDED."MODULE",
  "ACTION"         = EXCLUDED."ACTION",
  "CATEGORY"       = EXCLUDED."CATEGORY",
  "POSITION"       = EXCLUDED."POSITION";

-- ── Default-Zuweisungen ───────────────────────────────────────────────────────
DO $$
DECLARE
  p_view  INT;
  p_feed  INT;
  p_supp  INT;
  p_admin INT;
BEGIN
  SELECT "ID" INTO p_view  FROM "PERMISSION" WHERE "KEY" = 'service.suggestions.view';
  SELECT "ID" INTO p_feed  FROM "PERMISSION" WHERE "KEY" = 'service.feedback.use';
  SELECT "ID" INTO p_supp  FROM "PERMISSION" WHERE "KEY" = 'service.support.use';
  SELECT "ID" INTO p_admin FROM "PERMISSION" WHERE "KEY" = 'service.suggestions.admin';

  -- Die drei nutzerseitigen Rechte bekommt jede Rolle, die überhaupt die App
  -- nutzen darf (Anker: 'dashboard.view'). So kann jeder Mitarbeiter den
  -- Service-Bereich erreichen, sofern sein Admin es nicht entzieht.
  INSERT INTO "ROLE_PERMISSION" ("ROLE_ID","PERMISSION_ID")
    SELECT rp."ROLE_ID", x.pid
    FROM "ROLE_PERMISSION" rp
    JOIN "PERMISSION" p ON p."ID" = rp."PERMISSION_ID"
    CROSS JOIN (VALUES (p_view), (p_feed), (p_supp)) AS x(pid)
    WHERE p."KEY" = 'dashboard.view'
  ON CONFLICT DO NOTHING;

  -- Die Admin-Permission bekommen Rollen, die Firmen-Stammdaten pflegen dürfen
  -- (typischerweise Inhaber/Admin).
  INSERT INTO "ROLE_PERMISSION" ("ROLE_ID","PERMISSION_ID")
    SELECT rp."ROLE_ID", p_admin
    FROM "ROLE_PERMISSION" rp
    JOIN "PERMISSION" p ON p."ID" = rp."PERMISSION_ID"
    WHERE p."KEY" = 'settings.company.edit'
  ON CONFLICT DO NOTHING;
END $$;
