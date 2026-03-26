-- Fix VW_PROJECT_BILLING_AGG: cartesian product bug
--
-- The original view joined PARTIAL_PAYMENT, INVOICE, and PAYMENT all directly
-- to PROJECT in a single query. With N partial payments × M invoices × K payments
-- per project the SUM() for each table was multiplied by the row count of the
-- other two tables, producing inflated totals (especially visible in PAYED_NET_TOTAL).
--
-- Fix: pre-aggregate each source table independently into a scalar per project,
-- then join those scalars — no cross-multiplication possible.

create or replace view "REPORTING"."VW_PROJECT_BILLING_AGG" as
select
  p."TENANT_ID",
  p."ID" as "PROJECT_ID",

  coalesce(pp_agg."PARTIAL_PAYMENT_NET_TOTAL", 0) as "PARTIAL_PAYMENT_NET_TOTAL",
  coalesce(i_agg."INVOICE_NET_TOTAL",          0) as "INVOICE_NET_TOTAL",
  coalesce(pay_agg."PAYED_NET_TOTAL",           0) as "PAYED_NET_TOTAL"

from public."PROJECT" p

left join (
  select
    "TENANT_ID",
    "PROJECT_ID",
    sum(coalesce("TOTAL_AMOUNT_NET", 0)) as "PARTIAL_PAYMENT_NET_TOTAL"
  from public."PARTIAL_PAYMENT"
  group by "TENANT_ID", "PROJECT_ID"
) pp_agg
  on pp_agg."TENANT_ID"  = p."TENANT_ID"
 and pp_agg."PROJECT_ID" = p."ID"

left join (
  select
    "TENANT_ID",
    "PROJECT_ID",
    sum(coalesce("TOTAL_AMOUNT_NET", 0)) as "INVOICE_NET_TOTAL"
  from public."INVOICE"
  group by "TENANT_ID", "PROJECT_ID"
) i_agg
  on i_agg."TENANT_ID"  = p."TENANT_ID"
 and i_agg."PROJECT_ID" = p."ID"

left join (
  select
    "TENANT_ID",
    "PROJECT_ID",
    sum(coalesce("AMOUNT_PAYED_NET", 0)) as "PAYED_NET_TOTAL"
  from public."PAYMENT"
  group by "TENANT_ID", "PROJECT_ID"
) pay_agg
  on pay_agg."TENANT_ID"  = p."TENANT_ID"
 and pay_agg."PROJECT_ID" = p."ID";
