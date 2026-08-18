-- Migration 0116 — HOAI Anlage 1.2: Bauphysik
--
-- Ergänzt die drei Teilgebiete der Bauphysik als eigenständige Leistungsbilder.
-- Jedes hat eine EIGENE Honorartafel und eine eigene Zonenanzahl, deshalb drei
-- FEE_MASTERS und nicht eines mit Untergliederung:
--
--   Anlage 1.2.3  Wärmeschutz und Energiebilanzierung  5 Zonen  250.000–25.000.000 €
--   Anlage 1.2.4  Bauakustik                           3 Zonen  250.000–25.000.000 €
--   Anlage 1.2.5  Raumakustik                          5 Zonen   50.000– 7.500.000 €
--
-- Das Leistungsbild (Anlage 1.2.2 Abs. 1) ist für alle drei identisch:
-- sieben Leistungsphasen mit 3/20/40/6/27/2/2 Prozent (Summe 100).
-- Es gibt hier KEINE LPH 8/9 — Bauphysik endet mit der Mitwirkung bei der
-- Vergabe.
--
-- Anrechenbare Kosten (WICHTIG, weichen je Teilgebiet voneinander ab):
--   1.2.3 Wärmeschutz : anrechenbare Kosten des Gebäudes gemäß § 33,
--                       Honorarzone nach § 35 — also dieselbe Regel wie
--                       die Objektplanung Gebäude.
--   1.2.4 Bauakustik  : Kosten für Baukonstruktionen UND Anlagen der
--                       Technischen Ausrüstung (KG 300 + KG 400).
--   1.2.5 Raumakustik : je Innenraum. (KG 300 + KG 400) anteilig über
--                       Rauminhalt/Bruttorauminhalt, zuzüglich KG 610 des
--                       Innenraums.
--
-- Die Honorarspannen sind seit der Fassung 2021 Orientierungswerte, keine
-- verbindlichen Mindest-/Höchstsätze.
--
-- Quelle: HOAI (BGBl. I 2013, 2276; Anlage 1: BGBl. I 2013, 2306–2323),
-- zuletzt geändert durch Art. 3 G v. 22.3.2023. Werte maschinell aus dem
-- amtlichen Volltext übernommen, nicht abgetippt.
--
-- Voraussetzung: 0115_hoai_reference_seed.sql.
-- Manuell im Supabase SQL-Editor ausführen.

INSERT INTO "FEE_MASTERS" ("ID", "FEE_GROUP_ID", "NAME_SHORT", "NAME_LONG", "MIN", "MAX", "BASE_TYPE") VALUES
  (101, 1, '2021_A1_2_3', 'Wärmeschutz und Energiebilanzierung', 250000, 25000000, 'cost_eur'),
  (102, 1, '2021_A1_2_4', 'Bauakustik', 250000, 25000000, 'cost_eur'),
  (103, 1, '2021_A1_2_5', 'Raumakustik', 50000, 7500000, 'cost_eur')
ON CONFLICT ("ID") DO NOTHING;

INSERT INTO "FEE_ZONES" ("ID", "FEE_MASTER_ID", "NAME_SHORT", "NAME_LONG") VALUES
  (1001, 101, 'I', 'sehr geringe Anforderungen'),
  (1002, 101, 'II', 'geringe Anforderungen'),
  (1003, 101, 'III', 'durchschnittliche Anforderungen'),
  (1004, 101, 'IV', 'hohe Anforderungen'),
  (1005, 101, 'V', 'sehr hohe Anforderungen'),
  (1006, 102, 'I', 'geringe Anforderungen'),
  (1007, 102, 'II', 'durchschnittliche Anforderungen'),
  (1008, 102, 'III', 'hohe Anforderungen'),
  (1009, 103, 'I', 'sehr geringe Anforderungen'),
  (1010, 103, 'II', 'geringe Anforderungen'),
  (1011, 103, 'III', 'durchschnittliche Anforderungen'),
  (1012, 103, 'IV', 'hohe Anforderungen'),
  (1013, 103, 'V', 'sehr hohe Anforderungen')
ON CONFLICT ("ID") DO NOTHING;

INSERT INTO "FEE_PHASE" ("ID", "FEE_MASTER_ID", "NAME_SHORT", "NAME_LONG", "FEE_PERCENT") VALUES
  (1001, 101, 'LPH 1', 'Grundlagenermittlung', 3),
  (1002, 101, 'LPH 2', 'Mitwirken bei der Vorplanung', 20),
  (1003, 101, 'LPH 3', 'Mitwirken bei der Entwurfsplanung', 40),
  (1004, 101, 'LPH 4', 'Mitwirken bei der Genehmigungsplanung', 6),
  (1005, 101, 'LPH 5', 'Mitwirken bei der Ausführungsplanung', 27),
  (1006, 101, 'LPH 6', 'Mitwirken bei der Vorbereitung der Vergabe', 2),
  (1007, 101, 'LPH 7', 'Mitwirken bei der Vergabe', 2),
  (1008, 102, 'LPH 1', 'Grundlagenermittlung', 3),
  (1009, 102, 'LPH 2', 'Mitwirken bei der Vorplanung', 20),
  (1010, 102, 'LPH 3', 'Mitwirken bei der Entwurfsplanung', 40),
  (1011, 102, 'LPH 4', 'Mitwirken bei der Genehmigungsplanung', 6),
  (1012, 102, 'LPH 5', 'Mitwirken bei der Ausführungsplanung', 27),
  (1013, 102, 'LPH 6', 'Mitwirken bei der Vorbereitung der Vergabe', 2),
  (1014, 102, 'LPH 7', 'Mitwirken bei der Vergabe', 2),
  (1015, 103, 'LPH 1', 'Grundlagenermittlung', 3),
  (1016, 103, 'LPH 2', 'Mitwirken bei der Vorplanung', 20),
  (1017, 103, 'LPH 3', 'Mitwirken bei der Entwurfsplanung', 40),
  (1018, 103, 'LPH 4', 'Mitwirken bei der Genehmigungsplanung', 6),
  (1019, 103, 'LPH 5', 'Mitwirken bei der Ausführungsplanung', 27),
  (1020, 103, 'LPH 6', 'Mitwirken bei der Vorbereitung der Vergabe', 2),
  (1021, 103, 'LPH 7', 'Mitwirken bei der Vergabe', 2)
ON CONFLICT ("ID") DO NOTHING;

-- Honorartafeln. Spaltenbelegung wie im Bestand: ZONE_1..ZONE_TOP sind die
-- Bandgrenzen, "bis" der Zone n ist "von" der Zone n+1. Bei dreizonigen
-- Leistungsbildern bleiben ZONE_5/ZONE_TOP auf 0 (vgl. Flächennutzungsplan).
INSERT INTO "FEE_TABLES" ("ID", "FEE_MASTER_ID", "BASE", "ZONE_1", "ZONE_2", "ZONE_3", "ZONE_4", "ZONE_5", "ZONE_TOP") VALUES
  (10001, 101, 250000, 1757, 2023, 2395, 2928, 3300, 3566),
  (10002, 101, 275000, 1789, 2061, 2440, 2982, 3362, 3633),
  (10003, 101, 300000, 1821, 2097, 2484, 3036, 3422, 3698),
  (10004, 101, 350000, 1883, 2168, 2567, 3138, 3537, 3822),
  (10005, 101, 400000, 1941, 2235, 2647, 3235, 3646, 3941),
  (10006, 101, 500000, 2049, 2359, 2793, 3414, 3849, 4159),
  (10007, 101, 600000, 2146, 2471, 2926, 3576, 4031, 4356),
  (10008, 101, 750000, 2273, 2617, 3099, 3788, 4270, 4614),
  (10009, 101, 1000000, 2440, 2809, 3327, 4066, 4583, 4953),
  (10010, 101, 1250000, 2748, 3164, 3747, 4579, 5162, 5579),
  (10011, 101, 1500000, 3050, 3512, 4159, 5083, 5730, 6192),
  (10012, 101, 2000000, 3639, 4190, 4962, 6065, 6837, 7388),
  (10013, 101, 2500000, 4213, 4851, 5745, 7022, 7916, 8554),
  (10014, 101, 3500000, 5329, 6136, 7266, 8881, 10012, 10819),
  (10015, 101, 5000000, 6944, 7996, 9469, 11573, 13046, 14098),
  (10016, 101, 7500000, 9532, 10977, 12999, 15887, 17909, 19354),
  (10017, 101, 10000000, 12033, 13856, 16408, 20055, 22607, 24430),
  (10018, 101, 15000000, 16856, 19410, 22986, 28094, 31670, 34224),
  (10019, 101, 20000000, 21516, 24776, 29339, 35859, 40423, 43683),
  (10020, 101, 25000000, 26056, 30004, 35531, 43427, 48954, 52902),
  (10021, 102, 250000, 1729, 1985, 2284, 2625, 0, 0),
  (10022, 102, 275000, 1840, 2113, 2431, 2794, 0, 0),
  (10023, 102, 300000, 1948, 2237, 2574, 2959, 0, 0),
  (10024, 102, 350000, 2156, 2475, 2847, 3273, 0, 0),
  (10025, 102, 400000, 2353, 2701, 3108, 3573, 0, 0),
  (10026, 102, 500000, 2724, 3127, 3598, 4136, 0, 0),
  (10027, 102, 600000, 3069, 3524, 4055, 4661, 0, 0),
  (10028, 102, 750000, 3553, 4080, 4694, 5396, 0, 0),
  (10029, 102, 1000000, 4291, 4927, 5669, 6516, 0, 0),
  (10030, 102, 1250000, 4968, 5704, 6563, 7544, 0, 0),
  (10031, 102, 1500000, 5599, 6429, 7397, 8503, 0, 0),
  (10032, 102, 2000000, 6763, 7765, 8934, 10270, 0, 0),
  (10033, 102, 2500000, 7830, 8990, 10343, 11890, 0, 0),
  (10034, 102, 3500000, 9766, 11213, 12901, 14830, 0, 0),
  (10035, 102, 5000000, 12345, 14174, 16307, 18746, 0, 0),
  (10036, 102, 7500000, 16114, 18502, 21287, 24470, 0, 0),
  (10037, 102, 10000000, 19470, 22354, 25719, 29565, 0, 0),
  (10038, 102, 15000000, 25422, 29188, 33582, 38604, 0, 0),
  (10039, 102, 20000000, 30722, 35273, 40583, 46652, 0, 0),
  (10040, 102, 25000000, 35585, 40857, 47008, 54037, 0, 0),
  (10041, 103, 50000, 1714, 2226, 2737, 3279, 3790, 4301),
  (10042, 103, 75000, 1805, 2343, 2882, 3452, 3990, 4528),
  (10043, 103, 100000, 1892, 2457, 3021, 3619, 4183, 4748),
  (10044, 103, 150000, 2061, 2676, 3291, 3942, 4557, 5171),
  (10045, 103, 200000, 2225, 2888, 3551, 4254, 4917, 5581),
  (10046, 103, 250000, 2384, 3095, 3806, 4558, 5269, 5980),
  (10047, 103, 300000, 2540, 3297, 4055, 4857, 5614, 6371),
  (10048, 103, 400000, 2844, 3693, 4541, 5439, 6287, 7136),
  (10049, 103, 500000, 3141, 4078, 5015, 6007, 6944, 7881),
  (10050, 103, 750000, 3860, 5011, 6163, 7382, 8533, 9684),
  (10051, 103, 1000000, 4555, 5913, 7272, 8710, 10069, 11427),
  (10052, 103, 1500000, 5896, 7655, 9413, 11275, 13034, 14792),
  (10053, 103, 2000000, 7193, 9338, 11483, 13755, 15900, 18045),
  (10054, 103, 2500000, 8457, 10979, 13501, 16172, 18694, 21217),
  (10055, 103, 3000000, 9696, 12588, 15479, 18541, 21433, 24325),
  (10056, 103, 4000000, 12115, 15729, 19342, 23168, 26781, 30395),
  (10057, 103, 5000000, 14474, 18791, 23108, 27679, 31996, 36313),
  (10058, 103, 6000000, 16786, 21793, 26799, 32100, 37107, 42113),
  (10059, 103, 7000000, 19060, 24744, 30429, 36448, 42133, 47817),
  (10060, 103, 7500000, 20184, 26204, 32224, 38598, 44618, 50638)
ON CONFLICT ("ID") DO NOTHING;

SELECT setval(pg_get_serial_sequence('"FEE_MASTERS"', 'ID'), COALESCE((SELECT MAX("ID") FROM "FEE_MASTERS"), 1));
SELECT setval(pg_get_serial_sequence('"FEE_ZONES"',   'ID'), COALESCE((SELECT MAX("ID") FROM "FEE_ZONES"),   1));
SELECT setval(pg_get_serial_sequence('"FEE_PHASE"',   'ID'), COALESCE((SELECT MAX("ID") FROM "FEE_PHASE"),   1));
SELECT setval(pg_get_serial_sequence('"FEE_TABLES"',  'ID'), COALESCE((SELECT MAX("ID") FROM "FEE_TABLES"),  1));
