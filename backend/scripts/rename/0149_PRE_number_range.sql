-- 0149_PRE_number_range.sql — VOR dem Deploy von Block 05 einspielen.
--
-- Keine Migration: bewusst ausserhalb von backend/migrations/, damit der
-- postdeploy-Hook sie nicht aufgreift. Sie muss laufen, BEVOR der neue Code
-- live geht - genau das ist ihr Zweck.
--
-- WARUM
--   Ausgerollt wird "erst pushen, dann migriert der Hook". Fuer fast alles ist
--   das die kuerzere Luecke. Beim Nummernkreis nicht: in den Sekunden zwischen
--   neuem Code und Migration 0149 fragt partialPayments.js nach
--   p_doc_type = 'ADVANCE_INVOICE'. Findet next_document_number() den Wert
--   nicht, legt es einen Zaehler bei 1 an - und die naechste Abschlagsrechnung
--   traegt eine Nummer, die es schon gibt. Das GREATEST in 0149 verhindert
--   weitere Kollisionen, holt eine vergebene Doppelnummer aber nicht zurueck.
--   Eine doppelte Rechnungsnummer ist beim Pruefportal ein Ablehnungsgrund und
--   verletzt die Einmaligkeit nach § 14 UStG.
--
-- WAS SIE TUT
--   Legt den Zaehler unter dem NEUEN Namen zusaetzlich an, waehrend der alte
--   stehen bleibt. Damit findet der alte Code weiter seine Zeile und der neue
--   sofort seine - beide mit demselben Stand. Kein Fenster mehr.
--   Die alte Zeile raeumt danach 0149 weg, samt GREATEST fuer den Fall, dass
--   zwischen diesem Lauf und dem Deploy noch eine Nummer gezogen wurde.
--
-- Wiederholbar: ON CONFLICT haelt den hoeheren Zaehler.
SET request.jwt.claims = '{"sys":"true"}';

INSERT INTO document_number_range (company_id, doc_type, year, next_counter, "TENANT_ID")
  SELECT company_id, 'ADVANCE_INVOICE', year, next_counter, "TENANT_ID"
    FROM document_number_range
   WHERE doc_type = 'PARTIAL_PAYMENT'
ON CONFLICT (company_id, doc_type, year) DO UPDATE
  SET next_counter = GREATEST(document_number_range.next_counter, EXCLUDED.next_counter),
      updated_at   = now();

RESET request.jwt.claims;
