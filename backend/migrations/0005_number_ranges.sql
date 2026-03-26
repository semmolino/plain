-- Stage D: Nummernkreise (automatische Dokumentnummern)
-- Execute in Supabase SQL editor.

create table if not exists public.DOCUMENT_NUMBER_RANGE (
  ID bigserial primary key,
  COMPANY_ID bigint not null,
  DOC_TYPE text not null, -- GLOBAL (shared), legacy: INVOICE, PARTIAL_PAYMENT
  YEAR int not null,
  NEXT_COUNTER int not null default 1,
  UPDATED_AT timestamptz not null default now()
);

create unique index if not exists uq_doc_number_range on public.DOCUMENT_NUMBER_RANGE (COMPANY_ID, DOC_TYPE, YEAR);
create index if not exists idx_doc_number_range_company on public.DOCUMENT_NUMBER_RANGE (COMPANY_ID);

-- Atomic allocator: increments NEXT_COUNTER and returns the assigned document number.
-- Current logic: RE-YYYY-CCCC (CCCC = 4-digit counter).
-- NOTE: The counter is shared across document types (GLOBAL range).
create or replace function public.next_document_number(p_company_id bigint, p_doc_type text)
returns text
language plpgsql
as $$
declare
  v_year int := extract(year from now())::int;
  v_next int;
  v_assigned int;
  v_doc_type text := upper(trim(coalesce(p_doc_type, '')));
  v_seed_next int;
  v_number text;
begin
  if p_company_id is null then
    raise exception 'p_company_id is required';
  end if;

  -- v_doc_type is kept for backwards compatibility (callers may pass INVOICE/PARTIAL_PAYMENT).
  -- The counter itself is GLOBAL/shared.

  -- Seed the GLOBAL range from any existing legacy per-type ranges.
  -- NEXT_COUNTER represents the next number to be assigned.
  select coalesce(max(NEXT_COUNTER), 1)
    into v_seed_next
    from public.DOCUMENT_NUMBER_RANGE
   where COMPANY_ID = p_company_id
     and YEAR = v_year;

  -- UPSERT in a single statement to avoid race conditions.
  -- Insert branch: set NEXT_COUNTER to (seed + 1) so the assigned number is (seed).
  with up as (
    insert into public.DOCUMENT_NUMBER_RANGE (COMPANY_ID, DOC_TYPE, YEAR, NEXT_COUNTER, UPDATED_AT)
    values (p_company_id, 'GLOBAL', v_year, v_seed_next + 1, now())
    on conflict (COMPANY_ID, DOC_TYPE, YEAR) do update
      set NEXT_COUNTER = public.DOCUMENT_NUMBER_RANGE.NEXT_COUNTER + 1,
          UPDATED_AT = now()
    returning NEXT_COUNTER
  )
  select NEXT_COUNTER into v_next from up;

  v_assigned := v_next - 1;
  v_number := 'RE-' || v_year::text || '-' || lpad(v_assigned::text, 4, '0');

  return v_number;
end;
$$;
