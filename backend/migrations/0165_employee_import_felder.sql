-- ============================================================================
-- Migration 0165: Mitarbeiter — Geburtstag, Notiz, Vorgesetzter
--                 + Stapel-Kennung auf den Nebentabellen des Imports
--
-- TEIL 1 — drei neue Felder am Mitarbeiter
--   Geburtstag, Notiz und Vorgesetzter kommen aus der Alt-Datenuebernahme
--   (wiko). Telefon war ebenfalls angefragt, ist aber laengst da:
--   EMPLOYEE.PHONE existiert seit der Supabase-Zeit und wurde vom Import nur
--   nie befuellt — im Formular hiess das eine Feld "Telefon/Mobil" und
--   schrieb nach MOBILE.
--
--   SUPERVISOR_ID zeigt auf EMPLOYEE selbst. ON DELETE SET NULL, nicht
--   CASCADE: scheidet ein Vorgesetzter aus, verlieren seine Leute ihre
--   Zuordnung — aber nicht ihren Datensatz.
--
-- TEIL 2 — IMPORT_BATCH_ID auf vier Nebentabellen
--   Der Mitarbeiter-Import schreibt ab sofort mehr als eine Zeile je Person:
--   Kostensatz, Arbeitszeitmodell-Zuordnung, Berechtigungsrolle und ggf. eine
--   neu angelegte Abteilung. Ohne Stapel-Kennung waere davon nichts
--   zuruecknehmbar.
--
--   Warum nicht einfach "alles loeschen, was am importierten Mitarbeiter
--   haengt": beim Zusammenfuehren aktualisiert der Import BESTEHENDE
--   Mitarbeiter. Deren Kostensatz-Historie ist aelter als der Stapel und darf
--   beim Zuruecksetzen nicht verschwinden. Die Kennung unterscheidet genau
--   das — sie steht nur an dem, was DIESER Lauf angelegt hat.
--
-- Reines DDL, kein Mandanten-Claim noetig. Die vier Tabellen tragen ihre
-- RLS-Policies bereits (EMPLOYEE_ROLE ueber den Elternsatz, Migration 0160);
-- eine zusaetzliche Spalte aendert daran nichts.
-- ============================================================================

-- ── Teil 1 ──────────────────────────────────────────────────────────────────
ALTER TABLE "EMPLOYEE" ADD COLUMN IF NOT EXISTS "BIRTH_DATE"    DATE;
ALTER TABLE "EMPLOYEE" ADD COLUMN IF NOT EXISTS "NOTES"         TEXT;
ALTER TABLE "EMPLOYEE" ADD COLUMN IF NOT EXISTS "SUPERVISOR_ID" BIGINT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'EMPLOYEE_SUPERVISOR_ID_fkey' AND conrelid = '"EMPLOYEE"'::regclass
  ) THEN
    ALTER TABLE "EMPLOYEE"
      ADD CONSTRAINT "EMPLOYEE_SUPERVISOR_ID_fkey"
      FOREIGN KEY ("SUPERVISOR_ID") REFERENCES "EMPLOYEE"("ID") ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_employee_supervisor ON "EMPLOYEE"("SUPERVISOR_ID");

COMMENT ON COLUMN "EMPLOYEE"."BIRTH_DATE"    IS 'Geburtstag (optional).';
COMMENT ON COLUMN "EMPLOYEE"."NOTES"         IS 'Freitext-Notiz zum Mitarbeiter (optional).';
COMMENT ON COLUMN "EMPLOYEE"."SUPERVISOR_ID" IS 'Vorgesetzter — verweist auf einen anderen EMPLOYEE desselben Mandanten.';

-- ── Teil 2 ──────────────────────────────────────────────────────────────────
ALTER TABLE "EMPLOYEE_COST_RATE" ADD COLUMN IF NOT EXISTS "IMPORT_BATCH_ID" INTEGER;
ALTER TABLE "EMPLOYEE_WORK_MODEL" ADD COLUMN IF NOT EXISTS "IMPORT_BATCH_ID" INTEGER;
ALTER TABLE "EMPLOYEE_ROLE"      ADD COLUMN IF NOT EXISTS "IMPORT_BATCH_ID" INTEGER;
ALTER TABLE "DEPARTMENT"         ADD COLUMN IF NOT EXISTS "IMPORT_BATCH_ID" INTEGER;

CREATE INDEX IF NOT EXISTS idx_employee_cost_rate_batch  ON "EMPLOYEE_COST_RATE"("IMPORT_BATCH_ID");
CREATE INDEX IF NOT EXISTS idx_employee_work_model_batch ON "EMPLOYEE_WORK_MODEL"("IMPORT_BATCH_ID");
CREATE INDEX IF NOT EXISTS idx_employee_role_batch       ON "EMPLOYEE_ROLE"("IMPORT_BATCH_ID");
CREATE INDEX IF NOT EXISTS idx_department_batch          ON "DEPARTMENT"("IMPORT_BATCH_ID");
