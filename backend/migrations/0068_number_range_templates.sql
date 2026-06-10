-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 0068: Konfigurierbare Nummernkreis-Templates
-- ─────────────────────────────────────────────────────────────────────────────
-- Bisher waren die Formate der Nummernkreise (Projekte/Angebote/Rechnungen)
-- hartkodiert in den RPCs. Diese Migration fuehrt eine Template-Tabelle ein,
-- aus der die RPCs jetzt das Format lesen. Wenn kein Template gepflegt ist,
-- bleibt das alte Default-Format aktiv -- damit funktioniert alles weiter
-- ohne Konfiguration.
--
-- Reset-Verhalten: Counter resetet pro Jahr (wie bisher, vom User bestaetigt).
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "NUMBER_RANGE_TEMPLATE" (
  "ID"          SERIAL       PRIMARY KEY,
  "TENANT_ID"   INTEGER      NOT NULL,
  "COMPANY_ID"  BIGINT       NOT NULL,
  "DOC_TYPE"    VARCHAR(20)  NOT NULL,                -- 'PROJECT' | 'OFFER' | 'INVOICE'
  "TEMPLATE"    TEXT         NOT NULL,                -- "P-{YEAR2}-{COUNTER:000}"
  "UPDATED_AT"  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  "UPDATED_BY"  INTEGER,
  UNIQUE ("COMPANY_ID", "DOC_TYPE")
);

CREATE INDEX IF NOT EXISTS ix_nrt_tenant ON "NUMBER_RANGE_TEMPLATE" ("TENANT_ID");

-- ── Render-Helper: ersetzt Tokens im Template ──────────────────────────────
-- Unterstuetzt:
--   {COUNTER}          ungeppadt
--   {COUNTER:0000}     genullt auf angegebene Stellen
--   {YEAR4}            4-stelliges Jahr (2026)
--   {YEAR2}            2-stelliges Jahr (26)
--   {MONTH:00}         Monat (06)
--   {DAY:00}           Tag (10)
--   {COMPANY:CODE}     COMPANY.COMPANY_NAME_SHORT (max 10 Zeichen, kein Default)

CREATE OR REPLACE FUNCTION public.render_number_template(
  p_template   TEXT,
  p_counter    INT,
  p_company_id BIGINT
)
RETURNS TEXT
LANGUAGE plpgsql
AS $$
DECLARE
  v_result  TEXT := p_template;
  v_now     TIMESTAMPTZ := now();
  v_year4   TEXT := EXTRACT(YEAR FROM v_now)::TEXT;
  v_year2   TEXT := LPAD((EXTRACT(YEAR  FROM v_now)::INT % 100)::TEXT, 2, '0');
  v_month   TEXT := LPAD(EXTRACT(MONTH FROM v_now)::TEXT, 2, '0');
  v_day     TEXT := LPAD(EXTRACT(DAY   FROM v_now)::TEXT, 2, '0');
  v_company TEXT;
  v_match   RECORD;
  v_pad     INT;
BEGIN
  -- Company-Code (Short-Name) holen, falls referenziert
  IF position('{COMPANY' IN v_result) > 0 THEN
    SELECT COALESCE(NULLIF(TRIM("COMPANY_NAME_SHORT"), ''), 'CO')
      INTO v_company
      FROM public."COMPANY"
     WHERE "ID" = p_company_id;
    IF v_company IS NULL THEN v_company := 'CO'; END IF;
    v_result := REPLACE(v_result, '{COMPANY:CODE}', v_company);
    v_result := REPLACE(v_result, '{COMPANY}',      v_company);
  END IF;

  -- Datum-Tokens
  v_result := REPLACE(v_result, '{YEAR4}',  v_year4);
  v_result := REPLACE(v_result, '{YEAR2}',  v_year2);
  v_result := REPLACE(v_result, '{MONTH:00}', v_month);
  v_result := REPLACE(v_result, '{DAY:00}',   v_day);

  -- COUNTER mit optionalem Pad-Format: {COUNTER:0000}
  -- Wir suchen das laengste Pad und ersetzen es; danach {COUNTER} ungeppadt.
  FOR v_match IN
    SELECT (regexp_matches(v_result, '\{COUNTER:(0+)\}', 'g'))[1] AS pad
  LOOP
    v_pad := LENGTH(v_match.pad);
    v_result := REGEXP_REPLACE(
      v_result,
      '\{COUNTER:' || v_match.pad || '\}',
      LPAD(p_counter::TEXT, v_pad, '0'),
      'g'
    );
  END LOOP;
  v_result := REPLACE(v_result, '{COUNTER}', p_counter::TEXT);

  RETURN v_result;
END;
$$;

-- ── RPC-Helper: liest Template fuer (Company, DocType) ─────────────────────
-- Liefert NULL, wenn kein Template gepflegt ist (-> Fallback im RPC).

CREATE OR REPLACE FUNCTION public.get_number_template(
  p_company_id BIGINT,
  p_doc_type   TEXT
)
RETURNS TEXT
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_template TEXT;
BEGIN
  SELECT "TEMPLATE"
    INTO v_template
    FROM public."NUMBER_RANGE_TEMPLATE"
   WHERE "COMPANY_ID" = p_company_id
     AND "DOC_TYPE"   = p_doc_type;
  RETURN v_template; -- NULL wenn nichts da
END;
$$;

-- ── Updated next_project_number: Template-aware ────────────────────────────

CREATE OR REPLACE FUNCTION public.next_project_number(p_company_id bigint)
RETURNS text
LANGUAGE plpgsql
AS $$
DECLARE
  yr        INT := EXTRACT(year FROM now())::INT;
  yy        TEXT := LPAD((yr % 100)::TEXT, 2, '0');
  cur       INT;
  v_tmpl    TEXT;
BEGIN
  IF p_company_id IS NULL THEN
    RAISE EXCEPTION 'p_company_id is required';
  END IF;

  -- Counter atomar inkrementieren (wie bisher)
  WITH up AS (
    INSERT INTO public."DOCUMENT_NUMBER_RANGE" ("COMPANY_ID", "DOC_TYPE", "YEAR", "NEXT_COUNTER", "UPDATED_AT")
    VALUES (p_company_id, 'PROJECT', yr, 2, now())
    ON CONFLICT ("COMPANY_ID","DOC_TYPE","YEAR") DO UPDATE
      SET "NEXT_COUNTER" = public."DOCUMENT_NUMBER_RANGE"."NEXT_COUNTER" + 1,
          "UPDATED_AT"   = now()
    RETURNING "NEXT_COUNTER"
  )
  SELECT "NEXT_COUNTER" INTO cur FROM up;
  cur := cur - 1; -- "NEXT_COUNTER" zeigt aufs naechste, wir wollen das aktuelle

  v_tmpl := public.get_number_template(p_company_id, 'PROJECT');
  IF v_tmpl IS NOT NULL THEN
    RETURN public.render_number_template(v_tmpl, cur, p_company_id);
  END IF;

  -- Fallback: hartkodierter alter Standard
  RETURN 'P-' || yy || '-' || LPAD(cur::TEXT, 3, '0');
END;
$$;

-- ── Updated next_offer_number: Template-aware ──────────────────────────────

CREATE OR REPLACE FUNCTION public.next_offer_number(p_company_id bigint)
RETURNS text
LANGUAGE plpgsql
AS $$
DECLARE
  yr     INT := EXTRACT(year FROM now())::INT;
  yy     TEXT := LPAD((yr % 100)::TEXT, 2, '0');
  cur    INT;
  v_tmpl TEXT;
BEGIN
  IF p_company_id IS NULL THEN
    RAISE EXCEPTION 'p_company_id is required';
  END IF;

  WITH up AS (
    INSERT INTO public."DOCUMENT_NUMBER_RANGE" ("COMPANY_ID", "DOC_TYPE", "YEAR", "NEXT_COUNTER", "UPDATED_AT")
    VALUES (p_company_id, 'OFFER', yr, 2, now())
    ON CONFLICT ("COMPANY_ID","DOC_TYPE","YEAR") DO UPDATE
      SET "NEXT_COUNTER" = public."DOCUMENT_NUMBER_RANGE"."NEXT_COUNTER" + 1,
          "UPDATED_AT"   = now()
    RETURNING "NEXT_COUNTER"
  )
  SELECT "NEXT_COUNTER" INTO cur FROM up;
  cur := cur - 1;

  v_tmpl := public.get_number_template(p_company_id, 'OFFER');
  IF v_tmpl IS NOT NULL THEN
    RETURN public.render_number_template(v_tmpl, cur, p_company_id);
  END IF;

  RETURN 'A-' || yy || '-' || LPAD(cur::TEXT, 3, '0');
END;
$$;

-- ── Updated next_document_number (Rechnungen): Template-aware ──────────────

CREATE OR REPLACE FUNCTION public.next_document_number(p_company_id bigint, p_doc_type text)
RETURNS text
LANGUAGE plpgsql
AS $$
DECLARE
  yr           INT := EXTRACT(year FROM now())::INT;
  v_assigned   INT;
  v_seed_next  INT;
  v_next       INT;
  v_tmpl       TEXT;
BEGIN
  IF p_company_id IS NULL THEN
    RAISE EXCEPTION 'p_company_id is required';
  END IF;

  -- Wie bisher: GLOBAL-Counter, seed aus etwaigen legacy Eintraegen
  SELECT COALESCE(MAX("NEXT_COUNTER"), 1) INTO v_seed_next
    FROM public."DOCUMENT_NUMBER_RANGE"
   WHERE "COMPANY_ID" = p_company_id AND "YEAR" = yr;

  WITH up AS (
    INSERT INTO public."DOCUMENT_NUMBER_RANGE" ("COMPANY_ID","DOC_TYPE","YEAR","NEXT_COUNTER","UPDATED_AT")
    VALUES (p_company_id, 'GLOBAL', yr, v_seed_next + 1, now())
    ON CONFLICT ("COMPANY_ID","DOC_TYPE","YEAR") DO UPDATE
      SET "NEXT_COUNTER" = public."DOCUMENT_NUMBER_RANGE"."NEXT_COUNTER" + 1,
          "UPDATED_AT"   = now()
    RETURNING "NEXT_COUNTER"
  )
  SELECT "NEXT_COUNTER" INTO v_next FROM up;
  v_assigned := v_next - 1;

  v_tmpl := public.get_number_template(p_company_id, 'INVOICE');
  IF v_tmpl IS NOT NULL THEN
    RETURN public.render_number_template(v_tmpl, v_assigned, p_company_id);
  END IF;

  RETURN 'RE-' || yr::TEXT || '-' || LPAD(v_assigned::TEXT, 4, '0');
END;
$$;
