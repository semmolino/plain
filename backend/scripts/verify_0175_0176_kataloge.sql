-- ============================================================================
-- Gegenprobe nach den Migrationen 0175 (Kataloge schreibgeschuetzt) und 0176
-- (Projekt-/Angebotsstatus je Buero). Aendert nichts: alles laeuft in einer
-- Transaktion, die am Ende zurueckgerollt wird.
--
--   scalingo --app planandsimple run \
--     'psql "$SCALINGO_POSTGRESQL_URL" -f backend/scripts/verify_0175_0176_kataloge.sql'
--
-- Erwartung: jede Zeile unter "Befund" meldet 0 bzw. "ok".
-- Achtung: als Superuser geht RLS an allem vorbei — der Schreibschutz-Test in
-- Abschnitt 5 sagt dann nichts. Der Scalingo-Datenbanknutzer ist keiner.
-- ============================================================================

BEGIN;
SET LOCAL request.jwt.claims = '{"sys":"true"}';

\echo '== 1. Keine globalen Status mehr (erwartet 0 / 0)'
SELECT (SELECT count(*) FROM public."PROJECT_STATUS" WHERE "TENANT_ID" IS NULL) AS projektstatus_global,
       (SELECT count(*) FROM public."OFFER_STATUS"   WHERE "TENANT_ID" IS NULL) AS angebotsstatus_global;

\echo '== 2. Je Buero: Anzahl Status, Beauftragt und Abgelehnt vorhanden (erwartet ps > 0, beide true)'
SELECT t."ID" AS buero,
       (SELECT count(*) FROM public."PROJECT_STATUS" s WHERE s."TENANT_ID" = t."ID") AS ps,
       (SELECT count(*) FROM public."OFFER_STATUS"   s WHERE s."TENANT_ID" = t."ID") AS os,
       EXISTS (SELECT 1 FROM public."OFFER_STATUS" s WHERE s."TENANT_ID" = t."ID" AND s."CODE" = 'ORDERED')  AS beauftragt,
       EXISTS (SELECT 1 FROM public."OFFER_STATUS" s WHERE s."TENANT_ID" = t."ID" AND s."CODE" = 'REJECTED') AS abgelehnt
  FROM public."TENANTS" t ORDER BY t."ID";

\echo '== 3. Verweise ueber Bueros hinweg (erwartet 0 / 0)'
SELECT (SELECT count(*) FROM public."PROJECT" p JOIN public."PROJECT_STATUS" s ON s."ID" = p."PROJECT_STATUS_ID"
          WHERE s."TENANT_ID" IS DISTINCT FROM p."TENANT_ID") AS projekte_fremd,
       (SELECT count(*) FROM public."OFFER" o JOIN public."OFFER_STATUS" s ON s."ID" = o."OFFER_STATUS_ID"
          WHERE s."TENANT_ID" IS DISTINCT FROM o."TENANT_ID") AS angebote_fremd;

\echo '== 4. Vorbelegungen und Listen zeigen auf eigene Status (erwartet 0)'
SELECT count(*) AS vorbelegung_fremd
  FROM public."TENANT_SETTINGS" ts
 WHERE ts."KEY" IN ('default_project_status_id', 'default_offer_status_id')
   AND ts."VALUE" ~ '^\d+$'
   AND NOT EXISTS (
     SELECT 1 FROM public."PROJECT_STATUS" s WHERE ts."KEY" = 'default_project_status_id' AND s."ID" = ts."VALUE"::bigint AND s."TENANT_ID" = ts."TENANT_ID"
     UNION ALL
     SELECT 1 FROM public."OFFER_STATUS"   s WHERE ts."KEY" = 'default_offer_status_id'   AND s."ID" = ts."VALUE"::bigint AND s."TENANT_ID" = ts."TENANT_ID");
SELECT count(*) AS laufend_fremd
  FROM public."TENANT_SETTINGS" ts, json_array_elements_text(ts."VALUE"::json) x
 WHERE ts."KEY" = 'monatsabschluss_statuses'
   AND NOT EXISTS (SELECT 1 FROM public."PROJECT_STATUS" s WHERE s."ID"::text = x AND s."TENANT_ID" = ts."TENANT_ID");
SELECT count(*) AS erinnerung_fremd
  FROM public."NOTIFICATION_SCHEDULE_CONFIG" c, unnest(c."PROJECT_STATUS_IDS") x
 WHERE NOT EXISTS (SELECT 1 FROM public."PROJECT_STATUS" s WHERE s."ID" = x AND s."TENANT_ID" = c."TENANT_ID");

\echo '== 5. Ohne Claim: Kataloge lesbar, nicht schreibbar; Status unsichtbar'
SET LOCAL request.jwt.claims = '{}';
SELECT (SELECT count(*) FROM public."VAT")      AS vat_lesbar,
       (SELECT count(*) FROM public."CURRENCY") AS waehrung_lesbar,
       (SELECT count(*) FROM public."COUNTRY")  AS land_lesbar,
       (SELECT count(*) FROM public."PROJECT_STATUS") AS status_ohne_claim_erwartet_0;
DO $$
BEGIN
  BEGIN
    INSERT INTO public."VAT" ("ID", "VAT", "VAT_PERCENT") OVERRIDING SYSTEM VALUE VALUES (-1, 'Probe', 0);
    RAISE NOTICE 'BEFUND: VAT ist ohne Claim beschreibbar';
  EXCEPTION
    WHEN insufficient_privilege THEN   -- 42501: RLS weist die Zeile ab
      RAISE NOTICE 'ok: VAT schreibgeschuetzt (%)', SQLERRM;
    WHEN OTHERS THEN
      RAISE NOTICE 'UNKLAR: Einfuegen scheiterte aus anderem Grund (%) — Schreibschutz nicht belegt', SQLERRM;
  END;
END $$;

ROLLBACK;
