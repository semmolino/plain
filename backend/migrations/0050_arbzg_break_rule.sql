-- Migration 0050 — ArbZG Phase 1b: BREAK_RULE master data
--
-- Pausenregel-Stammdaten pro Tenant. Eine Regel definiert ab welcher
-- Arbeitsdauer wie viel Pflichtpause gilt.
--
-- ArbZG-Standard:
--   > 6 h Arbeit  →  30 min Pause   (§ 4 Abs. 1 ArbZG)
--   > 9 h Arbeit  →  45 min Pause   (§ 4 Abs. 1 ArbZG)
--   aufteilbar in Blöcke ≥ 15 min   (§ 4 Abs. 1 Satz 2 ArbZG)
--
-- JArbSchG (U18):
--   > 4,5 h Arbeit →  30 min Pause
--   > 6   h Arbeit →  60 min Pause

CREATE TABLE IF NOT EXISTS "BREAK_RULE" (
  "ID"              SERIAL PRIMARY KEY,
  "TENANT_ID"       INTEGER      NOT NULL,
  "NAME"            TEXT         NOT NULL,
  "T1_HOURS"        NUMERIC(4,2) NOT NULL DEFAULT 6,
  "T1_BREAK_MIN"    INTEGER      NOT NULL DEFAULT 30,
  "T2_HOURS"        NUMERIC(4,2) NOT NULL DEFAULT 9,
  "T2_BREAK_MIN"    INTEGER      NOT NULL DEFAULT 45,
  "MIN_BLOCK_MIN"   INTEGER      NOT NULL DEFAULT 15,
  "CREATED_AT"      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS "idx_break_rule_tenant"
  ON "BREAK_RULE" ("TENANT_ID");

-- Seed: für jeden bestehenden Tenant die beiden Standardregeln anlegen.
-- Idempotent dank NOT EXISTS-Check.
INSERT INTO "BREAK_RULE" ("TENANT_ID", "NAME", "T1_HOURS", "T1_BREAK_MIN", "T2_HOURS", "T2_BREAK_MIN", "MIN_BLOCK_MIN")
SELECT t."ID", 'ArbZG-Standard', 6, 30, 9, 45, 15
FROM "TENANT" t
WHERE NOT EXISTS (
  SELECT 1 FROM "BREAK_RULE" br
  WHERE br."TENANT_ID" = t."ID" AND br."NAME" = 'ArbZG-Standard'
);

INSERT INTO "BREAK_RULE" ("TENANT_ID", "NAME", "T1_HOURS", "T1_BREAK_MIN", "T2_HOURS", "T2_BREAK_MIN", "MIN_BLOCK_MIN")
SELECT t."ID", 'JArbSchG U18', 4.5, 30, 6, 60, 15
FROM "TENANT" t
WHERE NOT EXISTS (
  SELECT 1 FROM "BREAK_RULE" br
  WHERE br."TENANT_ID" = t."ID" AND br."NAME" = 'JArbSchG U18'
);
