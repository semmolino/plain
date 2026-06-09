-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 0062: RBAC Foundation (Phase 0)
-- ─────────────────────────────────────────────────────────────────────────────
-- Tabellen:
--   PERMISSION       = System-fester Permission-Katalog (~100 Eintraege)
--   USER_ROLE        = Pro Tenant definierbare Rollen
--   ROLE_PERMISSION  = Welche Permissions hat eine Rolle (n:m)
--   EMPLOYEE_ROLE    = Welche Rolle(n) hat ein Mitarbeiter (n:m)
--
-- Hinweis: das bestehende ROLE-Table ist fuer Stundensaetze (HOAI-Rollen),
-- voellig unabhaengig — daher der neue Name USER_ROLE.
--
-- Strategie:
--   1. Tabellen + Indizes erstellen
--   2. Permissions seeden (idempotent via ON CONFLICT)
--   3. Pro Tenant 5 Default-Rollen erzeugen (Administrator, Geschaeftsleitung,
--      Projektleiter, Buchhaltung, Mitarbeiter) -- nur falls noch nicht da
--   4. Bestehende Mitarbeiter automatisch auf Administrator setzen, damit
--      niemand ausgeschlossen wird (Foundation-Phase = noch kein Enforcement)
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Schema ────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "PERMISSION" (
  "ID"             SERIAL PRIMARY KEY,
  "KEY"            VARCHAR(100) UNIQUE NOT NULL,
  "MODULE"         VARCHAR(50)  NOT NULL,
  "ACTION"         VARCHAR(50)  NOT NULL,
  "LABEL_DE"       TEXT         NOT NULL,
  "DESCRIPTION_DE" TEXT,
  "CATEGORY"       VARCHAR(50),
  "POSITION"       INTEGER      NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_permission_module ON "PERMISSION"("MODULE");

CREATE TABLE IF NOT EXISTS "USER_ROLE" (
  "ID"          SERIAL PRIMARY KEY,
  "TENANT_ID"   INTEGER NOT NULL,
  "NAME_SHORT"  VARCHAR(80)  NOT NULL,
  "NAME_LONG"   TEXT,
  "COLOR"       VARCHAR(7),
  "IS_SYSTEM"   BOOLEAN NOT NULL DEFAULT FALSE,
  "IS_DEFAULT"  BOOLEAN NOT NULL DEFAULT FALSE,
  "CREATED_AT"  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "UPDATED_AT"  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE ("TENANT_ID", "NAME_SHORT")
);
CREATE INDEX IF NOT EXISTS idx_user_role_tenant ON "USER_ROLE"("TENANT_ID");

CREATE TABLE IF NOT EXISTS "ROLE_PERMISSION" (
  "ROLE_ID"       INTEGER NOT NULL REFERENCES "USER_ROLE"("ID") ON DELETE CASCADE,
  "PERMISSION_ID" INTEGER NOT NULL REFERENCES "PERMISSION"("ID") ON DELETE CASCADE,
  PRIMARY KEY ("ROLE_ID", "PERMISSION_ID")
);

CREATE TABLE IF NOT EXISTS "EMPLOYEE_ROLE" (
  "EMPLOYEE_ID"  INTEGER NOT NULL REFERENCES "EMPLOYEE"("ID") ON DELETE CASCADE,
  "ROLE_ID"      INTEGER NOT NULL REFERENCES "USER_ROLE"("ID") ON DELETE CASCADE,
  "ASSIGNED_AT"  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "ASSIGNED_BY"  INTEGER REFERENCES "EMPLOYEE"("ID"),
  PRIMARY KEY ("EMPLOYEE_ID", "ROLE_ID")
);
CREATE INDEX IF NOT EXISTS idx_employee_role_employee ON "EMPLOYEE_ROLE"("EMPLOYEE_ID");
CREATE INDEX IF NOT EXISTS idx_employee_role_role     ON "EMPLOYEE_ROLE"("ROLE_ID");


-- ── 2. Seed Permissions ─────────────────────────────────────────────────────

INSERT INTO "PERMISSION" ("KEY", "MODULE", "ACTION", "LABEL_DE", "DESCRIPTION_DE", "CATEGORY", "POSITION") VALUES
-- Übersicht
('dashboard.view',                   'dashboard',  'view',   'Übersicht sehen',                'Dashboard / Übersicht zeigen',                                 'reading',     10),

-- Adressen
('addresses.view',                   'addresses',  'view',   'Adressen sehen',                 'Adressliste und Detail',                                       'reading',     100),
('addresses.create',                 'addresses',  'create', 'Adressen anlegen',               '',                                                             'editing',     101),
('addresses.edit',                   'addresses',  'edit',   'Adressen bearbeiten',            '',                                                             'editing',     102),
('addresses.delete',                 'addresses',  'delete', 'Adressen löschen',               '',                                                             'destructive', 103),
('addresses.contacts.view',          'addresses',  'view',   'Kontakte sehen',                 'Personen-Kontakte zu Adressen',                                'reading',     104),
('addresses.contacts.create',        'addresses',  'create', 'Kontakte anlegen',               '',                                                             'editing',     105),
('addresses.contacts.edit',          'addresses',  'edit',   'Kontakte bearbeiten',            '',                                                             'editing',     106),
('addresses.contacts.delete',        'addresses',  'delete', 'Kontakte löschen',               '',                                                             'destructive', 107),

-- Projekte
('projects.view',                    'projects',   'view',   'Projekte sehen',                 'Projektliste und Projektdetails',                              'reading',     200),
('projects.create',                  'projects',   'create', 'Projekte anlegen',               '',                                                             'editing',     201),
('projects.edit',                    'projects',   'edit',   'Projekte bearbeiten',            'Stammdaten ändern',                                            'editing',     202),
('projects.delete',                  'projects',   'delete', 'Projekte löschen',               '',                                                             'destructive', 203),
('projects.structure.view',          'projects',   'view',   'Projektstruktur sehen',          'Hierarchische Projektgliederung',                              'reading',     210),
('projects.structure.edit',          'projects',   'edit',   'Projektstruktur bearbeiten',     'Phasen, Zuschläge, Kürzel',                                    'editing',     211),
('projects.performance.view',        'projects',   'view',   'Leistungsstände sehen',          '',                                                             'reading',     220),
('projects.performance.edit',        'projects',   'edit',   'Leistungsstände bearbeiten',     '',                                                             'editing',     221),
('projects.bookings.view',           'projects',   'view',   'Buchungen sehen',                'Alle Stunden-Buchungen im Projekt (eigene immer sichtbar)',    'reading',     230),
('projects.bookings.create',         'projects',   'create', 'Buchungen anlegen',              '',                                                             'editing',     231),
('projects.bookings.edit',           'projects',   'edit',   'Buchungen bearbeiten',           '',                                                             'editing',     232),
('projects.bookings.delete',         'projects',   'delete', 'Buchungen löschen',              '',                                                             'destructive', 233),
('projects.budget.view',             'projects',   'view',   'Interne Budgets sehen',          '',                                                             'reading',     240),
('projects.budget.edit',             'projects',   'edit',   'Interne Budgets bearbeiten',     '',                                                             'editing',     241),
('projects.hourly_rates.view',       'projects',   'view',   'Stundensätze sehen',             'Projekt-spezifische Stundensätze pro Rolle',                   'reading',     250),
('projects.hourly_rates.edit',       'projects',   'edit',   'Stundensätze bearbeiten',        '',                                                             'editing',     251),
('projects.calculations.view',       'projects',   'view',   'Kalkulationen sehen',            'HOAI-Honorarberechnungen',                                     'reading',     260),
('projects.calculations.edit',       'projects',   'edit',   'Kalkulationen bearbeiten',       '',                                                             'editing',     261),
('projects.calculations.delete',     'projects',   'delete', 'Kalkulationen löschen',          '',                                                             'destructive', 262),
('projects.contracts.view',          'projects',   'view',   'Verträge sehen',                 '',                                                             'reading',     270),
('projects.contracts.edit',          'projects',   'edit',   'Verträge bearbeiten',            'Auftragssummen, USt-Kategorie, etc.',                          'editing',     271),
('projects.contracts.delete',        'projects',   'delete', 'Verträge löschen',               '',                                                             'destructive', 272),

-- Reporting
('reports.view',                     'reports',    'view',   'Reporting sehen',                'Projekt-Reports, Auswertungen',                                'reading',     300),
('reports.export',                   'reports',    'export', 'Reports exportieren',            'CSV / Excel Download',                                         'editing',     301),

-- Rechnungen
('invoices.view',                    'invoices',   'view',   'Rechnungen sehen',               'Rechnungsliste und Detail',                                    'reading',     400),
('invoices.create_partial',          'invoices',   'create', 'Abschlagsrechnung anlegen',      '',                                                             'editing',     401),
('invoices.create_single',           'invoices',   'create', 'Einzelrechnung anlegen',         '',                                                             'editing',     402),
('invoices.create_final',            'invoices',   'create', 'Teil-/Schlussrechnung anlegen',  '',                                                             'editing',     403),
('invoices.create_credit',           'invoices',   'create', 'Gutschrift anlegen',             '',                                                             'editing',     404),
('invoices.edit',                    'invoices',   'edit',   'Rechnungsentwürfe bearbeiten',   '',                                                             'editing',     405),
('invoices.delete',                  'invoices',   'delete', 'Rechnungsentwürfe löschen',      '',                                                             'destructive', 406),
('invoices.book',                    'invoices',   'book',   'Rechnungen buchen',              'Entwurf → finale Rechnung',                                    'editing',     407),
('invoices.cancel',                  'invoices',   'cancel', 'Rechnungen stornieren',          'Erzeugt Storno-Rechnung',                                      'destructive', 408),
('invoices.send_email',              'invoices',   'send',   'Rechnungen per E-Mail senden',   '',                                                             'editing',     409),
('invoices.download_pdf',            'invoices',   'export', 'Rechnungs-PDF herunterladen',    '',                                                             'reading',     410),
('invoices.download_xml',            'invoices',   'export', 'E-Rechnungs-XML herunterladen',  'XRechnung / ZUGFeRD / Peppol',                                 'reading',     411),
('dunning.view',                     'dunning',    'view',   'Mahnungen sehen',                '',                                                             'reading',     420),
('dunning.edit',                     'dunning',    'edit',   'Mahnungen bearbeiten',           '',                                                             'editing',     421),
('dunning.send',                     'dunning',    'send',   'Mahnungen versenden',            '',                                                             'editing',     422),
('security_retention.view',          'invoices',   'view',   'Sicherheitseinbehalte sehen',    '',                                                             'reading',     430),

-- Angebote
('offers.view',                      'offers',     'view',   'Angebote sehen',                 '',                                                             'reading',     500),
('offers.create',                    'offers',     'create', 'Angebote anlegen',               '',                                                             'editing',     501),
('offers.edit',                      'offers',     'edit',   'Angebote bearbeiten',            '',                                                             'editing',     502),
('offers.delete',                    'offers',     'delete', 'Angebote löschen',               '',                                                             'destructive', 503),
('offers.send',                      'offers',     'send',   'Angebote versenden',             'PDF + E-Mail',                                                 'editing',     504),
('offers.convert',                   'offers',     'edit',   'Angebot in Projekt umwandeln',   '',                                                             'editing',     505),

-- Mitarbeiter
('employees.view',                   'employees',  'view',   'Mitarbeiter sehen',              'Mitarbeiterliste und Detail (eigenes Profil immer sichtbar)',  'reading',     600),
('employees.create',                 'employees',  'create', 'Mitarbeiter anlegen',            '',                                                             'editing',     601),
('employees.edit',                   'employees',  'edit',   'Mitarbeiter bearbeiten',         'Stammdaten — ohne Gehalt',                                     'editing',     602),
('employees.delete',                 'employees',  'delete', 'Mitarbeiter löschen',            '',                                                             'destructive', 603),
('employees.salary.view',            'employees',  'view',   'Gehalt sehen',                   'Sensibles Feld',                                               'reading',     610),
('employees.salary.edit',            'employees',  'edit',   'Gehalt bearbeiten',              '',                                                             'editing',     611),
('employees.bookings.view_all',      'employees',  'view',   'Buchungen aller Mitarbeiter',    'Ohne diese Permission nur eigene Buchungen sichtbar',          'reading',     620),
('employees.role.assign',            'employees',  'admin',  'Rollen zuweisen',                'Einem Mitarbeiter eine Rolle zuweisen',                        'administration', 630),
('employees.password.set',           'employees',  'admin',  'Passwörter setzen',              'Passwort fremder Mitarbeiter überschreiben',                   'administration', 631),
('employees.month_close.edit',       'employees',  'edit',   'Monatsabschluss bearbeiten',     'Monate schließen/wieder öffnen',                               'editing',     640),

-- Einstellungen
('settings.basedata.view',           'settings',   'view',   'Stammdaten sehen',               'Abteilungen, Typen, Rollen, Arbeitszeitmodelle',               'reading',     700),
('settings.basedata.edit',           'settings',   'edit',   'Stammdaten bearbeiten',          '',                                                             'editing',     701),
('settings.defaults.edit',           'settings',   'edit',   'Vorbelegungen bearbeiten',       'Default-USt, Default-Währung etc.',                            'editing',     710),
('settings.notifications.edit',      'settings',   'edit',   'Benachrichtigungen bearbeiten',  '',                                                             'editing',     720),
('settings.monthly_close.edit',      'settings',   'edit',   'Monatsabschluss-Einstellungen',  '',                                                             'editing',     730),
('settings.company.view',            'settings',   'view',   'Unternehmen sehen',              'Firmen-Stammdaten + Logo',                                     'reading',     740),
('settings.company.edit',            'settings',   'edit',   'Unternehmen bearbeiten',         '',                                                             'editing',     741),
('settings.numbers.edit',            'settings',   'edit',   'Nummernkreise bearbeiten',       '',                                                             'editing',     750),
('settings.text_templates.edit',     'settings',   'edit',   'Textvorlagen bearbeiten',        '',                                                             'editing',     760),
('settings.dunning_config.edit',     'settings',   'edit',   'Mahnungs-Einstellungen',         '',                                                             'editing',     770),
('settings.work_time.edit',          'settings',   'edit',   'Arbeitszeit-Einstellungen',      'ArbZG + Pausenregeln',                                         'editing',     780),
('settings.cost_rate.edit',          'settings',   'edit',   'Kostensatz-Rechner',             '',                                                             'editing',     790),

-- Rollen & Berechtigungen (Meta)
('roles.view',                       'roles',      'view',   'Rollen sehen',                   '',                                                             'administration', 900),
('roles.create',                     'roles',      'create', 'Rollen anlegen',                 '',                                                             'administration', 901),
('roles.edit',                       'roles',      'edit',   'Rollen bearbeiten',              'Inkl. Permission-Zuweisung',                                   'administration', 902),
('roles.delete',                     'roles',      'delete', 'Rollen löschen',                 '',                                                             'administration', 903)

ON CONFLICT ("KEY") DO UPDATE SET
  "LABEL_DE"       = EXCLUDED."LABEL_DE",
  "DESCRIPTION_DE" = EXCLUDED."DESCRIPTION_DE",
  "MODULE"         = EXCLUDED."MODULE",
  "ACTION"         = EXCLUDED."ACTION",
  "CATEGORY"       = EXCLUDED."CATEGORY",
  "POSITION"       = EXCLUDED."POSITION";


-- ── 3. Pro Tenant: 5 Default-Rollen erstellen ───────────────────────────────
-- Aufruf am Ende, nachdem Tabellen + Permissions stehen.

DO $$
DECLARE
  t RECORD;
  admin_role_id INT;
  gf_role_id INT;
  pl_role_id INT;
  bh_role_id INT;
  mi_role_id INT;
  all_permission_ids INT[];
  reading_permission_ids INT[];
BEGIN
  -- Alle Permissions als Arrays vorberechnen
  SELECT ARRAY_AGG("ID") INTO all_permission_ids FROM "PERMISSION";
  SELECT ARRAY_AGG("ID") INTO reading_permission_ids
    FROM "PERMISSION" WHERE "CATEGORY" = 'reading';

  FOR t IN SELECT DISTINCT "TENANT_ID" AS tid FROM "EMPLOYEE" WHERE "TENANT_ID" IS NOT NULL LOOP

    -- Administrator (alle Permissions)
    INSERT INTO "USER_ROLE" ("TENANT_ID","NAME_SHORT","NAME_LONG","COLOR","IS_SYSTEM","IS_DEFAULT")
      VALUES (t.tid, 'Administrator', 'Voller Zugriff auf alle Funktionen', '#dc2626', TRUE, FALSE)
      ON CONFLICT ("TENANT_ID","NAME_SHORT") DO UPDATE SET "IS_SYSTEM" = TRUE
      RETURNING "ID" INTO admin_role_id;
    INSERT INTO "ROLE_PERMISSION" ("ROLE_ID","PERMISSION_ID")
      SELECT admin_role_id, unnest(all_permission_ids)
      ON CONFLICT DO NOTHING;

    -- Geschäftsleitung (alles lesen + Reports + Rechnungen buchen, aber keine Settings-Aenderungen)
    INSERT INTO "USER_ROLE" ("TENANT_ID","NAME_SHORT","NAME_LONG","COLOR","IS_SYSTEM","IS_DEFAULT")
      VALUES (t.tid, 'Geschäftsleitung', 'Voller Lesezugriff, Rechnungen buchen, keine Konfiguration', '#7c3aed', TRUE, FALSE)
      ON CONFLICT ("TENANT_ID","NAME_SHORT") DO UPDATE SET "IS_SYSTEM" = TRUE
      RETURNING "ID" INTO gf_role_id;
    INSERT INTO "ROLE_PERMISSION" ("ROLE_ID","PERMISSION_ID")
      SELECT gf_role_id, "ID" FROM "PERMISSION"
      WHERE "CATEGORY" IN ('reading')
         OR "KEY" IN ('invoices.book','invoices.send_email','dunning.send','reports.export')
      ON CONFLICT DO NOTHING;

    -- Projektleiter (Projekte/Angebote voll, Rechnungen + Mahnungen voll, keine Mitarbeiter/Settings)
    INSERT INTO "USER_ROLE" ("TENANT_ID","NAME_SHORT","NAME_LONG","COLOR","IS_SYSTEM","IS_DEFAULT")
      VALUES (t.tid, 'Projektleiter', 'Projekte/Angebote/Rechnungen voll, keine Mitarbeiterverwaltung', '#2563eb', TRUE, FALSE)
      ON CONFLICT ("TENANT_ID","NAME_SHORT") DO UPDATE SET "IS_SYSTEM" = TRUE
      RETURNING "ID" INTO pl_role_id;
    INSERT INTO "ROLE_PERMISSION" ("ROLE_ID","PERMISSION_ID")
      SELECT pl_role_id, "ID" FROM "PERMISSION"
      WHERE "MODULE" IN ('dashboard','addresses','projects','reports','invoices','dunning','offers')
      ON CONFLICT DO NOTHING;

    -- Buchhaltung (Rechnungen + Mahnungen voll, Projekte/Angebote nur lesen, keine Mitarbeiter)
    INSERT INTO "USER_ROLE" ("TENANT_ID","NAME_SHORT","NAME_LONG","COLOR","IS_SYSTEM","IS_DEFAULT")
      VALUES (t.tid, 'Buchhaltung', 'Rechnungen/Mahnungen voll, Projekte/Angebote nur lesen', '#16a34a', TRUE, FALSE)
      ON CONFLICT ("TENANT_ID","NAME_SHORT") DO UPDATE SET "IS_SYSTEM" = TRUE
      RETURNING "ID" INTO bh_role_id;
    INSERT INTO "ROLE_PERMISSION" ("ROLE_ID","PERMISSION_ID")
      SELECT bh_role_id, "ID" FROM "PERMISSION"
      WHERE "MODULE" IN ('invoices','dunning','reports','addresses','dashboard')
         OR "KEY" IN ('projects.view','offers.view','employees.view')
      ON CONFLICT DO NOTHING;

    -- Mitarbeiter (Default — Dashboard, Adressen lesen, eigene Buchungen sind implizit)
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


-- ── 4. Bestehende Mitarbeiter → Administrator-Rolle ─────────────────────────
-- Foundation-Phase: niemand darf ausgesperrt werden.

INSERT INTO "EMPLOYEE_ROLE" ("EMPLOYEE_ID", "ROLE_ID", "ASSIGNED_AT")
SELECT e."ID", ur."ID", NOW()
FROM "EMPLOYEE" e
JOIN "USER_ROLE" ur
  ON ur."TENANT_ID" = e."TENANT_ID"
 AND ur."NAME_SHORT" = 'Administrator'
ON CONFLICT DO NOTHING;
