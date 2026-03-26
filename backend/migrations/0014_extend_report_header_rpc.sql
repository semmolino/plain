-- Extend fn_project_report_header to return the same columns as VW_REPORT_PROJECT_DETAIL.
--
-- The original RPC was missing: PROJECT_STATUS_NAME_SHORT, PROJECT_MANAGER_DISPLAY,
-- COMPANY_NAME, COST_RATIO, REMAINING_BUDGET_NET, BILLED_NET_TOTAL, OPEN_NET_TOTAL,
-- PAYED_NET_TOTAL, SALES_TOTAL, QTY_EXT_TOTAL — so date-filtered reports showed "—"
-- for most KPI tiles.

create or replace function public.fn_project_report_header(
  p_tenant_id  bigint,
  p_project_id bigint,
  p_as_of      timestamptz default null,
  p_date_from  date        default null,
  p_date_to    date        default null
)
returns table (
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
        coalesce(sum(p."REVENUE"), 0)                   as "REVENUE_BUDGET",
        coalesce(sum(p."EXTRAS"),  0)                   as "EXTRAS_BUDGET",
        avg(nullif(p."REVENUE_COMPLETION_PERCENT", 0))  as "REVENUE_COMPLETION_PERCENT_AVG",
        coalesce(sum(p."REVENUE_COMPLETION"), 0)        as "REVENUE_COMPLETION_VALUE",
        coalesce(sum(p."EXTRAS_COMPLETION"),  0)        as "EXTRAS_COMPLETION_VALUE"
      from prog p
    ),

    -- TEC with date filter
    tec_agg as (
      select
        coalesce(sum(t."QUANTITY_INT"), 0) as "HOURS_TOTAL",
        coalesce(sum(t."CP_TOT"),       0) as "COST_TOTAL",
        coalesce(sum(t."SP_TOT"),       0) as "SALES_TOTAL",
        coalesce(sum(t."QUANTITY_EXT"), 0) as "QTY_EXT_TOTAL"
      from public."TEC" t
      join public."PROJECT_STRUCTURE" ps
        on ps."TENANT_ID"  = t."TENANT_ID"
       and ps."ID"         = t."STRUCTURE_ID"
      where t."TENANT_ID"   = p_tenant_id
        and ps."PROJECT_ID" = p_project_id
        and (p_as_of     is null or t."DATE_VOUCHER" <= p_as_of::date)
        and (p_date_from is null or t."DATE_VOUCHER" >= p_date_from)
        and (p_date_to   is null or t."DATE_VOUCHER" <= p_date_to)
    ),

    -- Payments (never date-filtered — shows total paid to date)
    pay_agg as (
      select coalesce(sum(pay."AMOUNT_PAYED_NET"), 0) as "PAYED_NET_TOTAL"
      from public."PAYMENT" pay
      where pay."TENANT_ID"  = p_tenant_id
        and pay."PROJECT_ID" = p_project_id
    )

  select
    proj."TENANT_ID",
    proj."ID"::bigint,
    proj."NAME_SHORT",
    proj."NAME_LONG",

    ps_lkp."NAME_SHORT" as "PROJECT_STATUS_NAME_SHORT",

    (
      e."SHORT_NAME" ||
      case when e."FIRST_NAME" is not null
        then ': ' || e."FIRST_NAME" || ' ' || coalesce(e."LAST_NAME", '')
        else ''
      end
    ) as "PROJECT_MANAGER_DISPLAY",

    c."COMPANY_NAME_1" as "COMPANY_NAME",

    -- budget / leistungsstand (date-filtered via progress cutoff)
    pa."REVENUE_BUDGET" + pa."EXTRAS_BUDGET"                       as "BUDGET_TOTAL_NET",
    pa."REVENUE_COMPLETION_PERCENT_AVG"                            as "LEISTUNGSSTAND_PERCENT",
    pa."REVENUE_COMPLETION_VALUE" + pa."EXTRAS_COMPLETION_VALUE"   as "LEISTUNGSSTAND_VALUE",

    -- hours / costs (date-filtered via TEC filter)
    ta."HOURS_TOTAL",
    ta."COST_TOTAL",

    pa."REVENUE_COMPLETION_VALUE" + pa."EXTRAS_COMPLETION_VALUE"   as "EARNED_VALUE_NET",

    -- cost ratio
    case
      when (pa."REVENUE_COMPLETION_VALUE" + pa."EXTRAS_COMPLETION_VALUE") = 0 then null
      else ta."COST_TOTAL" / (pa."REVENUE_COMPLETION_VALUE" + pa."EXTRAS_COMPLETION_VALUE")
    end as "COST_RATIO",

    -- remaining budget
    (pa."REVENUE_BUDGET" + pa."EXTRAS_BUDGET")
    - (pa."REVENUE_COMPLETION_VALUE" + pa."EXTRAS_COMPLETION_VALUE") as "REMAINING_BUDGET_NET",

    -- billing (current state, not date-filtered)
    coalesce(proj."PARTIAL_PAYMENTS", 0)                                   as "PARTIAL_PAYMENT_NET_TOTAL",
    coalesce(proj."INVOICED",         0)                                   as "INVOICE_NET_TOTAL",
    coalesce(proj."PARTIAL_PAYMENTS", 0) + coalesce(proj."INVOICED", 0)    as "BILLED_NET_TOTAL",

    -- open = earned - billed
    (pa."REVENUE_COMPLETION_VALUE" + pa."EXTRAS_COMPLETION_VALUE")
    - (coalesce(proj."PARTIAL_PAYMENTS", 0) + coalesce(proj."INVOICED", 0)) as "OPEN_NET_TOTAL",

    pya."PAYED_NET_TOTAL",

    ta."SALES_TOTAL",
    ta."QTY_EXT_TOTAL"

  from public."PROJECT" proj
  cross join prog_agg pa
  cross join tec_agg  ta
  cross join pay_agg  pya
  left join public."PROJECT_STATUS" ps_lkp
    on ps_lkp."ID" = proj."PROJECT_STATUS_ID"
  left join public."EMPLOYEE" e
    on e."TENANT_ID" = proj."TENANT_ID"
   and e."ID"        = proj."PROJECT_MANAGER_ID"
  left join public."COMPANY" c
    on c."TENANT_ID" = proj."TENANT_ID"
   and c."ID"        = proj."COMPANY_ID"
  where proj."TENANT_ID" = p_tenant_id
    and proj."ID"        = p_project_id
$$;
