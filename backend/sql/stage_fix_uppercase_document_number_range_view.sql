-- Compatibility view for uppercase identifiers
-- This allows PostgREST to resolve public.DOCUMENT_NUMBER_RANGE

create or replace view public."DOCUMENT_NUMBER_RANGE" as
select * from public.document_number_range;

-- Reload PostgREST schema cache
select pg_notify('pgrst', 'reload schema');

