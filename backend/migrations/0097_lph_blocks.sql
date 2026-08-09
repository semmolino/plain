-- Migration 0097: Leistungsphasen-Blöcke (konfigurierbar je Leistungsbild)
--
-- Ein "Block" gruppiert mehrere HOAI-Leistungsphasen zu einer wirtschaftlich
-- sinnvollen Einheit (z. B. „Planung" = LPH 1–4). Das Schema wird PRO
-- Leistungsbild (FEE_MASTERS) gepflegt, weil verschiedene Leistungsbilder
-- unterschiedliche Phasenschnitte haben und künftige Kalkulationstypen davon
-- abweichen können.
--
-- WICHTIG (Mandantentrennung): FEE_PHASE ist eine GLOBALE HOAI-Referenztabelle
-- (keine TENANT_ID, für alle Mandanten dieselben Zeilen). Die Phase→Block-
-- Zuordnung darf deshalb NICHT als Spalte auf FEE_PHASE liegen — sonst würde
-- Mandant B die Zuordnung von Mandant A überschreiben. Sie liegt daher in einer
-- eigenen, mandantengetrennten Zuordnungstabelle LPH_BLOCK_PHASE.
--
-- Manuell im Supabase SQL-Editor ausführen (wie alle Migrations).

CREATE TABLE IF NOT EXISTS "LPH_BLOCK" (
  "ID"            SERIAL PRIMARY KEY,
  "TENANT_ID"     INTEGER NOT NULL,
  "FEE_MASTER_ID" INTEGER NOT NULL REFERENCES "FEE_MASTERS"("ID") ON DELETE CASCADE,
  "NAME_SHORT"    VARCHAR(100) NOT NULL,
  "SORT_ORDER"    INTEGER NOT NULL DEFAULT 0,
  "created_at"    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS "idx_lph_block_master"
  ON "LPH_BLOCK" ("TENANT_ID", "FEE_MASTER_ID");

-- Mandantengetrennte Zuordnung Phase → Block. Eine Phase gehört je Mandant zu
-- höchstens einem Block.
CREATE TABLE IF NOT EXISTS "LPH_BLOCK_PHASE" (
  "ID"           SERIAL PRIMARY KEY,
  "TENANT_ID"    INTEGER NOT NULL,
  "BLOCK_ID"     INTEGER NOT NULL REFERENCES "LPH_BLOCK"("ID") ON DELETE CASCADE,
  "FEE_PHASE_ID" INTEGER NOT NULL,
  "created_at"   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE ("TENANT_ID", "FEE_PHASE_ID")
);

CREATE INDEX IF NOT EXISTS "idx_lph_block_phase_tenant"
  ON "LPH_BLOCK_PHASE" ("TENANT_ID", "FEE_PHASE_ID");

-- Falls eine frühere Fassung dieser Migration die Spalte auf FEE_PHASE angelegt
-- hat: entfernen (die globale Spalte war mandantenübergreifend fehlerhaft).
ALTER TABLE "FEE_PHASE" DROP COLUMN IF EXISTS "BLOCK_ID";

-- RLS (Defense-in-Depth wie bei allen Mandanten-Tabellen; App filtert ohnehin
-- per TENANT_ID, der Service-Role-Key umgeht RLS).
ALTER TABLE "LPH_BLOCK" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_isolation" ON "LPH_BLOCK";
CREATE POLICY "tenant_isolation" ON "LPH_BLOCK"
  USING  ("TENANT_ID" = public.current_tenant_id())
  WITH CHECK ("TENANT_ID" = public.current_tenant_id());

ALTER TABLE "LPH_BLOCK_PHASE" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_isolation" ON "LPH_BLOCK_PHASE";
CREATE POLICY "tenant_isolation" ON "LPH_BLOCK_PHASE"
  USING  ("TENANT_ID" = public.current_tenant_id())
  WITH CHECK ("TENANT_ID" = public.current_tenant_id());
