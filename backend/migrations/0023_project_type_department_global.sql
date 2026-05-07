-- Migration 0023: Make PROJECT_TYPE and DEPARTMENT global lookup tables
--
-- Remove tenant scoping so all tenants share the same type and department lists.

-- PROJECT_TYPE
DROP POLICY IF EXISTS "tenant_isolation" ON public."PROJECT_TYPE";
ALTER TABLE public."PROJECT_TYPE" DISABLE ROW LEVEL SECURITY;
ALTER TABLE public."PROJECT_TYPE" DROP COLUMN IF EXISTS "TENANT_ID";

-- DEPARTMENT
DROP POLICY IF EXISTS "tenant_isolation" ON public."DEPARTMENT";
ALTER TABLE public."DEPARTMENT" DISABLE ROW LEVEL SECURITY;
ALTER TABLE public."DEPARTMENT" DROP COLUMN IF EXISTS "TENANT_ID";
