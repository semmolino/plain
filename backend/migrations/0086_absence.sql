-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 0086: Urlaub / Abwesenheit — Phase 1 (Datenmodell + Katalog + RBAC)
-- ─────────────────────────────────────────────────────────────────────────────
-- Bildet Abwesenheiten als eigene Datenebene ab, die ins Zeitkonto einfliesst
-- (an Tagen mit COUNTS_AS_WORKED gilt das Soll als erfuellt).
--
--   ABSENCE_TYPE          Katalog der Abwesenheitsarten je Tenant
--   ABSENCE               einzelne Abwesenheit (mit Antrag/Freigabe-Status)
--   VACATION_ENTITLEMENT  Urlaubsanspruch je Mitarbeiter/Jahr (Uebertrag wird
--                         im Code automatisch aus dem Vorjahr berechnet)
--
-- Entscheidungen: Antrag+Freigabe (STATUS), halbe Tage (HALF_DAY), Uebertrag
-- automatisch. Manuell im Supabase SQL-Editor ausfuehren.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Katalog der Abwesenheitsarten ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "ABSENCE_TYPE" (
  "ID"                SERIAL  PRIMARY KEY,
  "TENANT_ID"         INTEGER NOT NULL,
  "NAME"              TEXT    NOT NULL,
  "COLOR"             TEXT,
  "COUNTS_AS_WORKED"  BOOLEAN NOT NULL DEFAULT TRUE,   -- Tag gilt als Soll erfuellt?
  "REDUCES_VACATION"  BOOLEAN NOT NULL DEFAULT FALSE,  -- zehrt vom Urlaubsanspruch?
  "REQUIRES_APPROVAL" BOOLEAN NOT NULL DEFAULT TRUE,   -- Antrag/Freigabe noetig?
  "IS_PAID"           BOOLEAN NOT NULL DEFAULT TRUE,
  "ACTIVE"            INTEGER NOT NULL DEFAULT 1,
  "SORT_ORDER"        INTEGER DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_absence_type_tenant ON "ABSENCE_TYPE"("TENANT_ID");

-- ── 2. Abwesenheiten ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "ABSENCE" (
  "ID"              SERIAL  PRIMARY KEY,
  "TENANT_ID"       INTEGER NOT NULL,
  "EMPLOYEE_ID"     INTEGER NOT NULL,
  "ABSENCE_TYPE_ID" INTEGER NOT NULL,
  "DATE_FROM"       DATE    NOT NULL,
  "DATE_TO"         DATE    NOT NULL,
  "HALF_DAY"        BOOLEAN NOT NULL DEFAULT FALSE,   -- nur sinnvoll wenn DATE_FROM = DATE_TO
  "STATUS"          TEXT    NOT NULL DEFAULT 'REQUESTED', -- REQUESTED|APPROVED|REJECTED|CANCELLED
  "NOTE"            TEXT,
  "REQUESTED_BY"    INTEGER,
  "REQUESTED_AT"    TIMESTAMPTZ DEFAULT now(),
  "DECIDED_BY"      INTEGER,
  "DECIDED_AT"      TIMESTAMPTZ,
  "DECISION_NOTE"   TEXT
);
CREATE INDEX IF NOT EXISTS idx_absence_tenant   ON "ABSENCE"("TENANT_ID");
CREATE INDEX IF NOT EXISTS idx_absence_employee ON "ABSENCE"("EMPLOYEE_ID");
CREATE INDEX IF NOT EXISTS idx_absence_dates    ON "ABSENCE"("DATE_FROM","DATE_TO");

-- ── 3. Urlaubsanspruch je Mitarbeiter/Jahr ──────────────────────────────────
CREATE TABLE IF NOT EXISTS "VACATION_ENTITLEMENT" (
  "ID"                 SERIAL  PRIMARY KEY,
  "TENANT_ID"          INTEGER NOT NULL,
  "EMPLOYEE_ID"        INTEGER NOT NULL,
  "YEAR"               INTEGER NOT NULL,
  "DAYS_ENTITLED"      NUMERIC NOT NULL DEFAULT 0,
  "CARRYOVER_OVERRIDE" NUMERIC,                        -- optional: manueller Uebertrag statt Auto
  "NOTE"               TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_vac_entitlement
  ON "VACATION_ENTITLEMENT"("TENANT_ID","EMPLOYEE_ID","YEAR");

-- ── 4. Default-Abwesenheitsarten je Tenant (idempotent) ─────────────────────
INSERT INTO "ABSENCE_TYPE"
  ("TENANT_ID","NAME","COLOR","COUNTS_AS_WORKED","REDUCES_VACATION","REQUIRES_APPROVAL","IS_PAID","SORT_ORDER")
SELECT t."ID", v.name, v.color, v.worked, v.reduces, v.approval, v.paid, v.ord
FROM "TENANT" t
CROSS JOIN (VALUES
  ('Urlaub',              '#2563eb', TRUE,  TRUE,  TRUE,  TRUE,  10),
  ('Krankheit',           '#dc2626', TRUE,  FALSE, FALSE, TRUE,  20),
  ('Sonderurlaub',        '#7c3aed', TRUE,  FALSE, TRUE,  TRUE,  30),
  ('Unbezahlter Urlaub',  '#6b7280', FALSE, FALSE, TRUE,  FALSE, 40),
  ('Gleitzeitabbau',      '#0891b2', TRUE,  FALSE, TRUE,  TRUE,  50),
  ('Fortbildung',         '#059669', TRUE,  FALSE, TRUE,  TRUE,  60)
) AS v(name,color,worked,reduces,approval,paid,ord)
WHERE NOT EXISTS (
  SELECT 1 FROM "ABSENCE_TYPE" a WHERE a."TENANT_ID" = t."ID"
);

-- ── 5. Permissions ──────────────────────────────────────────────────────────
INSERT INTO "PERMISSION" ("KEY","MODULE","ACTION","LABEL_DE","DESCRIPTION_DE","CATEGORY","POSITION") VALUES
('absence.view',    'employees', 'view',   'Abwesenheiten ansehen',   'Urlaub/Abwesenheiten aller Mitarbeiter sehen',         'reading', 650),
('absence.request', 'employees', 'create', 'Abwesenheit beantragen',  'Eigene Urlaubs-/Abwesenheitsantraege stellen',         'editing', 651),
('absence.approve', 'employees', 'edit',   'Abwesenheiten genehmigen','Antraege genehmigen oder ablehnen',                    'editing', 652),
('absence.manage',  'employees', 'edit',   'Abwesenheiten verwalten', 'Arten/Anspruch pflegen und fuer andere erfassen',      'editing', 653)
ON CONFLICT ("KEY") DO UPDATE SET
  "LABEL_DE"       = EXCLUDED."LABEL_DE",
  "DESCRIPTION_DE" = EXCLUDED."DESCRIPTION_DE",
  "MODULE"         = EXCLUDED."MODULE",
  "ACTION"         = EXCLUDED."ACTION",
  "CATEGORY"       = EXCLUDED."CATEGORY",
  "POSITION"       = EXCLUDED."POSITION";

-- ── 6. Default-Zuweisungen ──────────────────────────────────────────────────
DO $$
DECLARE
  perm_view    INT;
  perm_request INT;
  perm_approve INT;
  perm_manage  INT;
BEGIN
  SELECT "ID" INTO perm_view    FROM "PERMISSION" WHERE "KEY" = 'absence.view';
  SELECT "ID" INTO perm_request FROM "PERMISSION" WHERE "KEY" = 'absence.request';
  SELECT "ID" INTO perm_approve FROM "PERMISSION" WHERE "KEY" = 'absence.approve';
  SELECT "ID" INTO perm_manage  FROM "PERMISSION" WHERE "KEY" = 'absence.manage';

  -- Beantragen: jede Rolle, die Stunden buchen darf (eigene Abwesenheit)
  INSERT INTO "ROLE_PERMISSION" ("ROLE_ID","PERMISSION_ID")
    SELECT rp."ROLE_ID", perm_request
    FROM "ROLE_PERMISSION" rp JOIN "PERMISSION" p ON p."ID" = rp."PERMISSION_ID"
    WHERE p."KEY" = 'projects.bookings.create'
  ON CONFLICT DO NOTHING;

  -- Ansehen + Genehmigen: Rollen, die fremde Buchungen sehen (Fuehrung)
  INSERT INTO "ROLE_PERMISSION" ("ROLE_ID","PERMISSION_ID")
    SELECT rp."ROLE_ID", perm_view
    FROM "ROLE_PERMISSION" rp JOIN "PERMISSION" p ON p."ID" = rp."PERMISSION_ID"
    WHERE p."KEY" = 'employees.bookings.view_all'
  ON CONFLICT DO NOTHING;
  INSERT INTO "ROLE_PERMISSION" ("ROLE_ID","PERMISSION_ID")
    SELECT rp."ROLE_ID", perm_approve
    FROM "ROLE_PERMISSION" rp JOIN "PERMISSION" p ON p."ID" = rp."PERMISSION_ID"
    WHERE p."KEY" = 'employees.bookings.view_all'
  ON CONFLICT DO NOTHING;

  -- Verwalten (Arten/Anspruch): Rollen, die Stammdaten pflegen
  INSERT INTO "ROLE_PERMISSION" ("ROLE_ID","PERMISSION_ID")
    SELECT rp."ROLE_ID", perm_manage
    FROM "ROLE_PERMISSION" rp JOIN "PERMISSION" p ON p."ID" = rp."PERMISSION_ID"
    WHERE p."KEY" = 'settings.basedata.edit'
  ON CONFLICT DO NOTHING;
END $$;
