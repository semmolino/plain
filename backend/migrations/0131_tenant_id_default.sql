-- ============================================================================
-- 0131_tenant_id_default.sql — TENANT_ID bekommt current_tenant_id() als Vorgabe
--
-- WARUM
--   Seit der Portierung auf Scalingo/PostgREST gilt echte RLS
--   (scripts/migration/05_rls_scalingo.sql). Die Policy prueft beim Schreiben
--       WITH CHECK ("TENANT_ID" = public.current_tenant_id() OR is_system_request())
--   gegen die VORGESCHLAGENE Zeile — nicht gegen die bereits gespeicherte.
--
--   supabase-js .upsert() wird von PostgREST zu INSERT ... ON CONFLICT DO UPDATE.
--   Enthaelt die Nutzlast kein TENANT_ID, ist der Wert in der vorgeschlagenen
--   Zeile NULL, der Vergleich ergibt NULL statt true, und die Datenbank
--   antwortet mit
--       new row violates row-level security policy for table "..."
--   Genau das trat z. B. beim Speichern der Leistungsstaende auf
--   (PROJECT_STRUCTURE). Unter dem alten Supabase-Service-Key fiel es nicht
--   auf, weil der Service-Key RLS per Definition umgangen hat.
--
--   Die betroffenen Aufrufstellen sind im Code korrigiert. Diese Migration ist
--   das Netz darunter: wo TENANT_ID beim Schreiben fehlt, traegt die Datenbank
--   den Mandanten aus dem Request-JWT ein. Der Wert kann damit nicht mehr
--   falsch sein — im Gegensatz zu einem NULL, das die Zeile entweder abweist
--   oder (frueher) mandantenlos anlegte.
--
-- WAS ES NICHT TUT
--   Es schwaecht die Trennung nicht auf: der Vorgabewert ist genau der
--   Mandant, den die Policy ohnehin verlangt. Ein Request ohne Mandanten-Claim
--   (Systemkontext, psql) bekommt weiterhin NULL — dort muss der Mandant wie
--   bisher ausdruecklich mitgegeben werden.
--
-- REIHENFOLGE
--   Setzt public.current_tenant_id() voraus, also NACH 05_rls_scalingo.sql.
--   Auf einer Instanz ohne PostgREST (POSTGREST_URL leer) ist die Funktion
--   nicht vorhanden — dann bricht das Skript kontrolliert mit einem Hinweis ab
--   und es ist auch nichts zu tun.
-- ============================================================================

DO $$
DECLARE
  t record;
  gesetzt int := 0;
  uebersprungen int := 0;
BEGIN
  IF to_regprocedure('public.current_tenant_id()') IS NULL THEN
    RAISE EXCEPTION
      'public.current_tenant_id() fehlt — erst scripts/migration/05_rls_scalingo.sql einspielen.';
  END IF;

  FOR t IN
    SELECT c.relname AS tabelle, a.attname AS spalte
    FROM pg_class c
    JOIN pg_namespace nsp ON nsp.oid = c.relnamespace
    JOIN pg_attribute a   ON a.attrelid = c.oid
    WHERE nsp.nspname = 'public'
      AND c.relkind   = 'r'
      AND a.attname   = 'TENANT_ID'
      AND a.attnum    > 0
      AND NOT a.attisdropped
    ORDER BY c.relname
  LOOP
    -- Eine bereits vorhandene Vorgabe (z. B. eine Sequenz) NICHT ueberschreiben.
    IF EXISTS (
      SELECT 1
      FROM pg_attrdef d
      JOIN pg_class c2      ON c2.oid = d.adrelid
      JOIN pg_namespace n2  ON n2.oid = c2.relnamespace
      JOIN pg_attribute a2  ON a2.attrelid = d.adrelid AND a2.attnum = d.adnum
      WHERE n2.nspname = 'public'
        AND c2.relname = t.tabelle
        AND a2.attname = t.spalte
    ) THEN
      uebersprungen := uebersprungen + 1;
      CONTINUE;
    END IF;

    EXECUTE format(
      'ALTER TABLE public.%I ALTER COLUMN %I SET DEFAULT public.current_tenant_id()',
      t.tabelle, t.spalte
    );
    gesetzt := gesetzt + 1;
  END LOOP;

  RAISE NOTICE 'TENANT_ID-Vorgabe gesetzt auf % Tabellen (% uebersprungen, hatten bereits eine)',
    gesetzt, uebersprungen;
END $$;


-- ── Gegenprobe ──────────────────────────────────────────────────────────────
-- Erwartung: jede Zeile zeigt public.current_tenant_id() als Vorgabe.
--
--   SELECT c.relname AS tabelle,
--          pg_get_expr(d.adbin, d.adrelid) AS vorgabe
--   FROM pg_class c
--   JOIN pg_namespace n  ON n.oid = c.relnamespace
--   JOIN pg_attribute a  ON a.attrelid = c.oid AND a.attname = 'TENANT_ID'
--   LEFT JOIN pg_attrdef d ON d.adrelid = c.oid AND d.adnum = a.attnum
--   WHERE n.nspname = 'public' AND c.relkind = 'r'
--   ORDER BY 1;
