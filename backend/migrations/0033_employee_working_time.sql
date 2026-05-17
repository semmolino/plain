-- ══════════════════════════════════════════════════════════════════════════════
-- Migration 0033 – Employee working-time models, CP-rate history, public holidays
-- ══════════════════════════════════════════════════════════════════════════════

-- ── Working-time model master data (tenant-scoped) ────────────────────────────

CREATE TABLE IF NOT EXISTS "WORKING_TIME_MODEL" (
  "ID"           SERIAL PRIMARY KEY,
  "TENANT_ID"    INTEGER NOT NULL,
  "NAME"         TEXT NOT NULL,
  "COUNTRY_CODE" TEXT NOT NULL DEFAULT 'DE',
  "STATE_CODE"   TEXT,
  "MON"          NUMERIC(4,2) NOT NULL DEFAULT 0,
  "TUE"          NUMERIC(4,2) NOT NULL DEFAULT 0,
  "WED"          NUMERIC(4,2) NOT NULL DEFAULT 0,
  "THU"          NUMERIC(4,2) NOT NULL DEFAULT 0,
  "FRI"          NUMERIC(4,2) NOT NULL DEFAULT 0,
  "SAT"          NUMERIC(4,2) NOT NULL DEFAULT 0,
  "SUN"          NUMERIC(4,2) NOT NULL DEFAULT 0
);

-- ── Employee → model assignments (time-based, multiple per employee) ──────────

CREATE TABLE IF NOT EXISTS "EMPLOYEE_WORK_MODEL" (
  "ID"          SERIAL PRIMARY KEY,
  "TENANT_ID"   INTEGER NOT NULL,
  "EMPLOYEE_ID" INTEGER NOT NULL,
  "MODEL_ID"    INTEGER NOT NULL,
  "VALID_FROM"  DATE NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ewm_employee ON "EMPLOYEE_WORK_MODEL" ("EMPLOYEE_ID", "VALID_FROM");

-- ── Employee cost-rate history (additive; EMPLOYEE.CP_RATE kept as fallback) ──

CREATE TABLE IF NOT EXISTS "EMPLOYEE_CP_RATE" (
  "ID"          SERIAL PRIMARY KEY,
  "TENANT_ID"   INTEGER NOT NULL,
  "EMPLOYEE_ID" INTEGER NOT NULL,
  "CP_RATE"     NUMERIC(10,4) NOT NULL,
  "VALID_FROM"  DATE NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ecr_employee ON "EMPLOYEE_CP_RATE" ("EMPLOYEE_ID", "VALID_FROM");

-- ── Public holidays (global – no TENANT_ID, seeded once) ─────────────────────
-- STATE_CODE = NULL  →  national holiday (all states in that country)
-- STATE_CODE = 'BY'  →  applies only to Bavaria, etc.
-- Query pattern: WHERE country_code='DE' AND (state_code IS NULL OR state_code='BY')

CREATE TABLE IF NOT EXISTS "PUBLIC_HOLIDAY" (
  "ID"           SERIAL PRIMARY KEY,
  "COUNTRY_CODE" TEXT NOT NULL,
  "STATE_CODE"   TEXT,
  "NAME"         TEXT NOT NULL,
  "HOLIDAY_DATE" DATE NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ph_lookup
  ON "PUBLIC_HOLIDAY" ("COUNTRY_CODE", "STATE_CODE", "HOLIDAY_DATE");

-- ── Add department assignment to EMPLOYEE ─────────────────────────────────────

ALTER TABLE "EMPLOYEE" ADD COLUMN IF NOT EXISTS "DEPARTMENT_ID" INTEGER;

-- ══════════════════════════════════════════════════════════════════════════════
-- Seed PUBLIC_HOLIDAY 2024–2030
--
-- Easter dates used:
--   2024-03-31  2025-04-20  2026-04-05  2027-03-28
--   2028-04-16  2029-04-01  2030-04-21
--
-- Moveable dates derived:
--   Karfreitag        = Easter − 2
--   Ostermontag       = Easter + 1
--   Christi Himmelfahrt = Easter + 39
--   Pfingstmontag     = Easter + 50
--   Fronleichnam      = Easter + 60
--   Buß- und Bettag   = Wednesday before 23 Nov (SN only)
-- ══════════════════════════════════════════════════════════════════════════════

INSERT INTO "PUBLIC_HOLIDAY" ("COUNTRY_CODE", "STATE_CODE", "NAME", "HOLIDAY_DATE") VALUES

-- ─────────────────────────────────────────────────────────────────────────────
-- GERMANY – National  (STATE_CODE = NULL → all 16 Bundesländer)
-- ─────────────────────────────────────────────────────────────────────────────

('DE', NULL, 'Neujahr',                   '2024-01-01'),
('DE', NULL, 'Neujahr',                   '2025-01-01'),
('DE', NULL, 'Neujahr',                   '2026-01-01'),
('DE', NULL, 'Neujahr',                   '2027-01-01'),
('DE', NULL, 'Neujahr',                   '2028-01-01'),
('DE', NULL, 'Neujahr',                   '2029-01-01'),
('DE', NULL, 'Neujahr',                   '2030-01-01'),

-- Karfreitag (Easter − 2)
('DE', NULL, 'Karfreitag',                '2024-03-29'),
('DE', NULL, 'Karfreitag',                '2025-04-18'),
('DE', NULL, 'Karfreitag',                '2026-04-03'),
('DE', NULL, 'Karfreitag',                '2027-03-26'),
('DE', NULL, 'Karfreitag',                '2028-04-14'),
('DE', NULL, 'Karfreitag',                '2029-03-30'),
('DE', NULL, 'Karfreitag',                '2030-04-19'),

-- Ostermontag (Easter + 1)
('DE', NULL, 'Ostermontag',               '2024-04-01'),
('DE', NULL, 'Ostermontag',               '2025-04-21'),
('DE', NULL, 'Ostermontag',               '2026-04-06'),
('DE', NULL, 'Ostermontag',               '2027-03-29'),
('DE', NULL, 'Ostermontag',               '2028-04-17'),
('DE', NULL, 'Ostermontag',               '2029-04-02'),
('DE', NULL, 'Ostermontag',               '2030-04-22'),

('DE', NULL, 'Tag der Arbeit',            '2024-05-01'),
('DE', NULL, 'Tag der Arbeit',            '2025-05-01'),
('DE', NULL, 'Tag der Arbeit',            '2026-05-01'),
('DE', NULL, 'Tag der Arbeit',            '2027-05-01'),
('DE', NULL, 'Tag der Arbeit',            '2028-05-01'),
('DE', NULL, 'Tag der Arbeit',            '2029-05-01'),
('DE', NULL, 'Tag der Arbeit',            '2030-05-01'),

-- Christi Himmelfahrt (Easter + 39)
('DE', NULL, 'Christi Himmelfahrt',       '2024-05-09'),
('DE', NULL, 'Christi Himmelfahrt',       '2025-05-29'),
('DE', NULL, 'Christi Himmelfahrt',       '2026-05-14'),
('DE', NULL, 'Christi Himmelfahrt',       '2027-05-06'),
('DE', NULL, 'Christi Himmelfahrt',       '2028-05-25'),
('DE', NULL, 'Christi Himmelfahrt',       '2029-05-10'),
('DE', NULL, 'Christi Himmelfahrt',       '2030-05-30'),

-- Pfingstmontag (Easter + 50)
('DE', NULL, 'Pfingstmontag',             '2024-05-20'),
('DE', NULL, 'Pfingstmontag',             '2025-06-09'),
('DE', NULL, 'Pfingstmontag',             '2026-05-25'),
('DE', NULL, 'Pfingstmontag',             '2027-05-17'),
('DE', NULL, 'Pfingstmontag',             '2028-06-05'),
('DE', NULL, 'Pfingstmontag',             '2029-05-21'),
('DE', NULL, 'Pfingstmontag',             '2030-06-10'),

('DE', NULL, 'Tag der deutschen Einheit', '2024-10-03'),
('DE', NULL, 'Tag der deutschen Einheit', '2025-10-03'),
('DE', NULL, 'Tag der deutschen Einheit', '2026-10-03'),
('DE', NULL, 'Tag der deutschen Einheit', '2027-10-03'),
('DE', NULL, 'Tag der deutschen Einheit', '2028-10-03'),
('DE', NULL, 'Tag der deutschen Einheit', '2029-10-03'),
('DE', NULL, 'Tag der deutschen Einheit', '2030-10-03'),

('DE', NULL, '1. Weihnachtstag',          '2024-12-25'),
('DE', NULL, '1. Weihnachtstag',          '2025-12-25'),
('DE', NULL, '1. Weihnachtstag',          '2026-12-25'),
('DE', NULL, '1. Weihnachtstag',          '2027-12-25'),
('DE', NULL, '1. Weihnachtstag',          '2028-12-25'),
('DE', NULL, '1. Weihnachtstag',          '2029-12-25'),
('DE', NULL, '1. Weihnachtstag',          '2030-12-25'),

('DE', NULL, '2. Weihnachtstag',          '2024-12-26'),
('DE', NULL, '2. Weihnachtstag',          '2025-12-26'),
('DE', NULL, '2. Weihnachtstag',          '2026-12-26'),
('DE', NULL, '2. Weihnachtstag',          '2027-12-26'),
('DE', NULL, '2. Weihnachtstag',          '2028-12-26'),
('DE', NULL, '2. Weihnachtstag',          '2029-12-26'),
('DE', NULL, '2. Weihnachtstag',          '2030-12-26'),

-- ─────────────────────────────────────────────────────────────────────────────
-- GERMANY – BW (Baden-Württemberg): Heilige Drei Könige, Fronleichnam, Allerheiligen
-- ─────────────────────────────────────────────────────────────────────────────

('DE', 'BW', 'Heilige Drei Könige',       '2024-01-06'),
('DE', 'BW', 'Heilige Drei Könige',       '2025-01-06'),
('DE', 'BW', 'Heilige Drei Könige',       '2026-01-06'),
('DE', 'BW', 'Heilige Drei Könige',       '2027-01-06'),
('DE', 'BW', 'Heilige Drei Könige',       '2028-01-06'),
('DE', 'BW', 'Heilige Drei Könige',       '2029-01-06'),
('DE', 'BW', 'Heilige Drei Könige',       '2030-01-06'),

-- Fronleichnam (Easter + 60)
('DE', 'BW', 'Fronleichnam',              '2024-05-30'),
('DE', 'BW', 'Fronleichnam',              '2025-06-19'),
('DE', 'BW', 'Fronleichnam',              '2026-06-04'),
('DE', 'BW', 'Fronleichnam',              '2027-05-27'),
('DE', 'BW', 'Fronleichnam',              '2028-06-15'),
('DE', 'BW', 'Fronleichnam',              '2029-05-31'),
('DE', 'BW', 'Fronleichnam',              '2030-06-20'),

('DE', 'BW', 'Allerheiligen',             '2024-11-01'),
('DE', 'BW', 'Allerheiligen',             '2025-11-01'),
('DE', 'BW', 'Allerheiligen',             '2026-11-01'),
('DE', 'BW', 'Allerheiligen',             '2027-11-01'),
('DE', 'BW', 'Allerheiligen',             '2028-11-01'),
('DE', 'BW', 'Allerheiligen',             '2029-11-01'),
('DE', 'BW', 'Allerheiligen',             '2030-11-01'),

-- ─────────────────────────────────────────────────────────────────────────────
-- GERMANY – BY (Bayern): Heilige Drei Könige, Fronleichnam, Maria Himmelfahrt, Allerheiligen
-- ─────────────────────────────────────────────────────────────────────────────

('DE', 'BY', 'Heilige Drei Könige',       '2024-01-06'),
('DE', 'BY', 'Heilige Drei Könige',       '2025-01-06'),
('DE', 'BY', 'Heilige Drei Könige',       '2026-01-06'),
('DE', 'BY', 'Heilige Drei Könige',       '2027-01-06'),
('DE', 'BY', 'Heilige Drei Könige',       '2028-01-06'),
('DE', 'BY', 'Heilige Drei Könige',       '2029-01-06'),
('DE', 'BY', 'Heilige Drei Könige',       '2030-01-06'),

('DE', 'BY', 'Fronleichnam',              '2024-05-30'),
('DE', 'BY', 'Fronleichnam',              '2025-06-19'),
('DE', 'BY', 'Fronleichnam',              '2026-06-04'),
('DE', 'BY', 'Fronleichnam',              '2027-05-27'),
('DE', 'BY', 'Fronleichnam',              '2028-06-15'),
('DE', 'BY', 'Fronleichnam',              '2029-05-31'),
('DE', 'BY', 'Fronleichnam',              '2030-06-20'),

('DE', 'BY', 'Maria Himmelfahrt',         '2024-08-15'),
('DE', 'BY', 'Maria Himmelfahrt',         '2025-08-15'),
('DE', 'BY', 'Maria Himmelfahrt',         '2026-08-15'),
('DE', 'BY', 'Maria Himmelfahrt',         '2027-08-15'),
('DE', 'BY', 'Maria Himmelfahrt',         '2028-08-15'),
('DE', 'BY', 'Maria Himmelfahrt',         '2029-08-15'),
('DE', 'BY', 'Maria Himmelfahrt',         '2030-08-15'),

('DE', 'BY', 'Allerheiligen',             '2024-11-01'),
('DE', 'BY', 'Allerheiligen',             '2025-11-01'),
('DE', 'BY', 'Allerheiligen',             '2026-11-01'),
('DE', 'BY', 'Allerheiligen',             '2027-11-01'),
('DE', 'BY', 'Allerheiligen',             '2028-11-01'),
('DE', 'BY', 'Allerheiligen',             '2029-11-01'),
('DE', 'BY', 'Allerheiligen',             '2030-11-01'),

-- ─────────────────────────────────────────────────────────────────────────────
-- GERMANY – BE (Berlin): Internationaler Frauentag
-- ─────────────────────────────────────────────────────────────────────────────

('DE', 'BE', 'Internationaler Frauentag', '2024-03-08'),
('DE', 'BE', 'Internationaler Frauentag', '2025-03-08'),
('DE', 'BE', 'Internationaler Frauentag', '2026-03-08'),
('DE', 'BE', 'Internationaler Frauentag', '2027-03-08'),
('DE', 'BE', 'Internationaler Frauentag', '2028-03-08'),
('DE', 'BE', 'Internationaler Frauentag', '2029-03-08'),
('DE', 'BE', 'Internationaler Frauentag', '2030-03-08'),

-- ─────────────────────────────────────────────────────────────────────────────
-- GERMANY – BB (Brandenburg): Reformationstag
-- ─────────────────────────────────────────────────────────────────────────────

('DE', 'BB', 'Reformationstag',           '2024-10-31'),
('DE', 'BB', 'Reformationstag',           '2025-10-31'),
('DE', 'BB', 'Reformationstag',           '2026-10-31'),
('DE', 'BB', 'Reformationstag',           '2027-10-31'),
('DE', 'BB', 'Reformationstag',           '2028-10-31'),
('DE', 'BB', 'Reformationstag',           '2029-10-31'),
('DE', 'BB', 'Reformationstag',           '2030-10-31'),

-- ─────────────────────────────────────────────────────────────────────────────
-- GERMANY – HB (Bremen): Reformationstag
-- ─────────────────────────────────────────────────────────────────────────────

('DE', 'HB', 'Reformationstag',           '2024-10-31'),
('DE', 'HB', 'Reformationstag',           '2025-10-31'),
('DE', 'HB', 'Reformationstag',           '2026-10-31'),
('DE', 'HB', 'Reformationstag',           '2027-10-31'),
('DE', 'HB', 'Reformationstag',           '2028-10-31'),
('DE', 'HB', 'Reformationstag',           '2029-10-31'),
('DE', 'HB', 'Reformationstag',           '2030-10-31'),

-- ─────────────────────────────────────────────────────────────────────────────
-- GERMANY – HH (Hamburg): Reformationstag
-- ─────────────────────────────────────────────────────────────────────────────

('DE', 'HH', 'Reformationstag',           '2024-10-31'),
('DE', 'HH', 'Reformationstag',           '2025-10-31'),
('DE', 'HH', 'Reformationstag',           '2026-10-31'),
('DE', 'HH', 'Reformationstag',           '2027-10-31'),
('DE', 'HH', 'Reformationstag',           '2028-10-31'),
('DE', 'HH', 'Reformationstag',           '2029-10-31'),
('DE', 'HH', 'Reformationstag',           '2030-10-31'),

-- ─────────────────────────────────────────────────────────────────────────────
-- GERMANY – HE (Hessen): Fronleichnam
-- ─────────────────────────────────────────────────────────────────────────────

('DE', 'HE', 'Fronleichnam',              '2024-05-30'),
('DE', 'HE', 'Fronleichnam',              '2025-06-19'),
('DE', 'HE', 'Fronleichnam',              '2026-06-04'),
('DE', 'HE', 'Fronleichnam',              '2027-05-27'),
('DE', 'HE', 'Fronleichnam',              '2028-06-15'),
('DE', 'HE', 'Fronleichnam',              '2029-05-31'),
('DE', 'HE', 'Fronleichnam',              '2030-06-20'),

-- ─────────────────────────────────────────────────────────────────────────────
-- GERMANY – MV (Mecklenburg-Vorpommern): Frauentag (since 2023), Reformationstag
-- ─────────────────────────────────────────────────────────────────────────────

('DE', 'MV', 'Internationaler Frauentag', '2024-03-08'),
('DE', 'MV', 'Internationaler Frauentag', '2025-03-08'),
('DE', 'MV', 'Internationaler Frauentag', '2026-03-08'),
('DE', 'MV', 'Internationaler Frauentag', '2027-03-08'),
('DE', 'MV', 'Internationaler Frauentag', '2028-03-08'),
('DE', 'MV', 'Internationaler Frauentag', '2029-03-08'),
('DE', 'MV', 'Internationaler Frauentag', '2030-03-08'),

('DE', 'MV', 'Reformationstag',           '2024-10-31'),
('DE', 'MV', 'Reformationstag',           '2025-10-31'),
('DE', 'MV', 'Reformationstag',           '2026-10-31'),
('DE', 'MV', 'Reformationstag',           '2027-10-31'),
('DE', 'MV', 'Reformationstag',           '2028-10-31'),
('DE', 'MV', 'Reformationstag',           '2029-10-31'),
('DE', 'MV', 'Reformationstag',           '2030-10-31'),

-- ─────────────────────────────────────────────────────────────────────────────
-- GERMANY – NI (Niedersachsen): Reformationstag
-- ─────────────────────────────────────────────────────────────────────────────

('DE', 'NI', 'Reformationstag',           '2024-10-31'),
('DE', 'NI', 'Reformationstag',           '2025-10-31'),
('DE', 'NI', 'Reformationstag',           '2026-10-31'),
('DE', 'NI', 'Reformationstag',           '2027-10-31'),
('DE', 'NI', 'Reformationstag',           '2028-10-31'),
('DE', 'NI', 'Reformationstag',           '2029-10-31'),
('DE', 'NI', 'Reformationstag',           '2030-10-31'),

-- ─────────────────────────────────────────────────────────────────────────────
-- GERMANY – NW (Nordrhein-Westfalen): Fronleichnam, Allerheiligen
-- ─────────────────────────────────────────────────────────────────────────────

('DE', 'NW', 'Fronleichnam',              '2024-05-30'),
('DE', 'NW', 'Fronleichnam',              '2025-06-19'),
('DE', 'NW', 'Fronleichnam',              '2026-06-04'),
('DE', 'NW', 'Fronleichnam',              '2027-05-27'),
('DE', 'NW', 'Fronleichnam',              '2028-06-15'),
('DE', 'NW', 'Fronleichnam',              '2029-05-31'),
('DE', 'NW', 'Fronleichnam',              '2030-06-20'),

('DE', 'NW', 'Allerheiligen',             '2024-11-01'),
('DE', 'NW', 'Allerheiligen',             '2025-11-01'),
('DE', 'NW', 'Allerheiligen',             '2026-11-01'),
('DE', 'NW', 'Allerheiligen',             '2027-11-01'),
('DE', 'NW', 'Allerheiligen',             '2028-11-01'),
('DE', 'NW', 'Allerheiligen',             '2029-11-01'),
('DE', 'NW', 'Allerheiligen',             '2030-11-01'),

-- ─────────────────────────────────────────────────────────────────────────────
-- GERMANY – RP (Rheinland-Pfalz): Fronleichnam, Allerheiligen
-- ─────────────────────────────────────────────────────────────────────────────

('DE', 'RP', 'Fronleichnam',              '2024-05-30'),
('DE', 'RP', 'Fronleichnam',              '2025-06-19'),
('DE', 'RP', 'Fronleichnam',              '2026-06-04'),
('DE', 'RP', 'Fronleichnam',              '2027-05-27'),
('DE', 'RP', 'Fronleichnam',              '2028-06-15'),
('DE', 'RP', 'Fronleichnam',              '2029-05-31'),
('DE', 'RP', 'Fronleichnam',              '2030-06-20'),

('DE', 'RP', 'Allerheiligen',             '2024-11-01'),
('DE', 'RP', 'Allerheiligen',             '2025-11-01'),
('DE', 'RP', 'Allerheiligen',             '2026-11-01'),
('DE', 'RP', 'Allerheiligen',             '2027-11-01'),
('DE', 'RP', 'Allerheiligen',             '2028-11-01'),
('DE', 'RP', 'Allerheiligen',             '2029-11-01'),
('DE', 'RP', 'Allerheiligen',             '2030-11-01'),

-- ─────────────────────────────────────────────────────────────────────────────
-- GERMANY – SL (Saarland): Fronleichnam, Maria Himmelfahrt, Allerheiligen
-- ─────────────────────────────────────────────────────────────────────────────

('DE', 'SL', 'Fronleichnam',              '2024-05-30'),
('DE', 'SL', 'Fronleichnam',              '2025-06-19'),
('DE', 'SL', 'Fronleichnam',              '2026-06-04'),
('DE', 'SL', 'Fronleichnam',              '2027-05-27'),
('DE', 'SL', 'Fronleichnam',              '2028-06-15'),
('DE', 'SL', 'Fronleichnam',              '2029-05-31'),
('DE', 'SL', 'Fronleichnam',              '2030-06-20'),

('DE', 'SL', 'Maria Himmelfahrt',         '2024-08-15'),
('DE', 'SL', 'Maria Himmelfahrt',         '2025-08-15'),
('DE', 'SL', 'Maria Himmelfahrt',         '2026-08-15'),
('DE', 'SL', 'Maria Himmelfahrt',         '2027-08-15'),
('DE', 'SL', 'Maria Himmelfahrt',         '2028-08-15'),
('DE', 'SL', 'Maria Himmelfahrt',         '2029-08-15'),
('DE', 'SL', 'Maria Himmelfahrt',         '2030-08-15'),

('DE', 'SL', 'Allerheiligen',             '2024-11-01'),
('DE', 'SL', 'Allerheiligen',             '2025-11-01'),
('DE', 'SL', 'Allerheiligen',             '2026-11-01'),
('DE', 'SL', 'Allerheiligen',             '2027-11-01'),
('DE', 'SL', 'Allerheiligen',             '2028-11-01'),
('DE', 'SL', 'Allerheiligen',             '2029-11-01'),
('DE', 'SL', 'Allerheiligen',             '2030-11-01'),

-- ─────────────────────────────────────────────────────────────────────────────
-- GERMANY – SN (Sachsen): Reformationstag, Buß- und Bettag
-- Buß- und Bettag = Wednesday before Nov 23:
--   2024-11-20  2025-11-19  2026-11-18  2027-11-17
--   2028-11-22  2029-11-21  2030-11-20
-- ─────────────────────────────────────────────────────────────────────────────

('DE', 'SN', 'Reformationstag',           '2024-10-31'),
('DE', 'SN', 'Reformationstag',           '2025-10-31'),
('DE', 'SN', 'Reformationstag',           '2026-10-31'),
('DE', 'SN', 'Reformationstag',           '2027-10-31'),
('DE', 'SN', 'Reformationstag',           '2028-10-31'),
('DE', 'SN', 'Reformationstag',           '2029-10-31'),
('DE', 'SN', 'Reformationstag',           '2030-10-31'),

('DE', 'SN', 'Buß- und Bettag',           '2024-11-20'),
('DE', 'SN', 'Buß- und Bettag',           '2025-11-19'),
('DE', 'SN', 'Buß- und Bettag',           '2026-11-18'),
('DE', 'SN', 'Buß- und Bettag',           '2027-11-17'),
('DE', 'SN', 'Buß- und Bettag',           '2028-11-22'),
('DE', 'SN', 'Buß- und Bettag',           '2029-11-21'),
('DE', 'SN', 'Buß- und Bettag',           '2030-11-20'),

-- ─────────────────────────────────────────────────────────────────────────────
-- GERMANY – ST (Sachsen-Anhalt): Heilige Drei Könige, Reformationstag
-- ─────────────────────────────────────────────────────────────────────────────

('DE', 'ST', 'Heilige Drei Könige',       '2024-01-06'),
('DE', 'ST', 'Heilige Drei Könige',       '2025-01-06'),
('DE', 'ST', 'Heilige Drei Könige',       '2026-01-06'),
('DE', 'ST', 'Heilige Drei Könige',       '2027-01-06'),
('DE', 'ST', 'Heilige Drei Könige',       '2028-01-06'),
('DE', 'ST', 'Heilige Drei Könige',       '2029-01-06'),
('DE', 'ST', 'Heilige Drei Könige',       '2030-01-06'),

('DE', 'ST', 'Reformationstag',           '2024-10-31'),
('DE', 'ST', 'Reformationstag',           '2025-10-31'),
('DE', 'ST', 'Reformationstag',           '2026-10-31'),
('DE', 'ST', 'Reformationstag',           '2027-10-31'),
('DE', 'ST', 'Reformationstag',           '2028-10-31'),
('DE', 'ST', 'Reformationstag',           '2029-10-31'),
('DE', 'ST', 'Reformationstag',           '2030-10-31'),

-- ─────────────────────────────────────────────────────────────────────────────
-- GERMANY – SH (Schleswig-Holstein): Reformationstag
-- ─────────────────────────────────────────────────────────────────────────────

('DE', 'SH', 'Reformationstag',           '2024-10-31'),
('DE', 'SH', 'Reformationstag',           '2025-10-31'),
('DE', 'SH', 'Reformationstag',           '2026-10-31'),
('DE', 'SH', 'Reformationstag',           '2027-10-31'),
('DE', 'SH', 'Reformationstag',           '2028-10-31'),
('DE', 'SH', 'Reformationstag',           '2029-10-31'),
('DE', 'SH', 'Reformationstag',           '2030-10-31'),

-- ─────────────────────────────────────────────────────────────────────────────
-- GERMANY – TH (Thüringen): Weltkindertag, Reformationstag
-- ─────────────────────────────────────────────────────────────────────────────

('DE', 'TH', 'Weltkindertag',             '2024-09-20'),
('DE', 'TH', 'Weltkindertag',             '2025-09-20'),
('DE', 'TH', 'Weltkindertag',             '2026-09-20'),
('DE', 'TH', 'Weltkindertag',             '2027-09-20'),
('DE', 'TH', 'Weltkindertag',             '2028-09-20'),
('DE', 'TH', 'Weltkindertag',             '2029-09-20'),
('DE', 'TH', 'Weltkindertag',             '2030-09-20'),

('DE', 'TH', 'Reformationstag',           '2024-10-31'),
('DE', 'TH', 'Reformationstag',           '2025-10-31'),
('DE', 'TH', 'Reformationstag',           '2026-10-31'),
('DE', 'TH', 'Reformationstag',           '2027-10-31'),
('DE', 'TH', 'Reformationstag',           '2028-10-31'),
('DE', 'TH', 'Reformationstag',           '2029-10-31'),
('DE', 'TH', 'Reformationstag',           '2030-10-31'),

-- ─────────────────────────────────────────────────────────────────────────────
-- AUSTRIA – National
-- ─────────────────────────────────────────────────────────────────────────────

('AT', NULL, 'Neujahr',                   '2024-01-01'),
('AT', NULL, 'Neujahr',                   '2025-01-01'),
('AT', NULL, 'Neujahr',                   '2026-01-01'),
('AT', NULL, 'Neujahr',                   '2027-01-01'),
('AT', NULL, 'Neujahr',                   '2028-01-01'),
('AT', NULL, 'Neujahr',                   '2029-01-01'),
('AT', NULL, 'Neujahr',                   '2030-01-01'),

('AT', NULL, 'Heilige Drei Könige',       '2024-01-06'),
('AT', NULL, 'Heilige Drei Könige',       '2025-01-06'),
('AT', NULL, 'Heilige Drei Könige',       '2026-01-06'),
('AT', NULL, 'Heilige Drei Könige',       '2027-01-06'),
('AT', NULL, 'Heilige Drei Könige',       '2028-01-06'),
('AT', NULL, 'Heilige Drei Könige',       '2029-01-06'),
('AT', NULL, 'Heilige Drei Könige',       '2030-01-06'),

-- Ostermontag (Easter + 1)
('AT', NULL, 'Ostermontag',               '2024-04-01'),
('AT', NULL, 'Ostermontag',               '2025-04-21'),
('AT', NULL, 'Ostermontag',               '2026-04-06'),
('AT', NULL, 'Ostermontag',               '2027-03-29'),
('AT', NULL, 'Ostermontag',               '2028-04-17'),
('AT', NULL, 'Ostermontag',               '2029-04-02'),
('AT', NULL, 'Ostermontag',               '2030-04-22'),

('AT', NULL, 'Staatsfeiertag',            '2024-05-01'),
('AT', NULL, 'Staatsfeiertag',            '2025-05-01'),
('AT', NULL, 'Staatsfeiertag',            '2026-05-01'),
('AT', NULL, 'Staatsfeiertag',            '2027-05-01'),
('AT', NULL, 'Staatsfeiertag',            '2028-05-01'),
('AT', NULL, 'Staatsfeiertag',            '2029-05-01'),
('AT', NULL, 'Staatsfeiertag',            '2030-05-01'),

-- Christi Himmelfahrt (Easter + 39)
('AT', NULL, 'Christi Himmelfahrt',       '2024-05-09'),
('AT', NULL, 'Christi Himmelfahrt',       '2025-05-29'),
('AT', NULL, 'Christi Himmelfahrt',       '2026-05-14'),
('AT', NULL, 'Christi Himmelfahrt',       '2027-05-06'),
('AT', NULL, 'Christi Himmelfahrt',       '2028-05-25'),
('AT', NULL, 'Christi Himmelfahrt',       '2029-05-10'),
('AT', NULL, 'Christi Himmelfahrt',       '2030-05-30'),

-- Pfingstmontag (Easter + 50)
('AT', NULL, 'Pfingstmontag',             '2024-05-20'),
('AT', NULL, 'Pfingstmontag',             '2025-06-09'),
('AT', NULL, 'Pfingstmontag',             '2026-05-25'),
('AT', NULL, 'Pfingstmontag',             '2027-05-17'),
('AT', NULL, 'Pfingstmontag',             '2028-06-05'),
('AT', NULL, 'Pfingstmontag',             '2029-05-21'),
('AT', NULL, 'Pfingstmontag',             '2030-06-10'),

-- Fronleichnam (Easter + 60)
('AT', NULL, 'Fronleichnam',              '2024-05-30'),
('AT', NULL, 'Fronleichnam',              '2025-06-19'),
('AT', NULL, 'Fronleichnam',              '2026-06-04'),
('AT', NULL, 'Fronleichnam',              '2027-05-27'),
('AT', NULL, 'Fronleichnam',              '2028-06-15'),
('AT', NULL, 'Fronleichnam',              '2029-05-31'),
('AT', NULL, 'Fronleichnam',              '2030-06-20'),

('AT', NULL, 'Maria Himmelfahrt',         '2024-08-15'),
('AT', NULL, 'Maria Himmelfahrt',         '2025-08-15'),
('AT', NULL, 'Maria Himmelfahrt',         '2026-08-15'),
('AT', NULL, 'Maria Himmelfahrt',         '2027-08-15'),
('AT', NULL, 'Maria Himmelfahrt',         '2028-08-15'),
('AT', NULL, 'Maria Himmelfahrt',         '2029-08-15'),
('AT', NULL, 'Maria Himmelfahrt',         '2030-08-15'),

('AT', NULL, 'Nationalfeiertag',          '2024-10-26'),
('AT', NULL, 'Nationalfeiertag',          '2025-10-26'),
('AT', NULL, 'Nationalfeiertag',          '2026-10-26'),
('AT', NULL, 'Nationalfeiertag',          '2027-10-26'),
('AT', NULL, 'Nationalfeiertag',          '2028-10-26'),
('AT', NULL, 'Nationalfeiertag',          '2029-10-26'),
('AT', NULL, 'Nationalfeiertag',          '2030-10-26'),

('AT', NULL, 'Allerheiligen',             '2024-11-01'),
('AT', NULL, 'Allerheiligen',             '2025-11-01'),
('AT', NULL, 'Allerheiligen',             '2026-11-01'),
('AT', NULL, 'Allerheiligen',             '2027-11-01'),
('AT', NULL, 'Allerheiligen',             '2028-11-01'),
('AT', NULL, 'Allerheiligen',             '2029-11-01'),
('AT', NULL, 'Allerheiligen',             '2030-11-01'),

('AT', NULL, 'Maria Empfängnis',          '2024-12-08'),
('AT', NULL, 'Maria Empfängnis',          '2025-12-08'),
('AT', NULL, 'Maria Empfängnis',          '2026-12-08'),
('AT', NULL, 'Maria Empfängnis',          '2027-12-08'),
('AT', NULL, 'Maria Empfängnis',          '2028-12-08'),
('AT', NULL, 'Maria Empfängnis',          '2029-12-08'),
('AT', NULL, 'Maria Empfängnis',          '2030-12-08'),

('AT', NULL, 'Christtag',                 '2024-12-25'),
('AT', NULL, 'Christtag',                 '2025-12-25'),
('AT', NULL, 'Christtag',                 '2026-12-25'),
('AT', NULL, 'Christtag',                 '2027-12-25'),
('AT', NULL, 'Christtag',                 '2028-12-25'),
('AT', NULL, 'Christtag',                 '2029-12-25'),
('AT', NULL, 'Christtag',                 '2030-12-25'),

('AT', NULL, 'Stefanitag',                '2024-12-26'),
('AT', NULL, 'Stefanitag',                '2025-12-26'),
('AT', NULL, 'Stefanitag',                '2026-12-26'),
('AT', NULL, 'Stefanitag',                '2027-12-26'),
('AT', NULL, 'Stefanitag',                '2028-12-26'),
('AT', NULL, 'Stefanitag',                '2029-12-26'),
('AT', NULL, 'Stefanitag',                '2030-12-26'),

-- ─────────────────────────────────────────────────────────────────────────────
-- SWITZERLAND – National
-- ─────────────────────────────────────────────────────────────────────────────

('CH', NULL, 'Neujahr',                   '2024-01-01'),
('CH', NULL, 'Neujahr',                   '2025-01-01'),
('CH', NULL, 'Neujahr',                   '2026-01-01'),
('CH', NULL, 'Neujahr',                   '2027-01-01'),
('CH', NULL, 'Neujahr',                   '2028-01-01'),
('CH', NULL, 'Neujahr',                   '2029-01-01'),
('CH', NULL, 'Neujahr',                   '2030-01-01'),

-- Karfreitag (Easter − 2)
('CH', NULL, 'Karfreitag',                '2024-03-29'),
('CH', NULL, 'Karfreitag',                '2025-04-18'),
('CH', NULL, 'Karfreitag',                '2026-04-03'),
('CH', NULL, 'Karfreitag',                '2027-03-26'),
('CH', NULL, 'Karfreitag',                '2028-04-14'),
('CH', NULL, 'Karfreitag',                '2029-03-30'),
('CH', NULL, 'Karfreitag',                '2030-04-19'),

-- Ostermontag (Easter + 1)
('CH', NULL, 'Ostermontag',               '2024-04-01'),
('CH', NULL, 'Ostermontag',               '2025-04-21'),
('CH', NULL, 'Ostermontag',               '2026-04-06'),
('CH', NULL, 'Ostermontag',               '2027-03-29'),
('CH', NULL, 'Ostermontag',               '2028-04-17'),
('CH', NULL, 'Ostermontag',               '2029-04-02'),
('CH', NULL, 'Ostermontag',               '2030-04-22'),

-- Auffahrt / Christi Himmelfahrt (Easter + 39)
('CH', NULL, 'Auffahrt',                  '2024-05-09'),
('CH', NULL, 'Auffahrt',                  '2025-05-29'),
('CH', NULL, 'Auffahrt',                  '2026-05-14'),
('CH', NULL, 'Auffahrt',                  '2027-05-06'),
('CH', NULL, 'Auffahrt',                  '2028-05-25'),
('CH', NULL, 'Auffahrt',                  '2029-05-10'),
('CH', NULL, 'Auffahrt',                  '2030-05-30'),

-- Pfingstmontag (Easter + 50)
('CH', NULL, 'Pfingstmontag',             '2024-05-20'),
('CH', NULL, 'Pfingstmontag',             '2025-06-09'),
('CH', NULL, 'Pfingstmontag',             '2026-05-25'),
('CH', NULL, 'Pfingstmontag',             '2027-05-17'),
('CH', NULL, 'Pfingstmontag',             '2028-06-05'),
('CH', NULL, 'Pfingstmontag',             '2029-05-21'),
('CH', NULL, 'Pfingstmontag',             '2030-06-10'),

('CH', NULL, 'Bundesfeiertag',            '2024-08-01'),
('CH', NULL, 'Bundesfeiertag',            '2025-08-01'),
('CH', NULL, 'Bundesfeiertag',            '2026-08-01'),
('CH', NULL, 'Bundesfeiertag',            '2027-08-01'),
('CH', NULL, 'Bundesfeiertag',            '2028-08-01'),
('CH', NULL, 'Bundesfeiertag',            '2029-08-01'),
('CH', NULL, 'Bundesfeiertag',            '2030-08-01'),

('CH', NULL, '1. Weihnachtstag',          '2024-12-25'),
('CH', NULL, '1. Weihnachtstag',          '2025-12-25'),
('CH', NULL, '1. Weihnachtstag',          '2026-12-25'),
('CH', NULL, '1. Weihnachtstag',          '2027-12-25'),
('CH', NULL, '1. Weihnachtstag',          '2028-12-25'),
('CH', NULL, '1. Weihnachtstag',          '2029-12-25'),
('CH', NULL, '1. Weihnachtstag',          '2030-12-25'),

('CH', NULL, '2. Weihnachtstag',          '2024-12-26'),
('CH', NULL, '2. Weihnachtstag',          '2025-12-26'),
('CH', NULL, '2. Weihnachtstag',          '2026-12-26'),
('CH', NULL, '2. Weihnachtstag',          '2027-12-26'),
('CH', NULL, '2. Weihnachtstag',          '2028-12-26'),
('CH', NULL, '2. Weihnachtstag',          '2029-12-26'),
('CH', NULL, '2. Weihnachtstag',          '2030-12-26');
