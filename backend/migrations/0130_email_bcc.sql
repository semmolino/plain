-- Migration 0130: BCC-Kopie fuer den Belegversand
-- Run manually in Supabase SQL editor
--
-- Rechnungen/Mahnungen verlassen plan&simple ueber den zentralen Mailserver
-- (PLATFORM_EMAIL_SETTINGS) — nicht ueber das Postfach des Mandanten. Deshalb
-- liegt dort auch keine Kopie im Ordner "Gesendet". BCC_TO schliesst die Luecke:
-- ist eine Adresse hinterlegt, geht jede versendete Rechnung, Abschlags- und
-- Stornorechnung sowie jede Mahnung zusaetzlich als Blindkopie dorthin.
--
-- Bewusst genau EINE Adresse (kein Verteiler): jede weitere Adresse ist eine
-- weitere Stelle, an der Kundenbelege landen.
ALTER TABLE "TENANT_EMAIL_SETTINGS"
  ADD COLUMN IF NOT EXISTS "BCC_TO" TEXT;

COMMENT ON COLUMN "TENANT_EMAIL_SETTINGS"."BCC_TO" IS
  'Optionale Blindkopie-Adresse fuer den Belegversand (Rechnungen, Mahnungen). NULL = keine Kopie.';
