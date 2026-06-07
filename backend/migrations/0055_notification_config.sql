-- Migration 0055 — Notification-Konfiguration
--
-- Zwei Tabellen:
--   NOTIFICATION_TYPE         Katalog (tenant-uebergreifend, per Migration befuellt)
--   NOTIFICATION_TYPE_CONFIG  Tenant-Override pro Typ
--
-- Empfaenger-Modell (Mixed / OR):
--   ALL_TENANT                 -- jeder Mitarbeiter erhaelt
--   AUDIENCE_ROLES TEXT[]      -- DASHBOARD_ROLE-Werte (z.B. {'geschaeftsleitung','controller'})
--   AUDIENCE_DEPARTMENTS INT[] -- DEPARTMENT.ID Werte
--   AUDIENCE_EMPLOYEES   INT[] -- EMPLOYEE.ID Werte
--   (alle OR-verknuepft; AUDIENCE_USE_DEFAULT=true ignoriert die Listen und nutzt
--    DEFAULT_AUDIENCE_KIND aus NOTIFICATION_TYPE — heute meist 'tenant_wide')
--
-- Existierende Notifications werden nicht angetastet — nur ab jetzt greift's.

-- ── Catalog ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "NOTIFICATION_TYPE" (
  "TYPE_KEY"                     TEXT PRIMARY KEY,
  "CATEGORY"                     TEXT NOT NULL,
  "TITLE_DE"                     TEXT NOT NULL,
  "DESCRIPTION_DE"               TEXT,
  "DEFAULT_ENABLED"              BOOLEAN NOT NULL DEFAULT TRUE,
  -- Wenn keine Tenant-Konfig + AUDIENCE_USE_DEFAULT=true: was tut der Code?
  -- 'tenant_wide'      -> alle Mitarbeiter (USER_ID = NULL)
  -- 'managed_by_rule'  -> Empfaenger werden pro Regel/Datensatz aufgeloest
  --                        (z.B. budget_warning: PM/Booker/CC kommen aus BUDGET_WARNING_RULE)
  "DEFAULT_AUDIENCE_KIND"        TEXT NOT NULL DEFAULT 'tenant_wide',
  -- Manche Typen lassen den Admin gar nicht ueber Empfaenger entscheiden,
  -- weil sie pro Datensatz konfiguriert werden (Budget-Regel). Dann nur ein/aus.
  "SUPPORTS_AUDIENCE_OVERRIDE"   BOOLEAN NOT NULL DEFAULT TRUE,
  "SORT_ORDER"                   INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT chk_default_audience_kind
    CHECK ("DEFAULT_AUDIENCE_KIND" IN ('tenant_wide', 'managed_by_rule'))
);

-- ── Per-Tenant Override ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "NOTIFICATION_TYPE_CONFIG" (
  "ID"                    SERIAL PRIMARY KEY,
  "TENANT_ID"             INTEGER NOT NULL,
  "TYPE_KEY"              TEXT NOT NULL REFERENCES "NOTIFICATION_TYPE"("TYPE_KEY") ON DELETE CASCADE,
  "ENABLED"               BOOLEAN NOT NULL DEFAULT TRUE,
  -- Bei true: Listen ignorieren, DEFAULT_AUDIENCE_KIND des Typs nutzen
  "AUDIENCE_USE_DEFAULT"  BOOLEAN NOT NULL DEFAULT TRUE,
  -- Bei AUDIENCE_USE_DEFAULT=false: OR-verknuepfte Listen
  "AUDIENCE_ALL_TENANT"   BOOLEAN NOT NULL DEFAULT FALSE,
  "AUDIENCE_ROLES"        TEXT[],
  "AUDIENCE_DEPARTMENTS"  INTEGER[],
  "AUDIENCE_EMPLOYEES"    INTEGER[],
  "CREATED_AT"            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "UPDATED_AT"            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "UPDATED_BY"            INTEGER REFERENCES "EMPLOYEE"("ID"),
  CONSTRAINT uq_notif_cfg UNIQUE ("TENANT_ID", "TYPE_KEY")
);
CREATE INDEX IF NOT EXISTS idx_notif_cfg_tenant ON "NOTIFICATION_TYPE_CONFIG"("TENANT_ID");

-- ── Seed der bestehenden Typen ─────────────────────────────────────────────
-- Konsolidierte Keys: invoice_due_*, invoice_overdue_*, mahnung_due
-- werden je zu EINEM Typ — die Tage stehen im Metadata-Feld der NOTIFICATION.

INSERT INTO "NOTIFICATION_TYPE"
  ("TYPE_KEY", "CATEGORY", "TITLE_DE", "DESCRIPTION_DE", "DEFAULT_ENABLED", "DEFAULT_AUDIENCE_KIND", "SUPPORTS_AUDIENCE_OVERRIDE", "SORT_ORDER")
VALUES
  ('invoice_due',      'invoice', 'Rechnung wird faellig',
   'Erinnerung 7 / 3 / 1 Tag(e) vor Faelligkeitsdatum gebuchter Rechnungen.',
   TRUE, 'tenant_wide', TRUE, 10),

  ('invoice_overdue',  'invoice', 'Rechnung ueberfaellig',
   'Hinweis 1 / 7 / 14 Tage nach Faelligkeitsdatum, sofern noch nicht bezahlt.',
   TRUE, 'tenant_wide', TRUE, 20),

  ('mahnung_due',      'mahnung', 'Mahnung faellig',
   'Naechste Mahnstufe ist faellig — taegliche Pruefung.',
   TRUE, 'tenant_wide', TRUE, 30),

  ('budget_warning',   'budget',  'Budget-Warnung',
   'Eine Schwellwert-Regel im Projekt-Tab "Budget" wurde ueberschritten. Empfaenger werden pro Regel (PL/Verursacher/CC) konfiguriert.',
   TRUE, 'managed_by_rule', FALSE, 40),

  ('monatsabschluss',  'system',  'Monatsabschluss erstellt',
   'Periodische Monatsabschluss-Snapshots wurden generiert.',
   TRUE, 'tenant_wide', TRUE, 50)
ON CONFLICT ("TYPE_KEY") DO NOTHING;
