-- ============================================================================
-- 0136_rbac_wip_report.sql — Berechtigung fuer den Report „Teilfertige Leistungen"
--
-- WARUM EINE EIGENE PERMISSION
--   Der Report zeigt je Projekt die angefallenen Kosten, den Kostenanteil der
--   unfertigen Leistung und den nicht realisierten Gewinn — also die Marge.
--   Das ist eine kaufmaennische Abschlusszahl, nicht eine Projektkennzahl:
--   `reports.view` haetten damit auch alle Projektleiter, denn die Rolle
--   „Projektleiter" bekommt in 0062 pauschal alles aus MODULE='reports'.
--
-- DEFAULT-ROLLEN
--   Administrator, Geschaeftsleitung, Buchhaltung. Bewusst NICHT Projektleiter
--   und nicht die Default-Rolle „Mitarbeiter".
--
-- ZUSAMMENSPIEL MIT DEM REPORTING-SCOPE
--   Der Endpunkt verlangt zusaetzlich `reports.scope.all`. Eine auf die
--   eigenen Projekte gefilterte Abschlusssumme waere eine Zahl, die aussieht
--   wie eine Bilanzposition, aber keine ist — deshalb antwortet er in dem Fall
--   mit 403 statt mit einer Teilsumme. Alle drei Default-Rollen oben haben
--   `reports.scope.all` bereits aus 0062/0063.
--
-- FESTSCHREIBEN
--   Der schreibende Vorgang (POST /reports/wip/close) haengt an der
--   bestehenden `settings.monthly_close.edit` — Festschreiben ist
--   Abschlussarbeit, kein eigenes Recht.
--
-- EINSPIELEN
--   scalingo --app planandsimple run 'psql "$SCALINGO_POSTGRESQL_URL" -f backend/migrations/0136_rbac_wip_report.sql'
-- ============================================================================

-- ACHTUNG — RLS: dieses Skript liest "USER_ROLE", und die Tabelle traegt eine
-- TENANT_ID, ist also von der Policy tenant_isolation erfasst (FORCE ROW LEVEL
-- SECURITY, fail-closed ohne Claim). Ein psql-Lauf hat keinen JWT-Claim: ohne
-- die folgende Zeile liefert jedes SELECT auf USER_ROLE null Zeilen, die
-- Rollenzuweisung unten laeuft ins Leere — und die Migration meldet trotzdem
-- Erfolg. Genau das ist beim ersten Einspielen am 2026-09-04 passiert.
--
-- is_system_request() ist der dafuer vorgesehene Weg (05_rls_scalingo.sql).
-- Gilt fuer JEDE Migration, die mandantenbezogene Tabellen liest oder
-- beschreibt — siehe CLAUDE.md, Abschnitt Database conventions.
SET request.jwt.claims = $CLAIM${"sys":"true"}$CLAIM$;

INSERT INTO "PERMISSION" ("KEY", "MODULE", "ACTION", "LABEL_DE", "DESCRIPTION_DE", "CATEGORY", "POSITION") VALUES
('reports.wip.view', 'reports', 'view', 'Teilfertige Leistungen sehen',
 'Kaufmaennischer Abschluss-Report: unfertige Leistungen, erhaltene Anzahlungen, Kosten und Marge je Projekt',
 'reading', 303)
ON CONFLICT ("KEY") DO UPDATE SET
  "LABEL_DE"       = EXCLUDED."LABEL_DE",
  "DESCRIPTION_DE" = EXCLUDED."DESCRIPTION_DE",
  "MODULE"         = EXCLUDED."MODULE",
  "ACTION"         = EXCLUDED."ACTION",
  "CATEGORY"       = EXCLUDED."CATEGORY",
  "POSITION"       = EXCLUDED."POSITION";

DO $$
DECLARE
  perm_wip INT;
BEGIN
  SELECT "ID" INTO perm_wip FROM "PERMISSION" WHERE "KEY" = 'reports.wip.view';

  INSERT INTO "ROLE_PERMISSION" ("ROLE_ID","PERMISSION_ID")
    SELECT "ID", perm_wip
    FROM "USER_ROLE"
    WHERE "IS_SYSTEM" = TRUE
      AND "NAME_SHORT" IN ('Administrator', 'Geschäftsleitung', 'Buchhaltung')
  ON CONFLICT DO NOTHING;

  RAISE NOTICE 'reports.wip.view: % Rollenzuweisungen', (
    SELECT count(*) FROM "ROLE_PERMISSION" rp WHERE rp."PERMISSION_ID" = perm_wip
  );
END $$;

RESET request.jwt.claims;
