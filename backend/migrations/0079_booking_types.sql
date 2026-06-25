-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 0079: Sonstige Buchungsarten — Pauschalen & Stückleistungen
-- ─────────────────────────────────────────────────────────────────────────────
-- Bisher waren TEC-Buchungen stundenbasiert (BOOKING/ENTRY_KIND 'WORK'/'BREAK').
-- Diese Migration erweitert TEC um nicht-stundenbasierte Buchungsarten und legt
-- einen tenant-weiten Katalog vordefinierter Buchungsarten an (Pendant zur
-- HOAI-ROLLE mit Stundensätzen):
--
--   BOOKING_KIND-Werte auf TEC:
--     'WORK'          Stunden (bestehend, Default)
--     'BREAK'         Pause   (bestehend, kostenneutral)
--     'UNIT'          Stückleistung  (Menge × Stückpreis, optional × Stückkosten)
--     'LUMP_COST'     Kosten-Pauschale   (Summe → COSTS, z. B. Lieferantenrechnung)
--     'LUMP_REVENUE'  Erlös-Pauschale    (Summe → abrechenbarer Erlös)
--
-- Rollup bleibt unverändert (recomputeStructure):
--   COSTS   = Σ(QUANTITY_INT × CP_RATE)   → LUMP_COST: QTY_INT=1, CP_RATE=Summe
--   REVENUE = Σ(SP_TOT)        (nur BT=2) → LUMP_REVENUE: SP_TOT=Summe
--   UNIT trägt beide Seiten (QTY × CP_RATE bzw. QTY × SP_RATE).
--
-- WICHTIG: Stundenauswertungen (Saldo, Produktivität, ArbZG) zählen nur
-- 'WORK'/'BREAK' — die neuen Arten werden im Code herausgefiltert.
-- Manuell im Supabase SQL-Editor ausführen.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. TEC erweitern ────────────────────────────────────────────────────────
ALTER TABLE "TEC" ADD COLUMN IF NOT EXISTS "BOOKING_KIND"    TEXT DEFAULT 'WORK';
ALTER TABLE "TEC" ADD COLUMN IF NOT EXISTS "UNIT_LABEL"      TEXT;
ALTER TABLE "TEC" ADD COLUMN IF NOT EXISTS "BOOKING_TYPE_ID" INTEGER;

-- Bestandszeilen sind Stunden bzw. Pausen → explizit 'WORK' (ENTRY_KIND='BREAK'
-- wird unten gespiegelt, falls die Spalte existiert).
UPDATE "TEC" SET "BOOKING_KIND" = 'WORK' WHERE "BOOKING_KIND" IS NULL;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'TEC' AND column_name = 'ENTRY_KIND'
  ) THEN
    UPDATE "TEC" SET "BOOKING_KIND" = 'BREAK' WHERE "ENTRY_KIND" = 'BREAK';
  END IF;
END $$;

-- ── 2. Katalog der Buchungsarten (BOOKING_TYPE) ─────────────────────────────
-- SCOPE: 'global' (tenant-weit, Admin) | 'project' (nur in einem Projekt).
-- Mitarbeiter-individueller Scope folgt in einer späteren Phase.
CREATE TABLE IF NOT EXISTS "BOOKING_TYPE" (
  "ID"              SERIAL PRIMARY KEY,
  "TENANT_ID"       INTEGER NOT NULL,
  "KIND"            TEXT    NOT NULL,             -- 'UNIT' | 'LUMP_COST' | 'LUMP_REVENUE'
  "NAME_SHORT"      TEXT    NOT NULL,
  "NAME_LONG"       TEXT,
  "UNIT_LABEL"      TEXT,                         -- z. B. 'Stk', 'm²' (nur UNIT)
  "UNIT_CODE"       TEXT,                         -- UN/ECE-Maßeinheit für E-Rechnung (z. B. 'C62', 'MTK')
  "DEFAULT_SP_RATE" NUMERIC,                      -- Standard-Verkaufspreis (UNIT: je Einheit; LUMP_REVENUE: Summe)
  "DEFAULT_CP_RATE" NUMERIC,                      -- Standard-Kostenpreis  (UNIT: je Einheit; LUMP_COST: Summe)
  "SCOPE"           TEXT    NOT NULL DEFAULT 'global',
  "PROJECT_ID"      INTEGER,                      -- gesetzt nur bei SCOPE='project'
  "ACTIVE"          INTEGER NOT NULL DEFAULT 1,
  "SORT_ORDER"      INTEGER DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_booking_type_tenant  ON "BOOKING_TYPE"("TENANT_ID");
CREATE INDEX IF NOT EXISTS idx_booking_type_project ON "BOOKING_TYPE"("PROJECT_ID");

-- ── 3. Permissions ──────────────────────────────────────────────────────────
INSERT INTO "PERMISSION" ("KEY", "MODULE", "ACTION", "LABEL_DE", "DESCRIPTION_DE", "CATEGORY", "POSITION") VALUES
('projects.bookings.special.create', 'projects', 'create', 'Pauschalen & Stückleistungen buchen', 'Nicht-stundenbasierte Buchungen (Pauschalen, Stückleistungen) anlegen', 'editing', 234),
('settings.booking_types.edit',      'settings', 'edit',   'Buchungsarten verwalten',             'Katalog der Pauschalen-/Stückleistungs-Buchungsarten pflegen',         'editing', 766)
ON CONFLICT ("KEY") DO UPDATE SET
  "LABEL_DE"       = EXCLUDED."LABEL_DE",
  "DESCRIPTION_DE" = EXCLUDED."DESCRIPTION_DE",
  "MODULE"         = EXCLUDED."MODULE",
  "ACTION"         = EXCLUDED."ACTION",
  "CATEGORY"       = EXCLUDED."CATEGORY",
  "POSITION"       = EXCLUDED."POSITION";

-- ── 4. Default-Zuweisungen ──────────────────────────────────────────────────
DO $$
DECLARE
  perm_special INT;
  perm_catalog INT;
BEGIN
  SELECT "ID" INTO perm_special FROM "PERMISSION" WHERE "KEY" = 'projects.bookings.special.create';
  SELECT "ID" INTO perm_catalog FROM "PERMISSION" WHERE "KEY" = 'settings.booking_types.edit';

  -- Pauschalen/Stück buchen: jede Rolle, die schon normale Buchungen anlegen darf.
  INSERT INTO "ROLE_PERMISSION" ("ROLE_ID","PERMISSION_ID")
    SELECT rp."ROLE_ID", perm_special
    FROM "ROLE_PERMISSION" rp
    JOIN "PERMISSION" p ON p."ID" = rp."PERMISSION_ID"
    WHERE p."KEY" = 'projects.bookings.create'
  ON CONFLICT DO NOTHING;

  -- Katalog pflegen: jede Rolle, die schon Stammdaten pflegen darf.
  INSERT INTO "ROLE_PERMISSION" ("ROLE_ID","PERMISSION_ID")
    SELECT rp."ROLE_ID", perm_catalog
    FROM "ROLE_PERMISSION" rp
    JOIN "PERMISSION" p ON p."ID" = rp."PERMISSION_ID"
    WHERE p."KEY" = 'settings.basedata.edit'
  ON CONFLICT DO NOTHING;
END $$;
