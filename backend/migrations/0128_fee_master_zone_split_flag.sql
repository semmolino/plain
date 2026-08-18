-- Migration 0128 — Kennzeichen "unterstützt Zonenaufteilung" am Leistungsbild
--
-- Der Button „Mischhonorar …" im Honorar-Wizard war bei JEDEM Leistungsbild
-- mit anrechenbaren Kosten sichtbar, obwohl die gewichtete Zonenaufteilung nur
-- für die Technische Ausrüstung gedacht ist (§ 54: Honorar je Anlagengruppe,
-- deren Anlagen unterschiedlichen Honorarzonen angehören können). Bei Gebäude,
-- Tragwerksplanung usw. führte er nur in die Irre.
--
-- WARUM EINE SPALTE UND KEINE ABFRAGE AUF DIE ID: Das Frontend darf nicht auf
-- FEE_MASTER_ID oder NAME_SHORT verzweigen. Dieselbe Leistung hat je Fassung
-- eine andere ID (TGA: 14 in HOAI 2021, 1014 in HOAI 2013) — eine fest
-- verdrahtete Prüfung hätte für die 2013er Berechnungen still nicht gegriffen.
-- Das Vorbild ist BASE_TYPE (Migration 0054): Verhalten am Leistungsbild
-- hinterlegen, im Code nur noch das Merkmal abfragen.
--
-- Manuell im Supabase SQL-Editor ausführen.

ALTER TABLE "FEE_MASTERS"
  ADD COLUMN IF NOT EXISTS "SUPPORTS_ZONE_SPLIT" BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN "FEE_MASTERS"."SUPPORTS_ZONE_SPLIT" IS
  'Zonenaufteilung/Mischhonorar anwendbar (§ 54 HOAI, Technische Ausrüstung). Steuert die Sichtbarkeit des Mischhonorar-Dialogs.';

-- Technische Ausrüstung in beiden Fassungen: HOAI 2021 (ID 14, aus 0115) und
-- HOAI 2013 (ID 1014, aus 0123). Über NAME_SHORT statt über die ID, damit die
-- Zuordnung auch dann stimmt, wenn eine Datenbank abweichende IDs vergeben hat.
UPDATE "FEE_MASTERS"
   SET "SUPPORTS_ZONE_SPLIT" = TRUE
 WHERE "NAME_SHORT" IN ('2021_55', '2013_55');
