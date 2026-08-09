-- Migration 0098: DIN-276-Kostenermittlung (Grundlage anrechenbare Baukosten)
--
-- Eine Kostenermittlung haelt die Baukosten je DIN-276-Kostengruppe. Daraus
-- werden ueber leistungsbildspezifische Regeln (§ 33 Gebaeude usw.) die
-- anrechenbaren Kosten fuer die HOAI-Honorarberechnung abgeleitet.
--
-- Konzept: docs/DIN276_ANRECHENBARE_KOSTEN_CONCEPT.md
-- Manuell im Supabase SQL-Editor ausfuehren (wie alle Migrations).

CREATE TABLE IF NOT EXISTS "DIN276_COST_ESTIMATE" (
  "ID"                             SERIAL PRIMARY KEY,
  "TENANT_ID"                      INTEGER NOT NULL,
  "PROJECT_ID"                     INTEGER REFERENCES "PROJECT"("ID") ON DELETE CASCADE,
  "OFFER_ID"                       INTEGER REFERENCES "OFFER"("ID")   ON DELETE CASCADE,
  "NAME_SHORT"                     VARCHAR(100),
  "NAME_LONG"                      VARCHAR(500),
  "STAGE"                          TEXT NOT NULL DEFAULT 'berechnung',   -- 'schaetzung' | 'berechnung'
  "DIN_VERSION"                    TEXT NOT NULL DEFAULT '2008-12',      -- maßgeblich fuer HOAI § 4
  "STATUS"                         TEXT NOT NULL DEFAULT 'draft',        -- 'draft' | 'final'
  "MITVERARBEITETE_BAUSUBSTANZ"    DECIMAL(14,2) NOT NULL DEFAULT 0,     -- § 4 Abs. 3 HOAI
  "created_at"                     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS "idx_din276_estimate_project"
  ON "DIN276_COST_ESTIMATE" ("TENANT_ID", "PROJECT_ID");
CREATE INDEX IF NOT EXISTS "idx_din276_estimate_offer"
  ON "DIN276_COST_ESTIMATE" ("TENANT_ID", "OFFER_ID");

CREATE TABLE IF NOT EXISTS "DIN276_COST_GROUP" (
  "ID"               SERIAL PRIMARY KEY,
  "TENANT_ID"        INTEGER NOT NULL,
  "ESTIMATE_ID"      INTEGER NOT NULL REFERENCES "DIN276_COST_ESTIMATE"("ID") ON DELETE CASCADE,
  "KG_CODE"          VARCHAR(10) NOT NULL,          -- '300', '410' … (1. oder 2. Ebene)
  "LABEL"            VARCHAR(200),
  "AMOUNT"           DECIMAL(14,2) NOT NULL DEFAULT 0,
  "IS_PLANNED_SELF"  BOOLEAN NOT NULL DEFAULT FALSE, -- vom AN fachlich geplant/ueberwacht (KG 200/400/600)
  "SORT_ORDER"       INTEGER NOT NULL DEFAULT 0,
  "created_at"       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS "idx_din276_group_estimate"
  ON "DIN276_COST_GROUP" ("TENANT_ID", "ESTIMATE_ID");

-- RLS (Defense-in-Depth wie bei allen Mandanten-Tabellen).
ALTER TABLE "DIN276_COST_ESTIMATE" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_isolation" ON "DIN276_COST_ESTIMATE";
CREATE POLICY "tenant_isolation" ON "DIN276_COST_ESTIMATE"
  USING  ("TENANT_ID" = public.current_tenant_id())
  WITH CHECK ("TENANT_ID" = public.current_tenant_id());

ALTER TABLE "DIN276_COST_GROUP" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_isolation" ON "DIN276_COST_GROUP";
CREATE POLICY "tenant_isolation" ON "DIN276_COST_GROUP"
  USING  ("TENANT_ID" = public.current_tenant_id())
  WITH CHECK ("TENANT_ID" = public.current_tenant_id());
