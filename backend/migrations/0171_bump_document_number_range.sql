-- ============================================================================
-- Migration 0171: Nummernkreis-Zaehler anheben (bump_document_number_range)
--
-- WARUM
--   Ein Beleg mit eigener Nummer aus dem Altsystem laeuft an der Nummernvergabe
--   vorbei: services/invoices.js ruft next_document_number() nur, WENN das Feld
--   leer ist. Der Zaehler in document_number_range bewegt sich dabei nicht.
--
--   Das ist so lange harmlos, wie die uebernommenen Nummern aus vergangenen
--   Jahren stammen — der Zaehler laeuft je Jahr. Sobald aber ein Beleg aus dem
--   LAUFENDEN Jahr dabei ist, vergibt p&simple beim naechsten Mal eine Nummer,
--   die es schon gibt. Und die Datenbank faengt das nicht ab: es existiert
--   nirgends ein Unique-Index auf INVOICE_NUMBER oder ADVANCE_INVOICE_NUMBER.
--   Eine doppelte Rechnungsnummer faellt dann beim Steuerberater auf.
--
-- WARUM EINE FUNKTION UND KEIN UPDATE AUS DEM CODE
--   Der Wert soll nur STEIGEN, nie fallen — zwischen Lesen und Schreiben darf
--   niemand dazwischenkommen. PostgREST kann kein atomares GREATEST-Update, und
--   ein Lesen-Rechnen-Schreiben aus dem Dienst heraus waere genau das Rennen,
--   das next_document_number() mit seinem Einzel-Statement-UPSERT vermeidet.
--
-- ACHTUNG BEI DEN BEZEICHNERN
--   document_number_range wurde in Migration 0005 OHNE Anfuehrungszeichen
--   angelegt und liegt in Postgres deshalb klein. Anders als fast alle anderen
--   Tabellen dieses Projekts. Quoted man sie hier, findet die Funktion nichts.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.bump_document_number_range(
  p_company_id bigint,
  p_year       int,
  p_min_next   int
)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_next int;
BEGIN
  IF p_company_id IS NULL OR p_year IS NULL OR p_min_next IS NULL THEN
    RETURN NULL;
  END IF;

  -- Deckel gegen eine unsinnig hohe Fremdnummer. Der Aufrufer prueft das
  -- bereits, aber der Zaehler laesst sich nicht wieder senken — also hier
  -- noch einmal, wo es niemand vergessen kann.
  IF p_min_next < 1 OR p_min_next > 1000000 THEN
    RAISE EXCEPTION 'bump_document_number_range: % liegt ausserhalb des zulaessigen Bereichs', p_min_next;
  END IF;

  -- Ein Statement, damit zwischen Lesen und Schreiben niemand dazwischenkommt.
  -- GREATEST sorgt dafuer, dass ein spaeterer Lauf mit kleineren Nummern den
  -- Zaehler nicht zurueckdreht.
  INSERT INTO document_number_range (company_id, doc_type, year, next_counter, updated_at)
  VALUES (p_company_id, 'GLOBAL', p_year, p_min_next, now())
  ON CONFLICT (company_id, doc_type, year) DO UPDATE
    SET next_counter = GREATEST(document_number_range.next_counter, EXCLUDED.next_counter),
        updated_at   = now()
  RETURNING next_counter INTO v_next;

  RETURN v_next;
END;
$$;

COMMENT ON FUNCTION public.bump_document_number_range(bigint, int, int) IS
  'Hebt den Rechnungsnummern-Zaehler einer Firma/eines Jahres auf mindestens p_min_next an. Senkt nie.';
