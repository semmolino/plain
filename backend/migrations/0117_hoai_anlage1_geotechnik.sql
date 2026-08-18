-- Migration 0117 — HOAI Anlage 1.3: Geotechnik
--
-- Ergänzt Geotechnik als eigenständiges Leistungsbild (Anlage 1.3.4).
-- Fünf Honorarzonen, Bemessungsgrundlage anrechenbare Kosten (€), Bereich
-- 50.000–25.000.000 €.
--
-- BESONDERHEIT 1: Kein LPH-Schema. Geotechnik gliedert sich nach Anlage
-- 1.3.3 Abs. 2 in drei Teilleistungen a/b/c (nicht LPH 1–9):
--   a) Grundlagenermittlung und Erkundungskonzept          15 %
--   b) Beschreiben der Baugrund- und Grundwasserverhältnisse 35 %
--   c) Beurteilung, Empfehlungen, Angaben zur Gründung       50 %
-- "TL a"/"TL b"/"TL c" enthalten keine Ziffer — feePhaseSortKey() in
-- services/stammdaten.js parst sonst NAME_SHORT nach der ersten Zahl und
-- würde alle drei Zeilen auf MAX_SAFE_INTEGER abbilden (instabile
-- Reihenfolge). Diese Migration führt dafür FEE_PHASE.SORT_ORDER ein;
-- feePhaseSortKey() bevorzugt SORT_ORDER, wenn gesetzt, und fällt sonst auf
-- das bisherige Namens-Parsing zurück — die 17 bestehenden Leistungsbilder
-- sind also unverändert (ihr SORT_ORDER bleibt NULL).
--
-- BESONDERHEIT 2: Keine eigene Anrechenbarkeits-Regel. Anlage 1.3.2 Abs. 1
-- verweist direkt auf "die anrechenbaren Kosten der Tragwerksplanung nach
-- § 50 Absatz 1 bis 3 für das gesamte Objekt aus Bauwerk und Baugrube" —
-- identisch zu § 50. Die Baugrube liegt in DIN 276-1:2008-12 unter KG 310,
-- also bereits innerhalb KG 300; die bestehende Tragwerk-Regel (55 % KG 300 +
-- 10 % KG 400) deckt "Bauwerk und Baugrube" damit ab. services/din276.js
-- registriert deshalb nur einen dünnen Alias (anrechenbareKostenGeotechnik →
-- anrechenbareKostenTragwerk), keine neue Regel.
--
-- Quelle: HOAI (BGBl. I 2013, 2276; Anlage 1: BGBl. I 2013, 2306–2323),
-- zuletzt geändert durch Art. 3 G v. 22.3.2023. Werte maschinell aus dem
-- amtlichen Volltext übernommen (Bandgrenzen-Rundtrip gegen die Quelle
-- geprüft: alle 20 Zeilen lückenlos), nicht abgetippt.
--
-- Voraussetzung: 0115_hoai_reference_seed.sql.
-- Manuell im Supabase SQL-Editor ausführen (als ganzes Skript, nicht
-- Anweisung für Anweisung — sonst laufen INSERTs vor ihren FK-Referenzen).

-- ── Schema-Erweiterung ────────────────────────────────────────────────────
ALTER TABLE "FEE_PHASE" ADD COLUMN IF NOT EXISTS "SORT_ORDER" INTEGER;

INSERT INTO "FEE_MASTERS" ("ID", "FEE_GROUP_ID", "NAME_SHORT", "NAME_LONG", "MIN", "MAX", "BASE_TYPE") VALUES
  (104, 1, '2021_A1_3_4', 'Geotechnik', 50000, 25000000, 'cost_eur')
ON CONFLICT ("ID") DO NOTHING;

INSERT INTO "FEE_ZONES" ("ID", "FEE_MASTER_ID", "NAME_SHORT", "NAME_LONG") VALUES
  (1014, 104, 'I', 'sehr geringe Anforderungen'),
  (1015, 104, 'II', 'geringe Anforderungen'),
  (1016, 104, 'III', 'durchschnittliche Anforderungen'),
  (1017, 104, 'IV', 'hohe Anforderungen'),
  (1018, 104, 'V', 'sehr hohe Anforderungen')
ON CONFLICT ("ID") DO NOTHING;

INSERT INTO "FEE_PHASE" ("ID", "FEE_MASTER_ID", "NAME_SHORT", "NAME_LONG", "FEE_PERCENT", "SORT_ORDER") VALUES
  (1022, 104, 'TL a', 'Grundlagenermittlung und Erkundungskonzept', 15, 1),
  (1023, 104, 'TL b', 'Beschreiben der Baugrund- und Grundwasserverhältnisse', 35, 2),
  (1024, 104, 'TL c', 'Beurteilung der Baugrund- und Grundwasserverhältnisse, Empfehlungen, Hinweise, Angaben zur Bemessung der Gründung', 50, 3)
ON CONFLICT ("ID") DO NOTHING;

-- Honorartafel Anlage 1.3.4. Spaltenbelegung wie im Bestand: ZONE_1..ZONE_TOP
-- sind Bandgrenzen, "bis" der Zone n ist "von" der Zone n+1.
INSERT INTO "FEE_TABLES" ("ID", "FEE_MASTER_ID", "BASE", "ZONE_1", "ZONE_2", "ZONE_3", "ZONE_4", "ZONE_5", "ZONE_TOP") VALUES
  (10061, 104, 50000, 789, 1222, 1654, 2105, 2537, 2970),
  (10062, 104, 75000, 951, 1472, 1993, 2537, 3058, 3579),
  (10063, 104, 100000, 1086, 1681, 2276, 2896, 3491, 4086),
  (10064, 104, 125000, 1204, 1863, 2522, 3210, 3869, 4528),
  (10065, 104, 150000, 1309, 2026, 2742, 3490, 4207, 4924),
  (10066, 104, 200000, 1494, 2312, 3130, 3984, 4802, 5621),
  (10067, 104, 300000, 1800, 2786, 3772, 4800, 5786, 6772),
  (10068, 104, 400000, 2054, 3179, 4304, 5478, 6603, 7728),
  (10069, 104, 500000, 2276, 3522, 4768, 6069, 7315, 8561),
  (10070, 104, 750000, 2740, 4241, 5741, 7307, 8808, 10308),
  (10071, 104, 1000000, 3125, 4836, 6548, 8334, 10045, 11756),
  (10072, 104, 1500000, 3765, 5827, 7889, 10041, 12103, 14165),
  (10073, 104, 2000000, 4297, 6650, 9003, 11459, 13812, 16165),
  (10074, 104, 3000000, 5175, 8009, 10842, 13799, 16633, 19467),
  (10075, 104, 5000000, 6535, 10114, 13693, 17428, 21007, 24586),
  (10076, 104, 7500000, 7878, 12192, 16506, 21007, 25321, 29635),
  (10077, 104, 10000000, 8994, 13919, 18844, 23983, 28909, 33834),
  (10078, 104, 15000000, 10839, 16775, 22711, 28905, 34840, 40776),
  (10079, 104, 20000000, 12373, 19148, 25923, 32993, 39769, 46544),
  (10080, 104, 25000000, 13708, 21215, 28722, 36556, 44063, 51570)
ON CONFLICT ("ID") DO NOTHING;

SELECT setval(pg_get_serial_sequence('"FEE_MASTERS"', 'ID'), COALESCE((SELECT MAX("ID") FROM "FEE_MASTERS"), 1));
SELECT setval(pg_get_serial_sequence('"FEE_ZONES"',   'ID'), COALESCE((SELECT MAX("ID") FROM "FEE_ZONES"),   1));
SELECT setval(pg_get_serial_sequence('"FEE_PHASE"',   'ID'), COALESCE((SELECT MAX("ID") FROM "FEE_PHASE"),   1));
SELECT setval(pg_get_serial_sequence('"FEE_TABLES"',  'ID'), COALESCE((SELECT MAX("ID") FROM "FEE_TABLES"),  1));
