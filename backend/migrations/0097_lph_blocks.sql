-- Migration 0097: Leistungsphasen-Blöcke (konfigurierbar je Leistungsbild)
--
-- Ein "Block" gruppiert mehrere HOAI-Leistungsphasen zu einer wirtschaftlich
-- sinnvollen Einheit (z. B. „Planung" = LPH 1–4). Das Schema wird PRO
-- Leistungsbild (FEE_MASTERS) gepflegt, weil verschiedene Leistungsbilder
-- unterschiedliche Phasenschnitte haben und künftige Kalkulationstypen davon
-- abweichen können.
--
-- Da FEE_PHASE (Phasen-Katalog) bereits pro Leistungsbild geführt wird
-- (FEE_PHASE.FEE_MASTER_ID), genügt eine BLOCK_ID-Spalte auf FEE_PHASE für die
-- Zuordnung Phase → Block. Eine Phase gehört zu höchstens einem Block.
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

-- Zuordnung Phase → Block. NULL = keinem Block zugeordnet ("Weitere Phasen").
ALTER TABLE "FEE_PHASE"
  ADD COLUMN IF NOT EXISTS "BLOCK_ID" INTEGER REFERENCES "LPH_BLOCK"("ID") ON DELETE SET NULL;

-- RLS (Defense-in-Depth wie bei allen Mandanten-Tabellen; App filtert
-- ohnehin per TENANT_ID, der Service-Role-Key umgeht RLS).
ALTER TABLE "LPH_BLOCK" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_isolation" ON "LPH_BLOCK";
CREATE POLICY "tenant_isolation" ON "LPH_BLOCK"
  USING  ("TENANT_ID" = public.current_tenant_id())
  WITH CHECK ("TENANT_ID" = public.current_tenant_id());
