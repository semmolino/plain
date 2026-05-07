-- Migration 0022: Make PROJECT_STATUS a global (tenant-independent) lookup table
--
-- Remove tenant scoping so all tenants share the same status list.

-- Drop RLS policy and disable RLS
DROP POLICY IF EXISTS "tenant_isolation" ON public."PROJECT_STATUS";
ALTER TABLE public."PROJECT_STATUS" DISABLE ROW LEVEL SECURITY;

-- Remove the TENANT_ID column
ALTER TABLE public."PROJECT_STATUS" DROP COLUMN IF EXISTS "TENANT_ID";
