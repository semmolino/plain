-- Phase 1 / Reports v1 (v3 - ALL TABLES/COLUMNS UPPERCASE => quoted identifiers everywhere)
-- Generated from: 26-02-09_first 2 Reports.xlsx
--
-- This script assumes your objects were created with quoted uppercase identifiers, e.g.:
--   CREATE TABLE "PROJECT" ("ID" ..., "TENANT_ID" ..., ...);
-- Therefore every identifier is referenced with double quotes.
--
-- Output objects are created in schema "REPORTING" (uppercase, quoted) to match your convention.

create schema if not exists "REPORTING";

-- 0) Helper: expose all progress rows (so UI/reporting can do "as-of date" later)
create or replace view "REPORTING"."VW_PROJECT_PROGRESS_ALL" as
select
  pp."TENANT_ID",
  pp."ID" as "PROJECT_PROGRESS_ID",
  pp."STRUCTURE_ID",
  pp."created_at",
  pp."REVENUE",
  pp."EXTRAS",
  pp."REVENUE_COMPLETION_PERCENT",
  pp."REVENUE_COMPLETION",
  pp."EXTRAS_COMPLETION_PERCENT",
  pp."EXTRAS_COMPLETION"
from public."PROJECT_PROGRESS" pp;

-- 1) Helper: latest progress per structure (as-of now)
create or replace view "REPORTING"."VW_PROJECT_PROGRESS_LATEST" as
select x.*
from (
  select
    pp.*,
    row_number() over (
      partition by pp."TENANT_ID", pp."STRUCTURE_ID"
      order by pp."created_at" desc, pp."PROJECT_PROGRESS_ID" desc
    ) as "RN"
  from "REPORTING"."VW_PROJECT_PROGRESS_ALL" pp
) x
where x."RN" = 1;

-- 2) Helper: time entries aggregated to project
create or replace view "REPORTING"."VW_PROJECT_TIME_AGG" as
select
  ps."TENANT_ID",
  ps."PROJECT_ID",
  sum(coalesce(t."QUANTITY_INT",0)) as "HOURS_TOTAL",
  sum(coalesce(t."CP_TOT",0))       as "COST_TOTAL",
  sum(coalesce(t."QUANTITY_EXT",0)) as "QTY_EXT_TOTAL",
  sum(coalesce(t."SP_TOT",0))       as "SALES_TOTAL"
from public."TEC" t
join public."PROJECT_STRUCTURE" ps
  on ps."TENANT_ID" = t."TENANT_ID"
 and ps."ID"        = t."STRUCTURE_ID"
group by ps."TENANT_ID", ps."PROJECT_ID";

-- 3) Helper: project progress aggregated to project (latest snapshot per structure)
create or replace view "REPORTING"."VW_PROJECT_PROGRESS_AGG" as
select
  ps."TENANT_ID",
  ps."PROJECT_ID",

  sum(coalesce(ppl."REVENUE",0)) as "REVENUE_BUDGET",
  sum(coalesce(ppl."EXTRAS",0))  as "EXTRAS_BUDGET",

  -- percent aggregation: avg of latest structure percent (documented limitation)
  avg(nullif(ppl."REVENUE_COMPLETION_PERCENT",0)) as "REVENUE_COMPLETION_PERCENT_AVG",

  sum(coalesce(ppl."REVENUE_COMPLETION",0)) as "REVENUE_COMPLETION_VALUE",
  sum(coalesce(ppl."EXTRAS_COMPLETION",0))  as "EXTRAS_COMPLETION_VALUE"
from "REPORTING"."VW_PROJECT_PROGRESS_LATEST" ppl
join public."PROJECT_STRUCTURE" ps
  on ps."TENANT_ID" = ppl."TENANT_ID"
 and ps."ID"        = ppl."STRUCTURE_ID"
group by ps."TENANT_ID", ps."PROJECT_ID";

-- 4) Helper: invoicing/payment aggregated to project
create or replace view "REPORTING"."VW_PROJECT_BILLING_AGG" as
select
  p."TENANT_ID",
  p."ID" as "PROJECT_ID",

  sum(coalesce(pp."TOTAL_AMOUNT_NET",0)) as "PARTIAL_PAYMENT_NET_TOTAL",
  sum(coalesce(i."TOTAL_AMOUNT_NET",0))  as "INVOICE_NET_TOTAL",
  sum(coalesce(pay."AMOUNT_PAYED_NET",0)) as "PAYED_NET_TOTAL"
from public."PROJECT" p
left join public."PARTIAL_PAYMENT" pp
  on pp."TENANT_ID"  = p."TENANT_ID"
 and pp."PROJECT_ID" = p."ID"
left join public."INVOICE" i
  on i."TENANT_ID"   = p."TENANT_ID"
 and i."PROJECT_ID"  = p."ID"
left join public."PAYMENT" pay
  on pay."TENANT_ID"  = p."TENANT_ID"
 and pay."PROJECT_ID" = p."ID"
group by p."TENANT_ID", p."ID";

-- ============================================================================
-- REPORT 1: Project Detail (one row per project)
-- ============================================================================
create or replace view "REPORTING"."VW_REPORT_PROJECT_DETAIL" as
select
  p."TENANT_ID",
  p."ID" as "PROJECT_ID",

  -- dimensions (filters)
  p."NAME_LONG",
  p."NAME_SHORT",
  p."PROJECT_STATUS_ID",
  ps."NAME_SHORT" as "PROJECT_STATUS_NAME_SHORT",
  p."PROJECT_TYPE_ID",
  pt."NAME_SHORT" as "PROJECT_TYPE_NAME_SHORT",
  p."PROJECT_MANAGER_ID",
  (
    e."SHORT_NAME" ||
    case
      when e."FIRST_NAME" is not null
        then (': ' || e."FIRST_NAME" || ' ' || coalesce(e."LAST_NAME",''))
      else ''
    end
  ) as "PROJECT_MANAGER_DISPLAY",

  p."ADDRESS_ID",
  a."ADDRESS_NAME_1" as "ADDRESS_NAME",
  p."COMPANY_ID",
  c."COMPANY_NAME_1" as "COMPANY_NAME",
  p."DEPARTMENT_ID",
  d."NAME_SHORT" as "DEPARTMENT_NAME",
  p."CONTACT_ID",
  co."LAST_NAME" as "CONTACT_NAME",

  -- time dimension example
  p."created_at" as "PROJECT_created_at",

  -- measures (stable names)
  coalesce(pa."REVENUE_BUDGET",0) + coalesce(pa."EXTRAS_BUDGET",0) as "BUDGET_TOTAL_NET",
  coalesce(pa."REVENUE_COMPLETION_PERCENT_AVG", null) as "LEISTUNGSSTAND_PERCENT",
  coalesce(pa."REVENUE_COMPLETION_VALUE",0) + coalesce(pa."EXTRAS_COMPLETION_VALUE",0) as "LEISTUNGSSTAND_VALUE",

  coalesce(ta."HOURS_TOTAL",0) as "HOURS_TOTAL",
  coalesce(ta."COST_TOTAL",0)  as "COST_TOTAL",

  (coalesce(pa."REVENUE_COMPLETION_VALUE",0) + coalesce(pa."EXTRAS_COMPLETION_VALUE",0)) as "EARNED_VALUE_NET",

  case
    when (coalesce(pa."REVENUE_COMPLETION_VALUE",0) + coalesce(pa."EXTRAS_COMPLETION_VALUE",0)) = 0 then null
    else coalesce(ta."COST_TOTAL",0) / (coalesce(pa."REVENUE_COMPLETION_VALUE",0) + coalesce(pa."EXTRAS_COMPLETION_VALUE",0))
  end as "COST_RATIO",

  (coalesce(pa."REVENUE_BUDGET",0) + coalesce(pa."EXTRAS_BUDGET",0))
  - (coalesce(pa."REVENUE_COMPLETION_VALUE",0) + coalesce(pa."EXTRAS_COMPLETION_VALUE",0)) as "REMAINING_BUDGET_NET",

  coalesce(ba."PARTIAL_PAYMENT_NET_TOTAL",0) as "PARTIAL_PAYMENT_NET_TOTAL",
  coalesce(ba."INVOICE_NET_TOTAL",0)         as "INVOICE_NET_TOTAL",
  coalesce(ba."PAYED_NET_TOTAL",0)           as "PAYED_NET_TOTAL",
  (coalesce(ba."PARTIAL_PAYMENT_NET_TOTAL",0) + coalesce(ba."INVOICE_NET_TOTAL",0)) as "BILLED_NET_TOTAL",

  (coalesce(pa."REVENUE_COMPLETION_VALUE",0) + coalesce(pa."EXTRAS_COMPLETION_VALUE",0))
  - (coalesce(ba."PARTIAL_PAYMENT_NET_TOTAL",0) + coalesce(ba."INVOICE_NET_TOTAL",0)) as "OPEN_NET_TOTAL",

  coalesce(ta."SALES_TOTAL",0) as "SALES_TOTAL",
  coalesce(ta."QTY_EXT_TOTAL",0) as "QTY_EXT_TOTAL"

from public."PROJECT" p
left join "REPORTING"."VW_PROJECT_PROGRESS_AGG" pa
  on pa."TENANT_ID"  = p."TENANT_ID"
 and pa."PROJECT_ID" = p."ID"
left join "REPORTING"."VW_PROJECT_TIME_AGG" ta
  on ta."TENANT_ID"  = p."TENANT_ID"
 and ta."PROJECT_ID" = p."ID"
left join "REPORTING"."VW_PROJECT_BILLING_AGG" ba
  on ba."TENANT_ID"  = p."TENANT_ID"
 and ba."PROJECT_ID" = p."ID"
left join public."EMPLOYEE" e
  on e."TENANT_ID" = p."TENANT_ID"
 and e."ID"        = p."PROJECT_MANAGER_ID"
left join public."PROJECT_STATUS" ps
  on ps."ID" = p."PROJECT_STATUS_ID"
left join public."PROJECT_TYPE" pt
  on pt."ID" = p."PROJECT_TYPE_ID"
left join public."ADDRESS" a
  on a."TENANT_ID" = p."TENANT_ID"
 and a."ID"        = p."ADDRESS_ID"
left join public."COMPANY" c
  on c."TENANT_ID" = p."TENANT_ID"
 and c."ID"        = p."COMPANY_ID"
left join public."DEPARTMENT" d
  on d."TENANT_ID" = p."TENANT_ID"
 and d."ID"        = p."DEPARTMENT_ID"
left join public."CONTACTS" co
  on co."TENANT_ID" = p."TENANT_ID"
 and co."ID"        = p."CONTACT_ID";

-- ============================================================================
-- REPORT 2: Project List (one row per project root)
-- Current definition: root == PROJECT.ID
-- ============================================================================
create or replace view "REPORTING"."VW_REPORT_PROJECT_LIST_ROOT" as
select
  pd."TENANT_ID",
  pd."PROJECT_ID",

  pd."NAME_SHORT",
  pd."NAME_LONG",

  pd."PROJECT_STATUS_ID",
  pd."PROJECT_STATUS_NAME_SHORT",
  pd."PROJECT_TYPE_ID",
  pd."PROJECT_TYPE_NAME_SHORT",
  pd."PROJECT_MANAGER_ID",
  pd."PROJECT_MANAGER_DISPLAY",
  pd."ADDRESS_ID",
  pd."ADDRESS_NAME",
  pd."COMPANY_ID",
  pd."COMPANY_NAME",
  pd."DEPARTMENT_ID",
  pd."DEPARTMENT_NAME",
  pd."CONTACT_ID",
  pd."CONTACT_NAME",

  pd."BUDGET_TOTAL_NET",
  pd."LEISTUNGSSTAND_PERCENT",
  pd."LEISTUNGSSTAND_VALUE",
  pd."HOURS_TOTAL",
  pd."COST_TOTAL",
  pd."EARNED_VALUE_NET",
  pd."COST_RATIO",
  pd."REMAINING_BUDGET_NET",
  pd."PARTIAL_PAYMENT_NET_TOTAL",
  pd."INVOICE_NET_TOTAL",
  pd."PAYED_NET_TOTAL",
  pd."BILLED_NET_TOTAL",
  pd."OPEN_NET_TOTAL"

from "REPORTING"."VW_REPORT_PROJECT_DETAIL" pd;
