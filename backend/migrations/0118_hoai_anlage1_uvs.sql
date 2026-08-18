-- Migration 0118 — HOAI Anlage 1.1: Umweltverträglichkeitsstudie
--
-- Ergänzt die Umweltverträglichkeitsstudie (UVS) als Leistungsbild. Anders
-- als Bauphysik (0116) und Geotechnik (0117) braucht sie KEINE Modell-
-- Erweiterung — sie ist strukturell identisch zur bestehenden
-- Bauleitplanung/Landschaftsplanung:
--
--   - Bemessungsgrundlage: Gesamtfläche des Untersuchungsraums in Hektar
--     (Anlage 1.1.2 Abs. 2) — BASE_TYPE 'area_ha' existiert bereits
--     (Migration 0054/0115, genutzt von Flächennutzungsplan usw.).
--   - Vier Leistungsphasen mit LPH-Nummerierung (Anlage 1.1.1 Abs. 1),
--     NAME_SHORT "LPH 1".."LPH 4" — feePhaseSortKey() parst das wie gehabt,
--     kein SORT_ORDER nötig (anders als Geotechniks Teilleistungen a/b/c).
--   - Drei Honorarzonen, Zone wird direkt gewählt (Anlage 1.1.2 Abs. 3–6
--     beschreibt ein Punktesystem zur Einstufung — das ist die in
--     docs/HOAI_LEISTUNGSBILDER_ROADMAP.md § 3.5 dokumentierte Lücke,
--     betrifft alle Leistungsbilder gleichermaßen, nicht UVS-spezifisch).
--   - Keine anrechenbaren Kosten in € → keine neue Regel in
--     services/din276.js nötig (wie bei den übrigen area_ha-Leistungsbildern
--     auch).
--
-- Die Leistungsphasen-Namen ("Klären der Aufgabenstellung...",
-- "Grundlagenermittlung", "Vorläufige Fassung", "Abgestimmte Fassung") und
-- deren Prozentsätze (3/37/50/10) sind wortgleich mit denen der
-- Landschaftsplanung (FEE_MASTER_ID 4–8) — beide Leistungsbilder teilen
-- dasselbe Phasenschema.
--
-- Quelle: HOAI (BGBl. I 2013, 2276; Anlage 1: BGBl. I 2013, 2306–2323),
-- zuletzt geändert durch Art. 3 G v. 22.3.2023. Werte maschinell aus dem
-- amtlichen Volltext übernommen (Bandgrenzen-Rundtrip gegen die Quelle
-- geprüft: alle 20 Zeilen lückenlos), nicht abgetippt.
--
-- Voraussetzung: 0115_hoai_reference_seed.sql.
-- Manuell im Supabase SQL-Editor ausführen (als ganzes Skript, nicht
-- Anweisung für Anweisung — sonst laufen INSERTs vor ihren FK-Referenzen).

INSERT INTO "FEE_MASTERS" ("ID", "FEE_GROUP_ID", "NAME_SHORT", "NAME_LONG", "MIN", "MAX", "BASE_TYPE") VALUES
  (105, 1, '2021_A1_1_2', 'Umweltverträglichkeitsstudie', 50, 10000, 'area_ha')
ON CONFLICT ("ID") DO NOTHING;

INSERT INTO "FEE_ZONES" ("ID", "FEE_MASTER_ID", "NAME_SHORT", "NAME_LONG") VALUES
  (1019, 105, 'I', 'geringe Anforderungen'),
  (1020, 105, 'II', 'durchschnittliche Anforderungen'),
  (1021, 105, 'III', 'hohe Anforderungen')
ON CONFLICT ("ID") DO NOTHING;

INSERT INTO "FEE_PHASE" ("ID", "FEE_MASTER_ID", "NAME_SHORT", "NAME_LONG", "FEE_PERCENT") VALUES
  (1025, 105, 'LPH 1', 'Klären der Aufgabenstellung und Ermitteln des Leistungsumfangs', 3),
  (1026, 105, 'LPH 2', 'Grundlagenermittlung', 37),
  (1027, 105, 'LPH 3', 'Vorläufige Fassung', 50),
  (1028, 105, 'LPH 4', 'Abgestimmte Fassung', 10)
ON CONFLICT ("ID") DO NOTHING;

-- Honorartafel Anlage 1.1.2 Abs. 1. Spaltenbelegung wie im Bestand:
-- ZONE_1..ZONE_TOP sind Bandgrenzen, "bis" der Zone n ist "von" der Zone
-- n+1. Dreizoniges Leistungsbild → ZONE_5/ZONE_TOP bleiben 0 (wie
-- Flächennutzungsplan, Bauakustik).
INSERT INTO "FEE_TABLES" ("ID", "FEE_MASTER_ID", "BASE", "ZONE_1", "ZONE_2", "ZONE_3", "ZONE_4", "ZONE_5", "ZONE_TOP") VALUES
  (10081, 105, 50, 10176, 12862, 15406, 18091, 0, 0),
  (10082, 105, 100, 14972, 18923, 22666, 26617, 0, 0),
  (10083, 105, 150, 18942, 23940, 28676, 33674, 0, 0),
  (10084, 105, 200, 22454, 28380, 33994, 39919, 0, 0),
  (10085, 105, 300, 28644, 36203, 43364, 50923, 0, 0),
  (10086, 105, 400, 34117, 43120, 51649, 60653, 0, 0),
  (10087, 105, 500, 39110, 49431, 59209, 69530, 0, 0),
  (10088, 105, 750, 50211, 63461, 76014, 89264, 0, 0),
  (10089, 105, 1000, 60004, 75838, 90839, 106674, 0, 0),
  (10090, 105, 1500, 77182, 97550, 116846, 137213, 0, 0),
  (10091, 105, 2000, 92278, 116629, 139698, 164049, 0, 0),
  (10092, 105, 2500, 105963, 133925, 160416, 188378, 0, 0),
  (10093, 105, 3000, 118598, 149895, 179544, 210841, 0, 0),
  (10094, 105, 4000, 141533, 178883, 214266, 251615, 0, 0),
  (10095, 105, 5000, 162148, 204937, 245474, 288263, 0, 0),
  (10096, 105, 6000, 182186, 230263, 275810, 323887, 0, 0),
  (10097, 105, 7000, 201072, 254133, 304401, 357461, 0, 0),
  (10098, 105, 8000, 218466, 276117, 330734, 388384, 0, 0),
  (10099, 105, 9000, 234394, 296247, 354846, 416700, 0, 0),
  (10100, 105, 10000, 249492, 315330, 377704, 443542, 0, 0)
ON CONFLICT ("ID") DO NOTHING;

SELECT setval(pg_get_serial_sequence('"FEE_MASTERS"', 'ID'), COALESCE((SELECT MAX("ID") FROM "FEE_MASTERS"), 1));
SELECT setval(pg_get_serial_sequence('"FEE_ZONES"',   'ID'), COALESCE((SELECT MAX("ID") FROM "FEE_ZONES"),   1));
SELECT setval(pg_get_serial_sequence('"FEE_PHASE"',   'ID'), COALESCE((SELECT MAX("ID") FROM "FEE_PHASE"),   1));
SELECT setval(pg_get_serial_sequence('"FEE_TABLES"',  'ID'), COALESCE((SELECT MAX("ID") FROM "FEE_TABLES"),  1));
