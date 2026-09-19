-- ============================================================================
-- Migration 0164: Die mandantenblinde Unique-Regel auf ADDRESS.ADDRESS_NAME_1
--
-- BEFUND 2026-09-19
--   Der Adressimport eines Mandanten brach ab:
--       duplicate key value violates unique constraint "ADDRESS_ADDRESS_NAME_1_key"
--   Die Regel steht auf EINER Spalte — ohne TENANT_ID. Sie gilt damit ueber
--   alle Mandanten hinweg. Eine Migration hat sie nie angelegt; sie stammt von
--   Hand aus der Supabase-Zeit und ist beim Umzug mitgewandert.
--
-- WARUM SIE WEG MUSS, NICHT NUR AUFGEWEITET
--   1. Sie ueberquert die Mandantengrenze. Buero A kann keine Adresse
--      "Stadt Muenster" anlegen, wenn Buero B sie schon hat — und erfaehrt aus
--      dem Fehler, DASS es sie hat. Das ist eine Auskunft ueber fremde Daten,
--      die niemand geben wollte: eine Unique-Regel wirkt VOR den Policies und
--      kennt keine Mandanten. RLS verbirgt die Zeile, der Index nicht.
--   2. Sie widerspricht dem Produkt. Die fachliche Dublette ist Name + PLZ
--      (services/importService.js, loadAddressContext), und der Nutzer darf
--      eine erkannte Dublette ausdruecklich "trotzdem neu anlegen". Zwei
--      Adressen duerfen denselben Namen tragen — zwei Standorte derselben
--      Firma, zwei Namensvettern, Bauherr und Rechnungsempfaenger.
--   3. Niemand stuetzt sich darauf. Keine .upsert()/onConflict-Stelle im
--      Backend nennt ADDRESS_NAME_1; gesucht am 2026-09-19.
--
--   Deshalb ersetzt diese Migration sie NICHT durch eine mandantenweite
--   Fassung (TENANT_ID, ADDRESS_NAME_1): auch die waere falsch, nur leiser.
--   Die Dublettenpruefung gehoert in die Anwendung, wo sie den Nutzer fragen
--   kann — in der Datenbank kann sie nur abweisen.
--
-- Gesucht wird ueber die SPALTENLISTE, nicht ueber den Namen: der Name
-- "ADDRESS_ADDRESS_NAME_1_key" ist Postgres' Vorgabe und koennte anderswo
-- anders lauten. attname ist vom Typ name — ohne ::text vergliche man name[]
-- mit text[], und dafuer gibt es keinen Operator.
--
-- Kein Mandanten-Claim noetig: reines DDL auf dem Katalog.
-- ============================================================================

DO $$
DECLARE r record; n int := 0;
BEGIN
  FOR r IN
    SELECT con.conname
    FROM pg_constraint con
    JOIN pg_class c ON c.oid = con.conrelid
    JOIN pg_namespace ns ON ns.oid = c.relnamespace
    WHERE ns.nspname = 'public' AND c.relname = 'ADDRESS' AND con.contype = 'u'
      AND (SELECT array_agg(att.attname::text ORDER BY att.attname::text)
           FROM unnest(con.conkey) AS k(spalte)
           JOIN pg_attribute att
             ON att.attrelid = con.conrelid AND att.attnum = k.spalte)
          = ARRAY['ADDRESS_NAME_1']::text[]
  LOOP
    EXECUTE format('ALTER TABLE public."ADDRESS" DROP CONSTRAINT %I', r.conname);
    RAISE NOTICE 'ADDRESS: Unique-Regel % entfernt (galt ueber alle Mandanten).', r.conname;
    n := n + 1;
  END LOOP;

  IF n = 0 THEN
    RAISE NOTICE 'ADDRESS: keine mandantenblinde Unique-Regel auf ADDRESS_NAME_1 gefunden — nichts zu tun.';
  END IF;
END $$;


-- ── Dieselbe Falle anderswo? ────────────────────────────────────────────────
-- Nur BERICHTEN, nicht aendern. Was hier auftaucht, ist noch kein Befund: eine
-- mandantenblinde Unique-Regel kann richtig sein. Falsch ist sie dort, wo der
-- Wert dem MANDANTEN gehoert — und das entscheidet die Fachlichkeit, nicht
-- dieses Skript.
--
-- Stand 2026-09-19 fanden sich sieben Regeln und vier Unique-Indizes ohne
-- Mandantenbezug. Ausser ADDRESS war alles in Ordnung, und zwar durchweg aus
-- demselben Grund: sie haengen an einem Fremdschluessel (INVOICE_ID, PP_ID,
-- COMPANY_ID, PROJECT_ID, FAMILY_ID, EMPLOYEE_ID), und der gehoert bereits
-- genau einem Mandanten. "Eindeutig je Rechnung" ist damit automatisch
-- "eindeutig je Mandant" — zwei Mandanten koennen dort nicht kollidieren.
-- Einzige Ausnahme der Begruendung: PUSH_SUBSCRIPTION (ENDPOINT); die
-- Endpunkt-URL des Push-Dienstes ist von sich aus weltweit eindeutig und nicht
-- erratbar, taugt also auch nicht zum Abfragen fremder Bestaende.
--
-- Nur ADDRESS.ADDRESS_NAME_1 stand auf einem Wert, den der Mandant selbst
-- vergibt. Die Aufstellung bleibt trotzdem im Deploy-Protokoll: damit eine
-- spaeter hinzugekommene Regel nicht auf dem Weg auffaellt, auf dem diese hier
-- auffiel — als abgebrochener Import.
DO $$
DECLARE r record; n int := 0;
BEGIN
  FOR r IN
    -- Benannte Regeln …
    SELECT c.relname AS tabelle, con.conname AS regel, pg_get_constraintdef(con.oid) AS def
    FROM pg_constraint con
    JOIN pg_class c ON c.oid = con.conrelid
    JOIN pg_namespace ns ON ns.oid = c.relnamespace
    WHERE ns.nspname = 'public' AND con.contype = 'u'
      AND EXISTS (SELECT 1 FROM information_schema.columns col
                  WHERE col.table_schema = 'public' AND col.table_name = c.relname
                    AND col.column_name = 'TENANT_ID')
      AND pg_get_constraintdef(con.oid) NOT LIKE '%TENANT_ID%'
    UNION ALL
    -- … und nackte Unique-Indizes, die zu keiner Regel gehoeren. Sie weisen
    -- genauso ab und tragen in der Fehlermeldung ebenfalls das Wort
    -- "constraint" — wer nur pg_constraint absucht, uebersieht sie.
    SELECT c.relname, i.relname, pg_get_indexdef(ix.indexrelid)
    FROM pg_index ix
    JOIN pg_class c ON c.oid = ix.indrelid
    JOIN pg_class i ON i.oid = ix.indexrelid
    JOIN pg_namespace ns ON ns.oid = c.relnamespace
    WHERE ns.nspname = 'public' AND ix.indisunique
      AND NOT EXISTS (SELECT 1 FROM pg_constraint con WHERE con.conindid = ix.indexrelid)
      AND EXISTS (SELECT 1 FROM information_schema.columns col
                  WHERE col.table_schema = 'public' AND col.table_name = c.relname
                    AND col.column_name = 'TENANT_ID')
      AND pg_get_indexdef(ix.indexrelid) NOT LIKE '%TENANT_ID%'
    ORDER BY 1, 2
  LOOP
    RAISE NOTICE 'Ohne Mandantenbezug eindeutig: %.% — %', r.tabelle, r.regel, r.def;
    n := n + 1;
  END LOOP;
  RAISE NOTICE 'Eindeutigkeitsregeln ohne Mandantenbezug auf Mandantentabellen: %', n;
END $$;
