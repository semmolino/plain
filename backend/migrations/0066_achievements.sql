-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 0066: Achievements (Engagement Phase 3)
-- ─────────────────────────────────────────────────────────────────────────────
-- ACHIEVEMENT          Katalog (System-weit, seedbar via Migration)
-- USER_ACHIEVEMENT     pro Mitarbeiter erfuellte Achievements (EARNED_AT)
--
-- Achievements sind STRIKT PRIVAT pro User -- nichts ist tenant-uebergreifend
-- sichtbar. Backend prueft Permission "own data implicit".
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "ACHIEVEMENT" (
  "ID"          SERIAL       PRIMARY KEY,
  "KEY"         VARCHAR(60)  UNIQUE NOT NULL,
  "TITLE"       VARCHAR(120) NOT NULL,
  "DESCRIPTION" TEXT,
  "CATEGORY"    VARCHAR(40),
  "POSITION"    INTEGER      NOT NULL DEFAULT 0,
  "ACTIVE"      BOOLEAN      NOT NULL DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS "USER_ACHIEVEMENT" (
  "ID"              SERIAL       PRIMARY KEY,
  "TENANT_ID"       INTEGER      NOT NULL,
  "EMPLOYEE_ID"     INTEGER      NOT NULL,
  "ACHIEVEMENT_KEY" VARCHAR(60)  NOT NULL,
  "EARNED_AT"       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  "META"            JSONB,
  UNIQUE ("TENANT_ID","EMPLOYEE_ID","ACHIEVEMENT_KEY")
);

CREATE INDEX IF NOT EXISTS ix_user_achievement_emp_earned
  ON "USER_ACHIEVEMENT" ("TENANT_ID","EMPLOYEE_ID","EARNED_AT" DESC);

-- Seed-Katalog (idempotent ueber KEY)
INSERT INTO "ACHIEVEMENT" ("KEY","TITLE","DESCRIPTION","CATEGORY","POSITION") VALUES
('setup_complete',        'Einrichtung abgeschlossen',  'Alle Schritte der Setup-Checkliste erledigt.',         'aktivierung', 10),
('first_offer',           'Erstes Angebot',             'Erstes Angebot erstellt.',                              'aktivierung', 20),
('first_project_managed', 'Erstes Projekt geführt',     'Erstes Projekt als Projektleiter:in übernommen.',       'aktivierung', 30),
('first_invoice',         'Erste Rechnung',             'Erste Rechnung im System erstellt.',                    'aktivierung', 40),
('streak_5',              'Streak: 5 Tage',             '5 Arbeitstage in Folge Stunden gebucht.',               'gewohnheit',  50),
('streak_22',             'Streak: 1 Monat',            '22 Arbeitstage in Folge Stunden gebucht (= 1 Monat).',  'gewohnheit',  60),
('streak_66',             'Streak: Habit',              '66 Arbeitstage in Folge -- Buchen ist Gewohnheit geworden.', 'gewohnheit', 70),
('bookings_100',          '100 Buchungen',              '100 Buchungen im System erfasst.',                      'meisterschaft', 80),
('bookings_1000',         '1000 Buchungen',             '1000 Buchungen im System erfasst.',                     'meisterschaft', 90),
('projects_10',           '10 Projekte geführt',        '10 Projekte als Projektleiter:in übernommen.',          'meisterschaft', 100)
ON CONFLICT ("KEY") DO UPDATE SET
  "TITLE"       = EXCLUDED."TITLE",
  "DESCRIPTION" = EXCLUDED."DESCRIPTION",
  "CATEGORY"    = EXCLUDED."CATEGORY",
  "POSITION"    = EXCLUDED."POSITION";
