-- Phase 2: Date-filtered reporting functions
-- Mirrors VW_REPORT_PROJECT_DETAIL and VW_REPORT_PROJECT_DETAIL_STRUCTURE
-- but accepts optional date parameters.
--
-- Filter logic:
--   p_as_of     (not null, p_date_from/to null): latest data as of that timestamp
--   p_date_from / p_date_to (p_as_of null):      TEC entries in period, progress as of p_date_to
--   all null:                                     same as the unfiltered views (current state)

-- ============================================================================
-- fn_project_report_header
-- Returns one row per project with date-filtered aggregates.
-- ============================================================================
create or replace function public.fn_project_report_header(
  p_tenant_id  bigint,
  p_project_id bigint,
  p_as_of      timestamptz default null,
  p_date_from  date        default null,
  p_date_to    date        default null
)
returns table (
  "TENANT_ID"              bigint,
  "PROJECT_ID"             bigint,
  "NAME_SHORT"             text,
  "NAME_LONG"              text,
  "BUDGET_TOTAL_NET"       numeric,
  "LEISTUNGSSTAND_PERCENT" numeric,
  "LEISTUNGSSTAND_VALUE"   numeric,
  "HOURS_TOTAL"            numeric,
  "COST_TOTAL"             numeric,
  "EARNED_VALUE_NET"       numeric,
  "PARTIAL_PAYMENT_NET_TOTAL" numeric,
  "INVOICE_NET_TOTAL"         numeric
)
language sql stable as $$
  with
    -- Progress cutoff timestamp:
    --   as_of mode  → p_as_of
    --   period mode → end of p_date_to
    --   no filter   → now()
    cutoff as (
      select
        case
          when p_as_of   is not null then p_as_of
          when p_date_to is not null then (p_date_to::timestamptz + interval '1 day' - interval '1 microsecond')
          else now()
        end as ts
    ),

    -- Latest progress per structure up to cutoff
    prog as (
      select distinct on (pp."STRUCTURE_ID")
        pp."STRUCTURE_ID",
        pp."REVENUE",
        pp."EXTRAS",
        pp."REVENUE_COMPLETION_PERCENT",
        pp."REVENUE_COMPLETION",
        pp."EXTRAS_COMPLETION"
      from public."PROJECT_PROGRESS" pp
      join public."PROJECT_STRUCTURE" ps
        on ps."TENANT_ID"  = pp."TENANT_ID"
       and ps."ID"         = pp."STRUCTURE_ID"
      cross join cutoff
      where pp."TENANT_ID"   = p_tenant_id
        and ps."PROJECT_ID"  = p_project_id
        and pp."created_at" <= cutoff.ts
      order by pp."STRUCTURE_ID", pp."created_at" desc, pp."ID" desc
    ),

    prog_agg as (
      select
        sum(coalesce(p."REVENUE", 0))                   as "REVENUE_BUDGET",
        sum(coalesce(p."EXTRAS",  0))                   as "EXTRAS_BUDGET",
        avg(nullif(p."REVENUE_COMPLETION_PERCENT", 0))  as "REVENUE_COMPLETION_PERCENT_AVG",
        sum(coalesce(p."REVENUE_COMPLETION", 0))        as "REVENUE_COMPLETION_VALUE",
        sum(coalesce(p."EXTRAS_COMPLETION",  0))        as "EXTRAS_COMPLETION_VALUE"
      from prog p
    ),

    -- TEC aggregation with date filter applied per mode
    tec_agg as (
      select
        coalesce(sum(t."QUANTITY_INT"), 0) as "HOURS_TOTAL",
        coalesce(sum(t."CP_TOT"),       0) as "COST_TOTAL"
      from public."TEC" t
      join public."PROJECT_STRUCTURE" ps
        on ps."TENANT_ID"  = t."TENANT_ID"
       and ps."ID"         = t."STRUCTURE_ID"
      where t."TENANT_ID"   = p_tenant_id
        and ps."PROJECT_ID" = p_project_id
        and (p_as_of    is null or t."DATE_VOUCHER" <= p_as_of::date)
        and (p_date_from is null or t."DATE_VOUCHER" >= p_date_from)
        and (p_date_to   is null or t."DATE_VOUCHER" <= p_date_to)
    ),

  select
    proj."TENANT_ID",
    proj."ID"::bigint,
    proj."NAME_SHORT",
    proj."NAME_LONG",

    coalesce(pa."REVENUE_BUDGET", 0) + coalesce(pa."EXTRAS_BUDGET", 0)
      as "BUDGET_TOTAL_NET",

    pa."REVENUE_COMPLETION_PERCENT_AVG"
      as "LEISTUNGSSTAND_PERCENT",

    coalesce(pa."REVENUE_COMPLETION_VALUE", 0) + coalesce(pa."EXTRAS_COMPLETION_VALUE", 0)
      as "LEISTUNGSSTAND_VALUE",

    coalesce(ta."HOURS_TOTAL", 0) as "HOURS_TOTAL",
    coalesce(ta."COST_TOTAL",  0) as "COST_TOTAL",

    coalesce(pa."REVENUE_COMPLETION_VALUE", 0) + coalesce(pa."EXTRAS_COMPLETION_VALUE", 0)
      as "EARNED_VALUE_NET",

    coalesce(proj."PARTIAL_PAYMENTS", 0) as "PARTIAL_PAYMENT_NET_TOTAL",
    coalesce(proj."INVOICED",         0) as "INVOICE_NET_TOTAL"

  from public."PROJECT" proj
  cross join prog_agg pa
  cross join tec_agg  ta
  where proj."TENANT_ID" = p_tenant_id
    and proj."ID"        = p_project_id
$$;


-- ============================================================================
-- fn_project_report_structure
-- Returns one row per structure element with date-filtered aggregates.
-- ============================================================================
create or replace function public.fn_project_report_structure(
  p_tenant_id  bigint,
  p_project_id bigint,
  p_as_of      timestamptz default null,
  p_date_from  date        default null,
  p_date_to    date        default null
)
returns table (
  "TENANT_ID"           bigint,
  "PROJECT_ID"          bigint,
  "STRUCTURE_ID"        bigint,
  "PARENT_STRUCTURE_ID" bigint,
  "NAME_SHORT"          text,
  "NAME_LONG"           text,
  "HOURS_TOTAL"         numeric,
  "COST_TOTAL"          numeric,
  "EARNED_VALUE_NET"    numeric,
  "HONORAR_NET"         numeric,
  "REST_HONORAR"        numeric
)
language sql stable as $$
  with
    cutoff as (
      select
        case
          when p_as_of   is not null then p_as_of
          when p_date_to is not null then (p_date_to::timestamptz + interval '1 day' - interval '1 microsecond')
          else now()
        end as ts
    ),

    -- Latest progress per structure up to cutoff
    prog as (
      select distinct on (pp."STRUCTURE_ID")
        pp."STRUCTURE_ID",
        pp."REVENUE",
        pp."EXTRAS",
        pp."REVENUE_COMPLETION",
        pp."EXTRAS_COMPLETION"
      from public."PROJECT_PROGRESS" pp
      join public."PROJECT_STRUCTURE" ps
        on ps."TENANT_ID"  = pp."TENANT_ID"
       and ps."ID"         = pp."STRUCTURE_ID"
      cross join cutoff
      where pp."TENANT_ID"   = p_tenant_id
        and ps."PROJECT_ID"  = p_project_id
        and pp."created_at" <= cutoff.ts
      order by pp."STRUCTURE_ID", pp."created_at" desc, pp."ID" desc
    )

  select
    ps."TENANT_ID",
    ps."PROJECT_ID"::bigint,
    ps."ID"::bigint        as "STRUCTURE_ID",
    ps."FATHER_ID"::bigint as "PARENT_STRUCTURE_ID",
    ps."NAME_SHORT",
    ps."NAME_LONG",

    coalesce(sum(t."QUANTITY_INT"), 0) as "HOURS_TOTAL",
    coalesce(sum(t."CP_TOT"),       0) as "COST_TOTAL",

    coalesce(prog."REVENUE_COMPLETION", 0) + coalesce(prog."EXTRAS_COMPLETION", 0)
      as "EARNED_VALUE_NET",

    coalesce(prog."REVENUE", 0) + coalesce(prog."EXTRAS", 0)
      as "HONORAR_NET",

    ( coalesce(prog."REVENUE", 0) + coalesce(prog."EXTRAS", 0) )
    - ( coalesce(prog."REVENUE_COMPLETION", 0) + coalesce(prog."EXTRAS_COMPLETION", 0) )
      as "REST_HONORAR"

  from public."PROJECT_STRUCTURE" ps
  left join public."TEC" t
    on t."TENANT_ID"    = ps."TENANT_ID"
   and t."STRUCTURE_ID" = ps."ID"
   and (p_as_of    is null or t."DATE_VOUCHER" <= p_as_of::date)
   and (p_date_from is null or t."DATE_VOUCHER" >= p_date_from)
   and (p_date_to   is null or t."DATE_VOUCHER" <= p_date_to)
  left join prog
    on prog."STRUCTURE_ID" = ps."ID"
  where ps."TENANT_ID"  = p_tenant_id
    and ps."PROJECT_ID" = p_project_id
  group by
    ps."TENANT_ID", ps."PROJECT_ID", ps."ID", ps."FATHER_ID",
    ps."NAME_SHORT", ps."NAME_LONG",
    prog."REVENUE", prog."EXTRAS",
    prog."REVENUE_COMPLETION", prog."EXTRAS_COMPLETION"
  order by ps."FATHER_ID" asc nulls first, ps."ID" asc
$$;
