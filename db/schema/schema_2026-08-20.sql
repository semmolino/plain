Done in 0.137 seconds
--
-- PostgreSQL database dump
--


-- Dumped from database version 17.9 (Debian 17.9-1.pgdg12+1)
-- Dumped by pg_dump version 17.11 (Ubuntu 17.11-1.pgdg26.04+2)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: public; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA public;


--
-- Name: FN_REPORT_PROJECT_DETAIL(bigint, bigint, timestamp with time zone, date, date); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public."FN_REPORT_PROJECT_DETAIL"(p_tenant_id bigint, p_project_id bigint, p_as_of timestamp with time zone DEFAULT NULL::timestamp with time zone, p_date_from date DEFAULT NULL::date, p_date_to date DEFAULT NULL::date) RETURNS TABLE("TENANT_ID" bigint, "PROJECT_ID" bigint, "NAME_SHORT" text, "NAME_LONG" text, "PROJECT_STATUS_ID" bigint, "PROJECT_STATUS_NAME_SHORT" text, "PROJECT_TYPE_ID" bigint, "PROJECT_TYPE_NAME_SHORT" text, "PROJECT_MANAGER_ID" bigint, "PROJECT_MANAGER_DISPLAY" text, "ADDRESS_ID" bigint, "ADDRESS_NAME" text, "COMPANY_ID" bigint, "COMPANY_NAME" text, "DEPARTMENT_ID" bigint, "DEPARTMENT_NAME" text, "CONTACT_ID" bigint, "CONTACT_NAME" text, "BUDGET_TOTAL_NET" numeric, "LEISTUNGSSTAND_PERCENT" numeric, "LEISTUNGSSTAND_VALUE" numeric, "HOURS_TOTAL" numeric, "COST_TOTAL" numeric, "DECKUNGSBEITRAG" numeric, "PROGNOSE_KOSTEN" numeric, "PROGNOSE_DECKUNGSBEITRAG" numeric, "PARTIAL_PAYMENT_NET_TOTAL" numeric, "INVOICE_NET_TOTAL" numeric, "PAYED_NET_TOTAL" numeric, "BILLED_NET_TOTAL" numeric, "OPEN_NET_TOTAL" numeric, "ABRECHENBAR_NET" numeric)
    LANGUAGE sql STABLE
    AS $$
  select *
  from "REPORTING"."FN_REPORT_PROJECT_DETAIL"(
    p_tenant_id,
    p_project_id,
    p_as_of,
    p_date_from,
    p_date_to
  );
$$;


--
-- Name: bump_license_plan_version(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.bump_license_plan_version() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
  target_plan INTEGER := COALESCE(NEW."PLAN_ID", OLD."PLAN_ID");
BEGIN
  UPDATE "LICENSE_PLAN"
     SET "VERSION" = "VERSION" + 1, "UPDATED_AT" = NOW()
   WHERE "ID" = target_plan;
  RETURN NULL;
END $$;


--
-- Name: current_tenant_id(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.current_tenant_id() RETURNS integer
    LANGUAGE sql STABLE
    AS $$
  SELECT NULLIF(
           NULLIF(current_setting('request.jwt.claims', true), '')::json ->> 'tenant_id',
           ''
         )::integer
$$;


--
-- Name: FUNCTION current_tenant_id(); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.current_tenant_id() IS 'Mandanten-ID aus dem PostgREST-JWT. NULL ausserhalb eines Requests -> RLS liefert keine Zeilen.';


--
-- Name: fn_dashboard_by_status(bigint); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_dashboard_by_status(p_tenant_id bigint) RETURNS TABLE("STATUS_NAME" text, "PROJECT_COUNT" bigint)
    LANGUAGE sql STABLE
    AS $$
  select
    coalesce(ps."NAME_SHORT", 'Kein Status') as "STATUS_NAME",
    count(p."ID")::bigint                     as "PROJECT_COUNT"
  from public."PROJECT" p
  left join public."PROJECT_STATUS" ps on ps."ID" = p."PROJECT_STATUS_ID"
  where p."TENANT_ID" = p_tenant_id
  group by ps."NAME_SHORT"
  order by count(p."ID") desc
$$;


--
-- Name: fn_dashboard_kpis(bigint); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_dashboard_kpis(p_tenant_id bigint) RETURNS TABLE("HONORAR_GESAMT" numeric, "LEISTUNGSSTAND_VALUE" numeric, "OFFENE_LEISTUNG" numeric, "STUNDEN_MONAT" numeric, "ABSCHLAGSRECHNUNGEN" numeric, "SCHLUSSGERECHNET" numeric)
    LANGUAGE sql STABLE
    AS $$
  with
    prog_latest as (
      select distinct on (pp."STRUCTURE_ID")
        pp."REVENUE",
        pp."EXTRAS",
        pp."REVENUE_COMPLETION",
        pp."EXTRAS_COMPLETION"
      from public."PROJECT_PROGRESS" pp
      where pp."TENANT_ID" = p_tenant_id
      order by pp."STRUCTURE_ID", pp."created_at" desc, pp."ID" desc
    ),
    prog_agg as (
      select
        coalesce(sum(coalesce(pl."REVENUE",0) + coalesce(pl."EXTRAS",0)), 0)                         as "HONORAR_GESAMT",
        coalesce(sum(coalesce(pl."REVENUE_COMPLETION",0) + coalesce(pl."EXTRAS_COMPLETION",0)), 0)   as "LEISTUNGSSTAND_VALUE"
      from prog_latest pl
    ),
    billing_agg as (
      select
        coalesce(sum(coalesce(p."PARTIAL_PAYMENTS",0)), 0) as "ABSCHLAGSRECHNUNGEN",
        coalesce(sum(coalesce(p."INVOICED",0)),         0) as "SCHLUSSGERECHNET"
      from public."PROJECT" p
      where p."TENANT_ID" = p_tenant_id
    ),
    tec_month as (
      select coalesce(sum(t."QUANTITY_INT"), 0) as "STUNDEN_MONAT"
      from public."TEC" t
      where t."TENANT_ID" = p_tenant_id
        and coalesce(t."ENTRY_KIND", 'WORK') <> 'BREAK'
        and date_trunc('month', t."DATE_VOUCHER"::timestamptz)
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
$$;


--
-- Name: fn_dashboard_monthly(bigint); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_dashboard_monthly(p_tenant_id bigint) RETURNS TABLE("MONTH" text, "HOURS_TOTAL" numeric, "COST_TOTAL" numeric)
    LANGUAGE sql STABLE
    AS $$
  select
    to_char(date_trunc('month', t."DATE_VOUCHER"::date), 'YYYY-MM') as "MONTH",
    coalesce(sum(t."QUANTITY_INT"), 0)                               as "HOURS_TOTAL",
    coalesce(sum(t."CP_TOT"),       0)                               as "COST_TOTAL"
  from public."TEC" t
  where t."TENANT_ID" = p_tenant_id
    and coalesce(t."ENTRY_KIND", 'WORK') <> 'BREAK'
    and t."DATE_VOUCHER" >= (date_trunc('month', current_date) - interval '5 months')::date
  group by date_trunc('month', t."DATE_VOUCHER"::date)
  order by 1
$$;


--
-- Name: fn_project_list_report(bigint, timestamp with time zone, date, date); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_project_list_report(p_tenant_id bigint, p_as_of timestamp with time zone DEFAULT NULL::timestamp with time zone, p_date_from date DEFAULT NULL::date, p_date_to date DEFAULT NULL::date) RETURNS TABLE("PROJECT_ID" bigint, "NAME_SHORT" text, "NAME_LONG" text, "PROJECT_STATUS_ID" bigint, "PROJECT_STATUS_NAME_SHORT" text, "PROJECT_TYPE_ID" bigint, "PROJECT_TYPE_NAME_SHORT" text, "PROJECT_MANAGER_ID" bigint, "PROJECT_MANAGER_DISPLAY" text, "ADDRESS_ID" bigint, "ADDRESS_NAME" text, "COMPANY_ID" bigint, "COMPANY_NAME" text, "DEPARTMENT_ID" bigint, "DEPARTMENT_NAME" text, "BUDGET_TOTAL_NET" numeric, "LEISTUNGSSTAND_PERCENT" numeric, "LEISTUNGSSTAND_VALUE" numeric, "HOURS_TOTAL" numeric, "COST_TOTAL" numeric, "COST_RATIO" numeric, "REMAINING_BUDGET_NET" numeric, "BILLED_NET_TOTAL" numeric, "OPEN_NET_TOTAL" numeric, "PAYED_NET_TOTAL" numeric, "SALES_TOTAL" numeric, "QTY_EXT_TOTAL" numeric)
    LANGUAGE sql STABLE
    AS $$
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
          AND  pp."created_at"  <= c.ts
        ORDER  BY pp."created_at" DESC, pp."ID" DESC
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
          AND  pp."created_at"        <= c.ts
        ORDER  BY pp."created_at" DESC, pp."ID" DESC
        LIMIT  1
      ) pp_compl ON true
      WHERE ls."BILLING_TYPE_ID" <> 2
    ),

    tec_leaf AS (
      SELECT
        t."STRUCTURE_ID",
        COALESCE(SUM(t."QUANTITY_INT"), 0) AS "HOURS_TOTAL",
        COALESCE(SUM(t."CP_TOT"),       0) AS "COST_TOTAL",
        COALESCE(SUM(t."SP_TOT"),       0) AS "SP_TOT",
        COALESCE(SUM(t."QUANTITY_EXT"), 0) AS "QTY_EXT_TOTAL"
      FROM public."TEC" t
      WHERE t."TENANT_ID"    = p_tenant_id
        AND t."STRUCTURE_ID" IN (SELECT "STRUCTURE_ID" FROM leaf_structs)
        AND (p_as_of     IS NULL OR t."DATE_VOUCHER" <= p_as_of::date)
        AND (p_date_from IS NULL OR t."DATE_VOUCHER" >= p_date_from)
        AND (p_date_to   IS NULL OR t."DATE_VOUCHER" <= p_date_to)
      GROUP BY t."STRUCTURE_ID"
    ),

    -- For BT2: budget = SP_TOT (billed amount IS the honorar, no fixed budget applies)
    prog_agg AS (
      SELECT
        b."PROJECT_ID",
        COALESCE(SUM(
          CASE WHEN b."BILLING_TYPE_ID" = 2
               THEN COALESCE(tl."SP_TOT", 0)
               ELSE COALESCE(b."REVENUE", 0)
          END
        ), 0) AS "REVENUE_BUDGET",
        COALESCE(SUM(
          CASE WHEN b."BILLING_TYPE_ID" = 2 THEN 0
               ELSE COALESCE(b."EXTRAS", 0)
          END
        ), 0) AS "EXTRAS_BUDGET",
        COALESCE(SUM(
          CASE WHEN b."BILLING_TYPE_ID" = 2 THEN COALESCE(tl."SP_TOT", 0)
               ELSE COALESCE(c."REVENUE_COMPLETION", 0) END
        ), 0) AS "REVENUE_COMPLETION_VALUE",
        COALESCE(SUM(
          CASE WHEN b."BILLING_TYPE_ID" = 2 THEN 0
               ELSE COALESCE(c."EXTRAS_COMPLETION", 0) END
        ), 0) AS "EXTRAS_COMPLETION_VALUE",
        CASE
          WHEN SUM(
            CASE WHEN b."BILLING_TYPE_ID" = 2
                 THEN COALESCE(tl."SP_TOT", 0)
                 ELSE COALESCE(b."REVENUE", 0) + COALESCE(b."EXTRAS", 0)
            END
          ) = 0 THEN NULL
          ELSE 100.0
             * SUM(
                 CASE WHEN b."BILLING_TYPE_ID" = 2 THEN COALESCE(tl."SP_TOT", 0)
                      ELSE COALESCE(c."REVENUE_COMPLETION", 0)
                 END
               + CASE WHEN b."BILLING_TYPE_ID" = 2 THEN 0
                      ELSE COALESCE(c."EXTRAS_COMPLETION", 0)
                 END
               )
             / SUM(
                 CASE WHEN b."BILLING_TYPE_ID" = 2
                      THEN COALESCE(tl."SP_TOT", 0)
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
        COALESCE(SUM(tl."SP_TOT"),        0) AS "SALES_TOTAL",
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
      FROM public."PARTIAL_PAYMENT" pp
      WHERE pp."TENANT_ID" = p_tenant_id
        AND pp."STATUS_ID" = 2
        AND (p_as_of     IS NULL OR pp."PARTIAL_PAYMENT_DATE" <= p_as_of::date)
        AND (p_date_from IS NULL OR pp."PARTIAL_PAYMENT_DATE" >= p_date_from)
        AND (p_date_to   IS NULL OR pp."PARTIAL_PAYMENT_DATE" <= p_date_to)
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
    proj."NAME_SHORT",
    proj."NAME_LONG",
    proj."PROJECT_STATUS_ID"::bigint,
    ps_lkp."NAME_SHORT"                                                 AS "PROJECT_STATUS_NAME_SHORT",
    proj."PROJECT_TYPE_ID"::bigint,
    pt."NAME_SHORT"                                                     AS "PROJECT_TYPE_NAME_SHORT",
    proj."PROJECT_MANAGER_ID"::bigint,
    ( e."SHORT_NAME" ||
      CASE WHEN e."FIRST_NAME" IS NOT NULL
           THEN ': ' || e."FIRST_NAME" || ' ' || COALESCE(e."LAST_NAME", '')
           ELSE '' END
    )                                                                   AS "PROJECT_MANAGER_DISPLAY",
    proj."ADDRESS_ID"::bigint,
    a."ADDRESS_NAME_1"                                                  AS "ADDRESS_NAME",
    proj."COMPANY_ID"::bigint,
    c."COMPANY_NAME_1"                                                  AS "COMPANY_NAME",
    proj."DEPARTMENT_ID"::bigint,
    d."NAME_SHORT"                                                      AS "DEPARTMENT_NAME",

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
  ORDER BY proj."NAME_SHORT"
$$;


--
-- Name: fn_project_report_header(bigint, bigint, timestamp with time zone, date, date); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_project_report_header(p_tenant_id bigint, p_project_id bigint, p_as_of timestamp with time zone DEFAULT NULL::timestamp with time zone, p_date_from date DEFAULT NULL::date, p_date_to date DEFAULT NULL::date) RETURNS TABLE("TENANT_ID" bigint, "PROJECT_ID" bigint, "NAME_SHORT" text, "NAME_LONG" text, "PROJECT_STATUS_NAME_SHORT" text, "PROJECT_MANAGER_DISPLAY" text, "COMPANY_NAME" text, "BUDGET_TOTAL_NET" numeric, "LEISTUNGSSTAND_PERCENT" numeric, "LEISTUNGSSTAND_VALUE" numeric, "HOURS_TOTAL" numeric, "COST_TOTAL" numeric, "EARNED_VALUE_NET" numeric, "COST_RATIO" numeric, "REMAINING_BUDGET_NET" numeric, "PARTIAL_PAYMENT_NET_TOTAL" numeric, "INVOICE_NET_TOTAL" numeric, "BILLED_NET_TOTAL" numeric, "OPEN_NET_TOTAL" numeric, "PAYED_NET_TOTAL" numeric, "SALES_TOTAL" numeric, "QTY_EXT_TOTAL" numeric)
    LANGUAGE sql STABLE
    AS $$
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
          AND  pp."created_at"  <= c.ts
        ORDER  BY pp."created_at" DESC, pp."ID" DESC
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
          AND  pp."created_at"        <= c.ts
        ORDER  BY pp."created_at" DESC, pp."ID" DESC
        LIMIT  1
      ) pp_compl ON true
      WHERE ls."BILLING_TYPE_ID" <> 2
    ),

    tec_leaf AS (
      SELECT
        t."STRUCTURE_ID",
        COALESCE(SUM(t."QUANTITY_INT"), 0) AS "HOURS_TOTAL",
        COALESCE(SUM(t."CP_TOT"),       0) AS "COST_TOTAL",
        COALESCE(SUM(t."SP_TOT"),       0) AS "SP_TOT",
        COALESCE(SUM(t."QUANTITY_EXT"), 0) AS "QTY_EXT_TOTAL"
      FROM public."TEC" t
      WHERE t."TENANT_ID"    = p_tenant_id
        AND t."STRUCTURE_ID" IN (SELECT "STRUCTURE_ID" FROM leaf_structs)
        AND (p_as_of     IS NULL OR t."DATE_VOUCHER" <= p_as_of::date)
        AND (p_date_from IS NULL OR t."DATE_VOUCHER" >= p_date_from)
        AND (p_date_to   IS NULL OR t."DATE_VOUCHER" <= p_date_to)
      GROUP BY t."STRUCTURE_ID"
    ),

    -- For BT2: Honorar = SP_TOT (not budgeted REVENUE), so budget denominator uses SP_TOT
    prog_agg AS (
      SELECT
        -- BT2: budget IS SP_TOT (hourly: what was billed = the honorar)
        COALESCE(SUM(
          CASE WHEN b."BILLING_TYPE_ID" = 2
               THEN COALESCE(tl."SP_TOT", 0)
               ELSE COALESCE(b."REVENUE", 0)
          END
        ), 0) AS "REVENUE_BUDGET",
        COALESCE(SUM(
          CASE WHEN b."BILLING_TYPE_ID" = 2 THEN 0
               ELSE COALESCE(b."EXTRAS", 0)
          END
        ), 0) AS "EXTRAS_BUDGET",
        -- earned value: BT2 = SP_TOT, BT1 = recorded completion
        COALESCE(SUM(
          CASE WHEN b."BILLING_TYPE_ID" = 2
               THEN COALESCE(tl."SP_TOT", 0)
               ELSE COALESCE(c."REVENUE_COMPLETION", 0)
          END
        ), 0) AS "REVENUE_COMPLETION_VALUE",
        COALESCE(SUM(
          CASE WHEN b."BILLING_TYPE_ID" = 2 THEN 0
               ELSE COALESCE(c."EXTRAS_COMPLETION", 0)
          END
        ), 0) AS "EXTRAS_COMPLETION_VALUE",
        -- LEISTUNGSSTAND_PERCENT: BT2 numerator = SP_TOT, denominator = SP_TOT → always 100%
        CASE
          WHEN SUM(
            CASE WHEN b."BILLING_TYPE_ID" = 2
                 THEN COALESCE(tl."SP_TOT", 0)
                 ELSE COALESCE(b."REVENUE", 0) + COALESCE(b."EXTRAS", 0)
            END
          ) = 0 THEN NULL
          ELSE 100.0
             * SUM(
                 CASE WHEN b."BILLING_TYPE_ID" = 2 THEN COALESCE(tl."SP_TOT", 0)
                      ELSE COALESCE(c."REVENUE_COMPLETION", 0)
                 END
               + CASE WHEN b."BILLING_TYPE_ID" = 2 THEN 0
                      ELSE COALESCE(c."EXTRAS_COMPLETION", 0)
                 END
               )
             / SUM(
                 CASE WHEN b."BILLING_TYPE_ID" = 2
                      THEN COALESCE(tl."SP_TOT", 0)
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
        COALESCE(SUM(tl."SP_TOT"),        0) AS "SALES_TOTAL",
        COALESCE(SUM(tl."QTY_EXT_TOTAL"), 0) AS "QTY_EXT_TOTAL"
      FROM tec_leaf tl
    ),

    pp_billed AS (
      SELECT COALESCE(SUM(pp."AMOUNT_NET" + COALESCE(pp."AMOUNT_EXTRAS_NET", 0)), 0) AS "PP_NET"
      FROM public."PARTIAL_PAYMENT" pp
      WHERE pp."TENANT_ID"  = p_tenant_id
        AND pp."PROJECT_ID" = p_project_id
        AND pp."STATUS_ID"  = 2
        AND (p_as_of     IS NULL OR pp."PARTIAL_PAYMENT_DATE" <= p_as_of::date)
        AND (p_date_from IS NULL OR pp."PARTIAL_PAYMENT_DATE" >= p_date_from)
        AND (p_date_to   IS NULL OR pp."PARTIAL_PAYMENT_DATE" <= p_date_to)
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
    proj."NAME_SHORT",
    proj."NAME_LONG",
    ps_lkp."NAME_SHORT"   AS "PROJECT_STATUS_NAME_SHORT",
    ( e."SHORT_NAME" ||
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
    ppb."PP_NET"                    AS "PARTIAL_PAYMENT_NET_TOTAL",
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
$$;


--
-- Name: fn_project_report_structure(bigint, bigint, timestamp with time zone, date, date); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_project_report_structure(p_tenant_id bigint, p_project_id bigint, p_as_of timestamp with time zone DEFAULT NULL::timestamp with time zone, p_date_from date DEFAULT NULL::date, p_date_to date DEFAULT NULL::date) RETURNS TABLE("TENANT_ID" bigint, "PROJECT_ID" bigint, "STRUCTURE_ID" bigint, "PARENT_STRUCTURE_ID" bigint, "NAME_SHORT" text, "NAME_LONG" text, "IS_LEAF" boolean, "HOURS_TOTAL" numeric, "COST_TOTAL" numeric, "EARNED_VALUE_NET" numeric, "HONORAR_NET" numeric, "REST_HONORAR" numeric, "LEISTUNGSSTAND_PERCENT" numeric, "KOSTENQUOTE" numeric)
    LANGUAGE sql STABLE
    AS $$
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
          AND  pp."created_at"  <= c.ts
        ORDER  BY pp."created_at" DESC, pp."ID" DESC
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
          AND  pp."created_at"         <= c.ts
        ORDER  BY pp."created_at" DESC, pp."ID" DESC
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
        COALESCE(SUM(t."CP_TOT"),       0) AS "COST_TOTAL",
        COALESCE(SUM(t."SP_TOT"),       0) AS "SP_TOT"
      FROM public."TEC" t
      JOIN public."PROJECT_STRUCTURE" ps
        ON  ps."TENANT_ID"  = t."TENANT_ID"
       AND  ps."ID"         = t."STRUCTURE_ID"
      WHERE t."TENANT_ID"   = p_tenant_id
        AND ps."PROJECT_ID" = p_project_id
        AND (p_as_of     IS NULL OR t."DATE_VOUCHER" <= p_as_of::date)
        AND (p_date_from IS NULL OR t."DATE_VOUCHER" >= p_date_from)
        AND (p_date_to   IS NULL OR t."DATE_VOUCHER" <= p_date_to)
      GROUP BY t."STRUCTURE_ID"
    )

  SELECT
    ps."TENANT_ID",
    ps."PROJECT_ID"::bigint,
    ps."ID"::bigint        AS "STRUCTURE_ID",
    ps."FATHER_ID"::bigint AS "PARENT_STRUCTURE_ID",
    ps."NAME_SHORT",
    ps."NAME_LONG",

    NOT EXISTS (
      SELECT 1 FROM public."PROJECT_STRUCTURE" child
      WHERE  child."TENANT_ID" = ps."TENANT_ID"
        AND  child."FATHER_ID" = ps."ID"
    ) AS "IS_LEAF",

    COALESCE(t."HOURS_TOTAL", 0) AS "HOURS_TOTAL",
    COALESCE(t."COST_TOTAL",  0) AS "COST_TOTAL",

    -- BT2: earned = SP_TOT; BT1: earned = recorded completion
    CASE WHEN b."BILLING_TYPE_ID" = 2
         THEN COALESCE(t."SP_TOT", 0)
         ELSE COALESCE(c."REVENUE_COMPLETION", 0) + COALESCE(c."EXTRAS_COMPLETION", 0)
    END AS "EARNED_VALUE_NET",

    -- BT2: Honorar = SP_TOT (hourly: billed amount IS the honorar, no fixed budget)
    CASE WHEN b."BILLING_TYPE_ID" = 2
         THEN COALESCE(t."SP_TOT", 0)
         ELSE COALESCE(b."REVENUE", 0) + COALESCE(b."EXTRAS", 0)
    END AS "HONORAR_NET",

    -- BT2: rest = 0 (honorar = earned); BT1: budget - recorded completion
    CASE WHEN b."BILLING_TYPE_ID" = 2
         THEN 0
         ELSE (COALESCE(b."REVENUE", 0) + COALESCE(b."EXTRAS", 0))
            - (COALESCE(c."REVENUE_COMPLETION", 0) + COALESCE(c."EXTRAS_COMPLETION", 0))
    END AS "REST_HONORAR",

    -- BT2: 100 % if any TEC billed, else 0 %; BT1: recorded percent
    CASE WHEN b."BILLING_TYPE_ID" = 2
         THEN CASE WHEN COALESCE(t."SP_TOT", 0) > 0 THEN 100.0 ELSE 0 END
         ELSE COALESCE(c."REVENUE_COMPLETION_PERCENT", 0)
    END AS "LEISTUNGSSTAND_PERCENT",

    CASE
      WHEN (CASE WHEN b."BILLING_TYPE_ID" = 2
                 THEN COALESCE(t."SP_TOT", 0)
                 ELSE COALESCE(c."REVENUE_COMPLETION", 0) + COALESCE(c."EXTRAS_COMPLETION", 0)
            END) = 0 THEN NULL
      ELSE COALESCE(t."COST_TOTAL", 0)
         / (CASE WHEN b."BILLING_TYPE_ID" = 2
                 THEN COALESCE(t."SP_TOT", 0)
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
$$;


--
-- Name: get_number_template(bigint, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_number_template(p_company_id bigint, p_doc_type text) RETURNS text
    LANGUAGE plpgsql STABLE
    AS $$
DECLARE
  v_template TEXT;
BEGIN
  SELECT "TEMPLATE"
    INTO v_template
    FROM public."NUMBER_RANGE_TEMPLATE"
   WHERE "COMPANY_ID" = p_company_id
     AND "DOC_TYPE"   = p_doc_type;
  RETURN v_template; -- NULL wenn nichts da
END;
$$;


--
-- Name: is_system_request(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.is_system_request() RETURNS boolean
    LANGUAGE sql STABLE
    AS $$
  SELECT coalesce(
           NULLIF(current_setting('request.jwt.claims', true), '')::json ->> 'sys',
           ''
         ) = 'true'
$$;


--
-- Name: FUNCTION is_system_request(); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.is_system_request() IS 'true, wenn das JWT den Claim sys=true traegt. Nur fuer Signup, Hintergrund-Checker und Owner-Konsole.';


--
-- Name: next_document_number(bigint, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.next_document_number(p_company_id bigint, p_doc_type text) RETURNS text
    LANGUAGE plpgsql
    AS $$
DECLARE
  yr           INT := EXTRACT(year FROM now())::INT;
  v_assigned   INT;
  v_seed_next  INT;
  v_next       INT;
  v_tmpl       TEXT;
BEGIN
  IF p_company_id IS NULL THEN
    RAISE EXCEPTION 'p_company_id is required';
  END IF;

  -- Wie bisher: GLOBAL-Counter, seed aus etwaigen legacy Eintraegen
  SELECT COALESCE(MAX("NEXT_COUNTER"), 1) INTO v_seed_next
    FROM public."DOCUMENT_NUMBER_RANGE"
   WHERE "COMPANY_ID" = p_company_id AND "YEAR" = yr;

  WITH up AS (
    INSERT INTO public."DOCUMENT_NUMBER_RANGE" ("COMPANY_ID","DOC_TYPE","YEAR","NEXT_COUNTER","UPDATED_AT")
    VALUES (p_company_id, 'GLOBAL', yr, v_seed_next + 1, now())
    ON CONFLICT ("COMPANY_ID","DOC_TYPE","YEAR") DO UPDATE
      SET "NEXT_COUNTER" = public."DOCUMENT_NUMBER_RANGE"."NEXT_COUNTER" + 1,
          "UPDATED_AT"   = now()
    RETURNING "NEXT_COUNTER"
  )
  SELECT "NEXT_COUNTER" INTO v_next FROM up;
  v_assigned := v_next - 1;

  v_tmpl := public.get_number_template(p_company_id, 'INVOICE');
  IF v_tmpl IS NOT NULL THEN
    RETURN public.render_number_template(v_tmpl, v_assigned, p_company_id);
  END IF;

  RETURN 'RE-' || yr::TEXT || '-' || LPAD(v_assigned::TEXT, 4, '0');
END;
$$;


--
-- Name: next_nachtrag_number(bigint); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.next_nachtrag_number(p_company_id bigint) RETURNS text
    LANGUAGE plpgsql
    AS $$
DECLARE
  yr  int  := EXTRACT(year FROM now())::int;
  yy  text := lpad((yr % 100)::text, 2, '0');
  cur int;
BEGIN
  IF p_company_id IS NULL THEN
    RAISE EXCEPTION 'p_company_id is required';
  END IF;

  SELECT "NEXT_COUNTER" INTO cur
  FROM public."DOCUMENT_NUMBER_RANGE"
  WHERE "COMPANY_ID" = p_company_id
    AND "DOC_TYPE"   = 'NACHTRAG'
    AND "YEAR"       = yr
  FOR UPDATE;

  IF NOT FOUND THEN
    cur := 1;
    INSERT INTO public."DOCUMENT_NUMBER_RANGE"
      ("COMPANY_ID", "DOC_TYPE", "YEAR", "NEXT_COUNTER", "UPDATED_AT")
    VALUES (p_company_id, 'NACHTRAG', yr, cur + 1, now());
  ELSE
    UPDATE public."DOCUMENT_NUMBER_RANGE"
    SET "NEXT_COUNTER" = cur + 1,
        "UPDATED_AT"   = now()
    WHERE "COMPANY_ID" = p_company_id
      AND "DOC_TYPE"   = 'NACHTRAG'
      AND "YEAR"       = yr;
  END IF;

  RETURN 'NT-' || yy || '-' || lpad(cur::text, 3, '0');
END;
$$;


--
-- Name: next_offer_number(bigint); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.next_offer_number(p_company_id bigint) RETURNS text
    LANGUAGE plpgsql
    AS $$
DECLARE
  yr     INT := EXTRACT(year FROM now())::INT;
  yy     TEXT := LPAD((yr % 100)::TEXT, 2, '0');
  cur    INT;
  v_tmpl TEXT;
BEGIN
  IF p_company_id IS NULL THEN
    RAISE EXCEPTION 'p_company_id is required';
  END IF;

  WITH up AS (
    INSERT INTO public."DOCUMENT_NUMBER_RANGE" ("COMPANY_ID", "DOC_TYPE", "YEAR", "NEXT_COUNTER", "UPDATED_AT")
    VALUES (p_company_id, 'OFFER', yr, 2, now())
    ON CONFLICT ("COMPANY_ID","DOC_TYPE","YEAR") DO UPDATE
      SET "NEXT_COUNTER" = public."DOCUMENT_NUMBER_RANGE"."NEXT_COUNTER" + 1,
          "UPDATED_AT"   = now()
    RETURNING "NEXT_COUNTER"
  )
  SELECT "NEXT_COUNTER" INTO cur FROM up;
  cur := cur - 1;

  v_tmpl := public.get_number_template(p_company_id, 'OFFER');
  IF v_tmpl IS NOT NULL THEN
    RETURN public.render_number_template(v_tmpl, cur, p_company_id);
  END IF;

  RETURN 'A-' || yy || '-' || LPAD(cur::TEXT, 3, '0');
END;
$$;


--
-- Name: next_project_number(bigint); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.next_project_number(p_company_id bigint) RETURNS text
    LANGUAGE plpgsql
    AS $$
DECLARE
  yr        INT := EXTRACT(year FROM now())::INT;
  yy        TEXT := LPAD((yr % 100)::TEXT, 2, '0');
  cur       INT;
  v_tmpl    TEXT;
BEGIN
  IF p_company_id IS NULL THEN
    RAISE EXCEPTION 'p_company_id is required';
  END IF;

  -- Counter atomar inkrementieren (wie bisher)
  WITH up AS (
    INSERT INTO public."DOCUMENT_NUMBER_RANGE" ("COMPANY_ID", "DOC_TYPE", "YEAR", "NEXT_COUNTER", "UPDATED_AT")
    VALUES (p_company_id, 'PROJECT', yr, 2, now())
    ON CONFLICT ("COMPANY_ID","DOC_TYPE","YEAR") DO UPDATE
      SET "NEXT_COUNTER" = public."DOCUMENT_NUMBER_RANGE"."NEXT_COUNTER" + 1,
          "UPDATED_AT"   = now()
    RETURNING "NEXT_COUNTER"
  )
  SELECT "NEXT_COUNTER" INTO cur FROM up;
  cur := cur - 1; -- "NEXT_COUNTER" zeigt aufs naechste, wir wollen das aktuelle

  v_tmpl := public.get_number_template(p_company_id, 'PROJECT');
  IF v_tmpl IS NOT NULL THEN
    RETURN public.render_number_template(v_tmpl, cur, p_company_id);
  END IF;

  -- Fallback: hartkodierter alter Standard
  RETURN 'P-' || yy || '-' || LPAD(cur::TEXT, 3, '0');
END;
$$;


--
-- Name: protect_arbzg_audit_immutability(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.protect_arbzg_audit_immutability() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF NEW."TENANT_ID"    <> OLD."TENANT_ID"
  OR NEW."EMPLOYEE_ID"  <> OLD."EMPLOYEE_ID"
  OR NEW."DATE_VOUCHER" <> OLD."DATE_VOUCHER"
  OR NEW."EVENT_TYPE"   <> OLD."EVENT_TYPE"
  OR NEW."SEVERITY"     <> OLD."SEVERITY"
  OR NEW."CREATED_AT"   <> OLD."CREATED_AT"
  OR COALESCE(NEW."TEC_ID", -1) <> COALESCE(OLD."TEC_ID", -1) THEN
    RAISE EXCEPTION
      'ArbZG-Audit: Schlüsselfelder eines Eintrags dürfen nicht geändert werden';
  END IF;
  RETURN NEW;
END;
$$;


--
-- Name: protect_arbzg_audit_retention(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.protect_arbzg_audit_retention() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF OLD."CREATED_AT" > NOW() - INTERVAL '2 years' THEN
    RAISE EXCEPTION
      'ArbZG § 16 Abs. 2: Audit-Einträge dürfen vor Ablauf von 2 Jahren nicht gelöscht werden (Eintrag vom %)',
      OLD."CREATED_AT";
  END IF;
  RETURN OLD;
END;
$$;


--
-- Name: render_number_template(text, integer, bigint); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.render_number_template(p_template text, p_counter integer, p_company_id bigint) RETURNS text
    LANGUAGE plpgsql
    AS $$
DECLARE
  v_result  TEXT := p_template;
  v_now     TIMESTAMPTZ := now();
  v_year4   TEXT := EXTRACT(YEAR FROM v_now)::TEXT;
  v_year2   TEXT := LPAD((EXTRACT(YEAR  FROM v_now)::INT % 100)::TEXT, 2, '0');
  v_month   TEXT := LPAD(EXTRACT(MONTH FROM v_now)::TEXT, 2, '0');
  v_day     TEXT := LPAD(EXTRACT(DAY   FROM v_now)::TEXT, 2, '0');
  v_match   RECORD;
  v_pad     INT;
BEGIN
  -- Datum-Tokens
  v_result := REPLACE(v_result, '{YEAR4}',    v_year4);
  v_result := REPLACE(v_result, '{YEAR2}',    v_year2);
  v_result := REPLACE(v_result, '{MONTH:00}', v_month);
  v_result := REPLACE(v_result, '{DAY:00}',   v_day);

  -- COUNTER mit optionalem Pad-Format: {COUNTER:0000}
  FOR v_match IN
    SELECT (regexp_matches(v_result, '\{COUNTER:(0+)\}', 'g'))[1] AS pad
  LOOP
    v_pad := LENGTH(v_match.pad);
    v_result := REGEXP_REPLACE(
      v_result,
      '\{COUNTER:' || v_match.pad || '\}',
      LPAD(p_counter::TEXT, v_pad, '0'),
      'g'
    );
  END LOOP;
  v_result := REPLACE(v_result, '{COUNTER}', p_counter::TEXT);

  -- p_company_id bleibt im Signatur-Set fuer kuenftige Tokens (z.B. {DEPT:CODE})
  -- aber wird in dieser Version nicht genutzt.

  RETURN v_result;
END;
$$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: INVOICE; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."INVOICE" (
    "ID" bigint NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    "INVOICE_NUMBER" character varying,
    "INVOICE_DATE" date,
    "CURRENCY_ID" bigint,
    "DUE_DATE" date,
    "STATUS_ID" bigint,
    "BUYER_REFERENCE" character varying,
    "CONTRACT_ID" bigint,
    "PROJECT_ID" bigint,
    "COMMENT" character varying,
    "BILLING_PERIOD_START" date,
    "BILLING_PERIOD_FINISH" date,
    "COMPANY_ID" bigint,
    "EMPLOYEE_ID" bigint,
    "INVOICE_ADDRESS_ID" bigint,
    "INVOICE_CONTACT_ID" bigint,
    "AMOUNT_NET" numeric,
    "TOTAL_AMOUNT_NET" numeric,
    "TAX_AMOUNT_NET" numeric,
    "TOTAL_AMOUNT_GROSS" numeric,
    "COMPANY_IBAN" character varying,
    "PAYMENT_MEANS_ID" bigint,
    "CASH_DISCOUNT_PERCENT" numeric,
    "TOTAL_DISCOUNTS" numeric,
    "PAYED_AMOUNT_NET" numeric,
    "PURPOSE_OF_PAYMENT" numeric,
    "DISCOUNT_1_REASON" character varying,
    "DISCOUNT_1_PERCENT" numeric,
    "DISCOUNT_1" numeric,
    "DISCOUNT_2_REASON" character varying,
    "DISCOUNT_2_PERCENT" numeric,
    "DISCOUNT_2" numeric,
    "COMPANY_NAME_1" character varying,
    "COMPANY_NAME_2" character varying,
    "COMPANY_STREET" character varying,
    "COMPANY_POST_CODE" character varying,
    "COMPANY_CITY" character varying,
    "COMPANY_COUNTRY" character varying,
    "COMPANY_POST_OFFICE_BOX" character varying,
    "COMPANY_BIC" character varying,
    "COMPANY_TAX-ID" character varying,
    "COMPANY_TAX_NUMBER" character varying,
    "EMPLOYEE" character varying,
    "EMPLOYEE_SALUTATION" character varying,
    "EMPLOYEE_MAIL" character varying,
    "EMPLOYEE_PHONE" character varying,
    "ADDRESS_NAME_1" character varying,
    "ADDRESS_NAME_2" character varying,
    "ADDRESS_STREET" character varying,
    "ADDRESS_CITY" character varying,
    "ADDRESS_COUNTRY" character varying,
    "ADDRESS_POST_OFFICE_BOX" character varying,
    "ADDRESS_DEBITOR_NUMBER" character varying,
    "CONTACT" character varying,
    "CONTACT_SALUTATION" character varying,
    "CONTACT_MAIL" character varying,
    "CONTACT_PHONE" character varying,
    "ADDRESS_REFERENCE_NUMBER" character varying,
    "ADDRESS_CREDITOR-ID" character varying,
    "ADDRESS_IBAN" character varying,
    "VAT_ID" bigint,
    "VAT_PERCENT" numeric,
    "AMOUNT_EXTRAS_NET" numeric,
    "ADDRESS_POST_CODE" character varying,
    "COMPANY_CREDITOR-ID" character varying,
    document_template_id bigint,
    document_layout_key_snapshot text,
    document_theme_snapshot_json jsonb,
    document_logo_asset_id_snapshot bigint,
    document_pdf_asset_id bigint,
    document_rendered_at timestamp with time zone,
    "DOCUMENT_TEMPLATE_ID" bigint,
    "DOCUMENT_LAYOUT_KEY_SNAPSHOT" text,
    "DOCUMENT_THEME_SNAPSHOT_JSON" jsonb,
    "DOCUMENT_LOGO_ASSET_ID_SNAPSHOT" bigint,
    "DOCUMENT_PDF_ASSET_ID" bigint,
    "DOCUMENT_RENDERED_AT" timestamp with time zone,
    "DOCUMENT_XML_ASSET_ID" integer,
    "DOCUMENT_XML_PROFILE" text,
    "DOCUMENT_XML_RENDERED_AT" timestamp with time zone,
    "TEXT_1" text,
    "TEXT_2" text,
    "TENANT_ID" bigint DEFAULT public.current_tenant_id(),
    "INVOICE_TYPE" character varying,
    "CANCELS_INVOICE_ID" integer,
    "CANCELLATION_DATE" date,
    "CASH_DISCOUNT_DAYS" numeric,
    "CASH_DISCOUNT" numeric,
    "SE_PERCENT" numeric(5,2),
    "SE_BASIS" text,
    "SE_BASIS_AMT" numeric(14,2),
    "SE_AMOUNT" numeric(14,2),
    "SE_RELEASE_TOTAL" numeric(14,2),
    "BUYER_ORDER_REFERENCE" text,
    "BUYER_ACCOUNTING_REFERENCE" text,
    "REMITTANCE_INFORMATION" text,
    "VAT_CATEGORY" character varying(3) DEFAULT 'S'::character varying,
    "VAT_EXEMPTION_REASON_CODE" text,
    "VAT_EXEMPTION_REASON_TEXT" text,
    "IMPORT_BATCH_ID" integer
);

ALTER TABLE ONLY public."INVOICE" FORCE ROW LEVEL SECURITY;


--
-- Name: PARTIAL_PAYMENT; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."PARTIAL_PAYMENT" (
    "ID" bigint NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    "PARTIAL_PAYMENT_NUMBER" character varying,
    "PARTIAL_PAYMENT_DATE" date,
    "CURRENCY_ID" bigint,
    "DUE_DATE" date,
    "STATUS_ID" bigint,
    "BUYER_REFERENCE" character varying,
    "CONTRACT_ID" bigint,
    "PROJECT_ID" bigint,
    "COMMENT" character varying,
    "BILLING_PERIOD_START" date,
    "BILLING_PERIOD_FINISH" date,
    "COMPANY_ID" bigint,
    "EMPLOYEE_ID" bigint,
    "PARTIAL_PAYMENT_ADDRESS_ID" bigint,
    "PARTIAL_PAYMENT_CONTACT_ID" bigint,
    "AMOUNT_NET" numeric,
    "TOTAL_AMOUNT_NET" numeric,
    "TAX_AMOUNT_NET" numeric,
    "TOTAL_AMOUNT_GROSS" numeric,
    "PAYMENT_MEANS_ID" bigint,
    "CASH_DISCOUNT_PERCENT" numeric,
    "TOTAL_DISCOUNTS" numeric,
    "PAYED_AMOUNT_NET" numeric,
    "PURPOSE_OF_PAYMENT" numeric,
    "DISCOUNT_1_REASON" character varying,
    "DISCOUNT_1_PERCENT" numeric,
    "DISCOUNT_1" numeric,
    "DISCOUNT_2_REASON" character varying,
    "DISCOUNT_2_PERCENT" numeric,
    "DISCOUNT_2" numeric,
    "COMPANY_NAME_1" character varying,
    "COMPANY_NAME_2" character varying,
    "COMPANY_STREET" character varying,
    "COMPANY_POST_CODE" character varying,
    "COMPANY_CITY" character varying,
    "COMPANY_COUNTRY" character varying,
    "COMPANY_POST_OFFICE_BOX" character varying,
    "COMPANY_BIC" character varying,
    "COMPANY_TAX-ID" character varying,
    "COMPANY_TAX_NUMBER" character varying,
    "EMPLOYEE" character varying,
    "EMPLOYEE_SALUTATION" character varying,
    "EMPLOYEE_MAIL" character varying,
    "EMPLOYEE_PHONE" character varying,
    "ADDRESS_NAME_1" character varying,
    "ADDRESS_NAME_2" character varying,
    "ADDRESS_STREET" character varying,
    "ADDRESS_CITY" character varying,
    "ADDRESS_COUNTRY" character varying,
    "ADDRESS_POST_OFFICE_BOX" character varying,
    "ADDRESS_DEBITOR_NUMBER" character varying,
    "CONTACT" character varying,
    "CONTACT_SALUTATION" character varying,
    "CONTACT_MAIL" character varying,
    "CONTACT_PHONE" character varying,
    "ADDRESS_REFERENCE_NUMBER" character varying,
    "ADDRESS_CREDITOR-ID" character varying,
    "COMPANY_IBAN" character varying,
    "AMOUNT_EXTRAS_NET" numeric,
    "ADDRESS_POST_CODE" character varying,
    "COMPANY_CREDITOR-ID" character varying,
    "VAT_PERCENT" numeric,
    "VAT_ID" bigint,
    document_template_id bigint,
    document_layout_key_snapshot text,
    document_theme_snapshot_json jsonb,
    document_logo_asset_id_snapshot bigint,
    document_pdf_asset_id bigint,
    document_rendered_at timestamp with time zone,
    "DOCUMENT_TEMPLATE_ID" bigint,
    "DOCUMENT_LAYOUT_KEY_SNAPSHOT" text,
    "DOCUMENT_THEME_SNAPSHOT_JSON" jsonb,
    "DOCUMENT_LOGO_ASSET_ID_SNAPSHOT" bigint,
    "DOCUMENT_PDF_ASSET_ID" bigint,
    "DOCUMENT_RENDERED_AT" timestamp with time zone,
    "DOCUMENT_XML_ASSET_ID" bigint,
    "DOCUMENT_XML_PROFILE" text,
    "DOCUMENT_XML_RENDERED_AT" timestamp with time zone,
    "TEXT_1" text,
    "TEXT_2" text,
    "TENANT_ID" bigint DEFAULT public.current_tenant_id(),
    "INVOICE_ID" bigint,
    "CANCELS_PARTIAL_PAYMENT_ID" integer,
    "CANCELLATION_DATE" date,
    "CASH_DISCOUNT_DAYS" numeric,
    "CASH_DISCOUNT" numeric,
    "SE_PERCENT" numeric(5,2),
    "SE_BASIS" text,
    "SE_BASIS_AMT" numeric(14,2),
    "SE_AMOUNT" numeric(14,2),
    "SE_RELEASED_BY_INVOICE_ID" integer,
    "BUYER_ORDER_REFERENCE" text,
    "BUYER_ACCOUNTING_REFERENCE" text,
    "REMITTANCE_INFORMATION" text,
    "VAT_CATEGORY" character varying(3) DEFAULT 'S'::character varying,
    "VAT_EXEMPTION_REASON_CODE" text,
    "VAT_EXEMPTION_REASON_TEXT" text,
    "IMPORT_BATCH_ID" integer
);

ALTER TABLE ONLY public."PARTIAL_PAYMENT" FORCE ROW LEVEL SECURITY;


--
-- Name: PAYMENT; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."PAYMENT" (
    "ID" bigint NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    "PARTIAL_PAYMENT_ID" bigint,
    "INVOICE_ID" bigint,
    "AMOUNT_PAYED_NET" numeric,
    "AMOUNT_PAYED_EXTRAS_NET" numeric,
    "AMOUNT_PAYED_GROSS" numeric,
    "PAYMENT_DATE" date,
    "PROJECT_ID" bigint,
    "CONTRACT_ID" bigint,
    "COMMENT" character varying,
    "PURPOSE_OF_PAYMENT" character varying,
    "AMOUNT_PAYED_VAT" numeric,
    "TENANT_ID" bigint DEFAULT public.current_tenant_id(),
    "IMPORT_BATCH_ID" integer
);

ALTER TABLE ONLY public."PAYMENT" FORCE ROW LEVEL SECURITY;


--
-- Name: PROJECT; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."PROJECT" (
    "ID" bigint NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    "NAME_SHORT" character varying,
    "NAME_LONG" character varying,
    created_by uuid DEFAULT gen_random_uuid(),
    "PROJECT_MANAGER_ID" bigint,
    "PROJECT_STATUS_ID" bigint,
    "PROJECT_TYPE_ID" bigint,
    "PARTIAL_PAYMENTS" numeric,
    "INVOICED" numeric,
    "PAYED" numeric,
    "ADDRESS_ID" bigint,
    "COMPANY_ID" bigint,
    "DEPARTMENT_ID" bigint,
    "CONTACT_ID" bigint,
    "TENANT_ID" bigint DEFAULT public.current_tenant_id(),
    "OFFER_ID" bigint,
    "IS_INTERNAL" boolean DEFAULT false NOT NULL,
    "SURCHARGE_1_LABEL" text,
    "SURCHARGE_1_PCT" numeric(9,4),
    "SURCHARGE_1_EUR" numeric(14,4),
    "SURCHARGE_1_CUMUL" boolean DEFAULT true NOT NULL,
    "SURCHARGE_2_LABEL" text,
    "SURCHARGE_2_PCT" numeric(9,4),
    "SURCHARGE_2_EUR" numeric(14,4),
    "SURCHARGE_2_CUMUL" boolean DEFAULT true NOT NULL,
    "SURCHARGE_3_LABEL" text,
    "SURCHARGE_3_PCT" numeric(9,4),
    "SURCHARGE_3_EUR" numeric(14,4),
    "SURCHARGE_3_CUMUL" boolean DEFAULT true NOT NULL,
    "SURCHARGES_TOTAL" numeric(14,4) DEFAULT 0 NOT NULL,
    "BUDGET_WARNINGS_MUTED" boolean DEFAULT false NOT NULL,
    "IMPORT_BATCH_ID" integer
);

ALTER TABLE ONLY public."PROJECT" FORCE ROW LEVEL SECURITY;


--
-- Name: PROJECT_STRUCTURE; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."PROJECT_STRUCTURE" (
    "ID" bigint NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    "NAME_SHORT" character varying,
    "NAME_LONG" character varying,
    "REVENUE" numeric,
    "EXTRAS" numeric,
    "REVENUE_COMPLETION_PERCENT" numeric,
    "EXTRAS_COMPLETION_PERCENT" numeric,
    "REVENUE_COMPLETION" numeric,
    "EXTRAS_COMPLETION" numeric,
    "COSTS" numeric,
    "PROJECT_ID" bigint,
    "FATHER_ID" bigint,
    "PARTIAL_PAYMENTS" numeric,
    "INVOICED" numeric,
    "PAYED" numeric,
    "EXTRAS_PERCENT" numeric,
    "BILLING_TYPE_ID" bigint,
    "TENANT_ID" bigint DEFAULT public.current_tenant_id(),
    "CLOSED_BY_INVOICE_ID" bigint,
    "SORT_ORDER" integer DEFAULT 0,
    "CONTRACT_ID" bigint,
    "FEE_CALC_MASTER_ID" integer,
    "FEE_CALC_PHASE_ID" integer,
    "FEE_CALC_BL_ID" integer,
    "IS_INTERNAL" boolean DEFAULT false NOT NULL,
    "SURCHARGE_1_LABEL" text,
    "SURCHARGE_1_PCT" numeric(9,4),
    "SURCHARGE_1_EUR" numeric(14,4),
    "SURCHARGE_1_CUMUL" boolean DEFAULT true NOT NULL,
    "SURCHARGE_2_LABEL" text,
    "SURCHARGE_2_PCT" numeric(9,4),
    "SURCHARGE_2_EUR" numeric(14,4),
    "SURCHARGE_2_CUMUL" boolean DEFAULT true NOT NULL,
    "SURCHARGE_3_LABEL" text,
    "SURCHARGE_3_PCT" numeric(9,4),
    "SURCHARGE_3_EUR" numeric(14,4),
    "SURCHARGE_3_CUMUL" boolean DEFAULT true NOT NULL,
    "SURCHARGES_TOTAL" numeric(14,4) DEFAULT 0 NOT NULL,
    "REVENUE_BASIS" numeric(14,4),
    "IMPORT_BATCH_ID" integer,
    "NACHTRAG_ID" bigint
);

ALTER TABLE ONLY public."PROJECT_STRUCTURE" FORCE ROW LEVEL SECURITY;


--
-- Name: PROJECT_PROGRESS; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."PROJECT_PROGRESS" (
    "ID" bigint NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    "REVENUE" numeric,
    "EXTRAS" numeric,
    "REVENUE_COMPLETION_PERCENT" numeric,
    "EXTRAS_COMPLETION_PERCENT" numeric,
    "REVENUE_COMPLETION" numeric,
    "EXTRAS_COMPLETION" numeric,
    "STRUCTURE_ID" bigint,
    "EXTRAS_PERCENT" numeric,
    "TENANT_ID" bigint DEFAULT public.current_tenant_id(),
    "PARTIAL_PAYMENTS" numeric,
    "INVOICED" numeric,
    "PAYED" numeric,
    "IMPORT_BATCH_ID" integer
);

ALTER TABLE ONLY public."PROJECT_PROGRESS" FORCE ROW LEVEL SECURITY;


--
-- Name: TEC; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."TEC" (
    "ID" bigint NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    "EMPLOYEE_ID" bigint,
    "DATE_VOUCHER" date,
    "TIME_START" time without time zone,
    "TIME_FINISH" time without time zone,
    "QUANTITY_INT" numeric,
    "CP_RATE" numeric,
    "CP_TOT" numeric,
    "QUANTITY_EXT" numeric,
    "SP_RATE" numeric,
    "SP_TOT" numeric,
    "POSTING_DESCRIPTION" character varying,
    "PROJECT_ID" bigint,
    "STRUCTURE_ID" bigint,
    "PARTIAL_PAYMENT_ID" bigint,
    "INVOICE_ID" bigint,
    "ROLE_ID" bigint,
    "ROLE_NAME_SHORT" character varying,
    "ROLE_NAME_LONG" character varying,
    "TENANT_ID" bigint DEFAULT public.current_tenant_id(),
    "STATUS" text DEFAULT 'CONFIRMED'::text NOT NULL,
    "ENTRY_KIND" text DEFAULT 'WORK'::text NOT NULL,
    "IS_SUNDAY" boolean DEFAULT false NOT NULL,
    "IS_HOLIDAY" boolean DEFAULT false NOT NULL,
    "EXCEEDS_8H" boolean DEFAULT false NOT NULL,
    "PAUSE_AUTO_DEDUCTED_MIN" integer DEFAULT 0 NOT NULL,
    "CONFIRMED_BY_EMPLOYEE_AT" timestamp with time zone,
    "BOOKING_KIND" text DEFAULT 'WORK'::text,
    "UNIT_LABEL" text,
    "BOOKING_TYPE_ID" integer,
    CONSTRAINT chk_tec_entry_kind CHECK (("ENTRY_KIND" = ANY (ARRAY['WORK'::text, 'BREAK'::text])))
);

ALTER TABLE ONLY public."TEC" FORCE ROW LEVEL SECURITY;


--
-- Name: ABSENCE; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."ABSENCE" (
    "ID" integer NOT NULL,
    "TENANT_ID" integer DEFAULT public.current_tenant_id() NOT NULL,
    "EMPLOYEE_ID" integer NOT NULL,
    "ABSENCE_TYPE_ID" integer NOT NULL,
    "DATE_FROM" date NOT NULL,
    "DATE_TO" date NOT NULL,
    "HALF_DAY" boolean DEFAULT false NOT NULL,
    "STATUS" text DEFAULT 'REQUESTED'::text NOT NULL,
    "NOTE" text,
    "REQUESTED_BY" integer,
    "REQUESTED_AT" timestamp with time zone DEFAULT now(),
    "DECIDED_BY" integer,
    "DECIDED_AT" timestamp with time zone,
    "DECISION_NOTE" text,
    "CLARIFICATION_LOG" jsonb
);

ALTER TABLE ONLY public."ABSENCE" FORCE ROW LEVEL SECURITY;


--
-- Name: ABSENCE_ID_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public."ABSENCE_ID_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: ABSENCE_ID_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public."ABSENCE_ID_seq" OWNED BY public."ABSENCE"."ID";


--
-- Name: ABSENCE_TYPE; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."ABSENCE_TYPE" (
    "ID" integer NOT NULL,
    "TENANT_ID" integer DEFAULT public.current_tenant_id() NOT NULL,
    "NAME" text NOT NULL,
    "COLOR" text,
    "COUNTS_AS_WORKED" boolean DEFAULT true NOT NULL,
    "REDUCES_VACATION" boolean DEFAULT false NOT NULL,
    "REQUIRES_APPROVAL" boolean DEFAULT true NOT NULL,
    "IS_PAID" boolean DEFAULT true NOT NULL,
    "ACTIVE" integer DEFAULT 1 NOT NULL,
    "SORT_ORDER" integer DEFAULT 0
);

ALTER TABLE ONLY public."ABSENCE_TYPE" FORCE ROW LEVEL SECURITY;


--
-- Name: ABSENCE_TYPE_ID_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public."ABSENCE_TYPE_ID_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: ABSENCE_TYPE_ID_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public."ABSENCE_TYPE_ID_seq" OWNED BY public."ABSENCE_TYPE"."ID";


--
-- Name: ACHIEVEMENT; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."ACHIEVEMENT" (
    "ID" integer NOT NULL,
    "KEY" character varying(60) NOT NULL,
    "TITLE" character varying(120) NOT NULL,
    "DESCRIPTION" text,
    "CATEGORY" character varying(40),
    "POSITION" integer DEFAULT 0 NOT NULL,
    "ACTIVE" boolean DEFAULT true NOT NULL
);


--
-- Name: ACHIEVEMENT_ID_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public."ACHIEVEMENT_ID_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: ACHIEVEMENT_ID_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public."ACHIEVEMENT_ID_seq" OWNED BY public."ACHIEVEMENT"."ID";


--
-- Name: ADDRESS; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."ADDRESS" (
    "ID" bigint NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    "ADDRESS_NAME_1" character varying,
    "ADDRESS_NAME_2" character varying,
    "STREET" character varying,
    "POST_CODE" character varying,
    "CITY" character varying,
    "POST_OFFICE_BOX" character varying,
    "COUNTRY_ID" bigint,
    "CUSTOMER_NUMBER" character varying,
    "TAX-ID" character varying,
    "BUYER_REFERENCE" character varying,
    "DEBITOR_NUMBER" character varying,
    "TENANT_ID" bigint DEFAULT public.current_tenant_id(),
    "PEPPOL_ENDPOINT_ID" text,
    "PEPPOL_SCHEME_ID" character varying(10),
    "IMPORT_BATCH_ID" integer,
    "ADDRESS_TYPE" smallint,
    "TAX_NUMBER" text,
    "PHONE" text,
    "EMAIL" text,
    "WEBSITE" text,
    "NOTES" text
);

ALTER TABLE ONLY public."ADDRESS" FORCE ROW LEVEL SECURITY;


--
-- Name: ADDRESS_ID_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public."ADDRESS" ALTER COLUMN "ID" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME public."ADDRESS_ID_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: ARBZG_AUDIT; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."ARBZG_AUDIT" (
    "ID" integer NOT NULL,
    "TENANT_ID" integer DEFAULT public.current_tenant_id() NOT NULL,
    "EMPLOYEE_ID" integer NOT NULL,
    "DATE_VOUCHER" date NOT NULL,
    "EVENT_TYPE" text NOT NULL,
    "SEVERITY" text DEFAULT 'INFO'::text NOT NULL,
    "DETAILS" jsonb DEFAULT '{}'::jsonb NOT NULL,
    "TEC_ID" integer,
    "CREATED_AT" timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT chk_arbzg_audit_severity CHECK (("SEVERITY" = ANY (ARRAY['INFO'::text, 'WARN'::text, 'BLOCK'::text])))
);

ALTER TABLE ONLY public."ARBZG_AUDIT" FORCE ROW LEVEL SECURITY;


--
-- Name: ARBZG_AUDIT_ID_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public."ARBZG_AUDIT_ID_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: ARBZG_AUDIT_ID_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public."ARBZG_AUDIT_ID_seq" OWNED BY public."ARBZG_AUDIT"."ID";


--
-- Name: ASSET; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."ASSET" (
    "ID" bigint NOT NULL,
    "COMPANY_ID" bigint NOT NULL,
    "ASSET_TYPE" text NOT NULL,
    "FILE_NAME" text NOT NULL,
    "MIME_TYPE" text NOT NULL,
    "FILE_SIZE" bigint NOT NULL,
    "STORAGE_KEY" text NOT NULL,
    "SHA256" text,
    "CREATED_AT" timestamp with time zone DEFAULT now() NOT NULL,
    "TENANT_ID" bigint DEFAULT public.current_tenant_id()
);

ALTER TABLE ONLY public."ASSET" FORCE ROW LEVEL SECURITY;


--
-- Name: ASSET_ID_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public."ASSET_ID_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: ASSET_ID_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public."ASSET_ID_seq" OWNED BY public."ASSET"."ID";


--
-- Name: BILLING_TYPE; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."BILLING_TYPE" (
    "ID" bigint NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    "BILLING_TYPE" character varying
);


--
-- Name: BILLING_TYPE_ID_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public."BILLING_TYPE" ALTER COLUMN "ID" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME public."BILLING_TYPE_ID_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: BOOKING_TEXT_SNIPPET; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."BOOKING_TEXT_SNIPPET" (
    "ID" integer NOT NULL,
    "TENANT_ID" integer DEFAULT public.current_tenant_id() NOT NULL,
    "EMPLOYEE_ID" integer,
    "LABEL" text,
    "TEXT" text NOT NULL,
    "SORT_ORDER" integer DEFAULT 0,
    "SCOPE" text DEFAULT 'employee'::text NOT NULL,
    "KIND" text,
    "BOOKING_TYPE_ID" integer
);

ALTER TABLE ONLY public."BOOKING_TEXT_SNIPPET" FORCE ROW LEVEL SECURITY;


--
-- Name: BOOKING_TEXT_SNIPPET_ID_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public."BOOKING_TEXT_SNIPPET_ID_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: BOOKING_TEXT_SNIPPET_ID_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public."BOOKING_TEXT_SNIPPET_ID_seq" OWNED BY public."BOOKING_TEXT_SNIPPET"."ID";


--
-- Name: BOOKING_TYPE; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."BOOKING_TYPE" (
    "ID" integer NOT NULL,
    "TENANT_ID" integer DEFAULT public.current_tenant_id() NOT NULL,
    "KIND" text NOT NULL,
    "NAME_SHORT" text NOT NULL,
    "NAME_LONG" text,
    "UNIT_LABEL" text,
    "UNIT_CODE" text,
    "DEFAULT_SP_RATE" numeric,
    "DEFAULT_CP_RATE" numeric,
    "SCOPE" text DEFAULT 'global'::text NOT NULL,
    "PROJECT_ID" integer,
    "ACTIVE" integer DEFAULT 1 NOT NULL,
    "SORT_ORDER" integer DEFAULT 0
);

ALTER TABLE ONLY public."BOOKING_TYPE" FORCE ROW LEVEL SECURITY;


--
-- Name: BOOKING_TYPE_ID_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public."BOOKING_TYPE_ID_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: BOOKING_TYPE_ID_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public."BOOKING_TYPE_ID_seq" OWNED BY public."BOOKING_TYPE"."ID";


--
-- Name: BREAK_RULE; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."BREAK_RULE" (
    "ID" integer NOT NULL,
    "TENANT_ID" integer DEFAULT public.current_tenant_id() NOT NULL,
    "NAME" text NOT NULL,
    "T1_HOURS" numeric(4,2) DEFAULT 6 NOT NULL,
    "T1_BREAK_MIN" integer DEFAULT 30 NOT NULL,
    "T2_HOURS" numeric(4,2) DEFAULT 9 NOT NULL,
    "T2_BREAK_MIN" integer DEFAULT 45 NOT NULL,
    "MIN_BLOCK_MIN" integer DEFAULT 15 NOT NULL,
    "CREATED_AT" timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public."BREAK_RULE" FORCE ROW LEVEL SECURITY;


--
-- Name: BREAK_RULE_ID_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public."BREAK_RULE_ID_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: BREAK_RULE_ID_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public."BREAK_RULE_ID_seq" OWNED BY public."BREAK_RULE"."ID";


--
-- Name: BUDGET_WARNING_FIRED; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."BUDGET_WARNING_FIRED" (
    "ID" integer NOT NULL,
    "RULE_ID" integer NOT NULL,
    "FIRED_AT" timestamp with time zone DEFAULT now() NOT NULL,
    "BUDGET_EUR" numeric(14,2) NOT NULL,
    "ACTUAL_EUR" numeric(14,2) NOT NULL,
    "TRIGGER_TEC_ID" integer,
    "RESET_AT" timestamp with time zone
);


--
-- Name: BUDGET_WARNING_FIRED_ID_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public."BUDGET_WARNING_FIRED_ID_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: BUDGET_WARNING_FIRED_ID_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public."BUDGET_WARNING_FIRED_ID_seq" OWNED BY public."BUDGET_WARNING_FIRED"."ID";


--
-- Name: BUDGET_WARNING_RULE; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."BUDGET_WARNING_RULE" (
    "ID" integer NOT NULL,
    "TENANT_ID" integer DEFAULT public.current_tenant_id() NOT NULL,
    "PROJECT_ID" integer,
    "STRUCTURE_ID" integer,
    "THRESHOLD_PCT" numeric(5,2) NOT NULL,
    "NOTIFY_PM" boolean DEFAULT true NOT NULL,
    "NOTIFY_BOOKER" boolean DEFAULT true NOT NULL,
    "NOTIFY_CC" integer[],
    "MUTED" boolean DEFAULT false NOT NULL,
    "CREATED_AT" timestamp with time zone DEFAULT now() NOT NULL,
    "CREATED_BY" integer,
    CONSTRAINT chk_bw_rule_pct CHECK ((("THRESHOLD_PCT" > (0)::numeric) AND ("THRESHOLD_PCT" <= (500)::numeric))),
    CONSTRAINT chk_bw_rule_scope CHECK (((("PROJECT_ID" IS NOT NULL) AND ("STRUCTURE_ID" IS NULL)) OR (("PROJECT_ID" IS NULL) AND ("STRUCTURE_ID" IS NOT NULL))))
);

ALTER TABLE ONLY public."BUDGET_WARNING_RULE" FORCE ROW LEVEL SECURITY;


--
-- Name: BUDGET_WARNING_RULE_ID_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public."BUDGET_WARNING_RULE_ID_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: BUDGET_WARNING_RULE_ID_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public."BUDGET_WARNING_RULE_ID_seq" OWNED BY public."BUDGET_WARNING_RULE"."ID";


--
-- Name: CAPABILITY_PERMISSION; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."CAPABILITY_PERMISSION" (
    "CAPABILITY_KEY" character varying(100) NOT NULL,
    "PERMISSION_KEY" character varying(100) NOT NULL
);


--
-- Name: COMPANY; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."COMPANY" (
    "ID" bigint NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    "COMPANY_NAME_1" character varying,
    "COMPANY_NAME_2" character varying,
    "STREET" character varying,
    "POST_CODE" character varying,
    "CITY" character varying,
    "POST_OFFICE_BOX" character varying,
    "COUNTRY_ID" bigint,
    "TAX-ID" character varying,
    "TAX_NUMBER" character varying,
    "BIC" character varying,
    "IBAN" character varying,
    "CREDITOR-ID" character varying,
    "TENANT_ID" bigint DEFAULT public.current_tenant_id(),
    "PEPPOL_ENDPOINT_ID" text,
    "PEPPOL_SCHEME_ID" character varying(10)
);

ALTER TABLE ONLY public."COMPANY" FORCE ROW LEVEL SECURITY;


--
-- Name: COMPANY_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public."COMPANY" ALTER COLUMN "ID" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME public."COMPANY_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: CONTACTS; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."CONTACTS" (
    "ID" bigint NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    "TITLE" character varying,
    "FIRST_NAME" character varying,
    "LAST_NAME" character varying,
    "EMAIL" character varying,
    "MOBILE" character varying,
    "SALUTATION_ID" bigint,
    "GENDER_ID" bigint,
    "ADDRESS_ID" bigint,
    "TENANT_ID" bigint DEFAULT public.current_tenant_id(),
    "IMPORT_BATCH_ID" integer,
    "POSITION" text,
    "DEPARTMENT" text,
    "PHONE" text,
    "IS_PRIMARY" smallint DEFAULT 0,
    "NOTES" text
);

ALTER TABLE ONLY public."CONTACTS" FORCE ROW LEVEL SECURITY;


--
-- Name: CONTACTS_ID_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public."CONTACTS" ALTER COLUMN "ID" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME public."CONTACTS_ID_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: CONTRACT; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."CONTRACT" (
    "ID" bigint NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    "NAME_SHORT" character varying,
    "NAME_LONG" character varying,
    "PROJECT_ID" bigint,
    "INVOICE_ADDRESS_ID" bigint,
    "INVOICE_CONTACT_ID" bigint,
    "CURRENCY_ID" bigint,
    "TENANT_ID" bigint DEFAULT public.current_tenant_id(),
    "VAT_ID" bigint,
    "CASH_DISCOUNT_PERCENT" numeric,
    "CASH_DISCOUNT_DAYS" numeric,
    "SE_ENABLED" boolean DEFAULT false NOT NULL,
    "SE_PERCENT" numeric(5,2),
    "SE_BASIS" text DEFAULT 'BRUTTO'::text,
    "SE_LEGAL_REFERENCE" text,
    "VAT_CATEGORY" character varying(3) DEFAULT 'S'::character varying,
    "VAT_EXEMPTION_REASON_CODE" text,
    "VAT_EXEMPTION_REASON_TEXT" text,
    "IMPORT_BATCH_ID" integer
);

ALTER TABLE ONLY public."CONTRACT" FORCE ROW LEVEL SECURITY;


--
-- Name: CONTRACT_ID_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public."CONTRACT" ALTER COLUMN "ID" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME public."CONTRACT_ID_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: COST_RATE_CONFIG; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."COST_RATE_CONFIG" (
    "ID" integer NOT NULL,
    "TENANT_ID" integer DEFAULT public.current_tenant_id() NOT NULL,
    "YEAR" integer NOT NULL,
    "CATEGORY" text DEFAULT 'Sonstiges'::text NOT NULL,
    "ITEM_NAME" text NOT NULL,
    "AMOUNT" numeric DEFAULT 0 NOT NULL
);

ALTER TABLE ONLY public."COST_RATE_CONFIG" FORCE ROW LEVEL SECURITY;


--
-- Name: COST_RATE_CONFIG_ID_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public."COST_RATE_CONFIG_ID_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: COST_RATE_CONFIG_ID_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public."COST_RATE_CONFIG_ID_seq" OWNED BY public."COST_RATE_CONFIG"."ID";


--
-- Name: COST_RATE_EMP_PARAMS; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."COST_RATE_EMP_PARAMS" (
    "ID" integer NOT NULL,
    "TENANT_ID" integer DEFAULT public.current_tenant_id() NOT NULL,
    "EMPLOYEE_ID" integer NOT NULL,
    "YEAR" integer NOT NULL,
    "ANNUAL_SALARY" numeric DEFAULT 0 NOT NULL,
    "WEEKLY_HOURS" numeric DEFAULT 40 NOT NULL,
    "VACATION_DAYS" numeric DEFAULT 30 NOT NULL,
    "SICK_DAYS_EST" numeric DEFAULT 7 NOT NULL,
    "TRAINING_DAYS" numeric DEFAULT 5 NOT NULL,
    "SOCIAL_CONTRIB_PCT" numeric DEFAULT 21 NOT NULL,
    "PRODUCTIVITY_PCT" numeric DEFAULT 85 NOT NULL
);

ALTER TABLE ONLY public."COST_RATE_EMP_PARAMS" FORCE ROW LEVEL SECURITY;


--
-- Name: COST_RATE_EMP_PARAMS_ID_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public."COST_RATE_EMP_PARAMS_ID_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: COST_RATE_EMP_PARAMS_ID_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public."COST_RATE_EMP_PARAMS_ID_seq" OWNED BY public."COST_RATE_EMP_PARAMS"."ID";


--
-- Name: COUNTRY; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."COUNTRY" (
    "ID" bigint NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    "NAME_SHORT" character varying,
    "NAME_LONG" character varying
);


--
-- Name: COUNTRY_ID_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public."COUNTRY" ALTER COLUMN "ID" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME public."COUNTRY_ID_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: CURRENCY; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."CURRENCY" (
    "ID" bigint NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    "NAME_SHORT" character varying,
    "NAME_LONG" character varying
);


--
-- Name: CURRENCY_ID_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public."CURRENCY" ALTER COLUMN "ID" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME public."CURRENCY_ID_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: DEPARTMENT; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."DEPARTMENT" (
    "ID" bigint NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    "NAME_SHORT" character varying,
    "NAME_LONG" character varying,
    "TENANT_ID" bigint DEFAULT public.current_tenant_id()
);

ALTER TABLE ONLY public."DEPARTMENT" FORCE ROW LEVEL SECURITY;


--
-- Name: DEPARTMENT_ID_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public."DEPARTMENT" ALTER COLUMN "ID" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME public."DEPARTMENT_ID_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: DIN276_COST_ESTIMATE; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."DIN276_COST_ESTIMATE" (
    "ID" integer NOT NULL,
    "TENANT_ID" integer DEFAULT public.current_tenant_id() NOT NULL,
    "PROJECT_ID" integer,
    "OFFER_ID" integer,
    "NAME_SHORT" character varying(100),
    "NAME_LONG" character varying(500),
    "STAGE" text DEFAULT 'berechnung'::text NOT NULL,
    "DIN_VERSION" text DEFAULT '2008-12'::text NOT NULL,
    "STATUS" text DEFAULT 'draft'::text NOT NULL,
    "MITVERARBEITETE_BAUSUBSTANZ" numeric(14,2) DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public."DIN276_COST_ESTIMATE" FORCE ROW LEVEL SECURITY;


--
-- Name: DIN276_COST_ESTIMATE_ID_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public."DIN276_COST_ESTIMATE_ID_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: DIN276_COST_ESTIMATE_ID_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public."DIN276_COST_ESTIMATE_ID_seq" OWNED BY public."DIN276_COST_ESTIMATE"."ID";


--
-- Name: DIN276_COST_GROUP; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."DIN276_COST_GROUP" (
    "ID" integer NOT NULL,
    "TENANT_ID" integer DEFAULT public.current_tenant_id() NOT NULL,
    "ESTIMATE_ID" integer NOT NULL,
    "KG_CODE" character varying(10) NOT NULL,
    "LABEL" character varying(200),
    "AMOUNT" numeric(14,2) DEFAULT 0 NOT NULL,
    "IS_PLANNED_SELF" boolean DEFAULT false NOT NULL,
    "SORT_ORDER" integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public."DIN276_COST_GROUP" FORCE ROW LEVEL SECURITY;


--
-- Name: DIN276_COST_GROUP_ID_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public."DIN276_COST_GROUP_ID_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: DIN276_COST_GROUP_ID_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public."DIN276_COST_GROUP_ID_seq" OWNED BY public."DIN276_COST_GROUP"."ID";


--
-- Name: document_number_range; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.document_number_range (
    id bigint NOT NULL,
    company_id bigint NOT NULL,
    doc_type text NOT NULL,
    year integer NOT NULL,
    next_counter integer DEFAULT 1 NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    "TENANT_ID" bigint DEFAULT public.current_tenant_id(),
    "COMPANY_ID" bigint
);

ALTER TABLE ONLY public.document_number_range FORCE ROW LEVEL SECURITY;


--
-- Name: DOCUMENT_NUMBER_RANGE; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public."DOCUMENT_NUMBER_RANGE" AS
 SELECT id,
    company_id AS "COMPANY_ID",
    doc_type AS "DOC_TYPE",
    year AS "YEAR",
    next_counter AS "NEXT_COUNTER",
    updated_at AS "UPDATED_AT"
   FROM public.document_number_range;


--
-- Name: DOCUMENT_TEMPLATE; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."DOCUMENT_TEMPLATE" (
    "ID" bigint NOT NULL,
    "COMPANY_ID" bigint NOT NULL,
    "NAME" text NOT NULL,
    "DOC_TYPE" text NOT NULL,
    "LAYOUT_KEY" text NOT NULL,
    "THEME_JSON" jsonb DEFAULT '{}'::jsonb NOT NULL,
    "LOGO_ASSET_ID" bigint,
    "IS_DEFAULT" boolean DEFAULT false NOT NULL,
    "IS_ACTIVE" boolean DEFAULT true NOT NULL,
    "CREATED_AT" timestamp with time zone DEFAULT now() NOT NULL,
    "UPDATED_AT" timestamp with time zone DEFAULT now() NOT NULL,
    "STATUS" text,
    "VERSION" integer,
    "FAMILY_ID" bigint,
    "PUBLISHED_AT" timestamp with time zone,
    "ARCHIVED_AT" timestamp with time zone,
    "BUILDER_LAYOUT_JSON" jsonb,
    "TENANT_ID" bigint DEFAULT public.current_tenant_id(),
    CONSTRAINT document_template_status_check CHECK (("STATUS" = ANY (ARRAY['DRAFT'::text, 'PUBLISHED'::text, 'ARCHIVED'::text])))
);

ALTER TABLE ONLY public."DOCUMENT_TEMPLATE" FORCE ROW LEVEL SECURITY;


--
-- Name: DOCUMENT_TEMPLATE_ID_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public."DOCUMENT_TEMPLATE_ID_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: DOCUMENT_TEMPLATE_ID_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public."DOCUMENT_TEMPLATE_ID_seq" OWNED BY public."DOCUMENT_TEMPLATE"."ID";


--
-- Name: EMAIL_TEMPLATE; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."EMAIL_TEMPLATE" (
    "ID" integer NOT NULL,
    "TENANT_ID" integer DEFAULT public.current_tenant_id() NOT NULL,
    "TEMPLATE_KEY" text NOT NULL,
    "SUBJECT" text,
    "BODY" text,
    "UPDATED_AT" timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public."EMAIL_TEMPLATE" FORCE ROW LEVEL SECURITY;


--
-- Name: EMAIL_TEMPLATE_ID_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public."EMAIL_TEMPLATE_ID_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: EMAIL_TEMPLATE_ID_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public."EMAIL_TEMPLATE_ID_seq" OWNED BY public."EMAIL_TEMPLATE"."ID";


--
-- Name: EMPLOYEE; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."EMPLOYEE" (
    "ID" bigint NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    "SHORT_NAME" character varying,
    "TITLE" character varying,
    "FIRST_NAME" character varying,
    "LAST_NAME" character varying,
    "PASSWORD" character varying,
    "MAIL" character varying,
    "MOBILE" character varying,
    "PERSONNEL_NUMBER" character varying,
    "SALUTATION_ID" bigint,
    "GENDER_ID" bigint,
    "PHONE" character varying,
    "ACTIVE" bigint,
    "TENANT_ID" bigint DEFAULT public.current_tenant_id(),
    "DEPARTMENT_ID" integer,
    "DASHBOARD_ROLE" text,
    "AVATAR_ASSET_ID" integer,
    "AVATAR_DATA_URI" text,
    "ENTRY_DATE" date,
    "EXIT_DATE" date,
    "IMPORT_BATCH_ID" integer
);

ALTER TABLE ONLY public."EMPLOYEE" FORCE ROW LEVEL SECURITY;


--
-- Name: EMPLOYEE2PROJECT; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."EMPLOYEE2PROJECT" (
    "ID" bigint NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    "PROJECT_ID" bigint,
    "EMPLOYEE_ID" bigint,
    "ROLE_ID" bigint,
    "SP_RATE" numeric,
    "ROLE_NAME_SHORT" character varying,
    "ROLE_NAME_LONG" character varying,
    "TENANT_ID" bigint DEFAULT public.current_tenant_id()
);

ALTER TABLE ONLY public."EMPLOYEE2PROJECT" FORCE ROW LEVEL SECURITY;


--
-- Name: EMPLOYEE2PROJECT_ID_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public."EMPLOYEE2PROJECT" ALTER COLUMN "ID" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME public."EMPLOYEE2PROJECT_ID_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: EMPLOYEE_CP_RATE; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."EMPLOYEE_CP_RATE" (
    "ID" integer NOT NULL,
    "TENANT_ID" integer DEFAULT public.current_tenant_id() NOT NULL,
    "EMPLOYEE_ID" integer NOT NULL,
    "CP_RATE" numeric(10,4) NOT NULL,
    "VALID_FROM" date NOT NULL
);

ALTER TABLE ONLY public."EMPLOYEE_CP_RATE" FORCE ROW LEVEL SECURITY;


--
-- Name: EMPLOYEE_CP_RATE_ID_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public."EMPLOYEE_CP_RATE_ID_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: EMPLOYEE_CP_RATE_ID_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public."EMPLOYEE_CP_RATE_ID_seq" OWNED BY public."EMPLOYEE_CP_RATE"."ID";


--
-- Name: EMPLOYEE_MONTH_CLOSE; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."EMPLOYEE_MONTH_CLOSE" (
    "ID" integer NOT NULL,
    "TENANT_ID" integer DEFAULT public.current_tenant_id() NOT NULL,
    "EMPLOYEE_ID" integer NOT NULL,
    "YEAR" integer NOT NULL,
    "MONTH" integer NOT NULL,
    "CLOSED_AT" timestamp with time zone DEFAULT now() NOT NULL,
    "CLOSED_BY" integer NOT NULL
);

ALTER TABLE ONLY public."EMPLOYEE_MONTH_CLOSE" FORCE ROW LEVEL SECURITY;


--
-- Name: EMPLOYEE_MONTH_CLOSE_ID_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public."EMPLOYEE_MONTH_CLOSE_ID_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: EMPLOYEE_MONTH_CLOSE_ID_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public."EMPLOYEE_MONTH_CLOSE_ID_seq" OWNED BY public."EMPLOYEE_MONTH_CLOSE"."ID";


--
-- Name: EMPLOYEE_ROLE; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."EMPLOYEE_ROLE" (
    "EMPLOYEE_ID" integer NOT NULL,
    "ROLE_ID" integer NOT NULL,
    "ASSIGNED_AT" timestamp with time zone DEFAULT now() NOT NULL,
    "ASSIGNED_BY" integer
);


--
-- Name: EMPLOYEE_WORK_MODEL; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."EMPLOYEE_WORK_MODEL" (
    "ID" integer NOT NULL,
    "TENANT_ID" integer DEFAULT public.current_tenant_id() NOT NULL,
    "EMPLOYEE_ID" integer NOT NULL,
    "MODEL_ID" integer NOT NULL,
    "VALID_FROM" date NOT NULL
);

ALTER TABLE ONLY public."EMPLOYEE_WORK_MODEL" FORCE ROW LEVEL SECURITY;


--
-- Name: EMPLOYEE_WORK_MODEL_ID_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public."EMPLOYEE_WORK_MODEL_ID_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: EMPLOYEE_WORK_MODEL_ID_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public."EMPLOYEE_WORK_MODEL_ID_seq" OWNED BY public."EMPLOYEE_WORK_MODEL"."ID";


--
-- Name: EMPLOYEE_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public."EMPLOYEE" ALTER COLUMN "ID" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME public."EMPLOYEE_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: FEE_CALCULATION_BL; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."FEE_CALCULATION_BL" (
    "ID" integer NOT NULL,
    "TENANT_ID" integer DEFAULT public.current_tenant_id() NOT NULL,
    "FEE_CALC_MASTER_ID" integer NOT NULL,
    "NAME" text NOT NULL,
    "LPH_REF" text,
    "AMOUNT" numeric(14,4) DEFAULT 0 NOT NULL,
    "SORT_ORDER" integer DEFAULT 0 NOT NULL,
    "CREATED_AT" timestamp with time zone DEFAULT now() NOT NULL,
    "NAME_SHORT" text,
    "LPH_PHASE_ID" integer,
    "AMOUNT_TYPE" text DEFAULT 'fixed'::text NOT NULL,
    "PERCENT" numeric(10,4),
    "KX_REF" text
);

ALTER TABLE ONLY public."FEE_CALCULATION_BL" FORCE ROW LEVEL SECURITY;


--
-- Name: FEE_CALCULATION_BL_ID_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public."FEE_CALCULATION_BL_ID_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: FEE_CALCULATION_BL_ID_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public."FEE_CALCULATION_BL_ID_seq" OWNED BY public."FEE_CALCULATION_BL"."ID";


--
-- Name: FEE_CALCULATION_MASTER; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."FEE_CALCULATION_MASTER" (
    "ID" bigint NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    "FEE_MASTER_ID" bigint,
    "NAME_SHORT" character varying,
    "NAME_LONG" character varying,
    "PROJECT_ID" bigint,
    "ZONE_ID" bigint,
    "ZONE_PERCENT" numeric,
    "REVENUE_K0" numeric,
    "REVENUE_K1" numeric,
    "REVENUE_K2" numeric,
    "REVENUE_K3" numeric,
    "REVENUE_K4" numeric,
    "CONSTRUCTION_COSTS_K0" numeric,
    "CONSTRUCTION_COSTS_K1" numeric,
    "CONSTRUCTION_COSTS_K2" numeric,
    "CONSTRUCTION_COSTS_K3" numeric,
    "CONSTRUCTION_COSTS_K4" numeric,
    "TENANT_ID" bigint DEFAULT public.current_tenant_id(),
    "OFFER_ID" integer,
    "ATTACH_TO_OFFER_STRUCTURE_ID" integer,
    "DIN276_ESTIMATE_ID" integer,
    "DIN276_LEISTUNGSBILD" text,
    CONSTRAINT chk_fee_calc_master_source CHECK ((("PROJECT_ID" IS NOT NULL) OR ("OFFER_ID" IS NOT NULL)))
);

ALTER TABLE ONLY public."FEE_CALCULATION_MASTER" FORCE ROW LEVEL SECURITY;


--
-- Name: FEE_CALCULATION_MASTER_ID_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public."FEE_CALCULATION_MASTER" ALTER COLUMN "ID" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME public."FEE_CALCULATION_MASTER_ID_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: FEE_CALCULATION_PHASE; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."FEE_CALCULATION_PHASE" (
    "ID" bigint NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    "FEE_MASTER_ID" bigint,
    "FEE_PHASE_ID" bigint,
    "FEE_PERCENT_BASE" numeric,
    "KX" character varying,
    "REVENUE_BASE" numeric,
    "FEE_PERCENT" numeric,
    "PHASE_REVENUE" numeric,
    "TENANT_ID" bigint DEFAULT public.current_tenant_id()
);

ALTER TABLE ONLY public."FEE_CALCULATION_PHASE" FORCE ROW LEVEL SECURITY;


--
-- Name: FEE_CALCULATION_PHASE_ID_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public."FEE_CALCULATION_PHASE" ALTER COLUMN "ID" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME public."FEE_CALCULATION_PHASE_ID_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: FEE_CALCULATION_SURCHARGES; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."FEE_CALCULATION_SURCHARGES" (
    "ID" integer NOT NULL,
    "TENANT_ID" integer DEFAULT public.current_tenant_id() NOT NULL,
    "FEE_CALC_MASTER_ID" integer NOT NULL,
    "FEE_SURCHARGE_ID" integer,
    "NAME_SHORT" character varying(100),
    "NAME_LONG" character varying(500),
    "PERCENT" numeric(8,4),
    "BASE_AMOUNT" numeric(12,2),
    "AMOUNT" numeric(12,2),
    "SORT_ORDER" integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    "LPH_FILTER" text,
    "CALC_MODE" text DEFAULT 'parallel'::text NOT NULL,
    "INCLUDE_BL" boolean DEFAULT false NOT NULL,
    "BL_FILTER" text
);

ALTER TABLE ONLY public."FEE_CALCULATION_SURCHARGES" FORCE ROW LEVEL SECURITY;


--
-- Name: FEE_CALCULATION_SURCHARGES_ID_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public."FEE_CALCULATION_SURCHARGES_ID_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: FEE_CALCULATION_SURCHARGES_ID_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public."FEE_CALCULATION_SURCHARGES_ID_seq" OWNED BY public."FEE_CALCULATION_SURCHARGES"."ID";


--
-- Name: FEE_CALC_ZONE_SPLIT; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."FEE_CALC_ZONE_SPLIT" (
    "ID" integer NOT NULL,
    "TENANT_ID" integer DEFAULT public.current_tenant_id() NOT NULL,
    "FEE_CALC_MASTER_ID" integer NOT NULL,
    "ZONE_ID" integer NOT NULL,
    "ZONE_PERCENT" numeric(6,2) DEFAULT 0 NOT NULL,
    "AMOUNT" numeric(14,2) DEFAULT 0 NOT NULL,
    "SORT_ORDER" integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public."FEE_CALC_ZONE_SPLIT" FORCE ROW LEVEL SECURITY;


--
-- Name: FEE_CALC_ZONE_SPLIT_ID_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public."FEE_CALC_ZONE_SPLIT_ID_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: FEE_CALC_ZONE_SPLIT_ID_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public."FEE_CALC_ZONE_SPLIT_ID_seq" OWNED BY public."FEE_CALC_ZONE_SPLIT"."ID";


--
-- Name: FEE_GROUPS; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."FEE_GROUPS" (
    "ID" bigint NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    "NAME_SHORT" character varying,
    "NAME_LONG" character varying
);


--
-- Name: FEE_GROUPS_ID_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public."FEE_GROUPS" ALTER COLUMN "ID" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME public."FEE_GROUPS_ID_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: FEE_MASTERS; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."FEE_MASTERS" (
    "ID" bigint NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    "FEE_GROUP_ID" bigint,
    "NAME_SHORT" character varying,
    "NAME_LONG" character varying,
    "MIN" numeric,
    "MAX" numeric,
    "BASE_TYPE" text DEFAULT 'cost_eur'::text NOT NULL,
    "SUPPORTS_ZONE_SPLIT" boolean DEFAULT false NOT NULL,
    CONSTRAINT chk_fee_masters_base_type CHECK (("BASE_TYPE" = ANY (ARRAY['cost_eur'::text, 'area_ha'::text, 'verrechnungseinheiten'::text, 'percent_of_baukosten'::text, 'flaechenaequivalent_brandschutz'::text])))
);


--
-- Name: COLUMN "FEE_MASTERS"."SUPPORTS_ZONE_SPLIT"; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public."FEE_MASTERS"."SUPPORTS_ZONE_SPLIT" IS 'Zonenaufteilung/Mischhonorar anwendbar (§ 54 HOAI, Technische Ausrüstung). Steuert die Sichtbarkeit des Mischhonorar-Dialogs.';


--
-- Name: FEE_MASTER_ID_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public."FEE_MASTERS" ALTER COLUMN "ID" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME public."FEE_MASTER_ID_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: FEE_PHASE; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."FEE_PHASE" (
    "ID" bigint NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    "FEE_MASTER_ID" bigint,
    "NAME_SHORT" character varying,
    "NAME_LONG" character varying,
    "FEE_PERCENT" numeric,
    "SORT_ORDER" integer
);


--
-- Name: FEE_PHASE_ID_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public."FEE_PHASE" ALTER COLUMN "ID" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME public."FEE_PHASE_ID_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: FEE_SURCHARGES; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."FEE_SURCHARGES" (
    "ID" bigint NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    "NAME_SHORT" character varying,
    "NAME_LONG" character varying,
    "SURCHARGE_TYPE" character varying,
    "DEFAULT_PERCENT" numeric(6,2),
    "MAX_PERCENT" numeric(6,2),
    "LEGAL_REF" character varying(120)
);


--
-- Name: FEE_SURCHARGES2MASTER; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."FEE_SURCHARGES2MASTER" (
    "ID" bigint NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    "FEE_MASTER_ID" bigint,
    "FEE_SURCHARGE_ID" bigint
);


--
-- Name: FEE_SURCHARGES2MASTER_ID_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public."FEE_SURCHARGES2MASTER" ALTER COLUMN "ID" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME public."FEE_SURCHARGES2MASTER_ID_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: FEE_SURCHARGES_ID_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public."FEE_SURCHARGES" ALTER COLUMN "ID" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME public."FEE_SURCHARGES_ID_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: FEE_TABLES; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."FEE_TABLES" (
    "ID" bigint NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    "FEE_MASTER_ID" bigint,
    "BASE" numeric,
    "ZONE_1" numeric,
    "ZONE_2" numeric,
    "ZONE_3" numeric,
    "ZONE_4" numeric,
    "ZONE_5" numeric,
    "ZONE_TOP" numeric
);


--
-- Name: FEE_TABLES_ID_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public."FEE_TABLES" ALTER COLUMN "ID" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME public."FEE_TABLES_ID_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: FEE_ZONES; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."FEE_ZONES" (
    "ID" bigint NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    "FEE_MASTER_ID" bigint,
    "NAME_SHORT" character varying,
    "NAME_LONG" character varying
);


--
-- Name: FEE_ZONES_ID_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public."FEE_ZONES" ALTER COLUMN "ID" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME public."FEE_ZONES_ID_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: FEE_ZONE_CRITERION; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."FEE_ZONE_CRITERION" (
    "ID" integer NOT NULL,
    "FEE_MASTER_ID" integer NOT NULL,
    "SORT_ORDER" integer NOT NULL,
    "TEXT" text NOT NULL,
    "MAX_POINTS" integer NOT NULL,
    "LEVEL_HINT" text,
    "LEGAL_REF" character varying(120),
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: FEE_ZONE_CRITERION_ID_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public."FEE_ZONE_CRITERION_ID_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: FEE_ZONE_CRITERION_ID_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public."FEE_ZONE_CRITERION_ID_seq" OWNED BY public."FEE_ZONE_CRITERION"."ID";


--
-- Name: FEE_ZONE_LOOKUP; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."FEE_ZONE_LOOKUP" (
    "ID" integer NOT NULL,
    "FEE_MASTER_ID" integer NOT NULL,
    "CATEGORY" character varying(255),
    "DESCRIPTION" text NOT NULL,
    "ZONE_ID" integer NOT NULL,
    "SORT_ORDER" integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: FEE_ZONE_LOOKUP_ID_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public."FEE_ZONE_LOOKUP_ID_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: FEE_ZONE_LOOKUP_ID_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public."FEE_ZONE_LOOKUP_ID_seq" OWNED BY public."FEE_ZONE_LOOKUP"."ID";


--
-- Name: FEE_ZONE_THRESHOLD; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."FEE_ZONE_THRESHOLD" (
    "ID" integer NOT NULL,
    "FEE_MASTER_ID" integer NOT NULL,
    "ZONE_ID" integer NOT NULL,
    "POINTS_FROM" integer NOT NULL,
    "POINTS_TO" integer NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: FEE_ZONE_THRESHOLD_ID_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public."FEE_ZONE_THRESHOLD_ID_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: FEE_ZONE_THRESHOLD_ID_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public."FEE_ZONE_THRESHOLD_ID_seq" OWNED BY public."FEE_ZONE_THRESHOLD"."ID";


--
-- Name: GENDER; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."GENDER" (
    "ID" bigint NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    "GENDER" character varying
);


--
-- Name: GENDER_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public."GENDER" ALTER COLUMN "ID" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME public."GENDER_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: IMPORT_BATCH; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."IMPORT_BATCH" (
    "ID" integer NOT NULL,
    "TENANT_ID" integer DEFAULT public.current_tenant_id() NOT NULL,
    "DOMAIN" text NOT NULL,
    "STATUS" text DEFAULT 'committed'::text NOT NULL,
    "SOURCE_FILENAME" text,
    "MAPPING_JSON" jsonb,
    "ROW_TOTAL" integer DEFAULT 0 NOT NULL,
    "ROW_OK" integer DEFAULT 0 NOT NULL,
    "ROW_SKIPPED" integer DEFAULT 0 NOT NULL,
    "ROW_ERROR" integer DEFAULT 0 NOT NULL,
    "SUMMARY_JSON" jsonb,
    "CREATED_BY" integer,
    "CREATED_AT" timestamp with time zone DEFAULT now() NOT NULL,
    "ROLLED_BACK_AT" timestamp with time zone
);

ALTER TABLE ONLY public."IMPORT_BATCH" FORCE ROW LEVEL SECURITY;


--
-- Name: IMPORT_BATCH_ID_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public."IMPORT_BATCH_ID_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: IMPORT_BATCH_ID_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public."IMPORT_BATCH_ID_seq" OWNED BY public."IMPORT_BATCH"."ID";


--
-- Name: INVOICE_ATTACHMENT; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."INVOICE_ATTACHMENT" (
    "ID" integer NOT NULL,
    "TENANT_ID" integer DEFAULT public.current_tenant_id() NOT NULL,
    "INVOICE_ID" integer,
    "PP_ID" integer,
    "ASSET_ID" integer,
    "DESCRIPTION" text,
    "ATTACHMENT_TYPE_CODE" character varying(10) DEFAULT '916'::character varying,
    "DOCUMENT_REFERENCE" text,
    "POSITION" integer DEFAULT 0 NOT NULL,
    "CREATED_AT" timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT chk_invoice_attachment_source CHECK (((("INVOICE_ID" IS NOT NULL) AND ("PP_ID" IS NULL)) OR (("INVOICE_ID" IS NULL) AND ("PP_ID" IS NOT NULL))))
);

ALTER TABLE ONLY public."INVOICE_ATTACHMENT" FORCE ROW LEVEL SECURITY;


--
-- Name: INVOICE_ATTACHMENT_ID_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public."INVOICE_ATTACHMENT_ID_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: INVOICE_ATTACHMENT_ID_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public."INVOICE_ATTACHMENT_ID_seq" OWNED BY public."INVOICE_ATTACHMENT"."ID";


--
-- Name: INVOICE_DEDUCTION; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."INVOICE_DEDUCTION" (
    "ID" integer NOT NULL,
    "TENANT_ID" integer DEFAULT public.current_tenant_id(),
    "INVOICE_ID" integer NOT NULL,
    "PARTIAL_PAYMENT_ID" integer NOT NULL,
    "DEDUCTION_AMOUNT_NET" numeric(15,2) DEFAULT 0 NOT NULL
);

ALTER TABLE ONLY public."INVOICE_DEDUCTION" FORCE ROW LEVEL SECURITY;


--
-- Name: INVOICE_DEDUCTION_ID_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public."INVOICE_DEDUCTION_ID_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: INVOICE_DEDUCTION_ID_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public."INVOICE_DEDUCTION_ID_seq" OWNED BY public."INVOICE_DEDUCTION"."ID";


--
-- Name: INVOICE_ID_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public."INVOICE" ALTER COLUMN "ID" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME public."INVOICE_ID_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: INVOICE_STRUCTURE; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."INVOICE_STRUCTURE" (
    "ID" bigint NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    "INVOICE_ID" bigint,
    "STRUCTURE_ID" bigint,
    "AMOUNT_NET" numeric,
    "AMOUNT_EXTRAS_NET" numeric,
    "TENANT_ID" bigint DEFAULT public.current_tenant_id(),
    "IMPORT_BATCH_ID" integer
);

ALTER TABLE ONLY public."INVOICE_STRUCTURE" FORCE ROW LEVEL SECURITY;


--
-- Name: INVOICE_STRUCTURE_ID_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public."INVOICE_STRUCTURE" ALTER COLUMN "ID" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME public."INVOICE_STRUCTURE_ID_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: LANDING_EVENT; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."LANDING_EVENT" (
    "ID" bigint NOT NULL,
    "SESSION_KEY" text,
    "EVENT_TYPE" text NOT NULL,
    "EVENT_LABEL" text,
    "PATH" text,
    "REFERRER_HOST" text,
    "SCROLL_DEPTH" smallint,
    "ENGAGED_MS" integer,
    "DEVICE_TYPE" text,
    "VIEWPORT_W" smallint,
    "LANGUAGE" text,
    "UTM_SOURCE" text,
    "UTM_MEDIUM" text,
    "UTM_CAMPAIGN" text,
    "COUNTRY" text,
    "CREATED_AT" timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: LANDING_EVENT_ID_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public."LANDING_EVENT_ID_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: LANDING_EVENT_ID_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public."LANDING_EVENT_ID_seq" OWNED BY public."LANDING_EVENT"."ID";


--
-- Name: LICENSE_CAPABILITY; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."LICENSE_CAPABILITY" (
    "KEY" character varying(100) NOT NULL,
    "MODULE_KEY" character varying(50) NOT NULL,
    "LABEL_DE" text NOT NULL,
    "TYPE" character varying(20) DEFAULT 'boolean'::character varying NOT NULL,
    "UNIT" character varying(50),
    "POSITION" integer DEFAULT 0 NOT NULL,
    CONSTRAINT "LICENSE_CAPABILITY_TYPE_check" CHECK ((("TYPE")::text = ANY (ARRAY[('boolean'::character varying)::text, ('metered'::character varying)::text])))
);


--
-- Name: LICENSE_CHANGE_LOG; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."LICENSE_CHANGE_LOG" (
    "ID" integer NOT NULL,
    "ACTOR" text,
    "ENTITY" text NOT NULL,
    "ENTITY_REF" text,
    "ACTION" text NOT NULL,
    "BEFORE" jsonb,
    "AFTER" jsonb,
    "AT" timestamp with time zone DEFAULT now() NOT NULL,
    "CONTEXT" jsonb,
    "IP" text,
    "USER_AGENT" text
);


--
-- Name: LICENSE_CHANGE_LOG_ID_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public."LICENSE_CHANGE_LOG_ID_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: LICENSE_CHANGE_LOG_ID_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public."LICENSE_CHANGE_LOG_ID_seq" OWNED BY public."LICENSE_CHANGE_LOG"."ID";


--
-- Name: LICENSE_MODULE; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."LICENSE_MODULE" (
    "KEY" character varying(50) NOT NULL,
    "LABEL_DE" text NOT NULL,
    "POSITION" integer DEFAULT 0 NOT NULL
);


--
-- Name: LICENSE_PLAN; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."LICENSE_PLAN" (
    "ID" integer NOT NULL,
    "KEY" character varying(40) NOT NULL,
    "NAME_DE" text NOT NULL,
    "DESCRIPTION_DE" text,
    "POSITION" integer DEFAULT 0 NOT NULL,
    "IS_ACTIVE" boolean DEFAULT true NOT NULL,
    "PRICE_MONTHLY" numeric(10,2),
    "PRICE_YEARLY" numeric(10,2),
    "VERSION" integer DEFAULT 1 NOT NULL,
    "CREATED_AT" timestamp with time zone DEFAULT now() NOT NULL,
    "UPDATED_AT" timestamp with time zone DEFAULT now() NOT NULL,
    "IS_DEFAULT" boolean DEFAULT false NOT NULL
);


--
-- Name: LICENSE_PLAN_ID_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public."LICENSE_PLAN_ID_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: LICENSE_PLAN_ID_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public."LICENSE_PLAN_ID_seq" OWNED BY public."LICENSE_PLAN"."ID";


--
-- Name: LPH_BLOCK; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."LPH_BLOCK" (
    "ID" integer NOT NULL,
    "TENANT_ID" integer DEFAULT public.current_tenant_id() NOT NULL,
    "FEE_MASTER_ID" integer NOT NULL,
    "NAME_SHORT" character varying(100) NOT NULL,
    "SORT_ORDER" integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public."LPH_BLOCK" FORCE ROW LEVEL SECURITY;


--
-- Name: LPH_BLOCK_ID_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public."LPH_BLOCK_ID_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: LPH_BLOCK_ID_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public."LPH_BLOCK_ID_seq" OWNED BY public."LPH_BLOCK"."ID";


--
-- Name: LPH_BLOCK_PHASE; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."LPH_BLOCK_PHASE" (
    "ID" integer NOT NULL,
    "TENANT_ID" integer DEFAULT public.current_tenant_id() NOT NULL,
    "BLOCK_ID" integer NOT NULL,
    "FEE_PHASE_ID" integer NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public."LPH_BLOCK_PHASE" FORCE ROW LEVEL SECURITY;


--
-- Name: LPH_BLOCK_PHASE_ID_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public."LPH_BLOCK_PHASE_ID_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: LPH_BLOCK_PHASE_ID_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public."LPH_BLOCK_PHASE_ID_seq" OWNED BY public."LPH_BLOCK_PHASE"."ID";


--
-- Name: MAHNUNG; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."MAHNUNG" (
    "ID" integer NOT NULL,
    "TENANT_ID" integer DEFAULT public.current_tenant_id() NOT NULL,
    "INVOICE_ID" integer,
    "PP_ID" integer,
    "MAHNSTUFE" integer DEFAULT 0 NOT NULL,
    "LAST_MAHNUNG_DATE" date,
    "NEXT_MAHNUNG_DATE" date,
    "RESPONSIBLE_EMPLOYEE_ID" integer,
    "IS_CLOSED" boolean DEFAULT false NOT NULL,
    "CLOSE_REASON" text,
    "IN_KLAERUNG" boolean DEFAULT false NOT NULL,
    "NOTES" text,
    "CREATED_AT" timestamp with time zone DEFAULT now() NOT NULL,
    "UPDATED_AT" timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT chk_mahnung_source CHECK (((("INVOICE_ID" IS NOT NULL) AND ("PP_ID" IS NULL)) OR (("INVOICE_ID" IS NULL) AND ("PP_ID" IS NOT NULL))))
);

ALTER TABLE ONLY public."MAHNUNG" FORCE ROW LEVEL SECURITY;


--
-- Name: MAHNUNG_HISTORY; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."MAHNUNG_HISTORY" (
    "ID" integer NOT NULL,
    "TENANT_ID" integer DEFAULT public.current_tenant_id() NOT NULL,
    "MAHNUNG_ID" integer NOT NULL,
    "MAHNSTUFE" integer NOT NULL,
    "DATE_ACTION" timestamp with time zone DEFAULT now() NOT NULL,
    "EMPLOYEE_ID" integer,
    "EMAIL_TO" text,
    "EMAIL_SUBJECT" text,
    "EMAIL_SENT" boolean DEFAULT false NOT NULL,
    "FEE_AMOUNT" numeric(12,4) DEFAULT 0 NOT NULL,
    "NOTES" text
);

ALTER TABLE ONLY public."MAHNUNG_HISTORY" FORCE ROW LEVEL SECURITY;


--
-- Name: MAHNUNG_HISTORY_ID_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public."MAHNUNG_HISTORY_ID_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: MAHNUNG_HISTORY_ID_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public."MAHNUNG_HISTORY_ID_seq" OWNED BY public."MAHNUNG_HISTORY"."ID";


--
-- Name: MAHNUNG_ID_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public."MAHNUNG_ID_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: MAHNUNG_ID_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public."MAHNUNG_ID_seq" OWNED BY public."MAHNUNG"."ID";


--
-- Name: MAHNUNG_SETTINGS; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."MAHNUNG_SETTINGS" (
    "ID" integer NOT NULL,
    "TENANT_ID" integer DEFAULT public.current_tenant_id() NOT NULL,
    "MAHNSTUFE" integer NOT NULL,
    "LABEL" text NOT NULL,
    "DAYS_AFTER_DUE" integer DEFAULT 7 NOT NULL,
    "DAYS_AFTER_PREV" integer DEFAULT 14 NOT NULL,
    "FEE" numeric(10,2) DEFAULT 0 NOT NULL,
    "HEADER_TEXT" text,
    "FOOTER_TEXT" text,
    CONSTRAINT "MAHNUNG_SETTINGS_MAHNSTUFE_check" CHECK ((("MAHNSTUFE" >= 1) AND ("MAHNSTUFE" <= 4)))
);

ALTER TABLE ONLY public."MAHNUNG_SETTINGS" FORCE ROW LEVEL SECURITY;


--
-- Name: MAHNUNG_SETTINGS_ID_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public."MAHNUNG_SETTINGS_ID_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: MAHNUNG_SETTINGS_ID_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public."MAHNUNG_SETTINGS_ID_seq" OWNED BY public."MAHNUNG_SETTINGS"."ID";


--
-- Name: NACHTRAG; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."NACHTRAG" (
    "ID" bigint NOT NULL,
    "TENANT_ID" bigint DEFAULT public.current_tenant_id(),
    "PROJECT_ID" bigint NOT NULL,
    "CONTRACT_ID" bigint,
    "OFFER_ID" bigint,
    "NAME_SHORT" text,
    "NAME_LONG" text NOT NULL,
    "NACHTRAG_TYPE" text DEFAULT 'OWN'::text,
    "NACHTRAG_STATUS_ID" bigint,
    "CATEGORY" text,
    "CLAIM_BASIS" text,
    "REASON" text,
    "IS_GRANTED_BASIS" boolean DEFAULT false,
    "EMPLOYEE_ID" bigint,
    "ADDRESS_ID" bigint,
    "CONTACT_ID" bigint,
    "COMPANY_ID" bigint,
    "VAT_ID" bigint,
    "ANNOUNCED_DATE" date,
    "SUBMITTED_DATE" date,
    "REVIEW_DUE_DATE" date,
    "DECISION_DATE" date,
    "AMOUNT_CLAIMED_NET" numeric DEFAULT 0,
    "AMOUNT_APPROVED_NET" numeric DEFAULT 0,
    "SURCHARGE_1_LABEL" text,
    "SURCHARGE_1_PCT" numeric,
    "SURCHARGE_1_EUR" numeric DEFAULT 0,
    "SURCHARGE_1_CUMUL" boolean DEFAULT true,
    "SURCHARGE_2_LABEL" text,
    "SURCHARGE_2_PCT" numeric,
    "SURCHARGE_2_EUR" numeric DEFAULT 0,
    "SURCHARGE_2_CUMUL" boolean DEFAULT true,
    "SURCHARGE_3_LABEL" text,
    "SURCHARGE_3_PCT" numeric,
    "SURCHARGE_3_EUR" numeric DEFAULT 0,
    "SURCHARGE_3_CUMUL" boolean DEFAULT true,
    "SURCHARGES_TOTAL" numeric DEFAULT 0,
    "CREATED_AT" timestamp with time zone DEFAULT now(),
    "REVIEW_FORMAL" boolean DEFAULT false,
    "REVIEW_CONTENT" boolean DEFAULT false,
    "REVIEW_CALCULATION" boolean DEFAULT false,
    "REVIEW_NOTE" text,
    "REVIEW_RECOMMENDATION" text,
    "REVIEWED_AT" timestamp with time zone,
    "REVIEWED_BY" bigint
);

ALTER TABLE ONLY public."NACHTRAG" FORCE ROW LEVEL SECURITY;


--
-- Name: NACHTRAG_AUDIT; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."NACHTRAG_AUDIT" (
    "ID" bigint NOT NULL,
    "TENANT_ID" bigint DEFAULT public.current_tenant_id(),
    "NACHTRAG_ID" bigint NOT NULL,
    "EVENT_TYPE" text NOT NULL,
    "ACTOR_ID" bigint,
    "DETAILS" jsonb,
    "CREATED_AT" timestamp with time zone DEFAULT now()
);

ALTER TABLE ONLY public."NACHTRAG_AUDIT" FORCE ROW LEVEL SECURITY;


--
-- Name: NACHTRAG_AUDIT_ID_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public."NACHTRAG_AUDIT" ALTER COLUMN "ID" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public."NACHTRAG_AUDIT_ID_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: NACHTRAG_ID_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public."NACHTRAG" ALTER COLUMN "ID" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public."NACHTRAG_ID_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: NACHTRAG_RELEASE; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."NACHTRAG_RELEASE" (
    "ID" bigint NOT NULL,
    "TENANT_ID" bigint DEFAULT public.current_tenant_id(),
    "NACHTRAG_ID" bigint NOT NULL,
    "RELEASE_NO" integer NOT NULL,
    "RELEASE_KIND" text DEFAULT 'PARTIAL'::text,
    "RELEASE_BASIS" text,
    "AMOUNT_NET" numeric DEFAULT 0,
    "RELEASED_BY" bigint,
    "RELEASED_AT" timestamp with time zone DEFAULT now(),
    "NOTE" text
);

ALTER TABLE ONLY public."NACHTRAG_RELEASE" FORCE ROW LEVEL SECURITY;


--
-- Name: NACHTRAG_RELEASE_ID_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public."NACHTRAG_RELEASE" ALTER COLUMN "ID" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public."NACHTRAG_RELEASE_ID_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: NACHTRAG_STATUS; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."NACHTRAG_STATUS" (
    "ID" bigint NOT NULL,
    "CODE" text NOT NULL,
    "NAME_SHORT" text NOT NULL,
    "SORT_ORDER" integer DEFAULT 0,
    "IS_TERMINAL" boolean DEFAULT false,
    "ALLOWS_RELEASE" boolean DEFAULT false
);


--
-- Name: NACHTRAG_STATUS_ID_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public."NACHTRAG_STATUS" ALTER COLUMN "ID" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public."NACHTRAG_STATUS_ID_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: NACHTRAG_STRUCTURE; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."NACHTRAG_STRUCTURE" (
    "ID" bigint NOT NULL,
    "NAME_SHORT" text,
    "NAME_LONG" text,
    "NACHTRAG_ID" bigint NOT NULL,
    "FATHER_ID" bigint,
    "TENANT_ID" bigint DEFAULT public.current_tenant_id(),
    "SORT_ORDER" integer DEFAULT 0,
    "BILLING_TYPE_ID" bigint,
    "REVENUE_BASIS" numeric DEFAULT 0,
    "REVENUE" numeric DEFAULT 0,
    "EXTRAS_PERCENT" numeric DEFAULT 0,
    "EXTRAS" numeric DEFAULT 0,
    "QUANTITY" numeric,
    "SP_RATE" numeric,
    "ROLE_NAME_SHORT" text,
    "ROLE_NAME_LONG" text,
    "ROLE_ID" bigint,
    "SURCHARGE_1_LABEL" text,
    "SURCHARGE_1_PCT" numeric,
    "SURCHARGE_1_EUR" numeric DEFAULT 0,
    "SURCHARGE_1_CUMUL" boolean DEFAULT true,
    "SURCHARGE_2_LABEL" text,
    "SURCHARGE_2_PCT" numeric,
    "SURCHARGE_2_EUR" numeric DEFAULT 0,
    "SURCHARGE_2_CUMUL" boolean DEFAULT true,
    "SURCHARGE_3_LABEL" text,
    "SURCHARGE_3_PCT" numeric,
    "SURCHARGE_3_EUR" numeric DEFAULT 0,
    "SURCHARGE_3_CUMUL" boolean DEFAULT true,
    "SURCHARGES_TOTAL" numeric DEFAULT 0,
    "APPROVAL_STATE" text DEFAULT 'OPEN'::text,
    "APPROVED_AMOUNT_NET" numeric,
    "RELEASED_STRUCTURE_ID" bigint
);

ALTER TABLE ONLY public."NACHTRAG_STRUCTURE" FORCE ROW LEVEL SECURITY;


--
-- Name: NACHTRAG_STRUCTURE_ID_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public."NACHTRAG_STRUCTURE" ALTER COLUMN "ID" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public."NACHTRAG_STRUCTURE_ID_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: NOTIFICATION; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."NOTIFICATION" (
    "ID" bigint NOT NULL,
    "TENANT_ID" integer DEFAULT public.current_tenant_id() NOT NULL,
    "USER_ID" text,
    "TYPE" text NOT NULL,
    "TITLE" text NOT NULL,
    "BODY" text,
    "LINK" text,
    "METADATA" jsonb,
    "READ_AT" timestamp with time zone,
    "CREATED_AT" timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public."NOTIFICATION" FORCE ROW LEVEL SECURITY;


--
-- Name: NOTIFICATION_ID_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public."NOTIFICATION_ID_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: NOTIFICATION_ID_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public."NOTIFICATION_ID_seq" OWNED BY public."NOTIFICATION"."ID";


--
-- Name: NOTIFICATION_SCHEDULE_CONFIG; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."NOTIFICATION_SCHEDULE_CONFIG" (
    "ID" integer NOT NULL,
    "TENANT_ID" integer DEFAULT public.current_tenant_id() NOT NULL,
    "TYPE_KEY" text NOT NULL,
    "ENABLED" boolean DEFAULT true NOT NULL,
    "SCHEDULE_DAYS" integer[],
    "SCHEDULE_LAST_DAY" boolean DEFAULT false NOT NULL,
    "NOTIFY_PROJECT_PM" boolean DEFAULT true NOT NULL,
    "PROJECT_STATUS_IDS" integer[],
    "AUDIENCE_ROLES" text[],
    "AUDIENCE_DEPARTMENTS" integer[],
    "AUDIENCE_EMPLOYEES" integer[],
    "LAST_FIRED_DATE" date,
    "CREATED_AT" timestamp with time zone DEFAULT now() NOT NULL,
    "UPDATED_AT" timestamp with time zone DEFAULT now() NOT NULL,
    "UPDATED_BY" integer,
    "SCHEDULE_TIME_OF_DAY" time without time zone,
    "PM_NOTIFY_MODE" text DEFAULT 'per_project'::text NOT NULL,
    CONSTRAINT chk_notif_schedule_pm_mode CHECK (("PM_NOTIFY_MODE" = ANY (ARRAY['per_project'::text, 'summary'::text])))
);

ALTER TABLE ONLY public."NOTIFICATION_SCHEDULE_CONFIG" FORCE ROW LEVEL SECURITY;


--
-- Name: NOTIFICATION_SCHEDULE_CONFIG_ID_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public."NOTIFICATION_SCHEDULE_CONFIG_ID_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: NOTIFICATION_SCHEDULE_CONFIG_ID_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public."NOTIFICATION_SCHEDULE_CONFIG_ID_seq" OWNED BY public."NOTIFICATION_SCHEDULE_CONFIG"."ID";


--
-- Name: NOTIFICATION_TYPE; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."NOTIFICATION_TYPE" (
    "TYPE_KEY" text NOT NULL,
    "CATEGORY" text NOT NULL,
    "TITLE_DE" text NOT NULL,
    "DESCRIPTION_DE" text,
    "DEFAULT_ENABLED" boolean DEFAULT true NOT NULL,
    "DEFAULT_AUDIENCE_KIND" text DEFAULT 'tenant_wide'::text NOT NULL,
    "SUPPORTS_AUDIENCE_OVERRIDE" boolean DEFAULT true NOT NULL,
    "SORT_ORDER" integer DEFAULT 0 NOT NULL,
    CONSTRAINT chk_default_audience_kind CHECK (("DEFAULT_AUDIENCE_KIND" = ANY (ARRAY['tenant_wide'::text, 'managed_by_rule'::text])))
);


--
-- Name: NOTIFICATION_TYPE_CONFIG; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."NOTIFICATION_TYPE_CONFIG" (
    "ID" integer NOT NULL,
    "TENANT_ID" integer DEFAULT public.current_tenant_id() NOT NULL,
    "TYPE_KEY" text NOT NULL,
    "ENABLED" boolean DEFAULT true NOT NULL,
    "AUDIENCE_USE_DEFAULT" boolean DEFAULT true NOT NULL,
    "AUDIENCE_ALL_TENANT" boolean DEFAULT false NOT NULL,
    "AUDIENCE_ROLES" text[],
    "AUDIENCE_DEPARTMENTS" integer[],
    "AUDIENCE_EMPLOYEES" integer[],
    "CREATED_AT" timestamp with time zone DEFAULT now() NOT NULL,
    "UPDATED_AT" timestamp with time zone DEFAULT now() NOT NULL,
    "UPDATED_BY" integer
);

ALTER TABLE ONLY public."NOTIFICATION_TYPE_CONFIG" FORCE ROW LEVEL SECURITY;


--
-- Name: NOTIFICATION_TYPE_CONFIG_ID_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public."NOTIFICATION_TYPE_CONFIG_ID_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: NOTIFICATION_TYPE_CONFIG_ID_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public."NOTIFICATION_TYPE_CONFIG_ID_seq" OWNED BY public."NOTIFICATION_TYPE_CONFIG"."ID";


--
-- Name: NUMBER_RANGE_TEMPLATE; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."NUMBER_RANGE_TEMPLATE" (
    "ID" integer NOT NULL,
    "TENANT_ID" integer DEFAULT public.current_tenant_id() NOT NULL,
    "COMPANY_ID" bigint NOT NULL,
    "DOC_TYPE" character varying(20) NOT NULL,
    "TEMPLATE" text NOT NULL,
    "UPDATED_AT" timestamp with time zone DEFAULT now() NOT NULL,
    "UPDATED_BY" integer
);

ALTER TABLE ONLY public."NUMBER_RANGE_TEMPLATE" FORCE ROW LEVEL SECURITY;


--
-- Name: NUMBER_RANGE_TEMPLATE_ID_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public."NUMBER_RANGE_TEMPLATE_ID_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: NUMBER_RANGE_TEMPLATE_ID_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public."NUMBER_RANGE_TEMPLATE_ID_seq" OWNED BY public."NUMBER_RANGE_TEMPLATE"."ID";


--
-- Name: OFFER; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."OFFER" (
    "ID" bigint NOT NULL,
    "NAME_SHORT" text,
    "NAME_LONG" text NOT NULL,
    "EMPLOYEE_ID" bigint,
    "PROBABILITY" numeric,
    "OFFER_TEXT_1" text,
    "OFFER_TEXT_2" text,
    "ADDRESS_ID" bigint,
    "CONTACT_ID" bigint,
    "OFFER_STATUS_ID" bigint,
    "COMPANY_ID" bigint,
    "TENANT_ID" bigint DEFAULT public.current_tenant_id(),
    "CREATED_AT" timestamp with time zone DEFAULT now(),
    "OFFER_DATE" date,
    "VALID_UNTIL" date,
    "PROJECT_ID" bigint,
    "ORDER_DATE" date,
    "REFUSAL_DATE" date,
    "VAT_ID" bigint,
    "SURCHARGE_1_LABEL" text,
    "SURCHARGE_1_PCT" numeric(9,4),
    "SURCHARGE_1_EUR" numeric(14,4),
    "SURCHARGE_1_CUMUL" boolean DEFAULT true NOT NULL,
    "SURCHARGE_2_LABEL" text,
    "SURCHARGE_2_PCT" numeric(9,4),
    "SURCHARGE_2_EUR" numeric(14,4),
    "SURCHARGE_2_CUMUL" boolean DEFAULT true NOT NULL,
    "SURCHARGE_3_LABEL" text,
    "SURCHARGE_3_PCT" numeric(9,4),
    "SURCHARGE_3_EUR" numeric(14,4),
    "SURCHARGE_3_CUMUL" boolean DEFAULT true NOT NULL,
    "SURCHARGES_TOTAL" numeric(14,4) DEFAULT 0 NOT NULL
);

ALTER TABLE ONLY public."OFFER" FORCE ROW LEVEL SECURITY;


--
-- Name: OFFER_ID_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public."OFFER" ALTER COLUMN "ID" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public."OFFER_ID_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: OFFER_STATUS; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."OFFER_STATUS" (
    "ID" bigint NOT NULL,
    "NAME_SHORT" text NOT NULL
);


--
-- Name: OFFER_STATUS_ID_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public."OFFER_STATUS" ALTER COLUMN "ID" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public."OFFER_STATUS_ID_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: OFFER_STRUCTURE; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."OFFER_STRUCTURE" (
    "ID" bigint NOT NULL,
    "NAME_SHORT" text,
    "NAME_LONG" text,
    "OFFER_ID" bigint NOT NULL,
    "REVENUE" numeric DEFAULT 0,
    "EXTRAS_PERCENT" numeric DEFAULT 0,
    "EXTRAS" numeric DEFAULT 0,
    "BILLING_TYPE_ID" bigint,
    "FATHER_ID" bigint,
    "TENANT_ID" bigint DEFAULT public.current_tenant_id(),
    "SORT_ORDER" integer DEFAULT 0,
    "QUANTITY" numeric,
    "SP_RATE" numeric,
    "ROLE_NAME_SHORT" text,
    "ROLE_NAME_LONG" text,
    "ROLE_ID" bigint,
    "REVENUE_BASIS" numeric(14,4),
    "SURCHARGE_1_LABEL" text,
    "SURCHARGE_1_PCT" numeric(9,4),
    "SURCHARGE_1_EUR" numeric(14,4),
    "SURCHARGE_1_CUMUL" boolean DEFAULT true NOT NULL,
    "SURCHARGE_2_LABEL" text,
    "SURCHARGE_2_PCT" numeric(9,4),
    "SURCHARGE_2_EUR" numeric(14,4),
    "SURCHARGE_2_CUMUL" boolean DEFAULT true NOT NULL,
    "SURCHARGE_3_LABEL" text,
    "SURCHARGE_3_PCT" numeric(9,4),
    "SURCHARGE_3_EUR" numeric(14,4),
    "SURCHARGE_3_CUMUL" boolean DEFAULT true NOT NULL,
    "SURCHARGES_TOTAL" numeric(14,4) DEFAULT 0 NOT NULL
);

ALTER TABLE ONLY public."OFFER_STRUCTURE" FORCE ROW LEVEL SECURITY;


--
-- Name: OFFER_STRUCTURE_ID_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public."OFFER_STRUCTURE" ALTER COLUMN "ID" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public."OFFER_STRUCTURE_ID_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: PARTIAL_PAYMENT_ID_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public."PARTIAL_PAYMENT" ALTER COLUMN "ID" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME public."PARTIAL_PAYMENT_ID_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: PARTIAL_PAYMENT_STRUCTURE; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."PARTIAL_PAYMENT_STRUCTURE" (
    "ID" bigint NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    "PARTIAL_PAYMENT_ID" bigint,
    "AMOUNT_NET" numeric,
    "AMOUNT_EXTRAS_NET" numeric,
    "STRUCTURE_ID" bigint,
    "TENANT_ID" bigint DEFAULT public.current_tenant_id(),
    "INVOICE_ID" bigint,
    "IMPORT_BATCH_ID" integer
);

ALTER TABLE ONLY public."PARTIAL_PAYMENT_STRUCTURE" FORCE ROW LEVEL SECURITY;


--
-- Name: PARTIAL_PAYMENT_STRUCTURE_ID_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public."PARTIAL_PAYMENT_STRUCTURE" ALTER COLUMN "ID" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME public."PARTIAL_PAYMENT_STRUCTURE_ID_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: PAYMENT_MEANS; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."PAYMENT_MEANS" (
    "ID" bigint NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    "NAME_SHORT" character varying,
    "NAME_LONG" character varying,
    "TENANT_ID" bigint DEFAULT public.current_tenant_id()
);

ALTER TABLE ONLY public."PAYMENT_MEANS" FORCE ROW LEVEL SECURITY;


--
-- Name: PAYMENT_MEANS_ID_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public."PAYMENT_MEANS" ALTER COLUMN "ID" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME public."PAYMENT_MEANS_ID_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: PAYMENT_STRUCTURE; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."PAYMENT_STRUCTURE" (
    "ID" bigint NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    "PARTIAL_PAYMENT_ID" bigint,
    "INVOICE_ID" bigint,
    "AMOUNT_PAYED_NET" numeric,
    "AMOUNT_PAYED_EXTRAS_NET" numeric,
    "PAYMENT_ID" bigint,
    "TENANT_ID" bigint DEFAULT public.current_tenant_id(),
    "STRUCTURE_ID" bigint,
    "IMPORT_BATCH_ID" integer
);

ALTER TABLE ONLY public."PAYMENT_STRUCTURE" FORCE ROW LEVEL SECURITY;


--
-- Name: PAYMENT_STRUCTURE_ID_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public."PAYMENT_STRUCTURE" ALTER COLUMN "ID" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME public."PAYMENT_STRUCTURE_ID_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: PAYMENT_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public."PAYMENT" ALTER COLUMN "ID" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME public."PAYMENT_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: PERMISSION; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."PERMISSION" (
    "ID" integer NOT NULL,
    "KEY" character varying(100) NOT NULL,
    "MODULE" character varying(50) NOT NULL,
    "ACTION" character varying(50) NOT NULL,
    "LABEL_DE" text NOT NULL,
    "DESCRIPTION_DE" text,
    "CATEGORY" character varying(50),
    "POSITION" integer DEFAULT 0 NOT NULL
);


--
-- Name: PERMISSION_ID_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public."PERMISSION_ID_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: PERMISSION_ID_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public."PERMISSION_ID_seq" OWNED BY public."PERMISSION"."ID";


--
-- Name: PLAN_CAPABILITY; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."PLAN_CAPABILITY" (
    "PLAN_ID" integer NOT NULL,
    "CAPABILITY_KEY" character varying(100) NOT NULL,
    "NUMERIC_LIMIT" integer
);


--
-- Name: PLATFORM_ADMIN; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."PLATFORM_ADMIN" (
    "ID" integer NOT NULL,
    "EMAIL" character varying(255) NOT NULL,
    "PASSWORD_HASH" text NOT NULL,
    "TOTP_SECRET" text,
    "IS_ACTIVE" boolean DEFAULT true NOT NULL,
    "LAST_LOGIN_AT" timestamp with time zone,
    "CREATED_AT" timestamp with time zone DEFAULT now() NOT NULL,
    "SESSION_EPOCH" timestamp with time zone DEFAULT now() NOT NULL,
    "TOTP_PENDING_SECRET" text
);


--
-- Name: PLATFORM_ADMIN_ID_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public."PLATFORM_ADMIN_ID_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: PLATFORM_ADMIN_ID_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public."PLATFORM_ADMIN_ID_seq" OWNED BY public."PLATFORM_ADMIN"."ID";


--
-- Name: PLATFORM_EMAIL_SETTINGS; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."PLATFORM_EMAIL_SETTINGS" (
    "ID" integer NOT NULL,
    "SMTP_HOST" text,
    "SMTP_PORT" integer DEFAULT 465 NOT NULL,
    "SMTP_SECURE" boolean DEFAULT true NOT NULL,
    "SMTP_USER" text,
    "SMTP_PASS_ENC" text,
    "SMTP_FROM" text,
    "FROM_NAME" text,
    "UPDATED_AT" timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: PLATFORM_EMAIL_SETTINGS_ID_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public."PLATFORM_EMAIL_SETTINGS_ID_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: PLATFORM_EMAIL_SETTINGS_ID_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public."PLATFORM_EMAIL_SETTINGS_ID_seq" OWNED BY public."PLATFORM_EMAIL_SETTINGS"."ID";


--
-- Name: PORTAL_CONSENT; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."PORTAL_CONSENT" (
    "ID" integer NOT NULL,
    "TENANT_ID" integer DEFAULT public.current_tenant_id() NOT NULL,
    "EMPLOYEE_ID" integer NOT NULL,
    "DOC_VERSION" text NOT NULL,
    "ACCEPTED_AT" timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public."PORTAL_CONSENT" FORCE ROW LEVEL SECURITY;


--
-- Name: PORTAL_CONSENT_ID_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public."PORTAL_CONSENT_ID_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: PORTAL_CONSENT_ID_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public."PORTAL_CONSENT_ID_seq" OWNED BY public."PORTAL_CONSENT"."ID";


--
-- Name: PROJECT_BOOKING_PRICE; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."PROJECT_BOOKING_PRICE" (
    "ID" integer NOT NULL,
    "TENANT_ID" integer DEFAULT public.current_tenant_id() NOT NULL,
    "PROJECT_ID" integer NOT NULL,
    "BOOKING_TYPE_ID" integer NOT NULL,
    "SP_RATE" numeric,
    "CP_RATE" numeric
);

ALTER TABLE ONLY public."PROJECT_BOOKING_PRICE" FORCE ROW LEVEL SECURITY;


--
-- Name: PROJECT_BOOKING_PRICE_ID_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public."PROJECT_BOOKING_PRICE_ID_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: PROJECT_BOOKING_PRICE_ID_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public."PROJECT_BOOKING_PRICE_ID_seq" OWNED BY public."PROJECT_BOOKING_PRICE"."ID";


--
-- Name: PROJECT_PROGRESS_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public."PROJECT_PROGRESS" ALTER COLUMN "ID" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME public."PROJECT_PROGRESS_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: PROJECT_SP_RATES; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."PROJECT_SP_RATES" (
    "ID" bigint NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    "PROJECT_ID" bigint,
    "ROLE_ID" bigint,
    "SP_RATE" numeric,
    "TENANT_ID" bigint DEFAULT public.current_tenant_id()
);

ALTER TABLE ONLY public."PROJECT_SP_RATES" FORCE ROW LEVEL SECURITY;


--
-- Name: PROJECT_SP_ID_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public."PROJECT_SP_RATES" ALTER COLUMN "ID" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME public."PROJECT_SP_ID_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: PROJECT_STATUS; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."PROJECT_STATUS" (
    "ID" bigint NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    "NAME_SHORT" character varying
);


--
-- Name: PROJECT_STATUS_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public."PROJECT_STATUS" ALTER COLUMN "ID" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME public."PROJECT_STATUS_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: PROJECT_STRUCTURE_ID_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public."PROJECT_STRUCTURE" ALTER COLUMN "ID" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME public."PROJECT_STRUCTURE_ID_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: PROJECT_TYPE; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."PROJECT_TYPE" (
    "ID" bigint NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    "NAME_SHORT" character varying,
    "TENANT_ID" bigint DEFAULT public.current_tenant_id()
);

ALTER TABLE ONLY public."PROJECT_TYPE" FORCE ROW LEVEL SECURITY;


--
-- Name: PROJECT_TYPE_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public."PROJECT_TYPE" ALTER COLUMN "ID" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME public."PROJECT_TYPE_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: PROJECT_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public."PROJECT" ALTER COLUMN "ID" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME public."PROJECT_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: PUBLIC_HOLIDAY; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."PUBLIC_HOLIDAY" (
    "ID" integer NOT NULL,
    "COUNTRY_CODE" text NOT NULL,
    "STATE_CODE" text,
    "NAME" text NOT NULL,
    "HOLIDAY_DATE" date NOT NULL
);


--
-- Name: PUBLIC_HOLIDAY_ID_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public."PUBLIC_HOLIDAY_ID_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: PUBLIC_HOLIDAY_ID_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public."PUBLIC_HOLIDAY_ID_seq" OWNED BY public."PUBLIC_HOLIDAY"."ID";


--
-- Name: PUSH_SUBSCRIPTION; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."PUSH_SUBSCRIPTION" (
    "ID" bigint NOT NULL,
    "TENANT_ID" integer DEFAULT public.current_tenant_id() NOT NULL,
    "USER_ID" text NOT NULL,
    "ENDPOINT" text NOT NULL,
    "P256DH" text NOT NULL,
    "AUTH" text NOT NULL,
    "USER_AGENT" text,
    "CREATED_AT" timestamp with time zone DEFAULT now() NOT NULL,
    "LAST_USED_AT" timestamp with time zone
);

ALTER TABLE ONLY public."PUSH_SUBSCRIPTION" FORCE ROW LEVEL SECURITY;


--
-- Name: PUSH_SUBSCRIPTION_ID_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public."PUSH_SUBSCRIPTION_ID_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: PUSH_SUBSCRIPTION_ID_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public."PUSH_SUBSCRIPTION_ID_seq" OWNED BY public."PUSH_SUBSCRIPTION"."ID";


--
-- Name: PUSH_TOKEN; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."PUSH_TOKEN" (
    "ID" integer NOT NULL,
    "TENANT_ID" integer DEFAULT public.current_tenant_id() NOT NULL,
    "EMPLOYEE_ID" integer NOT NULL,
    "PLATFORM" text NOT NULL,
    "TOKEN" text NOT NULL,
    "DEVICE_NAME" text,
    "CREATED_AT" timestamp with time zone DEFAULT now() NOT NULL,
    "LAST_SEEN_AT" timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT chk_push_platform CHECK (("PLATFORM" = ANY (ARRAY['android'::text, 'ios'::text, 'web'::text])))
);

ALTER TABLE ONLY public."PUSH_TOKEN" FORCE ROW LEVEL SECURITY;


--
-- Name: PUSH_TOKEN_ID_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public."PUSH_TOKEN_ID_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: PUSH_TOKEN_ID_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public."PUSH_TOKEN_ID_seq" OWNED BY public."PUSH_TOKEN"."ID";


--
-- Name: RECENT_VIEW; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."RECENT_VIEW" (
    "ID" integer NOT NULL,
    "TENANT_ID" integer DEFAULT public.current_tenant_id() NOT NULL,
    "EMPLOYEE_ID" integer NOT NULL,
    "ENTITY_TYPE" character varying(40) NOT NULL,
    "ENTITY_ID" integer NOT NULL,
    "LABEL" character varying(200),
    "LAST_SEEN" timestamp with time zone DEFAULT now() NOT NULL,
    "VIEW_COUNT" integer DEFAULT 1 NOT NULL,
    "META" jsonb
);

ALTER TABLE ONLY public."RECENT_VIEW" FORCE ROW LEVEL SECURITY;


--
-- Name: RECENT_VIEW_ID_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public."RECENT_VIEW_ID_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: RECENT_VIEW_ID_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public."RECENT_VIEW_ID_seq" OWNED BY public."RECENT_VIEW"."ID";


--
-- Name: ROLE; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."ROLE" (
    "ID" bigint NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    "NAME_SHORT" character varying,
    "NAME_LONG" character varying,
    "ACTIVE" bigint,
    "TENANT_ID" bigint DEFAULT public.current_tenant_id(),
    "SP_RATE" numeric
);

ALTER TABLE ONLY public."ROLE" FORCE ROW LEVEL SECURITY;


--
-- Name: ROLE_ID_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public."ROLE" ALTER COLUMN "ID" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME public."ROLE_ID_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: ROLE_PERMISSION; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."ROLE_PERMISSION" (
    "ROLE_ID" integer NOT NULL,
    "PERMISSION_ID" integer NOT NULL
);


--
-- Name: SALUTATION; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."SALUTATION" (
    "ID" bigint NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    "SALUTATION" character varying
);


--
-- Name: SALUTATION_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public."SALUTATION" ALTER COLUMN "ID" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME public."SALUTATION_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: SERVICE_REQUEST; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."SERVICE_REQUEST" (
    "ID" integer NOT NULL,
    "TENANT_ID" integer DEFAULT public.current_tenant_id() NOT NULL,
    "EMPLOYEE_ID" integer NOT NULL,
    "KIND" text NOT NULL,
    "CATEGORY" text,
    "SUBJECT" text NOT NULL,
    "BODY" text NOT NULL,
    "CONTACT_NAME" text,
    "CONTACT_EMAIL" text,
    "WANTS_REPLY" boolean DEFAULT true NOT NULL,
    "URGENCY" text,
    "STATUS" text DEFAULT 'new'::text NOT NULL,
    "JIRA_ISSUE_KEY" text,
    "CREATED_AT" timestamp with time zone DEFAULT now() NOT NULL,
    "UPDATED_AT" timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public."SERVICE_REQUEST" FORCE ROW LEVEL SECURITY;


--
-- Name: SERVICE_REQUEST_ATTACHMENT; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."SERVICE_REQUEST_ATTACHMENT" (
    "ID" integer NOT NULL,
    "REQUEST_ID" integer NOT NULL,
    "TENANT_ID" integer DEFAULT public.current_tenant_id() NOT NULL,
    "STORAGE_KEY" text NOT NULL,
    "FILENAME" text,
    "MIME_TYPE" text,
    "SIZE_BYTES" integer,
    "CREATED_BY" integer,
    "CREATED_AT" timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public."SERVICE_REQUEST_ATTACHMENT" FORCE ROW LEVEL SECURITY;


--
-- Name: SERVICE_REQUEST_ATTACHMENT_ID_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public."SERVICE_REQUEST_ATTACHMENT_ID_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: SERVICE_REQUEST_ATTACHMENT_ID_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public."SERVICE_REQUEST_ATTACHMENT_ID_seq" OWNED BY public."SERVICE_REQUEST_ATTACHMENT"."ID";


--
-- Name: SERVICE_REQUEST_ID_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public."SERVICE_REQUEST_ID_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: SERVICE_REQUEST_ID_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public."SERVICE_REQUEST_ID_seq" OWNED BY public."SERVICE_REQUEST"."ID";


--
-- Name: SERVICE_REQUEST_MESSAGE; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."SERVICE_REQUEST_MESSAGE" (
    "ID" integer NOT NULL,
    "REQUEST_ID" integer NOT NULL,
    "AUTHOR_KIND" text DEFAULT 'user'::text NOT NULL,
    "EMPLOYEE_ID" integer,
    "BODY" text NOT NULL,
    "CREATED_AT" timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: SERVICE_REQUEST_MESSAGE_ID_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public."SERVICE_REQUEST_MESSAGE_ID_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: SERVICE_REQUEST_MESSAGE_ID_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public."SERVICE_REQUEST_MESSAGE_ID_seq" OWNED BY public."SERVICE_REQUEST_MESSAGE"."ID";


--
-- Name: SE_RELEASE; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."SE_RELEASE" (
    "ID" integer NOT NULL,
    "TENANT_ID" integer DEFAULT public.current_tenant_id() NOT NULL,
    "PARTIAL_PAYMENT_ID" integer NOT NULL,
    "INVOICE_ID" integer NOT NULL,
    "SE_AMOUNT_RELEASED" numeric(14,2) NOT NULL,
    "RELEASED_AT" timestamp with time zone DEFAULT now() NOT NULL,
    "CREATED_AT" timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public."SE_RELEASE" FORCE ROW LEVEL SECURITY;


--
-- Name: SE_RELEASE_ID_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public."SE_RELEASE_ID_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: SE_RELEASE_ID_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public."SE_RELEASE_ID_seq" OWNED BY public."SE_RELEASE"."ID";


--
-- Name: SUGGESTION; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."SUGGESTION" (
    "ID" integer NOT NULL,
    "TENANT_ID" integer DEFAULT public.current_tenant_id() NOT NULL,
    "EMPLOYEE_ID" integer NOT NULL,
    "TITLE" text NOT NULL,
    "BODY" text NOT NULL,
    "PUBLIC_TITLE" text,
    "PUBLIC_BODY" text,
    "CATEGORY" text,
    "PRIORITY_HINT" text,
    "MODERATION_STATE" text DEFAULT 'pending'::text NOT NULL,
    "LIFECYCLE_STATUS" text DEFAULT 'new'::text NOT NULL,
    "MERGED_INTO_ID" integer,
    "VOTE_COUNT" integer DEFAULT 0 NOT NULL,
    "JIRA_ISSUE_KEY" text,
    "CREATED_AT" timestamp with time zone DEFAULT now() NOT NULL,
    "UPDATED_AT" timestamp with time zone DEFAULT now() NOT NULL,
    "PUBLISHED_AT" timestamp with time zone,
    "ORG_STATE" text DEFAULT 'draft'::text NOT NULL,
    "ORG_RELEASED_AT" timestamp with time zone,
    "ORG_RELEASED_BY" integer,
    "ORG_DECIDE_REASON" text
);

ALTER TABLE ONLY public."SUGGESTION" FORCE ROW LEVEL SECURITY;


--
-- Name: COLUMN "SUGGESTION"."ORG_STATE"; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public."SUGGESTION"."ORG_STATE" IS 'Organisationsinterne Freigabe: draft | released | rejected. Nur released ist fuer plan&simple sichtbar.';


--
-- Name: SUGGESTION_ATTACHMENT; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."SUGGESTION_ATTACHMENT" (
    "ID" integer NOT NULL,
    "SUGGESTION_ID" integer NOT NULL,
    "TENANT_ID" integer DEFAULT public.current_tenant_id() NOT NULL,
    "STORAGE_KEY" text NOT NULL,
    "FILENAME" text,
    "MIME_TYPE" text,
    "SIZE_BYTES" integer,
    "CREATED_BY" integer,
    "CREATED_AT" timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public."SUGGESTION_ATTACHMENT" FORCE ROW LEVEL SECURITY;


--
-- Name: SUGGESTION_ATTACHMENT_ID_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public."SUGGESTION_ATTACHMENT_ID_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: SUGGESTION_ATTACHMENT_ID_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public."SUGGESTION_ATTACHMENT_ID_seq" OWNED BY public."SUGGESTION_ATTACHMENT"."ID";


--
-- Name: SUGGESTION_COMMENT; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."SUGGESTION_COMMENT" (
    "ID" integer NOT NULL,
    "SUGGESTION_ID" integer NOT NULL,
    "TENANT_ID" integer DEFAULT public.current_tenant_id(),
    "EMPLOYEE_ID" integer,
    "BODY" text NOT NULL,
    "AUTHOR_KIND" text DEFAULT 'user'::text NOT NULL,
    "VISIBILITY" text DEFAULT 'public'::text NOT NULL,
    "MODERATION_STATE" text DEFAULT 'pending'::text NOT NULL,
    "CREATED_AT" timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public."SUGGESTION_COMMENT" FORCE ROW LEVEL SECURITY;


--
-- Name: SUGGESTION_COMMENT_ID_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public."SUGGESTION_COMMENT_ID_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: SUGGESTION_COMMENT_ID_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public."SUGGESTION_COMMENT_ID_seq" OWNED BY public."SUGGESTION_COMMENT"."ID";


--
-- Name: SUGGESTION_ID_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public."SUGGESTION_ID_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: SUGGESTION_ID_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public."SUGGESTION_ID_seq" OWNED BY public."SUGGESTION"."ID";


--
-- Name: SUGGESTION_VOTE; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."SUGGESTION_VOTE" (
    "ID" integer NOT NULL,
    "SUGGESTION_ID" integer NOT NULL,
    "TENANT_ID" integer DEFAULT public.current_tenant_id() NOT NULL,
    "EMPLOYEE_ID" integer NOT NULL,
    "CREATED_AT" timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public."SUGGESTION_VOTE" FORCE ROW LEVEL SECURITY;


--
-- Name: SUGGESTION_VOTE_ID_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public."SUGGESTION_VOTE_ID_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: SUGGESTION_VOTE_ID_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public."SUGGESTION_VOTE_ID_seq" OWNED BY public."SUGGESTION_VOTE"."ID";


--
-- Name: TEC_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public."TEC" ALTER COLUMN "ID" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME public."TEC_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: TENANTS; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."TENANTS" (
    "ID" bigint NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    "TENANT" character varying,
    "SLUG" character varying(60),
    CONSTRAINT chk_tenants_slug_lowercase CHECK ((("SLUG" IS NULL) OR (("SLUG")::text = lower(("SLUG")::text))))
);


--
-- Name: TENANTS_ID_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public."TENANTS" ALTER COLUMN "ID" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME public."TENANTS_ID_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: TENANT_EMAIL_SETTINGS; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."TENANT_EMAIL_SETTINGS" (
    "ID" integer NOT NULL,
    "TENANT_ID" integer DEFAULT public.current_tenant_id() NOT NULL,
    "ENABLED" boolean DEFAULT false NOT NULL,
    "SMTP_FROM" text,
    "FROM_NAME" text,
    "REPLY_TO" text,
    "UPDATED_AT" timestamp with time zone DEFAULT now() NOT NULL,
    "CREATED_AT" timestamp with time zone DEFAULT now() NOT NULL,
    "BCC_TO" text
);

ALTER TABLE ONLY public."TENANT_EMAIL_SETTINGS" FORCE ROW LEVEL SECURITY;


--
-- Name: COLUMN "TENANT_EMAIL_SETTINGS"."BCC_TO"; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public."TENANT_EMAIL_SETTINGS"."BCC_TO" IS 'Optionale Blindkopie-Adresse fuer den Belegversand (Rechnungen, Mahnungen). NULL = keine Kopie.';


--
-- Name: TENANT_EMAIL_SETTINGS_ID_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public."TENANT_EMAIL_SETTINGS_ID_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: TENANT_EMAIL_SETTINGS_ID_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public."TENANT_EMAIL_SETTINGS_ID_seq" OWNED BY public."TENANT_EMAIL_SETTINGS"."ID";


--
-- Name: TENANT_ENTITLEMENT_OVERRIDE; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."TENANT_ENTITLEMENT_OVERRIDE" (
    "ID" integer NOT NULL,
    "TENANT_ID" integer DEFAULT public.current_tenant_id() NOT NULL,
    "CAPABILITY_KEY" character varying(100) NOT NULL,
    "MODE" character varying(10) NOT NULL,
    "NUMERIC_LIMIT" integer,
    "REASON" text,
    "EXPIRES_AT" timestamp with time zone,
    "CREATED_AT" timestamp with time zone DEFAULT now() NOT NULL,
    "CREATED_BY" text,
    CONSTRAINT "TENANT_ENTITLEMENT_OVERRIDE_MODE_check" CHECK ((("MODE")::text = ANY (ARRAY[('grant'::character varying)::text, ('revoke'::character varying)::text])))
);

ALTER TABLE ONLY public."TENANT_ENTITLEMENT_OVERRIDE" FORCE ROW LEVEL SECURITY;


--
-- Name: TENANT_ENTITLEMENT_OVERRIDE_ID_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public."TENANT_ENTITLEMENT_OVERRIDE_ID_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: TENANT_ENTITLEMENT_OVERRIDE_ID_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public."TENANT_ENTITLEMENT_OVERRIDE_ID_seq" OWNED BY public."TENANT_ENTITLEMENT_OVERRIDE"."ID";


--
-- Name: TENANT_LICENSE; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."TENANT_LICENSE" (
    "TENANT_ID" integer DEFAULT public.current_tenant_id() NOT NULL,
    "PLAN_ID" integer NOT NULL,
    "PLAN_VERSION" integer DEFAULT 1 NOT NULL,
    "STATE" character varying(20) DEFAULT 'active'::character varying NOT NULL,
    "STARTS_AT" timestamp with time zone DEFAULT now() NOT NULL,
    "VALID_UNTIL" timestamp with time zone,
    "TRIAL_UNTIL" timestamp with time zone,
    "GRACE_UNTIL" timestamp with time zone,
    "EXTERNAL_REF" text,
    "UPDATED_AT" timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT "TENANT_LICENSE_STATE_check" CHECK ((("STATE")::text = ANY (ARRAY[('trial'::character varying)::text, ('active'::character varying)::text, ('past_due'::character varying)::text, ('grace'::character varying)::text, ('expired'::character varying)::text])))
);

ALTER TABLE ONLY public."TENANT_LICENSE" FORCE ROW LEVEL SECURITY;


--
-- Name: TENANT_SETTINGS; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."TENANT_SETTINGS" (
    "TENANT_ID" integer DEFAULT public.current_tenant_id() NOT NULL,
    "KEY" text NOT NULL,
    "VALUE" text,
    "UPDATED_AT" timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public."TENANT_SETTINGS" FORCE ROW LEVEL SECURITY;


--
-- Name: TEXT_TEMPLATE; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."TEXT_TEMPLATE" (
    "ID" integer NOT NULL,
    "TENANT_ID" integer DEFAULT public.current_tenant_id() NOT NULL,
    "DOCUMENT_TYPE" text NOT NULL,
    "HEADER_TEXT" text,
    "FOOTER_TEXT" text
);

ALTER TABLE ONLY public."TEXT_TEMPLATE" FORCE ROW LEVEL SECURITY;


--
-- Name: TEXT_TEMPLATE_ID_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public."TEXT_TEMPLATE_ID_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: TEXT_TEMPLATE_ID_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public."TEXT_TEMPLATE_ID_seq" OWNED BY public."TEXT_TEMPLATE"."ID";


--
-- Name: USER_ACHIEVEMENT; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."USER_ACHIEVEMENT" (
    "ID" integer NOT NULL,
    "TENANT_ID" integer DEFAULT public.current_tenant_id() NOT NULL,
    "EMPLOYEE_ID" integer NOT NULL,
    "ACHIEVEMENT_KEY" character varying(60) NOT NULL,
    "EARNED_AT" timestamp with time zone DEFAULT now() NOT NULL,
    "META" jsonb
);

ALTER TABLE ONLY public."USER_ACHIEVEMENT" FORCE ROW LEVEL SECURITY;


--
-- Name: USER_ACHIEVEMENT_ID_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public."USER_ACHIEVEMENT_ID_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: USER_ACHIEVEMENT_ID_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public."USER_ACHIEVEMENT_ID_seq" OWNED BY public."USER_ACHIEVEMENT"."ID";


--
-- Name: USER_ROLE; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."USER_ROLE" (
    "ID" integer NOT NULL,
    "TENANT_ID" integer DEFAULT public.current_tenant_id() NOT NULL,
    "NAME_SHORT" character varying(80) NOT NULL,
    "NAME_LONG" text,
    "COLOR" character varying(7),
    "IS_SYSTEM" boolean DEFAULT false NOT NULL,
    "IS_DEFAULT" boolean DEFAULT false NOT NULL,
    "CREATED_AT" timestamp with time zone DEFAULT now() NOT NULL,
    "UPDATED_AT" timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public."USER_ROLE" FORCE ROW LEVEL SECURITY;


--
-- Name: USER_ROLE_ID_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public."USER_ROLE_ID_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: USER_ROLE_ID_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public."USER_ROLE_ID_seq" OWNED BY public."USER_ROLE"."ID";


--
-- Name: VACATION_ENTITLEMENT; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."VACATION_ENTITLEMENT" (
    "ID" integer NOT NULL,
    "TENANT_ID" integer DEFAULT public.current_tenant_id() NOT NULL,
    "EMPLOYEE_ID" integer NOT NULL,
    "YEAR" integer NOT NULL,
    "DAYS_ENTITLED" numeric DEFAULT 0 NOT NULL,
    "CARRYOVER_OVERRIDE" numeric,
    "NOTE" text
);

ALTER TABLE ONLY public."VACATION_ENTITLEMENT" FORCE ROW LEVEL SECURITY;


--
-- Name: VACATION_ENTITLEMENT_ID_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public."VACATION_ENTITLEMENT_ID_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: VACATION_ENTITLEMENT_ID_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public."VACATION_ENTITLEMENT_ID_seq" OWNED BY public."VACATION_ENTITLEMENT"."ID";


--
-- Name: VAT; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."VAT" (
    "ID" bigint NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    "VAT" character varying,
    "VAT_PERCENT" numeric
);


--
-- Name: VAT_ID_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public."VAT" ALTER COLUMN "ID" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME public."VAT_ID_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: VW_REPORT_PROJECT_DETAIL; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public."VW_REPORT_PROJECT_DETAIL" AS
 SELECT p."TENANT_ID",
    p."ID" AS "PROJECT_ID",
    p."NAME_LONG",
    p."NAME_SHORT",
    p."PROJECT_STATUS_ID",
    ps_lkp."NAME_SHORT" AS "PROJECT_STATUS_NAME_SHORT",
    p."PROJECT_TYPE_ID",
    pt."NAME_SHORT" AS "PROJECT_TYPE_NAME_SHORT",
    p."PROJECT_MANAGER_ID",
    ((e."SHORT_NAME")::text ||
        CASE
            WHEN (e."FIRST_NAME" IS NOT NULL) THEN (((': '::text || (e."FIRST_NAME")::text) || ' '::text) || (COALESCE(e."LAST_NAME", ''::character varying))::text)
            ELSE ''::text
        END) AS "PROJECT_MANAGER_DISPLAY",
    p."ADDRESS_ID",
    a."ADDRESS_NAME_1" AS "ADDRESS_NAME",
    p."COMPANY_ID",
    c."COMPANY_NAME_1" AS "COMPANY_NAME",
    p."DEPARTMENT_ID",
    d."NAME_SHORT" AS "DEPARTMENT_NAME",
    p."CONTACT_ID",
    co."LAST_NAME" AS "CONTACT_NAME",
    p.created_at AS "PROJECT_created_at",
    (COALESCE(pa."REVENUE_BUDGET", (0)::numeric) + COALESCE(pa."EXTRAS_BUDGET", (0)::numeric)) AS "BUDGET_TOTAL_NET",
    pa."LEISTUNGSSTAND_PERCENT",
    (COALESCE(pa."REVENUE_COMPLETION_VALUE", (0)::numeric) + COALESCE(pa."EXTRAS_COMPLETION_VALUE", (0)::numeric)) AS "LEISTUNGSSTAND_VALUE",
    COALESCE(ta."HOURS_TOTAL", (0)::numeric) AS "HOURS_TOTAL",
    COALESCE(ta."COST_TOTAL", (0)::numeric) AS "COST_TOTAL",
    (COALESCE(pa."REVENUE_COMPLETION_VALUE", (0)::numeric) + COALESCE(pa."EXTRAS_COMPLETION_VALUE", (0)::numeric)) AS "EARNED_VALUE_NET",
        CASE
            WHEN ((COALESCE(pa."REVENUE_COMPLETION_VALUE", (0)::numeric) + COALESCE(pa."EXTRAS_COMPLETION_VALUE", (0)::numeric)) = (0)::numeric) THEN NULL::numeric
            ELSE (COALESCE(ta."COST_TOTAL", (0)::numeric) / (COALESCE(pa."REVENUE_COMPLETION_VALUE", (0)::numeric) + COALESCE(pa."EXTRAS_COMPLETION_VALUE", (0)::numeric)))
        END AS "COST_RATIO",
    ((COALESCE(pa."REVENUE_BUDGET", (0)::numeric) + COALESCE(pa."EXTRAS_BUDGET", (0)::numeric)) - (COALESCE(pa."REVENUE_COMPLETION_VALUE", (0)::numeric) + COALESCE(pa."EXTRAS_COMPLETION_VALUE", (0)::numeric))) AS "REMAINING_BUDGET_NET",
    COALESCE(p."PARTIAL_PAYMENTS", (0)::numeric) AS "PARTIAL_PAYMENT_NET_TOTAL",
    COALESCE(p."INVOICED", (0)::numeric) AS "INVOICE_NET_TOTAL",
    COALESCE(ba."PAYED_NET_TOTAL", (0)::numeric) AS "PAYED_NET_TOTAL",
    (COALESCE(p."PARTIAL_PAYMENTS", (0)::numeric) + COALESCE(p."INVOICED", (0)::numeric)) AS "BILLED_NET_TOTAL",
    ((COALESCE(pa."REVENUE_COMPLETION_VALUE", (0)::numeric) + COALESCE(pa."EXTRAS_COMPLETION_VALUE", (0)::numeric)) - (COALESCE(p."PARTIAL_PAYMENTS", (0)::numeric) + COALESCE(p."INVOICED", (0)::numeric))) AS "OPEN_NET_TOTAL",
    COALESCE(ta."SALES_TOTAL", (0)::numeric) AS "SALES_TOTAL",
    COALESCE(ta."QTY_EXT_TOTAL", (0)::numeric) AS "QTY_EXT_TOTAL"
   FROM ((((((((((public."PROJECT" p
     LEFT JOIN "REPORTING"."VW_PROJECT_PROGRESS_AGG" pa ON (((pa."TENANT_ID" = p."TENANT_ID") AND (pa."PROJECT_ID" = p."ID"))))
     LEFT JOIN "REPORTING"."VW_PROJECT_TIME_AGG" ta ON (((ta."TENANT_ID" = p."TENANT_ID") AND (ta."PROJECT_ID" = p."ID"))))
     LEFT JOIN "REPORTING"."VW_PROJECT_BILLING_AGG" ba ON (((ba."TENANT_ID" = p."TENANT_ID") AND (ba."PROJECT_ID" = p."ID"))))
     LEFT JOIN public."EMPLOYEE" e ON (((e."TENANT_ID" = p."TENANT_ID") AND (e."ID" = p."PROJECT_MANAGER_ID"))))
     LEFT JOIN public."PROJECT_STATUS" ps_lkp ON ((ps_lkp."ID" = p."PROJECT_STATUS_ID")))
     LEFT JOIN public."PROJECT_TYPE" pt ON ((pt."ID" = p."PROJECT_TYPE_ID")))
     LEFT JOIN public."ADDRESS" a ON (((a."TENANT_ID" = p."TENANT_ID") AND (a."ID" = p."ADDRESS_ID"))))
     LEFT JOIN public."COMPANY" c ON (((c."TENANT_ID" = p."TENANT_ID") AND (c."ID" = p."COMPANY_ID"))))
     LEFT JOIN public."DEPARTMENT" d ON ((d."ID" = p."DEPARTMENT_ID")))
     LEFT JOIN public."CONTACTS" co ON (((co."TENANT_ID" = p."TENANT_ID") AND (co."ID" = p."CONTACT_ID"))));


--
-- Name: VW_REPORT_PROJECT_DETAIL_STRUCTURE; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public."VW_REPORT_PROJECT_DETAIL_STRUCTURE" AS
 SELECT ps."TENANT_ID",
    ps."PROJECT_ID",
    ps."ID" AS "STRUCTURE_ID",
    ps."FATHER_ID" AS "PARENT_STRUCTURE_ID",
    ps."NAME_SHORT",
    ps."NAME_LONG",
    ps."BILLING_TYPE_ID",
    (NOT (EXISTS ( SELECT 1
           FROM public."PROJECT_STRUCTURE" child
          WHERE ((child."TENANT_ID" = ps."TENANT_ID") AND (child."FATHER_ID" = ps."ID"))))) AS "IS_LEAF",
    COALESCE(sum(t."QUANTITY_INT"), (0)::numeric) AS "HOURS_TOTAL",
    COALESCE(sum(t."CP_TOT"), (0)::numeric) AS "COST_TOTAL",
        CASE
            WHEN (ps."BILLING_TYPE_ID" = 2) THEN COALESCE(ps."REVENUE", (0)::numeric)
            ELSE (COALESCE(ps."REVENUE_COMPLETION", (0)::numeric) + COALESCE(ps."EXTRAS_COMPLETION", (0)::numeric))
        END AS "EARNED_VALUE_NET",
    (COALESCE(ps."REVENUE", (0)::numeric) + COALESCE(ps."EXTRAS", (0)::numeric)) AS "HONORAR_NET",
        CASE
            WHEN (ps."BILLING_TYPE_ID" = 2) THEN (0)::numeric
            ELSE ((COALESCE(ps."REVENUE", (0)::numeric) + COALESCE(ps."EXTRAS", (0)::numeric)) - (COALESCE(ps."REVENUE_COMPLETION", (0)::numeric) + COALESCE(ps."EXTRAS_COMPLETION", (0)::numeric)))
        END AS "REST_HONORAR",
        CASE
            WHEN (ps."BILLING_TYPE_ID" = 2) THEN
            CASE
                WHEN (COALESCE(ps."REVENUE", (0)::numeric) > (0)::numeric) THEN 100.0
                ELSE (0)::numeric
            END
            ELSE COALESCE(ps."REVENUE_COMPLETION_PERCENT", (0)::numeric)
        END AS "LEISTUNGSSTAND_PERCENT",
        CASE
            WHEN (
            CASE
                WHEN (ps."BILLING_TYPE_ID" = 2) THEN COALESCE(ps."REVENUE", (0)::numeric)
                ELSE (COALESCE(ps."REVENUE_COMPLETION", (0)::numeric) + COALESCE(ps."EXTRAS_COMPLETION", (0)::numeric))
            END = (0)::numeric) THEN NULL::numeric
            ELSE (COALESCE(sum(t."CP_TOT"), (0)::numeric) /
            CASE
                WHEN (ps."BILLING_TYPE_ID" = 2) THEN COALESCE(ps."REVENUE", (0)::numeric)
                ELSE (COALESCE(ps."REVENUE_COMPLETION", (0)::numeric) + COALESCE(ps."EXTRAS_COMPLETION", (0)::numeric))
            END)
        END AS "KOSTENQUOTE"
   FROM (public."PROJECT_STRUCTURE" ps
     LEFT JOIN public."TEC" t ON (((t."TENANT_ID" = ps."TENANT_ID") AND (t."STRUCTURE_ID" = ps."ID"))))
  GROUP BY ps."TENANT_ID", ps."PROJECT_ID", ps."ID", ps."FATHER_ID", ps."NAME_SHORT", ps."NAME_LONG", ps."BILLING_TYPE_ID", ps."REVENUE", ps."EXTRAS", ps."REVENUE_COMPLETION", ps."EXTRAS_COMPLETION", ps."REVENUE_COMPLETION_PERCENT";


--
-- Name: VW_REPORT_PROJECT_LIST_ROOT; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public."VW_REPORT_PROJECT_LIST_ROOT" AS
 SELECT "TENANT_ID",
    "PROJECT_ID",
    "NAME_SHORT",
    "NAME_LONG",
    "PROJECT_STATUS_ID",
    "PROJECT_STATUS_NAME_SHORT",
    "PROJECT_TYPE_ID",
    "PROJECT_TYPE_NAME_SHORT",
    "PROJECT_MANAGER_ID",
    "PROJECT_MANAGER_DISPLAY",
    "ADDRESS_ID",
    "ADDRESS_NAME",
    "COMPANY_ID",
    "COMPANY_NAME",
    "DEPARTMENT_ID",
    "DEPARTMENT_NAME",
    "CONTACT_ID",
    "CONTACT_NAME",
    "BUDGET_TOTAL_NET",
    "LEISTUNGSSTAND_PERCENT",
    "LEISTUNGSSTAND_VALUE",
    "HOURS_TOTAL",
    "COST_TOTAL",
    "EARNED_VALUE_NET",
    "COST_RATIO",
    "REMAINING_BUDGET_NET",
    "PARTIAL_PAYMENT_NET_TOTAL",
    "INVOICE_NET_TOTAL",
    "PAYED_NET_TOTAL",
    "BILLED_NET_TOTAL",
    "OPEN_NET_TOTAL"
   FROM public."VW_REPORT_PROJECT_DETAIL" pd;


--
-- Name: WORKING_TIME_MODEL; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."WORKING_TIME_MODEL" (
    "ID" integer NOT NULL,
    "TENANT_ID" integer DEFAULT public.current_tenant_id() NOT NULL,
    "NAME" text NOT NULL,
    "COUNTRY_CODE" text DEFAULT 'DE'::text NOT NULL,
    "STATE_CODE" text,
    "MON" numeric(4,2) DEFAULT 0 NOT NULL,
    "TUE" numeric(4,2) DEFAULT 0 NOT NULL,
    "WED" numeric(4,2) DEFAULT 0 NOT NULL,
    "THU" numeric(4,2) DEFAULT 0 NOT NULL,
    "FRI" numeric(4,2) DEFAULT 0 NOT NULL,
    "SAT" numeric(4,2) DEFAULT 0 NOT NULL,
    "SUN" numeric(4,2) DEFAULT 0 NOT NULL,
    "MODEL_TYPE" text DEFAULT 'FIXED'::text NOT NULL,
    "BREAK_RULE_ID" integer,
    "MAX_DAILY_HOURS" numeric(4,2) DEFAULT 10 NOT NULL,
    "MIN_REST_HOURS" numeric(4,2) DEFAULT 11 NOT NULL,
    "IS_MINOR_PROFILE" boolean DEFAULT false NOT NULL,
    CONSTRAINT chk_working_time_model_type CHECK (("MODEL_TYPE" = ANY (ARRAY['FIXED'::text, 'TRUST'::text])))
);

ALTER TABLE ONLY public."WORKING_TIME_MODEL" FORCE ROW LEVEL SECURITY;


--
-- Name: WORKING_TIME_MODEL_ID_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public."WORKING_TIME_MODEL_ID_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: WORKING_TIME_MODEL_ID_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public."WORKING_TIME_MODEL_ID_seq" OWNED BY public."WORKING_TIME_MODEL"."ID";


--
-- Name: document_number_range_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.document_number_range_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: document_number_range_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.document_number_range_id_seq OWNED BY public.document_number_range.id;


--
-- Name: ABSENCE ID; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."ABSENCE" ALTER COLUMN "ID" SET DEFAULT nextval('public."ABSENCE_ID_seq"'::regclass);


--
-- Name: ABSENCE_TYPE ID; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."ABSENCE_TYPE" ALTER COLUMN "ID" SET DEFAULT nextval('public."ABSENCE_TYPE_ID_seq"'::regclass);


--
-- Name: ACHIEVEMENT ID; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."ACHIEVEMENT" ALTER COLUMN "ID" SET DEFAULT nextval('public."ACHIEVEMENT_ID_seq"'::regclass);


--
-- Name: ARBZG_AUDIT ID; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."ARBZG_AUDIT" ALTER COLUMN "ID" SET DEFAULT nextval('public."ARBZG_AUDIT_ID_seq"'::regclass);


--
-- Name: ASSET ID; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."ASSET" ALTER COLUMN "ID" SET DEFAULT nextval('public."ASSET_ID_seq"'::regclass);


--
-- Name: BOOKING_TEXT_SNIPPET ID; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."BOOKING_TEXT_SNIPPET" ALTER COLUMN "ID" SET DEFAULT nextval('public."BOOKING_TEXT_SNIPPET_ID_seq"'::regclass);


--
-- Name: BOOKING_TYPE ID; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."BOOKING_TYPE" ALTER COLUMN "ID" SET DEFAULT nextval('public."BOOKING_TYPE_ID_seq"'::regclass);


--
-- Name: BREAK_RULE ID; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."BREAK_RULE" ALTER COLUMN "ID" SET DEFAULT nextval('public."BREAK_RULE_ID_seq"'::regclass);


--
-- Name: BUDGET_WARNING_FIRED ID; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."BUDGET_WARNING_FIRED" ALTER COLUMN "ID" SET DEFAULT nextval('public."BUDGET_WARNING_FIRED_ID_seq"'::regclass);


--
-- Name: BUDGET_WARNING_RULE ID; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."BUDGET_WARNING_RULE" ALTER COLUMN "ID" SET DEFAULT nextval('public."BUDGET_WARNING_RULE_ID_seq"'::regclass);


--
-- Name: COST_RATE_CONFIG ID; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."COST_RATE_CONFIG" ALTER COLUMN "ID" SET DEFAULT nextval('public."COST_RATE_CONFIG_ID_seq"'::regclass);


--
-- Name: COST_RATE_EMP_PARAMS ID; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."COST_RATE_EMP_PARAMS" ALTER COLUMN "ID" SET DEFAULT nextval('public."COST_RATE_EMP_PARAMS_ID_seq"'::regclass);


--
-- Name: DIN276_COST_ESTIMATE ID; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."DIN276_COST_ESTIMATE" ALTER COLUMN "ID" SET DEFAULT nextval('public."DIN276_COST_ESTIMATE_ID_seq"'::regclass);


--
-- Name: DIN276_COST_GROUP ID; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."DIN276_COST_GROUP" ALTER COLUMN "ID" SET DEFAULT nextval('public."DIN276_COST_GROUP_ID_seq"'::regclass);


--
-- Name: DOCUMENT_TEMPLATE ID; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."DOCUMENT_TEMPLATE" ALTER COLUMN "ID" SET DEFAULT nextval('public."DOCUMENT_TEMPLATE_ID_seq"'::regclass);


--
-- Name: EMAIL_TEMPLATE ID; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."EMAIL_TEMPLATE" ALTER COLUMN "ID" SET DEFAULT nextval('public."EMAIL_TEMPLATE_ID_seq"'::regclass);


--
-- Name: EMPLOYEE_CP_RATE ID; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."EMPLOYEE_CP_RATE" ALTER COLUMN "ID" SET DEFAULT nextval('public."EMPLOYEE_CP_RATE_ID_seq"'::regclass);


--
-- Name: EMPLOYEE_MONTH_CLOSE ID; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."EMPLOYEE_MONTH_CLOSE" ALTER COLUMN "ID" SET DEFAULT nextval('public."EMPLOYEE_MONTH_CLOSE_ID_seq"'::regclass);


--
-- Name: EMPLOYEE_WORK_MODEL ID; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."EMPLOYEE_WORK_MODEL" ALTER COLUMN "ID" SET DEFAULT nextval('public."EMPLOYEE_WORK_MODEL_ID_seq"'::regclass);


--
-- Name: FEE_CALCULATION_BL ID; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."FEE_CALCULATION_BL" ALTER COLUMN "ID" SET DEFAULT nextval('public."FEE_CALCULATION_BL_ID_seq"'::regclass);


--
-- Name: FEE_CALCULATION_SURCHARGES ID; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."FEE_CALCULATION_SURCHARGES" ALTER COLUMN "ID" SET DEFAULT nextval('public."FEE_CALCULATION_SURCHARGES_ID_seq"'::regclass);


--
-- Name: FEE_CALC_ZONE_SPLIT ID; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."FEE_CALC_ZONE_SPLIT" ALTER COLUMN "ID" SET DEFAULT nextval('public."FEE_CALC_ZONE_SPLIT_ID_seq"'::regclass);


--
-- Name: FEE_ZONE_CRITERION ID; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."FEE_ZONE_CRITERION" ALTER COLUMN "ID" SET DEFAULT nextval('public."FEE_ZONE_CRITERION_ID_seq"'::regclass);


--
-- Name: FEE_ZONE_LOOKUP ID; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."FEE_ZONE_LOOKUP" ALTER COLUMN "ID" SET DEFAULT nextval('public."FEE_ZONE_LOOKUP_ID_seq"'::regclass);


--
-- Name: FEE_ZONE_THRESHOLD ID; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."FEE_ZONE_THRESHOLD" ALTER COLUMN "ID" SET DEFAULT nextval('public."FEE_ZONE_THRESHOLD_ID_seq"'::regclass);


--
-- Name: IMPORT_BATCH ID; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."IMPORT_BATCH" ALTER COLUMN "ID" SET DEFAULT nextval('public."IMPORT_BATCH_ID_seq"'::regclass);


--
-- Name: INVOICE_ATTACHMENT ID; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."INVOICE_ATTACHMENT" ALTER COLUMN "ID" SET DEFAULT nextval('public."INVOICE_ATTACHMENT_ID_seq"'::regclass);


--
-- Name: INVOICE_DEDUCTION ID; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."INVOICE_DEDUCTION" ALTER COLUMN "ID" SET DEFAULT nextval('public."INVOICE_DEDUCTION_ID_seq"'::regclass);


--
-- Name: LANDING_EVENT ID; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."LANDING_EVENT" ALTER COLUMN "ID" SET DEFAULT nextval('public."LANDING_EVENT_ID_seq"'::regclass);


--
-- Name: LICENSE_CHANGE_LOG ID; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."LICENSE_CHANGE_LOG" ALTER COLUMN "ID" SET DEFAULT nextval('public."LICENSE_CHANGE_LOG_ID_seq"'::regclass);


--
-- Name: LICENSE_PLAN ID; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."LICENSE_PLAN" ALTER COLUMN "ID" SET DEFAULT nextval('public."LICENSE_PLAN_ID_seq"'::regclass);


--
-- Name: LPH_BLOCK ID; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."LPH_BLOCK" ALTER COLUMN "ID" SET DEFAULT nextval('public."LPH_BLOCK_ID_seq"'::regclass);


--
-- Name: LPH_BLOCK_PHASE ID; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."LPH_BLOCK_PHASE" ALTER COLUMN "ID" SET DEFAULT nextval('public."LPH_BLOCK_PHASE_ID_seq"'::regclass);


--
-- Name: MAHNUNG ID; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."MAHNUNG" ALTER COLUMN "ID" SET DEFAULT nextval('public."MAHNUNG_ID_seq"'::regclass);


--
-- Name: MAHNUNG_HISTORY ID; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."MAHNUNG_HISTORY" ALTER COLUMN "ID" SET DEFAULT nextval('public."MAHNUNG_HISTORY_ID_seq"'::regclass);


--
-- Name: MAHNUNG_SETTINGS ID; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."MAHNUNG_SETTINGS" ALTER COLUMN "ID" SET DEFAULT nextval('public."MAHNUNG_SETTINGS_ID_seq"'::regclass);


--
-- Name: NOTIFICATION ID; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."NOTIFICATION" ALTER COLUMN "ID" SET DEFAULT nextval('public."NOTIFICATION_ID_seq"'::regclass);


--
-- Name: NOTIFICATION_SCHEDULE_CONFIG ID; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."NOTIFICATION_SCHEDULE_CONFIG" ALTER COLUMN "ID" SET DEFAULT nextval('public."NOTIFICATION_SCHEDULE_CONFIG_ID_seq"'::regclass);


--
-- Name: NOTIFICATION_TYPE_CONFIG ID; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."NOTIFICATION_TYPE_CONFIG" ALTER COLUMN "ID" SET DEFAULT nextval('public."NOTIFICATION_TYPE_CONFIG_ID_seq"'::regclass);


--
-- Name: NUMBER_RANGE_TEMPLATE ID; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."NUMBER_RANGE_TEMPLATE" ALTER COLUMN "ID" SET DEFAULT nextval('public."NUMBER_RANGE_TEMPLATE_ID_seq"'::regclass);


--
-- Name: PERMISSION ID; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."PERMISSION" ALTER COLUMN "ID" SET DEFAULT nextval('public."PERMISSION_ID_seq"'::regclass);


--
-- Name: PLATFORM_ADMIN ID; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."PLATFORM_ADMIN" ALTER COLUMN "ID" SET DEFAULT nextval('public."PLATFORM_ADMIN_ID_seq"'::regclass);


--
-- Name: PLATFORM_EMAIL_SETTINGS ID; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."PLATFORM_EMAIL_SETTINGS" ALTER COLUMN "ID" SET DEFAULT nextval('public."PLATFORM_EMAIL_SETTINGS_ID_seq"'::regclass);


--
-- Name: PORTAL_CONSENT ID; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."PORTAL_CONSENT" ALTER COLUMN "ID" SET DEFAULT nextval('public."PORTAL_CONSENT_ID_seq"'::regclass);


--
-- Name: PROJECT_BOOKING_PRICE ID; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."PROJECT_BOOKING_PRICE" ALTER COLUMN "ID" SET DEFAULT nextval('public."PROJECT_BOOKING_PRICE_ID_seq"'::regclass);


--
-- Name: PUBLIC_HOLIDAY ID; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."PUBLIC_HOLIDAY" ALTER COLUMN "ID" SET DEFAULT nextval('public."PUBLIC_HOLIDAY_ID_seq"'::regclass);


--
-- Name: PUSH_SUBSCRIPTION ID; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."PUSH_SUBSCRIPTION" ALTER COLUMN "ID" SET DEFAULT nextval('public."PUSH_SUBSCRIPTION_ID_seq"'::regclass);


--
-- Name: PUSH_TOKEN ID; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."PUSH_TOKEN" ALTER COLUMN "ID" SET DEFAULT nextval('public."PUSH_TOKEN_ID_seq"'::regclass);


--
-- Name: RECENT_VIEW ID; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."RECENT_VIEW" ALTER COLUMN "ID" SET DEFAULT nextval('public."RECENT_VIEW_ID_seq"'::regclass);


--
-- Name: SERVICE_REQUEST ID; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."SERVICE_REQUEST" ALTER COLUMN "ID" SET DEFAULT nextval('public."SERVICE_REQUEST_ID_seq"'::regclass);


--
-- Name: SERVICE_REQUEST_ATTACHMENT ID; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."SERVICE_REQUEST_ATTACHMENT" ALTER COLUMN "ID" SET DEFAULT nextval('public."SERVICE_REQUEST_ATTACHMENT_ID_seq"'::regclass);


--
-- Name: SERVICE_REQUEST_MESSAGE ID; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."SERVICE_REQUEST_MESSAGE" ALTER COLUMN "ID" SET DEFAULT nextval('public."SERVICE_REQUEST_MESSAGE_ID_seq"'::regclass);


--
-- Name: SE_RELEASE ID; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."SE_RELEASE" ALTER COLUMN "ID" SET DEFAULT nextval('public."SE_RELEASE_ID_seq"'::regclass);


--
-- Name: SUGGESTION ID; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."SUGGESTION" ALTER COLUMN "ID" SET DEFAULT nextval('public."SUGGESTION_ID_seq"'::regclass);


--
-- Name: SUGGESTION_ATTACHMENT ID; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."SUGGESTION_ATTACHMENT" ALTER COLUMN "ID" SET DEFAULT nextval('public."SUGGESTION_ATTACHMENT_ID_seq"'::regclass);


--
-- Name: SUGGESTION_COMMENT ID; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."SUGGESTION_COMMENT" ALTER COLUMN "ID" SET DEFAULT nextval('public."SUGGESTION_COMMENT_ID_seq"'::regclass);


--
-- Name: SUGGESTION_VOTE ID; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."SUGGESTION_VOTE" ALTER COLUMN "ID" SET DEFAULT nextval('public."SUGGESTION_VOTE_ID_seq"'::regclass);


--
-- Name: TENANT_EMAIL_SETTINGS ID; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."TENANT_EMAIL_SETTINGS" ALTER COLUMN "ID" SET DEFAULT nextval('public."TENANT_EMAIL_SETTINGS_ID_seq"'::regclass);


--
-- Name: TENANT_ENTITLEMENT_OVERRIDE ID; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."TENANT_ENTITLEMENT_OVERRIDE" ALTER COLUMN "ID" SET DEFAULT nextval('public."TENANT_ENTITLEMENT_OVERRIDE_ID_seq"'::regclass);


--
-- Name: TEXT_TEMPLATE ID; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."TEXT_TEMPLATE" ALTER COLUMN "ID" SET DEFAULT nextval('public."TEXT_TEMPLATE_ID_seq"'::regclass);


--
-- Name: USER_ACHIEVEMENT ID; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."USER_ACHIEVEMENT" ALTER COLUMN "ID" SET DEFAULT nextval('public."USER_ACHIEVEMENT_ID_seq"'::regclass);


--
-- Name: USER_ROLE ID; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."USER_ROLE" ALTER COLUMN "ID" SET DEFAULT nextval('public."USER_ROLE_ID_seq"'::regclass);


--
-- Name: VACATION_ENTITLEMENT ID; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."VACATION_ENTITLEMENT" ALTER COLUMN "ID" SET DEFAULT nextval('public."VACATION_ENTITLEMENT_ID_seq"'::regclass);


--
-- Name: WORKING_TIME_MODEL ID; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."WORKING_TIME_MODEL" ALTER COLUMN "ID" SET DEFAULT nextval('public."WORKING_TIME_MODEL_ID_seq"'::regclass);


--
-- Name: document_number_range id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.document_number_range ALTER COLUMN id SET DEFAULT nextval('public.document_number_range_id_seq'::regclass);


--
-- Name: ABSENCE_TYPE ABSENCE_TYPE_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."ABSENCE_TYPE"
    ADD CONSTRAINT "ABSENCE_TYPE_pkey" PRIMARY KEY ("ID");


--
-- Name: ABSENCE ABSENCE_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."ABSENCE"
    ADD CONSTRAINT "ABSENCE_pkey" PRIMARY KEY ("ID");


--
-- Name: ACHIEVEMENT ACHIEVEMENT_KEY_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."ACHIEVEMENT"
    ADD CONSTRAINT "ACHIEVEMENT_KEY_key" UNIQUE ("KEY");


--
-- Name: ACHIEVEMENT ACHIEVEMENT_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."ACHIEVEMENT"
    ADD CONSTRAINT "ACHIEVEMENT_pkey" PRIMARY KEY ("ID");


--
-- Name: ADDRESS ADDRESS_ADDRESS_NAME_1_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."ADDRESS"
    ADD CONSTRAINT "ADDRESS_ADDRESS_NAME_1_key" UNIQUE ("ADDRESS_NAME_1");


--
-- Name: ADDRESS ADDRESS_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."ADDRESS"
    ADD CONSTRAINT "ADDRESS_pkey" PRIMARY KEY ("ID");


--
-- Name: ARBZG_AUDIT ARBZG_AUDIT_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."ARBZG_AUDIT"
    ADD CONSTRAINT "ARBZG_AUDIT_pkey" PRIMARY KEY ("ID");


--
-- Name: ASSET ASSET_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."ASSET"
    ADD CONSTRAINT "ASSET_pkey" PRIMARY KEY ("ID");


--
-- Name: BILLING_TYPE BILLING_TYPE_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."BILLING_TYPE"
    ADD CONSTRAINT "BILLING_TYPE_pkey" PRIMARY KEY ("ID");


--
-- Name: BOOKING_TEXT_SNIPPET BOOKING_TEXT_SNIPPET_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."BOOKING_TEXT_SNIPPET"
    ADD CONSTRAINT "BOOKING_TEXT_SNIPPET_pkey" PRIMARY KEY ("ID");


--
-- Name: BOOKING_TYPE BOOKING_TYPE_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."BOOKING_TYPE"
    ADD CONSTRAINT "BOOKING_TYPE_pkey" PRIMARY KEY ("ID");


--
-- Name: BREAK_RULE BREAK_RULE_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."BREAK_RULE"
    ADD CONSTRAINT "BREAK_RULE_pkey" PRIMARY KEY ("ID");


--
-- Name: BUDGET_WARNING_FIRED BUDGET_WARNING_FIRED_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."BUDGET_WARNING_FIRED"
    ADD CONSTRAINT "BUDGET_WARNING_FIRED_pkey" PRIMARY KEY ("ID");


--
-- Name: BUDGET_WARNING_RULE BUDGET_WARNING_RULE_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."BUDGET_WARNING_RULE"
    ADD CONSTRAINT "BUDGET_WARNING_RULE_pkey" PRIMARY KEY ("ID");


--
-- Name: CAPABILITY_PERMISSION CAPABILITY_PERMISSION_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."CAPABILITY_PERMISSION"
    ADD CONSTRAINT "CAPABILITY_PERMISSION_pkey" PRIMARY KEY ("CAPABILITY_KEY", "PERMISSION_KEY");


--
-- Name: COMPANY COMPANY_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."COMPANY"
    ADD CONSTRAINT "COMPANY_pkey" PRIMARY KEY ("ID");


--
-- Name: CONTACTS CONTACTS_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."CONTACTS"
    ADD CONSTRAINT "CONTACTS_pkey" PRIMARY KEY ("ID");


--
-- Name: CONTRACT CONTRACT_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."CONTRACT"
    ADD CONSTRAINT "CONTRACT_pkey" PRIMARY KEY ("ID");


--
-- Name: COST_RATE_CONFIG COST_RATE_CONFIG_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."COST_RATE_CONFIG"
    ADD CONSTRAINT "COST_RATE_CONFIG_pkey" PRIMARY KEY ("ID");


--
-- Name: COST_RATE_EMP_PARAMS COST_RATE_EMP_PARAMS_TENANT_ID_EMPLOYEE_ID_YEAR_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."COST_RATE_EMP_PARAMS"
    ADD CONSTRAINT "COST_RATE_EMP_PARAMS_TENANT_ID_EMPLOYEE_ID_YEAR_key" UNIQUE ("TENANT_ID", "EMPLOYEE_ID", "YEAR");


--
-- Name: COST_RATE_EMP_PARAMS COST_RATE_EMP_PARAMS_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."COST_RATE_EMP_PARAMS"
    ADD CONSTRAINT "COST_RATE_EMP_PARAMS_pkey" PRIMARY KEY ("ID");


--
-- Name: COUNTRY COUNTRY_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."COUNTRY"
    ADD CONSTRAINT "COUNTRY_pkey" PRIMARY KEY ("ID");


--
-- Name: CURRENCY CURRENCY_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."CURRENCY"
    ADD CONSTRAINT "CURRENCY_pkey" PRIMARY KEY ("ID");


--
-- Name: DEPARTMENT DEPARTMENT_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."DEPARTMENT"
    ADD CONSTRAINT "DEPARTMENT_pkey" PRIMARY KEY ("ID");


--
-- Name: DIN276_COST_ESTIMATE DIN276_COST_ESTIMATE_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."DIN276_COST_ESTIMATE"
    ADD CONSTRAINT "DIN276_COST_ESTIMATE_pkey" PRIMARY KEY ("ID");


--
-- Name: DIN276_COST_GROUP DIN276_COST_GROUP_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."DIN276_COST_GROUP"
    ADD CONSTRAINT "DIN276_COST_GROUP_pkey" PRIMARY KEY ("ID");


--
-- Name: DOCUMENT_TEMPLATE DOCUMENT_TEMPLATE_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."DOCUMENT_TEMPLATE"
    ADD CONSTRAINT "DOCUMENT_TEMPLATE_pkey" PRIMARY KEY ("ID");


--
-- Name: EMAIL_TEMPLATE EMAIL_TEMPLATE_TENANT_ID_TEMPLATE_KEY_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."EMAIL_TEMPLATE"
    ADD CONSTRAINT "EMAIL_TEMPLATE_TENANT_ID_TEMPLATE_KEY_key" UNIQUE ("TENANT_ID", "TEMPLATE_KEY");


--
-- Name: EMAIL_TEMPLATE EMAIL_TEMPLATE_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."EMAIL_TEMPLATE"
    ADD CONSTRAINT "EMAIL_TEMPLATE_pkey" PRIMARY KEY ("ID");


--
-- Name: EMPLOYEE2PROJECT EMPLOYEE2PROJECT_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."EMPLOYEE2PROJECT"
    ADD CONSTRAINT "EMPLOYEE2PROJECT_pkey" PRIMARY KEY ("ID");


--
-- Name: EMPLOYEE_CP_RATE EMPLOYEE_CP_RATE_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."EMPLOYEE_CP_RATE"
    ADD CONSTRAINT "EMPLOYEE_CP_RATE_pkey" PRIMARY KEY ("ID");


--
-- Name: EMPLOYEE_MONTH_CLOSE EMPLOYEE_MONTH_CLOSE_TENANT_ID_EMPLOYEE_ID_YEAR_MONTH_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."EMPLOYEE_MONTH_CLOSE"
    ADD CONSTRAINT "EMPLOYEE_MONTH_CLOSE_TENANT_ID_EMPLOYEE_ID_YEAR_MONTH_key" UNIQUE ("TENANT_ID", "EMPLOYEE_ID", "YEAR", "MONTH");


--
-- Name: EMPLOYEE_MONTH_CLOSE EMPLOYEE_MONTH_CLOSE_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."EMPLOYEE_MONTH_CLOSE"
    ADD CONSTRAINT "EMPLOYEE_MONTH_CLOSE_pkey" PRIMARY KEY ("ID");


--
-- Name: EMPLOYEE_ROLE EMPLOYEE_ROLE_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."EMPLOYEE_ROLE"
    ADD CONSTRAINT "EMPLOYEE_ROLE_pkey" PRIMARY KEY ("EMPLOYEE_ID", "ROLE_ID");


--
-- Name: EMPLOYEE_WORK_MODEL EMPLOYEE_WORK_MODEL_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."EMPLOYEE_WORK_MODEL"
    ADD CONSTRAINT "EMPLOYEE_WORK_MODEL_pkey" PRIMARY KEY ("ID");


--
-- Name: EMPLOYEE EMPLOYEE_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."EMPLOYEE"
    ADD CONSTRAINT "EMPLOYEE_pkey" PRIMARY KEY ("ID");


--
-- Name: FEE_CALCULATION_BL FEE_CALCULATION_BL_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."FEE_CALCULATION_BL"
    ADD CONSTRAINT "FEE_CALCULATION_BL_pkey" PRIMARY KEY ("ID");


--
-- Name: FEE_CALCULATION_MASTER FEE_CALCULATION_MASTER_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."FEE_CALCULATION_MASTER"
    ADD CONSTRAINT "FEE_CALCULATION_MASTER_pkey" PRIMARY KEY ("ID");


--
-- Name: FEE_CALCULATION_PHASE FEE_CALCULATION_PHASE_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."FEE_CALCULATION_PHASE"
    ADD CONSTRAINT "FEE_CALCULATION_PHASE_pkey" PRIMARY KEY ("ID");


--
-- Name: FEE_CALCULATION_SURCHARGES FEE_CALCULATION_SURCHARGES_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."FEE_CALCULATION_SURCHARGES"
    ADD CONSTRAINT "FEE_CALCULATION_SURCHARGES_pkey" PRIMARY KEY ("ID");


--
-- Name: FEE_CALC_ZONE_SPLIT FEE_CALC_ZONE_SPLIT_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."FEE_CALC_ZONE_SPLIT"
    ADD CONSTRAINT "FEE_CALC_ZONE_SPLIT_pkey" PRIMARY KEY ("ID");


--
-- Name: FEE_GROUPS FEE_GROUPS_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."FEE_GROUPS"
    ADD CONSTRAINT "FEE_GROUPS_pkey" PRIMARY KEY ("ID");


--
-- Name: FEE_MASTERS FEE_MASTER_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."FEE_MASTERS"
    ADD CONSTRAINT "FEE_MASTER_pkey" PRIMARY KEY ("ID");


--
-- Name: FEE_PHASE FEE_PHASE_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."FEE_PHASE"
    ADD CONSTRAINT "FEE_PHASE_pkey" PRIMARY KEY ("ID");


--
-- Name: FEE_SURCHARGES2MASTER FEE_SURCHARGES2MASTER_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."FEE_SURCHARGES2MASTER"
    ADD CONSTRAINT "FEE_SURCHARGES2MASTER_pkey" PRIMARY KEY ("ID");


--
-- Name: FEE_SURCHARGES FEE_SURCHARGES_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."FEE_SURCHARGES"
    ADD CONSTRAINT "FEE_SURCHARGES_pkey" PRIMARY KEY ("ID");


--
-- Name: FEE_TABLES FEE_TABLES_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."FEE_TABLES"
    ADD CONSTRAINT "FEE_TABLES_pkey" PRIMARY KEY ("ID");


--
-- Name: FEE_ZONES FEE_ZONES_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."FEE_ZONES"
    ADD CONSTRAINT "FEE_ZONES_pkey" PRIMARY KEY ("ID");


--
-- Name: FEE_ZONE_CRITERION FEE_ZONE_CRITERION_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."FEE_ZONE_CRITERION"
    ADD CONSTRAINT "FEE_ZONE_CRITERION_pkey" PRIMARY KEY ("ID");


--
-- Name: FEE_ZONE_LOOKUP FEE_ZONE_LOOKUP_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."FEE_ZONE_LOOKUP"
    ADD CONSTRAINT "FEE_ZONE_LOOKUP_pkey" PRIMARY KEY ("ID");


--
-- Name: FEE_ZONE_THRESHOLD FEE_ZONE_THRESHOLD_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."FEE_ZONE_THRESHOLD"
    ADD CONSTRAINT "FEE_ZONE_THRESHOLD_pkey" PRIMARY KEY ("ID");


--
-- Name: GENDER GENDER_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."GENDER"
    ADD CONSTRAINT "GENDER_pkey" PRIMARY KEY ("ID");


--
-- Name: IMPORT_BATCH IMPORT_BATCH_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."IMPORT_BATCH"
    ADD CONSTRAINT "IMPORT_BATCH_pkey" PRIMARY KEY ("ID");


--
-- Name: INVOICE_ATTACHMENT INVOICE_ATTACHMENT_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."INVOICE_ATTACHMENT"
    ADD CONSTRAINT "INVOICE_ATTACHMENT_pkey" PRIMARY KEY ("ID");


--
-- Name: INVOICE_DEDUCTION INVOICE_DEDUCTION_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."INVOICE_DEDUCTION"
    ADD CONSTRAINT "INVOICE_DEDUCTION_pkey" PRIMARY KEY ("ID");


--
-- Name: INVOICE_STRUCTURE INVOICE_STRUCTURE_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."INVOICE_STRUCTURE"
    ADD CONSTRAINT "INVOICE_STRUCTURE_pkey" PRIMARY KEY ("ID");


--
-- Name: INVOICE INVOICE_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."INVOICE"
    ADD CONSTRAINT "INVOICE_pkey" PRIMARY KEY ("ID");


--
-- Name: LANDING_EVENT LANDING_EVENT_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."LANDING_EVENT"
    ADD CONSTRAINT "LANDING_EVENT_pkey" PRIMARY KEY ("ID");


--
-- Name: LICENSE_CAPABILITY LICENSE_CAPABILITY_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."LICENSE_CAPABILITY"
    ADD CONSTRAINT "LICENSE_CAPABILITY_pkey" PRIMARY KEY ("KEY");


--
-- Name: LICENSE_CHANGE_LOG LICENSE_CHANGE_LOG_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."LICENSE_CHANGE_LOG"
    ADD CONSTRAINT "LICENSE_CHANGE_LOG_pkey" PRIMARY KEY ("ID");


--
-- Name: LICENSE_MODULE LICENSE_MODULE_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."LICENSE_MODULE"
    ADD CONSTRAINT "LICENSE_MODULE_pkey" PRIMARY KEY ("KEY");


--
-- Name: LICENSE_PLAN LICENSE_PLAN_KEY_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."LICENSE_PLAN"
    ADD CONSTRAINT "LICENSE_PLAN_KEY_key" UNIQUE ("KEY");


--
-- Name: LICENSE_PLAN LICENSE_PLAN_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."LICENSE_PLAN"
    ADD CONSTRAINT "LICENSE_PLAN_pkey" PRIMARY KEY ("ID");


--
-- Name: LPH_BLOCK_PHASE LPH_BLOCK_PHASE_TENANT_ID_FEE_PHASE_ID_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."LPH_BLOCK_PHASE"
    ADD CONSTRAINT "LPH_BLOCK_PHASE_TENANT_ID_FEE_PHASE_ID_key" UNIQUE ("TENANT_ID", "FEE_PHASE_ID");


--
-- Name: LPH_BLOCK_PHASE LPH_BLOCK_PHASE_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."LPH_BLOCK_PHASE"
    ADD CONSTRAINT "LPH_BLOCK_PHASE_pkey" PRIMARY KEY ("ID");


--
-- Name: LPH_BLOCK LPH_BLOCK_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."LPH_BLOCK"
    ADD CONSTRAINT "LPH_BLOCK_pkey" PRIMARY KEY ("ID");


--
-- Name: MAHNUNG_HISTORY MAHNUNG_HISTORY_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."MAHNUNG_HISTORY"
    ADD CONSTRAINT "MAHNUNG_HISTORY_pkey" PRIMARY KEY ("ID");


--
-- Name: MAHNUNG_SETTINGS MAHNUNG_SETTINGS_TENANT_ID_MAHNSTUFE_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."MAHNUNG_SETTINGS"
    ADD CONSTRAINT "MAHNUNG_SETTINGS_TENANT_ID_MAHNSTUFE_key" UNIQUE ("TENANT_ID", "MAHNSTUFE");


--
-- Name: MAHNUNG_SETTINGS MAHNUNG_SETTINGS_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."MAHNUNG_SETTINGS"
    ADD CONSTRAINT "MAHNUNG_SETTINGS_pkey" PRIMARY KEY ("ID");


--
-- Name: MAHNUNG MAHNUNG_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."MAHNUNG"
    ADD CONSTRAINT "MAHNUNG_pkey" PRIMARY KEY ("ID");


--
-- Name: NACHTRAG_AUDIT NACHTRAG_AUDIT_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."NACHTRAG_AUDIT"
    ADD CONSTRAINT "NACHTRAG_AUDIT_pkey" PRIMARY KEY ("ID");


--
-- Name: NACHTRAG_RELEASE NACHTRAG_RELEASE_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."NACHTRAG_RELEASE"
    ADD CONSTRAINT "NACHTRAG_RELEASE_pkey" PRIMARY KEY ("ID");


--
-- Name: NACHTRAG_STATUS NACHTRAG_STATUS_CODE_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."NACHTRAG_STATUS"
    ADD CONSTRAINT "NACHTRAG_STATUS_CODE_key" UNIQUE ("CODE");


--
-- Name: NACHTRAG_STATUS NACHTRAG_STATUS_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."NACHTRAG_STATUS"
    ADD CONSTRAINT "NACHTRAG_STATUS_pkey" PRIMARY KEY ("ID");


--
-- Name: NACHTRAG_STRUCTURE NACHTRAG_STRUCTURE_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."NACHTRAG_STRUCTURE"
    ADD CONSTRAINT "NACHTRAG_STRUCTURE_pkey" PRIMARY KEY ("ID");


--
-- Name: NACHTRAG NACHTRAG_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."NACHTRAG"
    ADD CONSTRAINT "NACHTRAG_pkey" PRIMARY KEY ("ID");


--
-- Name: NOTIFICATION_SCHEDULE_CONFIG NOTIFICATION_SCHEDULE_CONFIG_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."NOTIFICATION_SCHEDULE_CONFIG"
    ADD CONSTRAINT "NOTIFICATION_SCHEDULE_CONFIG_pkey" PRIMARY KEY ("ID");


--
-- Name: NOTIFICATION_TYPE_CONFIG NOTIFICATION_TYPE_CONFIG_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."NOTIFICATION_TYPE_CONFIG"
    ADD CONSTRAINT "NOTIFICATION_TYPE_CONFIG_pkey" PRIMARY KEY ("ID");


--
-- Name: NOTIFICATION_TYPE NOTIFICATION_TYPE_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."NOTIFICATION_TYPE"
    ADD CONSTRAINT "NOTIFICATION_TYPE_pkey" PRIMARY KEY ("TYPE_KEY");


--
-- Name: NOTIFICATION NOTIFICATION_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."NOTIFICATION"
    ADD CONSTRAINT "NOTIFICATION_pkey" PRIMARY KEY ("ID");


--
-- Name: NUMBER_RANGE_TEMPLATE NUMBER_RANGE_TEMPLATE_COMPANY_ID_DOC_TYPE_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."NUMBER_RANGE_TEMPLATE"
    ADD CONSTRAINT "NUMBER_RANGE_TEMPLATE_COMPANY_ID_DOC_TYPE_key" UNIQUE ("COMPANY_ID", "DOC_TYPE");


--
-- Name: NUMBER_RANGE_TEMPLATE NUMBER_RANGE_TEMPLATE_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."NUMBER_RANGE_TEMPLATE"
    ADD CONSTRAINT "NUMBER_RANGE_TEMPLATE_pkey" PRIMARY KEY ("ID");


--
-- Name: OFFER_STATUS OFFER_STATUS_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."OFFER_STATUS"
    ADD CONSTRAINT "OFFER_STATUS_pkey" PRIMARY KEY ("ID");


--
-- Name: OFFER_STRUCTURE OFFER_STRUCTURE_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."OFFER_STRUCTURE"
    ADD CONSTRAINT "OFFER_STRUCTURE_pkey" PRIMARY KEY ("ID");


--
-- Name: OFFER OFFER_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."OFFER"
    ADD CONSTRAINT "OFFER_pkey" PRIMARY KEY ("ID");


--
-- Name: PARTIAL_PAYMENT_STRUCTURE PARTIAL_PAYMENT_STRUCTURE_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."PARTIAL_PAYMENT_STRUCTURE"
    ADD CONSTRAINT "PARTIAL_PAYMENT_STRUCTURE_pkey" PRIMARY KEY ("ID");


--
-- Name: PARTIAL_PAYMENT PARTIAL_PAYMENT_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."PARTIAL_PAYMENT"
    ADD CONSTRAINT "PARTIAL_PAYMENT_pkey" PRIMARY KEY ("ID");


--
-- Name: PAYMENT_MEANS PAYMENT_MEANS_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."PAYMENT_MEANS"
    ADD CONSTRAINT "PAYMENT_MEANS_pkey" PRIMARY KEY ("ID");


--
-- Name: PAYMENT_STRUCTURE PAYMENT_STRUCTURE_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."PAYMENT_STRUCTURE"
    ADD CONSTRAINT "PAYMENT_STRUCTURE_pkey" PRIMARY KEY ("ID");


--
-- Name: PAYMENT PAYMENT_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."PAYMENT"
    ADD CONSTRAINT "PAYMENT_pkey" PRIMARY KEY ("ID");


--
-- Name: PERMISSION PERMISSION_KEY_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."PERMISSION"
    ADD CONSTRAINT "PERMISSION_KEY_key" UNIQUE ("KEY");


--
-- Name: PERMISSION PERMISSION_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."PERMISSION"
    ADD CONSTRAINT "PERMISSION_pkey" PRIMARY KEY ("ID");


--
-- Name: PLAN_CAPABILITY PLAN_CAPABILITY_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."PLAN_CAPABILITY"
    ADD CONSTRAINT "PLAN_CAPABILITY_pkey" PRIMARY KEY ("PLAN_ID", "CAPABILITY_KEY");


--
-- Name: PLATFORM_ADMIN PLATFORM_ADMIN_EMAIL_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."PLATFORM_ADMIN"
    ADD CONSTRAINT "PLATFORM_ADMIN_EMAIL_key" UNIQUE ("EMAIL");


--
-- Name: PLATFORM_ADMIN PLATFORM_ADMIN_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."PLATFORM_ADMIN"
    ADD CONSTRAINT "PLATFORM_ADMIN_pkey" PRIMARY KEY ("ID");


--
-- Name: PLATFORM_EMAIL_SETTINGS PLATFORM_EMAIL_SETTINGS_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."PLATFORM_EMAIL_SETTINGS"
    ADD CONSTRAINT "PLATFORM_EMAIL_SETTINGS_pkey" PRIMARY KEY ("ID");


--
-- Name: PORTAL_CONSENT PORTAL_CONSENT_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."PORTAL_CONSENT"
    ADD CONSTRAINT "PORTAL_CONSENT_pkey" PRIMARY KEY ("ID");


--
-- Name: PROJECT_BOOKING_PRICE PROJECT_BOOKING_PRICE_PROJECT_ID_BOOKING_TYPE_ID_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."PROJECT_BOOKING_PRICE"
    ADD CONSTRAINT "PROJECT_BOOKING_PRICE_PROJECT_ID_BOOKING_TYPE_ID_key" UNIQUE ("PROJECT_ID", "BOOKING_TYPE_ID");


--
-- Name: PROJECT_BOOKING_PRICE PROJECT_BOOKING_PRICE_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."PROJECT_BOOKING_PRICE"
    ADD CONSTRAINT "PROJECT_BOOKING_PRICE_pkey" PRIMARY KEY ("ID");


--
-- Name: PROJECT_PROGRESS PROJECT_PROGRESS_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."PROJECT_PROGRESS"
    ADD CONSTRAINT "PROJECT_PROGRESS_pkey" PRIMARY KEY ("ID");


--
-- Name: PROJECT_SP_RATES PROJECT_SP_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."PROJECT_SP_RATES"
    ADD CONSTRAINT "PROJECT_SP_pkey" PRIMARY KEY ("ID");


--
-- Name: PROJECT_STATUS PROJECT_STATUS_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."PROJECT_STATUS"
    ADD CONSTRAINT "PROJECT_STATUS_pkey" PRIMARY KEY ("ID");


--
-- Name: PROJECT_STRUCTURE PROJECT_STRUCTURE_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."PROJECT_STRUCTURE"
    ADD CONSTRAINT "PROJECT_STRUCTURE_pkey" PRIMARY KEY ("ID");


--
-- Name: PROJECT_TYPE PROJECT_TYPE_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."PROJECT_TYPE"
    ADD CONSTRAINT "PROJECT_TYPE_pkey" PRIMARY KEY ("ID");


--
-- Name: PROJECT PROJECT_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."PROJECT"
    ADD CONSTRAINT "PROJECT_pkey" PRIMARY KEY ("ID");


--
-- Name: PUBLIC_HOLIDAY PUBLIC_HOLIDAY_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."PUBLIC_HOLIDAY"
    ADD CONSTRAINT "PUBLIC_HOLIDAY_pkey" PRIMARY KEY ("ID");


--
-- Name: PUSH_SUBSCRIPTION PUSH_SUBSCRIPTION_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."PUSH_SUBSCRIPTION"
    ADD CONSTRAINT "PUSH_SUBSCRIPTION_pkey" PRIMARY KEY ("ID");


--
-- Name: PUSH_TOKEN PUSH_TOKEN_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."PUSH_TOKEN"
    ADD CONSTRAINT "PUSH_TOKEN_pkey" PRIMARY KEY ("ID");


--
-- Name: RECENT_VIEW RECENT_VIEW_TENANT_ID_EMPLOYEE_ID_ENTITY_TYPE_ENTITY_ID_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."RECENT_VIEW"
    ADD CONSTRAINT "RECENT_VIEW_TENANT_ID_EMPLOYEE_ID_ENTITY_TYPE_ENTITY_ID_key" UNIQUE ("TENANT_ID", "EMPLOYEE_ID", "ENTITY_TYPE", "ENTITY_ID");


--
-- Name: RECENT_VIEW RECENT_VIEW_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."RECENT_VIEW"
    ADD CONSTRAINT "RECENT_VIEW_pkey" PRIMARY KEY ("ID");


--
-- Name: ROLE_PERMISSION ROLE_PERMISSION_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."ROLE_PERMISSION"
    ADD CONSTRAINT "ROLE_PERMISSION_pkey" PRIMARY KEY ("ROLE_ID", "PERMISSION_ID");


--
-- Name: ROLE ROLE_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."ROLE"
    ADD CONSTRAINT "ROLE_pkey" PRIMARY KEY ("ID");


--
-- Name: SALUTATION SALUTATION_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."SALUTATION"
    ADD CONSTRAINT "SALUTATION_pkey" PRIMARY KEY ("ID");


--
-- Name: SERVICE_REQUEST_ATTACHMENT SERVICE_REQUEST_ATTACHMENT_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."SERVICE_REQUEST_ATTACHMENT"
    ADD CONSTRAINT "SERVICE_REQUEST_ATTACHMENT_pkey" PRIMARY KEY ("ID");


--
-- Name: SERVICE_REQUEST_MESSAGE SERVICE_REQUEST_MESSAGE_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."SERVICE_REQUEST_MESSAGE"
    ADD CONSTRAINT "SERVICE_REQUEST_MESSAGE_pkey" PRIMARY KEY ("ID");


--
-- Name: SERVICE_REQUEST SERVICE_REQUEST_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."SERVICE_REQUEST"
    ADD CONSTRAINT "SERVICE_REQUEST_pkey" PRIMARY KEY ("ID");


--
-- Name: SE_RELEASE SE_RELEASE_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."SE_RELEASE"
    ADD CONSTRAINT "SE_RELEASE_pkey" PRIMARY KEY ("ID");


--
-- Name: SUGGESTION_ATTACHMENT SUGGESTION_ATTACHMENT_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."SUGGESTION_ATTACHMENT"
    ADD CONSTRAINT "SUGGESTION_ATTACHMENT_pkey" PRIMARY KEY ("ID");


--
-- Name: SUGGESTION_COMMENT SUGGESTION_COMMENT_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."SUGGESTION_COMMENT"
    ADD CONSTRAINT "SUGGESTION_COMMENT_pkey" PRIMARY KEY ("ID");


--
-- Name: SUGGESTION_VOTE SUGGESTION_VOTE_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."SUGGESTION_VOTE"
    ADD CONSTRAINT "SUGGESTION_VOTE_pkey" PRIMARY KEY ("ID");


--
-- Name: SUGGESTION SUGGESTION_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."SUGGESTION"
    ADD CONSTRAINT "SUGGESTION_pkey" PRIMARY KEY ("ID");


--
-- Name: TEC TEC_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."TEC"
    ADD CONSTRAINT "TEC_pkey" PRIMARY KEY ("ID");


--
-- Name: TENANTS TENANTS_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."TENANTS"
    ADD CONSTRAINT "TENANTS_pkey" PRIMARY KEY ("ID");


--
-- Name: TENANT_EMAIL_SETTINGS TENANT_EMAIL_SETTINGS_TENANT_ID_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."TENANT_EMAIL_SETTINGS"
    ADD CONSTRAINT "TENANT_EMAIL_SETTINGS_TENANT_ID_key" UNIQUE ("TENANT_ID");


--
-- Name: TENANT_EMAIL_SETTINGS TENANT_EMAIL_SETTINGS_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."TENANT_EMAIL_SETTINGS"
    ADD CONSTRAINT "TENANT_EMAIL_SETTINGS_pkey" PRIMARY KEY ("ID");


--
-- Name: TENANT_ENTITLEMENT_OVERRIDE TENANT_ENTITLEMENT_OVERRIDE_TENANT_ID_CAPABILITY_KEY_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."TENANT_ENTITLEMENT_OVERRIDE"
    ADD CONSTRAINT "TENANT_ENTITLEMENT_OVERRIDE_TENANT_ID_CAPABILITY_KEY_key" UNIQUE ("TENANT_ID", "CAPABILITY_KEY");


--
-- Name: TENANT_ENTITLEMENT_OVERRIDE TENANT_ENTITLEMENT_OVERRIDE_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."TENANT_ENTITLEMENT_OVERRIDE"
    ADD CONSTRAINT "TENANT_ENTITLEMENT_OVERRIDE_pkey" PRIMARY KEY ("ID");


--
-- Name: TENANT_LICENSE TENANT_LICENSE_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."TENANT_LICENSE"
    ADD CONSTRAINT "TENANT_LICENSE_pkey" PRIMARY KEY ("TENANT_ID");


--
-- Name: TENANT_SETTINGS TENANT_SETTINGS_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."TENANT_SETTINGS"
    ADD CONSTRAINT "TENANT_SETTINGS_pkey" PRIMARY KEY ("TENANT_ID", "KEY");


--
-- Name: TEXT_TEMPLATE TEXT_TEMPLATE_TENANT_ID_DOCUMENT_TYPE_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."TEXT_TEMPLATE"
    ADD CONSTRAINT "TEXT_TEMPLATE_TENANT_ID_DOCUMENT_TYPE_key" UNIQUE ("TENANT_ID", "DOCUMENT_TYPE");


--
-- Name: TEXT_TEMPLATE TEXT_TEMPLATE_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."TEXT_TEMPLATE"
    ADD CONSTRAINT "TEXT_TEMPLATE_pkey" PRIMARY KEY ("ID");


--
-- Name: USER_ACHIEVEMENT USER_ACHIEVEMENT_TENANT_ID_EMPLOYEE_ID_ACHIEVEMENT_KEY_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."USER_ACHIEVEMENT"
    ADD CONSTRAINT "USER_ACHIEVEMENT_TENANT_ID_EMPLOYEE_ID_ACHIEVEMENT_KEY_key" UNIQUE ("TENANT_ID", "EMPLOYEE_ID", "ACHIEVEMENT_KEY");


--
-- Name: USER_ACHIEVEMENT USER_ACHIEVEMENT_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."USER_ACHIEVEMENT"
    ADD CONSTRAINT "USER_ACHIEVEMENT_pkey" PRIMARY KEY ("ID");


--
-- Name: USER_ROLE USER_ROLE_TENANT_ID_NAME_SHORT_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."USER_ROLE"
    ADD CONSTRAINT "USER_ROLE_TENANT_ID_NAME_SHORT_key" UNIQUE ("TENANT_ID", "NAME_SHORT");


--
-- Name: USER_ROLE USER_ROLE_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."USER_ROLE"
    ADD CONSTRAINT "USER_ROLE_pkey" PRIMARY KEY ("ID");


--
-- Name: VACATION_ENTITLEMENT VACATION_ENTITLEMENT_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."VACATION_ENTITLEMENT"
    ADD CONSTRAINT "VACATION_ENTITLEMENT_pkey" PRIMARY KEY ("ID");


--
-- Name: VAT VAT_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."VAT"
    ADD CONSTRAINT "VAT_pkey" PRIMARY KEY ("ID");


--
-- Name: WORKING_TIME_MODEL WORKING_TIME_MODEL_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."WORKING_TIME_MODEL"
    ADD CONSTRAINT "WORKING_TIME_MODEL_pkey" PRIMARY KEY ("ID");


--
-- Name: document_number_range document_number_range_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.document_number_range
    ADD CONSTRAINT document_number_range_pkey PRIMARY KEY (id);


--
-- Name: INVOICE_DEDUCTION uq_invoice_deduction; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."INVOICE_DEDUCTION"
    ADD CONSTRAINT uq_invoice_deduction UNIQUE ("INVOICE_ID", "PARTIAL_PAYMENT_ID");


--
-- Name: MAHNUNG uq_mahnung_invoice; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."MAHNUNG"
    ADD CONSTRAINT uq_mahnung_invoice UNIQUE ("INVOICE_ID");


--
-- Name: MAHNUNG uq_mahnung_pp; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."MAHNUNG"
    ADD CONSTRAINT uq_mahnung_pp UNIQUE ("PP_ID");


--
-- Name: NOTIFICATION_TYPE_CONFIG uq_notif_cfg; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."NOTIFICATION_TYPE_CONFIG"
    ADD CONSTRAINT uq_notif_cfg UNIQUE ("TENANT_ID", "TYPE_KEY");


--
-- Name: NOTIFICATION_SCHEDULE_CONFIG uq_notif_schedule; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."NOTIFICATION_SCHEDULE_CONFIG"
    ADD CONSTRAINT uq_notif_schedule UNIQUE ("TENANT_ID", "TYPE_KEY");


--
-- Name: PUSH_SUBSCRIPTION uq_push_subscription_endpoint; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."PUSH_SUBSCRIPTION"
    ADD CONSTRAINT uq_push_subscription_endpoint UNIQUE ("ENDPOINT");


--
-- Name: PUSH_TOKEN uq_push_token; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."PUSH_TOKEN"
    ADD CONSTRAINT uq_push_token UNIQUE ("TOKEN");


--
-- Name: IDX_EMAIL_TEMPLATE_TENANT; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "IDX_EMAIL_TEMPLATE_TENANT" ON public."EMAIL_TEMPLATE" USING btree ("TENANT_ID");


--
-- Name: document_template_company_doctype_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX document_template_company_doctype_idx ON public."DOCUMENT_TEMPLATE" USING btree ("COMPANY_ID", "DOC_TYPE");


--
-- Name: document_template_family_version_uniq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX document_template_family_version_uniq ON public."DOCUMENT_TEMPLATE" USING btree ("FAMILY_ID", "VERSION");


--
-- Name: document_template_one_default_published; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX document_template_one_default_published ON public."DOCUMENT_TEMPLATE" USING btree ("COMPANY_ID", "DOC_TYPE") WHERE (("IS_DEFAULT" = true) AND ("STATUS" = 'PUBLISHED'::text) AND ("IS_ACTIVE" = true));


--
-- Name: document_template_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX document_template_status_idx ON public."DOCUMENT_TEMPLATE" USING btree ("STATUS");


--
-- Name: idx_absence_dates; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_absence_dates ON public."ABSENCE" USING btree ("DATE_FROM", "DATE_TO");


--
-- Name: idx_absence_employee; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_absence_employee ON public."ABSENCE" USING btree ("EMPLOYEE_ID");


--
-- Name: idx_absence_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_absence_tenant ON public."ABSENCE" USING btree ("TENANT_ID");


--
-- Name: idx_absence_type_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_absence_type_tenant ON public."ABSENCE_TYPE" USING btree ("TENANT_ID");


--
-- Name: idx_address_import_batch; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_address_import_batch ON public."ADDRESS" USING btree ("IMPORT_BATCH_ID");


--
-- Name: idx_arbzg_audit_event; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_arbzg_audit_event ON public."ARBZG_AUDIT" USING btree ("TENANT_ID", "EVENT_TYPE", "CREATED_AT");


--
-- Name: idx_arbzg_audit_lookup; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_arbzg_audit_lookup ON public."ARBZG_AUDIT" USING btree ("TENANT_ID", "EMPLOYEE_ID", "DATE_VOUCHER");


--
-- Name: idx_asset_company; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_asset_company ON public."ASSET" USING btree ("COMPANY_ID");


--
-- Name: idx_asset_type_company; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_asset_type_company ON public."ASSET" USING btree ("COMPANY_ID", "ASSET_TYPE");


--
-- Name: idx_booking_text_snippet_emp; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_booking_text_snippet_emp ON public."BOOKING_TEXT_SNIPPET" USING btree ("EMPLOYEE_ID");


--
-- Name: idx_booking_text_snippet_scope; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_booking_text_snippet_scope ON public."BOOKING_TEXT_SNIPPET" USING btree ("TENANT_ID", "SCOPE");


--
-- Name: idx_booking_type_project; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_booking_type_project ON public."BOOKING_TYPE" USING btree ("PROJECT_ID");


--
-- Name: idx_booking_type_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_booking_type_tenant ON public."BOOKING_TYPE" USING btree ("TENANT_ID");


--
-- Name: idx_break_rule_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_break_rule_tenant ON public."BREAK_RULE" USING btree ("TENANT_ID");


--
-- Name: idx_bw_fired_rule; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bw_fired_rule ON public."BUDGET_WARNING_FIRED" USING btree ("RULE_ID");


--
-- Name: idx_bw_rule_project; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bw_rule_project ON public."BUDGET_WARNING_RULE" USING btree ("PROJECT_ID");


--
-- Name: idx_bw_rule_structure; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bw_rule_structure ON public."BUDGET_WARNING_RULE" USING btree ("STRUCTURE_ID");


--
-- Name: idx_bw_rule_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bw_rule_tenant ON public."BUDGET_WARNING_RULE" USING btree ("TENANT_ID");


--
-- Name: idx_capability_permission_perm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_capability_permission_perm ON public."CAPABILITY_PERMISSION" USING btree ("PERMISSION_KEY");


--
-- Name: idx_contacts_import_batch; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_contacts_import_batch ON public."CONTACTS" USING btree ("IMPORT_BATCH_ID");


--
-- Name: idx_contract_import_batch; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_contract_import_batch ON public."CONTRACT" USING btree ("IMPORT_BATCH_ID");


--
-- Name: idx_crc; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_crc ON public."COST_RATE_CONFIG" USING btree ("TENANT_ID", "YEAR");


--
-- Name: idx_din276_estimate_offer; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_din276_estimate_offer ON public."DIN276_COST_ESTIMATE" USING btree ("TENANT_ID", "OFFER_ID");


--
-- Name: idx_din276_estimate_project; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_din276_estimate_project ON public."DIN276_COST_ESTIMATE" USING btree ("TENANT_ID", "PROJECT_ID");


--
-- Name: idx_din276_group_estimate; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_din276_group_estimate ON public."DIN276_COST_GROUP" USING btree ("TENANT_ID", "ESTIMATE_ID");


--
-- Name: idx_doc_number_range_company; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_doc_number_range_company ON public.document_number_range USING btree (company_id);


--
-- Name: idx_doc_template_company_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_doc_template_company_type ON public."DOCUMENT_TEMPLATE" USING btree ("COMPANY_ID", "DOC_TYPE");


--
-- Name: idx_doc_template_default; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_doc_template_default ON public."DOCUMENT_TEMPLATE" USING btree ("COMPANY_ID", "DOC_TYPE", "IS_DEFAULT");


--
-- Name: idx_ecr_employee; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ecr_employee ON public."EMPLOYEE_CP_RATE" USING btree ("EMPLOYEE_ID", "VALID_FROM");


--
-- Name: idx_emc_tenant_emp; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_emc_tenant_emp ON public."EMPLOYEE_MONTH_CLOSE" USING btree ("TENANT_ID", "EMPLOYEE_ID");


--
-- Name: idx_emc_tenant_period; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_emc_tenant_period ON public."EMPLOYEE_MONTH_CLOSE" USING btree ("TENANT_ID", "YEAR", "MONTH");


--
-- Name: idx_employee_import_batch; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_employee_import_batch ON public."EMPLOYEE" USING btree ("IMPORT_BATCH_ID");


--
-- Name: idx_employee_role_employee; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_employee_role_employee ON public."EMPLOYEE_ROLE" USING btree ("EMPLOYEE_ID");


--
-- Name: idx_employee_role_role; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_employee_role_role ON public."EMPLOYEE_ROLE" USING btree ("ROLE_ID");


--
-- Name: idx_entitlement_override_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_entitlement_override_tenant ON public."TENANT_ENTITLEMENT_OVERRIDE" USING btree ("TENANT_ID");


--
-- Name: idx_ewm_employee; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ewm_employee ON public."EMPLOYEE_WORK_MODEL" USING btree ("EMPLOYEE_ID", "VALID_FROM");


--
-- Name: idx_fee_calc_zone_split_master; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_fee_calc_zone_split_master ON public."FEE_CALC_ZONE_SPLIT" USING btree ("TENANT_ID", "FEE_CALC_MASTER_ID");


--
-- Name: idx_fee_zone_criterion_master; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_fee_zone_criterion_master ON public."FEE_ZONE_CRITERION" USING btree ("FEE_MASTER_ID");


--
-- Name: idx_fee_zone_lookup_master; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_fee_zone_lookup_master ON public."FEE_ZONE_LOOKUP" USING btree ("FEE_MASTER_ID");


--
-- Name: idx_fee_zone_threshold_master; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_fee_zone_threshold_master ON public."FEE_ZONE_THRESHOLD" USING btree ("FEE_MASTER_ID");


--
-- Name: idx_import_batch_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_import_batch_status ON public."IMPORT_BATCH" USING btree ("TENANT_ID", "STATUS");


--
-- Name: idx_import_batch_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_import_batch_tenant ON public."IMPORT_BATCH" USING btree ("TENANT_ID");


--
-- Name: idx_invoice_attachment_inv; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_invoice_attachment_inv ON public."INVOICE_ATTACHMENT" USING btree ("INVOICE_ID");


--
-- Name: idx_invoice_attachment_pp; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_invoice_attachment_pp ON public."INVOICE_ATTACHMENT" USING btree ("PP_ID");


--
-- Name: idx_invoice_attachment_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_invoice_attachment_tenant ON public."INVOICE_ATTACHMENT" USING btree ("TENANT_ID");


--
-- Name: idx_invoice_cancels_invoice_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_invoice_cancels_invoice_id ON public."INVOICE" USING btree ("CANCELS_INVOICE_ID") WHERE ("CANCELS_INVOICE_ID" IS NOT NULL);


--
-- Name: idx_invoice_import_batch; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_invoice_import_batch ON public."INVOICE" USING btree ("IMPORT_BATCH_ID");


--
-- Name: idx_invoice_structure_import_batch; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_invoice_structure_import_batch ON public."INVOICE_STRUCTURE" USING btree ("IMPORT_BATCH_ID");


--
-- Name: idx_landing_event_session; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_landing_event_session ON public."LANDING_EVENT" USING btree ("SESSION_KEY");


--
-- Name: idx_landing_event_time; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_landing_event_time ON public."LANDING_EVENT" USING btree ("CREATED_AT");


--
-- Name: idx_landing_event_type_time; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_landing_event_type_time ON public."LANDING_EVENT" USING btree ("EVENT_TYPE", "CREATED_AT");


--
-- Name: idx_license_capability_module; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_license_capability_module ON public."LICENSE_CAPABILITY" USING btree ("MODULE_KEY");


--
-- Name: idx_license_change_log_actor; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_license_change_log_actor ON public."LICENSE_CHANGE_LOG" USING btree ("ACTOR");


--
-- Name: idx_license_change_log_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_license_change_log_at ON public."LICENSE_CHANGE_LOG" USING btree ("AT");


--
-- Name: idx_license_change_log_entity; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_license_change_log_entity ON public."LICENSE_CHANGE_LOG" USING btree ("ENTITY", "AT" DESC);


--
-- Name: idx_lph_block_master; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_lph_block_master ON public."LPH_BLOCK" USING btree ("TENANT_ID", "FEE_MASTER_ID");


--
-- Name: idx_lph_block_phase_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_lph_block_phase_tenant ON public."LPH_BLOCK_PHASE" USING btree ("TENANT_ID", "FEE_PHASE_ID");


--
-- Name: idx_nachtrag_audit_nachtrag; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_nachtrag_audit_nachtrag ON public."NACHTRAG_AUDIT" USING btree ("NACHTRAG_ID");


--
-- Name: idx_nachtrag_project; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_nachtrag_project ON public."NACHTRAG" USING btree ("PROJECT_ID");


--
-- Name: idx_nachtrag_release_nachtrag; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_nachtrag_release_nachtrag ON public."NACHTRAG_RELEASE" USING btree ("NACHTRAG_ID");


--
-- Name: idx_nachtrag_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_nachtrag_status ON public."NACHTRAG" USING btree ("NACHTRAG_STATUS_ID");


--
-- Name: idx_nachtrag_structure_father; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_nachtrag_structure_father ON public."NACHTRAG_STRUCTURE" USING btree ("FATHER_ID");


--
-- Name: idx_nachtrag_structure_nachtrag; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_nachtrag_structure_nachtrag ON public."NACHTRAG_STRUCTURE" USING btree ("NACHTRAG_ID");


--
-- Name: idx_nachtrag_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_nachtrag_tenant ON public."NACHTRAG" USING btree ("TENANT_ID");


--
-- Name: idx_notif_cfg_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notif_cfg_tenant ON public."NOTIFICATION_TYPE_CONFIG" USING btree ("TENANT_ID");


--
-- Name: idx_notif_schedule_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notif_schedule_tenant ON public."NOTIFICATION_SCHEDULE_CONFIG" USING btree ("TENANT_ID");


--
-- Name: idx_notification_tenant_user_unread; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notification_tenant_user_unread ON public."NOTIFICATION" USING btree ("TENANT_ID", "USER_ID") WHERE ("READ_AT" IS NULL);


--
-- Name: idx_partial_payment_import_batch; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_partial_payment_import_batch ON public."PARTIAL_PAYMENT" USING btree ("IMPORT_BATCH_ID");


--
-- Name: idx_payment_import_batch; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_payment_import_batch ON public."PAYMENT" USING btree ("IMPORT_BATCH_ID");


--
-- Name: idx_payment_structure_import_batch; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_payment_structure_import_batch ON public."PAYMENT_STRUCTURE" USING btree ("IMPORT_BATCH_ID");


--
-- Name: idx_permission_module; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_permission_module ON public."PERMISSION" USING btree ("MODULE");


--
-- Name: idx_ph_lookup; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ph_lookup ON public."PUBLIC_HOLIDAY" USING btree ("COUNTRY_CODE", "STATE_CODE", "HOLIDAY_DATE");


--
-- Name: idx_plan_capability_cap; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_plan_capability_cap ON public."PLAN_CAPABILITY" USING btree ("CAPABILITY_KEY");


--
-- Name: idx_pp_cancels_pp_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pp_cancels_pp_id ON public."PARTIAL_PAYMENT" USING btree ("CANCELS_PARTIAL_PAYMENT_ID") WHERE ("CANCELS_PARTIAL_PAYMENT_ID" IS NOT NULL);


--
-- Name: idx_pps_import_batch; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pps_import_batch ON public."PARTIAL_PAYMENT_STRUCTURE" USING btree ("IMPORT_BATCH_ID");


--
-- Name: idx_project_booking_price_project; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_project_booking_price_project ON public."PROJECT_BOOKING_PRICE" USING btree ("PROJECT_ID");


--
-- Name: idx_project_booking_price_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_project_booking_price_tenant ON public."PROJECT_BOOKING_PRICE" USING btree ("TENANT_ID");


--
-- Name: idx_project_import_batch; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_project_import_batch ON public."PROJECT" USING btree ("IMPORT_BATCH_ID");


--
-- Name: idx_project_progress_import_batch; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_project_progress_import_batch ON public."PROJECT_PROGRESS" USING btree ("IMPORT_BATCH_ID");


--
-- Name: idx_project_structure_import_batch; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_project_structure_import_batch ON public."PROJECT_STRUCTURE" USING btree ("IMPORT_BATCH_ID");


--
-- Name: idx_project_structure_nachtrag; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_project_structure_nachtrag ON public."PROJECT_STRUCTURE" USING btree ("NACHTRAG_ID");


--
-- Name: idx_push_sub_tenant_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_push_sub_tenant_user ON public."PUSH_SUBSCRIPTION" USING btree ("TENANT_ID", "USER_ID");


--
-- Name: idx_push_token_employee; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_push_token_employee ON public."PUSH_TOKEN" USING btree ("EMPLOYEE_ID");


--
-- Name: idx_push_token_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_push_token_tenant ON public."PUSH_TOKEN" USING btree ("TENANT_ID");


--
-- Name: idx_se_release_invoice; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_se_release_invoice ON public."SE_RELEASE" USING btree ("INVOICE_ID");


--
-- Name: idx_se_release_partial; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_se_release_partial ON public."SE_RELEASE" USING btree ("PARTIAL_PAYMENT_ID");


--
-- Name: idx_se_release_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_se_release_tenant ON public."SE_RELEASE" USING btree ("TENANT_ID");


--
-- Name: idx_service_request_attach_req; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_service_request_attach_req ON public."SERVICE_REQUEST_ATTACHMENT" USING btree ("REQUEST_ID");


--
-- Name: idx_service_request_kind; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_service_request_kind ON public."SERVICE_REQUEST" USING btree ("KIND", "STATUS");


--
-- Name: idx_service_request_msg_req; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_service_request_msg_req ON public."SERVICE_REQUEST_MESSAGE" USING btree ("REQUEST_ID");


--
-- Name: idx_service_request_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_service_request_tenant ON public."SERVICE_REQUEST" USING btree ("TENANT_ID");


--
-- Name: idx_suggestion_attach_sug; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_suggestion_attach_sug ON public."SUGGESTION_ATTACHMENT" USING btree ("SUGGESTION_ID");


--
-- Name: idx_suggestion_comment_sug; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_suggestion_comment_sug ON public."SUGGESTION_COMMENT" USING btree ("SUGGESTION_ID");


--
-- Name: idx_suggestion_lifecycle; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_suggestion_lifecycle ON public."SUGGESTION" USING btree ("LIFECYCLE_STATUS");


--
-- Name: idx_suggestion_moderation; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_suggestion_moderation ON public."SUGGESTION" USING btree ("MODERATION_STATE");


--
-- Name: idx_suggestion_org_state; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_suggestion_org_state ON public."SUGGESTION" USING btree ("TENANT_ID", "ORG_STATE");


--
-- Name: idx_suggestion_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_suggestion_tenant ON public."SUGGESTION" USING btree ("TENANT_ID");


--
-- Name: idx_tec_emp_date_kind; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tec_emp_date_kind ON public."TEC" USING btree ("EMPLOYEE_ID", "DATE_VOUCHER", "ENTRY_KIND");


--
-- Name: idx_tec_employee_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tec_employee_date ON public."TEC" USING btree ("EMPLOYEE_ID", "DATE_VOUCHER");


--
-- Name: idx_tec_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tec_status ON public."TEC" USING btree ("STATUS");


--
-- Name: idx_tenant_email_settings_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tenant_email_settings_tenant ON public."TENANT_EMAIL_SETTINGS" USING btree ("TENANT_ID");


--
-- Name: idx_tenant_license_plan; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tenant_license_plan ON public."TENANT_LICENSE" USING btree ("PLAN_ID");


--
-- Name: idx_tenant_license_state; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tenant_license_state ON public."TENANT_LICENSE" USING btree ("STATE");


--
-- Name: idx_user_role_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_role_tenant ON public."USER_ROLE" USING btree ("TENANT_ID");


--
-- Name: ix_nrt_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_nrt_tenant ON public."NUMBER_RANGE_TEMPLATE" USING btree ("TENANT_ID");


--
-- Name: ix_recent_view_meta_project; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_recent_view_meta_project ON public."RECENT_VIEW" USING btree (((("META" ->> 'project_id'::text))::integer)) WHERE ("META" IS NOT NULL);


--
-- Name: ix_recent_view_user_type_seen; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_recent_view_user_type_seen ON public."RECENT_VIEW" USING btree ("TENANT_ID", "EMPLOYEE_ID", "ENTITY_TYPE", "LAST_SEEN" DESC);


--
-- Name: ix_user_achievement_emp_earned; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_user_achievement_emp_earned ON public."USER_ACHIEVEMENT" USING btree ("TENANT_ID", "EMPLOYEE_ID", "EARNED_AT" DESC);


--
-- Name: uq_bw_fired_open_per_rule; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_bw_fired_open_per_rule ON public."BUDGET_WARNING_FIRED" USING btree ("RULE_ID") WHERE ("RESET_AT" IS NULL);


--
-- Name: uq_doc_number_range; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_doc_number_range ON public.document_number_range USING btree (company_id, doc_type, year);


--
-- Name: uq_fee_zones_master_name; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_fee_zones_master_name ON public."FEE_ZONES" USING btree ("FEE_MASTER_ID", upper(TRIM(BOTH FROM "NAME_SHORT")));


--
-- Name: uq_license_plan_default; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_license_plan_default ON public."LICENSE_PLAN" USING btree ("IS_DEFAULT") WHERE "IS_DEFAULT";


--
-- Name: uq_portal_consent_emp_ver; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_portal_consent_emp_ver ON public."PORTAL_CONSENT" USING btree ("EMPLOYEE_ID", "DOC_VERSION");


--
-- Name: uq_suggestion_vote_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_suggestion_vote_tenant ON public."SUGGESTION_VOTE" USING btree ("SUGGESTION_ID", "TENANT_ID");


--
-- Name: uq_vac_entitlement; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_vac_entitlement ON public."VACATION_ENTITLEMENT" USING btree ("TENANT_ID", "EMPLOYEE_ID", "YEAR");


--
-- Name: ux_tenants_slug; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX ux_tenants_slug ON public."TENANTS" USING btree ("SLUG") WHERE ("SLUG" IS NOT NULL);


--
-- Name: ARBZG_AUDIT trg_arbzg_audit_immutable; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_arbzg_audit_immutable BEFORE UPDATE ON public."ARBZG_AUDIT" FOR EACH ROW EXECUTE FUNCTION public.protect_arbzg_audit_immutability();


--
-- Name: ARBZG_AUDIT trg_arbzg_audit_no_delete; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_arbzg_audit_no_delete BEFORE DELETE ON public."ARBZG_AUDIT" FOR EACH ROW EXECUTE FUNCTION public.protect_arbzg_audit_retention();


--
-- Name: PLAN_CAPABILITY trg_plan_capability_bump; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_plan_capability_bump AFTER INSERT OR DELETE OR UPDATE ON public."PLAN_CAPABILITY" FOR EACH ROW EXECUTE FUNCTION public.bump_license_plan_version();


--
-- Name: ADDRESS ADDRESS_COUNTRY_ID_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."ADDRESS"
    ADD CONSTRAINT "ADDRESS_COUNTRY_ID_fkey" FOREIGN KEY ("COUNTRY_ID") REFERENCES public."COUNTRY"("ID") ON UPDATE CASCADE;


--
-- Name: ADDRESS ADDRESS_TENANT_ID_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."ADDRESS"
    ADD CONSTRAINT "ADDRESS_TENANT_ID_fkey" FOREIGN KEY ("TENANT_ID") REFERENCES public."TENANTS"("ID");


--
-- Name: ASSET ASSET_TENANT_ID_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."ASSET"
    ADD CONSTRAINT "ASSET_TENANT_ID_fkey" FOREIGN KEY ("TENANT_ID") REFERENCES public."TENANTS"("ID");


--
-- Name: BUDGET_WARNING_FIRED BUDGET_WARNING_FIRED_RULE_ID_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."BUDGET_WARNING_FIRED"
    ADD CONSTRAINT "BUDGET_WARNING_FIRED_RULE_ID_fkey" FOREIGN KEY ("RULE_ID") REFERENCES public."BUDGET_WARNING_RULE"("ID") ON DELETE CASCADE;


--
-- Name: BUDGET_WARNING_RULE BUDGET_WARNING_RULE_CREATED_BY_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."BUDGET_WARNING_RULE"
    ADD CONSTRAINT "BUDGET_WARNING_RULE_CREATED_BY_fkey" FOREIGN KEY ("CREATED_BY") REFERENCES public."EMPLOYEE"("ID");


--
-- Name: BUDGET_WARNING_RULE BUDGET_WARNING_RULE_PROJECT_ID_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."BUDGET_WARNING_RULE"
    ADD CONSTRAINT "BUDGET_WARNING_RULE_PROJECT_ID_fkey" FOREIGN KEY ("PROJECT_ID") REFERENCES public."PROJECT"("ID") ON DELETE CASCADE;


--
-- Name: BUDGET_WARNING_RULE BUDGET_WARNING_RULE_STRUCTURE_ID_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."BUDGET_WARNING_RULE"
    ADD CONSTRAINT "BUDGET_WARNING_RULE_STRUCTURE_ID_fkey" FOREIGN KEY ("STRUCTURE_ID") REFERENCES public."PROJECT_STRUCTURE"("ID") ON DELETE CASCADE;


--
-- Name: CAPABILITY_PERMISSION CAPABILITY_PERMISSION_CAPABILITY_KEY_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."CAPABILITY_PERMISSION"
    ADD CONSTRAINT "CAPABILITY_PERMISSION_CAPABILITY_KEY_fkey" FOREIGN KEY ("CAPABILITY_KEY") REFERENCES public."LICENSE_CAPABILITY"("KEY") ON DELETE CASCADE;


--
-- Name: CAPABILITY_PERMISSION CAPABILITY_PERMISSION_PERMISSION_KEY_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."CAPABILITY_PERMISSION"
    ADD CONSTRAINT "CAPABILITY_PERMISSION_PERMISSION_KEY_fkey" FOREIGN KEY ("PERMISSION_KEY") REFERENCES public."PERMISSION"("KEY") ON DELETE CASCADE;


--
-- Name: COMPANY COMPANY_COUNTRY_ID_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."COMPANY"
    ADD CONSTRAINT "COMPANY_COUNTRY_ID_fkey" FOREIGN KEY ("COUNTRY_ID") REFERENCES public."COUNTRY"("ID") ON UPDATE CASCADE;


--
-- Name: COMPANY COMPANY_TENANT_ID_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."COMPANY"
    ADD CONSTRAINT "COMPANY_TENANT_ID_fkey" FOREIGN KEY ("TENANT_ID") REFERENCES public."TENANTS"("ID");


--
-- Name: CONTACTS CONTACTS_ADDRESS_ID_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."CONTACTS"
    ADD CONSTRAINT "CONTACTS_ADDRESS_ID_fkey" FOREIGN KEY ("ADDRESS_ID") REFERENCES public."ADDRESS"("ID") ON UPDATE CASCADE;


--
-- Name: CONTACTS CONTACTS_GENDER_ID_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."CONTACTS"
    ADD CONSTRAINT "CONTACTS_GENDER_ID_fkey" FOREIGN KEY ("GENDER_ID") REFERENCES public."GENDER"("ID") ON UPDATE CASCADE;


--
-- Name: CONTACTS CONTACTS_SALUTATION_ID_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."CONTACTS"
    ADD CONSTRAINT "CONTACTS_SALUTATION_ID_fkey" FOREIGN KEY ("SALUTATION_ID") REFERENCES public."SALUTATION"("ID") ON UPDATE CASCADE;


--
-- Name: CONTACTS CONTACTS_TENANT_ID_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."CONTACTS"
    ADD CONSTRAINT "CONTACTS_TENANT_ID_fkey" FOREIGN KEY ("TENANT_ID") REFERENCES public."TENANTS"("ID");


--
-- Name: CONTRACT CONTRACT_CURRENCY_ID_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."CONTRACT"
    ADD CONSTRAINT "CONTRACT_CURRENCY_ID_fkey" FOREIGN KEY ("CURRENCY_ID") REFERENCES public."CURRENCY"("ID") ON UPDATE CASCADE;


--
-- Name: CONTRACT CONTRACT_INVOICE_ADDRESS_ID_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."CONTRACT"
    ADD CONSTRAINT "CONTRACT_INVOICE_ADDRESS_ID_fkey" FOREIGN KEY ("INVOICE_ADDRESS_ID") REFERENCES public."ADDRESS"("ID") ON UPDATE CASCADE;


--
-- Name: CONTRACT CONTRACT_INVOICE_CONTACT_ID_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."CONTRACT"
    ADD CONSTRAINT "CONTRACT_INVOICE_CONTACT_ID_fkey" FOREIGN KEY ("INVOICE_CONTACT_ID") REFERENCES public."CONTACTS"("ID") ON UPDATE CASCADE;


--
-- Name: CONTRACT CONTRACT_PROJECT_ID_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."CONTRACT"
    ADD CONSTRAINT "CONTRACT_PROJECT_ID_fkey" FOREIGN KEY ("PROJECT_ID") REFERENCES public."PROJECT"("ID") ON UPDATE CASCADE;


--
-- Name: CONTRACT CONTRACT_TENANT_ID_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."CONTRACT"
    ADD CONSTRAINT "CONTRACT_TENANT_ID_fkey" FOREIGN KEY ("TENANT_ID") REFERENCES public."TENANTS"("ID");


--
-- Name: CONTRACT CONTRACT_VAT_ID_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."CONTRACT"
    ADD CONSTRAINT "CONTRACT_VAT_ID_fkey" FOREIGN KEY ("VAT_ID") REFERENCES public."VAT"("ID") ON UPDATE CASCADE;


--
-- Name: DEPARTMENT DEPARTMENT_TENANT_ID_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."DEPARTMENT"
    ADD CONSTRAINT "DEPARTMENT_TENANT_ID_fkey" FOREIGN KEY ("TENANT_ID") REFERENCES public."TENANTS"("ID");


--
-- Name: DIN276_COST_ESTIMATE DIN276_COST_ESTIMATE_OFFER_ID_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."DIN276_COST_ESTIMATE"
    ADD CONSTRAINT "DIN276_COST_ESTIMATE_OFFER_ID_fkey" FOREIGN KEY ("OFFER_ID") REFERENCES public."OFFER"("ID") ON DELETE CASCADE;


--
-- Name: DIN276_COST_ESTIMATE DIN276_COST_ESTIMATE_PROJECT_ID_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."DIN276_COST_ESTIMATE"
    ADD CONSTRAINT "DIN276_COST_ESTIMATE_PROJECT_ID_fkey" FOREIGN KEY ("PROJECT_ID") REFERENCES public."PROJECT"("ID") ON DELETE CASCADE;


--
-- Name: DIN276_COST_GROUP DIN276_COST_GROUP_ESTIMATE_ID_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."DIN276_COST_GROUP"
    ADD CONSTRAINT "DIN276_COST_GROUP_ESTIMATE_ID_fkey" FOREIGN KEY ("ESTIMATE_ID") REFERENCES public."DIN276_COST_ESTIMATE"("ID") ON DELETE CASCADE;


--
-- Name: DOCUMENT_TEMPLATE DOCUMENT_TEMPLATE_TENANT_ID_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."DOCUMENT_TEMPLATE"
    ADD CONSTRAINT "DOCUMENT_TEMPLATE_TENANT_ID_fkey" FOREIGN KEY ("TENANT_ID") REFERENCES public."TENANTS"("ID");


--
-- Name: EMPLOYEE2PROJECT EMPLOYEE2PROJECT_EMPLOYEE_ID_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."EMPLOYEE2PROJECT"
    ADD CONSTRAINT "EMPLOYEE2PROJECT_EMPLOYEE_ID_fkey" FOREIGN KEY ("EMPLOYEE_ID") REFERENCES public."EMPLOYEE"("ID") ON UPDATE CASCADE;


--
-- Name: EMPLOYEE2PROJECT EMPLOYEE2PROJECT_PROJECT_ID_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."EMPLOYEE2PROJECT"
    ADD CONSTRAINT "EMPLOYEE2PROJECT_PROJECT_ID_fkey" FOREIGN KEY ("PROJECT_ID") REFERENCES public."PROJECT"("ID") ON UPDATE CASCADE;


--
-- Name: EMPLOYEE2PROJECT EMPLOYEE2PROJECT_ROLE_ID_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."EMPLOYEE2PROJECT"
    ADD CONSTRAINT "EMPLOYEE2PROJECT_ROLE_ID_fkey" FOREIGN KEY ("ROLE_ID") REFERENCES public."ROLE"("ID") ON UPDATE CASCADE;


--
-- Name: EMPLOYEE2PROJECT EMPLOYEE2PROJECT_TENANT_ID_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."EMPLOYEE2PROJECT"
    ADD CONSTRAINT "EMPLOYEE2PROJECT_TENANT_ID_fkey" FOREIGN KEY ("TENANT_ID") REFERENCES public."TENANTS"("ID");


--
-- Name: EMPLOYEE EMPLOYEE_GENDER_ID_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."EMPLOYEE"
    ADD CONSTRAINT "EMPLOYEE_GENDER_ID_fkey" FOREIGN KEY ("GENDER_ID") REFERENCES public."GENDER"("ID") ON UPDATE CASCADE;


--
-- Name: EMPLOYEE_ROLE EMPLOYEE_ROLE_ASSIGNED_BY_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."EMPLOYEE_ROLE"
    ADD CONSTRAINT "EMPLOYEE_ROLE_ASSIGNED_BY_fkey" FOREIGN KEY ("ASSIGNED_BY") REFERENCES public."EMPLOYEE"("ID");


--
-- Name: EMPLOYEE_ROLE EMPLOYEE_ROLE_EMPLOYEE_ID_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."EMPLOYEE_ROLE"
    ADD CONSTRAINT "EMPLOYEE_ROLE_EMPLOYEE_ID_fkey" FOREIGN KEY ("EMPLOYEE_ID") REFERENCES public."EMPLOYEE"("ID") ON DELETE CASCADE;


--
-- Name: EMPLOYEE_ROLE EMPLOYEE_ROLE_ROLE_ID_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."EMPLOYEE_ROLE"
    ADD CONSTRAINT "EMPLOYEE_ROLE_ROLE_ID_fkey" FOREIGN KEY ("ROLE_ID") REFERENCES public."USER_ROLE"("ID") ON DELETE CASCADE;


--
-- Name: EMPLOYEE EMPLOYEE_SALUTATION_ID_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."EMPLOYEE"
    ADD CONSTRAINT "EMPLOYEE_SALUTATION_ID_fkey" FOREIGN KEY ("SALUTATION_ID") REFERENCES public."SALUTATION"("ID") ON UPDATE CASCADE;


--
-- Name: EMPLOYEE EMPLOYEE_TENANT_ID_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."EMPLOYEE"
    ADD CONSTRAINT "EMPLOYEE_TENANT_ID_fkey" FOREIGN KEY ("TENANT_ID") REFERENCES public."TENANTS"("ID");


--
-- Name: FEE_CALCULATION_BL FEE_CALCULATION_BL_FEE_CALC_MASTER_ID_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."FEE_CALCULATION_BL"
    ADD CONSTRAINT "FEE_CALCULATION_BL_FEE_CALC_MASTER_ID_fkey" FOREIGN KEY ("FEE_CALC_MASTER_ID") REFERENCES public."FEE_CALCULATION_MASTER"("ID") ON DELETE CASCADE;


--
-- Name: FEE_CALCULATION_BL FEE_CALCULATION_BL_LPH_PHASE_ID_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."FEE_CALCULATION_BL"
    ADD CONSTRAINT "FEE_CALCULATION_BL_LPH_PHASE_ID_fkey" FOREIGN KEY ("LPH_PHASE_ID") REFERENCES public."FEE_CALCULATION_PHASE"("ID") ON DELETE SET NULL;


--
-- Name: FEE_CALCULATION_MASTER FEE_CALCULATION_MASTER_ATTACH_TO_OFFER_STRUCTURE_ID_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."FEE_CALCULATION_MASTER"
    ADD CONSTRAINT "FEE_CALCULATION_MASTER_ATTACH_TO_OFFER_STRUCTURE_ID_fkey" FOREIGN KEY ("ATTACH_TO_OFFER_STRUCTURE_ID") REFERENCES public."OFFER_STRUCTURE"("ID") ON DELETE SET NULL;


--
-- Name: FEE_CALCULATION_MASTER FEE_CALCULATION_MASTER_DIN276_ESTIMATE_ID_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."FEE_CALCULATION_MASTER"
    ADD CONSTRAINT "FEE_CALCULATION_MASTER_DIN276_ESTIMATE_ID_fkey" FOREIGN KEY ("DIN276_ESTIMATE_ID") REFERENCES public."DIN276_COST_ESTIMATE"("ID") ON DELETE SET NULL;


--
-- Name: FEE_CALCULATION_MASTER FEE_CALCULATION_MASTER_FEE_MASTER_ID_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."FEE_CALCULATION_MASTER"
    ADD CONSTRAINT "FEE_CALCULATION_MASTER_FEE_MASTER_ID_fkey" FOREIGN KEY ("FEE_MASTER_ID") REFERENCES public."FEE_MASTERS"("ID") ON UPDATE CASCADE;


--
-- Name: FEE_CALCULATION_MASTER FEE_CALCULATION_MASTER_OFFER_ID_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."FEE_CALCULATION_MASTER"
    ADD CONSTRAINT "FEE_CALCULATION_MASTER_OFFER_ID_fkey" FOREIGN KEY ("OFFER_ID") REFERENCES public."OFFER"("ID") ON DELETE SET NULL;


--
-- Name: FEE_CALCULATION_MASTER FEE_CALCULATION_MASTER_PROJECT_ID_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."FEE_CALCULATION_MASTER"
    ADD CONSTRAINT "FEE_CALCULATION_MASTER_PROJECT_ID_fkey" FOREIGN KEY ("PROJECT_ID") REFERENCES public."PROJECT"("ID") ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: FEE_CALCULATION_MASTER FEE_CALCULATION_MASTER_ZONE_ID_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."FEE_CALCULATION_MASTER"
    ADD CONSTRAINT "FEE_CALCULATION_MASTER_ZONE_ID_fkey" FOREIGN KEY ("ZONE_ID") REFERENCES public."FEE_ZONES"("ID") ON UPDATE CASCADE;


--
-- Name: FEE_CALCULATION_PHASE FEE_CALCULATION_PHASE_FEE_MASTER_ID_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."FEE_CALCULATION_PHASE"
    ADD CONSTRAINT "FEE_CALCULATION_PHASE_FEE_MASTER_ID_fkey" FOREIGN KEY ("FEE_MASTER_ID") REFERENCES public."FEE_CALCULATION_MASTER"("ID") ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: FEE_CALCULATION_PHASE FEE_CALCULATION_PHASE_FEE_PHASE_ID_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."FEE_CALCULATION_PHASE"
    ADD CONSTRAINT "FEE_CALCULATION_PHASE_FEE_PHASE_ID_fkey" FOREIGN KEY ("FEE_PHASE_ID") REFERENCES public."FEE_PHASE"("ID") ON UPDATE CASCADE;


--
-- Name: FEE_CALCULATION_SURCHARGES FEE_CALCULATION_SURCHARGES_FEE_CALC_MASTER_ID_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."FEE_CALCULATION_SURCHARGES"
    ADD CONSTRAINT "FEE_CALCULATION_SURCHARGES_FEE_CALC_MASTER_ID_fkey" FOREIGN KEY ("FEE_CALC_MASTER_ID") REFERENCES public."FEE_CALCULATION_MASTER"("ID") ON DELETE CASCADE;


--
-- Name: FEE_CALCULATION_SURCHARGES FEE_CALCULATION_SURCHARGES_FEE_SURCHARGE_ID_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."FEE_CALCULATION_SURCHARGES"
    ADD CONSTRAINT "FEE_CALCULATION_SURCHARGES_FEE_SURCHARGE_ID_fkey" FOREIGN KEY ("FEE_SURCHARGE_ID") REFERENCES public."FEE_SURCHARGES"("ID");


--
-- Name: FEE_CALC_ZONE_SPLIT FEE_CALC_ZONE_SPLIT_FEE_CALC_MASTER_ID_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."FEE_CALC_ZONE_SPLIT"
    ADD CONSTRAINT "FEE_CALC_ZONE_SPLIT_FEE_CALC_MASTER_ID_fkey" FOREIGN KEY ("FEE_CALC_MASTER_ID") REFERENCES public."FEE_CALCULATION_MASTER"("ID") ON DELETE CASCADE;


--
-- Name: FEE_CALC_ZONE_SPLIT FEE_CALC_ZONE_SPLIT_ZONE_ID_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."FEE_CALC_ZONE_SPLIT"
    ADD CONSTRAINT "FEE_CALC_ZONE_SPLIT_ZONE_ID_fkey" FOREIGN KEY ("ZONE_ID") REFERENCES public."FEE_ZONES"("ID");


--
-- Name: FEE_MASTERS FEE_MASTER_FEE_GROUP_ID_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."FEE_MASTERS"
    ADD CONSTRAINT "FEE_MASTER_FEE_GROUP_ID_fkey" FOREIGN KEY ("FEE_GROUP_ID") REFERENCES public."FEE_GROUPS"("ID") ON UPDATE CASCADE;


--
-- Name: FEE_PHASE FEE_PHASE_FEE_MASTER_ID_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."FEE_PHASE"
    ADD CONSTRAINT "FEE_PHASE_FEE_MASTER_ID_fkey" FOREIGN KEY ("FEE_MASTER_ID") REFERENCES public."FEE_MASTERS"("ID") ON UPDATE CASCADE;


--
-- Name: FEE_SURCHARGES2MASTER FEE_SURCHARGES2MASTER_FEE_MASTER_ID_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."FEE_SURCHARGES2MASTER"
    ADD CONSTRAINT "FEE_SURCHARGES2MASTER_FEE_MASTER_ID_fkey" FOREIGN KEY ("FEE_MASTER_ID") REFERENCES public."FEE_MASTERS"("ID") ON UPDATE CASCADE;


--
-- Name: FEE_SURCHARGES2MASTER FEE_SURCHARGES2MASTER_FEE_SURCHARGE_ID_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."FEE_SURCHARGES2MASTER"
    ADD CONSTRAINT "FEE_SURCHARGES2MASTER_FEE_SURCHARGE_ID_fkey" FOREIGN KEY ("FEE_SURCHARGE_ID") REFERENCES public."FEE_SURCHARGES"("ID") ON UPDATE CASCADE;


--
-- Name: FEE_TABLES FEE_TABLES_FEE_MASTER_ID_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."FEE_TABLES"
    ADD CONSTRAINT "FEE_TABLES_FEE_MASTER_ID_fkey" FOREIGN KEY ("FEE_MASTER_ID") REFERENCES public."FEE_MASTERS"("ID") ON UPDATE CASCADE;


--
-- Name: FEE_ZONES FEE_ZONES_FEE_MASTER_ID_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."FEE_ZONES"
    ADD CONSTRAINT "FEE_ZONES_FEE_MASTER_ID_fkey" FOREIGN KEY ("FEE_MASTER_ID") REFERENCES public."FEE_MASTERS"("ID") ON UPDATE CASCADE;


--
-- Name: FEE_ZONE_CRITERION FEE_ZONE_CRITERION_FEE_MASTER_ID_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."FEE_ZONE_CRITERION"
    ADD CONSTRAINT "FEE_ZONE_CRITERION_FEE_MASTER_ID_fkey" FOREIGN KEY ("FEE_MASTER_ID") REFERENCES public."FEE_MASTERS"("ID") ON DELETE CASCADE;


--
-- Name: FEE_ZONE_LOOKUP FEE_ZONE_LOOKUP_FEE_MASTER_ID_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."FEE_ZONE_LOOKUP"
    ADD CONSTRAINT "FEE_ZONE_LOOKUP_FEE_MASTER_ID_fkey" FOREIGN KEY ("FEE_MASTER_ID") REFERENCES public."FEE_MASTERS"("ID") ON DELETE CASCADE;


--
-- Name: FEE_ZONE_LOOKUP FEE_ZONE_LOOKUP_ZONE_ID_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."FEE_ZONE_LOOKUP"
    ADD CONSTRAINT "FEE_ZONE_LOOKUP_ZONE_ID_fkey" FOREIGN KEY ("ZONE_ID") REFERENCES public."FEE_ZONES"("ID");


--
-- Name: FEE_ZONE_THRESHOLD FEE_ZONE_THRESHOLD_FEE_MASTER_ID_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."FEE_ZONE_THRESHOLD"
    ADD CONSTRAINT "FEE_ZONE_THRESHOLD_FEE_MASTER_ID_fkey" FOREIGN KEY ("FEE_MASTER_ID") REFERENCES public."FEE_MASTERS"("ID") ON DELETE CASCADE;


--
-- Name: FEE_ZONE_THRESHOLD FEE_ZONE_THRESHOLD_ZONE_ID_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."FEE_ZONE_THRESHOLD"
    ADD CONSTRAINT "FEE_ZONE_THRESHOLD_ZONE_ID_fkey" FOREIGN KEY ("ZONE_ID") REFERENCES public."FEE_ZONES"("ID");


--
-- Name: INVOICE_ATTACHMENT INVOICE_ATTACHMENT_ASSET_ID_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."INVOICE_ATTACHMENT"
    ADD CONSTRAINT "INVOICE_ATTACHMENT_ASSET_ID_fkey" FOREIGN KEY ("ASSET_ID") REFERENCES public."ASSET"("ID") ON DELETE CASCADE;


--
-- Name: INVOICE_ATTACHMENT INVOICE_ATTACHMENT_INVOICE_ID_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."INVOICE_ATTACHMENT"
    ADD CONSTRAINT "INVOICE_ATTACHMENT_INVOICE_ID_fkey" FOREIGN KEY ("INVOICE_ID") REFERENCES public."INVOICE"("ID") ON DELETE CASCADE;


--
-- Name: INVOICE_ATTACHMENT INVOICE_ATTACHMENT_PP_ID_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."INVOICE_ATTACHMENT"
    ADD CONSTRAINT "INVOICE_ATTACHMENT_PP_ID_fkey" FOREIGN KEY ("PP_ID") REFERENCES public."PARTIAL_PAYMENT"("ID") ON DELETE CASCADE;


--
-- Name: INVOICE INVOICE_CANCELS_INVOICE_ID_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."INVOICE"
    ADD CONSTRAINT "INVOICE_CANCELS_INVOICE_ID_fkey" FOREIGN KEY ("CANCELS_INVOICE_ID") REFERENCES public."INVOICE"("ID") ON DELETE SET NULL;


--
-- Name: INVOICE INVOICE_COMPANY_ID_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."INVOICE"
    ADD CONSTRAINT "INVOICE_COMPANY_ID_fkey" FOREIGN KEY ("COMPANY_ID") REFERENCES public."COMPANY"("ID") ON UPDATE CASCADE;


--
-- Name: INVOICE INVOICE_CONTRACT_ID_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."INVOICE"
    ADD CONSTRAINT "INVOICE_CONTRACT_ID_fkey" FOREIGN KEY ("CONTRACT_ID") REFERENCES public."CONTRACT"("ID") ON UPDATE CASCADE;


--
-- Name: INVOICE INVOICE_CURRENCY_ID_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."INVOICE"
    ADD CONSTRAINT "INVOICE_CURRENCY_ID_fkey" FOREIGN KEY ("CURRENCY_ID") REFERENCES public."CURRENCY"("ID") ON UPDATE CASCADE;


--
-- Name: INVOICE INVOICE_EMPLOYEE_ID_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."INVOICE"
    ADD CONSTRAINT "INVOICE_EMPLOYEE_ID_fkey" FOREIGN KEY ("EMPLOYEE_ID") REFERENCES public."EMPLOYEE"("ID") ON UPDATE CASCADE;


--
-- Name: INVOICE INVOICE_INVOICE_ADDRESS_ID_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."INVOICE"
    ADD CONSTRAINT "INVOICE_INVOICE_ADDRESS_ID_fkey" FOREIGN KEY ("INVOICE_ADDRESS_ID") REFERENCES public."ADDRESS"("ID") ON UPDATE CASCADE;


--
-- Name: INVOICE INVOICE_INVOICE_CONTACT_ID_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."INVOICE"
    ADD CONSTRAINT "INVOICE_INVOICE_CONTACT_ID_fkey" FOREIGN KEY ("INVOICE_CONTACT_ID") REFERENCES public."CONTACTS"("ID") ON UPDATE CASCADE;


--
-- Name: INVOICE INVOICE_PAYMENT_MEANS_ID_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."INVOICE"
    ADD CONSTRAINT "INVOICE_PAYMENT_MEANS_ID_fkey" FOREIGN KEY ("PAYMENT_MEANS_ID") REFERENCES public."PAYMENT_MEANS"("ID") ON UPDATE CASCADE;


--
-- Name: INVOICE INVOICE_PROJECT_ID_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."INVOICE"
    ADD CONSTRAINT "INVOICE_PROJECT_ID_fkey" FOREIGN KEY ("PROJECT_ID") REFERENCES public."PROJECT"("ID") ON UPDATE CASCADE;


--
-- Name: INVOICE_STRUCTURE INVOICE_STRUCTURE_INVOICE_ID_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."INVOICE_STRUCTURE"
    ADD CONSTRAINT "INVOICE_STRUCTURE_INVOICE_ID_fkey" FOREIGN KEY ("INVOICE_ID") REFERENCES public."INVOICE"("ID") ON UPDATE CASCADE;


--
-- Name: INVOICE_STRUCTURE INVOICE_STRUCTURE_STRUCTURE_ID_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."INVOICE_STRUCTURE"
    ADD CONSTRAINT "INVOICE_STRUCTURE_STRUCTURE_ID_fkey" FOREIGN KEY ("STRUCTURE_ID") REFERENCES public."PROJECT_STRUCTURE"("ID") ON UPDATE CASCADE;


--
-- Name: INVOICE_STRUCTURE INVOICE_STRUCTURE_TENANT_ID_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."INVOICE_STRUCTURE"
    ADD CONSTRAINT "INVOICE_STRUCTURE_TENANT_ID_fkey" FOREIGN KEY ("TENANT_ID") REFERENCES public."TENANTS"("ID");


--
-- Name: INVOICE INVOICE_TENANT_ID_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."INVOICE"
    ADD CONSTRAINT "INVOICE_TENANT_ID_fkey" FOREIGN KEY ("TENANT_ID") REFERENCES public."TENANTS"("ID");


--
-- Name: LICENSE_CAPABILITY LICENSE_CAPABILITY_MODULE_KEY_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."LICENSE_CAPABILITY"
    ADD CONSTRAINT "LICENSE_CAPABILITY_MODULE_KEY_fkey" FOREIGN KEY ("MODULE_KEY") REFERENCES public."LICENSE_MODULE"("KEY") ON DELETE RESTRICT;


--
-- Name: LPH_BLOCK LPH_BLOCK_FEE_MASTER_ID_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."LPH_BLOCK"
    ADD CONSTRAINT "LPH_BLOCK_FEE_MASTER_ID_fkey" FOREIGN KEY ("FEE_MASTER_ID") REFERENCES public."FEE_MASTERS"("ID") ON DELETE CASCADE;


--
-- Name: LPH_BLOCK_PHASE LPH_BLOCK_PHASE_BLOCK_ID_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."LPH_BLOCK_PHASE"
    ADD CONSTRAINT "LPH_BLOCK_PHASE_BLOCK_ID_fkey" FOREIGN KEY ("BLOCK_ID") REFERENCES public."LPH_BLOCK"("ID") ON DELETE CASCADE;


--
-- Name: MAHNUNG_HISTORY MAHNUNG_HISTORY_EMPLOYEE_ID_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."MAHNUNG_HISTORY"
    ADD CONSTRAINT "MAHNUNG_HISTORY_EMPLOYEE_ID_fkey" FOREIGN KEY ("EMPLOYEE_ID") REFERENCES public."EMPLOYEE"("ID");


--
-- Name: MAHNUNG_HISTORY MAHNUNG_HISTORY_MAHNUNG_ID_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."MAHNUNG_HISTORY"
    ADD CONSTRAINT "MAHNUNG_HISTORY_MAHNUNG_ID_fkey" FOREIGN KEY ("MAHNUNG_ID") REFERENCES public."MAHNUNG"("ID") ON DELETE CASCADE;


--
-- Name: MAHNUNG MAHNUNG_INVOICE_ID_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."MAHNUNG"
    ADD CONSTRAINT "MAHNUNG_INVOICE_ID_fkey" FOREIGN KEY ("INVOICE_ID") REFERENCES public."INVOICE"("ID") ON DELETE CASCADE;


--
-- Name: MAHNUNG MAHNUNG_PP_ID_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."MAHNUNG"
    ADD CONSTRAINT "MAHNUNG_PP_ID_fkey" FOREIGN KEY ("PP_ID") REFERENCES public."PARTIAL_PAYMENT"("ID") ON DELETE CASCADE;


--
-- Name: MAHNUNG MAHNUNG_RESPONSIBLE_EMPLOYEE_ID_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."MAHNUNG"
    ADD CONSTRAINT "MAHNUNG_RESPONSIBLE_EMPLOYEE_ID_fkey" FOREIGN KEY ("RESPONSIBLE_EMPLOYEE_ID") REFERENCES public."EMPLOYEE"("ID");


--
-- Name: NOTIFICATION_SCHEDULE_CONFIG NOTIFICATION_SCHEDULE_CONFIG_TYPE_KEY_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."NOTIFICATION_SCHEDULE_CONFIG"
    ADD CONSTRAINT "NOTIFICATION_SCHEDULE_CONFIG_TYPE_KEY_fkey" FOREIGN KEY ("TYPE_KEY") REFERENCES public."NOTIFICATION_TYPE"("TYPE_KEY") ON DELETE CASCADE;


--
-- Name: NOTIFICATION_SCHEDULE_CONFIG NOTIFICATION_SCHEDULE_CONFIG_UPDATED_BY_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."NOTIFICATION_SCHEDULE_CONFIG"
    ADD CONSTRAINT "NOTIFICATION_SCHEDULE_CONFIG_UPDATED_BY_fkey" FOREIGN KEY ("UPDATED_BY") REFERENCES public."EMPLOYEE"("ID");


--
-- Name: NOTIFICATION_TYPE_CONFIG NOTIFICATION_TYPE_CONFIG_TYPE_KEY_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."NOTIFICATION_TYPE_CONFIG"
    ADD CONSTRAINT "NOTIFICATION_TYPE_CONFIG_TYPE_KEY_fkey" FOREIGN KEY ("TYPE_KEY") REFERENCES public."NOTIFICATION_TYPE"("TYPE_KEY") ON DELETE CASCADE;


--
-- Name: NOTIFICATION_TYPE_CONFIG NOTIFICATION_TYPE_CONFIG_UPDATED_BY_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."NOTIFICATION_TYPE_CONFIG"
    ADD CONSTRAINT "NOTIFICATION_TYPE_CONFIG_UPDATED_BY_fkey" FOREIGN KEY ("UPDATED_BY") REFERENCES public."EMPLOYEE"("ID");


--
-- Name: OFFER OFFER_ADDRESS_ID_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."OFFER"
    ADD CONSTRAINT "OFFER_ADDRESS_ID_fkey" FOREIGN KEY ("ADDRESS_ID") REFERENCES public."ADDRESS"("ID") ON UPDATE CASCADE;


--
-- Name: OFFER OFFER_COMPANY_ID_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."OFFER"
    ADD CONSTRAINT "OFFER_COMPANY_ID_fkey" FOREIGN KEY ("COMPANY_ID") REFERENCES public."COMPANY"("ID") ON UPDATE CASCADE;


--
-- Name: OFFER OFFER_CONTACT_ID_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."OFFER"
    ADD CONSTRAINT "OFFER_CONTACT_ID_fkey" FOREIGN KEY ("CONTACT_ID") REFERENCES public."CONTACTS"("ID") ON UPDATE CASCADE;


--
-- Name: OFFER OFFER_EMPLOYEE_ID_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."OFFER"
    ADD CONSTRAINT "OFFER_EMPLOYEE_ID_fkey" FOREIGN KEY ("EMPLOYEE_ID") REFERENCES public."EMPLOYEE"("ID") ON UPDATE CASCADE;


--
-- Name: OFFER OFFER_OFFER_STATUS_ID_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."OFFER"
    ADD CONSTRAINT "OFFER_OFFER_STATUS_ID_fkey" FOREIGN KEY ("OFFER_STATUS_ID") REFERENCES public."OFFER_STATUS"("ID") ON UPDATE CASCADE;


--
-- Name: OFFER OFFER_PROJECT_ID_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."OFFER"
    ADD CONSTRAINT "OFFER_PROJECT_ID_fkey" FOREIGN KEY ("PROJECT_ID") REFERENCES public."PROJECT"("ID") ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: OFFER_STRUCTURE OFFER_STRUCTURE_BILLING_TYPE_ID_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."OFFER_STRUCTURE"
    ADD CONSTRAINT "OFFER_STRUCTURE_BILLING_TYPE_ID_fkey" FOREIGN KEY ("BILLING_TYPE_ID") REFERENCES public."BILLING_TYPE"("ID") ON UPDATE CASCADE;


--
-- Name: OFFER_STRUCTURE OFFER_STRUCTURE_OFFER_ID_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."OFFER_STRUCTURE"
    ADD CONSTRAINT "OFFER_STRUCTURE_OFFER_ID_fkey" FOREIGN KEY ("OFFER_ID") REFERENCES public."OFFER"("ID") ON UPDATE CASCADE;


--
-- Name: OFFER_STRUCTURE OFFER_STRUCTURE_ROLE_ID_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."OFFER_STRUCTURE"
    ADD CONSTRAINT "OFFER_STRUCTURE_ROLE_ID_fkey" FOREIGN KEY ("ROLE_ID") REFERENCES public."ROLE"("ID") ON UPDATE CASCADE;


--
-- Name: OFFER_STRUCTURE OFFER_STRUCTURE_TENANT_ID_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."OFFER_STRUCTURE"
    ADD CONSTRAINT "OFFER_STRUCTURE_TENANT_ID_fkey" FOREIGN KEY ("TENANT_ID") REFERENCES public."TENANTS"("ID") ON UPDATE CASCADE;


--
-- Name: OFFER OFFER_TENANT_ID_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."OFFER"
    ADD CONSTRAINT "OFFER_TENANT_ID_fkey" FOREIGN KEY ("TENANT_ID") REFERENCES public."TENANTS"("ID") ON UPDATE CASCADE;


--
-- Name: OFFER OFFER_VAT_ID_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."OFFER"
    ADD CONSTRAINT "OFFER_VAT_ID_fkey" FOREIGN KEY ("VAT_ID") REFERENCES public."VAT"("ID") ON UPDATE CASCADE;


--
-- Name: PARTIAL_PAYMENT PARTIAL_PAYMENT_CANCELS_PARTIAL_PAYMENT_ID_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."PARTIAL_PAYMENT"
    ADD CONSTRAINT "PARTIAL_PAYMENT_CANCELS_PARTIAL_PAYMENT_ID_fkey" FOREIGN KEY ("CANCELS_PARTIAL_PAYMENT_ID") REFERENCES public."PARTIAL_PAYMENT"("ID") ON DELETE SET NULL;


--
-- Name: PARTIAL_PAYMENT PARTIAL_PAYMENT_COMPANY_ID_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."PARTIAL_PAYMENT"
    ADD CONSTRAINT "PARTIAL_PAYMENT_COMPANY_ID_fkey" FOREIGN KEY ("COMPANY_ID") REFERENCES public."COMPANY"("ID") ON UPDATE CASCADE;


--
-- Name: PARTIAL_PAYMENT PARTIAL_PAYMENT_CONTRACT_ID_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."PARTIAL_PAYMENT"
    ADD CONSTRAINT "PARTIAL_PAYMENT_CONTRACT_ID_fkey" FOREIGN KEY ("CONTRACT_ID") REFERENCES public."CONTRACT"("ID") ON UPDATE CASCADE;


--
-- Name: PARTIAL_PAYMENT PARTIAL_PAYMENT_CURRENCY_ID_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."PARTIAL_PAYMENT"
    ADD CONSTRAINT "PARTIAL_PAYMENT_CURRENCY_ID_fkey" FOREIGN KEY ("CURRENCY_ID") REFERENCES public."CURRENCY"("ID") ON UPDATE CASCADE;


--
-- Name: PARTIAL_PAYMENT PARTIAL_PAYMENT_DOCUMENT_XML_ASSET_ID_FK; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."PARTIAL_PAYMENT"
    ADD CONSTRAINT "PARTIAL_PAYMENT_DOCUMENT_XML_ASSET_ID_FK" FOREIGN KEY ("DOCUMENT_XML_ASSET_ID") REFERENCES public."ASSET"("ID") ON DELETE SET NULL;


--
-- Name: PARTIAL_PAYMENT PARTIAL_PAYMENT_EMPLOYEE_ID_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."PARTIAL_PAYMENT"
    ADD CONSTRAINT "PARTIAL_PAYMENT_EMPLOYEE_ID_fkey" FOREIGN KEY ("EMPLOYEE_ID") REFERENCES public."EMPLOYEE"("ID") ON UPDATE CASCADE;


--
-- Name: PARTIAL_PAYMENT PARTIAL_PAYMENT_INVOICE_ADDRESS_ID_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."PARTIAL_PAYMENT"
    ADD CONSTRAINT "PARTIAL_PAYMENT_INVOICE_ADDRESS_ID_fkey" FOREIGN KEY ("PARTIAL_PAYMENT_ADDRESS_ID") REFERENCES public."ADDRESS"("ID") ON UPDATE CASCADE;


--
-- Name: PARTIAL_PAYMENT PARTIAL_PAYMENT_INVOICE_CONTACT_ID_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."PARTIAL_PAYMENT"
    ADD CONSTRAINT "PARTIAL_PAYMENT_INVOICE_CONTACT_ID_fkey" FOREIGN KEY ("PARTIAL_PAYMENT_CONTACT_ID") REFERENCES public."CONTACTS"("ID") ON UPDATE CASCADE;


--
-- Name: PARTIAL_PAYMENT PARTIAL_PAYMENT_INVOICE_ID_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."PARTIAL_PAYMENT"
    ADD CONSTRAINT "PARTIAL_PAYMENT_INVOICE_ID_fkey" FOREIGN KEY ("INVOICE_ID") REFERENCES public."INVOICE"("ID") ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: PARTIAL_PAYMENT PARTIAL_PAYMENT_PAYMENT_MEANS_ID_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."PARTIAL_PAYMENT"
    ADD CONSTRAINT "PARTIAL_PAYMENT_PAYMENT_MEANS_ID_fkey" FOREIGN KEY ("PAYMENT_MEANS_ID") REFERENCES public."PAYMENT_MEANS"("ID") ON UPDATE CASCADE;


--
-- Name: PARTIAL_PAYMENT PARTIAL_PAYMENT_PROJECT_ID_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."PARTIAL_PAYMENT"
    ADD CONSTRAINT "PARTIAL_PAYMENT_PROJECT_ID_fkey" FOREIGN KEY ("PROJECT_ID") REFERENCES public."PROJECT"("ID") ON UPDATE CASCADE;


--
-- Name: PARTIAL_PAYMENT PARTIAL_PAYMENT_SE_RELEASED_BY_INVOICE_ID_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."PARTIAL_PAYMENT"
    ADD CONSTRAINT "PARTIAL_PAYMENT_SE_RELEASED_BY_INVOICE_ID_fkey" FOREIGN KEY ("SE_RELEASED_BY_INVOICE_ID") REFERENCES public."INVOICE"("ID");


--
-- Name: PARTIAL_PAYMENT_STRUCTURE PARTIAL_PAYMENT_STRUCTURE_INVOICE_ID_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."PARTIAL_PAYMENT_STRUCTURE"
    ADD CONSTRAINT "PARTIAL_PAYMENT_STRUCTURE_INVOICE_ID_fkey" FOREIGN KEY ("INVOICE_ID") REFERENCES public."INVOICE"("ID") ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: PARTIAL_PAYMENT_STRUCTURE PARTIAL_PAYMENT_STRUCTURE_PARTIAL_PAYMENT_ID_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."PARTIAL_PAYMENT_STRUCTURE"
    ADD CONSTRAINT "PARTIAL_PAYMENT_STRUCTURE_PARTIAL_PAYMENT_ID_fkey" FOREIGN KEY ("PARTIAL_PAYMENT_ID") REFERENCES public."PARTIAL_PAYMENT"("ID") ON UPDATE CASCADE;


--
-- Name: PARTIAL_PAYMENT_STRUCTURE PARTIAL_PAYMENT_STRUCTURE_STRUCTURE_ID_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."PARTIAL_PAYMENT_STRUCTURE"
    ADD CONSTRAINT "PARTIAL_PAYMENT_STRUCTURE_STRUCTURE_ID_fkey" FOREIGN KEY ("STRUCTURE_ID") REFERENCES public."PROJECT_STRUCTURE"("ID") ON UPDATE CASCADE;


--
-- Name: PARTIAL_PAYMENT_STRUCTURE PARTIAL_PAYMENT_STRUCTURE_TENANT_ID_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."PARTIAL_PAYMENT_STRUCTURE"
    ADD CONSTRAINT "PARTIAL_PAYMENT_STRUCTURE_TENANT_ID_fkey" FOREIGN KEY ("TENANT_ID") REFERENCES public."TENANTS"("ID");


--
-- Name: PARTIAL_PAYMENT PARTIAL_PAYMENT_TENANT_ID_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."PARTIAL_PAYMENT"
    ADD CONSTRAINT "PARTIAL_PAYMENT_TENANT_ID_fkey" FOREIGN KEY ("TENANT_ID") REFERENCES public."TENANTS"("ID");


--
-- Name: PAYMENT PAYMENT_CONTRACT_ID_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."PAYMENT"
    ADD CONSTRAINT "PAYMENT_CONTRACT_ID_fkey" FOREIGN KEY ("CONTRACT_ID") REFERENCES public."CONTRACT"("ID") ON UPDATE CASCADE;


--
-- Name: PAYMENT PAYMENT_INVOICE_ID_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."PAYMENT"
    ADD CONSTRAINT "PAYMENT_INVOICE_ID_fkey" FOREIGN KEY ("INVOICE_ID") REFERENCES public."INVOICE"("ID") ON UPDATE CASCADE;


--
-- Name: PAYMENT_MEANS PAYMENT_MEANS_TENANT_ID_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."PAYMENT_MEANS"
    ADD CONSTRAINT "PAYMENT_MEANS_TENANT_ID_fkey" FOREIGN KEY ("TENANT_ID") REFERENCES public."TENANTS"("ID");


--
-- Name: PAYMENT PAYMENT_PARTIAL_PAYMENT_ID_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."PAYMENT"
    ADD CONSTRAINT "PAYMENT_PARTIAL_PAYMENT_ID_fkey" FOREIGN KEY ("PARTIAL_PAYMENT_ID") REFERENCES public."PARTIAL_PAYMENT"("ID") ON UPDATE CASCADE;


--
-- Name: PAYMENT PAYMENT_PROJECT_ID_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."PAYMENT"
    ADD CONSTRAINT "PAYMENT_PROJECT_ID_fkey" FOREIGN KEY ("PROJECT_ID") REFERENCES public."PROJECT"("ID") ON UPDATE CASCADE;


--
-- Name: PAYMENT_STRUCTURE PAYMENT_STRUCTURE_INVOICE_ID_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."PAYMENT_STRUCTURE"
    ADD CONSTRAINT "PAYMENT_STRUCTURE_INVOICE_ID_fkey" FOREIGN KEY ("INVOICE_ID") REFERENCES public."INVOICE"("ID") ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: PAYMENT_STRUCTURE PAYMENT_STRUCTURE_PARTIAL_PAYMENT_ID_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."PAYMENT_STRUCTURE"
    ADD CONSTRAINT "PAYMENT_STRUCTURE_PARTIAL_PAYMENT_ID_fkey" FOREIGN KEY ("PARTIAL_PAYMENT_ID") REFERENCES public."PARTIAL_PAYMENT"("ID") ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: PAYMENT_STRUCTURE PAYMENT_STRUCTURE_PAYMENT_ID_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."PAYMENT_STRUCTURE"
    ADD CONSTRAINT "PAYMENT_STRUCTURE_PAYMENT_ID_fkey" FOREIGN KEY ("PAYMENT_ID") REFERENCES public."PAYMENT"("ID") ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: PAYMENT_STRUCTURE PAYMENT_STRUCTURE_STRUCTURE_ID_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."PAYMENT_STRUCTURE"
    ADD CONSTRAINT "PAYMENT_STRUCTURE_STRUCTURE_ID_fkey" FOREIGN KEY ("STRUCTURE_ID") REFERENCES public."PROJECT_STRUCTURE"("ID") ON UPDATE CASCADE;


--
-- Name: PAYMENT_STRUCTURE PAYMENT_STRUCTURE_TENANT_ID_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."PAYMENT_STRUCTURE"
    ADD CONSTRAINT "PAYMENT_STRUCTURE_TENANT_ID_fkey" FOREIGN KEY ("TENANT_ID") REFERENCES public."TENANTS"("ID") ON UPDATE CASCADE;


--
-- Name: PAYMENT PAYMENT_TENANT_ID_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."PAYMENT"
    ADD CONSTRAINT "PAYMENT_TENANT_ID_fkey" FOREIGN KEY ("TENANT_ID") REFERENCES public."TENANTS"("ID");


--
-- Name: PLAN_CAPABILITY PLAN_CAPABILITY_CAPABILITY_KEY_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."PLAN_CAPABILITY"
    ADD CONSTRAINT "PLAN_CAPABILITY_CAPABILITY_KEY_fkey" FOREIGN KEY ("CAPABILITY_KEY") REFERENCES public."LICENSE_CAPABILITY"("KEY") ON DELETE CASCADE;


--
-- Name: PLAN_CAPABILITY PLAN_CAPABILITY_PLAN_ID_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."PLAN_CAPABILITY"
    ADD CONSTRAINT "PLAN_CAPABILITY_PLAN_ID_fkey" FOREIGN KEY ("PLAN_ID") REFERENCES public."LICENSE_PLAN"("ID") ON DELETE CASCADE;


--
-- Name: PROJECT PROJECT_ADDRESS_ID_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."PROJECT"
    ADD CONSTRAINT "PROJECT_ADDRESS_ID_fkey" FOREIGN KEY ("ADDRESS_ID") REFERENCES public."ADDRESS"("ID") ON UPDATE CASCADE;


--
-- Name: PROJECT PROJECT_COMPANY_ID_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."PROJECT"
    ADD CONSTRAINT "PROJECT_COMPANY_ID_fkey" FOREIGN KEY ("COMPANY_ID") REFERENCES public."COMPANY"("ID") ON UPDATE CASCADE;


--
-- Name: PROJECT PROJECT_CONTACT_ID_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."PROJECT"
    ADD CONSTRAINT "PROJECT_CONTACT_ID_fkey" FOREIGN KEY ("CONTACT_ID") REFERENCES public."CONTACTS"("ID") ON UPDATE CASCADE;


--
-- Name: PROJECT PROJECT_DEPARTMENT_ID_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."PROJECT"
    ADD CONSTRAINT "PROJECT_DEPARTMENT_ID_fkey" FOREIGN KEY ("DEPARTMENT_ID") REFERENCES public."DEPARTMENT"("ID") ON UPDATE CASCADE;


--
-- Name: PROJECT PROJECT_OFFER_ID_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."PROJECT"
    ADD CONSTRAINT "PROJECT_OFFER_ID_fkey" FOREIGN KEY ("OFFER_ID") REFERENCES public."OFFER"("ID");


--
-- Name: PROJECT_PROGRESS PROJECT_PROGRESS_STRUCTURE_ID_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."PROJECT_PROGRESS"
    ADD CONSTRAINT "PROJECT_PROGRESS_STRUCTURE_ID_fkey" FOREIGN KEY ("STRUCTURE_ID") REFERENCES public."PROJECT_STRUCTURE"("ID") ON DELETE CASCADE;


--
-- Name: PROJECT_PROGRESS PROJECT_PROGRESS_TENANT_ID_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."PROJECT_PROGRESS"
    ADD CONSTRAINT "PROJECT_PROGRESS_TENANT_ID_fkey" FOREIGN KEY ("TENANT_ID") REFERENCES public."TENANTS"("ID");


--
-- Name: PROJECT PROJECT_PROJECT_MANAGER_ID_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."PROJECT"
    ADD CONSTRAINT "PROJECT_PROJECT_MANAGER_ID_fkey" FOREIGN KEY ("PROJECT_MANAGER_ID") REFERENCES public."EMPLOYEE"("ID") ON UPDATE CASCADE;


--
-- Name: PROJECT PROJECT_PROJECT_STATUS_ID_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."PROJECT"
    ADD CONSTRAINT "PROJECT_PROJECT_STATUS_ID_fkey" FOREIGN KEY ("PROJECT_STATUS_ID") REFERENCES public."PROJECT_STATUS"("ID") ON UPDATE CASCADE;


--
-- Name: PROJECT_SP_RATES PROJECT_SP_RATES_PROJECT_ID_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."PROJECT_SP_RATES"
    ADD CONSTRAINT "PROJECT_SP_RATES_PROJECT_ID_fkey" FOREIGN KEY ("PROJECT_ID") REFERENCES public."PROJECT"("ID") ON UPDATE CASCADE;


--
-- Name: PROJECT_SP_RATES PROJECT_SP_RATES_ROLE_ID_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."PROJECT_SP_RATES"
    ADD CONSTRAINT "PROJECT_SP_RATES_ROLE_ID_fkey" FOREIGN KEY ("ROLE_ID") REFERENCES public."ROLE"("ID") ON UPDATE CASCADE;


--
-- Name: PROJECT_SP_RATES PROJECT_SP_RATES_TENANT_ID_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."PROJECT_SP_RATES"
    ADD CONSTRAINT "PROJECT_SP_RATES_TENANT_ID_fkey" FOREIGN KEY ("TENANT_ID") REFERENCES public."TENANTS"("ID");


--
-- Name: PROJECT_STRUCTURE PROJECT_STRUCTURE_BILLING_TYPE_ID_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."PROJECT_STRUCTURE"
    ADD CONSTRAINT "PROJECT_STRUCTURE_BILLING_TYPE_ID_fkey" FOREIGN KEY ("BILLING_TYPE_ID") REFERENCES public."BILLING_TYPE"("ID") ON UPDATE CASCADE;


--
-- Name: PROJECT_STRUCTURE PROJECT_STRUCTURE_CLOSED_BY_INVOICE_ID_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."PROJECT_STRUCTURE"
    ADD CONSTRAINT "PROJECT_STRUCTURE_CLOSED_BY_INVOICE_ID_fkey" FOREIGN KEY ("CLOSED_BY_INVOICE_ID") REFERENCES public."INVOICE"("ID") ON UPDATE RESTRICT ON DELETE SET NULL;


--
-- Name: PROJECT_STRUCTURE PROJECT_STRUCTURE_CONTRACT_ID_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."PROJECT_STRUCTURE"
    ADD CONSTRAINT "PROJECT_STRUCTURE_CONTRACT_ID_fkey" FOREIGN KEY ("CONTRACT_ID") REFERENCES public."CONTRACT"("ID") ON UPDATE CASCADE;


--
-- Name: PROJECT_STRUCTURE PROJECT_STRUCTURE_FEE_CALC_BL_ID_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."PROJECT_STRUCTURE"
    ADD CONSTRAINT "PROJECT_STRUCTURE_FEE_CALC_BL_ID_fkey" FOREIGN KEY ("FEE_CALC_BL_ID") REFERENCES public."FEE_CALCULATION_BL"("ID") ON DELETE SET NULL;


--
-- Name: PROJECT_STRUCTURE PROJECT_STRUCTURE_FEE_CALC_MASTER_ID_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."PROJECT_STRUCTURE"
    ADD CONSTRAINT "PROJECT_STRUCTURE_FEE_CALC_MASTER_ID_fkey" FOREIGN KEY ("FEE_CALC_MASTER_ID") REFERENCES public."FEE_CALCULATION_MASTER"("ID") ON DELETE SET NULL;


--
-- Name: PROJECT_STRUCTURE PROJECT_STRUCTURE_FEE_CALC_PHASE_ID_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."PROJECT_STRUCTURE"
    ADD CONSTRAINT "PROJECT_STRUCTURE_FEE_CALC_PHASE_ID_fkey" FOREIGN KEY ("FEE_CALC_PHASE_ID") REFERENCES public."FEE_CALCULATION_PHASE"("ID") ON DELETE SET NULL;


--
-- Name: PROJECT_STRUCTURE PROJECT_STRUCTURE_PROJECT_ID_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."PROJECT_STRUCTURE"
    ADD CONSTRAINT "PROJECT_STRUCTURE_PROJECT_ID_fkey" FOREIGN KEY ("PROJECT_ID") REFERENCES public."PROJECT"("ID") ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: PROJECT_STRUCTURE PROJECT_STRUCTURE_TENANT_ID_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."PROJECT_STRUCTURE"
    ADD CONSTRAINT "PROJECT_STRUCTURE_TENANT_ID_fkey" FOREIGN KEY ("TENANT_ID") REFERENCES public."TENANTS"("ID");


--
-- Name: PROJECT PROJECT_TENANT_ID_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."PROJECT"
    ADD CONSTRAINT "PROJECT_TENANT_ID_fkey" FOREIGN KEY ("TENANT_ID") REFERENCES public."TENANTS"("ID");


--
-- Name: PROJECT_TYPE PROJECT_TYPE_TENANT_ID_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."PROJECT_TYPE"
    ADD CONSTRAINT "PROJECT_TYPE_TENANT_ID_fkey" FOREIGN KEY ("TENANT_ID") REFERENCES public."TENANTS"("ID");


--
-- Name: PUSH_TOKEN PUSH_TOKEN_EMPLOYEE_ID_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."PUSH_TOKEN"
    ADD CONSTRAINT "PUSH_TOKEN_EMPLOYEE_ID_fkey" FOREIGN KEY ("EMPLOYEE_ID") REFERENCES public."EMPLOYEE"("ID") ON DELETE CASCADE;


--
-- Name: ROLE_PERMISSION ROLE_PERMISSION_PERMISSION_ID_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."ROLE_PERMISSION"
    ADD CONSTRAINT "ROLE_PERMISSION_PERMISSION_ID_fkey" FOREIGN KEY ("PERMISSION_ID") REFERENCES public."PERMISSION"("ID") ON DELETE CASCADE;


--
-- Name: ROLE_PERMISSION ROLE_PERMISSION_ROLE_ID_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."ROLE_PERMISSION"
    ADD CONSTRAINT "ROLE_PERMISSION_ROLE_ID_fkey" FOREIGN KEY ("ROLE_ID") REFERENCES public."USER_ROLE"("ID") ON DELETE CASCADE;


--
-- Name: ROLE ROLE_TENANT_ID_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."ROLE"
    ADD CONSTRAINT "ROLE_TENANT_ID_fkey" FOREIGN KEY ("TENANT_ID") REFERENCES public."TENANTS"("ID");


--
-- Name: SE_RELEASE SE_RELEASE_INVOICE_ID_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."SE_RELEASE"
    ADD CONSTRAINT "SE_RELEASE_INVOICE_ID_fkey" FOREIGN KEY ("INVOICE_ID") REFERENCES public."INVOICE"("ID");


--
-- Name: SE_RELEASE SE_RELEASE_PARTIAL_PAYMENT_ID_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."SE_RELEASE"
    ADD CONSTRAINT "SE_RELEASE_PARTIAL_PAYMENT_ID_fkey" FOREIGN KEY ("PARTIAL_PAYMENT_ID") REFERENCES public."PARTIAL_PAYMENT"("ID");


--
-- Name: TEC TEC_EMPLOYEE_ID_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."TEC"
    ADD CONSTRAINT "TEC_EMPLOYEE_ID_fkey" FOREIGN KEY ("EMPLOYEE_ID") REFERENCES public."EMPLOYEE"("ID") ON UPDATE CASCADE;


--
-- Name: TEC TEC_INVOICE_ID_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."TEC"
    ADD CONSTRAINT "TEC_INVOICE_ID_fkey" FOREIGN KEY ("INVOICE_ID") REFERENCES public."INVOICE"("ID") ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: TEC TEC_PARTIAL_PAYMENT_ID_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."TEC"
    ADD CONSTRAINT "TEC_PARTIAL_PAYMENT_ID_fkey" FOREIGN KEY ("PARTIAL_PAYMENT_ID") REFERENCES public."PARTIAL_PAYMENT"("ID") ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: TEC TEC_PROJECT_ID_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."TEC"
    ADD CONSTRAINT "TEC_PROJECT_ID_fkey" FOREIGN KEY ("PROJECT_ID") REFERENCES public."PROJECT"("ID") ON UPDATE CASCADE;


--
-- Name: TEC TEC_ROLE_ID_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."TEC"
    ADD CONSTRAINT "TEC_ROLE_ID_fkey" FOREIGN KEY ("ROLE_ID") REFERENCES public."ROLE"("ID") ON UPDATE CASCADE;


--
-- Name: TEC TEC_STRUCTURE_ID_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."TEC"
    ADD CONSTRAINT "TEC_STRUCTURE_ID_fkey" FOREIGN KEY ("STRUCTURE_ID") REFERENCES public."PROJECT_STRUCTURE"("ID") ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: TEC TEC_TENANT_ID_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."TEC"
    ADD CONSTRAINT "TEC_TENANT_ID_fkey" FOREIGN KEY ("TENANT_ID") REFERENCES public."TENANTS"("ID");


--
-- Name: TENANT_ENTITLEMENT_OVERRIDE TENANT_ENTITLEMENT_OVERRIDE_CAPABILITY_KEY_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."TENANT_ENTITLEMENT_OVERRIDE"
    ADD CONSTRAINT "TENANT_ENTITLEMENT_OVERRIDE_CAPABILITY_KEY_fkey" FOREIGN KEY ("CAPABILITY_KEY") REFERENCES public."LICENSE_CAPABILITY"("KEY") ON DELETE CASCADE;


--
-- Name: TENANT_LICENSE TENANT_LICENSE_PLAN_ID_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."TENANT_LICENSE"
    ADD CONSTRAINT "TENANT_LICENSE_PLAN_ID_fkey" FOREIGN KEY ("PLAN_ID") REFERENCES public."LICENSE_PLAN"("ID");


--
-- Name: document_number_range document_number_range_COMPANY_ID_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.document_number_range
    ADD CONSTRAINT "document_number_range_COMPANY_ID_fkey" FOREIGN KEY ("COMPANY_ID") REFERENCES public."COMPANY"("ID") ON UPDATE CASCADE;


--
-- Name: document_number_range document_number_range_TENANT_ID_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.document_number_range
    ADD CONSTRAINT "document_number_range_TENANT_ID_fkey" FOREIGN KEY ("TENANT_ID") REFERENCES public."TENANTS"("ID");


--
-- Name: DOCUMENT_TEMPLATE fk_document_template_logo_asset; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."DOCUMENT_TEMPLATE"
    ADD CONSTRAINT fk_document_template_logo_asset FOREIGN KEY ("LOGO_ASSET_ID") REFERENCES public."ASSET"("ID") ON DELETE SET NULL;


--
-- Name: TENANT_ENTITLEMENT_OVERRIDE fk_entitlement_override_tenant; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."TENANT_ENTITLEMENT_OVERRIDE"
    ADD CONSTRAINT fk_entitlement_override_tenant FOREIGN KEY ("TENANT_ID") REFERENCES public."TENANTS"("ID") ON DELETE CASCADE;


--
-- Name: INVOICE fk_invoice_pdf_asset; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."INVOICE"
    ADD CONSTRAINT fk_invoice_pdf_asset FOREIGN KEY ("DOCUMENT_PDF_ASSET_ID") REFERENCES public."ASSET"("ID") ON DELETE SET NULL;


--
-- Name: PARTIAL_PAYMENT fk_pp_pdf_asset; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."PARTIAL_PAYMENT"
    ADD CONSTRAINT fk_pp_pdf_asset FOREIGN KEY ("DOCUMENT_PDF_ASSET_ID") REFERENCES public."ASSET"("ID") ON DELETE SET NULL;


--
-- Name: TENANT_LICENSE fk_tenant_license_tenant; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."TENANT_LICENSE"
    ADD CONSTRAINT fk_tenant_license_tenant FOREIGN KEY ("TENANT_ID") REFERENCES public."TENANTS"("ID") ON DELETE CASCADE;


--
-- Name: ABSENCE; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public."ABSENCE" ENABLE ROW LEVEL SECURITY;

--
-- Name: ABSENCE_TYPE; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public."ABSENCE_TYPE" ENABLE ROW LEVEL SECURITY;

--
-- Name: ACHIEVEMENT; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public."ACHIEVEMENT" ENABLE ROW LEVEL SECURITY;

--
-- Name: ADDRESS; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public."ADDRESS" ENABLE ROW LEVEL SECURITY;

--
-- Name: ARBZG_AUDIT; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public."ARBZG_AUDIT" ENABLE ROW LEVEL SECURITY;

--
-- Name: ASSET; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public."ASSET" ENABLE ROW LEVEL SECURITY;

--
-- Name: BILLING_TYPE; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public."BILLING_TYPE" ENABLE ROW LEVEL SECURITY;

--
-- Name: BOOKING_TEXT_SNIPPET; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public."BOOKING_TEXT_SNIPPET" ENABLE ROW LEVEL SECURITY;

--
-- Name: BOOKING_TYPE; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public."BOOKING_TYPE" ENABLE ROW LEVEL SECURITY;

--
-- Name: BREAK_RULE; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public."BREAK_RULE" ENABLE ROW LEVEL SECURITY;

--
-- Name: BUDGET_WARNING_FIRED; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public."BUDGET_WARNING_FIRED" ENABLE ROW LEVEL SECURITY;

--
-- Name: BUDGET_WARNING_RULE; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public."BUDGET_WARNING_RULE" ENABLE ROW LEVEL SECURITY;

--
-- Name: CAPABILITY_PERMISSION; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public."CAPABILITY_PERMISSION" ENABLE ROW LEVEL SECURITY;

--
-- Name: COMPANY; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public."COMPANY" ENABLE ROW LEVEL SECURITY;

--
-- Name: CONTACTS; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public."CONTACTS" ENABLE ROW LEVEL SECURITY;

--
-- Name: CONTRACT; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public."CONTRACT" ENABLE ROW LEVEL SECURITY;

--
-- Name: COST_RATE_CONFIG; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public."COST_RATE_CONFIG" ENABLE ROW LEVEL SECURITY;

--
-- Name: COST_RATE_EMP_PARAMS; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public."COST_RATE_EMP_PARAMS" ENABLE ROW LEVEL SECURITY;

--
-- Name: COUNTRY; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public."COUNTRY" ENABLE ROW LEVEL SECURITY;

--
-- Name: CURRENCY; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public."CURRENCY" ENABLE ROW LEVEL SECURITY;

--
-- Name: DEPARTMENT; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public."DEPARTMENT" ENABLE ROW LEVEL SECURITY;

--
-- Name: DIN276_COST_ESTIMATE; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public."DIN276_COST_ESTIMATE" ENABLE ROW LEVEL SECURITY;

--
-- Name: DIN276_COST_GROUP; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public."DIN276_COST_GROUP" ENABLE ROW LEVEL SECURITY;

--
-- Name: DOCUMENT_TEMPLATE; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public."DOCUMENT_TEMPLATE" ENABLE ROW LEVEL SECURITY;

--
-- Name: EMAIL_TEMPLATE; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public."EMAIL_TEMPLATE" ENABLE ROW LEVEL SECURITY;

--
-- Name: EMPLOYEE; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public."EMPLOYEE" ENABLE ROW LEVEL SECURITY;

--
-- Name: EMPLOYEE2PROJECT; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public."EMPLOYEE2PROJECT" ENABLE ROW LEVEL SECURITY;

--
-- Name: EMPLOYEE_CP_RATE; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public."EMPLOYEE_CP_RATE" ENABLE ROW LEVEL SECURITY;

--
-- Name: EMPLOYEE_MONTH_CLOSE; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public."EMPLOYEE_MONTH_CLOSE" ENABLE ROW LEVEL SECURITY;

--
-- Name: EMPLOYEE_ROLE; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public."EMPLOYEE_ROLE" ENABLE ROW LEVEL SECURITY;

--
-- Name: EMPLOYEE_WORK_MODEL; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public."EMPLOYEE_WORK_MODEL" ENABLE ROW LEVEL SECURITY;

--
-- Name: FEE_CALCULATION_BL; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public."FEE_CALCULATION_BL" ENABLE ROW LEVEL SECURITY;

--
-- Name: FEE_CALCULATION_MASTER; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public."FEE_CALCULATION_MASTER" ENABLE ROW LEVEL SECURITY;

--
-- Name: FEE_CALCULATION_PHASE; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public."FEE_CALCULATION_PHASE" ENABLE ROW LEVEL SECURITY;

--
-- Name: FEE_CALCULATION_SURCHARGES; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public."FEE_CALCULATION_SURCHARGES" ENABLE ROW LEVEL SECURITY;

--
-- Name: FEE_CALC_ZONE_SPLIT; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public."FEE_CALC_ZONE_SPLIT" ENABLE ROW LEVEL SECURITY;

--
-- Name: FEE_GROUPS; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public."FEE_GROUPS" ENABLE ROW LEVEL SECURITY;

--
-- Name: FEE_MASTERS; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public."FEE_MASTERS" ENABLE ROW LEVEL SECURITY;

--
-- Name: FEE_PHASE; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public."FEE_PHASE" ENABLE ROW LEVEL SECURITY;

--
-- Name: FEE_SURCHARGES; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public."FEE_SURCHARGES" ENABLE ROW LEVEL SECURITY;

--
-- Name: FEE_SURCHARGES2MASTER; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public."FEE_SURCHARGES2MASTER" ENABLE ROW LEVEL SECURITY;

--
-- Name: FEE_TABLES; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public."FEE_TABLES" ENABLE ROW LEVEL SECURITY;

--
-- Name: FEE_ZONES; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public."FEE_ZONES" ENABLE ROW LEVEL SECURITY;

--
-- Name: GENDER; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public."GENDER" ENABLE ROW LEVEL SECURITY;

--
-- Name: IMPORT_BATCH; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public."IMPORT_BATCH" ENABLE ROW LEVEL SECURITY;

--
-- Name: INVOICE; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public."INVOICE" ENABLE ROW LEVEL SECURITY;

--
-- Name: INVOICE_ATTACHMENT; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public."INVOICE_ATTACHMENT" ENABLE ROW LEVEL SECURITY;

--
-- Name: INVOICE_DEDUCTION; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public."INVOICE_DEDUCTION" ENABLE ROW LEVEL SECURITY;

--
-- Name: INVOICE_STRUCTURE; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public."INVOICE_STRUCTURE" ENABLE ROW LEVEL SECURITY;

--
-- Name: LANDING_EVENT; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public."LANDING_EVENT" ENABLE ROW LEVEL SECURITY;

--
-- Name: LICENSE_CAPABILITY; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public."LICENSE_CAPABILITY" ENABLE ROW LEVEL SECURITY;

--
-- Name: LICENSE_CHANGE_LOG; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public."LICENSE_CHANGE_LOG" ENABLE ROW LEVEL SECURITY;

--
-- Name: LICENSE_MODULE; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public."LICENSE_MODULE" ENABLE ROW LEVEL SECURITY;

--
-- Name: LICENSE_PLAN; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public."LICENSE_PLAN" ENABLE ROW LEVEL SECURITY;

--
-- Name: LPH_BLOCK; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public."LPH_BLOCK" ENABLE ROW LEVEL SECURITY;

--
-- Name: LPH_BLOCK_PHASE; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public."LPH_BLOCK_PHASE" ENABLE ROW LEVEL SECURITY;

--
-- Name: MAHNUNG; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public."MAHNUNG" ENABLE ROW LEVEL SECURITY;

--
-- Name: MAHNUNG_HISTORY; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public."MAHNUNG_HISTORY" ENABLE ROW LEVEL SECURITY;

--
-- Name: MAHNUNG_SETTINGS; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public."MAHNUNG_SETTINGS" ENABLE ROW LEVEL SECURITY;

--
-- Name: NACHTRAG; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public."NACHTRAG" ENABLE ROW LEVEL SECURITY;

--
-- Name: NACHTRAG_AUDIT; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public."NACHTRAG_AUDIT" ENABLE ROW LEVEL SECURITY;

--
-- Name: NACHTRAG_RELEASE; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public."NACHTRAG_RELEASE" ENABLE ROW LEVEL SECURITY;

--
-- Name: NACHTRAG_STATUS; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public."NACHTRAG_STATUS" ENABLE ROW LEVEL SECURITY;

--
-- Name: NACHTRAG_STRUCTURE; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public."NACHTRAG_STRUCTURE" ENABLE ROW LEVEL SECURITY;

--
-- Name: NOTIFICATION; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public."NOTIFICATION" ENABLE ROW LEVEL SECURITY;

--
-- Name: NOTIFICATION_SCHEDULE_CONFIG; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public."NOTIFICATION_SCHEDULE_CONFIG" ENABLE ROW LEVEL SECURITY;

--
-- Name: NOTIFICATION_TYPE; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public."NOTIFICATION_TYPE" ENABLE ROW LEVEL SECURITY;

--
-- Name: NOTIFICATION_TYPE_CONFIG; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public."NOTIFICATION_TYPE_CONFIG" ENABLE ROW LEVEL SECURITY;

--
-- Name: NUMBER_RANGE_TEMPLATE; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public."NUMBER_RANGE_TEMPLATE" ENABLE ROW LEVEL SECURITY;

--
-- Name: OFFER; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public."OFFER" ENABLE ROW LEVEL SECURITY;

--
-- Name: OFFER_STRUCTURE; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public."OFFER_STRUCTURE" ENABLE ROW LEVEL SECURITY;

--
-- Name: PARTIAL_PAYMENT; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public."PARTIAL_PAYMENT" ENABLE ROW LEVEL SECURITY;

--
-- Name: PARTIAL_PAYMENT_STRUCTURE; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public."PARTIAL_PAYMENT_STRUCTURE" ENABLE ROW LEVEL SECURITY;

--
-- Name: PAYMENT; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public."PAYMENT" ENABLE ROW LEVEL SECURITY;

--
-- Name: PAYMENT_MEANS; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public."PAYMENT_MEANS" ENABLE ROW LEVEL SECURITY;

--
-- Name: PAYMENT_STRUCTURE; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public."PAYMENT_STRUCTURE" ENABLE ROW LEVEL SECURITY;

--
-- Name: PERMISSION; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public."PERMISSION" ENABLE ROW LEVEL SECURITY;

--
-- Name: PLAN_CAPABILITY; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public."PLAN_CAPABILITY" ENABLE ROW LEVEL SECURITY;

--
-- Name: PLATFORM_ADMIN; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public."PLATFORM_ADMIN" ENABLE ROW LEVEL SECURITY;

--
-- Name: PLATFORM_EMAIL_SETTINGS; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public."PLATFORM_EMAIL_SETTINGS" ENABLE ROW LEVEL SECURITY;

--
-- Name: PORTAL_CONSENT; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public."PORTAL_CONSENT" ENABLE ROW LEVEL SECURITY;

--
-- Name: PROJECT; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public."PROJECT" ENABLE ROW LEVEL SECURITY;

--
-- Name: PROJECT_BOOKING_PRICE; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public."PROJECT_BOOKING_PRICE" ENABLE ROW LEVEL SECURITY;

--
-- Name: PROJECT_PROGRESS; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public."PROJECT_PROGRESS" ENABLE ROW LEVEL SECURITY;

--
-- Name: PROJECT_SP_RATES; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public."PROJECT_SP_RATES" ENABLE ROW LEVEL SECURITY;

--
-- Name: PROJECT_STRUCTURE; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public."PROJECT_STRUCTURE" ENABLE ROW LEVEL SECURITY;

--
-- Name: PROJECT_TYPE; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public."PROJECT_TYPE" ENABLE ROW LEVEL SECURITY;

--
-- Name: PUSH_SUBSCRIPTION; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public."PUSH_SUBSCRIPTION" ENABLE ROW LEVEL SECURITY;

--
-- Name: PUSH_TOKEN; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public."PUSH_TOKEN" ENABLE ROW LEVEL SECURITY;

--
-- Name: RECENT_VIEW; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public."RECENT_VIEW" ENABLE ROW LEVEL SECURITY;

--
-- Name: ROLE; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public."ROLE" ENABLE ROW LEVEL SECURITY;

--
-- Name: ROLE_PERMISSION; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public."ROLE_PERMISSION" ENABLE ROW LEVEL SECURITY;

--
-- Name: SALUTATION; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public."SALUTATION" ENABLE ROW LEVEL SECURITY;

--
-- Name: SERVICE_REQUEST; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public."SERVICE_REQUEST" ENABLE ROW LEVEL SECURITY;

--
-- Name: SERVICE_REQUEST_ATTACHMENT; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public."SERVICE_REQUEST_ATTACHMENT" ENABLE ROW LEVEL SECURITY;

--
-- Name: SERVICE_REQUEST_MESSAGE; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public."SERVICE_REQUEST_MESSAGE" ENABLE ROW LEVEL SECURITY;

--
-- Name: SE_RELEASE; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public."SE_RELEASE" ENABLE ROW LEVEL SECURITY;

--
-- Name: SUGGESTION; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public."SUGGESTION" ENABLE ROW LEVEL SECURITY;

--
-- Name: SUGGESTION_ATTACHMENT; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public."SUGGESTION_ATTACHMENT" ENABLE ROW LEVEL SECURITY;

--
-- Name: SUGGESTION_COMMENT; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public."SUGGESTION_COMMENT" ENABLE ROW LEVEL SECURITY;

--
-- Name: SUGGESTION_VOTE; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public."SUGGESTION_VOTE" ENABLE ROW LEVEL SECURITY;

--
-- Name: TEC; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public."TEC" ENABLE ROW LEVEL SECURITY;

--
-- Name: TENANTS; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public."TENANTS" ENABLE ROW LEVEL SECURITY;

--
-- Name: TENANT_EMAIL_SETTINGS; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public."TENANT_EMAIL_SETTINGS" ENABLE ROW LEVEL SECURITY;

--
-- Name: TENANT_ENTITLEMENT_OVERRIDE; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public."TENANT_ENTITLEMENT_OVERRIDE" ENABLE ROW LEVEL SECURITY;

--
-- Name: TENANT_LICENSE; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public."TENANT_LICENSE" ENABLE ROW LEVEL SECURITY;

--
-- Name: TENANT_SETTINGS; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public."TENANT_SETTINGS" ENABLE ROW LEVEL SECURITY;

--
-- Name: TEXT_TEMPLATE; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public."TEXT_TEMPLATE" ENABLE ROW LEVEL SECURITY;

--
-- Name: USER_ACHIEVEMENT; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public."USER_ACHIEVEMENT" ENABLE ROW LEVEL SECURITY;

--
-- Name: USER_ROLE; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public."USER_ROLE" ENABLE ROW LEVEL SECURITY;

--
-- Name: VACATION_ENTITLEMENT; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public."VACATION_ENTITLEMENT" ENABLE ROW LEVEL SECURITY;

--
-- Name: VAT; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public."VAT" ENABLE ROW LEVEL SECURITY;

--
-- Name: WORKING_TIME_MODEL; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public."WORKING_TIME_MODEL" ENABLE ROW LEVEL SECURITY;

--
-- Name: document_number_range; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.document_number_range ENABLE ROW LEVEL SECURITY;

--
-- Name: ABSENCE tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public."ABSENCE" USING ((("TENANT_ID" = public.current_tenant_id()) OR public.is_system_request())) WITH CHECK ((("TENANT_ID" = public.current_tenant_id()) OR public.is_system_request()));


--
-- Name: ABSENCE_TYPE tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public."ABSENCE_TYPE" USING ((("TENANT_ID" = public.current_tenant_id()) OR public.is_system_request())) WITH CHECK ((("TENANT_ID" = public.current_tenant_id()) OR public.is_system_request()));


--
-- Name: ADDRESS tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public."ADDRESS" USING ((("TENANT_ID" = public.current_tenant_id()) OR public.is_system_request())) WITH CHECK ((("TENANT_ID" = public.current_tenant_id()) OR public.is_system_request()));


--
-- Name: ARBZG_AUDIT tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public."ARBZG_AUDIT" USING ((("TENANT_ID" = public.current_tenant_id()) OR public.is_system_request())) WITH CHECK ((("TENANT_ID" = public.current_tenant_id()) OR public.is_system_request()));


--
-- Name: ASSET tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public."ASSET" USING ((public.is_system_request() OR (EXISTS ( SELECT 1
   FROM public."COMPANY" c
  WHERE ((c."ID" = "ASSET"."COMPANY_ID") AND (c."TENANT_ID" = public.current_tenant_id())))))) WITH CHECK ((public.is_system_request() OR (EXISTS ( SELECT 1
   FROM public."COMPANY" c
  WHERE ((c."ID" = "ASSET"."COMPANY_ID") AND (c."TENANT_ID" = public.current_tenant_id()))))));


--
-- Name: BOOKING_TEXT_SNIPPET tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public."BOOKING_TEXT_SNIPPET" USING ((("TENANT_ID" = public.current_tenant_id()) OR public.is_system_request())) WITH CHECK ((("TENANT_ID" = public.current_tenant_id()) OR public.is_system_request()));


--
-- Name: BOOKING_TYPE tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public."BOOKING_TYPE" USING ((("TENANT_ID" = public.current_tenant_id()) OR public.is_system_request())) WITH CHECK ((("TENANT_ID" = public.current_tenant_id()) OR public.is_system_request()));


--
-- Name: BREAK_RULE tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public."BREAK_RULE" USING ((("TENANT_ID" = public.current_tenant_id()) OR public.is_system_request())) WITH CHECK ((("TENANT_ID" = public.current_tenant_id()) OR public.is_system_request()));


--
-- Name: BUDGET_WARNING_RULE tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public."BUDGET_WARNING_RULE" USING ((("TENANT_ID" = public.current_tenant_id()) OR public.is_system_request())) WITH CHECK ((("TENANT_ID" = public.current_tenant_id()) OR public.is_system_request()));


--
-- Name: COMPANY tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public."COMPANY" USING ((("TENANT_ID" = public.current_tenant_id()) OR public.is_system_request())) WITH CHECK ((("TENANT_ID" = public.current_tenant_id()) OR public.is_system_request()));


--
-- Name: CONTACTS tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public."CONTACTS" USING ((("TENANT_ID" = public.current_tenant_id()) OR public.is_system_request())) WITH CHECK ((("TENANT_ID" = public.current_tenant_id()) OR public.is_system_request()));


--
-- Name: CONTRACT tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public."CONTRACT" USING ((("TENANT_ID" = public.current_tenant_id()) OR public.is_system_request())) WITH CHECK ((("TENANT_ID" = public.current_tenant_id()) OR public.is_system_request()));


--
-- Name: COST_RATE_CONFIG tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public."COST_RATE_CONFIG" USING ((("TENANT_ID" = public.current_tenant_id()) OR public.is_system_request())) WITH CHECK ((("TENANT_ID" = public.current_tenant_id()) OR public.is_system_request()));


--
-- Name: COST_RATE_EMP_PARAMS tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public."COST_RATE_EMP_PARAMS" USING ((("TENANT_ID" = public.current_tenant_id()) OR public.is_system_request())) WITH CHECK ((("TENANT_ID" = public.current_tenant_id()) OR public.is_system_request()));


--
-- Name: DEPARTMENT tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public."DEPARTMENT" USING ((("TENANT_ID" = public.current_tenant_id()) OR public.is_system_request())) WITH CHECK ((("TENANT_ID" = public.current_tenant_id()) OR public.is_system_request()));


--
-- Name: DIN276_COST_ESTIMATE tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public."DIN276_COST_ESTIMATE" USING ((("TENANT_ID" = public.current_tenant_id()) OR public.is_system_request())) WITH CHECK ((("TENANT_ID" = public.current_tenant_id()) OR public.is_system_request()));


--
-- Name: DIN276_COST_GROUP tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public."DIN276_COST_GROUP" USING ((("TENANT_ID" = public.current_tenant_id()) OR public.is_system_request())) WITH CHECK ((("TENANT_ID" = public.current_tenant_id()) OR public.is_system_request()));


--
-- Name: DOCUMENT_TEMPLATE tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public."DOCUMENT_TEMPLATE" USING ((("TENANT_ID" = public.current_tenant_id()) OR public.is_system_request())) WITH CHECK ((("TENANT_ID" = public.current_tenant_id()) OR public.is_system_request()));


--
-- Name: EMAIL_TEMPLATE tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public."EMAIL_TEMPLATE" USING ((("TENANT_ID" = public.current_tenant_id()) OR public.is_system_request())) WITH CHECK ((("TENANT_ID" = public.current_tenant_id()) OR public.is_system_request()));


--
-- Name: EMPLOYEE tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public."EMPLOYEE" USING ((("TENANT_ID" = public.current_tenant_id()) OR public.is_system_request())) WITH CHECK ((("TENANT_ID" = public.current_tenant_id()) OR public.is_system_request()));


--
-- Name: EMPLOYEE2PROJECT tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public."EMPLOYEE2PROJECT" USING ((("TENANT_ID" = public.current_tenant_id()) OR public.is_system_request())) WITH CHECK ((("TENANT_ID" = public.current_tenant_id()) OR public.is_system_request()));


--
-- Name: EMPLOYEE_CP_RATE tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public."EMPLOYEE_CP_RATE" USING ((("TENANT_ID" = public.current_tenant_id()) OR public.is_system_request())) WITH CHECK ((("TENANT_ID" = public.current_tenant_id()) OR public.is_system_request()));


--
-- Name: EMPLOYEE_MONTH_CLOSE tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public."EMPLOYEE_MONTH_CLOSE" USING ((("TENANT_ID" = public.current_tenant_id()) OR public.is_system_request())) WITH CHECK ((("TENANT_ID" = public.current_tenant_id()) OR public.is_system_request()));


--
-- Name: EMPLOYEE_WORK_MODEL tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public."EMPLOYEE_WORK_MODEL" USING ((("TENANT_ID" = public.current_tenant_id()) OR public.is_system_request())) WITH CHECK ((("TENANT_ID" = public.current_tenant_id()) OR public.is_system_request()));


--
-- Name: FEE_CALCULATION_BL tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public."FEE_CALCULATION_BL" USING ((("TENANT_ID" = public.current_tenant_id()) OR public.is_system_request())) WITH CHECK ((("TENANT_ID" = public.current_tenant_id()) OR public.is_system_request()));


--
-- Name: FEE_CALCULATION_MASTER tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public."FEE_CALCULATION_MASTER" USING ((("TENANT_ID" = public.current_tenant_id()) OR public.is_system_request())) WITH CHECK ((("TENANT_ID" = public.current_tenant_id()) OR public.is_system_request()));


--
-- Name: FEE_CALCULATION_PHASE tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public."FEE_CALCULATION_PHASE" USING ((("TENANT_ID" = public.current_tenant_id()) OR public.is_system_request())) WITH CHECK ((("TENANT_ID" = public.current_tenant_id()) OR public.is_system_request()));


--
-- Name: FEE_CALCULATION_SURCHARGES tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public."FEE_CALCULATION_SURCHARGES" USING ((("TENANT_ID" = public.current_tenant_id()) OR public.is_system_request())) WITH CHECK ((("TENANT_ID" = public.current_tenant_id()) OR public.is_system_request()));


--
-- Name: FEE_CALC_ZONE_SPLIT tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public."FEE_CALC_ZONE_SPLIT" USING ((("TENANT_ID" = public.current_tenant_id()) OR public.is_system_request())) WITH CHECK ((("TENANT_ID" = public.current_tenant_id()) OR public.is_system_request()));


--
-- Name: IMPORT_BATCH tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public."IMPORT_BATCH" USING ((("TENANT_ID" = public.current_tenant_id()) OR public.is_system_request())) WITH CHECK ((("TENANT_ID" = public.current_tenant_id()) OR public.is_system_request()));


--
-- Name: INVOICE tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public."INVOICE" USING ((("TENANT_ID" = public.current_tenant_id()) OR public.is_system_request())) WITH CHECK ((("TENANT_ID" = public.current_tenant_id()) OR public.is_system_request()));


--
-- Name: INVOICE_ATTACHMENT tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public."INVOICE_ATTACHMENT" USING ((("TENANT_ID" = public.current_tenant_id()) OR public.is_system_request())) WITH CHECK ((("TENANT_ID" = public.current_tenant_id()) OR public.is_system_request()));


--
-- Name: INVOICE_DEDUCTION tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public."INVOICE_DEDUCTION" USING ((("TENANT_ID" = public.current_tenant_id()) OR public.is_system_request())) WITH CHECK ((("TENANT_ID" = public.current_tenant_id()) OR public.is_system_request()));


--
-- Name: INVOICE_STRUCTURE tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public."INVOICE_STRUCTURE" USING ((("TENANT_ID" = public.current_tenant_id()) OR public.is_system_request())) WITH CHECK ((("TENANT_ID" = public.current_tenant_id()) OR public.is_system_request()));


--
-- Name: LPH_BLOCK tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public."LPH_BLOCK" USING ((("TENANT_ID" = public.current_tenant_id()) OR public.is_system_request())) WITH CHECK ((("TENANT_ID" = public.current_tenant_id()) OR public.is_system_request()));


--
-- Name: LPH_BLOCK_PHASE tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public."LPH_BLOCK_PHASE" USING ((("TENANT_ID" = public.current_tenant_id()) OR public.is_system_request())) WITH CHECK ((("TENANT_ID" = public.current_tenant_id()) OR public.is_system_request()));


--
-- Name: MAHNUNG tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public."MAHNUNG" USING ((("TENANT_ID" = public.current_tenant_id()) OR public.is_system_request())) WITH CHECK ((("TENANT_ID" = public.current_tenant_id()) OR public.is_system_request()));


--
-- Name: MAHNUNG_HISTORY tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public."MAHNUNG_HISTORY" USING ((("TENANT_ID" = public.current_tenant_id()) OR public.is_system_request())) WITH CHECK ((("TENANT_ID" = public.current_tenant_id()) OR public.is_system_request()));


--
-- Name: MAHNUNG_SETTINGS tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public."MAHNUNG_SETTINGS" USING ((("TENANT_ID" = public.current_tenant_id()) OR public.is_system_request())) WITH CHECK ((("TENANT_ID" = public.current_tenant_id()) OR public.is_system_request()));


--
-- Name: NACHTRAG tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public."NACHTRAG" USING ((("TENANT_ID" = public.current_tenant_id()) OR public.is_system_request())) WITH CHECK ((("TENANT_ID" = public.current_tenant_id()) OR public.is_system_request()));


--
-- Name: NACHTRAG_AUDIT tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public."NACHTRAG_AUDIT" USING ((("TENANT_ID" = public.current_tenant_id()) OR public.is_system_request())) WITH CHECK ((("TENANT_ID" = public.current_tenant_id()) OR public.is_system_request()));


--
-- Name: NACHTRAG_RELEASE tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public."NACHTRAG_RELEASE" USING ((("TENANT_ID" = public.current_tenant_id()) OR public.is_system_request())) WITH CHECK ((("TENANT_ID" = public.current_tenant_id()) OR public.is_system_request()));


--
-- Name: NACHTRAG_STRUCTURE tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public."NACHTRAG_STRUCTURE" USING ((("TENANT_ID" = public.current_tenant_id()) OR public.is_system_request())) WITH CHECK ((("TENANT_ID" = public.current_tenant_id()) OR public.is_system_request()));


--
-- Name: NOTIFICATION tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public."NOTIFICATION" USING ((("TENANT_ID" = public.current_tenant_id()) OR public.is_system_request())) WITH CHECK ((("TENANT_ID" = public.current_tenant_id()) OR public.is_system_request()));


--
-- Name: NOTIFICATION_SCHEDULE_CONFIG tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public."NOTIFICATION_SCHEDULE_CONFIG" USING ((("TENANT_ID" = public.current_tenant_id()) OR public.is_system_request())) WITH CHECK ((("TENANT_ID" = public.current_tenant_id()) OR public.is_system_request()));


--
-- Name: NOTIFICATION_TYPE_CONFIG tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public."NOTIFICATION_TYPE_CONFIG" USING ((("TENANT_ID" = public.current_tenant_id()) OR public.is_system_request())) WITH CHECK ((("TENANT_ID" = public.current_tenant_id()) OR public.is_system_request()));


--
-- Name: NUMBER_RANGE_TEMPLATE tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public."NUMBER_RANGE_TEMPLATE" USING ((("TENANT_ID" = public.current_tenant_id()) OR public.is_system_request())) WITH CHECK ((("TENANT_ID" = public.current_tenant_id()) OR public.is_system_request()));


--
-- Name: OFFER tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public."OFFER" USING ((("TENANT_ID" = public.current_tenant_id()) OR public.is_system_request())) WITH CHECK ((("TENANT_ID" = public.current_tenant_id()) OR public.is_system_request()));


--
-- Name: OFFER_STRUCTURE tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public."OFFER_STRUCTURE" USING ((("TENANT_ID" = public.current_tenant_id()) OR public.is_system_request())) WITH CHECK ((("TENANT_ID" = public.current_tenant_id()) OR public.is_system_request()));


--
-- Name: PARTIAL_PAYMENT tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public."PARTIAL_PAYMENT" USING ((("TENANT_ID" = public.current_tenant_id()) OR public.is_system_request())) WITH CHECK ((("TENANT_ID" = public.current_tenant_id()) OR public.is_system_request()));


--
-- Name: PARTIAL_PAYMENT_STRUCTURE tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public."PARTIAL_PAYMENT_STRUCTURE" USING ((("TENANT_ID" = public.current_tenant_id()) OR public.is_system_request())) WITH CHECK ((("TENANT_ID" = public.current_tenant_id()) OR public.is_system_request()));


--
-- Name: PAYMENT tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public."PAYMENT" USING ((("TENANT_ID" = public.current_tenant_id()) OR public.is_system_request())) WITH CHECK ((("TENANT_ID" = public.current_tenant_id()) OR public.is_system_request()));


--
-- Name: PAYMENT_MEANS tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public."PAYMENT_MEANS" USING ((("TENANT_ID" = public.current_tenant_id()) OR public.is_system_request())) WITH CHECK ((("TENANT_ID" = public.current_tenant_id()) OR public.is_system_request()));


--
-- Name: PAYMENT_STRUCTURE tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public."PAYMENT_STRUCTURE" USING ((("TENANT_ID" = public.current_tenant_id()) OR public.is_system_request())) WITH CHECK ((("TENANT_ID" = public.current_tenant_id()) OR public.is_system_request()));


--
-- Name: PORTAL_CONSENT tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public."PORTAL_CONSENT" USING ((("TENANT_ID" = public.current_tenant_id()) OR public.is_system_request())) WITH CHECK ((("TENANT_ID" = public.current_tenant_id()) OR public.is_system_request()));


--
-- Name: PROJECT tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public."PROJECT" USING ((("TENANT_ID" = public.current_tenant_id()) OR public.is_system_request())) WITH CHECK ((("TENANT_ID" = public.current_tenant_id()) OR public.is_system_request()));


--
-- Name: PROJECT_BOOKING_PRICE tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public."PROJECT_BOOKING_PRICE" USING ((("TENANT_ID" = public.current_tenant_id()) OR public.is_system_request())) WITH CHECK ((("TENANT_ID" = public.current_tenant_id()) OR public.is_system_request()));


--
-- Name: PROJECT_PROGRESS tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public."PROJECT_PROGRESS" USING ((("TENANT_ID" = public.current_tenant_id()) OR public.is_system_request())) WITH CHECK ((("TENANT_ID" = public.current_tenant_id()) OR public.is_system_request()));


--
-- Name: PROJECT_SP_RATES tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public."PROJECT_SP_RATES" USING ((("TENANT_ID" = public.current_tenant_id()) OR public.is_system_request())) WITH CHECK ((("TENANT_ID" = public.current_tenant_id()) OR public.is_system_request()));


--
-- Name: PROJECT_STRUCTURE tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public."PROJECT_STRUCTURE" USING ((("TENANT_ID" = public.current_tenant_id()) OR public.is_system_request())) WITH CHECK ((("TENANT_ID" = public.current_tenant_id()) OR public.is_system_request()));


--
-- Name: PROJECT_TYPE tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public."PROJECT_TYPE" USING ((("TENANT_ID" = public.current_tenant_id()) OR public.is_system_request())) WITH CHECK ((("TENANT_ID" = public.current_tenant_id()) OR public.is_system_request()));


--
-- Name: PUSH_SUBSCRIPTION tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public."PUSH_SUBSCRIPTION" USING ((("TENANT_ID" = public.current_tenant_id()) OR public.is_system_request())) WITH CHECK ((("TENANT_ID" = public.current_tenant_id()) OR public.is_system_request()));


--
-- Name: PUSH_TOKEN tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public."PUSH_TOKEN" USING ((("TENANT_ID" = public.current_tenant_id()) OR public.is_system_request())) WITH CHECK ((("TENANT_ID" = public.current_tenant_id()) OR public.is_system_request()));


--
-- Name: RECENT_VIEW tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public."RECENT_VIEW" USING ((("TENANT_ID" = public.current_tenant_id()) OR public.is_system_request())) WITH CHECK ((("TENANT_ID" = public.current_tenant_id()) OR public.is_system_request()));


--
-- Name: ROLE tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public."ROLE" USING ((("TENANT_ID" = public.current_tenant_id()) OR public.is_system_request())) WITH CHECK ((("TENANT_ID" = public.current_tenant_id()) OR public.is_system_request()));


--
-- Name: SERVICE_REQUEST tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public."SERVICE_REQUEST" USING ((("TENANT_ID" = public.current_tenant_id()) OR public.is_system_request())) WITH CHECK ((("TENANT_ID" = public.current_tenant_id()) OR public.is_system_request()));


--
-- Name: SERVICE_REQUEST_ATTACHMENT tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public."SERVICE_REQUEST_ATTACHMENT" USING ((("TENANT_ID" = public.current_tenant_id()) OR public.is_system_request())) WITH CHECK ((("TENANT_ID" = public.current_tenant_id()) OR public.is_system_request()));


--
-- Name: SE_RELEASE tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public."SE_RELEASE" USING ((("TENANT_ID" = public.current_tenant_id()) OR public.is_system_request())) WITH CHECK ((("TENANT_ID" = public.current_tenant_id()) OR public.is_system_request()));


--
-- Name: SUGGESTION tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public."SUGGESTION" USING ((("TENANT_ID" = public.current_tenant_id()) OR public.is_system_request())) WITH CHECK ((("TENANT_ID" = public.current_tenant_id()) OR public.is_system_request()));


--
-- Name: SUGGESTION_ATTACHMENT tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public."SUGGESTION_ATTACHMENT" USING ((("TENANT_ID" = public.current_tenant_id()) OR public.is_system_request())) WITH CHECK ((("TENANT_ID" = public.current_tenant_id()) OR public.is_system_request()));


--
-- Name: SUGGESTION_COMMENT tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public."SUGGESTION_COMMENT" USING ((("TENANT_ID" = public.current_tenant_id()) OR public.is_system_request())) WITH CHECK ((("TENANT_ID" = public.current_tenant_id()) OR public.is_system_request()));


--
-- Name: SUGGESTION_VOTE tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public."SUGGESTION_VOTE" USING ((("TENANT_ID" = public.current_tenant_id()) OR public.is_system_request())) WITH CHECK ((("TENANT_ID" = public.current_tenant_id()) OR public.is_system_request()));


--
-- Name: TEC tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public."TEC" USING ((("TENANT_ID" = public.current_tenant_id()) OR public.is_system_request())) WITH CHECK ((("TENANT_ID" = public.current_tenant_id()) OR public.is_system_request()));


--
-- Name: TENANT_EMAIL_SETTINGS tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public."TENANT_EMAIL_SETTINGS" USING ((("TENANT_ID" = public.current_tenant_id()) OR public.is_system_request())) WITH CHECK ((("TENANT_ID" = public.current_tenant_id()) OR public.is_system_request()));


--
-- Name: TENANT_ENTITLEMENT_OVERRIDE tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public."TENANT_ENTITLEMENT_OVERRIDE" USING ((("TENANT_ID" = public.current_tenant_id()) OR public.is_system_request())) WITH CHECK ((("TENANT_ID" = public.current_tenant_id()) OR public.is_system_request()));


--
-- Name: TENANT_LICENSE tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public."TENANT_LICENSE" USING ((("TENANT_ID" = public.current_tenant_id()) OR public.is_system_request())) WITH CHECK ((("TENANT_ID" = public.current_tenant_id()) OR public.is_system_request()));


--
-- Name: TENANT_SETTINGS tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public."TENANT_SETTINGS" USING ((("TENANT_ID" = public.current_tenant_id()) OR public.is_system_request())) WITH CHECK ((("TENANT_ID" = public.current_tenant_id()) OR public.is_system_request()));


--
-- Name: TEXT_TEMPLATE tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public."TEXT_TEMPLATE" USING ((("TENANT_ID" = public.current_tenant_id()) OR public.is_system_request())) WITH CHECK ((("TENANT_ID" = public.current_tenant_id()) OR public.is_system_request()));


--
-- Name: USER_ACHIEVEMENT tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public."USER_ACHIEVEMENT" USING ((("TENANT_ID" = public.current_tenant_id()) OR public.is_system_request())) WITH CHECK ((("TENANT_ID" = public.current_tenant_id()) OR public.is_system_request()));


--
-- Name: USER_ROLE tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public."USER_ROLE" USING ((("TENANT_ID" = public.current_tenant_id()) OR public.is_system_request())) WITH CHECK ((("TENANT_ID" = public.current_tenant_id()) OR public.is_system_request()));


--
-- Name: VACATION_ENTITLEMENT tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public."VACATION_ENTITLEMENT" USING ((("TENANT_ID" = public.current_tenant_id()) OR public.is_system_request())) WITH CHECK ((("TENANT_ID" = public.current_tenant_id()) OR public.is_system_request()));


--
-- Name: WORKING_TIME_MODEL tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public."WORKING_TIME_MODEL" USING ((("TENANT_ID" = public.current_tenant_id()) OR public.is_system_request())) WITH CHECK ((("TENANT_ID" = public.current_tenant_id()) OR public.is_system_request()));


--
-- Name: document_number_range tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.document_number_range USING ((("TENANT_ID" = public.current_tenant_id()) OR public.is_system_request())) WITH CHECK ((("TENANT_ID" = public.current_tenant_id()) OR public.is_system_request()));


--
-- PostgreSQL database dump complete
--


