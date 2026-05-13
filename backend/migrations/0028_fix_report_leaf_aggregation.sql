-- Migration 0028: Fix leaf-node aggregation in project reporting
--
-- ROOT CAUSE 1: VW_PROJECT_PROGRESS_AGG started from VW_PROJECT_PROGRESS_LATEST
-- (snapshot rows), so leaf nodes that never had a snapshot contributed 0 to the
-- budget. REVENUE/EXTRAS (budget) must always come from PROJECT_STRUCTURE; only
-- completion values come from snapshots.
--
-- ROOT CAUSE 2: All views/RPCs summed ALL structure nodes (parents + leaves),
-- double-counting budget since parent.REVENUE = sum(children.REVENUE).
--
-- FIX STRATEGY:
--   Budget  → PROJECT_STRUCTURE directly (leaf nodes only, LEFT JOIN to snapshot)
--   Completion → PROJECT_PROGRESS latest snapshot (leaf nodes only)
--   LEISTUNGSSTAND_PERCENT → 100 * sum(completion) / sum(budget), weighted
--
-- Safe to re-run: all DROPs use IF EXISTS.

-- ── 0. Drop all objects that will change shape ────────────────────────────────

DROP VIEW IF EXISTS public."VW_REPORT_PROJECT_LIST_ROOT";
DROP VIEW IF EXISTS public."VW_REPORT_PROJECT_DETAIL";
DROP VIEW IF EXISTS "REPORTING"."VW_REPORT_PROJECT_LIST_ROOT";
DROP VIEW IF EXISTS "REPORTING"."VW_REPORT_PROJECT_DETAIL";
DROP VIEW IF EXISTS public."VW_REPORT_PROJECT_DETAIL_STRUCTURE";
DROP VIEW IF EXISTS "REPORTING"."VW_PROJECT_PROGRESS_AGG";
DROP FUNCTION IF EXISTS public.fn_project_report_header(bigint, bigint, timestamptz, date, date);
DROP FUNCTION IF EXISTS public.fn_project_report_structure(bigint, bigint, timestamptz, date, date);

-- ── 1. Fix VW_PROJECT_PROGRESS_AGG ───────────────────────────────────────────
-- Start from PROJECT_STRUCTURE (leaf nodes) so every leaf is counted even when
-- no snapshot exists yet. LEFT JOIN to latest snapshot for completion values.

CREATE OR REPLACE VIEW "REPORTING"."VW_PROJECT_PROGRESS_AGG" AS
SELECT
  ls."TENANT_ID",
  ls."PROJECT_ID",

  -- Budget and completion always from PROJECT_STRUCTURE (current truth).
  -- patchStructureCompletionPercents updates PROJECT_STRUCTURE directly without
  -- inserting a snapshot, so VW_PROJECT_PROGRESS_LATEST can lag behind.
  SUM(COALESCE(ps."REVENUE", 0))                   AS "REVENUE_BUDGET",
  SUM(COALESCE(ps."EXTRAS",  0))                   AS "EXTRAS_BUDGET",

  -- Weighted Leistungsstand: sum(completion) / sum(budget), 0-100
  CASE
    WHEN SUM(COALESCE(ps."REVENUE", 0)) + SUM(COALESCE(ps."EXTRAS", 0)) = 0 THEN NULL
    ELSE 100.0
       * ( SUM(COALESCE(ps."REVENUE_COMPLETION", 0)) + SUM(COALESCE(ps."EXTRAS_COMPLETION",  0)) )
       / ( SUM(COALESCE(ps."REVENUE", 0))            + SUM(COALESCE(ps."EXTRAS",  0)) )
  END                                              AS "LEISTUNGSSTAND_PERCENT",

  SUM(COALESCE(ps."REVENUE_COMPLETION", 0))        AS "REVENUE_COMPLETION_VALUE",
  SUM(COALESCE(ps."EXTRAS_COMPLETION",  0))        AS "EXTRAS_COMPLETION_VALUE"

FROM public."PROJECT_STRUCTURE" ps
WHERE NOT EXISTS (
  SELECT 1
  FROM   public."PROJECT_STRUCTURE" child
  WHERE  child."TENANT_ID" = ps."TENANT_ID"
    AND  child."FATHER_ID" = ps."ID"
)
GROUP BY ps."TENANT_ID", ps."PROJECT_ID";

-- ── 2. Recreate VW_REPORT_PROJECT_DETAIL in public schema ────────────────────

CREATE OR REPLACE VIEW public."VW_REPORT_PROJECT_DETAIL" AS
SELECT
  p."TENANT_ID",
  p."ID"                AS "PROJECT_ID",
  p."NAME_LONG",
  p."NAME_SHORT",
  p."PROJECT_STATUS_ID",
  ps_lkp."NAME_SHORT"   AS "PROJECT_STATUS_NAME_SHORT",
  p."PROJECT_TYPE_ID",
  pt."NAME_SHORT"       AS "PROJECT_TYPE_NAME_SHORT",
  p."PROJECT_MANAGER_ID",
  (
    e."SHORT_NAME" ||
    CASE
      WHEN e."FIRST_NAME" IS NOT NULL
        THEN (': ' || e."FIRST_NAME" || ' ' || COALESCE(e."LAST_NAME", ''))
      ELSE ''
    END
  )                     AS "PROJECT_MANAGER_DISPLAY",
  p."ADDRESS_ID",
  a."ADDRESS_NAME_1"    AS "ADDRESS_NAME",
  p."COMPANY_ID",
  c."COMPANY_NAME_1"    AS "COMPANY_NAME",
  p."DEPARTMENT_ID",
  d."NAME_SHORT"        AS "DEPARTMENT_NAME",
  p."CONTACT_ID",
  co."LAST_NAME"        AS "CONTACT_NAME",
  p."created_at"        AS "PROJECT_created_at",

  COALESCE(pa."REVENUE_BUDGET", 0) + COALESCE(pa."EXTRAS_BUDGET", 0)
                                                AS "BUDGET_TOTAL_NET",
  pa."LEISTUNGSSTAND_PERCENT"                   AS "LEISTUNGSSTAND_PERCENT",
  COALESCE(pa."REVENUE_COMPLETION_VALUE", 0) + COALESCE(pa."EXTRAS_COMPLETION_VALUE", 0)
                                                AS "LEISTUNGSSTAND_VALUE",
  COALESCE(ta."HOURS_TOTAL", 0)                 AS "HOURS_TOTAL",
  COALESCE(ta."COST_TOTAL",  0)                 AS "COST_TOTAL",
  COALESCE(pa."REVENUE_COMPLETION_VALUE", 0) + COALESCE(pa."EXTRAS_COMPLETION_VALUE", 0)
                                                AS "EARNED_VALUE_NET",

  CASE
    WHEN (COALESCE(pa."REVENUE_COMPLETION_VALUE", 0) + COALESCE(pa."EXTRAS_COMPLETION_VALUE", 0)) = 0 THEN NULL
    ELSE COALESCE(ta."COST_TOTAL", 0)
       / (COALESCE(pa."REVENUE_COMPLETION_VALUE", 0) + COALESCE(pa."EXTRAS_COMPLETION_VALUE", 0))
  END                                           AS "COST_RATIO",

  (COALESCE(pa."REVENUE_BUDGET", 0) + COALESCE(pa."EXTRAS_BUDGET", 0))
  - (COALESCE(pa."REVENUE_COMPLETION_VALUE", 0) + COALESCE(pa."EXTRAS_COMPLETION_VALUE", 0))
                                                AS "REMAINING_BUDGET_NET",

  COALESCE(p."PARTIAL_PAYMENTS", 0)             AS "PARTIAL_PAYMENT_NET_TOTAL",
  COALESCE(p."INVOICED",         0)             AS "INVOICE_NET_TOTAL",
  COALESCE(ba."PAYED_NET_TOTAL", 0)             AS "PAYED_NET_TOTAL",
  (COALESCE(p."PARTIAL_PAYMENTS", 0) + COALESCE(p."INVOICED", 0))
                                                AS "BILLED_NET_TOTAL",
  (COALESCE(pa."REVENUE_COMPLETION_VALUE", 0) + COALESCE(pa."EXTRAS_COMPLETION_VALUE", 0))
  - (COALESCE(p."PARTIAL_PAYMENTS", 0) + COALESCE(p."INVOICED", 0))
                                                AS "OPEN_NET_TOTAL",
  COALESCE(ta."SALES_TOTAL",   0)               AS "SALES_TOTAL",
  COALESCE(ta."QTY_EXT_TOTAL", 0)               AS "QTY_EXT_TOTAL"

FROM public."PROJECT" p
LEFT JOIN "REPORTING"."VW_PROJECT_PROGRESS_AGG" pa
  ON  pa."TENANT_ID"  = p."TENANT_ID"
 AND  pa."PROJECT_ID" = p."ID"
LEFT JOIN "REPORTING"."VW_PROJECT_TIME_AGG" ta
  ON  ta."TENANT_ID"  = p."TENANT_ID"
 AND  ta."PROJECT_ID" = p."ID"
LEFT JOIN "REPORTING"."VW_PROJECT_BILLING_AGG" ba
  ON  ba."TENANT_ID"  = p."TENANT_ID"
 AND  ba."PROJECT_ID" = p."ID"
LEFT JOIN public."EMPLOYEE" e
  ON  e."TENANT_ID" = p."TENANT_ID"
 AND  e."ID"        = p."PROJECT_MANAGER_ID"
LEFT JOIN public."PROJECT_STATUS" ps_lkp
  ON  ps_lkp."ID" = p."PROJECT_STATUS_ID"
LEFT JOIN public."PROJECT_TYPE" pt
  ON  pt."ID" = p."PROJECT_TYPE_ID"
LEFT JOIN public."ADDRESS" a
  ON  a."TENANT_ID" = p."TENANT_ID"
 AND  a."ID"        = p."ADDRESS_ID"
LEFT JOIN public."COMPANY" c
  ON  c."TENANT_ID" = p."TENANT_ID"
 AND  c."ID"        = p."COMPANY_ID"
LEFT JOIN public."DEPARTMENT" d
  ON  d."ID" = p."DEPARTMENT_ID"
LEFT JOIN public."CONTACTS" co
  ON  co."TENANT_ID" = p."TENANT_ID"
 AND  co."ID"        = p."CONTACT_ID";

-- ── 3. Recreate VW_REPORT_PROJECT_LIST_ROOT in public schema ─────────────────

CREATE OR REPLACE VIEW public."VW_REPORT_PROJECT_LIST_ROOT" AS
SELECT
  pd."TENANT_ID",        pd."PROJECT_ID",
  pd."NAME_SHORT",       pd."NAME_LONG",
  pd."PROJECT_STATUS_ID",   pd."PROJECT_STATUS_NAME_SHORT",
  pd."PROJECT_TYPE_ID",     pd."PROJECT_TYPE_NAME_SHORT",
  pd."PROJECT_MANAGER_ID",  pd."PROJECT_MANAGER_DISPLAY",
  pd."ADDRESS_ID",          pd."ADDRESS_NAME",
  pd."COMPANY_ID",          pd."COMPANY_NAME",
  pd."DEPARTMENT_ID",       pd."DEPARTMENT_NAME",
  pd."CONTACT_ID",          pd."CONTACT_NAME",
  pd."BUDGET_TOTAL_NET",    pd."LEISTUNGSSTAND_PERCENT",
  pd."LEISTUNGSSTAND_VALUE", pd."HOURS_TOTAL",  pd."COST_TOTAL",
  pd."EARNED_VALUE_NET",    pd."COST_RATIO",    pd."REMAINING_BUDGET_NET",
  pd."PARTIAL_PAYMENT_NET_TOTAL", pd."INVOICE_NET_TOTAL",
  pd."PAYED_NET_TOTAL",     pd."BILLED_NET_TOTAL", pd."OPEN_NET_TOTAL"
FROM public."VW_REPORT_PROJECT_DETAIL" pd;

-- ── 4. Fix VW_REPORT_PROJECT_DETAIL_STRUCTURE ────────────────────────────────
-- HONORAR_NET from PROJECT_STRUCTURE (not snapshot), so no-snapshot nodes show
-- correct budget. Add IS_LEAF, LEISTUNGSSTAND_PERCENT, KOSTENQUOTE.

CREATE OR REPLACE VIEW public."VW_REPORT_PROJECT_DETAIL_STRUCTURE" AS
SELECT
  ps."TENANT_ID",
  ps."PROJECT_ID",
  ps."ID"        AS "STRUCTURE_ID",
  ps."FATHER_ID" AS "PARENT_STRUCTURE_ID",
  ps."NAME_SHORT",
  ps."NAME_LONG",

  NOT EXISTS (
    SELECT 1
    FROM   public."PROJECT_STRUCTURE" child
    WHERE  child."TENANT_ID" = ps."TENANT_ID"
      AND  child."FATHER_ID" = ps."ID"
  )                                                                         AS "IS_LEAF",

  COALESCE(SUM(t."QUANTITY_INT"), 0)                                        AS "HOURS_TOTAL",
  COALESCE(SUM(t."CP_TOT"),       0)                                        AS "COST_TOTAL",

  -- Completion always from PROJECT_STRUCTURE (current truth, not snapshots)
  COALESCE(ps."REVENUE_COMPLETION", 0) + COALESCE(ps."EXTRAS_COMPLETION", 0)
                                                                            AS "EARNED_VALUE_NET",
  COALESCE(ps."REVENUE", 0) + COALESCE(ps."EXTRAS", 0)                     AS "HONORAR_NET",

  ( COALESCE(ps."REVENUE", 0) + COALESCE(ps."EXTRAS", 0) )
  - ( COALESCE(ps."REVENUE_COMPLETION", 0) + COALESCE(ps."EXTRAS_COMPLETION", 0) )
                                                                            AS "REST_HONORAR",

  COALESCE(ps."REVENUE_COMPLETION_PERCENT", 0)                              AS "LEISTUNGSSTAND_PERCENT",

  CASE
    WHEN (COALESCE(ps."REVENUE_COMPLETION", 0) + COALESCE(ps."EXTRAS_COMPLETION", 0)) = 0 THEN NULL
    ELSE COALESCE(SUM(t."CP_TOT"), 0)
       / (COALESCE(ps."REVENUE_COMPLETION", 0) + COALESCE(ps."EXTRAS_COMPLETION", 0))
  END                                                                       AS "KOSTENQUOTE"

FROM public."PROJECT_STRUCTURE" ps
LEFT JOIN public."TEC" t
  ON  t."TENANT_ID"    = ps."TENANT_ID"
 AND  t."STRUCTURE_ID" = ps."ID"
GROUP BY
  ps."TENANT_ID",          ps."PROJECT_ID",
  ps."ID",                 ps."FATHER_ID",
  ps."NAME_SHORT",         ps."NAME_LONG",
  ps."REVENUE",            ps."EXTRAS",
  ps."REVENUE_COMPLETION", ps."EXTRAS_COMPLETION",
  ps."REVENUE_COMPLETION_PERCENT";

-- ── 5. Fix fn_project_report_header ──────────────────────────────────────────
-- leaf_structs CTE provides budget from PROJECT_STRUCTURE.
-- prog CTE provides completion from PROJECT_PROGRESS (date-filtered).

CREATE OR REPLACE FUNCTION public.fn_project_report_header(
  p_tenant_id  bigint,
  p_project_id bigint,
  p_as_of      timestamptz DEFAULT NULL,
  p_date_from  date        DEFAULT NULL,
  p_date_to    date        DEFAULT NULL
)
RETURNS TABLE (
  "TENANT_ID"                 bigint,
  "PROJECT_ID"                bigint,
  "NAME_SHORT"                text,
  "NAME_LONG"                 text,
  "PROJECT_STATUS_NAME_SHORT" text,
  "PROJECT_MANAGER_DISPLAY"   text,
  "COMPANY_NAME"              text,
  "BUDGET_TOTAL_NET"          numeric,
  "LEISTUNGSSTAND_PERCENT"    numeric,
  "LEISTUNGSSTAND_VALUE"      numeric,
  "HOURS_TOTAL"               numeric,
  "COST_TOTAL"                numeric,
  "EARNED_VALUE_NET"          numeric,
  "COST_RATIO"                numeric,
  "REMAINING_BUDGET_NET"      numeric,
  "PARTIAL_PAYMENT_NET_TOTAL" numeric,
  "INVOICE_NET_TOTAL"         numeric,
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

    -- All leaf structures for this project (budget source)
    leaf_structs AS (
      SELECT
        ps."ID"      AS "STRUCTURE_ID",
        ps."REVENUE",
        ps."EXTRAS"
      FROM public."PROJECT_STRUCTURE" ps
      WHERE ps."TENANT_ID"  = p_tenant_id
        AND ps."PROJECT_ID" = p_project_id
        AND NOT EXISTS (
          SELECT 1
          FROM   public."PROJECT_STRUCTURE" child
          WHERE  child."TENANT_ID" = ps."TENANT_ID"
            AND  child."FATHER_ID" = ps."ID"
        )
    ),

    -- Latest completion per leaf structure up to cutoff
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

    prog_agg AS (
      SELECT
        -- Budget from leaf_structs (all leaves, regardless of snapshot)
        COALESCE(SUM(ls."REVENUE"), 0)  AS "REVENUE_BUDGET",
        COALESCE(SUM(ls."EXTRAS"),  0)  AS "EXTRAS_BUDGET",
        -- Completion from prog (0 when no snapshot)
        COALESCE(SUM(p."REVENUE_COMPLETION"), 0)  AS "REVENUE_COMPLETION_VALUE",
        COALESCE(SUM(p."EXTRAS_COMPLETION"),  0)  AS "EXTRAS_COMPLETION_VALUE",
        -- Weighted Leistungsstand %
        CASE
          WHEN SUM(COALESCE(ls."REVENUE", 0)) + SUM(COALESCE(ls."EXTRAS", 0)) = 0 THEN NULL
          ELSE 100.0
             * ( COALESCE(SUM(p."REVENUE_COMPLETION"), 0) + COALESCE(SUM(p."EXTRAS_COMPLETION"), 0) )
             / ( SUM(COALESCE(ls."REVENUE", 0)) + SUM(COALESCE(ls."EXTRAS", 0)) )
        END                             AS "LEISTUNGSSTAND_PERCENT"
      FROM leaf_structs ls
      LEFT JOIN prog p ON p."STRUCTURE_ID" = ls."STRUCTURE_ID"
    ),

    tec_agg AS (
      SELECT
        COALESCE(SUM(t."QUANTITY_INT"), 0) AS "HOURS_TOTAL",
        COALESCE(SUM(t."CP_TOT"),       0) AS "COST_TOTAL",
        COALESCE(SUM(t."SP_TOT"),       0) AS "SALES_TOTAL",
        COALESCE(SUM(t."QUANTITY_EXT"), 0) AS "QTY_EXT_TOTAL"
      FROM public."TEC" t
      JOIN public."PROJECT_STRUCTURE" ps
        ON  ps."TENANT_ID"  = t."TENANT_ID"
       AND  ps."ID"         = t."STRUCTURE_ID"
      WHERE t."TENANT_ID"   = p_tenant_id
        AND ps."PROJECT_ID" = p_project_id
        AND (p_as_of     IS NULL OR t."DATE_VOUCHER" <= p_as_of::date)
        AND (p_date_from IS NULL OR t."DATE_VOUCHER" >= p_date_from)
        AND (p_date_to   IS NULL OR t."DATE_VOUCHER" <= p_date_to)
    ),

    pay_agg AS (
      SELECT COALESCE(SUM(pay."AMOUNT_PAYED_NET"), 0) AS "PAYED_NET_TOTAL"
      FROM public."PAYMENT" pay
      WHERE pay."TENANT_ID"  = p_tenant_id
        AND pay."PROJECT_ID" = p_project_id
    )

  SELECT
    proj."TENANT_ID",
    proj."ID"::bigint,
    proj."NAME_SHORT",
    proj."NAME_LONG",

    ps_lkp."NAME_SHORT"                                                AS "PROJECT_STATUS_NAME_SHORT",
    (
      e."SHORT_NAME" ||
      CASE WHEN e."FIRST_NAME" IS NOT NULL
        THEN ': ' || e."FIRST_NAME" || ' ' || COALESCE(e."LAST_NAME", '')
        ELSE ''
      END
    )                                                                  AS "PROJECT_MANAGER_DISPLAY",
    c."COMPANY_NAME_1"                                                 AS "COMPANY_NAME",

    pa."REVENUE_BUDGET" + pa."EXTRAS_BUDGET"                          AS "BUDGET_TOTAL_NET",
    pa."LEISTUNGSSTAND_PERCENT"                                        AS "LEISTUNGSSTAND_PERCENT",
    pa."REVENUE_COMPLETION_VALUE" + pa."EXTRAS_COMPLETION_VALUE"      AS "LEISTUNGSSTAND_VALUE",
    ta."HOURS_TOTAL",
    ta."COST_TOTAL",
    pa."REVENUE_COMPLETION_VALUE" + pa."EXTRAS_COMPLETION_VALUE"      AS "EARNED_VALUE_NET",

    CASE
      WHEN (pa."REVENUE_COMPLETION_VALUE" + pa."EXTRAS_COMPLETION_VALUE") = 0 THEN NULL
      ELSE ta."COST_TOTAL" / (pa."REVENUE_COMPLETION_VALUE" + pa."EXTRAS_COMPLETION_VALUE")
    END                                                                AS "COST_RATIO",

    (pa."REVENUE_BUDGET" + pa."EXTRAS_BUDGET")
    - (pa."REVENUE_COMPLETION_VALUE" + pa."EXTRAS_COMPLETION_VALUE")  AS "REMAINING_BUDGET_NET",

    COALESCE(proj."PARTIAL_PAYMENTS", 0)                              AS "PARTIAL_PAYMENT_NET_TOTAL",
    COALESCE(proj."INVOICED",         0)                              AS "INVOICE_NET_TOTAL",
    COALESCE(proj."PARTIAL_PAYMENTS", 0) + COALESCE(proj."INVOICED", 0)
                                                                      AS "BILLED_NET_TOTAL",
    (pa."REVENUE_COMPLETION_VALUE" + pa."EXTRAS_COMPLETION_VALUE")
    - (COALESCE(proj."PARTIAL_PAYMENTS", 0) + COALESCE(proj."INVOICED", 0))
                                                                      AS "OPEN_NET_TOTAL",
    pya."PAYED_NET_TOTAL",
    ta."SALES_TOTAL",
    ta."QTY_EXT_TOTAL"

  FROM public."PROJECT" proj
  CROSS JOIN prog_agg pa
  CROSS JOIN tec_agg  ta
  CROSS JOIN pay_agg  pya
  LEFT JOIN public."PROJECT_STATUS" ps_lkp
    ON  ps_lkp."ID" = proj."PROJECT_STATUS_ID"
  LEFT JOIN public."EMPLOYEE" e
    ON  e."TENANT_ID" = proj."TENANT_ID"
   AND  e."ID"        = proj."PROJECT_MANAGER_ID"
  LEFT JOIN public."COMPANY" c
    ON  c."TENANT_ID" = proj."TENANT_ID"
   AND  c."ID"        = proj."COMPANY_ID"
  WHERE proj."TENANT_ID" = p_tenant_id
    AND proj."ID"        = p_project_id
$$;

-- ── 6. Fix fn_project_report_structure ───────────────────────────────────────
-- HONORAR_NET from PROJECT_STRUCTURE (not snapshot).
-- Add IS_LEAF, LEISTUNGSSTAND_PERCENT (0-100), KOSTENQUOTE (ratio 0-1+).

CREATE OR REPLACE FUNCTION public.fn_project_report_structure(
  p_tenant_id  bigint,
  p_project_id bigint,
  p_as_of      timestamptz DEFAULT NULL,
  p_date_from  date        DEFAULT NULL,
  p_date_to    date        DEFAULT NULL
)
RETURNS TABLE (
  "TENANT_ID"              bigint,
  "PROJECT_ID"             bigint,
  "STRUCTURE_ID"           bigint,
  "PARENT_STRUCTURE_ID"    bigint,
  "NAME_SHORT"             text,
  "NAME_LONG"              text,
  "IS_LEAF"                boolean,
  "HOURS_TOTAL"            numeric,
  "COST_TOTAL"             numeric,
  "EARNED_VALUE_NET"       numeric,
  "HONORAR_NET"            numeric,
  "REST_HONORAR"           numeric,
  "LEISTUNGSSTAND_PERCENT" numeric,
  "KOSTENQUOTE"            numeric
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

    prog AS (
      SELECT DISTINCT ON (pp."STRUCTURE_ID")
        pp."STRUCTURE_ID",
        pp."REVENUE_COMPLETION",
        pp."EXTRAS_COMPLETION",
        pp."REVENUE_COMPLETION_PERCENT"
      FROM public."PROJECT_PROGRESS" pp
      JOIN public."PROJECT_STRUCTURE" ps
        ON  ps."TENANT_ID"  = pp."TENANT_ID"
       AND  ps."ID"         = pp."STRUCTURE_ID"
      CROSS JOIN cutoff
      WHERE pp."TENANT_ID"   = p_tenant_id
        AND ps."PROJECT_ID"  = p_project_id
        AND pp."created_at" <= cutoff.ts
      ORDER BY pp."STRUCTURE_ID", pp."created_at" DESC, pp."ID" DESC
    )

  SELECT
    ps."TENANT_ID",
    ps."PROJECT_ID"::bigint,
    ps."ID"::bigint        AS "STRUCTURE_ID",
    ps."FATHER_ID"::bigint AS "PARENT_STRUCTURE_ID",
    ps."NAME_SHORT",
    ps."NAME_LONG",

    NOT EXISTS (
      SELECT 1
      FROM   public."PROJECT_STRUCTURE" child
      WHERE  child."TENANT_ID" = ps."TENANT_ID"
        AND  child."FATHER_ID" = ps."ID"
    )                                                                       AS "IS_LEAF",

    COALESCE(SUM(t."QUANTITY_INT"), 0)                                      AS "HOURS_TOTAL",
    COALESCE(SUM(t."CP_TOT"),       0)                                      AS "COST_TOTAL",

    COALESCE(prog."REVENUE_COMPLETION", 0) + COALESCE(prog."EXTRAS_COMPLETION", 0)
                                                                            AS "EARNED_VALUE_NET",

    -- Budget from PROJECT_STRUCTURE (always correct)
    COALESCE(ps."REVENUE", 0) + COALESCE(ps."EXTRAS", 0)                   AS "HONORAR_NET",

    ( COALESCE(ps."REVENUE", 0) + COALESCE(ps."EXTRAS", 0) )
    - ( COALESCE(prog."REVENUE_COMPLETION", 0) + COALESCE(prog."EXTRAS_COMPLETION", 0) )
                                                                            AS "REST_HONORAR",

    COALESCE(prog."REVENUE_COMPLETION_PERCENT", 0)                          AS "LEISTUNGSSTAND_PERCENT",

    CASE
      WHEN (COALESCE(prog."REVENUE_COMPLETION", 0) + COALESCE(prog."EXTRAS_COMPLETION", 0)) = 0 THEN NULL
      ELSE COALESCE(SUM(t."CP_TOT"), 0)
         / (COALESCE(prog."REVENUE_COMPLETION", 0) + COALESCE(prog."EXTRAS_COMPLETION", 0))
    END                                                                     AS "KOSTENQUOTE"

  FROM public."PROJECT_STRUCTURE" ps
  LEFT JOIN public."TEC" t
    ON  t."TENANT_ID"    = ps."TENANT_ID"
   AND  t."STRUCTURE_ID" = ps."ID"
   AND  (p_as_of     IS NULL OR t."DATE_VOUCHER" <= p_as_of::date)
   AND  (p_date_from IS NULL OR t."DATE_VOUCHER" >= p_date_from)
   AND  (p_date_to   IS NULL OR t."DATE_VOUCHER" <= p_date_to)
  LEFT JOIN prog
    ON  prog."STRUCTURE_ID" = ps."ID"
  WHERE ps."TENANT_ID"  = p_tenant_id
    AND ps."PROJECT_ID" = p_project_id
  GROUP BY
    ps."TENANT_ID",  ps."PROJECT_ID",   ps."ID",   ps."FATHER_ID",
    ps."NAME_SHORT", ps."NAME_LONG",
    ps."REVENUE",    ps."EXTRAS",
    prog."REVENUE_COMPLETION",   prog."EXTRAS_COMPLETION",
    prog."REVENUE_COMPLETION_PERCENT"
  ORDER BY ps."FATHER_ID" ASC NULLS FIRST, ps."ID" ASC
$$;
