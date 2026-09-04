-- ============================================================================
-- 0135_tenant_signup_approval.sql — Registrierung braucht Bestätigung und Freigabe
--
-- PROBLEM (Sicherheitsaudit 2026-09-03, N3)
--   POST /auth/signup legte Mandant, Firma und Erst-Nutzer in einem Zug an, mit
--   sofort nutzbarem Passwort. Niemand belegte, dass die E-Mail-Adresse dem
--   Anmelder gehört: ein Tippfehler sperrte sich selbst aus (Passwort-Reset
--   ging ins Leere), Mandanten mit fremden Firmennamen waren anlegbar, und
--   jeder angelegte Mandant zählte gegen Speicher und Datenbank.
--
-- ZWEI TORE
--   1. Der Anmelder bestätigt seine Adresse über einen Link (24 h).
--   2. Der Plattformbetreiber gibt den Mandanten in der Owner-Konsole frei.
--   Bis beide durch sind, ist die Anmeldung gesperrt — es entsteht also kein
--   einziger Datensatz in einem Mandanten, der danach abgelehnt wird.
--
-- ZUSTÄNDE
--   pending_email    angelegt, Adresse noch nicht bestätigt
--   pending_approval Adresse bestätigt, wartet auf Freigabe
--   active           freigegeben, Anmeldung möglich
--
--   Kein 'rejected': eine Ablehnung löscht den Mandanten (bewusste
--   Entscheidung des Betreibers, 2026-09-04). Die Ablehnung selbst bleibt im
--   Änderungsprotokoll der Owner-Konsole nachvollziehbar.
--
-- BESTEHENDE MANDANTEN
--   Werden auf 'active' gesetzt. Ohne diesen Schritt könnte sich nach dem
--   Einspielen NIEMAND mehr anmelden — der Standardwert allein genügt nicht,
--   weil er nur für neue Zeilen gilt.
--
-- EINSPIELEN
--   scalingo --app planandsimple run 'psql "$SCALINGO_POSTGRESQL_URL" -f backend/migrations/0135_tenant_signup_approval.sql'
-- ============================================================================

ALTER TABLE public."TENANTS"
  ADD COLUMN IF NOT EXISTS "SIGNUP_STATE"       character varying(20),
  ADD COLUMN IF NOT EXISTS "EMAIL_CONFIRMED_AT" timestamptz,
  ADD COLUMN IF NOT EXISTS "APPROVED_AT"        timestamptz,
  ADD COLUMN IF NOT EXISTS "APPROVED_BY"        character varying(255);

-- Bestandsmandanten sind freigegeben. MUSS vor dem NOT NULL/CHECK laufen.
UPDATE public."TENANTS" SET "SIGNUP_STATE" = 'active' WHERE "SIGNUP_STATE" IS NULL;

ALTER TABLE public."TENANTS"
  ALTER COLUMN "SIGNUP_STATE" SET DEFAULT 'active';

-- Der Standardwert ist 'active', nicht 'pending_email': jede andere Stelle,
-- die einen Mandanten anlegt (Import, Demo-Daten, manuelles SQL), soll
-- weiterhin einen benutzbaren Mandanten erzeugen. Nur der Signup-Weg setzt
-- ausdrücklich 'pending_email'. Fail-safe in die Richtung, die niemanden
-- aussperrt — die Sperre gehört an genau eine Stelle, nicht in den Default.

ALTER TABLE public."TENANTS"
  ALTER COLUMN "SIGNUP_STATE" SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_tenants_signup_state') THEN
    ALTER TABLE public."TENANTS"
      ADD CONSTRAINT chk_tenants_signup_state
      CHECK ("SIGNUP_STATE" IN ('pending_email', 'pending_approval', 'active'));
  END IF;
END $$;

-- Die Konsole filtert auf die offenen Anträge; ohne Index ein Full Scan bei
-- jedem Aufruf der Übersicht.
CREATE INDEX IF NOT EXISTS idx_tenants_signup_state
  ON public."TENANTS" ("SIGNUP_STATE")
  WHERE "SIGNUP_STATE" <> 'active';

COMMENT ON COLUMN public."TENANTS"."SIGNUP_STATE" IS
  'pending_email | pending_approval | active. Anmeldung nur bei active (routes/auth.js). Default active, damit nur der Signup-Weg sperrt.';
COMMENT ON COLUMN public."TENANTS"."APPROVED_BY" IS
  'E-Mail des Plattform-Admins, der freigegeben hat (PLATFORM_ADMIN.EMAIL).';
