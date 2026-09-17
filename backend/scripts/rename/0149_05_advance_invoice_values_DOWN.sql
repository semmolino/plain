-- 0149_05_advance_invoice_values_DOWN.sql
--
-- Nimmt die Datenmigration 0149 zurueck. Keine Migration - von Hand einspielen,
-- und zwar ZUSAMMEN mit 0147_05_advance_invoice_DOWN.sql: der Code erwartet
-- nach einem Rollback wieder die alten Tabellennamen UND die alten Typwerte.
--
-- Reihenfolge beim Zuruecknehmen:
--   1. diese Datei   (Werte zurueck)
--   2. 0147_..._DOWN (Tabellen und Spalten zurueck)
--   3. git revert des Block-05-Commits
--
-- Reines DDL braucht keinen Claim, Daten schon: alle drei Tabellen tragen
-- TENANT_ID, ohne Claim sieht ein psql-Lauf null Zeilen und meldet Erfolg.
SET request.jwt.claims = '{"sys":"true"}';

-- Nummernkreis. Spiegelbildlich zum Hinweg: der hoehere Zaehler gewinnt, damit
-- eine in der Zwischenzeit vergebene Nummer nicht ein zweites Mal herauskommt.
INSERT INTO document_number_range (company_id, doc_type, year, next_counter, "TENANT_ID")
  SELECT company_id, 'PARTIAL_PAYMENT', year, next_counter, "TENANT_ID"
    FROM document_number_range
   WHERE doc_type = 'ADVANCE_INVOICE'
ON CONFLICT (company_id, doc_type, year) DO UPDATE
  SET next_counter = GREATEST(document_number_range.next_counter, EXCLUDED.next_counter),
      updated_at   = now();

DELETE FROM document_number_range WHERE doc_type = 'ADVANCE_INVOICE';

UPDATE "DOCUMENT_TEMPLATE" SET "DOC_TYPE" = 'PARTIAL_PAYMENT'
 WHERE "DOC_TYPE" = 'ADVANCE_INVOICE';

UPDATE "ASSET"
   SET "ASSET_TYPE" = replace("ASSET_TYPE", 'ADVANCE_INVOICE', 'PARTIAL_PAYMENT')
 WHERE "ASSET_TYPE" LIKE '%ADVANCE_INVOICE%';

RESET request.jwt.claims;

NOTIFY pgrst, 'reload schema';
