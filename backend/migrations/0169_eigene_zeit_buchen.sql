-- ============================================================================
-- 0169_eigene_zeit_buchen.sql — Recht „Eigene Zeit buchen“ (UI-Pilot Runde 2)
--
-- WARUM
--   Die Default-Rolle „Mitarbeiter“ heisst laut Beschreibung „Basis-Zugriff:
--   Übersicht + eigene Stunden“, hat aber kein Buchungsrecht. Wer Zeit buchen
--   soll, bekam bisher `projects.bookings.create` — und damit das Buchen fuer
--   JEDEN Mitarbeiter samt freiem Stundensatz — plus `projects.view`, also
--   Honorare und Strukturen aller Projekte.
--
--   `projects.bookings.own` erlaubt genau das Eigene:
--     * Buchen nur fuer sich selbst (EMPLOYEE_ID kommt aus der Sitzung),
--       Saetze setzt der Server,
--     * Aendern/Loeschen nur eigener, unabgerechneter Buchungen in offenen
--       Monaten, ohne Projektwechsel (Umbuchen bleibt `rebook`),
--     * Projekte und Leistungen ueber eine schlanke Auswahlliste ohne Betraege
--       (GET /buchungen/eigen/projekte[/:id/leistungen]).
--
-- DEFAULT-ROLLEN
--   Mitarbeiter (neu) und alle Rollen, die heute schon buchen duerfen
--   (`projects.bookings.create`) — niemand verliert etwas. Neue Mandanten:
--   seedTenantRbacAndAssignAdmin (routes/auth.js); der Projektleiter bekommt
--   es dort ueber byModule(["projects"]), der Mitarbeiter ueber byKey.
--
-- LIZENZ
--   Gehoert zur Capability core.time_tracking (capabilities.manifest.js,
--   Seed 0070b wird von `npm run license:gen` erzeugt).
-- ============================================================================

-- RLS: "USER_ROLE" traegt TENANT_ID (FORCE, fail-closed). Ohne Claim fände
-- das SELECT unten keine Rolle, und die Migration meldete trotzdem Erfolg
-- (so ist 0136 gescheitert). Siehe CLAUDE.md, Database conventions.
SET request.jwt.claims = $CLAIM${"sys":"true"}$CLAIM$;

INSERT INTO "PERMISSION" ("KEY", "MODULE", "ACTION", "LABEL_DE", "DESCRIPTION_DE", "CATEGORY", "POSITION") VALUES
('projects.bookings.own', 'projects', 'create', 'Eigene Zeit buchen',
 'Eigene Stunden auf laufende Projekte buchen, eigene noch nicht abgerechnete Buchungen ändern und löschen – ohne Einblick in Honorare und andere Projektdaten.',
 'editing', 236)
ON CONFLICT ("KEY") DO UPDATE SET
  "LABEL_DE"       = EXCLUDED."LABEL_DE",
  "DESCRIPTION_DE" = EXCLUDED."DESCRIPTION_DE",
  "MODULE"         = EXCLUDED."MODULE",
  "ACTION"         = EXCLUDED."ACTION",
  "CATEGORY"       = EXCLUDED."CATEGORY",
  "POSITION"       = EXCLUDED."POSITION";

DO $$
DECLARE
  perm_own    INT;
  perm_create INT;
BEGIN
  SELECT "ID" INTO perm_own    FROM "PERMISSION" WHERE "KEY" = 'projects.bookings.own';
  SELECT "ID" INTO perm_create FROM "PERMISSION" WHERE "KEY" = 'projects.bookings.create';

  -- Rolle „Mitarbeiter“ jedes Mandanten (Namen seit 0154: "ABBR")
  INSERT INTO "ROLE_PERMISSION" ("ROLE_ID", "PERMISSION_ID")
    SELECT "ID", perm_own
    FROM "USER_ROLE"
    WHERE "IS_SYSTEM" = TRUE AND "ABBR" = 'Mitarbeiter'
  ON CONFLICT DO NOTHING;

  -- Jede Rolle, die heute schon buchen darf
  INSERT INTO "ROLE_PERMISSION" ("ROLE_ID", "PERMISSION_ID")
    SELECT rp."ROLE_ID", perm_own
    FROM "ROLE_PERMISSION" rp
    WHERE rp."PERMISSION_ID" = perm_create
  ON CONFLICT DO NOTHING;

  RAISE NOTICE 'projects.bookings.own: % Rollenzuweisungen', (
    SELECT count(*) FROM "ROLE_PERMISSION" rp WHERE rp."PERMISSION_ID" = perm_own
  );
END $$;

RESET request.jwt.claims;
