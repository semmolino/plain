-- 0149_05_advance_invoice_values.sql
--
-- Block 05 benennt die Tabelle PARTIAL_PAYMENT in ADVANCE_INVOICE um. Derselbe
-- String steht aber auch als WERT in der Datenbank - als Dokumenttyp. Der
-- Codemod hat ihn im Code mitgezogen; hier zieht die Datenseite nach.
--
-- WARUM DAS EINE EIGENE DATEI IST
--   0147 ist reines DDL und vom Werkzeug erzeugt. Das hier sind Daten, von Hand
--   geschrieben und fachlich begruendet - das gehoert nicht in eine generierte
--   Datei, die beim naechsten Lauf ueberschrieben wird.
--
-- RLS: alle drei Tabellen tragen TENANT_ID. Ohne Mandanten-Claim sieht ein
-- psql-Lauf null Zeilen und meldet trotzdem Erfolg (siehe CLAUDE.md).
SET request.jwt.claims = '{"sys":"true"}';

-- ── 1. Nummernkreis ─────────────────────────────────────────────────────────
--
-- Der kritische Teil. next_document_number() schlaegt ueber doc_type nach und
-- legt bei Nichtfinden einen NEUEN Zaehler bei 1 an - die naechste
-- Abschlagsrechnung bekaeme also eine bereits vergebene Nummer.
--
-- Zwischen dem Ausrollen des Codes und diesem Lauf liegen Sekunden. Faellt
-- ausgerechnet dort das Festschreiben einer Abschlagsrechnung hinein, existiert
-- bereits eine ADVANCE_INVOICE-Zeile, die bei 1 angefangen hat. Deshalb kein
-- blosses UPDATE, sondern INSERT ... ON CONFLICT mit GREATEST: der hoehere der
-- beiden Zaehler gewinnt, und keine Nummer wird zweimal vergeben.
INSERT INTO document_number_range (company_id, doc_type, year, next_counter, "TENANT_ID")
  SELECT company_id, 'ADVANCE_INVOICE', year, next_counter, "TENANT_ID"
    FROM document_number_range
   WHERE doc_type = 'PARTIAL_PAYMENT'
ON CONFLICT (company_id, doc_type, year) DO UPDATE
  SET next_counter = GREATEST(document_number_range.next_counter, EXCLUDED.next_counter),
      updated_at   = now();

DELETE FROM document_number_range WHERE doc_type = 'PARTIAL_PAYMENT';

-- ── 2. Dokumentvorlagen ─────────────────────────────────────────────────────
--
-- documentTemplates.js waehlt die Vorlage ueber DOC_TYPE. Bleibt der alte Wert
-- stehen, faellt die Abschlagsrechnung stillschweigend auf die Standardvorlage
-- zurueck - das Dokument entsteht, sieht nur anders aus.
UPDATE "DOCUMENT_TEMPLATE" SET "DOC_TYPE" = 'ADVANCE_INVOICE'
 WHERE "DOC_TYPE" = 'PARTIAL_PAYMENT';

-- ── 3. Erzeugte Belege ──────────────────────────────────────────────────────
--
-- ASSET_TYPE wird nirgends gelesen - die Belege haengen ueber
-- DOCUMENT_PDF_ASSET_ID und DOCUMENT_XML_ASSET_ID an ihrer Rechnung. Der Wert
-- wandert trotzdem mit, damit der Bestand nicht zwei Vokabulare traegt.
UPDATE "ASSET"
   SET "ASSET_TYPE" = replace("ASSET_TYPE", 'PARTIAL_PAYMENT', 'ADVANCE_INVOICE')
 WHERE "ASSET_TYPE" LIKE '%PARTIAL_PAYMENT%';

RESET request.jwt.claims;

-- PostgREST serves from a cached schema; without this it keeps using the old one.
NOTIFY pgrst, 'reload schema';
