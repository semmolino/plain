-- 0159_08_name_values.sql
--
-- Gegenstueck zu 0156, jetzt fuer NAME_LONG -> NAME. Denselben eingefrorenen
-- Monatsabschluss in TENANT_SETTINGS nachziehen, aus dem das PDF gerendert
-- wird (services_pdf_render.js, getReportData) - sonst bleibt die Spalte mit
-- dem langen Projektnamen im letzten Bericht leer.
--
-- Wieder auf den GEQUOTETEN Schluessel. Im selben JSON steht kein
-- *_NAME_LONG-Alias, aber die Regel bleibt dieselbe: ein Ersetzen ohne
-- Anfuehrungszeichen wuerde jeden zusammengesetzten Namen mit treffen, und
-- genau das ist die Falle, die bei NAME_SHORT PROJECT_TYPE_NAME_SHORT
-- verstuemmelt haette.
SET request.jwt.claims = '{"sys":"true"}';

UPDATE "TENANT_SETTINGS"
   SET "VALUE" = replace("VALUE", '"NAME_LONG":', '"NAME":')
 WHERE "KEY" = 'monatsabschluss_last_report_data'
   AND "VALUE" LIKE '%"NAME_LONG":%';

RESET request.jwt.claims;
