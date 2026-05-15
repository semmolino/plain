-- Migration 0032: Fix BT2 Honorar semantics in date-filtered RPCs
--
-- Problem:
--   For BILLING_TYPE_ID = 2 (hourly) structures, Honorar Netto and
--   Leistungsstand % were wrong when PROJECT_STRUCTURE.REVENUE = 0
--   (either because the structure was created after the cutoff or had
--   no budget set).
--
-- Correct BT2 semantics:
--   • Honorar Netto     = SP_TOT  (earned = billed TEC, not a fixed budget)
--   • Leistungsstand %  = 100 %  (all booked TEC is 100 % earned by definition)
--                         … unless SP_TOT = 0, then 0 %
--   • Rest-Honorar      = 0      (Honorar = earned, nothing remaining)
--   • BUDGET_TOTAL_NET in header/list = uses SP_TOT for BT2 nodes (so
--     Leistungsstand % at project level is also 100 % for BT2)
--
-- Affected functions: fn_project_report_structure,
--                     fn_project_report_header,
--                     fn_project_list_report
--
-- Safe to re-run: all DROPs use IF EXISTS.

DROP FUNCTION IF EXISTS public.fn_project_report_header(bigint, bigint, timestamptz, date, date);
DROP FUNCTION IF EXISTS public.fn_project_report_structure(bigint, bigint, timestamptz, date, date);
DROP FUNCTION IF EXISTS public.fn_project_list_report(bigint, timestamptz, date, date);


-- ── 1. fn_project_report_header ───────────────────────────────────────────────

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


-- ── 2. fn_project_report_structure ───────────────────────────────────────────

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


-- ── 3. fn_project_list_report ─────────────────────────────────────────────────

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
