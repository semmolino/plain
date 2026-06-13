-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 0073: RBAC-Reparatur fuer Tenants ohne Rollen
-- ─────────────────────────────────────────────────────────────────────────────
-- Per Signup neu angelegte Tenants (nach 0062) hatten keine USER_ROLE-Eintraege.
-- Dadurch war der Erst-User komplett ohne Berechtigungen und konnte nicht
-- arbeiten (auch kein UI zum Selbst-Zuweisen). Der Signup-Code legt die Rollen
-- jetzt selbst an; diese Migration repariert bereits betroffene Tenants.
--
-- SICHER / IDEMPOTENT:
--   * Standard-Rollen werden NUR fuer Tenants angelegt, die noch KEINE Rolle haben.
--   * Administrator wird NUR Mitarbeitern OHNE jegliche Rollenzuweisung gegeben.
--   => Bewusst konfigurierte Rollen bestehender Tenants bleiben unberuehrt.
-- ─────────────────────────────────────────────────────────────────────────────

DO $$
DECLARE
  t RECORD;
  admin_role_id INT;
  gf_role_id INT;
  pl_role_id INT;
  bh_role_id INT;
  mi_role_id INT;
  all_permission_ids INT[];
BEGIN
  SELECT ARRAY_AGG("ID") INTO all_permission_ids FROM "PERMISSION";

  FOR t IN
    SELECT DISTINCT e."TENANT_ID" AS tid
    FROM "EMPLOYEE" e
    WHERE e."TENANT_ID" IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM "USER_ROLE" ur WHERE ur."TENANT_ID" = e."TENANT_ID")
  LOOP
    -- Administrator (alle Permissions)
    INSERT INTO "USER_ROLE" ("TENANT_ID","NAME_SHORT","NAME_LONG","COLOR","IS_SYSTEM","IS_DEFAULT")
      VALUES (t.tid, 'Administrator', 'Voller Zugriff auf alle Funktionen', '#dc2626', TRUE, FALSE)
      ON CONFLICT ("TENANT_ID","NAME_SHORT") DO UPDATE SET "IS_SYSTEM" = TRUE
      RETURNING "ID" INTO admin_role_id;
    INSERT INTO "ROLE_PERMISSION" ("ROLE_ID","PERMISSION_ID")
      SELECT admin_role_id, unnest(all_permission_ids) ON CONFLICT DO NOTHING;

    -- Geschäftsleitung
    INSERT INTO "USER_ROLE" ("TENANT_ID","NAME_SHORT","NAME_LONG","COLOR","IS_SYSTEM","IS_DEFAULT")
      VALUES (t.tid, 'Geschäftsleitung', 'Voller Lesezugriff, Rechnungen buchen, keine Konfiguration', '#7c3aed', TRUE, FALSE)
      ON CONFLICT ("TENANT_ID","NAME_SHORT") DO UPDATE SET "IS_SYSTEM" = TRUE
      RETURNING "ID" INTO gf_role_id;
    INSERT INTO "ROLE_PERMISSION" ("ROLE_ID","PERMISSION_ID")
      SELECT gf_role_id, "ID" FROM "PERMISSION"
      WHERE "CATEGORY" IN ('reading')
         OR "KEY" IN ('invoices.book','invoices.send_email','dunning.send','reports.export')
      ON CONFLICT DO NOTHING;

    -- Projektleiter
    INSERT INTO "USER_ROLE" ("TENANT_ID","NAME_SHORT","NAME_LONG","COLOR","IS_SYSTEM","IS_DEFAULT")
      VALUES (t.tid, 'Projektleiter', 'Projekte/Angebote/Rechnungen voll, keine Mitarbeiterverwaltung', '#2563eb', TRUE, FALSE)
      ON CONFLICT ("TENANT_ID","NAME_SHORT") DO UPDATE SET "IS_SYSTEM" = TRUE
      RETURNING "ID" INTO pl_role_id;
    INSERT INTO "ROLE_PERMISSION" ("ROLE_ID","PERMISSION_ID")
      SELECT pl_role_id, "ID" FROM "PERMISSION"
      WHERE "MODULE" IN ('dashboard','addresses','projects','reports','invoices','dunning','offers')
      ON CONFLICT DO NOTHING;

    -- Buchhaltung
    INSERT INTO "USER_ROLE" ("TENANT_ID","NAME_SHORT","NAME_LONG","COLOR","IS_SYSTEM","IS_DEFAULT")
      VALUES (t.tid, 'Buchhaltung', 'Rechnungen/Mahnungen voll, Projekte/Angebote nur lesen', '#16a34a', TRUE, FALSE)
      ON CONFLICT ("TENANT_ID","NAME_SHORT") DO UPDATE SET "IS_SYSTEM" = TRUE
      RETURNING "ID" INTO bh_role_id;
    INSERT INTO "ROLE_PERMISSION" ("ROLE_ID","PERMISSION_ID")
      SELECT bh_role_id, "ID" FROM "PERMISSION"
      WHERE "MODULE" IN ('invoices','dunning','reports','addresses','dashboard')
         OR "KEY" IN ('projects.view','offers.view','employees.view')
      ON CONFLICT DO NOTHING;

    -- Mitarbeiter (Default-Rolle)
    INSERT INTO "USER_ROLE" ("TENANT_ID","NAME_SHORT","NAME_LONG","COLOR","IS_SYSTEM","IS_DEFAULT")
      VALUES (t.tid, 'Mitarbeiter', 'Basis-Zugriff: Übersicht + eigene Stunden', '#6b7280', TRUE, TRUE)
      ON CONFLICT ("TENANT_ID","NAME_SHORT") DO UPDATE SET "IS_SYSTEM" = TRUE, "IS_DEFAULT" = TRUE
      RETURNING "ID" INTO mi_role_id;
    INSERT INTO "ROLE_PERMISSION" ("ROLE_ID","PERMISSION_ID")
      SELECT mi_role_id, "ID" FROM "PERMISSION"
      WHERE "KEY" IN ('dashboard.view','addresses.view','addresses.contacts.view')
      ON CONFLICT DO NOTHING;
  END LOOP;
END $$;

-- Mitarbeiter OHNE jegliche Rolle -> Administrator (nur die wirklich Ausgesperrten)
INSERT INTO "EMPLOYEE_ROLE" ("EMPLOYEE_ID", "ROLE_ID", "ASSIGNED_AT")
SELECT e."ID", ur."ID", NOW()
FROM "EMPLOYEE" e
JOIN "USER_ROLE" ur
  ON ur."TENANT_ID" = e."TENANT_ID"
 AND ur."NAME_SHORT" = 'Administrator'
WHERE NOT EXISTS (SELECT 1 FROM "EMPLOYEE_ROLE" er WHERE er."EMPLOYEE_ID" = e."ID")
ON CONFLICT DO NOTHING;
