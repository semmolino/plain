-- ============================================================================
-- diagnose_wip_report.sql — warum ist „Teilfertige Leistungen" nicht sichtbar?
--
-- NUR LESEND. Ändert nichts, legt nichts an.
--
-- Einspielen:
--   scalingo --app planandsimple run \
--     'psql "$SCALINGO_POSTGRESQL_URL" -f backend/scripts/diagnose_wip_report.sql'
--
-- WARUM ES DIESE DATEI GIBT
--   Der Report ist im Code vollständig vorhanden (backend/services/wipReport.js,
--   routes/reports.js, pages/daten/TeilfertigeLeistungenTab.tsx). Er hängt aber
--   an DREI Toren, und jedes davon ist Datenbankzustand, nicht Code:
--
--     1. Permission  `reports.wip.view`      — Migration 0136
--     2. Permission  `reports.scope.all`     — der Endpunkt verlangt den vollen
--                                              Reporting-Scope (requireFullScope)
--     3. Capability  `reports.advanced`      — der Tab im Frontend ist zusätzlich
--                                              an dieses Lizenzmerkmal gebunden
--
--   Fehlt eines, verschwindet der Tab lautlos bzw. der Endpunkt antwortet 403.
--   Es gibt keine Fehlermeldung, die auf die Ursache zeigt.
--
-- DER CLAIM AM ANFANG IST NICHT OPTIONAL
--   psql trägt kein JWT. Ohne `request.jwt.claims` liefert JEDE Abfrage auf eine
--   Tabelle mit TENANT_ID null Zeilen — fail-closed durch RLS. Diese Prüfung
--   würde dann „nichts gefunden" melden, obwohl alles da ist. Genau diese
--   Blindheit hat Migration 0136 beim ersten Einspielen ins Leere laufen lassen
--   (siehe CLAUDE.md, Abschnitt „Migrationen laufen ohne Mandanten-Claim").
-- ============================================================================

SET request.jwt.claims = '{"sys":"true"}';

\echo ''
\echo '════════════════════════════════════════════════════════════════════'
\echo ' 1. TABELLEN — sind 0137 und 0138 eingespielt?'
\echo '════════════════════════════════════════════════════════════════════'

SELECT
  'WIP_CLOSING'                            AS erwartet,
  to_regclass('public."WIP_CLOSING"')      IS NOT NULL AS vorhanden,
  '0137'                                   AS aus_migration
UNION ALL SELECT
  'WIP_CLOSING_LINE',
  to_regclass('public."WIP_CLOSING_LINE"') IS NOT NULL,
  '0137'
UNION ALL SELECT
  'WIP_CLOSING.Steuerbilanz-Spalten',
  EXISTS (SELECT 1 FROM information_schema.columns
          WHERE table_name = 'WIP_CLOSING' AND column_name ILIKE '%TAX%'),
  '0138';

\echo ''
\echo '════════════════════════════════════════════════════════════════════'
\echo ' 2. PERMISSION — ist 0136 eingespielt, und haengt sie an einer Rolle?'
\echo '════════════════════════════════════════════════════════════════════'

SELECT "KEY", "MODULE", "ACTION", "LABEL_DE"
FROM "PERMISSION"
WHERE "KEY" IN ('reports.wip.view', 'reports.scope.all', 'reports.export')
ORDER BY "KEY";

\echo '-- ... und wie viele Rollen tragen sie? (0 = 0136 lief ins Leere)'

SELECT p."KEY",
       count(rp."ROLE_ID")                                   AS rollen_gesamt,
       count(rp."ROLE_ID") FILTER (WHERE ur."IS_SYSTEM")      AS davon_systemrollen
FROM "PERMISSION" p
LEFT JOIN "ROLE_PERMISSION" rp ON rp."PERMISSION_ID" = p."ID"
LEFT JOIN "USER_ROLE"       ur ON ur."ID"            = rp."ROLE_ID"
WHERE p."KEY" IN ('reports.wip.view', 'reports.scope.all')
GROUP BY p."KEY"
ORDER BY p."KEY";

\echo ''
\echo '════════════════════════════════════════════════════════════════════'
\echo ' 3. WER kann den Report tatsaechlich sehen? (beide Rechte zusammen)'
\echo '════════════════════════════════════════════════════════════════════'

SELECT e."TENANT_ID",
       e."ID"                AS employee_id,
       e."MAIL",
       e."ACTIVE",
       bool_or(p."KEY" = 'reports.wip.view')  AS hat_wip_view,
       bool_or(p."KEY" = 'reports.scope.all') AS hat_scope_all
FROM "EMPLOYEE" e
JOIN "EMPLOYEE_ROLE"   er ON er."EMPLOYEE_ID"  = e."ID"
JOIN "ROLE_PERMISSION" rp ON rp."ROLE_ID"      = er."ROLE_ID"
JOIN "PERMISSION"      p  ON p."ID"            = rp."PERMISSION_ID"
WHERE p."KEY" IN ('reports.wip.view', 'reports.scope.all')
GROUP BY e."TENANT_ID", e."ID", e."MAIL", e."ACTIVE"
HAVING bool_or(p."KEY" = 'reports.wip.view')
ORDER BY e."TENANT_ID", e."ID";

\echo '-- Leere Ausgabe = NIEMAND kommt an den Report. Dann ist Tor 1 oder 2 zu.'

\echo ''
\echo '════════════════════════════════════════════════════════════════════'
\echo ' 4. LIZENZ — ist reports.advanced angelegt und einem Plan zugeordnet?'
\echo '════════════════════════════════════════════════════════════════════'

SELECT "KEY", "NAME_DE", "TYPE"
FROM "LICENSE_CAPABILITY"
WHERE "KEY" = 'reports.advanced';

\echo '-- Leer = 0070b nicht (neu) eingespielt. Das versteckt den Tab.'

SELECT cp."CAPABILITY_KEY", cp."PERMISSION_KEY"
FROM "CAPABILITY_PERMISSION" cp
WHERE cp."CAPABILITY_KEY" = 'reports.advanced'
ORDER BY cp."PERMISSION_KEY";

\echo '-- Erwartet: reports.export, reports.scope.all, reports.wip.view'

SELECT lp."KEY" AS plan, pc."NUMERIC_LIMIT"
FROM "PLAN_CAPABILITY" pc
JOIN "LICENSE_PLAN" lp ON lp."ID" = pc."PLAN_ID"
WHERE pc."CAPABILITY_KEY" = 'reports.advanced'
ORDER BY lp."POSITION";

\echo '-- Leer = die Capability haengt an KEINEM Plan. Tab bleibt unsichtbar.'

\echo ''
\echo '════════════════════════════════════════════════════════════════════'
\echo ' 5. JE MANDANT: Plan, Zustand, und ob reports.advanced enthalten ist'
\echo '════════════════════════════════════════════════════════════════════'

-- Bewusst OHNE Join auf "TENANT": diese Tabelle ist aelter als die getrackten
-- Migrationen, ihre Spaltennamen sind hier nicht belegbar. TENANT_LICENSE,
-- LICENSE_PLAN und TENANT_ENTITLEMENT_OVERRIDE sind in 0070 definiert.
SELECT tl."TENANT_ID",
       lp."KEY"      AS plan,
       tl."STATE",
       EXISTS (
         SELECT 1 FROM "PLAN_CAPABILITY" pc
         WHERE pc."PLAN_ID" = tl."PLAN_ID"
           AND pc."CAPABILITY_KEY" = 'reports.advanced'
       )             AS plan_enthaelt_reports_advanced,
       (
         SELECT o."MODE" FROM "TENANT_ENTITLEMENT_OVERRIDE" o
         WHERE o."TENANT_ID" = tl."TENANT_ID"
           AND o."CAPABILITY_KEY" = 'reports.advanced'
           AND (o."EXPIRES_AT" IS NULL OR o."EXPIRES_AT" > NOW())
         LIMIT 1
       )             AS override
FROM "TENANT_LICENSE" tl
LEFT JOIN "LICENSE_PLAN" lp ON lp."ID" = tl."PLAN_ID"
ORDER BY tl."TENANT_ID";

\echo '-- Kein Eintrag fuer deinen Mandanten = keine TENANT_LICENSE-Zeile.'
\echo '-- Wie das ausgewertet wird, entscheidet backend/licensing — bei fehlender'
\echo '-- Zeile ist der Tarif nicht bestimmt, und der Tab kann darum verschwinden.'

\echo ''
\echo '════════════════════════════════════════════════════════════════════'
\echo ' 6. Liest der Report seine Quelle? (Sicht aus 0028/0030)'
\echo '════════════════════════════════════════════════════════════════════'

-- wipReport.js liest VW_REPORT_PROJECT_DETAIL, nicht PROJECT_PROGRESS direkt.
-- Fehlt die Sicht, laeuft der Report auf einen 500er statt leer zu bleiben.
SELECT 'VW_REPORT_PROJECT_DETAIL'                          AS sicht,
       to_regclass('public."VW_REPORT_PROJECT_DETAIL"') IS NOT NULL AS vorhanden;

\echo '-- false = Migration 0028/0030 fehlt. Dann ist nicht die Berechtigung'
\echo '-- das Problem, sondern die Datenquelle.'

RESET request.jwt.claims;

\echo ''
\echo '════════════════════════════════════════════════════════════════════'
\echo ' AUSWERTUNG'
\echo '════════════════════════════════════════════════════════════════════'
\echo ' Abschnitt 3 leer   -> 0136 neu einspielen (idempotent):'
\echo '   psql "$SCALINGO_POSTGRESQL_URL" -f backend/migrations/0136_rbac_wip_report.sql'
\echo ''
\echo ' Abschnitt 4 leer   -> 0070b neu einspielen (idempotent):'
\echo '   psql "$SCALINGO_POSTGRESQL_URL" -f backend/migrations/0070b_license_capabilities_seed.sql'
\echo ''
\echo ' Abschnitt 1 "false" -> 0137 bzw. 0138 einspielen'
\echo ''
\echo ' Danach diese Datei NOCHMAL laufen lassen. Ohne Gegenprobe mit'
\echo ' gesetztem Claim prueft man dieselbe Blindheit ein zweites Mal.'
\echo '════════════════════════════════════════════════════════════════════'
