-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 0109: Nachträge — Lizenz-Seed (Modul, Capability, Plan-Zuordnung)
-- ─────────────────────────────────────────────────────────────────────────────
-- SELF-CONTAINED: legt Modul + Capability nachtraege.management, die RBAC-
-- Verknüpfungen und die Plan-Zuordnung selbst an — damit diese Migration in
-- normaler Reihenfolge (nach 0106) läuft, OHNE das generierte
-- 0070b_license_capabilities_seed.sql erneut einspielen zu müssen.
--
-- (Das regenerierte 0070b bleibt die Quelle der Wahrheit für frische Installs;
--  hier per ON CONFLICT DO NOTHING nur als idempotenter Nachzieher für Bestände.)
--
-- VORAUSSETZUNG: 0106 (Permissions nachtraege.*) ist eingespielt — Schritt 3
-- verweist per Fremdschlüssel auf "PERMISSION".
--
-- Idempotent. Manuell im Supabase SQL-Editor ausführen.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Modul (FK-Ziel für LICENSE_CAPABILITY.MODULE_KEY)
INSERT INTO "LICENSE_MODULE" ("KEY", "LABEL_DE", "POSITION")
VALUES ('nachtraege', 'Nachträge', 65)
ON CONFLICT ("KEY") DO NOTHING;

-- 2. Capability (FK-Ziel für PLAN_CAPABILITY.CAPABILITY_KEY)
INSERT INTO "LICENSE_CAPABILITY" ("KEY", "MODULE_KEY", "LABEL_DE", "TYPE", "UNIT", "POSITION")
VALUES ('nachtraege.management', 'nachtraege', 'Nachträge', 'boolean', NULL, 230)
ON CONFLICT ("KEY") DO NOTHING;

-- 3. RBAC-Verknüpfungen (welche Rechte diese Capability freischaltet; aus 0106)
INSERT INTO "CAPABILITY_PERMISSION" ("CAPABILITY_KEY", "PERMISSION_KEY")
VALUES
  ('nachtraege.management', 'nachtraege.view'),
  ('nachtraege.management', 'nachtraege.create'),
  ('nachtraege.management', 'nachtraege.edit'),
  ('nachtraege.management', 'nachtraege.submit'),
  ('nachtraege.management', 'nachtraege.review'),
  ('nachtraege.management', 'nachtraege.release'),
  ('nachtraege.management', 'nachtraege.send'),
  ('nachtraege.management', 'nachtraege.delete')
ON CONFLICT DO NOTHING;

-- 4. Plan-Zuordnung: interner Voll-Plan ('full', Bestands-Tenants → sofort sichtbar)
--    + editierbarer Startvorschlag für die verkaufbaren Pläne ab Basic.
--    Feinjustierung danach in der Owner-Konsole (Tab „Matrix").
INSERT INTO "PLAN_CAPABILITY" ("PLAN_ID", "CAPABILITY_KEY", "NUMERIC_LIMIT")
SELECT p."ID", 'nachtraege.management', NULL
FROM "LICENSE_PLAN" p
WHERE p."KEY" IN ('full', 'basic', 'pro', 'enterprise')
ON CONFLICT DO NOTHING;
