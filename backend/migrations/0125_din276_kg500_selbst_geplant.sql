-- Migration 0125 — Bestandsschutz für KG 500 nach der Freianlagen-Korrektur
--
-- HINTERGRUND: § 38 Abs. 1 HOAI rechnet die Kosten für Außenanlagen (KG 500)
-- nur an, "soweit diese durch den Auftragnehmer geplant oder überwacht
-- werden". Bisher zählte `anrechenbareKostenFreianlagen()` KG 500 immer voll,
-- ohne diese Bedingung zu prüfen — die Regel ist jetzt korrigiert.
--
-- WARUM DIESE MIGRATION: Im DIN-276-Editor gab es die Checkbox
-- „selbst geplant?" bisher nur für KG 200/400/600 (SELF_RELEVANT), nicht für
-- KG 500. Alle vorhandenen KG-5xx-Zeilen stehen deshalb zwangsläufig auf
-- IS_PLANNED_SELF = FALSE — nicht, weil jemand das so gemeint hätte, sondern
-- weil das Feld nicht bedienbar war. Ohne diese Migration würde die
-- korrigierte Regel jede bestehende Freianlagen-Berechnung still auf 0 €
-- setzen: ein stiller Datenfehler in bereits kalkulierten Projekten, und
-- genau die Sorte Fehler, die niemandem auffällt, bevor eine Rechnung
-- rausgeht.
--
-- Deshalb: alle BESTEHENDEN KG-5xx-Zeilen auf IS_PLANNED_SELF = TRUE setzen.
-- Das erhält exakt das bisherige Rechenergebnis. Fachlich ist das die
-- richtige Annahme, denn wer das Leistungsbild Freianlagen beauftragt hat,
-- lässt die Außenanlagen gerade durch den Auftragnehmer planen — der
-- Regelfall des § 38 Abs. 1. Fremdgeplante Anteile sind ab jetzt im Editor
-- gezielt abwählbar (die Checkbox erscheint neu auch für KG 500).
--
-- Neue Zeilen bleiben beim Default FALSE — dort trifft die Nutzerin die
-- Entscheidung bewusst.
--
-- Betrifft nur DIN276_COST_GROUP; keine Auswirkung auf bereits erzeugte
-- Belege (die speichern den berechneten Betrag, nicht die Herleitung).
--
-- Manuell im Supabase SQL-Editor ausführen.

UPDATE "DIN276_COST_GROUP"
   SET "IS_PLANNED_SELF" = TRUE
 WHERE "IS_PLANNED_SELF" = FALSE
   AND regexp_replace(COALESCE("KG_CODE", ''), '\D', '', 'g') ~ '^5'
   AND length(regexp_replace(COALESCE("KG_CODE", ''), '\D', '', 'g')) = 3;
