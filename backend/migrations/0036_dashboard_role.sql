-- Add DASHBOARD_ROLE column to EMPLOYEE
-- Values: 'geschaeftsleitung' | 'controller' | 'bereichsleiter' | NULL (= user picks on first login)
ALTER TABLE "EMPLOYEE"
  ADD COLUMN IF NOT EXISTS "DASHBOARD_ROLE" TEXT DEFAULT NULL;
