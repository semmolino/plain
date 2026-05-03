-- 0019_fix_number_range.sql
--
-- Problem: before the GLOBAL counter was introduced, INVOICE and PARTIAL_PAYMENT
-- each had their own independent row in DOCUMENT_NUMBER_RANGE, so both could
-- independently issue RE-YYYY-0001, RE-YYYY-0002, etc.
--
-- Fix:
--   1. Seed the GLOBAL row so its NEXT_COUNTER is >= max of all legacy per-type counters,
--      preventing any future number from colliding with a number already issued.
--   2. Replace next_document_number() to no longer re-seed from legacy rows on each
--      call (old function read max across ALL rows every time, which was harmless
--      after GLOBAL existed but wasteful and confusing).
--
-- Historical duplicates that already exist in INVOICE / PARTIAL_PAYMENT cannot be
-- retroactively renumbered by this migration.

-- Step 1: ensure GLOBAL row is at or above max of legacy per-type counters.
INSERT INTO public."DOCUMENT_NUMBER_RANGE" ("COMPANY_ID", "DOC_TYPE", "YEAR", "NEXT_COUNTER", "UPDATED_AT")
SELECT
  "COMPANY_ID",
  'GLOBAL'       AS "DOC_TYPE",
  "YEAR",
  MAX("NEXT_COUNTER") AS "NEXT_COUNTER",
  now()          AS "UPDATED_AT"
FROM public."DOCUMENT_NUMBER_RANGE"
WHERE "DOC_TYPE" IN ('INVOICE', 'PARTIAL_PAYMENT')
GROUP BY "COMPANY_ID", "YEAR"
ON CONFLICT ("COMPANY_ID", "DOC_TYPE", "YEAR") DO UPDATE
  SET "NEXT_COUNTER" = GREATEST(
        public."DOCUMENT_NUMBER_RANGE"."NEXT_COUNTER",
        EXCLUDED."NEXT_COUNTER"
      ),
      "UPDATED_AT" = now();

-- Step 2: replace function — remove the legacy re-seed logic.
CREATE OR REPLACE FUNCTION public.next_document_number(p_company_id bigint, p_doc_type text)
RETURNS text
LANGUAGE plpgsql
AS $$
DECLARE
  v_year     int  := extract(year from now())::int;
  v_next     int;
  v_assigned int;
  v_number   text;
BEGIN
  IF p_company_id IS NULL THEN
    RAISE EXCEPTION 'p_company_id is required';
  END IF;

  -- p_doc_type accepted for backwards-compatibility but ignored: all invoice
  -- document types share one GLOBAL counter so numbers never repeat.
  INSERT INTO public."DOCUMENT_NUMBER_RANGE" ("COMPANY_ID", "DOC_TYPE", "YEAR", "NEXT_COUNTER", "UPDATED_AT")
  VALUES (p_company_id, 'GLOBAL', v_year, 2, now())
  ON CONFLICT ("COMPANY_ID", "DOC_TYPE", "YEAR") DO UPDATE
    SET "NEXT_COUNTER" = public."DOCUMENT_NUMBER_RANGE"."NEXT_COUNTER" + 1,
        "UPDATED_AT"   = now()
  RETURNING "NEXT_COUNTER" INTO v_next;

  v_assigned := v_next - 1;
  v_number   := 'RE-' || v_year::text || '-' || lpad(v_assigned::text, 4, '0');

  RETURN v_number;
END;
$$;
