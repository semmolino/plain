-- ============================================================================
-- Migration 0176: Projekt- und Angebotsstatus gehoeren dem Buero
--
-- WARUM
--   PROJECT_STATUS und OFFER_STATUS waren seit 0022/0027 globale Kataloge:
--   eine Liste fuer alle Bueros, pflegbar von niemandem (die Schnittstelle,
--   die es versuchte, schrieb fuer alle — in Runde 12 entfernt). Bueros
--   arbeiten aber mit eigenen Phasen („Akquise", „Ruhend", „Gewährleistung").
--   Ab jetzt hat jedes Buero seine eigene Liste: mit einem Standardsatz
--   angelegt, danach frei aenderbar, loeschbar, solange nichts daran haengt.
--
-- WAS GESCHIEHT
--   1. Beide Tabellen bekommen TENANT_ID und SORT_ORDER; OFFER_STATUS dazu
--      CODE fuer die beiden Status, an denen Logik haengt:
--        ORDERED  — „Als beauftragt markieren" setzt ihn
--        REJECTED — „Als abgelehnt markieren" setzt ihn; abgelehnte Angebote
--                   zaehlen nicht als offen
--      Bisher suchte die Oberflaeche beide ueber ihren NAMEN ('Beauftragt',
--      'Abgelehnt'). Ein Buero, das umbenennt, haette die Knoepfe still
--      verloren. Mit CODE darf der Name frei sein.
--   2. Jedes Buero bekommt eine Kopie der bisherigen globalen Zeilen — die
--      Namen bleiben, was sie waren; niemand sieht nach dem Deploy etwas
--      anderes als vorher.
--   3. Alle Verweise werden auf die Kopie des eigenen Bueros umgehaengt:
--        PROJECT.PROJECT_STATUS_ID, OFFER.OFFER_STATUS_ID,
--        TENANT_SETTINGS default_project_status_id / default_offer_status_id,
--        TENANT_SETTINGS monatsabschluss_statuses (JSON-Liste, „laufende
--          Projekte" fuer Monatsabschluss, Eigene Zeit und Monatsrunde),
--        NOTIFICATION_SCHEDULE_CONFIG.PROJECT_STATUS_IDS (Erinnerungen).
--      Nicht umgehaengt: der gespeicherte Monatsabschluss-Bericht
--      (monatsabschluss_last_report_data) — er traegt Namen zur Anzeige, die
--      IDs darin werden nirgends nachgeschlagen.
--   4. Fehlt einem Buero „Beauftragt" oder „Abgelehnt", wird er angelegt.
--      Der globale Satz aus 0027 hatte kein „Beauftragt" — „Als beauftragt
--      markieren" setzte deshalb stillschweigend keinen Status.
--   5. Die globalen Zeilen fallen weg; TENANT_ID wird Pflicht, RLS wie bei
--      jeder Mandantentabelle.
--
-- SICHERHEIT
--   Haengt nach dem Umhaengen noch ein Projekt oder Angebot an einer globalen
--   Zeile (etwa ein Datensatz ohne gueltigen Mandanten), bricht die Migration
--   ab — der Deploy schlaegt fehl, die alte Version bleibt online, nichts ist
--   halb umgestellt (eine Transaktion, siehe scripts/migrate.js).
--
-- NEUE BUEROS bekommen ihren Standardsatz nicht von hier, sondern aus
-- services/statusCatalog.js (DEFAULT_STATUSES) bei der Registrierung.
-- ============================================================================

SET request.jwt.claims = '{"sys":"true"}';   -- is_system_request() -> true

-- ── 1. Spalten ──────────────────────────────────────────────────────────────
ALTER TABLE public."PROJECT_STATUS" ADD COLUMN IF NOT EXISTS "TENANT_ID"  bigint;
ALTER TABLE public."PROJECT_STATUS" ADD COLUMN IF NOT EXISTS "SORT_ORDER" integer NOT NULL DEFAULT 0;
ALTER TABLE public."OFFER_STATUS"   ADD COLUMN IF NOT EXISTS "TENANT_ID"  bigint;
ALTER TABLE public."OFFER_STATUS"   ADD COLUMN IF NOT EXISTS "SORT_ORDER" integer NOT NULL DEFAULT 0;
ALTER TABLE public."OFFER_STATUS"   ADD COLUMN IF NOT EXISTS "CODE"       text;

ALTER TABLE public."OFFER_STATUS" DROP CONSTRAINT IF EXISTS "OFFER_STATUS_CODE_check";
ALTER TABLE public."OFFER_STATUS" ADD  CONSTRAINT "OFFER_STATUS_CODE_check" CHECK ("CODE" IN ('ORDERED', 'REJECTED'));

-- ── 2. Kopie je Buero ───────────────────────────────────────────────────────
-- SORT_ORDER = Rang der globalen Zeile (nach ID, wie die Listen bisher
-- sortierten) mal 10 — zugleich der Schluessel, ueber den die Zuordnung
-- alt → neu gefunden wird. Der Name taugt dafuer nicht: er muss nicht
-- eindeutig sein.
-- Die Zaehler der ID-Spalten erst hinter die hoechste ID stellen. Zeilen, die
-- mit fester ID kamen (\copy beim Umzug, Seeds), ruecken den Zaehler nicht
-- weiter — die erste neue Zeile bekaeme sonst eine vergebene ID.
SELECT setval(pg_get_serial_sequence('public."PROJECT_STATUS"', 'ID'),
              greatest((SELECT max("ID") FROM public."PROJECT_STATUS"), 1));
SELECT setval(pg_get_serial_sequence('public."OFFER_STATUS"', 'ID'),
              greatest((SELECT max("ID") FROM public."OFFER_STATUS"), 1));

CREATE TEMP TABLE _ps_map (old_id bigint, tenant_id bigint, new_id bigint) ON COMMIT DROP;
CREATE TEMP TABLE _os_map (old_id bigint, tenant_id bigint, new_id bigint) ON COMMIT DROP;

WITH src AS (
  SELECT t."ID" AS tenant_id, g."ID" AS old_id, coalesce(nullif(trim(g."ABBR"), ''), 'Status ' || g."ID") AS abbr,
         (row_number() OVER (PARTITION BY t."ID" ORDER BY g."ID"))::int * 10 AS sort_order
    FROM public."TENANTS" t
   CROSS JOIN public."PROJECT_STATUS" g
   WHERE g."TENANT_ID" IS NULL
), ins AS (
  INSERT INTO public."PROJECT_STATUS" ("TENANT_ID", "ABBR", "SORT_ORDER")
  SELECT tenant_id, abbr, sort_order FROM src
  RETURNING "ID", "TENANT_ID", "SORT_ORDER"
)
INSERT INTO _ps_map (old_id, tenant_id, new_id)
SELECT s.old_id, s.tenant_id, i."ID"
  FROM src s JOIN ins i ON i."TENANT_ID" = s.tenant_id AND i."SORT_ORDER" = s.sort_order;

WITH src AS (
  SELECT t."ID" AS tenant_id, g."ID" AS old_id, coalesce(nullif(trim(g."ABBR"), ''), 'Status ' || g."ID") AS abbr,
         (row_number() OVER (PARTITION BY t."ID" ORDER BY g."ID"))::int * 10 AS sort_order
    FROM public."TENANTS" t
   CROSS JOIN public."OFFER_STATUS" g
   WHERE g."TENANT_ID" IS NULL
), ins AS (
  INSERT INTO public."OFFER_STATUS" ("TENANT_ID", "ABBR", "SORT_ORDER")
  SELECT tenant_id, abbr, sort_order FROM src
  RETURNING "ID", "TENANT_ID", "SORT_ORDER"
)
INSERT INTO _os_map (old_id, tenant_id, new_id)
SELECT s.old_id, s.tenant_id, i."ID"
  FROM src s JOIN ins i ON i."TENANT_ID" = s.tenant_id AND i."SORT_ORDER" = s.sort_order;

-- Ein Buero ohne jeden Projektstatus (globaler Katalog war leer) bekommt den
-- Standardsatz — ein Projekt braucht einen Status.
INSERT INTO public."PROJECT_STATUS" ("TENANT_ID", "ABBR", "SORT_ORDER")
SELECT t."ID", v.abbr, v.sort_order
  FROM public."TENANTS" t
 CROSS JOIN (VALUES ('Akquise', 10), ('Laufend', 20), ('Pausiert', 30), ('Abgeschlossen', 40)) AS v(abbr, sort_order)
 WHERE NOT EXISTS (SELECT 1 FROM public."PROJECT_STATUS" s WHERE s."TENANT_ID" = t."ID");

-- ── 3. Verweise umhaengen ───────────────────────────────────────────────────
UPDATE public."PROJECT" p
   SET "PROJECT_STATUS_ID" = m.new_id
  FROM _ps_map m
 WHERE m.old_id = p."PROJECT_STATUS_ID" AND m.tenant_id = p."TENANT_ID";

UPDATE public."OFFER" o
   SET "OFFER_STATUS_ID" = m.new_id
  FROM _os_map m
 WHERE m.old_id = o."OFFER_STATUS_ID" AND m.tenant_id = o."TENANT_ID";

UPDATE public."TENANT_SETTINGS" s
   SET "VALUE" = m.new_id::text
  FROM _ps_map m
 WHERE s."KEY" = 'default_project_status_id'
   AND s."VALUE" ~ '^\s*\d+\s*$'
   AND trim(s."VALUE")::bigint = m.old_id AND m.tenant_id = s."TENANT_ID";

UPDATE public."TENANT_SETTINGS" s
   SET "VALUE" = m.new_id::text
  FROM _os_map m
 WHERE s."KEY" = 'default_offer_status_id'
   AND s."VALUE" ~ '^\s*\d+\s*$'
   AND trim(s."VALUE")::bigint = m.old_id AND m.tenant_id = s."TENANT_ID";

-- JSON-Liste wie "[1,3]" oder '["1","3"]' → neue IDs, Reihenfolge bleibt.
-- Unbekannte IDs fallen weg: sie zeigten schon vorher auf keinen Status.
UPDATE public."TENANT_SETTINGS" s
   SET "VALUE" = coalesce((
         SELECT json_agg(m.new_id ORDER BY x.ord)::text
           FROM json_array_elements_text(s."VALUE"::json) WITH ORDINALITY AS x(id, ord)
           JOIN _ps_map m ON x.id ~ '^\d+$' AND m.old_id = x.id::bigint AND m.tenant_id = s."TENANT_ID"
       ), '[]')
 WHERE s."KEY" = 'monatsabschluss_statuses'
   AND s."VALUE" ~ '^\s*\[.*\]\s*$';

UPDATE public."NOTIFICATION_SCHEDULE_CONFIG" c
   SET "PROJECT_STATUS_IDS" = coalesce((
         SELECT array_agg(m.new_id::int ORDER BY x.ord)
           FROM unnest(c."PROJECT_STATUS_IDS") WITH ORDINALITY AS x(id, ord)
           JOIN _ps_map m ON m.old_id = x.id AND m.tenant_id = c."TENANT_ID"
       ), '{}')
 WHERE c."PROJECT_STATUS_IDS" IS NOT NULL AND cardinality(c."PROJECT_STATUS_IDS") > 0;

-- ── 4. Beauftragt und Abgelehnt je Buero ────────────────────────────────────
-- Der erste Status gleichen Namens bekommt den Code; fehlt er, wird er angelegt.
UPDATE public."OFFER_STATUS" s SET "CODE" = 'ORDERED'
 WHERE s."ID" IN (SELECT DISTINCT ON ("TENANT_ID") "ID" FROM public."OFFER_STATUS"
                   WHERE "TENANT_ID" IS NOT NULL AND lower(trim("ABBR")) = 'beauftragt'
                   ORDER BY "TENANT_ID", "SORT_ORDER", "ID");
UPDATE public."OFFER_STATUS" s SET "CODE" = 'REJECTED'
 WHERE s."ID" IN (SELECT DISTINCT ON ("TENANT_ID") "ID" FROM public."OFFER_STATUS"
                   WHERE "TENANT_ID" IS NOT NULL AND lower(trim("ABBR")) = 'abgelehnt'
                   ORDER BY "TENANT_ID", "SORT_ORDER", "ID");

INSERT INTO public."OFFER_STATUS" ("TENANT_ID", "ABBR", "SORT_ORDER", "CODE")
SELECT t."ID", v.abbr,
       coalesce((SELECT max("SORT_ORDER") FROM public."OFFER_STATUS" x WHERE x."TENANT_ID" = t."ID"), 0) + v.step,
       v.code
  FROM public."TENANTS" t
 CROSS JOIN (VALUES ('Beauftragt', 'ORDERED', 10), ('Abgelehnt', 'REJECTED', 20)) AS v(abbr, code, step)
 WHERE NOT EXISTS (SELECT 1 FROM public."OFFER_STATUS" s WHERE s."TENANT_ID" = t."ID" AND s."CODE" = v.code);

-- ── 5. Globale Zeilen weg, Mandant Pflicht ──────────────────────────────────
DO $$
DECLARE n_p int; n_o int;
BEGIN
  SELECT count(*) INTO n_p FROM public."PROJECT" p
    JOIN public."PROJECT_STATUS" s ON s."ID" = p."PROJECT_STATUS_ID"
   WHERE s."TENANT_ID" IS NULL OR s."TENANT_ID" IS DISTINCT FROM p."TENANT_ID";
  SELECT count(*) INTO n_o FROM public."OFFER" o
    JOIN public."OFFER_STATUS" s ON s."ID" = o."OFFER_STATUS_ID"
   WHERE s."TENANT_ID" IS NULL OR s."TENANT_ID" IS DISTINCT FROM o."TENANT_ID";
  IF n_p > 0 OR n_o > 0 THEN
    RAISE EXCEPTION
      '% Projekte und % Angebote zeigen nach dem Umhaengen auf einen Status ausserhalb ihres Bueros (Mandant fehlt in TENANTS?). Nichts wurde geaendert.',
      n_p, n_o;
  END IF;
END $$;

DELETE FROM public."PROJECT_STATUS" WHERE "TENANT_ID" IS NULL;
DELETE FROM public."OFFER_STATUS"   WHERE "TENANT_ID" IS NULL;

ALTER TABLE public."PROJECT_STATUS" ALTER COLUMN "TENANT_ID" SET NOT NULL;
ALTER TABLE public."OFFER_STATUS"   ALTER COLUMN "TENANT_ID" SET NOT NULL;
ALTER TABLE public."PROJECT_STATUS" ALTER COLUMN "TENANT_ID" SET DEFAULT public.current_tenant_id();
ALTER TABLE public."OFFER_STATUS"   ALTER COLUMN "TENANT_ID" SET DEFAULT public.current_tenant_id();
ALTER TABLE public."PROJECT_STATUS" ALTER COLUMN "ABBR" SET NOT NULL;

-- Faellt ein Buero weg (abgelehnte Registrierung), gehen seine Status mit.
ALTER TABLE public."PROJECT_STATUS" DROP CONSTRAINT IF EXISTS "PROJECT_STATUS_TENANT_ID_fkey";
ALTER TABLE public."PROJECT_STATUS" ADD  CONSTRAINT "PROJECT_STATUS_TENANT_ID_fkey"
  FOREIGN KEY ("TENANT_ID") REFERENCES public."TENANTS"("ID") ON DELETE CASCADE;
ALTER TABLE public."OFFER_STATUS" DROP CONSTRAINT IF EXISTS "OFFER_STATUS_TENANT_ID_fkey";
ALTER TABLE public."OFFER_STATUS" ADD  CONSTRAINT "OFFER_STATUS_TENANT_ID_fkey"
  FOREIGN KEY ("TENANT_ID") REFERENCES public."TENANTS"("ID") ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS "PROJECT_STATUS_TENANT_SORT_idx" ON public."PROJECT_STATUS" ("TENANT_ID", "SORT_ORDER");
CREATE INDEX IF NOT EXISTS "OFFER_STATUS_TENANT_SORT_idx"   ON public."OFFER_STATUS"   ("TENANT_ID", "SORT_ORDER");
-- Je Buero hoechstens ein „Beauftragt" und ein „Abgelehnt". Mandantenweit
-- gedacht, wie es jede UNIQUE-Regel sein muss (CLAUDE.md).
CREATE UNIQUE INDEX IF NOT EXISTS "OFFER_STATUS_TENANT_CODE_key"
  ON public."OFFER_STATUS" ("TENANT_ID", "CODE") WHERE "CODE" IS NOT NULL;

-- ── 6. RLS wie jede Mandantentabelle (Vorbild 0137) ─────────────────────────
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['PROJECT_STATUS', 'OFFER_STATUS'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE public.%I FORCE  ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON public.%I', t);
    EXECUTE format($f$
      CREATE POLICY tenant_isolation ON public.%I FOR ALL
        USING      ("TENANT_ID" = public.current_tenant_id() OR public.is_system_request())
        WITH CHECK ("TENANT_ID" = public.current_tenant_id() OR public.is_system_request())
    $f$, t);
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'plain_app') THEN
      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO plain_app', t);
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'plain_system') THEN
      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO plain_system', t);
    END IF;
  END LOOP;
END $$;

RESET request.jwt.claims;

NOTIFY pgrst, 'reload schema';
