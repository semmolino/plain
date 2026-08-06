-- ============================================================================
-- 03_rls_postgrest.sql — Mandantentrennung auf Datenbankebene scharf schalten
--
-- AUSGANGSLAGE
--   Migration 0001 hat 26 RLS-Policies gebaut, die ueber current_tenant_id()
--   filtern. Sie sind heute WIRKUNGSLOS, weil das Backend den Supabase-
--   Service-Key benutzt und RLS damit komplett umgeht. Genau daraus resultiert
--   die Cross-Tenant-Fehlerklasse aus dem Pentest vom 06.08.2026.
--
-- ZIEL
--   Nach diesem Skript filtert die DATENBANK, nicht die Anwendung. Ein
--   vergessenes .eq('TENANT_ID', …) im Anwendungscode fuehrt dann zu einem
--   leeren Ergebnis statt zu einem Datenleck.
--
-- REIHENFOLGE
--   Erst NACH dem Schema-Restore auf Scalingo ausfuehren. Vorher 01_inventory
--   laufen lassen — Abschnitt 6 und 7 zeigen, welche Policies existieren.
--
-- ACHTUNG
--   Dieses Skript aendert das Zugriffsverhalten grundlegend. Auf einer Kopie
--   testen, nicht auf produktiven Daten.
-- ============================================================================


-- ════════════════════════════════════════════════════════════════════════════
-- TEIL 1 — Rollen fuer PostgREST
-- ════════════════════════════════════════════════════════════════════════════
-- PostgREST meldet sich als "authenticator" an und wechselt dann per SET ROLE
-- auf die Rolle aus dem role-Claim des JWT. Drei Rollen werden gebraucht:
--
--   plain_app    — der Normalfall. RLS gilt. Sieht nur den eigenen Mandanten.
--   plain_system — fuer die wenigen Vorgaenge, die mandantenuebergreifend
--                  laufen MUESSEN (Signup legt einen neuen Tenant an; die
--                  sechs Hintergrund-Checker iterieren ueber alle Mandanten).
--   authenticator— reine Anmelderolle, besitzt selbst keine Rechte.
--
-- <PASSWORT> vor dem Ausfuehren ersetzen.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'plain_app') THEN
    CREATE ROLE plain_app NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'plain_system') THEN
    CREATE ROLE plain_system NOLOGIN BYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticator') THEN
    CREATE ROLE authenticator LOGIN NOINHERIT PASSWORD '<PASSWORT>';
  END IF;
END
$$;

GRANT plain_app,  plain_system TO authenticator;
GRANT USAGE ON SCHEMA public TO plain_app, plain_system;

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES    IN SCHEMA public TO plain_app, plain_system;
GRANT USAGE, SELECT                  ON ALL SEQUENCES IN SCHEMA public TO plain_app, plain_system;
GRANT EXECUTE                        ON ALL FUNCTIONS IN SCHEMA public TO plain_app, plain_system;

-- Kuenftige Objekte automatisch mit berechtigen, sonst brechen neue
-- Migrationen den Zugriff.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES    TO plain_app, plain_system;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT                  ON SEQUENCES TO plain_app, plain_system;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT EXECUTE                        ON FUNCTIONS TO plain_app, plain_system;


-- ════════════════════════════════════════════════════════════════════════════
-- TEIL 2 — current_tenant_id() auf PostgREST umstellen
-- ════════════════════════════════════════════════════════════════════════════
-- ALT (Supabase):  auth.jwt() -> 'app_metadata' ->> 'tenant_id'
--   Das Schema "auth" existiert bei Scalingo nicht — die Funktion wuerde
--   bei jedem Aufruf einen Fehler werfen.
--
-- NEU (PostgREST): current_setting('request.jwt.claims')
--   PostgREST legt die JWT-Claims pro Request als GUC ab. Der zweite
--   Parameter true von current_setting sorgt dafuer, dass ausserhalb eines
--   Requests (psql, Migrationen, Wartung) NULL statt eines Fehlers kommt.
--
-- WICHTIG: NULL bedeutet "kein Mandant" -> die Policies liefern null Zeilen.
--   Das ist die sichere Richtung (fail-closed).
--
-- Kein SECURITY DEFINER mehr: die Funktion liest nur eine Session-Variable,
-- erhoehte Rechte waeren unnoetiges Risiko.

CREATE OR REPLACE FUNCTION public.current_tenant_id()
RETURNS integer
LANGUAGE sql
STABLE
AS $$
  SELECT NULLIF(
           current_setting('request.jwt.claims', true)::json ->> 'tenant_id',
           ''
         )::integer
$$;

COMMENT ON FUNCTION public.current_tenant_id() IS
  'Mandanten-ID aus dem PostgREST-JWT (Claim tenant_id). NULL ausserhalb eines '
  'Requests -> RLS-Policies liefern dann keine Zeilen (fail-closed).';


-- ════════════════════════════════════════════════════════════════════════════
-- TEIL 3 — RLS auf allen Mandantentabellen aktivieren
-- ════════════════════════════════════════════════════════════════════════════
-- Erzeugt fuer JEDE Tabelle mit TENANT_ID eine Policy, die Lesen und Schreiben
-- auf den eigenen Mandanten beschraenkt.
--
--   USING       -> welche Zeilen sichtbar/aenderbar sind (SELECT/UPDATE/DELETE)
--   WITH CHECK  -> welche Zeilen geschrieben werden duerfen (INSERT/UPDATE)
--
-- Das WITH CHECK ist der Teil, der das Schreiben in fremde Mandanten
-- verhindert — genau der Pentest-Befund bei POST /buchungen, wo die TENANT_ID
-- aus der mitgeschickten PROJECT_ID abgeleitet wurde.
--
-- FORCE ROW LEVEL SECURITY sorgt dafuer, dass die Policies auch fuer den
-- Tabelleneigentuemer gelten — ohne das umgeht der Owner sie stillschweigend.

DO $$
DECLARE
  t record;
BEGIN
  FOR t IN
    SELECT c.relname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind = 'r'
      AND EXISTS (
        SELECT 1 FROM information_schema.columns col
        WHERE col.table_schema = 'public'
          AND col.table_name   = c.relname
          AND col.column_name  = 'TENANT_ID'
      )
    ORDER BY c.relname
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',  t.relname);
    EXECUTE format('ALTER TABLE public.%I FORCE  ROW LEVEL SECURITY',  t.relname);

    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON public.%I', t.relname);
    EXECUTE format($f$
      CREATE POLICY tenant_isolation ON public.%I
        FOR ALL
        TO plain_app
        USING      ("TENANT_ID" = public.current_tenant_id())
        WITH CHECK ("TENANT_ID" = public.current_tenant_id())
    $f$, t.relname);

    RAISE NOTICE 'RLS aktiv: %', t.relname;
  END LOOP;
END
$$;


-- ════════════════════════════════════════════════════════════════════════════
-- TEIL 4 — Nachweis, dass es wirkt
-- ════════════════════════════════════════════════════════════════════════════
-- Nach dem Umbau ausfuehren. Erwartetes Ergebnis in den Kommentaren.

-- (a) Ohne Claim -> keine Zeilen. Das ist der fail-closed-Nachweis.
SET ROLE plain_app;
SELECT count(*) AS muss_0_sein FROM "PROJECT";
RESET ROLE;

-- (b) Mit Claim -> nur der eigene Mandant.
--     <TENANT_ID> durch eine echte ID ersetzen.
SET ROLE plain_app;
SELECT set_config('request.jwt.claims', '{"role":"plain_app","tenant_id":<TENANT_ID>}', true);
SELECT "TENANT_ID", count(*)
  FROM "PROJECT"
 GROUP BY "TENANT_ID";   -- darf GENAU EINE Zeile liefern
RESET ROLE;

-- (c) Schreiben in einen fremden Mandanten muss scheitern.
--     Erwartung: ERROR  new row violates row-level security policy
SET ROLE plain_app;
SELECT set_config('request.jwt.claims', '{"role":"plain_app","tenant_id":<TENANT_ID>}', true);
-- INSERT INTO "PROJECT" ("TENANT_ID", "NAME_SHORT") VALUES (<FREMDE_TENANT_ID>, 'hack');
RESET ROLE;

-- (d) Systemrolle sieht weiterhin alles (fuer Signup und Hintergrund-Checker).
SET ROLE plain_system;
SELECT count(DISTINCT "TENANT_ID") AS alle_mandanten FROM "PROJECT";
RESET ROLE;


-- ════════════════════════════════════════════════════════════════════════════
-- TEIL 5 — Was im Anwendungscode noch angepasst werden muss
-- ════════════════════════════════════════════════════════════════════════════
--
-- 1. Das Backend stellt pro Request ein PostgREST-JWT aus:
--        { role: 'plain_app', tenant_id: <req.tenantId>, exp: <kurz> }
--    signiert mit PGRST_JWT_SECRET. Dieses Token ersetzt den bisherigen
--    Service-Key im Supabase-Client. Sinnvoller Ort: eine Fabrik, die pro
--    Request einen Client liefert, statt des heute global geteilten Clients
--    in server.js:51-54.
--
-- 2. Die wenigen mandantenuebergreifenden Stellen bekommen role 'plain_system':
--        - POST /auth/signup            (legt einen neuen Tenant an)
--        - dueDateChecker, mahnungChecker, monatsabschluss,
--          nachtragFristenChecker, leistungsstandReminderChecker,
--          hoursBookingReminderChecker
--        - Owner-Konsole (eigener Prozess, eigene Verbindung)
--    Diese Liste ist bewusst kurz zu halten — jede Erweiterung schwaecht die
--    Trennung wieder auf.
--
-- 3. Tabellen OHNE TENANT_ID (globale Stammdaten wie VAT, BILLING_TYPE,
--    PERMISSION, LICENSE_PLAN) bekommen KEINE Policy, bleiben also fuer alle
--    lesbar. Schreibrechte darauf sollten plain_app entzogen werden:
--        REVOKE INSERT, UPDATE, DELETE ON "VAT", "BILLING_TYPE", "PERMISSION"
--          FROM plain_app;
--    Die exakte Liste liefert 01_inventory.sql, Abschnitt 2.
--
-- 4. ASSET hat laut Pentest keine TENANT_ID, sondern haengt ueber COMPANY_ID
--    am Mandanten. Dafuer ist eine eigene Policy noetig:
--        CREATE POLICY tenant_isolation ON "ASSET" FOR ALL TO plain_app
--          USING (EXISTS (SELECT 1 FROM "COMPANY" c
--                          WHERE c."ID" = "ASSET"."COMPANY_ID"
--                            AND c."TENANT_ID" = public.current_tenant_id()));
--    Das schliesst die vier ASSET-IDOR-Pfade aus dem Pentest auf einen Schlag.
-- ============================================================================
