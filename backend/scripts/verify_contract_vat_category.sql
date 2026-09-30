-- ============================================================================
-- verify_contract_vat_category.sql — Verträge, die ihre USt-Kategorie beim
-- Speichern verloren haben könnten (UI-Pilot Runde 6)
--
-- AUSFUEHREN (rein lesend):
--   scalingo --app planandsimple run \
--     'psql "$SCALINGO_POSTGRESQL_URL" -f backend/scripts/verify_contract_vat_category.sql'
--
-- Hintergrund: getContractByProject lieferte VAT_CATEGORY nicht mit. Der Reiter
-- „Verträge" zeigte deshalb „Standard" und schrieb das beim nächsten Speichern
-- zurück. Welche Verträge das traf, steht nirgends — der alte Wert ist
-- überschrieben. Ein Hinweis sind Verträge auf „S", deren letzter Beleg
-- (Rechnung oder Abschlag, ohne Entwürfe) eine andere Kategorie trug: der Beleg
-- hat die Kategorie beim Anlegen vom Vertrag übernommen.
--
-- Die Liste ist ein Verdacht, kein Beweis — eine Kategorie lässt sich je
-- Rechnung im Assistenten ändern. Je Vertrag entscheiden; nichts hier ändert
-- Daten.
--
-- Setzt den sys-Claim selbst: ohne ihn liefert CONTRACT unter FORCE RLS null
-- Zeilen, und eine leere Liste sähe aus wie „nichts betroffen".
-- ============================================================================

SET request.jwt.claims = '{"sys":"true"}';

WITH belege AS (
  SELECT "TENANT_ID", "CONTRACT_ID", 'Rechnung' AS art, "INVOICE_NUMBER" AS nummer,
         "INVOICE_DATE" AS datum, "VAT_CATEGORY" AS kategorie, "ID"
    FROM "INVOICE"
   WHERE "CONTRACT_ID" IS NOT NULL AND COALESCE("STATUS_ID", 1) <> 1
  UNION ALL
  SELECT "TENANT_ID", "CONTRACT_ID", 'Abschlag', "ADVANCE_INVOICE_NUMBER",
         "ADVANCE_INVOICE_DATE", "VAT_CATEGORY", "ID"
    FROM "ADVANCE_INVOICE"
   WHERE "CONTRACT_ID" IS NOT NULL AND COALESCE("STATUS_ID", 1) <> 1
),
letzter AS (
  SELECT DISTINCT ON ("TENANT_ID", "CONTRACT_ID") *
    FROM belege
   ORDER BY "TENANT_ID", "CONTRACT_ID", datum DESC NULLS LAST, "ID" DESC
)
SELECT c."TENANT_ID"                      AS mandant,
       p."ABBR"                           AS projekt,
       c."ABBR"                           AS vertrag,
       COALESCE(c."VAT_CATEGORY", 'S')    AS kategorie_vertrag,
       l.kategorie                        AS kategorie_letzter_beleg,
       l.art || ' ' || COALESCE(l.nummer, '(ohne Nummer)') AS letzter_beleg,
       l.datum                            AS belegdatum
  FROM "CONTRACT" c
  JOIN letzter l   ON l."CONTRACT_ID" = c."ID" AND l."TENANT_ID" = c."TENANT_ID"
  LEFT JOIN "PROJECT" p ON p."ID" = c."PROJECT_ID" AND p."TENANT_ID" = c."TENANT_ID"
 WHERE COALESCE(c."VAT_CATEGORY", 'S') = 'S'
   AND COALESCE(l.kategorie, 'S') <> 'S'
 ORDER BY c."TENANT_ID", p."ABBR", c."ABBR";

RESET request.jwt.claims;
