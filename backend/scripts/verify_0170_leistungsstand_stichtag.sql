-- ============================================================================
-- verify_0170_leistungsstand_stichtag.sql — Gegenprüfung nach 0170
--
-- AUSFUEHREN (rein lesend):
--   scalingo --app planandsimple run \
--     'psql "$SCALINGO_POSTGRESQL_URL" -f backend/scripts/verify_0170_leistungsstand_stichtag.sql'
--
-- Setzt den sys-Claim selbst: ohne ihn liefert PROJECT_PROGRESS unter
-- FORCE RLS null Zeilen, und „0 Verstoesse" saehe aus wie Erfolg.
--
-- Spalte "befund": OK / HINWEIS / FEHLER.
-- ============================================================================

SET request.jwt.claims = '{"sys":"true"}';

WITH
pp AS (SELECT * FROM "PROJECT_PROGRESS"),
ohne AS (SELECT count(*) AS n FROM pp WHERE "AS_OF_DATE" IS NULL),
zukunft AS (
  -- Stichtag nach dem Erfassungstag (Berlin): darf es nicht geben — ein Stand
  -- gilt nie fuer einen Tag, der beim Speichern noch nicht war.
  SELECT count(*) AS n FROM pp
  WHERE "AS_OF_DATE" > ("created_at" AT TIME ZONE 'Europe/Berlin')::date
),
fallend AS (
  -- Die Regel aus 0170: je Element steigt AS_OF_DATE in Erfassungsreihenfolge
  -- nie ab. Jeder Verstoss kann einen Stichtagsbericht verfaelschen.
  SELECT count(*) AS n FROM (
    SELECT "AS_OF_DATE",
           lag("AS_OF_DATE") OVER (PARTITION BY "TENANT_ID", "STRUCTURE_ID" ORDER BY "created_at", "ID") AS vorher
    FROM pp
  ) x WHERE x.vorher IS NOT NULL AND x."AS_OF_DATE" < x.vorher
),
idx AS (SELECT count(*) AS n FROM pg_indexes WHERE indexname = 'idx_project_progress_asof'),
spalten AS (
  SELECT count(*) AS n FROM information_schema.columns
  WHERE table_name = 'PROJECT' AND column_name IN ('PROGRESS_REVIEWED_AS_OF', 'PROGRESS_REVIEWED_AT', 'PROGRESS_REVIEWED_BY')
),
fn AS (
  SELECT count(*) AS n FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
  WHERE ns.nspname IN ('public', 'REPORTING')
    AND p.proname IN ('fn_project_report_header', 'fn_project_report_structure', 'fn_project_list_report',
                      'FN_REPORT_PROJECT_DETAIL', 'fn_dashboard_kpis', 'fn_wip_snapshot_dates')
    AND p.prosrc LIKE '%AS_OF_DATE%'
)
SELECT 'Zeilen ohne Stichtag' AS pruefung, (SELECT n FROM ohne)::text AS wert,
       CASE WHEN (SELECT n FROM ohne) = 0 THEN 'OK' ELSE 'FEHLER: Nachtrag unvollstaendig' END AS befund
UNION ALL
SELECT 'Stichtag nach Erfassungstag', (SELECT n FROM zukunft)::text,
       CASE WHEN (SELECT n FROM zukunft) = 0 THEN 'OK' ELSE 'FEHLER: Stand fuer einen kuenftigen Tag' END
UNION ALL
SELECT 'Stichtag faellt je Element', (SELECT n FROM fallend)::text,
       CASE WHEN (SELECT n FROM fallend) = 0 THEN 'OK' ELSE 'FEHLER: Regel aus 0170 verletzt — Schreibweg suchen' END
UNION ALL
SELECT 'Index idx_project_progress_asof', (SELECT n FROM idx)::text,
       CASE WHEN (SELECT n FROM idx) = 1 THEN 'OK' ELSE 'FEHLER: Index fehlt' END
UNION ALL
SELECT 'PROJECT.PROGRESS_REVIEWED_*', (SELECT n FROM spalten)::text,
       CASE WHEN (SELECT n FROM spalten) = 3 THEN 'OK' ELSE 'FEHLER: Spalten fehlen' END
UNION ALL
SELECT 'Berichtsfunktionen mit AS_OF_DATE', (SELECT n FROM fn)::text || ' von 6',
       CASE WHEN (SELECT n FROM fn) = 6 THEN 'OK' ELSE 'FEHLER: Funktion nicht ersetzt' END
UNION ALL
SELECT 'Projekte mit Monatsrunde-Vermerk',
       (SELECT count(*) FROM "PROJECT" WHERE "PROGRESS_REVIEWED_AS_OF" IS NOT NULL)::text,
       'HINWEIS: direkt nach dem Deploy 0, waechst mit der ersten Runde';

RESET request.jwt.claims;
