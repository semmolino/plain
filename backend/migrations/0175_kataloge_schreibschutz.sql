-- ============================================================================
-- Migration 0175: CURRENCY, VAT und COUNTRY werden schreibgeschuetzt
--
-- WARUM
--   Die drei Kataloge gelten fuer alle Bueros und tragen keinen Mandanten.
--   Die Datenbank liess das Schreiben trotzdem zu: RLS stand aus der
--   Supabase-Zeit zwar an, aber ohne FORCE und ohne Policy — PostgREST
--   verbindet sich als Tabelleneigentuemer und ging an allem vorbei. Ein
--   Endpunkt, der dort schreibt, haette also fuer jedes Buero geschrieben.
--   Genau so hat POST /stammdaten/status in PROJECT_STATUS geschrieben (in
--   Runde 12 entfernt). Heute schreibt kein Code in diese Tabellen; der Schutz
--   soll das in der Datenbank festhalten, nicht nur dadurch, dass es keinen
--   Endpunkt gibt.
--
-- WIE
--   Dasselbe Muster wie PAYMENT_MEANS (0163): ENABLE + FORCE, lesen darf
--   jeder, schreiben nur ein Aufruf mit sys-Claim — also eine Migration. Ohne
--   FORCE waere der Schutz wirkungslos (siehe 0160).
--
-- WAS NICHT HIER STEHT
--   PROJECT_STATUS und OFFER_STATUS werden nicht schreibgeschuetzt, sondern
--   mandanteneigen — jedes Buero pflegt seine eigenen (Migration 0176).
-- ============================================================================

SET request.jwt.claims = '{"sys":"true"}';   -- is_system_request() -> true

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['CURRENCY', 'VAT', 'COUNTRY'] LOOP
    -- Eine Mandantenspalte waere ein Widerspruch zu "global" — dann lieber
    -- abbrechen, als einen Katalog stillschweigend fuer alle zu sperren.
    IF EXISTS (SELECT 1 FROM information_schema.columns
                WHERE table_schema = 'public' AND table_name = t AND column_name = 'TENANT_ID') THEN
      RAISE EXCEPTION 'Tabelle % hat eine Spalte TENANT_ID — erwartet war ein globaler Katalog.', t;
    END IF;

    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE public.%I FORCE  ROW LEVEL SECURITY', t);

    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', lower(t) || '_read',  t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', lower(t) || '_write', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT USING (true)', lower(t) || '_read', t);
    EXECUTE format($f$
      CREATE POLICY %I ON public.%I FOR ALL
        USING      (public.is_system_request())
        WITH CHECK (public.is_system_request())
    $f$, lower(t) || '_write', t);

    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'plain_app') THEN
      EXECUTE format('GRANT SELECT ON public.%I TO plain_app', t);
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'plain_system') THEN
      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO plain_system', t);
    END IF;
  END LOOP;
END $$;

-- Gegenprobe nach dem Einspielen (ohne Claim, in einer zurueckgerollten
-- Transaktion): SELECT liefert alle Zeilen, INSERT wird abgewiesen, UPDATE und
-- DELETE treffen null Zeilen — RLS-Normalverhalten, siehe 0163.
-- Skript: backend/scripts/verify_0175_0176_kataloge.sql

RESET request.jwt.claims;

NOTIFY pgrst, 'reload schema';
