-- Migration 0027: Make OFFER_STATUS a global (tenant-independent) lookup table
--
-- Follows the same pattern as 0022_project_status_global.sql.
-- All tenants share one list of offer statuses; tenants can no longer add/delete them.

-- Drop RLS policy and disable RLS
DROP POLICY IF EXISTS "tenant_isolation" ON public."OFFER_STATUS";
ALTER TABLE public."OFFER_STATUS" DISABLE ROW LEVEL SECURITY;

-- Remove the TENANT_ID column
ALTER TABLE public."OFFER_STATUS" DROP COLUMN IF EXISTS "TENANT_ID";

-- Insert the four standard statuses if the table is empty
INSERT INTO public."OFFER_STATUS" ("NAME_SHORT")
SELECT name FROM (VALUES
  ('In Bearbeitung'),
  ('Versendet'),
  ('Abgebrochen'),
  ('Abgelehnt')
) AS t(name)
WHERE NOT EXISTS (SELECT 1 FROM public."OFFER_STATUS");
