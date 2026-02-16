-- Stage E: Projektnummern (automatisch, via Nummernkreis)
-- Execute in Supabase SQL editor.
-- Reuse DOCUMENT_NUMBER_RANGE table (Stage D).
-- DOC_TYPE: PROJECT

-- Format:
-- P-YY-CCC
--   P  = fixed text
--   YY = current year (2 digits)
--   CCC= unique counter (3 digits)
--
-- Counter is per COMPANY_ID and YEAR.

create or replace function next_project_number(p_company_id bigint)
returns text
language plpgsql
as $$
declare
  yr int := extract(year from now())::int;
  yy text := lpad((yr % 100)::text, 2, '0');
  cur int;
begin
  if p_company_id is null then
    raise exception 'p_company_id is required';
  end if;

  select NEXT_COUNTER
    into cur
  from DOCUMENT_NUMBER_RANGE
  where COMPANY_ID = p_company_id
    and DOC_TYPE = 'PROJECT'
    and YEAR = yr
  for update;

  if not found then
    cur := 1;
    insert into DOCUMENT_NUMBER_RANGE (COMPANY_ID, DOC_TYPE, YEAR, NEXT_COUNTER, UPDATED_AT)
    values (p_company_id, 'PROJECT', yr, cur + 1, now());
  else
    update DOCUMENT_NUMBER_RANGE
    set NEXT_COUNTER = cur + 1,
        UPDATED_AT = now()
    where COMPANY_ID = p_company_id
      and DOC_TYPE = 'PROJECT'
      and YEAR = yr;
  end if;

  return 'P-' || yy || '-' || lpad(cur::text, 3, '0');
end;
$$;
