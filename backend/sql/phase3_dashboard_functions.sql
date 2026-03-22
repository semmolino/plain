-- Phase 3: Dashboard aggregate functions
-- Used by /api/reports/dashboard/* endpoints

-- ============================================================================
-- fn_dashboard_kpis: single-row KPI summary for the entire tenant
-- ============================================================================
create or replace function public.fn_dashboard_kpis(p_tenant_id bigint)
returns table (
  "HONORAR_GESAMT"      numeric,   -- sum of (REVENUE + EXTRAS) from latest progress per structure
  "LEISTUNGSSTAND_VALUE" numeric,  -- sum of (REVENUE_COMPLETION + EXTRAS_COMPLETION)
  "OFFENE_LEISTUNG"     numeric,   -- LEISTUNGSSTAND - billed
  "STUNDEN_MONAT"       numeric,   -- hours booked in current calendar month
  "ABSCHLAGSRECHNUNGEN" numeric,   -- sum PROJECT.PARTIAL_PAYMENTS
  "SCHLUSSGERECHNET"    numeric    -- sum PROJECT.INVOICED
)
language sql stable as $$
  with
    -- Latest progress snapshot per structure (tenant-wide)
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


-- ============================================================================
-- fn_dashboard_monthly: hours + costs per month, last 6 months
-- ============================================================================
create or replace function public.fn_dashboard_monthly(p_tenant_id bigint)
returns table (
  "MONTH"       text,
  "HOURS_TOTAL" numeric,
  "COST_TOTAL"  numeric
)
language sql stable as $$
  select
    to_char(date_trunc('month', t."DATE_VOUCHER"::date), 'YYYY-MM') as "MONTH",
    coalesce(sum(t."QUANTITY_INT"), 0)                               as "HOURS_TOTAL",
    coalesce(sum(t."CP_TOT"),       0)                               as "COST_TOTAL"
  from public."TEC" t
  where t."TENANT_ID" = p_tenant_id
    and t."DATE_VOUCHER" >= (date_trunc('month', current_date) - interval '5 months')::date
  group by date_trunc('month', t."DATE_VOUCHER"::date)
  order by 1
$$;


-- ============================================================================
-- fn_dashboard_by_status: project count grouped by PROJECT_STATUS
-- ============================================================================
create or replace function public.fn_dashboard_by_status(p_tenant_id bigint)
returns table (
  "STATUS_NAME"   text,
  "PROJECT_COUNT" bigint
)
language sql stable as $$
  select
    coalesce(ps."NAME_SHORT", 'Kein Status') as "STATUS_NAME",
    count(p."ID")::bigint                     as "PROJECT_COUNT"
  from public."PROJECT" p
  left join public."PROJECT_STATUS" ps on ps."ID" = p."PROJECT_STATUS_ID"
  where p."TENANT_ID" = p_tenant_id
  group by ps."NAME_SHORT"
  order by count(p."ID") desc
$$;
