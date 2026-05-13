-- Migration 0029: fn_project_list_report — date-filtered KPIs for all projects
-- Safe to re-run: DROP uses IF EXISTS.

DROP FUNCTION IF EXISTS public.fn_project_list_report(bigint, timestamptz, date, date);

CREATE OR REPLACE FUNCTION public.fn_project_list_report(
  p_tenant_id  bigint,
  p_as_of      timestamptz DEFAULT NULL,
  p_date_from  date        DEFAULT NULL,
  p_date_to    date        DEFAULT NULL
)
RETURNS TABLE (
  "PROJECT_ID"                bigint,
  "NAME_SHORT"                text,
  "NAME_LONG"                 text,
  "PROJECT_STATUS_ID"         bigint,
  "PROJECT_STATUS_NAME_SHORT" text,
  "PROJECT_TYPE_ID"           bigint,
  "PROJECT_TYPE_NAME_SHORT"   text,
  "PROJECT_MANAGER_ID"        bigint,
  "PROJECT_MANAGER_DISPLAY"   text,
  "ADDRESS_ID"                bigint,
  "ADDRESS_NAME"              text,
  "COMPANY_ID"                bigint,
  "COMPANY_NAME"              text,
  "DEPARTMENT_ID"             bigint,
  "DEPARTMENT_NAME"           text,
  "BUDGET_TOTAL_NET"          numeric,
  "LEISTUNGSSTAND_PERCENT"    numeric,
  "LEISTUNGSSTAND_VALUE"      numeric,
  "HOURS_TOTAL"               numeric,
  "COST_TOTAL"                numeric,
  "COST_RATIO"                numeric,
  "REMAINING_BUDGET_NET"      numeric,
  "BILLED_NET_TOTAL"          numeric,
  "OPEN_NET_TOTAL"            numeric,
  "PAYED_NET_TOTAL"           numeric,
  "SALES_TOTAL"               numeric,
  "QTY_EXT_TOTAL"             numeric
)
LANGUAGE sql STABLE AS $$
  WITH
    cutoff AS (
      SELECT
        CASE
          WHEN p_as_of   IS NOT NULL THEN p_as_of
          WHEN p_date_to IS NOT NULL THEN (p_date_to::timestamptz + INTERVAL '1 day' - INTERVAL '1 microsecond')
          ELSE now()
        END AS ts
    ),

    -- All leaf structures across all projects for this tenant
    leaf_structs AS (
      SELECT
        ps."PROJECT_ID",
        ps."ID"      AS "STRUCTURE_ID",
        ps."REVENUE",
        ps."EXTRAS"
      FROM public."PROJECT_STRUCTURE" ps
      WHERE ps."TENANT_ID" = p_tenant_id
        AND NOT EXISTS (
          SELECT 1
          FROM   public."PROJECT_STRUCTURE" child
          WHERE  child."TENANT_ID" = ps."TENANT_ID"
            AND  child."FATHER_ID" = ps."ID"
        )
    ),

    -- Latest completion per leaf, up to cutoff
    prog AS (
      SELECT DISTINCT ON (pp."STRUCTURE_ID")
        pp."STRUCTURE_ID",
        pp."REVENUE_COMPLETION",
        pp."EXTRAS_COMPLETION"
      FROM public."PROJECT_PROGRESS" pp
      JOIN leaf_structs ls ON ls."STRUCTURE_ID" = pp."STRUCTURE_ID"
      CROSS JOIN cutoff
      WHERE pp."TENANT_ID"   = p_tenant_id
        AND pp."created_at" <= cutoff.ts
      ORDER BY pp."STRUCTURE_ID", pp."created_at" DESC, pp."ID" DESC
    ),

    -- Per-project budget + completion aggregation
    prog_agg AS (
      SELECT
        ls."PROJECT_ID",
        COALESCE(SUM(ls."REVENUE"), 0)           AS "REVENUE_BUDGET",
        COALESCE(SUM(ls."EXTRAS"),  0)           AS "EXTRAS_BUDGET",
        COALESCE(SUM(p."REVENUE_COMPLETION"), 0) AS "REVENUE_COMPLETION_VALUE",
        COALESCE(SUM(p."EXTRAS_COMPLETION"),  0) AS "EXTRAS_COMPLETION_VALUE",
        CASE
          WHEN SUM(COALESCE(ls."REVENUE", 0)) + SUM(COALESCE(ls."EXTRAS", 0)) = 0 THEN NULL
          ELSE 100.0
             * ( COALESCE(SUM(p."REVENUE_COMPLETION"), 0) + COALESCE(SUM(p."EXTRAS_COMPLETION"), 0) )
             / ( SUM(COALESCE(ls."REVENUE", 0))           + SUM(COALESCE(ls."EXTRAS", 0)) )
        END AS "LEISTUNGSSTAND_PERCENT"
      FROM leaf_structs ls
      LEFT JOIN prog p ON p."STRUCTURE_ID" = ls."STRUCTURE_ID"
      GROUP BY ls."PROJECT_ID"
    ),

    -- Per-project TEC aggregation (date-filtered)
    tec_agg AS (
      SELECT
        ps."PROJECT_ID",
        COALESCE(SUM(t."QUANTITY_INT"), 0) AS "HOURS_TOTAL",
        COALESCE(SUM(t."CP_TOT"),       0) AS "COST_TOTAL",
        COALESCE(SUM(t."SP_TOT"),       0) AS "SALES_TOTAL",
        COALESCE(SUM(t."QUANTITY_EXT"), 0) AS "QTY_EXT_TOTAL"
      FROM public."TEC" t
      JOIN public."PROJECT_STRUCTURE" ps
        ON  ps."TENANT_ID"  = t."TENANT_ID"
       AND  ps."ID"         = t."STRUCTURE_ID"
      WHERE t."TENANT_ID"   = p_tenant_id
        AND (p_as_of     IS NULL OR t."DATE_VOUCHER" <= p_as_of::date)
        AND (p_date_from IS NULL OR t."DATE_VOUCHER" >= p_date_from)
        AND (p_date_to   IS NULL OR t."DATE_VOUCHER" <= p_date_to)
      GROUP BY ps."PROJECT_ID"
    ),

    -- Per-project payment aggregation (not date-filtered — payments are lifetime)
    pay_agg AS (
      SELECT
        pay."PROJECT_ID",
        COALESCE(SUM(pay."AMOUNT_PAYED_NET"), 0) AS "PAYED_NET_TOTAL"
      FROM public."PAYMENT" pay
      WHERE pay."TENANT_ID" = p_tenant_id
      GROUP BY pay."PROJECT_ID"
    )

  SELECT
    proj."ID"::bigint                                              AS "PROJECT_ID",
    proj."NAME_SHORT",
    proj."NAME_LONG",
    proj."PROJECT_STATUS_ID"::bigint,
    ps_lkp."NAME_SHORT"                                           AS "PROJECT_STATUS_NAME_SHORT",
    proj."PROJECT_TYPE_ID"::bigint,
    pt."NAME_SHORT"                                               AS "PROJECT_TYPE_NAME_SHORT",
    proj."PROJECT_MANAGER_ID"::bigint,
    (
      e."SHORT_NAME" ||
      CASE WHEN e."FIRST_NAME" IS NOT NULL
        THEN ': ' || e."FIRST_NAME" || ' ' || COALESCE(e."LAST_NAME", '')
        ELSE ''
      END
    )                                                             AS "PROJECT_MANAGER_DISPLAY",
    proj."ADDRESS_ID"::bigint,
    a."ADDRESS_NAME_1"                                            AS "ADDRESS_NAME",
    proj."COMPANY_ID"::bigint,
    c."COMPANY_NAME_1"                                            AS "COMPANY_NAME",
    proj."DEPARTMENT_ID"::bigint,
    d."NAME_SHORT"                                                AS "DEPARTMENT_NAME",

    COALESCE(pa."REVENUE_BUDGET", 0) + COALESCE(pa."EXTRAS_BUDGET", 0)
                                                                  AS "BUDGET_TOTAL_NET",
    pa."LEISTUNGSSTAND_PERCENT",
    COALESCE(pa."REVENUE_COMPLETION_VALUE", 0) + COALESCE(pa."EXTRAS_COMPLETION_VALUE", 0)
                                                                  AS "LEISTUNGSSTAND_VALUE",
    COALESCE(ta."HOURS_TOTAL", 0),
    COALESCE(ta."COST_TOTAL",  0),

    CASE
      WHEN (COALESCE(pa."REVENUE_COMPLETION_VALUE", 0) + COALESCE(pa."EXTRAS_COMPLETION_VALUE", 0)) = 0
        THEN NULL
      ELSE COALESCE(ta."COST_TOTAL", 0)
         / (COALESCE(pa."REVENUE_COMPLETION_VALUE", 0) + COALESCE(pa."EXTRAS_COMPLETION_VALUE", 0))
    END                                                           AS "COST_RATIO",

    ( COALESCE(pa."REVENUE_BUDGET", 0) + COALESCE(pa."EXTRAS_BUDGET", 0) )
    - ( COALESCE(pa."REVENUE_COMPLETION_VALUE", 0) + COALESCE(pa."EXTRAS_COMPLETION_VALUE", 0) )
                                                                  AS "REMAINING_BUDGET_NET",

    COALESCE(proj."PARTIAL_PAYMENTS", 0) + COALESCE(proj."INVOICED", 0)
                                                                  AS "BILLED_NET_TOTAL",

    ( COALESCE(pa."REVENUE_COMPLETION_VALUE", 0) + COALESCE(pa."EXTRAS_COMPLETION_VALUE", 0) )
    - ( COALESCE(proj."PARTIAL_PAYMENTS", 0) + COALESCE(proj."INVOICED", 0) )
                                                                  AS "OPEN_NET_TOTAL",

    COALESCE(pya."PAYED_NET_TOTAL", 0),
    COALESCE(ta."SALES_TOTAL",   0),
    COALESCE(ta."QTY_EXT_TOTAL", 0)

  FROM public."PROJECT" proj
  LEFT JOIN prog_agg pa  ON  pa."PROJECT_ID"  = proj."ID"
  LEFT JOIN tec_agg  ta  ON  ta."PROJECT_ID"  = proj."ID"
  LEFT JOIN pay_agg  pya ON pya."PROJECT_ID"  = proj."ID"
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
