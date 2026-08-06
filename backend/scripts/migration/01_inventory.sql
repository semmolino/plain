-- ============================================================================
-- 01_inventory.sql — Bestandsaufnahme der Supabase-Datenbank
--
-- ZWECK: Das Basis-Schema von plan&simple wurde seinerzeit von Hand in Supabase
--        angelegt; 18 der 19 Kerntabellen haben KEIN CREATE TABLE im Repo.
--        Dieses Skript macht sichtbar, was tatsaechlich existiert — die
--        Grundlage fuer Schema-Dump, Tenant-Export und Ladereihenfolge.
--
-- AUSFUEHREN: Supabase SQL Editor, Abschnitt fuer Abschnitt.
--             Rein lesend, veraendert nichts.
--
-- ERGEBNIS bitte sichern — Abschnitt 2 und 5 werden fuer den Export gebraucht.
-- ============================================================================


-- ── 1. Alle Tabellen mit Zeilenzahl und Groesse ─────────────────────────────
-- Zeigt den Umfang. reltuples ist eine Schaetzung (aus den Planner-Statistiken)
-- und damit auch bei grossen Tabellen sofort da.

SELECT
  c.relname                                              AS tabelle,
  to_char(c.reltuples::bigint, 'FM999G999G999')          AS zeilen_geschaetzt,
  pg_size_pretty(pg_total_relation_size(c.oid))          AS groesse,
  CASE WHEN EXISTS (
    SELECT 1 FROM information_schema.columns col
    WHERE col.table_schema = 'public'
      AND col.table_name   = c.relname
      AND col.column_name  = 'TENANT_ID'
  ) THEN 'ja' ELSE 'NEIN' END                            AS hat_tenant_id
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relkind = 'r'
ORDER BY hat_tenant_id DESC, c.relname;


-- ── 2. Tabellen OHNE TENANT_ID ──────────────────────────────────────────────
-- Das ist die wichtigste Liste fuer den Tenant-Export. Jede dieser Tabellen
-- muss einzeln entschieden werden:
--   (a) globale Stammdaten (VAT, BILLING_TYPE, PERMISSION, …) -> VOLLSTAENDIG kopieren
--   (b) Kindtabelle, haengt ueber FK am Mandanten                -> ueber JOIN filtern
--   (c) mandantenfremd/irrelevant (LANDING_EVENT, Logs)          -> gar nicht kopieren

SELECT
  c.relname                                     AS tabelle,
  c.reltuples::bigint                           AS zeilen,
  COALESCE(string_agg(DISTINCT ccu.table_name, ', ' ORDER BY ccu.table_name), '—') AS verweist_auf
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
LEFT JOIN information_schema.table_constraints tc
       ON tc.table_schema = 'public' AND tc.table_name = c.relname
      AND tc.constraint_type = 'FOREIGN KEY'
LEFT JOIN information_schema.constraint_column_usage ccu
       ON ccu.constraint_name = tc.constraint_name AND ccu.table_schema = 'public'
WHERE n.nspname = 'public'
  AND c.relkind = 'r'
  AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns col
    WHERE col.table_schema = 'public'
      AND col.table_name   = c.relname
      AND col.column_name  = 'TENANT_ID'
  )
GROUP BY c.relname, c.reltuples
ORDER BY c.relname;


-- ── 3. Fremdschluessel-Graph ────────────────────────────────────────────────
-- Bestimmt die Ladereihenfolge beim Import. Wer auf niemanden verweist, kommt
-- zuerst. Alternativ laesst sich der Import mit deaktivierten FK-Triggern
-- fahren (siehe Migrationsplan) — dann ist die Reihenfolge egal.

SELECT
  tc.table_name    AS von_tabelle,
  kcu.column_name  AS von_spalte,
  ccu.table_name   AS auf_tabelle,
  ccu.column_name  AS auf_spalte,
  rc.delete_rule   AS bei_loeschung
FROM information_schema.table_constraints tc
JOIN information_schema.key_column_usage kcu
       ON kcu.constraint_name = tc.constraint_name AND kcu.table_schema = tc.table_schema
JOIN information_schema.constraint_column_usage ccu
       ON ccu.constraint_name = tc.constraint_name AND ccu.table_schema = tc.table_schema
JOIN information_schema.referential_constraints rc
       ON rc.constraint_name = tc.constraint_name AND rc.constraint_schema = tc.table_schema
WHERE tc.constraint_type = 'FOREIGN KEY'
  AND tc.table_schema = 'public'
ORDER BY tc.table_name, kcu.column_name;


-- ── 4. Views, Funktionen, Trigger, Sequenzen ────────────────────────────────
-- Muessen alle mitwandern. Die Reporting-Views und RPC-Funktionen
-- (next_offer_number, fn_dashboard_*, fn_project_report_*) sind
-- geschaeftskritisch — ohne sie brechen Reporting und Nummernkreise.

SELECT 'VIEW'     AS typ, table_name AS name, NULL AS zusatz
  FROM information_schema.views WHERE table_schema = 'public'
UNION ALL
SELECT 'FUNKTION', p.proname,
       CASE WHEN p.prosecdef THEN 'SECURITY DEFINER' ELSE '' END
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public'
UNION ALL
SELECT 'TRIGGER', t.tgname, c.relname
  FROM pg_trigger t
  JOIN pg_class c ON c.oid = t.tgrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'public' AND NOT t.tgisinternal
UNION ALL
SELECT 'SEQUENZ', c.relname, NULL
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'public' AND c.relkind = 'S'
ORDER BY typ, name;


-- ── 5. Installierte Extensions ──────────────────────────────────────────────
-- Supabase installiert einige von Haus aus. Alles ausserhalb der Standardliste
-- muss bei Scalingo verfuegbar sein — sonst schlaegt der Restore fehl.
-- Scalingo unterstuetzt u.a. PostGIS, TimescaleDB, pgvector, Anonymizer.

SELECT
  e.extname                                        AS extension,
  e.extversion                                     AS version,
  n.nspname                                        AS schema,
  CASE WHEN e.extname IN ('plpgsql','pgcrypto','uuid-ossp','citext','btree_gin','btree_gist')
       THEN 'Standard — unproblematisch'
       ELSE 'PRUEFEN: bei Scalingo verfuegbar?'
  END                                              AS bewertung
FROM pg_extension e
JOIN pg_namespace n ON n.oid = e.extnamespace
ORDER BY bewertung DESC, e.extname;


-- ── 6. RLS-Status und Policies ──────────────────────────────────────────────
-- Die Policies aus Migration 0001/0035 filtern ueber auth.jwt() — eine
-- Supabase-Funktion, die es bei Scalingo NICHT gibt. Sie muessen auf
-- PostgREST-Claims umgestellt werden (siehe 03_rls_postgrest.sql).

SELECT
  c.relname                                  AS tabelle,
  c.relrowsecurity                           AS rls_aktiv,
  COALESCE(count(p.polname), 0)              AS anzahl_policies,
  COALESCE(string_agg(p.polname, ', ' ORDER BY p.polname), '—') AS policies
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
LEFT JOIN pg_policy p ON p.polrelid = c.oid
WHERE n.nspname = 'public' AND c.relkind = 'r'
GROUP BY c.relname, c.relrowsecurity
ORDER BY c.relrowsecurity DESC, c.relname;


-- ── 7. Policies, die auf Supabase-Interna verweisen ─────────────────────────
-- Diese Ausdruecke brechen beim Restore auf Scalingo. Liste = Arbeitsvorrat.

SELECT
  c.relname                          AS tabelle,
  p.polname                          AS policy,
  pg_get_expr(p.polqual, p.polrelid) AS bedingung
FROM pg_policy p
JOIN pg_class c ON c.oid = p.polrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND pg_get_expr(p.polqual, p.polrelid) ILIKE ANY (ARRAY['%auth.%', '%current_tenant_id%'])
ORDER BY c.relname, p.polname;


-- ── 8. Mandanten-Uebersicht ─────────────────────────────────────────────────
-- Grundlage fuer die Auswahl, welche Tenants mitgenommen werden.
-- Passe die Spaltennamen an, falls TENANT anders heisst.

SELECT
  t."ID"                                                          AS tenant_id,
  t."TENANT"                                                      AS name,
  (SELECT count(*) FROM "EMPLOYEE" e WHERE e."TENANT_ID" = t."ID") AS mitarbeiter,
  (SELECT count(*) FROM "PROJECT"  p WHERE p."TENANT_ID" = t."ID") AS projekte,
  (SELECT count(*) FROM "INVOICE"  i WHERE i."TENANT_ID" = t."ID") AS rechnungen,
  (SELECT count(*) FROM "TEC"      x WHERE x."TENANT_ID" = t."ID") AS buchungen
FROM "TENANT" t
ORDER BY t."ID";
