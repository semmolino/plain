-- Migration 0035: Row Level Security for tenant-scoped employee tables
-- Run manually in Supabase SQL editor.
--
-- NOTE: The app uses the Supabase SERVICE-ROLE key which bypasses RLS entirely.
-- These policies are defence-in-depth: they protect against direct DB access
-- (e.g. Supabase dashboard queries, anon/auth key leaks) but do NOT affect
-- the application's behaviour.

-- ── EMPLOYEE_CP_RATE ─────────────────────────────────────────────────────────

ALTER TABLE "EMPLOYEE_CP_RATE" ENABLE ROW LEVEL SECURITY;

-- Service-role key bypasses all policies automatically; no policy needed for it.
-- Deny everything for anon / authenticated roles (app never uses these keys):
CREATE POLICY "deny_anon_ecp"
  ON "EMPLOYEE_CP_RATE"
  FOR ALL
  TO anon, authenticated
  USING (false);

-- ── EMPLOYEE_WORK_MODEL ──────────────────────────────────────────────────────

ALTER TABLE "EMPLOYEE_WORK_MODEL" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "deny_anon_ewm"
  ON "EMPLOYEE_WORK_MODEL"
  FOR ALL
  TO anon, authenticated
  USING (false);

-- ── EMPLOYEE_MONTH_CLOSE ─────────────────────────────────────────────────────

ALTER TABLE "EMPLOYEE_MONTH_CLOSE" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "deny_anon_emc"
  ON "EMPLOYEE_MONTH_CLOSE"
  FOR ALL
  TO anon, authenticated
  USING (false);

-- ── WORKING_TIME_MODEL ───────────────────────────────────────────────────────

ALTER TABLE "WORKING_TIME_MODEL" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "deny_anon_wtm"
  ON "WORKING_TIME_MODEL"
  FOR ALL
  TO anon, authenticated
  USING (false);
