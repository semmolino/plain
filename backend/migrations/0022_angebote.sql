-- Angebote module: OFFER_STATUS, OFFER, OFFER_STRUCTURE tables + number range RPC
-- Execute in Supabase SQL editor.

-- ── OFFER_STATUS ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public."OFFER_STATUS" (
  "ID"         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  "NAME_SHORT" text NOT NULL,
  "TENANT_ID"  bigint
);

-- ── OFFER ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public."OFFER" (
  "ID"              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  "NAME_SHORT"      text,
  "NAME_LONG"       text NOT NULL,
  "EMPLOYEE_ID"     bigint,
  "PROBABILITY"     numeric,
  "OFFER_TEXT_1"    text,
  "OFFER_TEXT_2"    text,
  "ADDRESS_ID"      bigint,
  "CONTACT_ID"      bigint,
  "OFFER_STATUS_ID" bigint,
  "COMPANY_ID"      bigint,
  "TENANT_ID"       bigint,
  "CREATED_AT"      timestamptz DEFAULT now()
);

-- ── OFFER_STRUCTURE ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public."OFFER_STRUCTURE" (
  "ID"              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  "NAME_SHORT"      text,
  "NAME_LONG"       text,
  "OFFER_ID"        bigint NOT NULL,
  "REVENUE"         numeric DEFAULT 0,
  "EXTRAS_PERCENT"  numeric DEFAULT 0,
  "EXTRAS"          numeric DEFAULT 0,
  "BILLING_TYPE_ID" bigint,
  "FATHER_ID"       bigint,
  "TENANT_ID"       bigint,
  "SORT_ORDER"      integer DEFAULT 0,
  "QUANTITY"        numeric,
  "SP_RATE"         numeric,
  "ROLE_NAME_SHORT" text,
  "ROLE_NAME_LONG"  text,
  "ROLE_ID"         bigint
);

-- ── Number range RPC: A-YY-NNN ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION next_offer_number(p_company_id bigint)
RETURNS text
LANGUAGE plpgsql
AS $$
DECLARE
  yr  int  := EXTRACT(year FROM now())::int;
  yy  text := lpad((yr % 100)::text, 2, '0');
  cur int;
BEGIN
  IF p_company_id IS NULL THEN
    RAISE EXCEPTION 'p_company_id is required';
  END IF;

  SELECT "NEXT_COUNTER" INTO cur
  FROM public."DOCUMENT_NUMBER_RANGE"
  WHERE "COMPANY_ID" = p_company_id
    AND "DOC_TYPE"   = 'OFFER'
    AND "YEAR"       = yr
  FOR UPDATE;

  IF NOT FOUND THEN
    cur := 1;
    INSERT INTO public."DOCUMENT_NUMBER_RANGE"
      ("COMPANY_ID", "DOC_TYPE", "YEAR", "NEXT_COUNTER", "UPDATED_AT")
    VALUES (p_company_id, 'OFFER', yr, cur + 1, now());
  ELSE
    UPDATE public."DOCUMENT_NUMBER_RANGE"
    SET "NEXT_COUNTER" = cur + 1,
        "UPDATED_AT"   = now()
    WHERE "COMPANY_ID" = p_company_id
      AND "DOC_TYPE"   = 'OFFER'
      AND "YEAR"       = yr;
  END IF;

  RETURN 'A-' || yy || '-' || lpad(cur::text, 3, '0');
END;
$$;
