-- 0156_07_abbr_values.sql
--
-- Block 07 benennt NAME_SHORT in ABBR um. Der Name steht aber auch in einem
-- gespeicherten JSON: TENANT_SETTINGS unter dem Schluessel
-- 'monatsabschluss_last_report_data'. Dort liegt der letzte Monatsabschluss als
-- eingefrorener Bericht, Zeile fuer Zeile mit den Feldnamen von damals.
--
-- WARUM DAS ZAEHLT
--   services_pdf_render.js rendert das Monatsabschluss-PDF NICHT neu aus der
--   Datenbank, sondern aus genau diesem JSON (Z. 1284, getReportData). Die
--   Vorlage monatsabschluss.njk liest p.NAME_SHORT - der Codemod hat sie auf
--   p.ABBR umgeschrieben. Ohne diese Migration blieben die Projektspalten im
--   letzten Bericht leer. Kein Fehler, kein Log: nur leere Zellen.
--
-- WARUM AUF DEN GEQUOTETEN SCHLUESSEL UND NICHT AUF DEN BLOSSEN NAMEN
--   Dasselbe JSON enthaelt PROJECT_STATUS_NAME_SHORT und
--   PROJECT_TYPE_NAME_SHORT. Das sind Report-Aliase, keine Tabellenspalten, und
--   sie werden NICHT umbenannt. Ein replace auf 'NAME_SHORT' haette sie zu
--   PROJECT_STATUS_ABBR verstuemmelt. Das fuehrende Anfuehrungszeichen im
--   Muster '"NAME_SHORT":' schliesst sie aus.
SET request.jwt.claims = '{"sys":"true"}';

UPDATE "TENANT_SETTINGS"
   SET "VALUE" = replace("VALUE", '"NAME_SHORT":', '"ABBR":')
 WHERE "KEY" = 'monatsabschluss_last_report_data'
   AND "VALUE" LIKE '%"NAME_SHORT":%';

RESET request.jwt.claims;
