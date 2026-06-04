-- Migration 0053 — Budget-Warnungen Phase 1: Datenmodell
--
-- Eine Regel = ein Schwellenwert auf einem Projekt ODER einer
-- Strukturposition. Mehrere Regeln pro Element möglich (gestaffelte
-- Schwellen wie 75 / 90 / 100 %).
--
-- "BUDGET_WARNING_FIRED" speichert pro Regel den jeweils aktuellen
-- "offenen Trigger" (RESET_AT IS NULL = noch nicht zurückgesetzt).
-- Solange ein offener Trigger existiert, wird die Regel NICHT erneut
-- ausgelöst — verhindert Spam. Sinkt der Verbrauch unter die Schwelle,
-- wird RESET_AT gesetzt; ein erneutes Überschreiten löst dann eine neue
-- Notification aus.
--
-- COOLDOWN_HOURS = 24 wird im Backend-Code hartcodiert (zusätzlicher
-- Schutz gegen Schwingungen — siehe services/budgetWarnings.js).

CREATE TABLE IF NOT EXISTS "BUDGET_WARNING_RULE" (
  "ID"             SERIAL PRIMARY KEY,
  "TENANT_ID"      INTEGER NOT NULL,
  "PROJECT_ID"     INTEGER REFERENCES "PROJECT"("ID") ON DELETE CASCADE,
  "STRUCTURE_ID"   INTEGER REFERENCES "PROJECT_STRUCTURE"("ID") ON DELETE CASCADE,
  "THRESHOLD_PCT"  DECIMAL(5,2) NOT NULL,
  "NOTIFY_PM"      BOOLEAN NOT NULL DEFAULT TRUE,
  "NOTIFY_BOOKER"  BOOLEAN NOT NULL DEFAULT TRUE,
  "NOTIFY_CC"      INTEGER[],
  "MUTED"          BOOLEAN NOT NULL DEFAULT FALSE,
  "CREATED_AT"     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "CREATED_BY"     INTEGER REFERENCES "EMPLOYEE"("ID"),
  CONSTRAINT chk_bw_rule_scope CHECK (
    ("PROJECT_ID" IS NOT NULL AND "STRUCTURE_ID" IS NULL) OR
    ("PROJECT_ID" IS NULL     AND "STRUCTURE_ID" IS NOT NULL)
  ),
  CONSTRAINT chk_bw_rule_pct CHECK (
    "THRESHOLD_PCT" > 0 AND "THRESHOLD_PCT" <= 500
  )
);
CREATE INDEX IF NOT EXISTS "idx_bw_rule_project"   ON "BUDGET_WARNING_RULE" ("PROJECT_ID");
CREATE INDEX IF NOT EXISTS "idx_bw_rule_structure" ON "BUDGET_WARNING_RULE" ("STRUCTURE_ID");
CREATE INDEX IF NOT EXISTS "idx_bw_rule_tenant"    ON "BUDGET_WARNING_RULE" ("TENANT_ID");

CREATE TABLE IF NOT EXISTS "BUDGET_WARNING_FIRED" (
  "ID"             SERIAL PRIMARY KEY,
  "RULE_ID"        INTEGER NOT NULL REFERENCES "BUDGET_WARNING_RULE"("ID") ON DELETE CASCADE,
  "FIRED_AT"       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "BUDGET_EUR"     NUMERIC(14,2) NOT NULL,
  "ACTUAL_EUR"     NUMERIC(14,2) NOT NULL,
  "TRIGGER_TEC_ID" INTEGER,
  "RESET_AT"       TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS "idx_bw_fired_rule"  ON "BUDGET_WARNING_FIRED" ("RULE_ID");
-- Pro Regel darf nur EIN offener Trigger (RESET_AT IS NULL) existieren —
-- partial unique index sichert das auf DB-Ebene ab und vereinfacht die
-- Anwendungs-Logik.
CREATE UNIQUE INDEX IF NOT EXISTS "uq_bw_fired_open_per_rule"
  ON "BUDGET_WARNING_FIRED" ("RULE_ID")
  WHERE "RESET_AT" IS NULL;

-- Stumm-Schalter auf Projekt-Ebene (unterdrückt alle Notifications dieses
-- Projekts; Tracking läuft weiter und ist im Projekt-Tab sichtbar).
ALTER TABLE "PROJECT"
  ADD COLUMN IF NOT EXISTS "BUDGET_WARNINGS_MUTED" BOOLEAN NOT NULL DEFAULT FALSE;
