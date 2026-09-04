-- ============================================================================
-- 0137_wip_closing.sql — Festgeschriebene Abschluesse „Teilfertige Leistungen"
--
-- WARUM
--   Der Report rechnet den Stichtagswert live aus dem Bestand. Fuer die
--   Monatsbetrachtung ist das richtig, fuer einen Jahresabschluss nicht: eine
--   nachgebuchte Stunde, ein Storno oder eine Leistungsstandkorrektur
--   verschieben die Zahl rueckwirkend. Was einmal an den Steuerberater ging,
--   muss reproduzierbar bleiben.
--
--   WIP_CLOSING haelt den Kopf (Stichtag, Methode, Bewertungsfaktor, Summen),
--   WIP_CLOSING_LINE je Projekt alle Basis- und Ergebnisgroessen. Beides ist
--   eine Momentaufnahme und wird nie nachgerechnet — deshalb liegen auch die
--   Projektnamen als Text darin und nicht nur als Fremdschluessel: ein spaeter
--   umbenanntes oder geloeschtes Projekt darf einen Abschluss nicht veraendern.
--
-- METHODE
--   'hk'     Herstellkosten (HGB § 255 Abs. 2), ohne anteiligen Gewinn
--   'erloes' Leistungswert (Controlling-Sicht), mit anteiligem Gewinn
--   Der Kopf haelt die Methode, unter der der Abschluss gezogen wurde; die
--   Zeilen halten beide Werte, damit ein Abschluss auch nachtraeglich in der
--   jeweils anderen Sicht lesbar ist.
--
-- MANDANTENTRENNUNG
--   TENANT_ID mit DEFAULT current_tenant_id() (wie 0131) plus RLS-Policy
--   `tenant_isolation` analog zu allen anderen Tabellen. Neue Tabellen sind
--   von 05_rls_scalingo.sql nicht erfasst — das Skript lief einmal ueber den
--   damaligen Bestand.
--
-- EINSPIELEN
--   scalingo --app planandsimple run 'psql "$SCALINGO_POSTGRESQL_URL" -f backend/migrations/0137_wip_closing.sql'
-- ============================================================================

CREATE TABLE IF NOT EXISTS public."WIP_CLOSING" (
  "ID"                   bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  "TENANT_ID"            bigint DEFAULT public.current_tenant_id(),
  "AS_OF_DATE"           date        NOT NULL,
  "METHOD"               text        NOT NULL DEFAULT 'hk',
  "COST_FACTOR_PERCENT"  numeric(6,2) NOT NULL DEFAULT 100,
  "COMPARE_TO_DATE"      date,
  "LABEL"                text,
  -- Summen, wie sie zum Zeitpunkt des Festschreibens galten
  "TOTAL_WIP_HK"         numeric(15,2) NOT NULL DEFAULT 0,
  "TOTAL_WIP_REVENUE"    numeric(15,2) NOT NULL DEFAULT 0,
  "TOTAL_PREPAYMENTS"    numeric(15,2) NOT NULL DEFAULT 0,
  "TOTAL_LOSS_RISK"      numeric(15,2) NOT NULL DEFAULT 0,
  "PROJECT_COUNT"        integer       NOT NULL DEFAULT 0,
  "MISSING_SNAPSHOT_COUNT" integer     NOT NULL DEFAULT 0,
  "CREATED_BY_EMPLOYEE_ID" bigint,
  "CREATED_BY_NAME"      text,
  created_at             timestamptz  NOT NULL DEFAULT now(),
  CONSTRAINT chk_wip_closing_method CHECK ("METHOD" IN ('hk', 'erloes'))
);

-- Ein Mandant schreibt einen Stichtag nur einmal fest. Ein zweiter Lauf zum
-- gleichen Stichtag ersetzt den alten Abschluss (Service loescht vorher) —
-- zwei Abschluesse zum selben Tag waeren zwei Wahrheiten.
CREATE UNIQUE INDEX IF NOT EXISTS idx_wip_closing_tenant_asof
  ON public."WIP_CLOSING" ("TENANT_ID", "AS_OF_DATE");

CREATE TABLE IF NOT EXISTS public."WIP_CLOSING_LINE" (
  "ID"                  bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  "TENANT_ID"           bigint DEFAULT public.current_tenant_id(),
  "CLOSING_ID"          bigint NOT NULL REFERENCES public."WIP_CLOSING"("ID") ON DELETE CASCADE,
  "PROJECT_ID"          bigint,
  -- Momentaufnahme der Projektbezeichnung (siehe Kopfkommentar)
  "NAME_SHORT"          text,
  "NAME_LONG"           text,
  "PROJECT_STATUS_NAME" text,
  "PROJECT_MANAGER"     text,
  -- Basisgroessen zum Stichtag
  "ORDER_VALUE_NET"     numeric(15,2) NOT NULL DEFAULT 0,  -- B  Auftragswert
  "PERFORMANCE_NET"     numeric(15,2) NOT NULL DEFAULT 0,  -- L  Leistungswert
  "PERFORMANCE_PERCENT" numeric(6,2),                      --    Leistungsstand %
  "BILLED_NET"          numeric(15,2) NOT NULL DEFAULT 0,  -- R  abgerechnet
  "COST_NET"            numeric(15,2) NOT NULL DEFAULT 0,  -- K  angefallene Kosten
  "HOURS_TOTAL"         numeric(15,2) NOT NULL DEFAULT 0,
  -- Ergebnisgroessen
  "UNBILLED_NET"        numeric(15,2) NOT NULL DEFAULT 0,  -- U  unfertig zu Auftragspreisen
  "COST_UNBILLED_NET"   numeric(15,2) NOT NULL DEFAULT 0,  -- K_u
  "WIP_HK_NET"          numeric(15,2) NOT NULL DEFAULT 0,  -- TFL Herstellkosten
  "WIP_REVENUE_NET"     numeric(15,2) NOT NULL DEFAULT 0,  -- TFL Leistungswert
  "PREPAYMENT_NET"      numeric(15,2) NOT NULL DEFAULT 0,  -- A  erhaltene Anzahlung
  "LOSS_RISK_NET"       numeric(15,2) NOT NULL DEFAULT 0,  -- D  Drohverlust
  "UNREALIZED_GAIN_NET" numeric(15,2) NOT NULL DEFAULT 0,  -- G  nicht realisierter Gewinn
  "SNAPSHOT_DATE"       date,                              -- letzter PROJECT_PROGRESS <= Stichtag
  "FLAGS"               text,                              -- kommaseparierte Marker, s. Service
  created_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_wip_closing_line_closing
  ON public."WIP_CLOSING_LINE" ("CLOSING_ID");

-- ── Mandantentrennung in der Datenbank ──────────────────────────────────────
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['WIP_CLOSING', 'WIP_CLOSING_LINE'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE public.%I FORCE  ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON public.%I', t);
    EXECUTE format($f$
      CREATE POLICY tenant_isolation ON public.%I FOR ALL
        USING      ("TENANT_ID" = public.current_tenant_id() OR public.is_system_request())
        WITH CHECK ("TENANT_ID" = public.current_tenant_id() OR public.is_system_request())
    $f$, t);
  END LOOP;
END $$;

-- PostgREST-Rollen: ALTER DEFAULT PRIVILEGES aus 03_rls_postgrest.sql greift
-- nur fuer Tabellen, die dieselbe Rolle anlegt. Explizit nachziehen, sonst
-- antwortet PostgREST mit „permission denied for table".
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'plain_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON public."WIP_CLOSING", public."WIP_CLOSING_LINE" TO plain_app;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'plain_system') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON public."WIP_CLOSING", public."WIP_CLOSING_LINE" TO plain_system;
  END IF;
END $$;

-- ── Snapshot-Datum je Projekt ───────────────────────────────────────────────
-- Der Report muss je Projekt sagen koennen, auf welchen Leistungsstand-Snapshot
-- sich der Stichtagswert stuetzt — sonst sieht eine 0 aus wie „nichts geleistet"
-- statt wie „nie erfasst". PostgREST kann kein DISTINCT ON / MAX-GROUP-BY, also
-- als Funktion. Nur Zeilen mit REVENUE_COMPLETION zaehlen: eine Zahlungs- oder
-- Rechnungszeile in PROJECT_PROGRESS belegt keinen Leistungsstand.

CREATE OR REPLACE FUNCTION public.fn_wip_snapshot_dates(
  p_tenant_id bigint,
  p_as_of     timestamptz
)
RETURNS TABLE (
  "PROJECT_ID"  bigint,
  "SNAPSHOT_AT" timestamptz
)
LANGUAGE sql STABLE AS $$
  SELECT ps."PROJECT_ID", MAX(pp."created_at")
  FROM   public."PROJECT_PROGRESS" pp
  JOIN   public."PROJECT_STRUCTURE" ps
    ON   ps."ID"        = pp."STRUCTURE_ID"
   AND   ps."TENANT_ID" = pp."TENANT_ID"
  WHERE  pp."TENANT_ID"          = p_tenant_id
    AND  pp."created_at"        <= p_as_of
    AND  pp."REVENUE_COMPLETION" IS NOT NULL
  GROUP BY ps."PROJECT_ID"
$$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'plain_app') THEN
    GRANT EXECUTE ON FUNCTION public.fn_wip_snapshot_dates(bigint, timestamptz) TO plain_app;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'plain_system') THEN
    GRANT EXECUTE ON FUNCTION public.fn_wip_snapshot_dates(bigint, timestamptz) TO plain_system;
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
