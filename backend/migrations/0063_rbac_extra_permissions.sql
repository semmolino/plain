-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 0063: RBAC Extra Permissions (Phase 6)
-- ─────────────────────────────────────────────────────────────────────────────
-- Erweitert den Permission-Katalog um die vom User definierten Spezial-
-- Berechtigungen. Default-Rollen werden so erweitert, dass Administrator
-- alles bekommt; weitere Rollen sinnvoll vorbestueckt.
-- ─────────────────────────────────────────────────────────────────────────────

INSERT INTO "PERMISSION" ("KEY", "MODULE", "ACTION", "LABEL_DE", "DESCRIPTION_DE", "CATEGORY", "POSITION") VALUES
('dashboard.view_switch',          'dashboard', 'edit',   'Dashboard-Ansicht wechseln',      'Persoenliche / GL / Controller-Ansicht waehlen',                                'editing',     11),

('projects.performance.snapshot',  'projects',  'create', 'Projekt-Snapshot erstellen',      'Leistungsstand als persistenten Snapshot dokumentieren',                        'editing',     222),

('projects.bookings.revenue.view', 'projects',  'view',   'Buchungen: Erloese sehen',        'Spalten Stunden zur Abrechnung + Erloes / Felder Stunden ext. + Stundensatz',   'reading',     234),
('projects.bookings.costs.view',   'projects',  'view',   'Buchungen: Kosten sehen',         'Spalte Kosten / Feld Kostensatz',                                              'reading',     235),

('payments.view',                  'invoices',  'view',   'Zahlungen sehen',                 'Erfasste Zahlungen zu Rechnungen anzeigen',                                    'reading',     412),
('payments.create',                'invoices',  'create', 'Zahlungen anlegen',               '',                                                                              'editing',     413),
('payments.edit',                  'invoices',  'edit',   'Zahlungen bearbeiten',            '',                                                                              'editing',     414),
('payments.delete',                'invoices',  'delete', 'Zahlungen loeschen',              '',                                                                              'destructive', 415),

('reports.scope.all',              'reports',   'view',   'Reporting: alle Projekte',        'Ohne diese Permission werden Listen auf Projekte gefiltert, in denen der User Projektleiter ist', 'reading', 302)

ON CONFLICT ("KEY") DO UPDATE SET
  "LABEL_DE"       = EXCLUDED."LABEL_DE",
  "DESCRIPTION_DE" = EXCLUDED."DESCRIPTION_DE",
  "MODULE"         = EXCLUDED."MODULE",
  "ACTION"         = EXCLUDED."ACTION",
  "CATEGORY"       = EXCLUDED."CATEGORY",
  "POSITION"       = EXCLUDED."POSITION";


-- ── Default-Rollen-Zuweisungen ──────────────────────────────────────────────
-- Administrator: alles. Andere Rollen gemaess sinnvollem Default.

DO $$
DECLARE
  perm_dashboard_switch INT;
  perm_snapshot         INT;
  perm_revenue          INT;
  perm_costs            INT;
  perm_payments_view    INT;
  perm_payments_create  INT;
  perm_payments_edit    INT;
  perm_payments_delete  INT;
  perm_reports_all      INT;
BEGIN
  SELECT "ID" INTO perm_dashboard_switch FROM "PERMISSION" WHERE "KEY" = 'dashboard.view_switch';
  SELECT "ID" INTO perm_snapshot         FROM "PERMISSION" WHERE "KEY" = 'projects.performance.snapshot';
  SELECT "ID" INTO perm_revenue          FROM "PERMISSION" WHERE "KEY" = 'projects.bookings.revenue.view';
  SELECT "ID" INTO perm_costs            FROM "PERMISSION" WHERE "KEY" = 'projects.bookings.costs.view';
  SELECT "ID" INTO perm_payments_view    FROM "PERMISSION" WHERE "KEY" = 'payments.view';
  SELECT "ID" INTO perm_payments_create  FROM "PERMISSION" WHERE "KEY" = 'payments.create';
  SELECT "ID" INTO perm_payments_edit    FROM "PERMISSION" WHERE "KEY" = 'payments.edit';
  SELECT "ID" INTO perm_payments_delete  FROM "PERMISSION" WHERE "KEY" = 'payments.delete';
  SELECT "ID" INTO perm_reports_all      FROM "PERMISSION" WHERE "KEY" = 'reports.scope.all';

  -- Administrator (System-Rolle): alle neuen Permissions
  INSERT INTO "ROLE_PERMISSION" ("ROLE_ID","PERMISSION_ID")
    SELECT "ID", unnest(ARRAY[
      perm_dashboard_switch, perm_snapshot, perm_revenue, perm_costs,
      perm_payments_view, perm_payments_create, perm_payments_edit, perm_payments_delete,
      perm_reports_all
    ])
    FROM "USER_ROLE" WHERE "IS_SYSTEM" = TRUE AND "NAME_SHORT" = 'Administrator'
  ON CONFLICT DO NOTHING;

  -- Geschaeftsleitung: Ansicht-Wechsel + Erloese + Kosten + Reports Scope + Zahlungen sehen
  INSERT INTO "ROLE_PERMISSION" ("ROLE_ID","PERMISSION_ID")
    SELECT "ID", unnest(ARRAY[
      perm_dashboard_switch, perm_revenue, perm_costs,
      perm_reports_all, perm_payments_view
    ])
    FROM "USER_ROLE" WHERE "IS_SYSTEM" = TRUE AND "NAME_SHORT" = 'Geschäftsleitung'
  ON CONFLICT DO NOTHING;

  -- Projektleiter: Snapshot + Erloese + Kosten + Zahlungen anlegen/bearbeiten
  -- (Reports.scope.all KEIN Default — Projektleiter sehen erstmal nur eigene)
  INSERT INTO "ROLE_PERMISSION" ("ROLE_ID","PERMISSION_ID")
    SELECT "ID", unnest(ARRAY[
      perm_snapshot, perm_revenue, perm_costs,
      perm_payments_view, perm_payments_create, perm_payments_edit
    ])
    FROM "USER_ROLE" WHERE "IS_SYSTEM" = TRUE AND "NAME_SHORT" = 'Projektleiter'
  ON CONFLICT DO NOTHING;

  -- Buchhaltung: Erloese + Reports Scope + Zahlungen voll
  INSERT INTO "ROLE_PERMISSION" ("ROLE_ID","PERMISSION_ID")
    SELECT "ID", unnest(ARRAY[
      perm_revenue, perm_reports_all,
      perm_payments_view, perm_payments_create, perm_payments_edit, perm_payments_delete
    ])
    FROM "USER_ROLE" WHERE "IS_SYSTEM" = TRUE AND "NAME_SHORT" = 'Buchhaltung'
  ON CONFLICT DO NOTHING;

  -- Mitarbeiter Default-Rolle: keine der neuen Permissions
  -- (keine Erloese, keine Kosten, keine Snapshots, keine Payments)
END $$;
