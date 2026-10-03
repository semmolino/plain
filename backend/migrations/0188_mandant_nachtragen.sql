-- ============================================================================
-- 0188_mandant_nachtragen.sql — Zeilen ohne Mandant ihrem Mandanten zuordnen
--
-- WARUM
--   Dieselbe Ursache wie 0187 (Standardvorlagen), in drei weiteren Tabellen:
--   Zeilen mit TENANT_ID = NULL, angelegt vor dem Umzug auf Scalingo, als der
--   Supabase-Dienstschluessel RLS umging und die fehlende Spalte nicht
--   auffiel. Seit RLS greift (Policy "TENANT_ID" = current_tenant_id()),
--   sieht sie kein Mandant mehr, auch ihr eigener nicht:
--
--   FEE_CALCULATION_PHASE   207  Leistungsphasen von 23 Kalkulationen
--                                (Mandant 4) — die Kalkulationen standen ohne
--                                Phasen da.
--   PROJECT_PROGRESS        159  Leistungsstand-Snapshots (Mandanten 4, 5, 6,
--                                11) — fehlten im Verlauf und in „Teilfertige
--                                Leistungen" zu frueheren Stichtagen.
--   document_number_range    16  Nummernkreise (Mandanten 4, 5, 6, 10, 11).
--                                Der naechste Abruf traf per ON CONFLICT auf
--                                die verborgene Zeile und scheiterte an der
--                                Policy — Projekt, Angebot oder Nachtrag in
--                                diesen Firmen liess sich nicht anlegen.
--
--   Vorab gegen die Produktion geprueft (2026-10-02):
--   - jede Zeile hat genau einen Elternsatz mit Mandant —
--     FEE_CALCULATION_MASTER, PROJECT_STRUCTURE bzw. COMPANY; keine Waisen
--   - keine Kalkulationsphase wurde seitdem neu erfasst: nach dem Zuordnen
--     gibt es je Kalkulation und Phase weiterhin genau eine Zeile
--   - an keinem verborgenen Nummernkreis wurde seitdem eine Nummer vergeben
--     (jeder spaetere Beleg entstand 0–2 s nach dem Zaehlerstand, also im
--     selben Vorgang) — der Zaehler laeuft dort weiter, wo er stand, eine
--     Nummer doppelt zu vergeben ist ausgeschlossen
--
--   Sichtbare Folge: Kalkulationen zeigen ihre Phasen wieder, und Berichte zu
--   frueheren Stichtagen rechnen mit den wiedergefundenen Leistungsstaenden —
--   so, wie sie es vor dem Umzug getan haben.
--
--   ASSET hat ebenfalls Zeilen ohne TENANT_ID, ist aber nicht betroffen:
--   seine Policy prueft ueber COMPANY, nicht ueber die eigene Spalte.
--
-- MANDANTENTRENNUNG
--   Liest und schreibt mandantenbezogene Tabellen → sys-Claim. Wiederholbar:
--   jedes UPDATE trifft nur Zeilen, die noch keinen Mandanten haben.
-- ============================================================================

SET request.jwt.claims = '{"sys":"true"}';

UPDATE "FEE_CALCULATION_PHASE" p
   SET "TENANT_ID" = m."TENANT_ID"
  FROM "FEE_CALCULATION_MASTER" m
 WHERE m."ID" = p."FEE_MASTER_ID"
   AND p."TENANT_ID" IS NULL
   AND m."TENANT_ID" IS NOT NULL;

UPDATE "PROJECT_PROGRESS" p
   SET "TENANT_ID" = s."TENANT_ID"
  FROM "PROJECT_STRUCTURE" s
 WHERE s."ID" = p."STRUCTURE_ID"
   AND p."TENANT_ID" IS NULL
   AND s."TENANT_ID" IS NOT NULL;

-- Der Nummernkreis traegt die Firma in zwei Spalten (company_id aus der
-- Fruehphase, COMPANY_ID spaeter) — beide zaehlen.
UPDATE document_number_range r
   SET "TENANT_ID" = c."TENANT_ID"
  FROM "COMPANY" c
 WHERE c."ID" = COALESCE(r."COMPANY_ID", r.company_id)
   AND r."TENANT_ID" IS NULL
   AND c."TENANT_ID" IS NOT NULL;

-- Was jetzt noch ohne Mandant ist, hat keinen Elternsatz mit Mandant — das
-- Protokoll des Deploys nennt es, statt es still stehen zu lassen.
DO $$
DECLARE
  t text;
  n bigint;
BEGIN
  FOREACH t IN ARRAY ARRAY['FEE_CALCULATION_PHASE', 'PROJECT_PROGRESS', 'document_number_range'] LOOP
    EXECUTE format('SELECT count(*) FROM %I WHERE "TENANT_ID" IS NULL', t) INTO n;
    IF n > 0 THEN
      RAISE WARNING '0188: % hat noch % Zeilen ohne Mandant (kein Elternsatz mit Mandant)', t, n;
    END IF;
  END LOOP;
END $$;

RESET request.jwt.claims;
