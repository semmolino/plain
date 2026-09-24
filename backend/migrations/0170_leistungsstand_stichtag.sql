-- ============================================================================
-- 0170_leistungsstand_stichtag.sql — Leistungsstand zum Stichtag (UI-Pilot Runde 2)
--
-- WARUM
--   Ein Leistungsstand galt ab dem Moment, in dem er gespeichert wurde
--   (PROJECT_PROGRESS.created_at). Wer den September-Stand am 3. Oktober
--   eintraegt — der Regelfall bei der monatlichen Runde —, hatte damit einen
--   Oktober-Stand: der Stichtagsbericht „Teilfertige Leistungen" zum 30.09.
--   sah ihn nicht und nahm den August.
--
--   Jetzt traegt jede Zeile ihren Stichtag: "AS_OF_DATE". Die Monatsrunde
--   (GET /projekte/leistungsstand/runde) speichert mit dem gewaehlten
--   Stichtag, alles andere mit „heute".
--
-- DIE REGEL, AUF DER ALLES BERUHT
--   Je Element ist "AS_OF_DATE" in Erfassungsreihenfolge nie fallend:
--     * Speichern mit Stichtag ist nur erlaubt, wenn es fuer das Projekt noch
--       keinen spaeteren Stand gibt (services/projekte.js, saveLeistungsstand),
--     * Fortschreibungen bei Rechnung/Zahlung uebernehmen den Stichtag der
--       Zeile, aus der sie kopieren (services/projectProgress.js),
--     * alle anderen Wege (Anlage, Import, Nachtrag) schreiben „heute".
--   Deshalb reicht es, in den Stichtagsabfragen den FILTER umzustellen
--   (created_at <= ts  →  AS_OF_DATE <= Stichtag). Die Sortierung nimmt
--   AS_OF_DATE trotzdem mit nach vorn — falls die Regel je bricht, gewinnt
--   der fachlich juengere Stand statt der zuletzt getippte. Aus demselben
--   Grund bleibt REPORTING.VW_PROJECT_PROGRESS_LATEST („jetzt", ohne
--   Stichtag) unveraendert: fuer „jetzt" liefern beide Ordnungen dieselbe Zeile.
--
-- WAS SICH AN BESTEHENDEN ZAHLEN AENDERT
--   Nichts, ausser an einer Kante: der Stichtag wird jetzt als Datum gelesen,
--   wie es die Abrechnungsseite derselben Funktionen schon immer tat
--   (p_as_of::date). Nachgetragen wird AS_OF_DATE als deutsches Datum des
--   Speicherns; eine Zeile, die am 1.10. um 1 Uhr (= 30.09. 23 Uhr UTC)
--   gespeichert wurde, zaehlt damit zum 1.10. und nicht mehr zum 30.09.
--   Ohne Stichtag (p_as_of und p_date_to NULL) gilt jede Zeile — kein
--   Zeitzonenfenster zwischen 0 und 2 Uhr, in dem der heutige Stand fehlt.
--
--   Geprueft gegen eine lokale PostgreSQL 16 mit dem Schema-Stand nach
--   0169: header/structure/list/detail/kpis/wip liefern vor und nach der
--   Migration fuer „jetzt", Monatsenden und p_date_to dieselben Werte.
--
-- ERLEDIGT-MARKE
--   PROJECT."PROGRESS_REVIEWED_AS_OF/_AT/_BY": fuer welchen Stichtag die
--   Leistungsstaende eines Projekts zuletzt gepflegt oder unveraendert
--   bestaetigt wurden. Liest die Monatsrunde („7 von 12 erledigt").
--
-- Die Funktionsruempfe unten sind die aktuellen Definitionen (Stand nach
-- 0158/0153/0137), aus der Datenbank gelesen; geaendert sind nur die mit
-- AS_OF_DATE markierten Zeilen. Signaturen bleiben — CREATE OR REPLACE reicht.
-- ============================================================================

-- RLS: das Nachtragen liest und schreibt eine mandantenbezogene Tabelle.
-- Ohne Claim saehe das UPDATE null Zeilen und SET NOT NULL scheiterte
-- (oder, schlimmer, die Migration liefe als Erfolg durch). Siehe 0136.
SET request.jwt.claims = '{"sys":"true"}';

ALTER TABLE "PROJECT_PROGRESS" ADD COLUMN IF NOT EXISTS "AS_OF_DATE" date;

UPDATE "PROJECT_PROGRESS"
   SET "AS_OF_DATE" = (COALESCE("created_at", now()) AT TIME ZONE 'Europe/Berlin')::date
 WHERE "AS_OF_DATE" IS NULL;

ALTER TABLE "PROJECT_PROGRESS"
  ALTER COLUMN "AS_OF_DATE" SET DEFAULT ((now() AT TIME ZONE 'Europe/Berlin')::date),
  ALTER COLUMN "AS_OF_DATE" SET NOT NULL;

COMMENT ON COLUMN "PROJECT_PROGRESS"."AS_OF_DATE" IS
  'Stichtag, zu dem dieser Stand gilt (nicht: wann er erfasst wurde). Je Element nie fallend in Erfassungsreihenfolge — siehe Migration 0170.';

-- Jede Stichtagsabfrage sucht je Element die juengste Zeile <= Stichtag.
-- Bisher gab es dafuer gar keinen Index auf STRUCTURE_ID.
CREATE INDEX IF NOT EXISTS "idx_project_progress_asof"
  ON "PROJECT_PROGRESS" ("TENANT_ID", "STRUCTURE_ID", "AS_OF_DATE" DESC, "created_at" DESC, "ID" DESC);

ALTER TABLE "PROJECT"
  ADD COLUMN IF NOT EXISTS "PROGRESS_REVIEWED_AS_OF" date,
  ADD COLUMN IF NOT EXISTS "PROGRESS_REVIEWED_AT"    timestamptz,
  ADD COLUMN IF NOT EXISTS "PROGRESS_REVIEWED_BY"    bigint REFERENCES "EMPLOYEE"("ID") ON DELETE SET NULL;

COMMENT ON COLUMN "PROJECT"."PROGRESS_REVIEWED_AS_OF" IS
  'Stichtag, fuer den die Leistungsstaende zuletzt gepflegt oder unveraendert bestaetigt wurden (Monatsrunde).';

-- ── public.fn_project_report_header ──
CREATE OR REPLACE FUNCTION public.fn_project_report_header(p_tenant_id bigint, p_project_id bigint, p_as_of timestamp with time zone DEFAULT NULL::timestamp with time zone, p_date_from date DEFAULT NULL::date, p_date_to date DEFAULT NULL::date)
 RETURNS TABLE("TENANT_ID" bigint, "PROJECT_ID" bigint, "ABBR" text, "NAME" text, "PROJECT_STATUS_NAME_SHORT" text, "PROJECT_MANAGER_DISPLAY" text, "COMPANY_NAME" text, "BUDGET_TOTAL_NET" numeric, "LEISTUNGSSTAND_PERCENT" numeric, "LEISTUNGSSTAND_VALUE" numeric, "HOURS_TOTAL" numeric, "COST_TOTAL" numeric, "EARNED_VALUE_NET" numeric, "COST_RATIO" numeric, "REMAINING_BUDGET_NET" numeric, "ADVANCE_INVOICE_NET_TOTAL" numeric, "INVOICE_NET_TOTAL" numeric, "BILLED_NET_TOTAL" numeric, "OPEN_NET_TOTAL" numeric, "PAYED_NET_TOTAL" numeric, "SALES_TOTAL" numeric, "QTY_EXT_TOTAL" numeric)
 LANGUAGE sql
 STABLE
AS $function$
  WITH
    cutoff AS (
      SELECT
        CASE
          WHEN p_as_of   IS NOT NULL THEN p_as_of
          WHEN p_date_to IS NOT NULL THEN (p_date_to::timestamptz + INTERVAL '1 day' - INTERVAL '1 microsecond')
          ELSE now()
        END AS ts
    ),

    leaf_structs AS (
      SELECT
        ps."ID"              AS "STRUCTURE_ID",
        ps."BILLING_TYPE_ID",
        ps."REVENUE"         AS "REV_FALLBACK",
        ps."EXTRAS"          AS "EXT_FALLBACK",
        ps."created_at"      AS "CREATED_AT"
      FROM public."PROJECT_STRUCTURE" ps
      WHERE ps."TENANT_ID"  = p_tenant_id
        AND ps."PROJECT_ID" = p_project_id
        AND NOT EXISTS (
          SELECT 1 FROM public."PROJECT_STRUCTURE" child
          WHERE  child."TENANT_ID" = ps."TENANT_ID"
            AND  child."FATHER_ID" = ps."ID"
        )
    ),

    budget AS (
      SELECT
        ls."STRUCTURE_ID",
        ls."BILLING_TYPE_ID",
        COALESCE(
          pp_bud."REVENUE",
          CASE WHEN ls."CREATED_AT" <= c.ts THEN ls."REV_FALLBACK" END,
          0
        ) AS "REVENUE",
        COALESCE(
          pp_bud."EXTRAS",
          CASE WHEN ls."CREATED_AT" <= c.ts THEN ls."EXT_FALLBACK" END,
          0
        ) AS "EXTRAS"
      FROM leaf_structs ls
      CROSS JOIN cutoff c
      LEFT JOIN LATERAL (
        SELECT pp."REVENUE", pp."EXTRAS"
        FROM   public."PROJECT_PROGRESS" pp
        WHERE  pp."STRUCTURE_ID" = ls."STRUCTURE_ID"
          AND  pp."TENANT_ID"    = p_tenant_id
          AND  pp."REVENUE"      IS NOT NULL
          AND  pp."AS_OF_DATE" <= (CASE WHEN p_as_of IS NULL AND p_date_to IS NULL THEN 'infinity'::date ELSE c.ts::date END)
        ORDER  BY pp."AS_OF_DATE" DESC, pp."created_at" DESC, pp."ID" DESC
        LIMIT  1
      ) pp_bud ON true
    ),

    completion AS (
      SELECT
        ls."STRUCTURE_ID",
        COALESCE(pp_compl."REVENUE_COMPLETION", 0) AS "REVENUE_COMPLETION",
        COALESCE(pp_compl."EXTRAS_COMPLETION",  0) AS "EXTRAS_COMPLETION"
      FROM leaf_structs ls
      CROSS JOIN cutoff c
      LEFT JOIN LATERAL (
        SELECT pp."REVENUE_COMPLETION", pp."EXTRAS_COMPLETION"
        FROM   public."PROJECT_PROGRESS" pp
        WHERE  pp."STRUCTURE_ID"      = ls."STRUCTURE_ID"
          AND  pp."TENANT_ID"         = p_tenant_id
          AND  pp."REVENUE_COMPLETION" IS NOT NULL
          AND  pp."AS_OF_DATE" <= (CASE WHEN p_as_of IS NULL AND p_date_to IS NULL THEN 'infinity'::date ELSE c.ts::date END)
        ORDER  BY pp."AS_OF_DATE" DESC, pp."created_at" DESC, pp."ID" DESC
        LIMIT  1
      ) pp_compl ON true
      WHERE ls."BILLING_TYPE_ID" <> 2
    ),

    tec_leaf AS (
      SELECT
        t."STRUCTURE_ID",
        COALESCE(SUM(t."QUANTITY_INT"), 0) AS "HOURS_TOTAL",
        COALESCE(SUM(t."COST_TOTAL"),       0) AS "COST_TOTAL",
        COALESCE(SUM(t."HOURLY_RATE_TOTAL"),       0) AS "HOURLY_RATE_TOTAL",
        COALESCE(SUM(t."QUANTITY_EXT"), 0) AS "QTY_EXT_TOTAL"
      FROM public."BOOKING" t
      WHERE t."TENANT_ID"    = p_tenant_id
        AND t."STRUCTURE_ID" IN (SELECT "STRUCTURE_ID" FROM leaf_structs)
        AND (p_as_of     IS NULL OR t."BOOKING_DATE" <= p_as_of::date)
        AND (p_date_from IS NULL OR t."BOOKING_DATE" >= p_date_from)
        AND (p_date_to   IS NULL OR t."BOOKING_DATE" <= p_date_to)
      GROUP BY t."STRUCTURE_ID"
    ),

    -- For BT2: Honorar = HOURLY_RATE_TOTAL (not budgeted REVENUE), so budget denominator uses HOURLY_RATE_TOTAL
    prog_agg AS (
      SELECT
        -- BT2: budget IS HOURLY_RATE_TOTAL (hourly: what was billed = the honorar)
        COALESCE(SUM(
          CASE WHEN b."BILLING_TYPE_ID" = 2
               THEN COALESCE(tl."HOURLY_RATE_TOTAL", 0)
               ELSE COALESCE(b."REVENUE", 0)
          END
        ), 0) AS "REVENUE_BUDGET",
        COALESCE(SUM(
          CASE WHEN b."BILLING_TYPE_ID" = 2 THEN 0
               ELSE COALESCE(b."EXTRAS", 0)
          END
        ), 0) AS "EXTRAS_BUDGET",
        -- earned value: BT2 = HOURLY_RATE_TOTAL, BT1 = recorded completion
        COALESCE(SUM(
          CASE WHEN b."BILLING_TYPE_ID" = 2
               THEN COALESCE(tl."HOURLY_RATE_TOTAL", 0)
               ELSE COALESCE(c."REVENUE_COMPLETION", 0)
          END
        ), 0) AS "REVENUE_COMPLETION_VALUE",
        COALESCE(SUM(
          CASE WHEN b."BILLING_TYPE_ID" = 2 THEN 0
               ELSE COALESCE(c."EXTRAS_COMPLETION", 0)
          END
        ), 0) AS "EXTRAS_COMPLETION_VALUE",
        -- LEISTUNGSSTAND_PERCENT: BT2 numerator = HOURLY_RATE_TOTAL, denominator = HOURLY_RATE_TOTAL → always 100%
        CASE
          WHEN SUM(
            CASE WHEN b."BILLING_TYPE_ID" = 2
                 THEN COALESCE(tl."HOURLY_RATE_TOTAL", 0)
                 ELSE COALESCE(b."REVENUE", 0) + COALESCE(b."EXTRAS", 0)
            END
          ) = 0 THEN NULL
          ELSE 100.0
             * SUM(
                 CASE WHEN b."BILLING_TYPE_ID" = 2 THEN COALESCE(tl."HOURLY_RATE_TOTAL", 0)
                      ELSE COALESCE(c."REVENUE_COMPLETION", 0)
                 END
               + CASE WHEN b."BILLING_TYPE_ID" = 2 THEN 0
                      ELSE COALESCE(c."EXTRAS_COMPLETION", 0)
                 END
               )
             / SUM(
                 CASE WHEN b."BILLING_TYPE_ID" = 2
                      THEN COALESCE(tl."HOURLY_RATE_TOTAL", 0)
                      ELSE COALESCE(b."REVENUE", 0) + COALESCE(b."EXTRAS", 0)
                 END
               )
        END AS "LEISTUNGSSTAND_PERCENT"
      FROM budget b
      LEFT JOIN completion c  ON  c."STRUCTURE_ID" = b."STRUCTURE_ID"
      LEFT JOIN tec_leaf   tl ON tl."STRUCTURE_ID" = b."STRUCTURE_ID"
    ),

    tec_agg AS (
      SELECT
        COALESCE(SUM(tl."HOURS_TOTAL"),   0) AS "HOURS_TOTAL",
        COALESCE(SUM(tl."COST_TOTAL"),    0) AS "COST_TOTAL",
        COALESCE(SUM(tl."HOURLY_RATE_TOTAL"),        0) AS "SALES_TOTAL",
        COALESCE(SUM(tl."QTY_EXT_TOTAL"), 0) AS "QTY_EXT_TOTAL"
      FROM tec_leaf tl
    ),

    pp_billed AS (
      SELECT COALESCE(SUM(pp."AMOUNT_NET" + COALESCE(pp."AMOUNT_EXTRAS_NET", 0)), 0) AS "PP_NET"
      FROM public."ADVANCE_INVOICE" pp
      WHERE pp."TENANT_ID"  = p_tenant_id
        AND pp."PROJECT_ID" = p_project_id
        AND pp."STATUS_ID"  = 2
        AND (p_as_of     IS NULL OR pp."ADVANCE_INVOICE_DATE" <= p_as_of::date)
        AND (p_date_from IS NULL OR pp."ADVANCE_INVOICE_DATE" >= p_date_from)
        AND (p_date_to   IS NULL OR pp."ADVANCE_INVOICE_DATE" <= p_date_to)
    ),
    inv_billed AS (
      SELECT COALESCE(SUM(inv."TOTAL_AMOUNT_NET"), 0) AS "INV_NET"
      FROM public."INVOICE" inv
      WHERE inv."TENANT_ID"  = p_tenant_id
        AND inv."PROJECT_ID" = p_project_id
        AND inv."STATUS_ID"  = 2
        AND (p_as_of     IS NULL OR inv."INVOICE_DATE" <= p_as_of::date)
        AND (p_date_from IS NULL OR inv."INVOICE_DATE" >= p_date_from)
        AND (p_date_to   IS NULL OR inv."INVOICE_DATE" <= p_date_to)
    ),

    pay_agg AS (
      SELECT COALESCE(SUM(pay."AMOUNT_PAYED_NET"), 0) AS "PAYED_NET_TOTAL"
      FROM public."PAYMENT" pay
      WHERE pay."TENANT_ID"  = p_tenant_id
        AND pay."PROJECT_ID" = p_project_id
        AND (p_as_of     IS NULL OR pay."PAYMENT_DATE" <= p_as_of::date)
        AND (p_date_from IS NULL OR pay."PAYMENT_DATE" >= p_date_from)
        AND (p_date_to   IS NULL OR pay."PAYMENT_DATE" <= p_date_to)
    )

  SELECT
    proj."TENANT_ID",
    proj."ID"::bigint,
    proj."ABBR",
    proj."NAME",
    ps_lkp."ABBR"   AS "PROJECT_STATUS_NAME_SHORT",
    ( e."ABBR" ||
      CASE WHEN e."FIRST_NAME" IS NOT NULL
           THEN ': ' || e."FIRST_NAME" || ' ' || COALESCE(e."LAST_NAME", '')
           ELSE '' END
    )                     AS "PROJECT_MANAGER_DISPLAY",
    c."COMPANY_NAME_1"    AS "COMPANY_NAME",

    pa."REVENUE_BUDGET" + pa."EXTRAS_BUDGET"                          AS "BUDGET_TOTAL_NET",
    pa."LEISTUNGSSTAND_PERCENT",
    pa."REVENUE_COMPLETION_VALUE" + pa."EXTRAS_COMPLETION_VALUE"      AS "LEISTUNGSSTAND_VALUE",
    ta."HOURS_TOTAL",
    ta."COST_TOTAL",
    pa."REVENUE_COMPLETION_VALUE" + pa."EXTRAS_COMPLETION_VALUE"      AS "EARNED_VALUE_NET",
    CASE
      WHEN (pa."REVENUE_COMPLETION_VALUE" + pa."EXTRAS_COMPLETION_VALUE") = 0 THEN NULL
      ELSE ta."COST_TOTAL" / (pa."REVENUE_COMPLETION_VALUE" + pa."EXTRAS_COMPLETION_VALUE")
    END                   AS "COST_RATIO",
    (pa."REVENUE_BUDGET" + pa."EXTRAS_BUDGET")
    - (pa."REVENUE_COMPLETION_VALUE" + pa."EXTRAS_COMPLETION_VALUE")  AS "REMAINING_BUDGET_NET",
    ppb."PP_NET"                    AS "ADVANCE_INVOICE_NET_TOTAL",
    ivb."INV_NET"                   AS "INVOICE_NET_TOTAL",
    ppb."PP_NET" + ivb."INV_NET"    AS "BILLED_NET_TOTAL",
    (pa."REVENUE_COMPLETION_VALUE" + pa."EXTRAS_COMPLETION_VALUE")
    - (ppb."PP_NET" + ivb."INV_NET") AS "OPEN_NET_TOTAL",
    pya."PAYED_NET_TOTAL",
    ta."SALES_TOTAL",
    ta."QTY_EXT_TOTAL"

  FROM public."PROJECT" proj
  CROSS JOIN prog_agg pa
  CROSS JOIN tec_agg  ta
  CROSS JOIN pp_billed ppb
  CROSS JOIN inv_billed ivb
  CROSS JOIN pay_agg  pya
  LEFT JOIN public."PROJECT_STATUS" ps_lkp ON ps_lkp."ID" = proj."PROJECT_STATUS_ID"
  LEFT JOIN public."EMPLOYEE" e
    ON  e."TENANT_ID" = proj."TENANT_ID"
   AND  e."ID"        = proj."PROJECT_MANAGER_ID"
  LEFT JOIN public."COMPANY" c
    ON  c."TENANT_ID" = proj."TENANT_ID"
   AND  c."ID"        = proj."COMPANY_ID"
  WHERE proj."TENANT_ID" = p_tenant_id
    AND proj."ID"        = p_project_id
$function$;

-- ── public.fn_project_report_structure ──
CREATE OR REPLACE FUNCTION public.fn_project_report_structure(p_tenant_id bigint, p_project_id bigint, p_as_of timestamp with time zone DEFAULT NULL::timestamp with time zone, p_date_from date DEFAULT NULL::date, p_date_to date DEFAULT NULL::date)
 RETURNS TABLE("TENANT_ID" bigint, "PROJECT_ID" bigint, "STRUCTURE_ID" bigint, "PARENT_STRUCTURE_ID" bigint, "ABBR" text, "NAME" text, "IS_LEAF" boolean, "HOURS_TOTAL" numeric, "COST_TOTAL" numeric, "EARNED_VALUE_NET" numeric, "HONORAR_NET" numeric, "REST_HONORAR" numeric, "LEISTUNGSSTAND_PERCENT" numeric, "KOSTENQUOTE" numeric)
 LANGUAGE sql
 STABLE
AS $function$
  WITH
    cutoff AS (
      SELECT
        CASE
          WHEN p_as_of   IS NOT NULL THEN p_as_of
          WHEN p_date_to IS NOT NULL THEN (p_date_to::timestamptz + INTERVAL '1 day' - INTERVAL '1 microsecond')
          ELSE now()
        END AS ts
    ),

    budget AS (
      SELECT
        ps."ID"              AS "STRUCTURE_ID",
        ps."BILLING_TYPE_ID",
        COALESCE(
          pp_bud."REVENUE",
          CASE WHEN ps."created_at" <= c.ts THEN ps."REVENUE" END,
          0
        ) AS "REVENUE",
        COALESCE(
          pp_bud."EXTRAS",
          CASE WHEN ps."created_at" <= c.ts THEN ps."EXTRAS"  END,
          0
        ) AS "EXTRAS"
      FROM public."PROJECT_STRUCTURE" ps
      CROSS JOIN cutoff c
      LEFT JOIN LATERAL (
        SELECT pp."REVENUE", pp."EXTRAS"
        FROM   public."PROJECT_PROGRESS" pp
        WHERE  pp."STRUCTURE_ID" = ps."ID"
          AND  pp."TENANT_ID"    = p_tenant_id
          AND  pp."REVENUE"      IS NOT NULL
          AND  pp."AS_OF_DATE" <= (CASE WHEN p_as_of IS NULL AND p_date_to IS NULL THEN 'infinity'::date ELSE c.ts::date END)
        ORDER  BY pp."AS_OF_DATE" DESC, pp."created_at" DESC, pp."ID" DESC
        LIMIT  1
      ) pp_bud ON true
      WHERE ps."TENANT_ID"  = p_tenant_id
        AND ps."PROJECT_ID" = p_project_id
    ),

    completion AS (
      SELECT
        ps."ID" AS "STRUCTURE_ID",
        COALESCE(pp_compl."REVENUE_COMPLETION",       0) AS "REVENUE_COMPLETION",
        COALESCE(pp_compl."EXTRAS_COMPLETION",         0) AS "EXTRAS_COMPLETION",
        COALESCE(pp_compl."REVENUE_COMPLETION_PERCENT",0) AS "REVENUE_COMPLETION_PERCENT"
      FROM public."PROJECT_STRUCTURE" ps
      CROSS JOIN cutoff c
      LEFT JOIN LATERAL (
        SELECT pp."REVENUE_COMPLETION", pp."EXTRAS_COMPLETION", pp."REVENUE_COMPLETION_PERCENT"
        FROM   public."PROJECT_PROGRESS" pp
        WHERE  pp."STRUCTURE_ID"       = ps."ID"
          AND  pp."TENANT_ID"          = p_tenant_id
          AND  pp."REVENUE_COMPLETION"  IS NOT NULL
          AND  pp."AS_OF_DATE" <= (CASE WHEN p_as_of IS NULL AND p_date_to IS NULL THEN 'infinity'::date ELSE c.ts::date END)
        ORDER  BY pp."AS_OF_DATE" DESC, pp."created_at" DESC, pp."ID" DESC
        LIMIT  1
      ) pp_compl ON true
      WHERE ps."TENANT_ID"  = p_tenant_id
        AND ps."PROJECT_ID" = p_project_id
        AND ps."BILLING_TYPE_ID" <> 2
    ),

    tec AS (
      SELECT
        t."STRUCTURE_ID",
        COALESCE(SUM(t."QUANTITY_INT"), 0) AS "HOURS_TOTAL",
        COALESCE(SUM(t."COST_TOTAL"),       0) AS "COST_TOTAL",
        COALESCE(SUM(t."HOURLY_RATE_TOTAL"),       0) AS "HOURLY_RATE_TOTAL"
      FROM public."BOOKING" t
      JOIN public."PROJECT_STRUCTURE" ps
        ON  ps."TENANT_ID"  = t."TENANT_ID"
       AND  ps."ID"         = t."STRUCTURE_ID"
      WHERE t."TENANT_ID"   = p_tenant_id
        AND ps."PROJECT_ID" = p_project_id
        AND (p_as_of     IS NULL OR t."BOOKING_DATE" <= p_as_of::date)
        AND (p_date_from IS NULL OR t."BOOKING_DATE" >= p_date_from)
        AND (p_date_to   IS NULL OR t."BOOKING_DATE" <= p_date_to)
      GROUP BY t."STRUCTURE_ID"
    )

  SELECT
    ps."TENANT_ID",
    ps."PROJECT_ID"::bigint,
    ps."ID"::bigint        AS "STRUCTURE_ID",
    ps."FATHER_ID"::bigint AS "PARENT_STRUCTURE_ID",
    ps."ABBR",
    ps."NAME",

    NOT EXISTS (
      SELECT 1 FROM public."PROJECT_STRUCTURE" child
      WHERE  child."TENANT_ID" = ps."TENANT_ID"
        AND  child."FATHER_ID" = ps."ID"
    ) AS "IS_LEAF",

    COALESCE(t."HOURS_TOTAL", 0) AS "HOURS_TOTAL",
    COALESCE(t."COST_TOTAL",  0) AS "COST_TOTAL",

    -- BT2: earned = HOURLY_RATE_TOTAL; BT1: earned = recorded completion
    CASE WHEN b."BILLING_TYPE_ID" = 2
         THEN COALESCE(t."HOURLY_RATE_TOTAL", 0)
         ELSE COALESCE(c."REVENUE_COMPLETION", 0) + COALESCE(c."EXTRAS_COMPLETION", 0)
    END AS "EARNED_VALUE_NET",

    -- BT2: Honorar = HOURLY_RATE_TOTAL (hourly: billed amount IS the honorar, no fixed budget)
    CASE WHEN b."BILLING_TYPE_ID" = 2
         THEN COALESCE(t."HOURLY_RATE_TOTAL", 0)
         ELSE COALESCE(b."REVENUE", 0) + COALESCE(b."EXTRAS", 0)
    END AS "HONORAR_NET",

    -- BT2: rest = 0 (honorar = earned); BT1: budget - recorded completion
    CASE WHEN b."BILLING_TYPE_ID" = 2
         THEN 0
         ELSE (COALESCE(b."REVENUE", 0) + COALESCE(b."EXTRAS", 0))
            - (COALESCE(c."REVENUE_COMPLETION", 0) + COALESCE(c."EXTRAS_COMPLETION", 0))
    END AS "REST_HONORAR",

    -- BT2: 100 % if any BOOKING billed, else 0 %; BT1: recorded percent
    CASE WHEN b."BILLING_TYPE_ID" = 2
         THEN CASE WHEN COALESCE(t."HOURLY_RATE_TOTAL", 0) > 0 THEN 100.0 ELSE 0 END
         ELSE COALESCE(c."REVENUE_COMPLETION_PERCENT", 0)
    END AS "LEISTUNGSSTAND_PERCENT",

    CASE
      WHEN (CASE WHEN b."BILLING_TYPE_ID" = 2
                 THEN COALESCE(t."HOURLY_RATE_TOTAL", 0)
                 ELSE COALESCE(c."REVENUE_COMPLETION", 0) + COALESCE(c."EXTRAS_COMPLETION", 0)
            END) = 0 THEN NULL
      ELSE COALESCE(t."COST_TOTAL", 0)
         / (CASE WHEN b."BILLING_TYPE_ID" = 2
                 THEN COALESCE(t."HOURLY_RATE_TOTAL", 0)
                 ELSE COALESCE(c."REVENUE_COMPLETION", 0) + COALESCE(c."EXTRAS_COMPLETION", 0)
            END)
    END AS "KOSTENQUOTE"

  FROM public."PROJECT_STRUCTURE" ps
  LEFT JOIN budget     b ON b."STRUCTURE_ID" = ps."ID"
  LEFT JOIN completion c ON c."STRUCTURE_ID" = ps."ID"
  LEFT JOIN tec        t ON t."STRUCTURE_ID" = ps."ID"
  WHERE ps."TENANT_ID"  = p_tenant_id
    AND ps."PROJECT_ID" = p_project_id
  ORDER BY ps."FATHER_ID" ASC NULLS FIRST, ps."ID" ASC
$function$;

-- ── public.fn_project_list_report ──
CREATE OR REPLACE FUNCTION public.fn_project_list_report(p_tenant_id bigint, p_as_of timestamp with time zone DEFAULT NULL::timestamp with time zone, p_date_from date DEFAULT NULL::date, p_date_to date DEFAULT NULL::date)
 RETURNS TABLE("PROJECT_ID" bigint, "ABBR" text, "NAME" text, "PROJECT_STATUS_ID" bigint, "PROJECT_STATUS_NAME_SHORT" text, "PROJECT_TYPE_ID" bigint, "PROJECT_TYPE_NAME_SHORT" text, "PROJECT_MANAGER_ID" bigint, "PROJECT_MANAGER_DISPLAY" text, "ADDRESS_ID" bigint, "ADDRESS_NAME" text, "COMPANY_ID" bigint, "COMPANY_NAME" text, "DEPARTMENT_ID" bigint, "DEPARTMENT_NAME" text, "BUDGET_TOTAL_NET" numeric, "LEISTUNGSSTAND_PERCENT" numeric, "LEISTUNGSSTAND_VALUE" numeric, "HOURS_TOTAL" numeric, "COST_TOTAL" numeric, "COST_RATIO" numeric, "REMAINING_BUDGET_NET" numeric, "BILLED_NET_TOTAL" numeric, "OPEN_NET_TOTAL" numeric, "PAYED_NET_TOTAL" numeric, "SALES_TOTAL" numeric, "QTY_EXT_TOTAL" numeric)
 LANGUAGE sql
 STABLE
AS $function$
  WITH
    cutoff AS (
      SELECT
        CASE
          WHEN p_as_of   IS NOT NULL THEN p_as_of
          WHEN p_date_to IS NOT NULL THEN (p_date_to::timestamptz + INTERVAL '1 day' - INTERVAL '1 microsecond')
          ELSE now()
        END AS ts
    ),

    leaf_structs AS (
      SELECT
        ps."PROJECT_ID",
        ps."ID"              AS "STRUCTURE_ID",
        ps."BILLING_TYPE_ID",
        ps."REVENUE"         AS "REV_FALLBACK",
        ps."EXTRAS"          AS "EXT_FALLBACK",
        ps."created_at"      AS "CREATED_AT"
      FROM public."PROJECT_STRUCTURE" ps
      WHERE ps."TENANT_ID" = p_tenant_id
        AND NOT EXISTS (
          SELECT 1 FROM public."PROJECT_STRUCTURE" child
          WHERE  child."TENANT_ID" = ps."TENANT_ID"
            AND  child."FATHER_ID" = ps."ID"
        )
    ),

    budget AS (
      SELECT
        ls."PROJECT_ID",
        ls."STRUCTURE_ID",
        ls."BILLING_TYPE_ID",
        COALESCE(
          pp_bud."REVENUE",
          CASE WHEN ls."CREATED_AT" <= c.ts THEN ls."REV_FALLBACK" END,
          0
        ) AS "REVENUE",
        COALESCE(
          pp_bud."EXTRAS",
          CASE WHEN ls."CREATED_AT" <= c.ts THEN ls."EXT_FALLBACK" END,
          0
        ) AS "EXTRAS"
      FROM leaf_structs ls
      CROSS JOIN cutoff c
      LEFT JOIN LATERAL (
        SELECT pp."REVENUE", pp."EXTRAS"
        FROM   public."PROJECT_PROGRESS" pp
        WHERE  pp."STRUCTURE_ID" = ls."STRUCTURE_ID"
          AND  pp."TENANT_ID"    = p_tenant_id
          AND  pp."REVENUE"      IS NOT NULL
          AND  pp."AS_OF_DATE" <= (CASE WHEN p_as_of IS NULL AND p_date_to IS NULL THEN 'infinity'::date ELSE c.ts::date END)
        ORDER  BY pp."AS_OF_DATE" DESC, pp."created_at" DESC, pp."ID" DESC
        LIMIT  1
      ) pp_bud ON true
    ),

    completion AS (
      SELECT
        ls."STRUCTURE_ID",
        COALESCE(pp_compl."REVENUE_COMPLETION", 0) AS "REVENUE_COMPLETION",
        COALESCE(pp_compl."EXTRAS_COMPLETION",  0) AS "EXTRAS_COMPLETION"
      FROM leaf_structs ls
      CROSS JOIN cutoff c
      LEFT JOIN LATERAL (
        SELECT pp."REVENUE_COMPLETION", pp."EXTRAS_COMPLETION"
        FROM   public."PROJECT_PROGRESS" pp
        WHERE  pp."STRUCTURE_ID"      = ls."STRUCTURE_ID"
          AND  pp."TENANT_ID"         = p_tenant_id
          AND  pp."REVENUE_COMPLETION" IS NOT NULL
          AND  pp."AS_OF_DATE" <= (CASE WHEN p_as_of IS NULL AND p_date_to IS NULL THEN 'infinity'::date ELSE c.ts::date END)
        ORDER  BY pp."AS_OF_DATE" DESC, pp."created_at" DESC, pp."ID" DESC
        LIMIT  1
      ) pp_compl ON true
      WHERE ls."BILLING_TYPE_ID" <> 2
    ),

    tec_leaf AS (
      SELECT
        t."STRUCTURE_ID",
        COALESCE(SUM(t."QUANTITY_INT"), 0) AS "HOURS_TOTAL",
        COALESCE(SUM(t."COST_TOTAL"),       0) AS "COST_TOTAL",
        COALESCE(SUM(t."HOURLY_RATE_TOTAL"),       0) AS "HOURLY_RATE_TOTAL",
        COALESCE(SUM(t."QUANTITY_EXT"), 0) AS "QTY_EXT_TOTAL"
      FROM public."BOOKING" t
      WHERE t."TENANT_ID"    = p_tenant_id
        AND t."STRUCTURE_ID" IN (SELECT "STRUCTURE_ID" FROM leaf_structs)
        AND (p_as_of     IS NULL OR t."BOOKING_DATE" <= p_as_of::date)
        AND (p_date_from IS NULL OR t."BOOKING_DATE" >= p_date_from)
        AND (p_date_to   IS NULL OR t."BOOKING_DATE" <= p_date_to)
      GROUP BY t."STRUCTURE_ID"
    ),

    -- For BT2: budget = HOURLY_RATE_TOTAL (billed amount IS the honorar, no fixed budget applies)
    prog_agg AS (
      SELECT
        b."PROJECT_ID",
        COALESCE(SUM(
          CASE WHEN b."BILLING_TYPE_ID" = 2
               THEN COALESCE(tl."HOURLY_RATE_TOTAL", 0)
               ELSE COALESCE(b."REVENUE", 0)
          END
        ), 0) AS "REVENUE_BUDGET",
        COALESCE(SUM(
          CASE WHEN b."BILLING_TYPE_ID" = 2 THEN 0
               ELSE COALESCE(b."EXTRAS", 0)
          END
        ), 0) AS "EXTRAS_BUDGET",
        COALESCE(SUM(
          CASE WHEN b."BILLING_TYPE_ID" = 2 THEN COALESCE(tl."HOURLY_RATE_TOTAL", 0)
               ELSE COALESCE(c."REVENUE_COMPLETION", 0) END
        ), 0) AS "REVENUE_COMPLETION_VALUE",
        COALESCE(SUM(
          CASE WHEN b."BILLING_TYPE_ID" = 2 THEN 0
               ELSE COALESCE(c."EXTRAS_COMPLETION", 0) END
        ), 0) AS "EXTRAS_COMPLETION_VALUE",
        CASE
          WHEN SUM(
            CASE WHEN b."BILLING_TYPE_ID" = 2
                 THEN COALESCE(tl."HOURLY_RATE_TOTAL", 0)
                 ELSE COALESCE(b."REVENUE", 0) + COALESCE(b."EXTRAS", 0)
            END
          ) = 0 THEN NULL
          ELSE 100.0
             * SUM(
                 CASE WHEN b."BILLING_TYPE_ID" = 2 THEN COALESCE(tl."HOURLY_RATE_TOTAL", 0)
                      ELSE COALESCE(c."REVENUE_COMPLETION", 0)
                 END
               + CASE WHEN b."BILLING_TYPE_ID" = 2 THEN 0
                      ELSE COALESCE(c."EXTRAS_COMPLETION", 0)
                 END
               )
             / SUM(
                 CASE WHEN b."BILLING_TYPE_ID" = 2
                      THEN COALESCE(tl."HOURLY_RATE_TOTAL", 0)
                      ELSE COALESCE(b."REVENUE", 0) + COALESCE(b."EXTRAS", 0)
                 END
               )
        END AS "LEISTUNGSSTAND_PERCENT"
      FROM budget b
      LEFT JOIN completion c  ON  c."STRUCTURE_ID" = b."STRUCTURE_ID"
      LEFT JOIN tec_leaf   tl ON tl."STRUCTURE_ID" = b."STRUCTURE_ID"
      GROUP BY b."PROJECT_ID"
    ),

    tec_agg AS (
      SELECT
        b."PROJECT_ID",
        COALESCE(SUM(tl."HOURS_TOTAL"),   0) AS "HOURS_TOTAL",
        COALESCE(SUM(tl."COST_TOTAL"),    0) AS "COST_TOTAL",
        COALESCE(SUM(tl."HOURLY_RATE_TOTAL"),        0) AS "SALES_TOTAL",
        COALESCE(SUM(tl."QTY_EXT_TOTAL"), 0) AS "QTY_EXT_TOTAL"
      FROM (SELECT DISTINCT "PROJECT_ID", "STRUCTURE_ID" FROM budget) b
      LEFT JOIN tec_leaf tl ON tl."STRUCTURE_ID" = b."STRUCTURE_ID"
      GROUP BY b."PROJECT_ID"
    ),

    billed_agg AS (
      SELECT
        pp."PROJECT_ID",
        COALESCE(SUM(pp."AMOUNT_NET" + COALESCE(pp."AMOUNT_EXTRAS_NET", 0)), 0) AS "PP_NET",
        0::numeric AS "INV_NET"
      FROM public."ADVANCE_INVOICE" pp
      WHERE pp."TENANT_ID" = p_tenant_id
        AND pp."STATUS_ID" = 2
        AND (p_as_of     IS NULL OR pp."ADVANCE_INVOICE_DATE" <= p_as_of::date)
        AND (p_date_from IS NULL OR pp."ADVANCE_INVOICE_DATE" >= p_date_from)
        AND (p_date_to   IS NULL OR pp."ADVANCE_INVOICE_DATE" <= p_date_to)
      GROUP BY pp."PROJECT_ID"

      UNION ALL

      SELECT
        inv."PROJECT_ID",
        0::numeric AS "PP_NET",
        COALESCE(SUM(inv."TOTAL_AMOUNT_NET"), 0) AS "INV_NET"
      FROM public."INVOICE" inv
      WHERE inv."TENANT_ID" = p_tenant_id
        AND inv."STATUS_ID" = 2
        AND (p_as_of     IS NULL OR inv."INVOICE_DATE" <= p_as_of::date)
        AND (p_date_from IS NULL OR inv."INVOICE_DATE" >= p_date_from)
        AND (p_date_to   IS NULL OR inv."INVOICE_DATE" <= p_date_to)
      GROUP BY inv."PROJECT_ID"
    ),

    billed_by_project AS (
      SELECT "PROJECT_ID",
             SUM("PP_NET")  AS "BILLED_PP",
             SUM("INV_NET") AS "BILLED_INV"
      FROM billed_agg
      GROUP BY "PROJECT_ID"
    ),

    pay_agg AS (
      SELECT
        pay."PROJECT_ID",
        COALESCE(SUM(pay."AMOUNT_PAYED_NET"), 0) AS "PAYED_NET_TOTAL"
      FROM public."PAYMENT" pay
      WHERE pay."TENANT_ID" = p_tenant_id
        AND (p_as_of     IS NULL OR pay."PAYMENT_DATE" <= p_as_of::date)
        AND (p_date_from IS NULL OR pay."PAYMENT_DATE" >= p_date_from)
        AND (p_date_to   IS NULL OR pay."PAYMENT_DATE" <= p_date_to)
      GROUP BY pay."PROJECT_ID"
    )

  SELECT
    proj."ID"::bigint                                                   AS "PROJECT_ID",
    proj."ABBR",
    proj."NAME",
    proj."PROJECT_STATUS_ID"::bigint,
    ps_lkp."ABBR"                                                 AS "PROJECT_STATUS_NAME_SHORT",
    proj."PROJECT_TYPE_ID"::bigint,
    pt."ABBR"                                                     AS "PROJECT_TYPE_NAME_SHORT",
    proj."PROJECT_MANAGER_ID"::bigint,
    ( e."ABBR" ||
      CASE WHEN e."FIRST_NAME" IS NOT NULL
           THEN ': ' || e."FIRST_NAME" || ' ' || COALESCE(e."LAST_NAME", '')
           ELSE '' END
    )                                                                   AS "PROJECT_MANAGER_DISPLAY",
    proj."ADDRESS_ID"::bigint,
    a."ADDRESS_NAME_1"                                                  AS "ADDRESS_NAME",
    proj."COMPANY_ID"::bigint,
    c."COMPANY_NAME_1"                                                  AS "COMPANY_NAME",
    proj."DEPARTMENT_ID"::bigint,
    d."ABBR"                                                      AS "DEPARTMENT_NAME",

    COALESCE(pa."REVENUE_BUDGET", 0) + COALESCE(pa."EXTRAS_BUDGET", 0) AS "BUDGET_TOTAL_NET",
    pa."LEISTUNGSSTAND_PERCENT",
    COALESCE(pa."REVENUE_COMPLETION_VALUE", 0) + COALESCE(pa."EXTRAS_COMPLETION_VALUE", 0)
                                                                        AS "LEISTUNGSSTAND_VALUE",
    COALESCE(ta."HOURS_TOTAL", 0),
    COALESCE(ta."COST_TOTAL",  0),
    CASE
      WHEN (COALESCE(pa."REVENUE_COMPLETION_VALUE", 0) + COALESCE(pa."EXTRAS_COMPLETION_VALUE", 0)) = 0 THEN NULL
      ELSE COALESCE(ta."COST_TOTAL", 0)
         / (COALESCE(pa."REVENUE_COMPLETION_VALUE", 0) + COALESCE(pa."EXTRAS_COMPLETION_VALUE", 0))
    END                                                                 AS "COST_RATIO",
    ( COALESCE(pa."REVENUE_BUDGET", 0) + COALESCE(pa."EXTRAS_BUDGET", 0) )
    - ( COALESCE(pa."REVENUE_COMPLETION_VALUE", 0) + COALESCE(pa."EXTRAS_COMPLETION_VALUE", 0) )
                                                                        AS "REMAINING_BUDGET_NET",
    COALESCE(bp."BILLED_PP", 0) + COALESCE(bp."BILLED_INV", 0)        AS "BILLED_NET_TOTAL",
    ( COALESCE(pa."REVENUE_COMPLETION_VALUE", 0) + COALESCE(pa."EXTRAS_COMPLETION_VALUE", 0) )
    - ( COALESCE(bp."BILLED_PP", 0) + COALESCE(bp."BILLED_INV", 0) )  AS "OPEN_NET_TOTAL",
    COALESCE(pya."PAYED_NET_TOTAL", 0),
    COALESCE(ta."SALES_TOTAL",   0),
    COALESCE(ta."QTY_EXT_TOTAL", 0)

  FROM public."PROJECT" proj
  LEFT JOIN prog_agg        pa  ON  pa."PROJECT_ID"  = proj."ID"
  LEFT JOIN tec_agg         ta  ON  ta."PROJECT_ID"  = proj."ID"
  LEFT JOIN billed_by_project bp ON bp."PROJECT_ID"  = proj."ID"
  LEFT JOIN pay_agg         pya ON pya."PROJECT_ID"  = proj."ID"
  LEFT JOIN public."PROJECT_STATUS" ps_lkp ON ps_lkp."ID" = proj."PROJECT_STATUS_ID"
  LEFT JOIN public."PROJECT_TYPE"   pt     ON pt."ID"     = proj."PROJECT_TYPE_ID"
  LEFT JOIN public."EMPLOYEE" e
    ON  e."TENANT_ID" = proj."TENANT_ID"
   AND  e."ID"        = proj."PROJECT_MANAGER_ID"
  LEFT JOIN public."ADDRESS" a
    ON  a."TENANT_ID" = proj."TENANT_ID"
   AND  a."ID"        = proj."ADDRESS_ID"
  LEFT JOIN public."COMPANY" c
    ON  c."TENANT_ID" = proj."TENANT_ID"
   AND  c."ID"        = proj."COMPANY_ID"
  LEFT JOIN public."DEPARTMENT" d ON d."ID" = proj."DEPARTMENT_ID"
  WHERE proj."TENANT_ID" = p_tenant_id
  ORDER BY proj."ABBR"
$function$;

-- ── REPORTING.FN_REPORT_PROJECT_DETAIL ──
CREATE OR REPLACE FUNCTION "REPORTING"."FN_REPORT_PROJECT_DETAIL"(p_tenant_id bigint, p_project_id bigint, p_as_of timestamp with time zone, p_date_from date, p_date_to date)
 RETURNS TABLE("TENANT_ID" bigint, "PROJECT_ID" bigint, "ABBR" text, "NAME" text, "PROJECT_STATUS_ID" bigint, "PROJECT_STATUS_NAME_SHORT" text, "PROJECT_TYPE_ID" bigint, "PROJECT_TYPE_NAME_SHORT" text, "PROJECT_MANAGER_ID" bigint, "PROJECT_MANAGER_DISPLAY" text, "ADDRESS_ID" bigint, "ADDRESS_NAME" text, "COMPANY_ID" bigint, "COMPANY_NAME" text, "DEPARTMENT_ID" bigint, "DEPARTMENT_NAME" text, "CONTACT_ID" bigint, "CONTACT_NAME" text, "BUDGET_TOTAL_NET" numeric, "LEISTUNGSSTAND_PERCENT" numeric, "LEISTUNGSSTAND_VALUE" numeric, "HOURS_TOTAL" numeric, "COST_TOTAL" numeric, "DECKUNGSBEITRAG" numeric, "PROGNOSE_KOSTEN" numeric, "PROGNOSE_DECKUNGSBEITRAG" numeric, "ADVANCE_INVOICE_NET_TOTAL" numeric, "INVOICE_NET_TOTAL" numeric, "PAYED_NET_TOTAL" numeric, "BILLED_NET_TOTAL" numeric, "OPEN_NET_TOTAL" numeric, "ABRECHENBAR_NET" numeric)
 LANGUAGE sql
 STABLE
AS $function$
with params as (
  select
    coalesce(p_as_of, now()) as as_of_ts,
    p_date_from as date_from,
    p_date_to as date_to
),

-- progress as-of: Stichtag des Standes (AS_OF_DATE, Migration 0170)
progress_latest as (
  select distinct on (pp."TENANT_ID", pp."STRUCTURE_ID")
    pp."TENANT_ID",
    pp."STRUCTURE_ID",
    pp."REVENUE",
    pp."EXTRAS",
    pp."REVENUE_COMPLETION_PERCENT",
    pp."REVENUE_COMPLETION",
    pp."EXTRAS_COMPLETION",
    pp."created_at",
    pp."ID" as "PROJECT_PROGRESS_ID"
  from public."PROJECT_PROGRESS" pp
  cross join params
  where pp."TENANT_ID" = p_tenant_id
    and pp."AS_OF_DATE" <= (CASE WHEN p_as_of IS NULL THEN 'infinity'::date ELSE params.as_of_ts::date END)
  order by
    pp."TENANT_ID", pp."STRUCTURE_ID",
    pp."AS_OF_DATE" desc,
    pp."created_at" desc,
    pp."ID" desc
),

progress_agg as (
  select
    ps."TENANT_ID",
    ps."PROJECT_ID",
    sum(coalesce(pl."REVENUE",0)) as "REVENUE_BUDGET",
    sum(coalesce(pl."EXTRAS",0))  as "EXTRAS_BUDGET",
    avg(nullif(pl."REVENUE_COMPLETION_PERCENT",0)) as "REVENUE_COMPLETION_PERCENT_AVG",
    sum(coalesce(pl."REVENUE_COMPLETION",0)) as "REVENUE_COMPLETION_VALUE",
    sum(coalesce(pl."EXTRAS_COMPLETION",0))  as "EXTRAS_COMPLETION_VALUE"
  from progress_latest pl
  join public."PROJECT_STRUCTURE" ps
    on ps."TENANT_ID" = pl."TENANT_ID"
   and ps."ID"        = pl."STRUCTURE_ID"
  where ps."PROJECT_ID" = p_project_id
  group by ps."TENANT_ID", ps."PROJECT_ID"
),

/* ✅ FIXED: BOOKING now respects period OR as-of */
time_agg as (
  select
    ps."TENANT_ID",
    ps."PROJECT_ID",
    sum(coalesce(t."QUANTITY_INT",0)) as "HOURS_TOTAL",
    sum(coalesce(t."COST_TOTAL",0))       as "COST_TOTAL"
  from public."BOOKING" t
  join public."PROJECT_STRUCTURE" ps
    on ps."TENANT_ID" = t."TENANT_ID"
   and ps."ID"        = t."STRUCTURE_ID"
  cross join params
  where ps."TENANT_ID" = p_tenant_id
    and ps."PROJECT_ID" = p_project_id
    and (
      -- period mode has priority if any bound is provided
      (
        (params.date_from is not null or params.date_to is not null)
        and (params.date_from is null or t."BOOKING_DATE"::date >= params.date_from)
        and (params.date_to   is null or t."BOOKING_DATE"::date <= params.date_to)
      )
      or
      -- otherwise stichtag/as-of mode
      (
        params.date_from is null and params.date_to is null
        and t."BOOKING_DATE"::date <= params.as_of_ts::date
      )
    )
  group by ps."TENANT_ID", ps."PROJECT_ID"
),

/* ✅ FIXED: PP/Invoice/Payment now also respect period OR as-of */
billing_agg as (
  select
    p."TENANT_ID",
    p."ID" as "PROJECT_ID",

    coalesce((
      select sum(coalesce(pp."TOTAL_AMOUNT_NET",0))
      from public."ADVANCE_INVOICE" pp
      cross join params
      where pp."TENANT_ID"  = p."TENANT_ID"
        and pp."PROJECT_ID" = p."ID"
        and (
          (
            (params.date_from is not null or params.date_to is not null)
            and (params.date_from is null or pp."ADVANCE_INVOICE_DATE"::date >= params.date_from)
            and (params.date_to   is null or pp."ADVANCE_INVOICE_DATE"::date <= params.date_to)
          )
          or
          (
            params.date_from is null and params.date_to is null
            and pp."ADVANCE_INVOICE_DATE"::date <= params.as_of_ts::date
          )
        )
    ),0) as "ADVANCE_INVOICE_NET_TOTAL",

    coalesce((
      select sum(coalesce(i."TOTAL_AMOUNT_NET",0))
      from public."INVOICE" i
      cross join params
      where i."TENANT_ID"   = p."TENANT_ID"
        and i."PROJECT_ID"  = p."ID"
        and (
          (
            (params.date_from is not null or params.date_to is not null)
            and (params.date_from is null or i."INVOICE_DATE"::date >= params.date_from)
            and (params.date_to   is null or i."INVOICE_DATE"::date <= params.date_to)
          )
          or
          (
            params.date_from is null and params.date_to is null
            and i."INVOICE_DATE"::date <= params.as_of_ts::date
          )
        )
    ),0) as "INVOICE_NET_TOTAL",

    coalesce((
      select sum(coalesce(pay."AMOUNT_PAYED_NET",0))
      from public."PAYMENT" pay
      cross join params
      where pay."TENANT_ID"  = p."TENANT_ID"
        and pay."PROJECT_ID" = p."ID"
        and (
          (
            (params.date_from is not null or params.date_to is not null)
            and (params.date_from is null or pay."PAYMENT_DATE"::date >= params.date_from)
            and (params.date_to   is null or pay."PAYMENT_DATE"::date <= params.date_to)
          )
          or
          (
            params.date_from is null and params.date_to is null
            and pay."PAYMENT_DATE"::date <= params.as_of_ts::date
          )
        )
    ),0) as "PAYED_NET_TOTAL"

  from public."PROJECT" p
  where p."TENANT_ID" = p_tenant_id
    and p."ID"        = p_project_id
)

select
  p."TENANT_ID",
  p."ID" as "PROJECT_ID",
  p."ABBR",
  p."NAME",

  p."PROJECT_STATUS_ID",
  ps."ABBR" as "PROJECT_STATUS_NAME_SHORT",
  p."PROJECT_TYPE_ID",
  pt."ABBR" as "PROJECT_TYPE_NAME_SHORT",
  p."PROJECT_MANAGER_ID",
  (e."ABBR" || case when e."FIRST_NAME" is not null then (': ' || e."FIRST_NAME" || ' ' || coalesce(e."LAST_NAME",'')) else '' end)
    as "PROJECT_MANAGER_DISPLAY",

  p."ADDRESS_ID",
  a."ADDRESS_NAME_1" as "ADDRESS_NAME",
  p."COMPANY_ID",
  c."COMPANY_NAME_1" as "COMPANY_NAME",
  p."DEPARTMENT_ID",
  d."ABBR" as "DEPARTMENT_NAME",
  p."CONTACT_ID",
  co."LAST_NAME" as "CONTACT_NAME",

  (coalesce(pa."REVENUE_BUDGET",0) + coalesce(pa."EXTRAS_BUDGET",0)) as "BUDGET_TOTAL_NET",
  coalesce(pa."REVENUE_COMPLETION_PERCENT_AVG", null) as "LEISTUNGSSTAND_PERCENT",
  (coalesce(pa."REVENUE_COMPLETION_VALUE",0) + coalesce(pa."EXTRAS_COMPLETION_VALUE",0)) as "LEISTUNGSSTAND_VALUE",
  coalesce(ta."HOURS_TOTAL",0) as "HOURS_TOTAL",
  coalesce(ta."COST_TOTAL",0)  as "COST_TOTAL",

  ((coalesce(pa."REVENUE_COMPLETION_VALUE",0) + coalesce(pa."EXTRAS_COMPLETION_VALUE",0)) - coalesce(ta."COST_TOTAL",0)) as "DECKUNGSBEITRAG",

  case
    when coalesce(pa."REVENUE_COMPLETION_PERCENT_AVG",0) = 0 then null
    else coalesce(ta."COST_TOTAL",0) / (coalesce(pa."REVENUE_COMPLETION_PERCENT_AVG",0) / 100.0)
  end as "PROGNOSE_KOSTEN",

  case
    when coalesce(pa."REVENUE_COMPLETION_PERCENT_AVG",0) = 0 then null
    else (coalesce(pa."REVENUE_BUDGET",0) + coalesce(pa."EXTRAS_BUDGET",0))
         - (coalesce(ta."COST_TOTAL",0) / (coalesce(pa."REVENUE_COMPLETION_PERCENT_AVG",0) / 100.0))
  end as "PROGNOSE_DECKUNGSBEITRAG",

  coalesce(ba."ADVANCE_INVOICE_NET_TOTAL",0) as "ADVANCE_INVOICE_NET_TOTAL",
  coalesce(ba."INVOICE_NET_TOTAL",0)         as "INVOICE_NET_TOTAL",
  coalesce(ba."PAYED_NET_TOTAL",0)           as "PAYED_NET_TOTAL",
  (coalesce(ba."ADVANCE_INVOICE_NET_TOTAL",0) + coalesce(ba."INVOICE_NET_TOTAL",0)) as "BILLED_NET_TOTAL",
  (coalesce(ba."ADVANCE_INVOICE_NET_TOTAL",0) + coalesce(ba."INVOICE_NET_TOTAL",0) - coalesce(ba."PAYED_NET_TOTAL",0)) as "OPEN_NET_TOTAL",
  ((coalesce(pa."REVENUE_COMPLETION_VALUE",0) + coalesce(pa."EXTRAS_COMPLETION_VALUE",0))
    - (coalesce(ba."ADVANCE_INVOICE_NET_TOTAL",0) + coalesce(ba."INVOICE_NET_TOTAL",0))) as "ABRECHENBAR_NET"

from public."PROJECT" p
left join progress_agg pa on pa."TENANT_ID" = p."TENANT_ID" and pa."PROJECT_ID" = p."ID"
left join time_agg ta     on ta."TENANT_ID" = p."TENANT_ID" and ta."PROJECT_ID" = p."ID"
left join billing_agg ba  on ba."TENANT_ID" = p."TENANT_ID" and ba."PROJECT_ID" = p."ID"
left join public."EMPLOYEE" e on e."TENANT_ID" = p."TENANT_ID" and e."ID" = p."PROJECT_MANAGER_ID"
left join public."PROJECT_STATUS" ps on ps."ID" = p."PROJECT_STATUS_ID"
left join public."PROJECT_TYPE" pt on pt."ID" = p."PROJECT_TYPE_ID"
left join public."ADDRESS" a on a."TENANT_ID" = p."TENANT_ID" and a."ID" = p."ADDRESS_ID"
left join public."COMPANY" c on c."TENANT_ID" = p."TENANT_ID" and c."ID" = p."COMPANY_ID"
left join public."DEPARTMENT" d on d."TENANT_ID" = p."TENANT_ID" and d."ID" = p."DEPARTMENT_ID"
left join public."CONTACTS" co on co."TENANT_ID" = p."TENANT_ID" and co."ID" = p."CONTACT_ID"
where p."TENANT_ID" = p_tenant_id
  and p."ID"        = p_project_id;
$function$;

-- ── public.fn_dashboard_kpis ──
CREATE OR REPLACE FUNCTION public.fn_dashboard_kpis(p_tenant_id bigint)
 RETURNS TABLE("HONORAR_GESAMT" numeric, "LEISTUNGSSTAND_VALUE" numeric, "OFFENE_LEISTUNG" numeric, "STUNDEN_MONAT" numeric, "ABSCHLAGSRECHNUNGEN" numeric, "SCHLUSSGERECHNET" numeric)
 LANGUAGE sql
 STABLE
AS $function$
  with
    prog_latest as (
      select distinct on (pp."STRUCTURE_ID")
        pp."REVENUE",
        pp."EXTRAS",
        pp."REVENUE_COMPLETION",
        pp."EXTRAS_COMPLETION"
      from public."PROJECT_PROGRESS" pp
      where pp."TENANT_ID" = p_tenant_id
      order by pp."STRUCTURE_ID", pp."AS_OF_DATE" desc, pp."created_at" desc, pp."ID" desc
    ),
    prog_agg as (
      select
        coalesce(sum(coalesce(pl."REVENUE",0) + coalesce(pl."EXTRAS",0)), 0)                         as "HONORAR_GESAMT",
        coalesce(sum(coalesce(pl."REVENUE_COMPLETION",0) + coalesce(pl."EXTRAS_COMPLETION",0)), 0)   as "LEISTUNGSSTAND_VALUE"
      from prog_latest pl
    ),
    billing_agg as (
      select
        coalesce(sum(coalesce(p."ADVANCE_INVOICED",0)), 0) as "ABSCHLAGSRECHNUNGEN",
        coalesce(sum(coalesce(p."INVOICED",0)),         0) as "SCHLUSSGERECHNET"
      from public."PROJECT" p
      where p."TENANT_ID" = p_tenant_id
    ),
    tec_month as (
      select coalesce(sum(t."QUANTITY_INT"), 0) as "STUNDEN_MONAT"
      from public."BOOKING" t
      where t."TENANT_ID" = p_tenant_id
        and coalesce(t."ENTRY_KIND", 'WORK') <> 'BREAK'
        and date_trunc('month', t."BOOKING_DATE"::timestamptz)
            = date_trunc('month', now())
    )
  select
    pa."HONORAR_GESAMT",
    pa."LEISTUNGSSTAND_VALUE",
    pa."LEISTUNGSSTAND_VALUE" - ba."ABSCHLAGSRECHNUNGEN" - ba."SCHLUSSGERECHNET" as "OFFENE_LEISTUNG",
    tm."STUNDEN_MONAT",
    ba."ABSCHLAGSRECHNUNGEN",
    ba."SCHLUSSGERECHNET"
  from prog_agg pa
  cross join billing_agg ba
  cross join tec_month tm
$function$;

-- ── public.fn_wip_snapshot_dates ──
CREATE OR REPLACE FUNCTION public.fn_wip_snapshot_dates(p_tenant_id bigint, p_as_of timestamp with time zone)
 RETURNS TABLE("PROJECT_ID" bigint, "SNAPSHOT_AT" timestamp with time zone)
 LANGUAGE sql
 STABLE
AS $function$
  SELECT ps."PROJECT_ID", MAX(pp."AS_OF_DATE")::timestamptz
  FROM   public."PROJECT_PROGRESS" pp
  JOIN   public."PROJECT_STRUCTURE" ps
    ON   ps."ID"        = pp."STRUCTURE_ID"
   AND   ps."TENANT_ID" = pp."TENANT_ID"
  WHERE  pp."TENANT_ID"          = p_tenant_id
    AND  pp."AS_OF_DATE"        <= p_as_of::date
    AND  pp."REVENUE_COMPLETION" IS NOT NULL
  GROUP BY ps."PROJECT_ID"
$function$;

-- Gegenprobe: jede Zeile hat einen Stichtag (mit Claim, sonst zaehlt man null Zeilen).
DO $$
DECLARE offen bigint;
BEGIN
  SELECT count(*) INTO offen FROM "PROJECT_PROGRESS" WHERE "AS_OF_DATE" IS NULL;
  IF offen > 0 THEN
    RAISE EXCEPTION 'PROJECT_PROGRESS: % Zeilen ohne AS_OF_DATE', offen;
  END IF;
  RAISE NOTICE 'PROJECT_PROGRESS: % Zeilen mit Stichtag', (SELECT count(*) FROM "PROJECT_PROGRESS");
END $$;

RESET request.jwt.claims;
