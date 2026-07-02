-- 0098: Pausen (ENTRY_KIND='BREAK') aus den tenant-weiten Stunden-KPIs des
-- Dashboards ausnehmen.
--
-- Hintergrund: Pausen werden als kostenneutrale TEC-Zeilen mit QUANTITY_INT > 0
-- gebucht (Timer-Pause und manuelle Pause-Buchung). Sie erfuellen die ArbZG-
-- Pausenpflicht (§ 4), zaehlen aber NICHT als geleistete Arbeitszeit.
--
-- Die struktur-/projektbezogenen Reports sind bereits sauber, weil sie TEC ueber
-- STRUCTURE_ID joinen und Pausen keine Struktur tragen. Die beiden Dashboard-
-- Funktionen summieren QUANTITY_INT jedoch tenant-weit ohne Struktur-Join und
-- zaehlten Pausen daher faelschlich als Stunden mit. Dieser Fix schliesst sie
-- konsistent aus (und behebt damit auch die bisherige Mitzaehlung von Timer-
-- Pausen). Pauschalen/Stueckleistungen tragen QUANTITY_INT=0 und bleiben ohne
-- Filter unauffaellig.

-- ============================================================================
-- fn_dashboard_kpis: single-row KPI summary for the entire tenant
-- ============================================================================
create or replace function public.fn_dashboard_kpis(p_tenant_id bigint)
returns table (
  "HONORAR_GESAMT"      numeric,
  "LEISTUNGSSTAND_VALUE" numeric,
  "OFFENE_LEISTUNG"     numeric,
  "STUNDEN_MONAT"       numeric,
  "ABSCHLAGSRECHNUNGEN" numeric,
  "SCHLUSSGERECHNET"    numeric
)
language sql stable as $$
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
    and coalesce(t."ENTRY_KIND", 'WORK') <> 'BREAK'
    and t."DATE_VOUCHER" >= (date_trunc('month', current_date) - interval '5 months')::date
  group by date_trunc('month', t."DATE_VOUCHER"::date)
  order by 1
$$;
