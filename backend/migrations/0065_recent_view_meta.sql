-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 0065: RECENT_VIEW.META + neue Entity-Typen
-- ─────────────────────────────────────────────────────────────────────────────
-- Erweitert RECENT_VIEW um ein optionales META-Feld (JSONB), damit auch
-- Filter-Kombinationen (Reports, Mitarbeiter-Reports) und kontextabhaengige
-- Datensaetze (z.B. Strukturelement innerhalb eines Projekts) abgebildet
-- werden koennen.
--
-- Konventionen pro ENTITY_TYPE:
--   report_filter             META = { dateFrom, dateTo, filterMode, asOf,
--                                       abteilung, projektleiter, status }
--   mitarbeiter_report_filter META = { dateFrom, dateTo, ... }
--   project_structure         META = { project_id: <int> }    -- Filterung in der Liste
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE "RECENT_VIEW"
  ADD COLUMN IF NOT EXISTS "META" JSONB;

-- Index fuer Listenabfragen mit META-Filter (z.B. project_structure pro Projekt)
CREATE INDEX IF NOT EXISTS ix_recent_view_meta_project
  ON "RECENT_VIEW" ((("META"->>'project_id')::int))
  WHERE "META" IS NOT NULL;
