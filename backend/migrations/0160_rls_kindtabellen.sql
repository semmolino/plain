-- ============================================================================
-- Migration 0160: Die zweite Linie fuer vier Kindtabellen ohne TENANT_ID
--
-- WARUM
--   05_rls_scalingo.sql schaltet RLS auf jeder Tabelle ein, die eine Spalte
--   TENANT_ID hat — das waren 86. Vier Tabellen gehoeren fachlich zu genau
--   einem Mandanten, tragen den Mandanten aber nicht selbst, sondern nur ueber
--   einen Fremdschluessel:
--
--       ROLE_PERMISSION         ROLE_ID     -> USER_ROLE.TENANT_ID
--       EMPLOYEE_ROLE           EMPLOYEE_ID -> EMPLOYEE.TENANT_ID
--                               ROLE_ID     -> USER_ROLE.TENANT_ID
--       BUDGET_WARNING_FIRED    RULE_ID     -> BUDGET_WARNING_RULE.TENANT_ID
--       SERVICE_REQUEST_MESSAGE REQUEST_ID  -> SERVICE_REQUEST.TENANT_ID
--
--   Die Schleife hat sie deshalb uebersprungen. Aus der Supabase-Zeit steht auf
--   ihnen noch ein ENABLE ROW LEVEL SECURITY (Migration 0001) — ohne FORCE und
--   ohne Policy. Beides zusammen heisst: der Tabelleneigentuemer geht daran
--   vorbei, und als Tabelleneigentuemer verbindet sich PostgREST (siehe db.js,
--   Abschnitt "Die Rolle im Token"). Faktisch ist die Trennung dort also
--   einlinig — sie haengt allein am .eq(...) in der Anwendung.
--
--   Heute sitzen diese Filter (geprueft am 2026-09-17: controllers/roles.js,
--   routes/service.js, services/budgetWarnings.js laden jeweils erst den
--   Elternsatz mandantengefiltert). Das ist kein Grund, es dabei zu belassen:
--   die zweite Linie existiert genau fuer den Tag, an dem einer dieser Filter
--   verloren geht. Bei diesen vier Tabellen waere das unmittelbar ein Leck —
--   und mit ROLE_PERMISSION und EMPLOYEE_ROLE haengen die beiden daran, ueber
--   die sich Rechte vergeben lassen.
--
-- WARUM KEINE TENANT_ID-SPALTE
--   Waere ebenfalls moeglich, kostet aber eine Datenmigration und schafft eine
--   zweite Wahrheit ueber denselben Sachverhalt: ab dann koennen Kind und
--   Elternsatz auseinanderlaufen, und jede der rund 30 Schreibstellen muesste
--   den Mandanten mitliefern (siehe CLAUDE.md zu .upsert() — genau diese Klasse
--   von Fehlern). Der Join ist die engere Aussage und braucht keine Pflege.
--   Das Muster gibt es im Projekt bereits: ASSET haengt ueber COMPANY_ID am
--   Mandanten und wird seit 05_rls_scalingo.sql (Abschnitt 4) so abgesichert.
--
-- WAS DAS FUER DIE AUFRUFSTELLEN HEISST
--   Nichts — solange sie in einem Request (Mandanten-Claim) oder unter
--   runAsSystem/systemScope (sys=true) laufen. Beides ist der Fall: der Login
--   und die Mandantenanlage haengen an systemScope (server.js), die Checker an
--   runAsSystem, alles uebrige am tenantScope der authChain.
--
-- REIHENFOLGE BEIM SCHREIBEN
--   USING und WITH CHECK pruefen den Elternsatz, nicht die eigene Zeile. Ein
--   INSERT mit fremder ROLE_ID scheitert damit an der Datenbank, nicht erst an
--   der Anwendung. Das ist der Teil, der den Pentest-Befund von POST /buchungen
--   auf diese vier Tabellen uebertraegt.
-- ============================================================================


-- ── 1. ROLE_PERMISSION ──────────────────────────────────────────────────────
-- PERMISSION_ID bleibt ungeprueft: der Rechtekatalog ist global und fuer alle
-- Mandanten derselbe. Geprueft wird die Rolle, denn sie traegt den Mandanten.

ALTER TABLE public."ROLE_PERMISSION" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."ROLE_PERMISSION" FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public."ROLE_PERMISSION";
CREATE POLICY tenant_isolation ON public."ROLE_PERMISSION" FOR ALL
  USING (
    public.is_system_request() OR EXISTS (
      SELECT 1 FROM public."USER_ROLE" r
      WHERE r."ID" = "ROLE_PERMISSION"."ROLE_ID"
        AND r."TENANT_ID" = public.current_tenant_id()))
  WITH CHECK (
    public.is_system_request() OR EXISTS (
      SELECT 1 FROM public."USER_ROLE" r
      WHERE r."ID" = "ROLE_PERMISSION"."ROLE_ID"
        AND r."TENANT_ID" = public.current_tenant_id()));


-- ── 2. EMPLOYEE_ROLE ────────────────────────────────────────────────────────
-- Hier werden BEIDE Enden geprueft. Nur den Mitarbeiter zu pruefen liesse zu,
-- dem eigenen Mitarbeiter eine fremde Rolle zuzuweisen — und damit deren
-- Rechte zu erben. Die Anwendung faengt das ab (controllers/roles.js:445);
-- eine zweite Linie, die den offensichtlicheren der beiden Wege offen laesst,
-- waere ihren Namen nicht wert.

ALTER TABLE public."EMPLOYEE_ROLE" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."EMPLOYEE_ROLE" FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public."EMPLOYEE_ROLE";
CREATE POLICY tenant_isolation ON public."EMPLOYEE_ROLE" FOR ALL
  USING (
    public.is_system_request() OR (
      EXISTS (SELECT 1 FROM public."EMPLOYEE" e
              WHERE e."ID" = "EMPLOYEE_ROLE"."EMPLOYEE_ID"
                AND e."TENANT_ID" = public.current_tenant_id())
      AND
      EXISTS (SELECT 1 FROM public."USER_ROLE" r
              WHERE r."ID" = "EMPLOYEE_ROLE"."ROLE_ID"
                AND r."TENANT_ID" = public.current_tenant_id())))
  WITH CHECK (
    public.is_system_request() OR (
      EXISTS (SELECT 1 FROM public."EMPLOYEE" e
              WHERE e."ID" = "EMPLOYEE_ROLE"."EMPLOYEE_ID"
                AND e."TENANT_ID" = public.current_tenant_id())
      AND
      EXISTS (SELECT 1 FROM public."USER_ROLE" r
              WHERE r."ID" = "EMPLOYEE_ROLE"."ROLE_ID"
                AND r."TENANT_ID" = public.current_tenant_id())));


-- ── 3. BUDGET_WARNING_FIRED ─────────────────────────────────────────────────

ALTER TABLE public."BUDGET_WARNING_FIRED" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."BUDGET_WARNING_FIRED" FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public."BUDGET_WARNING_FIRED";
CREATE POLICY tenant_isolation ON public."BUDGET_WARNING_FIRED" FOR ALL
  USING (
    public.is_system_request() OR EXISTS (
      SELECT 1 FROM public."BUDGET_WARNING_RULE" r
      WHERE r."ID" = "BUDGET_WARNING_FIRED"."RULE_ID"
        AND r."TENANT_ID" = public.current_tenant_id()))
  WITH CHECK (
    public.is_system_request() OR EXISTS (
      SELECT 1 FROM public."BUDGET_WARNING_RULE" r
      WHERE r."ID" = "BUDGET_WARNING_FIRED"."RULE_ID"
        AND r."TENANT_ID" = public.current_tenant_id()));


-- ── 4. SERVICE_REQUEST_MESSAGE ──────────────────────────────────────────────
-- REQUEST_ID traegt keinen Fremdschluessel (gewachsen, nie nachgezogen). Fuer
-- die Policy spielt das keine Rolle — sie prueft den Elternsatz, ob ein
-- Constraint ihn erzwingt oder nicht.
--
-- Die Owner-Konsole liest dieselbe Tabelle (owner-console/routes/serviceRequests.js),
-- geht dafuer aber ueber einen eigenen Client mit Service-Key an dieser Policy
-- vorbei. Sie ist von dieser Aenderung nicht betroffen.

ALTER TABLE public."SERVICE_REQUEST_MESSAGE" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."SERVICE_REQUEST_MESSAGE" FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public."SERVICE_REQUEST_MESSAGE";
CREATE POLICY tenant_isolation ON public."SERVICE_REQUEST_MESSAGE" FOR ALL
  USING (
    public.is_system_request() OR EXISTS (
      SELECT 1 FROM public."SERVICE_REQUEST" s
      WHERE s."ID" = "SERVICE_REQUEST_MESSAGE"."REQUEST_ID"
        AND s."TENANT_ID" = public.current_tenant_id()))
  WITH CHECK (
    public.is_system_request() OR EXISTS (
      SELECT 1 FROM public."SERVICE_REQUEST" s
      WHERE s."ID" = "SERVICE_REQUEST_MESSAGE"."REQUEST_ID"
        AND s."TENANT_ID" = public.current_tenant_id()));


-- ── 5. Nachweis ─────────────────────────────────────────────────────────────
-- Eine Migration, die Policies anlegt und danach nur behauptet, sie wirkten,
-- ist die Muehe nicht wert (dieselbe Begruendung wie in 05_rls_scalingo.sql).
-- Geprueft wird an ROLE_PERMISSION, weil die Tabelle in jeder Umgebung Zeilen
-- hat: das RBAC-Seeding legt sie beim Anlegen jedes Mandanten an.
--
-- Der Claim wird hier gesetzt, weil der Runner keinen mitbringt — ohne ihn
-- liefe die Pruefung gegen dieselbe Blindheit, die sie nachweisen soll
-- (siehe CLAUDE.md, Database conventions, und Migration 0136).

DO $$
DECLARE
  t integer; n_sys integer; n_einer integer; n_fremd integer; n_ohne integer;
BEGIN
  -- (a) Systemzugriff sieht alles.
  PERFORM set_config('request.jwt.claims', '{"sys":"true"}', false);
  SELECT count(*) INTO n_sys FROM "ROLE_PERMISSION";

  SELECT r."TENANT_ID" INTO t
  FROM "ROLE_PERMISSION" rp JOIN "USER_ROLE" r ON r."ID" = rp."ROLE_ID"
  WHERE r."TENANT_ID" IS NOT NULL
  GROUP BY r."TENANT_ID" ORDER BY count(*) DESC LIMIT 1;

  IF t IS NULL THEN
    RAISE NOTICE 'Keine Rollenrechte vorhanden — Nachweis uebersprungen (frische Datenbank).';
    PERFORM set_config('request.jwt.claims', '', false);
    RETURN;
  END IF;

  -- (b) Mit Mandanten-Claim: nur dessen Zeilen.
  PERFORM set_config('request.jwt.claims', json_build_object('tenant_id', t)::text, false);
  SELECT count(*) INTO n_einer FROM "ROLE_PERMISSION";
  SELECT count(*) INTO n_fremd
  FROM "ROLE_PERMISSION" rp JOIN "USER_ROLE" r ON r."ID" = rp."ROLE_ID"
  WHERE r."TENANT_ID" <> t;

  -- (c) Ohne Claim: keine Zeile. Der eigentliche fail-closed-Nachweis.
  --     Bewusst der leere String und nicht NULL — das ist die Form, die
  --     PostgREST bei einem Request ohne Claims hinterlaesst.
  PERFORM set_config('request.jwt.claims', '', false);
  SELECT count(*) INTO n_ohne FROM "ROLE_PERMISSION";

  RAISE NOTICE 'ROLE_PERMISSION  sys=true -> % Zeilen | tenant_id=% -> % Zeilen (fremd: %) | ohne Claim -> %',
    n_sys, t, n_einer, n_fremd, n_ohne;

  IF n_ohne <> 0 THEN
    RAISE EXCEPTION 'FAIL-CLOSED VERLETZT: ohne Claim sind % Zeilen in ROLE_PERMISSION sichtbar', n_ohne;
  END IF;
  IF n_fremd <> 0 THEN
    RAISE EXCEPTION 'MANDANTENTRENNUNG VERLETZT: mit tenant_id=% sind % fremde Zeilen sichtbar', t, n_fremd;
  END IF;
  IF n_einer = 0 THEN
    RAISE EXCEPTION 'ZU STRENG: mit tenant_id=% ist keine einzige eigene Zeile sichtbar', t;
  END IF;
END $$;

RESET request.jwt.claims;
