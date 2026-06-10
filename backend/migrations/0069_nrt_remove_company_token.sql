-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 0069: {COMPANY:CODE}-Token aus render_number_template entfernen
-- ─────────────────────────────────────────────────────────────────────────────
-- COMPANY_NAME_SHORT existiert in der COMPANY-Tabelle nicht; der Token aus
-- Migration 0068 war daher nicht funktional. Mit dieser Migration:
--   1. Frontend zeigt keinen Chip mehr (separat im UI-Commit)
--   2. Validierung lehnt {COMPANY[:CODE]} jetzt ab
--   3. PL/pgSQL-Render-Funktion enthaelt keinen COMPANY-Block mehr
-- ─────────────────────────────────────────────────────────────────────────────

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
  v_match   RECORD;
  v_pad     INT;
BEGIN
  -- Datum-Tokens
  v_result := REPLACE(v_result, '{YEAR4}',    v_year4);
  v_result := REPLACE(v_result, '{YEAR2}',    v_year2);
  v_result := REPLACE(v_result, '{MONTH:00}', v_month);
  v_result := REPLACE(v_result, '{DAY:00}',   v_day);

  -- COUNTER mit optionalem Pad-Format: {COUNTER:0000}
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

  -- p_company_id bleibt im Signatur-Set fuer kuenftige Tokens (z.B. {DEPT:CODE})
  -- aber wird in dieser Version nicht genutzt.

  RETURN v_result;
END;
$$;
