-- Migration 0121 — Kalkulationstyp "Prozentsatz der Baukosten" (AHO Heft 9)
--
-- Erster Schritt Richtung AHO-Leistungsbilder. AHO-Honorare sind KEINE
-- gesetzlich bindende Honorarzonentafel wie bei der HOAI, sondern eine
-- Verbandsempfehlung: das Honorar wird meist als frei vereinbarter
-- Prozentsatz der anrechenbaren Kosten verhandelt (oder als Zeithonorar,
-- das bereits über BILLING_TYPE_ID=2/TEC abgebildet ist). Das bestehende
-- Zonen-/Tafel-Modell (FEE_ZONES/FEE_TABLES) passt hier nicht.
--
-- Neuer vierter BASE_TYPE: 'percent_of_baukosten'.
--   - Kein Zonen-Dropdown, keine FEE_ZONES/FEE_TABLES-Zeilen nötig.
--   - K0..K4 bleiben nutzbar wie bei cost_eur (z. B. für Kostenschätzung/
--     -berechnung/-anschlag-Fortschreibung).
--   - Das Feld ZONE_PERCENT wird zum frei eingetragenen Honorarsatz % —
--     Grundhonorar je Kx = Kx × Honorarsatz / 100 (services/stammdaten.js
--     calculateRevenueFields(), kein Interpolations-Mechanismus).
--
-- ⚠️ WICHTIGER VORBEHALT — anders als bei allen bisherigen Migrationen
-- dieser Reihe: AHO-Hefte sind kostenpflichtige Verbandspublikationen, KEIN
-- frei zugänglicher Gesetzestext wie die HOAI auf gesetze-im-internet.de.
-- Diese Migration legt bewusst NUR den Kalkulationstyp + das Leistungsbild
-- selbst an — OHNE Leistungsphasen (Handlungsbereiche/Projektstufen) und
-- OHNE Honorarsatz-Richtwerte, weil deren genaue Gewichtung/Höhe nicht aus
-- einer geprüften Quelle stammt, sondern aus allgemeinem Fachwissen (User hat
-- dem nach ausdrücklichem Hinweis auf dieses Risiko zugestimmt). Nutzerinnen
-- tragen den Honorarsatz frei ein, wie sie ihn mit dem Auftraggeber
-- vereinbart haben — keine erfundene Tafel, die wie ein geprüfter Wert
-- aussieht, aber keiner ist. Leistungsphasen (Handlungsbereiche A–E,
-- Projektstufen) folgen in einer späteren Migration, sobald eine belastbare
-- Quelle vorliegt (Kandidat für Heft 17 bereits vorhanden — siehe
-- docs/HOAI_LEISTUNGSBILDER_ROADMAP.md § 11 —, für Heft 9 noch offen).
--
-- Manuell im Supabase SQL-Editor ausführen (als ganzes Skript).

ALTER TABLE "FEE_MASTERS" DROP CONSTRAINT IF EXISTS chk_fee_masters_base_type;
ALTER TABLE "FEE_MASTERS" ADD CONSTRAINT chk_fee_masters_base_type
  CHECK ("BASE_TYPE" IN ('cost_eur', 'area_ha', 'verrechnungseinheiten', 'percent_of_baukosten'));

INSERT INTO "FEE_GROUPS" ("ID", "NAME_SHORT", "NAME_LONG") VALUES
  (2, 'AHO', 'Ausschuss der Verbände und Kammern der Ingenieure und Architekten für die Honorarordnung')
ON CONFLICT ("ID") DO NOTHING;

INSERT INTO "FEE_MASTERS" ("ID", "FEE_GROUP_ID", "NAME_SHORT", "NAME_LONG", "MIN", "MAX", "BASE_TYPE") VALUES
  (108, 2, 'AHO_9', 'Projektsteuerung', NULL, NULL, 'percent_of_baukosten')
ON CONFLICT ("ID") DO NOTHING;

SELECT setval(pg_get_serial_sequence('"FEE_GROUPS"',  'ID'), COALESCE((SELECT MAX("ID") FROM "FEE_GROUPS"),  1));
SELECT setval(pg_get_serial_sequence('"FEE_MASTERS"', 'ID'), COALESCE((SELECT MAX("ID") FROM "FEE_MASTERS"), 1));
