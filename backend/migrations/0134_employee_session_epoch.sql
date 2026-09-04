-- ============================================================================
-- 0134_employee_session_epoch.sql — Sitzungen zurücknehmbar machen
--
-- PROBLEM (Sicherheitsaudit 2026-09-03, M4)
--   Ein Anmelde-Token gilt 8 Stunden. Abmelden verwirft es nur im Browser,
--   macht es aber nicht ungültig. Damit wirken auch Rollenentzug, Deaktivierung
--   (ACTIVE=2) und Passwortwechsel erst nach bis zu 8 Stunden — ein
--   ausgeschiedener Mitarbeiter oder ein abgeflossenes Token arbeitet so lange
--   weiter.
--
-- LÖSUNG
--   Ein Zeitstempel je Mitarbeiter. Jedes Token trägt (JWT-Standard) seinen
--   Ausstellungszeitpunkt `iat`. Ist SESSION_EPOCH neuer als iat, ist das Token
--   tot. "Überall abmelden" ist damit ein einziges UPDATE.
--
--   Bewusst ein Zeitstempel und kein Zähler: exakt dasselbe Verfahren nutzt die
--   Owner-Konsole seit Migration 0103 (PLATFORM_ADMIN.SESSION_EPOCH). Ein
--   Muster für beide Seiten statt zwei ähnlicher.
--
-- RÜCKWÄRTSKOMPATIBEL
--   NULL bedeutet "nie zurückgenommen" — bestehende Sitzungen bleiben nach dem
--   Einspielen gültig. Kein Massen-Logout beim Deploy.
--
-- EINSPIELEN
--   scalingo --app planandsimple run 'psql "$SCALINGO_POSTGRESQL_URL" -f backend/migrations/0134_employee_session_epoch.sql'
-- ============================================================================

ALTER TABLE public."EMPLOYEE"
  ADD COLUMN IF NOT EXISTS "SESSION_EPOCH" timestamptz;

COMMENT ON COLUMN public."EMPLOYEE"."SESSION_EPOCH" IS
  'Vor diesem Zeitpunkt ausgestellte Tokens sind ungueltig. Wird gesetzt bei Passwortwechsel, Deaktivierung und Rollenaenderung. NULL = nie zurueckgenommen.';
