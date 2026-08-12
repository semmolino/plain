-- ============================================================================
-- 05_rls_scalingo.sql — Mandantentrennung in der Datenbank erzwingen
--
-- Ersetzt 03_rls_postgrest.sql fuer den Betrieb bei Scalingo.
--
-- WARUM EINE EIGENE FASSUNG
--   03_rls_postgrest.sql legt die Rollen plain_app / plain_system /
--   authenticator an. Das setzt CREATEROLE voraus — der Scalingo-
--   Datenbankbenutzer hat das nicht:
--       Superuser: false   Create Role: false   Bypass RLS: false
--
--   Statt ueber Datenbankrollen laeuft die Trennung deshalb ueber die
--   JWT-Claims, die PostgREST je Request als GUC bereitstellt. Sicherheitlich
--   gleichwertig: die Claims sind signiert, das Geheimnis kennt nur das
--   Backend. FORCE ROW LEVEL SECURITY sorgt dafuer, dass die Policies auch
--   fuer den Tabelleneigentuemer gelten — ohne das wuerde der Eigentuemer sie
--   stillschweigend umgehen.
--
--   Verifiziert am 2026-08-07 gegen die migrierte Datenbank:
--       ohne Claim              -> 0 Zeilen  (fail-closed)
--       tenant_id=4             -> nur Mandant 4
--       INSERT fremder Mandant  -> abgewiesen
--       sys=true                -> alle Zeilen
--
-- ⚠ REIHENFOLGE
--   ERST den Datenimport abschliessen, DANN dieses Skript. Mit aktivem
--   FORCE RLS scheitert ein spaeterer \copy-Import, weil er ebenfalls als
--   Eigentuemer laeuft. Muss nochmal importiert werden: vorher Abschnitt 6
--   (Notausschalter) ausfuehren.
-- ============================================================================


-- ── 1. Mandant aus dem JWT ──────────────────────────────────────────────────
-- PostgREST legt die Claims pro Request als GUC "request.jwt.claims" ab.
-- Der zweite Parameter true von current_setting liefert NULL statt eines
-- Fehlers, wenn die Variable fehlt (psql, Wartung, Migrationen).
-- NULL bedeutet "kein Mandant" -> die Policies liefern keine Zeilen.

-- Das aeussere NULLIF ist nicht kosmetisch: current_setting liefert NULL nur,
-- wenn die Variable NIE gesetzt wurde. Wurde sie auf einen leeren Wert gesetzt
-- — set_config(..., NULL, ...) tut genau das, und PostgREST kann es bei einem
-- Request ohne Claims ebenfalls — kommt '' zurueck, und ''::json wirft
--     ERROR: invalid input syntax for type json
-- Ohne diese Absicherung waere der Zustand "kein Claim" also ein FEHLER statt
-- "keine Zeilen" — fail-error statt fail-closed, und damit das Gegenteil der
-- Absicht dieses Skripts.
CREATE OR REPLACE FUNCTION public.current_tenant_id()
RETURNS integer LANGUAGE sql STABLE AS $$
  SELECT NULLIF(
           NULLIF(current_setting('request.jwt.claims', true), '')::json ->> 'tenant_id',
           ''
         )::integer
$$;

COMMENT ON FUNCTION public.current_tenant_id() IS
  'Mandanten-ID aus dem PostgREST-JWT. NULL ausserhalb eines Requests -> RLS liefert keine Zeilen.';


-- ── 2. Systemzugriff ────────────────────────────────────────────────────────
-- Wenige Vorgaenge muessen mandantenuebergreifend arbeiten:
--   • POST /auth/signup            legt einen neuen Mandanten an
--   • die sechs Hintergrund-Checker iterieren ueber alle Mandanten
--   • die Owner-Konsole
-- Sie bekommen ein JWT mit "sys":"true". Diese Liste kurz zu halten IST die
-- Sicherheitsarbeit — jede Erweiterung schwaecht die Trennung wieder auf.

-- Gleiche Absicherung gegen den leeren Wert wie oben.
CREATE OR REPLACE FUNCTION public.is_system_request()
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT coalesce(
           NULLIF(current_setting('request.jwt.claims', true), '')::json ->> 'sys',
           ''
         ) = 'true'
$$;

COMMENT ON FUNCTION public.is_system_request() IS
  'true, wenn das JWT den Claim sys=true traegt. Nur fuer Signup, Hintergrund-Checker und Owner-Konsole.';


-- ── 3. RLS auf allen Tabellen mit TENANT_ID ─────────────────────────────────
--   USING      -> welche Zeilen sichtbar/aenderbar sind
--   WITH CHECK -> welche geschrieben werden duerfen
--
-- Das WITH CHECK ist der Teil, der das Schreiben in fremde Mandanten
-- verhindert — genau der Pentest-Befund bei POST /buchungen, wo die
-- TENANT_ID aus der mitgeschickten PROJECT_ID abgeleitet wurde.

DO $$
DECLARE t record; n int := 0;
BEGIN
  FOR t IN
    SELECT c.relname
    FROM pg_class c JOIN pg_namespace nsp ON nsp.oid = c.relnamespace
    WHERE nsp.nspname = 'public' AND c.relkind = 'r'
      AND EXISTS (SELECT 1 FROM information_schema.columns col
                  WHERE col.table_schema='public' AND col.table_name=c.relname
                    AND col.column_name='TENANT_ID')
    ORDER BY c.relname
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t.relname);
    EXECUTE format('ALTER TABLE public.%I FORCE  ROW LEVEL SECURITY', t.relname);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON public.%I', t.relname);
    EXECUTE format($f$
      CREATE POLICY tenant_isolation ON public.%I FOR ALL
        USING      ("TENANT_ID" = public.current_tenant_id() OR public.is_system_request())
        WITH CHECK ("TENANT_ID" = public.current_tenant_id() OR public.is_system_request())
    $f$, t.relname);
    n := n + 1;
  END LOOP;
  RAISE NOTICE 'RLS aktiv auf % Tabellen mit TENANT_ID', n;
END $$;


-- ── 4. ASSET — haengt ueber COMPANY am Mandanten ────────────────────────────
-- ASSET hat keine TENANT_ID, sondern eine COMPANY_ID. Genau daran haengen
-- vier IDOR-Pfade aus dem Pentest (Avatar, Firmenlogo, Branding-Hero,
-- E-Rechnungs-Anlage) — diese Policy schliesst alle vier auf einmal.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema='public' AND table_name='ASSET' AND column_name='COMPANY_ID') THEN
    EXECUTE 'ALTER TABLE public."ASSET" ENABLE ROW LEVEL SECURITY';
    EXECUTE 'ALTER TABLE public."ASSET" FORCE  ROW LEVEL SECURITY';
    EXECUTE 'DROP POLICY IF EXISTS tenant_isolation ON public."ASSET"';
    EXECUTE $p$
      CREATE POLICY tenant_isolation ON public."ASSET" FOR ALL
        USING (public.is_system_request() OR EXISTS (
          SELECT 1 FROM public."COMPANY" c
          WHERE c."ID" = "ASSET"."COMPANY_ID" AND c."TENANT_ID" = public.current_tenant_id()))
        WITH CHECK (public.is_system_request() OR EXISTS (
          SELECT 1 FROM public."COMPANY" c
          WHERE c."ID" = "ASSET"."COMPANY_ID" AND c."TENANT_ID" = public.current_tenant_id()))
    $p$;
    RAISE NOTICE 'RLS aktiv auf ASSET (ueber COMPANY_ID)';
  END IF;
END $$;


-- ── 5. Nachweis ─────────────────────────────────────────────────────────────
-- Laeuft automatisch mit und BRICHT AB, wenn die Trennung nicht greift. Ein
-- Skript, das die Policies anlegt und danach nur behauptet, sie wirkten, ist
-- die Muehe nicht wert — der Mandant wird hier aus den echten Daten gewaehlt
-- statt fest eingetragen, damit der Nachweis in jeder Umgebung laeuft.

DO $$
DECLARE
  t integer; n_alle integer; n_einer integer; n_ohne integer; verboten integer;
BEGIN
  -- (a) Systemzugriff sieht alles.
  PERFORM set_config('request.jwt.claims', '{"sys":"true"}', false);
  SELECT count(*) INTO n_alle FROM "PROJECT";
  SELECT "TENANT_ID" INTO t FROM "PROJECT"
    WHERE "TENANT_ID" IS NOT NULL GROUP BY "TENANT_ID" ORDER BY count(*) DESC LIMIT 1;

  -- (b) Mit Mandanten-Claim -> nur dessen Zeilen.
  PERFORM set_config('request.jwt.claims', json_build_object('tenant_id', t)::text, false);
  SELECT count(*) INTO n_einer FROM "PROJECT";
  SELECT count(*) INTO verboten FROM "PROJECT" WHERE "TENANT_ID" <> t;

  -- (c) Ohne Claim -> keine Zeile. Der eigentliche fail-closed-Nachweis.
  --     Bewusst der leere String, nicht NULL: genau diese Form hat den Fehler
  --     "invalid input syntax for type json" ausgeloest, bevor current_tenant_id()
  --     dagegen abgesichert wurde.
  PERFORM set_config('request.jwt.claims', '', false);
  SELECT count(*) INTO n_ohne FROM "PROJECT";

  RAISE NOTICE 'sys=true       -> % Zeilen (alle Mandanten)', n_alle;
  RAISE NOTICE 'tenant_id=%   -> % Zeilen, davon fremd: %', t, n_einer, verboten;
  RAISE NOTICE 'ohne Claim     -> % Zeilen', n_ohne;

  IF n_ohne <> 0 THEN
    RAISE EXCEPTION 'FAIL-CLOSED VERLETZT: ohne Claim sind % Zeilen sichtbar', n_ohne;
  END IF;
  IF verboten <> 0 THEN
    RAISE EXCEPTION 'MANDANTENTRENNUNG VERLETZT: % fremde Zeilen sichtbar', verboten;
  END IF;
  IF n_einer >= n_alle THEN
    RAISE EXCEPTION 'Filter greift nicht: mit Claim % Zeilen, ohne Filter %', n_einer, n_alle;
  END IF;

  RAISE NOTICE '✓ Mandantentrennung wirkt.';
END $$;

-- Sitzung wieder in den Ausgangszustand, damit nachfolgende Befehle in
-- derselben Verbindung nicht unbemerkt als Mandant % laufen.
SELECT set_config('request.jwt.claims', '', false);

-- (d) Schreiben in einen fremden Mandanten muss scheitern. Bewusst NICHT
--     automatisiert: der Versuch legt bei einem Fehler in den Policies eine
--     echte Zeile an. Von Hand ausfuehren, wenn du es sehen willst:
-- SELECT set_config('request.jwt.claims', '{"tenant_id":4}', false);
-- INSERT INTO "PROJECT" ("TENANT_ID","NAME_SHORT") VALUES (6,'verboten');
-- SELECT count(DISTINCT "TENANT_ID") FROM "PROJECT";

-- Uebersicht:
SELECT c.relname AS tabelle, c.relrowsecurity AS rls, c.relforcerowsecurity AS erzwungen
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='public' AND c.relkind='r' AND c.relrowsecurity
ORDER BY c.relname;


-- ── 6. Notausschalter ───────────────────────────────────────────────────────
-- Vor einem erneuten Datenimport ausfuehren — mit aktivem FORCE RLS scheitert
-- \copy, weil es ebenfalls als Eigentuemer laeuft. Danach dieses Skript
-- wieder anwenden.
--
-- DO $$
-- DECLARE t record;
-- BEGIN
--   FOR t IN SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
--            WHERE n.nspname='public' AND c.relkind='r' AND c.relrowsecurity
--   LOOP
--     EXECUTE format('ALTER TABLE public.%I NO FORCE ROW LEVEL SECURITY', t.relname);
--     EXECUTE format('ALTER TABLE public.%I DISABLE ROW LEVEL SECURITY', t.relname);
--   END LOOP;
-- END $$;


-- ── 7. Was im Anwendungscode noch fehlt ─────────────────────────────────────
--
-- 1. Das Backend stellt pro Request ein PostgREST-JWT aus:
--        { tenant_id: <req.tenantId>, exp: <kurz> }        Normalfall
--        { sys: "true", exp: <kurz> }                      Signup, Checker
--    signiert mit PGRST_JWT_SECRET. Es ersetzt den Service-Key im
--    Supabase-Client — statt eines global geteilten Clients (server.js:51-54)
--    braucht es eine Fabrik, die pro Request einen Client liefert.
--
-- 2. SUPABASE_URL zeigt auf http://127.0.0.1:3001 (PostgREST im selben
--    Container, siehe bin/start-web.sh).
--
-- 3. Globale Stammdaten ohne TENANT_ID (VAT, BILLING_TYPE, PERMISSION,
--    LICENSE_PLAN, …) bekommen KEINE Policy und bleiben fuer alle lesbar.
--    Schreibrechte darauf gehoeren perspektivisch entzogen.
-- ============================================================================
