-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 0106: RBAC — Modul „Nachträge"
-- ─────────────────────────────────────────────────────────────────────────────
-- Neuer Permission-Satz nachtraege.*. Default-Rollen-Zuweisung:
--   Administrator      → alles
--   Geschäftsleitung   → view + release  (Entscheidungsstelle: darf beauftragen)
--   Projektleiter      → view/create/edit/submit/review/send  (Realisierungsstelle,
--                        bereitet vor & reicht ein — KEINE Freigabe per Default)
--   Buchhaltung        → view  (Abrechnungsbezug)
--   Mitarbeiter        → keine
--
-- Freigabe-Schwellenwert (Betragsgrenze je Rolle) ist bewusst NICHT Teil von N1;
-- release ist hier unbegrenzt. Grenze kann in einer späteren Phase als optionale
-- Einstellung ergänzt werden.
-- ─────────────────────────────────────────────────────────────────────────────

INSERT INTO "PERMISSION" ("KEY", "MODULE", "ACTION", "LABEL_DE", "DESCRIPTION_DE", "CATEGORY", "POSITION") VALUES
('nachtraege.view',    'nachtraege', 'view',   'Nachträge sehen',            'Nachtragsliste und Detail',                            'reading',     550),
('nachtraege.create',  'nachtraege', 'create', 'Nachträge anlegen',          '',                                                     'editing',     551),
('nachtraege.edit',    'nachtraege', 'edit',   'Nachträge bearbeiten',       'Kopf, Positionen, Fristen, Anspruchsgrundlage',        'editing',     552),
('nachtraege.submit',  'nachtraege', 'edit',   'Nachträge einreichen',       'Ankündigen / an die Gegenseite einreichen',            'editing',     553),
('nachtraege.review',  'nachtraege', 'edit',   'Nachträge prüfen',           'Prüfbarkeits-Checkliste / Prüfvermerk bearbeiten',     'editing',     554),
('nachtraege.release', 'nachtraege', 'edit',   'Nachträge freigeben',        'Beauftragen (Voll/Teil) → Übernahme ins Projekt',      'editing',     555),
('nachtraege.send',    'nachtraege', 'send',   'Nachträge versenden',        'PDF + E-Mail',                                         'editing',     556),
('nachtraege.delete',  'nachtraege', 'delete', 'Nachträge löschen',          'Nur im Entwurf',                                       'destructive', 557)

ON CONFLICT ("KEY") DO UPDATE SET
  "LABEL_DE"       = EXCLUDED."LABEL_DE",
  "DESCRIPTION_DE" = EXCLUDED."DESCRIPTION_DE",
  "MODULE"         = EXCLUDED."MODULE",
  "ACTION"         = EXCLUDED."ACTION",
  "CATEGORY"       = EXCLUDED."CATEGORY",
  "POSITION"       = EXCLUDED."POSITION";


-- ── Default-Rollen-Zuweisungen ──────────────────────────────────────────────

DO $$
DECLARE
  perm_view    INT;
  perm_create  INT;
  perm_edit    INT;
  perm_submit  INT;
  perm_review  INT;
  perm_release INT;
  perm_send    INT;
  perm_delete  INT;
BEGIN
  SELECT "ID" INTO perm_view    FROM "PERMISSION" WHERE "KEY" = 'nachtraege.view';
  SELECT "ID" INTO perm_create  FROM "PERMISSION" WHERE "KEY" = 'nachtraege.create';
  SELECT "ID" INTO perm_edit    FROM "PERMISSION" WHERE "KEY" = 'nachtraege.edit';
  SELECT "ID" INTO perm_submit  FROM "PERMISSION" WHERE "KEY" = 'nachtraege.submit';
  SELECT "ID" INTO perm_review  FROM "PERMISSION" WHERE "KEY" = 'nachtraege.review';
  SELECT "ID" INTO perm_release FROM "PERMISSION" WHERE "KEY" = 'nachtraege.release';
  SELECT "ID" INTO perm_send    FROM "PERMISSION" WHERE "KEY" = 'nachtraege.send';
  SELECT "ID" INTO perm_delete  FROM "PERMISSION" WHERE "KEY" = 'nachtraege.delete';

  -- Administrator (System-Rolle): alle nachtraege.*
  INSERT INTO "ROLE_PERMISSION" ("ROLE_ID","PERMISSION_ID")
    SELECT "ID", unnest(ARRAY[
      perm_view, perm_create, perm_edit, perm_submit,
      perm_review, perm_release, perm_send, perm_delete
    ])
    FROM "USER_ROLE" WHERE "IS_SYSTEM" = TRUE AND "NAME_SHORT" = 'Administrator'
  ON CONFLICT DO NOTHING;

  -- Geschäftsleitung: sehen + freigeben (Entscheidungsstelle)
  INSERT INTO "ROLE_PERMISSION" ("ROLE_ID","PERMISSION_ID")
    SELECT "ID", unnest(ARRAY[perm_view, perm_release])
    FROM "USER_ROLE" WHERE "IS_SYSTEM" = TRUE AND "NAME_SHORT" = 'Geschäftsleitung'
  ON CONFLICT DO NOTHING;

  -- Projektleiter: operative Bearbeitung (Realisierungsstelle), keine Freigabe
  INSERT INTO "ROLE_PERMISSION" ("ROLE_ID","PERMISSION_ID")
    SELECT "ID", unnest(ARRAY[
      perm_view, perm_create, perm_edit, perm_submit, perm_review, perm_send
    ])
    FROM "USER_ROLE" WHERE "IS_SYSTEM" = TRUE AND "NAME_SHORT" = 'Projektleiter'
  ON CONFLICT DO NOTHING;

  -- Buchhaltung: nur Ansicht (Abrechnungsbezug)
  INSERT INTO "ROLE_PERMISSION" ("ROLE_ID","PERMISSION_ID")
    SELECT "ID", unnest(ARRAY[perm_view])
    FROM "USER_ROLE" WHERE "IS_SYSTEM" = TRUE AND "NAME_SHORT" = 'Buchhaltung'
  ON CONFLICT DO NOTHING;

  -- Mitarbeiter Default-Rolle: keine nachtraege-Permission
END $$;
