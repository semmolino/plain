-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 0064: RECENT_VIEW (Zuletzt verwendet)
-- ─────────────────────────────────────────────────────────────────────────────
-- Speichert je Mitarbeiter eine Liste der zuletzt geoeffneten Datensaetze.
-- Beim Klick auf ein Projekt, eine Rechnung etc. feuert das Frontend einen
-- POST /api/v1/recents Aufruf. Listen-Endpoints liefern dann pro Entity-Typ
-- die letzten n Eintraege fuer den eingeloggten User.
--
-- LABEL wird denormalisiert mitgespeichert (Projektnummer/Kurzname), damit
-- die Liste schnell rendern kann ohne JOINs auf alle Entity-Tabellen.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "RECENT_VIEW" (
  "ID"          SERIAL       PRIMARY KEY,
  "TENANT_ID"   INTEGER      NOT NULL,
  "EMPLOYEE_ID" INTEGER      NOT NULL,
  "ENTITY_TYPE" VARCHAR(40)  NOT NULL,        -- 'project' | 'invoice' | 'offer' | ...
  "ENTITY_ID"   INTEGER      NOT NULL,
  "LABEL"       VARCHAR(200),                  -- denormalisiert fuer schnelles Rendern
  "LAST_SEEN"   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  "VIEW_COUNT"  INTEGER      NOT NULL DEFAULT 1,
  UNIQUE ("TENANT_ID","EMPLOYEE_ID","ENTITY_TYPE","ENTITY_ID")
);

CREATE INDEX IF NOT EXISTS ix_recent_view_user_type_seen
  ON "RECENT_VIEW" ("TENANT_ID","EMPLOYEE_ID","ENTITY_TYPE","LAST_SEEN" DESC);
