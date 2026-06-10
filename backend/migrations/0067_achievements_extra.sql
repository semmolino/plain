-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 0067: Achievement-Katalog erweitern (Phase 3 Add-on)
-- ─────────────────────────────────────────────────────────────────────────────
-- Erweitert ACHIEVEMENT um 10 zusaetzliche, vom User vorgeschlagene Eintraege.
-- Alle vorhandenen Eintraege werden ueber ON CONFLICT (KEY) idempotent
-- aktualisiert; neue werden eingefuegt.
-- ─────────────────────────────────────────────────────────────────────────────

INSERT INTO "ACHIEVEMENT" ("KEY","TITLE","DESCRIPTION","CATEGORY","POSITION") VALUES
('first_address',                'Erste Adresse',              'Erste Kunden-Adresse im System angelegt.',                          'aktivierung', 22),
('first_contact',                'Erster Kontakt',             'Erste Ansprechperson zu einer Adresse hinterlegt.',                  'aktivierung', 24),
('first_project_with_structure', 'Projekt mit Struktur',       'Erstes Projekt mit mindestens einem Strukturelement.',              'aktivierung', 26),
('first_employee_complete',      'Erste:n Mitarbeiter:in eingerichtet','Mindestens eine vollstaendig hinterlegte Person im Team.','aktivierung', 28),
('first_booking',                'Erste Buchung',              'Erste Stunden-Buchung im System erfasst.',                          'aktivierung', 32),
('first_performance_update',     'Erster Leistungsstand',      'Leistungsstand mit Fortschritt > 0 in einem Projekt erfasst.',      'aktivierung', 34),
('profile_complete',             'Eigenes Profil vollständig', 'Name, Mail, Mobil und Personalnummer im eigenen Profil hinterlegt.', 'aktivierung', 36),
('offer_commissioned',           'Erstes Angebot beauftragt',  'Mindestens ein eigenes Angebot in ein Projekt konvertiert.',         'aktivierung', 38),
('complete_work_week',           'Komplette Buchungswoche',    'Eine Kalenderwoche an allen 5 Arbeitstagen vollstaendig gebucht.',   'gewohnheit',   62),
('monthly_close_submitted',      'Monatsabschluss eingereicht','Ersten Monatsabschluss eingereicht.',                                'gewohnheit',   64),
('clean_dunning_3_months',       'Saubere Buchhaltung',        '3 Monate in Folge keine Rechnung > 30 Tage ueberfaellig im Tenant.', 'meisterschaft', 110)
ON CONFLICT ("KEY") DO UPDATE SET
  "TITLE"       = EXCLUDED."TITLE",
  "DESCRIPTION" = EXCLUDED."DESCRIPTION",
  "CATEGORY"    = EXCLUDED."CATEGORY",
  "POSITION"    = EXCLUDED."POSITION";
