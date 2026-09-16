-- ============================================================================
-- 0139_booking_rebook.sql — Umbuchen von Buchungen (Recht + Protokoll)
--
-- WARUM EIN EIGENES RECHT
--   Eine Buchung tragt Kosten (CP_TOT) und Erloes (SP_TOT) eines Projekts.
--   Sie umzubuchen verschiebt Geld zwischen zwei Projekten und veraendert
--   damit Deckungsbeitrag, Budgetauslastung und den Wert der teilfertigen
--   Leistungen auf BEIDEN Seiten — ohne dass eine Zahl sich aendert und
--   jemandem auffaellt. `projects.bookings.edit` reicht dafuer nicht: das ist
--   das Recht, die eigene Zeitzeile zu korrigieren.
--
-- DEFAULT-ROLLEN
--   Administrator, Geschaeftsleitung, Projektleiter. Der Projektleiter merkt
--   die Fehlbuchung im eigenen Projekt zuerst und soll sie ohne Ticket
--   geradeziehen koennen. Bewusst NICHT die Default-Rolle „Mitarbeiter".
--
--   Fuer NEUE Mandanten kommen die Rollen nicht aus dieser Migration, sondern
--   aus seedTenantRbacAndAssignAdmin (routes/auth.js). Dort faellt das Recht
--   ueber byModule(["projects"]) automatisch an den Projektleiter; die
--   Geschaeftsleitung bekommt nur `reading` pauschal und braucht deshalb den
--   ausdruecklichen Eintrag in ihrer byKey-Liste — er steht dort.
--
-- WAS NICHT UMBUCHBAR IST
--   Buchungen mit INVOICE_ID oder PARTIAL_PAYMENT_ID. Sie stecken in einem
--   Beleg; sie zu verschieben wuerde eine gestellte Rechnung von ihrer
--   Grundlage trennen. Das prueft der Service (services/buchungen.js), nicht
--   die Datenbank — die Meldung soll sagen, WELCHE Rechnung es ist.
--
-- PROTOKOLL
--   TEC_REBOOKING haelt je verschobener Buchung, wer sie wann von wo nach wo
--   gebucht hat, mit optionalem Grund. Projekt- und Elementnamen liegen als
--   Text daneben (wie in WIP_CLOSING_LINE): ein spaeter umbenanntes oder
--   geloeschtes Element darf einen Protokolleintrag nicht unlesbar machen.
--   Deshalb auch keine Fremdschluessel — der Eintrag ueberlebt sein Ziel.
--
-- EINSPIELEN
--   scalingo --app planandsimple run 'psql "$SCALINGO_POSTGRESQL_URL" -f backend/migrations/0139_booking_rebook.sql'
-- ============================================================================

-- ACHTUNG — RLS: dieses Skript liest "USER_ROLE" (traegt TENANT_ID, also von
-- der Policy tenant_isolation erfasst, FORCE ROW LEVEL SECURITY, fail-closed
-- ohne Claim). Ein psql-Lauf hat keinen JWT-Claim: ohne die folgende Zeile
-- liefert das SELECT null Zeilen, die Rollenzuweisung laeuft ins Leere — und
-- die Migration meldet trotzdem Erfolg (so ist 0136 beim ersten Einspielen
-- gescheitert). Siehe CLAUDE.md, Abschnitt Database conventions.
SET request.jwt.claims = $CLAIM${"sys":"true"}$CLAIM$;

-- ── 1. Permission ───────────────────────────────────────────────────────────

INSERT INTO "PERMISSION" ("KEY", "MODULE", "ACTION", "LABEL_DE", "DESCRIPTION_DE", "CATEGORY", "POSITION") VALUES
('projects.bookings.rebook', 'projects', 'edit', 'Buchungen umbuchen',
 'Buchungen auf ein anderes Projektelement oder Projekt verschieben — einzeln oder als Auswahl. Abgerechnete Buchungen bleiben gesperrt.',
 'editing', 234)
ON CONFLICT ("KEY") DO UPDATE SET
  "LABEL_DE"       = EXCLUDED."LABEL_DE",
  "DESCRIPTION_DE" = EXCLUDED."DESCRIPTION_DE",
  "MODULE"         = EXCLUDED."MODULE",
  "ACTION"         = EXCLUDED."ACTION",
  "CATEGORY"       = EXCLUDED."CATEGORY",
  "POSITION"       = EXCLUDED."POSITION";

DO $$
DECLARE
  perm_rebook INT;
BEGIN
  SELECT "ID" INTO perm_rebook FROM "PERMISSION" WHERE "KEY" = 'projects.bookings.rebook';

  INSERT INTO "ROLE_PERMISSION" ("ROLE_ID","PERMISSION_ID")
    SELECT "ID", perm_rebook
    FROM "USER_ROLE"
    WHERE "IS_SYSTEM" = TRUE
      AND "NAME_SHORT" IN ('Administrator', 'Geschäftsleitung', 'Projektleiter')
  ON CONFLICT DO NOTHING;

  RAISE NOTICE 'projects.bookings.rebook: % Rollenzuweisungen', (
    SELECT count(*) FROM "ROLE_PERMISSION" rp WHERE rp."PERMISSION_ID" = perm_rebook
  );
END $$;

-- ── 2. Protokolltabelle ─────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public."TEC_REBOOKING" (
  "ID"                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  "TENANT_ID"         bigint DEFAULT public.current_tenant_id(),
  "TEC_ID"            bigint NOT NULL,
  -- Momentaufnahme der Buchung, damit das Protokoll auch nach einer spaeteren
  -- Loeschung noch aussagt, was verschoben wurde.
  "DATE_VOUCHER"      date,
  "BOOKING_EMPLOYEE_ID" bigint,
  "QUANTITY_INT"      numeric(15,2),
  "CP_TOT"            numeric(15,2),
  "FROM_PROJECT_ID"   bigint,
  "FROM_PROJECT_NAME" text,
  "FROM_STRUCTURE_ID" bigint,
  "FROM_STRUCTURE_NAME" text,
  "TO_PROJECT_ID"     bigint,
  "TO_PROJECT_NAME"   text,
  "TO_STRUCTURE_ID"   bigint,
  "TO_STRUCTURE_NAME" text,
  -- Erloesseite vor/nach der Umbuchung: der Stundensatz kommt aus der
  -- Mitarbeiter/Projekt-Zuordnung des ZIELS und kann sich damit aendern.
  "SP_RATE_BEFORE"    numeric(15,2),
  "SP_RATE_AFTER"     numeric(15,2),
  "SP_TOT_BEFORE"     numeric(15,2),
  "SP_TOT_AFTER"      numeric(15,2),
  "REASON"            text,
  "CREATED_BY_EMPLOYEE_ID" bigint,
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tec_rebooking_tenant_tec
  ON public."TEC_REBOOKING" ("TENANT_ID", "TEC_ID");
CREATE INDEX IF NOT EXISTS idx_tec_rebooking_created
  ON public."TEC_REBOOKING" ("TENANT_ID", created_at DESC);

-- ── Mandantentrennung in der Datenbank ──────────────────────────────────────
-- Neue Tabellen sind von 05_rls_scalingo.sql nicht erfasst (das Skript lief
-- einmal ueber den damaligen Bestand) — Policy hier explizit setzen.
ALTER TABLE public."TEC_REBOOKING" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."TEC_REBOOKING" FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public."TEC_REBOOKING";
CREATE POLICY tenant_isolation ON public."TEC_REBOOKING" FOR ALL
  USING      ("TENANT_ID" = public.current_tenant_id() OR public.is_system_request())
  WITH CHECK ("TENANT_ID" = public.current_tenant_id() OR public.is_system_request());

-- PostgREST-Rollen: ALTER DEFAULT PRIVILEGES aus 03_rls_postgrest.sql greift
-- nur fuer Tabellen, die dieselbe Rolle anlegt. Explizit nachziehen, sonst
-- antwortet PostgREST mit „permission denied for table".
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'plain_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON public."TEC_REBOOKING" TO plain_app;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'plain_system') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON public."TEC_REBOOKING" TO plain_system;
  END IF;
END $$;

RESET request.jwt.claims;

NOTIFY pgrst, 'reload schema';
