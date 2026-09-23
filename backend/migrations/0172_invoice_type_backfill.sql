-- ============================================================================
-- Migration 0172: importierte Rechnungen bekommen ihre Belegart
--
-- WARUM
--   Der Belegimport hat initInvoice() bisher mit invoiceType: null gerufen.
--   Jede so entstandene Rechnung traegt INVOICE_TYPE = NULL und ist damit
--   weder "rechnung" noch "schlussrechnung" — sie faellt aus jeder Auswertung
--   heraus, die nach Belegart filtert, und die E-Rechnung wuerde ihr den
--   falschen Typcode (UNTDID 1001) geben.
--
--   Ab sofort setzt der Import die Belegart aus der Datei. Diese Migration
--   zieht den Altbestand nach: alles, was der Import erzeugt hat und keine
--   Belegart traegt, ist eine gewoehnliche Rechnung — mehr konnte der alte
--   Weg gar nicht erzeugen (Abschlaege liegen in ADVANCE_INVOICE).
--
-- WARUM NUR IMPORTIERTE
--   IMPORT_BATCH_ID IS NOT NULL grenzt sauber ab. Eine in der Anwendung
--   angelegte Rechnung ohne Belegart gibt es nicht: der Controller setzt sie
--   beim Anlegen (Whitelist, alles Unbekannte wird 'rechnung'). Faende sich
--   doch eine, waere das ein eigener Befund — und den wuerde diese Migration
--   verdecken, wenn sie pauschal alle NULL-Zeilen fuellte.
--
-- MANDANTEN-CLAIM
--   Diese Migration SCHREIBT auf eine mandantenbezogene Tabelle. Ein psql-Lauf
--   traegt kein JWT, RLS blockiert fail-closed, und die Migration meldete
--   trotzdem Erfolg — genau so ist 0136 ins Leere gelaufen. Deshalb der
--   sys-Claim.
-- ============================================================================

SET request.jwt.claims = '{"sys":"true"}';

UPDATE "INVOICE"
   SET "INVOICE_TYPE" = 'rechnung'
 WHERE "INVOICE_TYPE" IS NULL
   AND "IMPORT_BATCH_ID" IS NOT NULL;

RESET request.jwt.claims;
