-- ============================================================
-- Row Level Security (RLS) — PlaIn tenant isolation
--
-- Run this once in the Supabase SQL Editor.
--
-- How it works:
--   • The Express backend uses the SERVICE ROLE key → bypasses RLS
--     entirely. All existing backend behaviour is unaffected.
--   • The browser only holds the ANON key (used purely for Supabase
--     Auth). Without RLS these anon/authenticated tokens could hit
--     PostgREST directly and read every tenant's data.
--   • After running this script, every direct PostgREST request is
--     restricted to the rows that belong to the caller's tenant_id
--     (stored in JWT app_metadata by our signup flow).
--
-- Re-running is safe: DROP POLICY IF EXISTS is used throughout.
-- ============================================================

-- ── Helper: extract tenant_id from JWT app_metadata ──────────
-- Returns NULL (→ no rows visible) when the claim is absent.
CREATE OR REPLACE FUNCTION public.current_tenant_id()
RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT (auth.jwt() -> 'app_metadata' ->> 'tenant_id')::integer
$$;


-- ════════════════════════════════════════════════════════════
-- TENANT-SCOPED TABLES  (have a TENANT_ID column)
-- ════════════════════════════════════════════════════════════

-- ── TENANTS ──────────────────────────────────────────────────
ALTER TABLE "TENANTS" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_isolation" ON "TENANTS";
CREATE POLICY "tenant_isolation" ON "TENANTS"
  USING  ("ID" = public.current_tenant_id())
  WITH CHECK ("ID" = public.current_tenant_id());

-- ── COMPANY ──────────────────────────────────────────────────
ALTER TABLE "COMPANY" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_isolation" ON "COMPANY";
CREATE POLICY "tenant_isolation" ON "COMPANY"
  USING  ("TENANT_ID" = public.current_tenant_id())
  WITH CHECK ("TENANT_ID" = public.current_tenant_id());

-- ── PROJECT ──────────────────────────────────────────────────
ALTER TABLE "PROJECT" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_isolation" ON "PROJECT";
CREATE POLICY "tenant_isolation" ON "PROJECT"
  USING  ("TENANT_ID" = public.current_tenant_id())
  WITH CHECK ("TENANT_ID" = public.current_tenant_id());

-- ── PROJECT_STRUCTURE ────────────────────────────────────────
ALTER TABLE "PROJECT_STRUCTURE" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_isolation" ON "PROJECT_STRUCTURE";
CREATE POLICY "tenant_isolation" ON "PROJECT_STRUCTURE"
  USING  ("TENANT_ID" = public.current_tenant_id())
  WITH CHECK ("TENANT_ID" = public.current_tenant_id());

-- ── PROJECT_PROGRESS ─────────────────────────────────────────
ALTER TABLE "PROJECT_PROGRESS" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_isolation" ON "PROJECT_PROGRESS";
CREATE POLICY "tenant_isolation" ON "PROJECT_PROGRESS"
  USING  ("TENANT_ID" = public.current_tenant_id())
  WITH CHECK ("TENANT_ID" = public.current_tenant_id());

-- ── CONTRACT ─────────────────────────────────────────────────
ALTER TABLE "CONTRACT" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_isolation" ON "CONTRACT";
CREATE POLICY "tenant_isolation" ON "CONTRACT"
  USING  ("TENANT_ID" = public.current_tenant_id())
  WITH CHECK ("TENANT_ID" = public.current_tenant_id());

-- ── EMPLOYEE ─────────────────────────────────────────────────
ALTER TABLE "EMPLOYEE" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_isolation" ON "EMPLOYEE";
CREATE POLICY "tenant_isolation" ON "EMPLOYEE"
  USING  ("TENANT_ID" = public.current_tenant_id())
  WITH CHECK ("TENANT_ID" = public.current_tenant_id());

-- ── EMPLOYEE2PROJECT ─────────────────────────────────────────
ALTER TABLE "EMPLOYEE2PROJECT" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_isolation" ON "EMPLOYEE2PROJECT";
CREATE POLICY "tenant_isolation" ON "EMPLOYEE2PROJECT"
  USING  ("TENANT_ID" = public.current_tenant_id())
  WITH CHECK ("TENANT_ID" = public.current_tenant_id());

-- ── ADDRESS ──────────────────────────────────────────────────
ALTER TABLE "ADDRESS" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_isolation" ON "ADDRESS";
CREATE POLICY "tenant_isolation" ON "ADDRESS"
  USING  ("TENANT_ID" = public.current_tenant_id())
  WITH CHECK ("TENANT_ID" = public.current_tenant_id());

-- ── CONTACTS ─────────────────────────────────────────────────
ALTER TABLE "CONTACTS" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_isolation" ON "CONTACTS";
CREATE POLICY "tenant_isolation" ON "CONTACTS"
  USING  ("TENANT_ID" = public.current_tenant_id())
  WITH CHECK ("TENANT_ID" = public.current_tenant_id());

-- ── TEC (Buchungen) ──────────────────────────────────────────
ALTER TABLE "TEC" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_isolation" ON "TEC";
CREATE POLICY "tenant_isolation" ON "TEC"
  USING  ("TENANT_ID" = public.current_tenant_id())
  WITH CHECK ("TENANT_ID" = public.current_tenant_id());

-- ── INVOICE ──────────────────────────────────────────────────
ALTER TABLE "INVOICE" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_isolation" ON "INVOICE";
CREATE POLICY "tenant_isolation" ON "INVOICE"
  USING  ("TENANT_ID" = public.current_tenant_id())
  WITH CHECK ("TENANT_ID" = public.current_tenant_id());

-- ── INVOICE_STRUCTURE ────────────────────────────────────────
ALTER TABLE "INVOICE_STRUCTURE" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_isolation" ON "INVOICE_STRUCTURE";
CREATE POLICY "tenant_isolation" ON "INVOICE_STRUCTURE"
  USING  ("TENANT_ID" = public.current_tenant_id())
  WITH CHECK ("TENANT_ID" = public.current_tenant_id());

-- ── PARTIAL_PAYMENT ──────────────────────────────────────────
ALTER TABLE "PARTIAL_PAYMENT" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_isolation" ON "PARTIAL_PAYMENT";
CREATE POLICY "tenant_isolation" ON "PARTIAL_PAYMENT"
  USING  ("TENANT_ID" = public.current_tenant_id())
  WITH CHECK ("TENANT_ID" = public.current_tenant_id());

-- ── PARTIAL_PAYMENT_STRUCTURE ────────────────────────────────
ALTER TABLE "PARTIAL_PAYMENT_STRUCTURE" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_isolation" ON "PARTIAL_PAYMENT_STRUCTURE";
CREATE POLICY "tenant_isolation" ON "PARTIAL_PAYMENT_STRUCTURE"
  USING  ("TENANT_ID" = public.current_tenant_id())
  WITH CHECK ("TENANT_ID" = public.current_tenant_id());

-- ── PAYMENT ──────────────────────────────────────────────────
ALTER TABLE "PAYMENT" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_isolation" ON "PAYMENT";
CREATE POLICY "tenant_isolation" ON "PAYMENT"
  USING  ("TENANT_ID" = public.current_tenant_id())
  WITH CHECK ("TENANT_ID" = public.current_tenant_id());

-- ── FEE_CALCULATION_MASTER ───────────────────────────────────
ALTER TABLE "FEE_CALCULATION_MASTER" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_isolation" ON "FEE_CALCULATION_MASTER";
CREATE POLICY "tenant_isolation" ON "FEE_CALCULATION_MASTER"
  USING  ("TENANT_ID" = public.current_tenant_id())
  WITH CHECK ("TENANT_ID" = public.current_tenant_id());

-- ── FEE_CALCULATION_PHASE ────────────────────────────────────
ALTER TABLE "FEE_CALCULATION_PHASE" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_isolation" ON "FEE_CALCULATION_PHASE";
CREATE POLICY "tenant_isolation" ON "FEE_CALCULATION_PHASE"
  USING  ("TENANT_ID" = public.current_tenant_id())
  WITH CHECK ("TENANT_ID" = public.current_tenant_id());


-- ════════════════════════════════════════════════════════════
-- COMPANY-SCOPED TABLES  (COMPANY_ID → COMPANY.TENANT_ID)
-- ════════════════════════════════════════════════════════════

-- ── ASSET ────────────────────────────────────────────────────
ALTER TABLE "ASSET" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_isolation" ON "ASSET";
CREATE POLICY "tenant_isolation" ON "ASSET"
  USING (
    EXISTS (
      SELECT 1 FROM "COMPANY"
      WHERE "COMPANY"."ID" = "ASSET"."COMPANY_ID"
        AND "COMPANY"."TENANT_ID" = public.current_tenant_id()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM "COMPANY"
      WHERE "COMPANY"."ID" = "ASSET"."COMPANY_ID"
        AND "COMPANY"."TENANT_ID" = public.current_tenant_id()
    )
  );

-- ── DOCUMENT_TEMPLATE ────────────────────────────────────────
ALTER TABLE "DOCUMENT_TEMPLATE" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_isolation" ON "DOCUMENT_TEMPLATE";
CREATE POLICY "tenant_isolation" ON "DOCUMENT_TEMPLATE"
  USING (
    EXISTS (
      SELECT 1 FROM "COMPANY"
      WHERE "COMPANY"."ID" = "DOCUMENT_TEMPLATE"."COMPANY_ID"
        AND "COMPANY"."TENANT_ID" = public.current_tenant_id()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM "COMPANY"
      WHERE "COMPANY"."ID" = "DOCUMENT_TEMPLATE"."COMPANY_ID"
        AND "COMPANY"."TENANT_ID" = public.current_tenant_id()
    )
  );

-- ── DOCUMENT_NUMBER_RANGE ────────────────────────────────────
ALTER TABLE "DOCUMENT_NUMBER_RANGE" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_isolation" ON "DOCUMENT_NUMBER_RANGE";
CREATE POLICY "tenant_isolation" ON "DOCUMENT_NUMBER_RANGE"
  USING (
    EXISTS (
      SELECT 1 FROM "COMPANY"
      WHERE "COMPANY"."ID" = "DOCUMENT_NUMBER_RANGE"."COMPANY_ID"
        AND "COMPANY"."TENANT_ID" = public.current_tenant_id()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM "COMPANY"
      WHERE "COMPANY"."ID" = "DOCUMENT_NUMBER_RANGE"."COMPANY_ID"
        AND "COMPANY"."TENANT_ID" = public.current_tenant_id()
    )
  );


-- ════════════════════════════════════════════════════════════
-- GLOBAL LOOKUP TABLES  (no tenant ownership)
--
-- Enabling RLS with NO policies means:
--   • anon role         → 0 rows (blocked)
--   • authenticated role → 0 rows (blocked)
--   • service role      → all rows (bypasses RLS — backend unaffected)
--
-- This prevents anyone with only the anon key from reading
-- reference data directly via PostgREST.
-- ════════════════════════════════════════════════════════════

ALTER TABLE "GENDER"         ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SALUTATION"     ENABLE ROW LEVEL SECURITY;
ALTER TABLE "COUNTRY"        ENABLE ROW LEVEL SECURITY;
ALTER TABLE "BILLING_TYPE"   ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PROJECT_STATUS" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PROJECT_TYPE"   ENABLE ROW LEVEL SECURITY;
ALTER TABLE "FEE_GROUPS"     ENABLE ROW LEVEL SECURITY;
ALTER TABLE "FEE_MASTERS"    ENABLE ROW LEVEL SECURITY;
ALTER TABLE "FEE_PHASE"      ENABLE ROW LEVEL SECURITY;
ALTER TABLE "FEE_ZONES"      ENABLE ROW LEVEL SECURITY;
ALTER TABLE "VAT"            ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PAYMENT_MEANS"  ENABLE ROW LEVEL SECURITY;
