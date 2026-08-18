-- Migration 0119 — HOAI Anlage 1.4: Ingenieurvermessung
--
-- Letztes offenes Anlage-1-Leistungsbild (siehe
-- docs/HOAI_LEISTUNGSBILDER_ROADMAP.md). Zwei eigenständige Leistungsbilder
-- mit je eigener Honorartafel:
--
--   Anlage 1.4.8 Abs. 1  Planungsbegleitende Vermessung  5 Zonen  6–11.726 VE
--   Anlage 1.4.8 Abs. 2  Bauvermessung                   5 Zonen  50T–10 Mio €
--
-- BESONDERHEIT 1: Dritter BASE_TYPE 'verrechnungseinheiten'.
-- Planungsbegleitende Vermessung rechnet nicht in € oder ha, sondern in
-- Verrechnungseinheiten (VE, Anlage 1.4.2): VE = Fläche (ha) × Faktor der
-- Punktdichte-Flächenklasse (13 Klassen, 40–800 VE/ha, Anlage 1.4.2 Abs. 3).
-- Analog zu 'area_ha' wird die VE-Summe direkt eingetragen (keine
-- Flächenklassen-Rechenhilfe in der UI — dieselbe Vereinfachung wie bei ha,
-- wo die Fläche auch direkt eingetragen wird statt sie aus einer
-- Vermessung abzuleiten). Betroffener Code: CHECK-Constraint (unten),
-- FeeBaseType-Union (api/fee.ts), HonorarWizard.tsx (isSingleValue statt
-- isAreaHa), services_pdf_render.js + honorar.njk (neuer Filter
-- "verrechnungseinheiten", Suffix " VE").
--
-- BESONDERHEIT 2: Bauvermessungs anrechenbare Kosten sind NICHT in
-- services/din276.js abgebildet — bewusst. Anlage 1.4.5 Abs. 2 definiert sie
-- als 80 % (Gebäude/Verkehrsanlagen) bzw. 100 % (Ingenieurbauwerke) der
-- "Herstellungskosten", ermittelt nach § 33 / § 42 / § 46 je nach Objektart.
-- § 33 (Gebäude) haben wir (anrechenbareKostenGebaeude) — § 42
-- (Ingenieurbauwerke) und § 46 (Verkehrsanlagen) NICHT, obwohl beide
-- Leistungsbilder seit Migration 0115 existieren. Eine Bauvermessungs-Regel
-- vor diesen beiden zu bauen hieße, auf zwei fehlenden Regeln aufzusetzen —
-- deshalb hier ausgeklammert. Nutzerinnen tragen die anrechenbaren Kosten
-- wie bei Ingenieurbauwerken/Verkehrsanlagen bereits heute direkt ein (ohne
-- DIN276-Editor-Unterstützung). Nachzuziehen, sobald § 42/§ 46 anstehen.
--
-- BESONDERHEIT 3 (nicht abgebildet, dokumentiert): Anlage 1.4.7 Abs. 4 sieht
-- für Bauvermessung bei Gebäuden LPH 4 abweichend mit 45–62 % vor (statt
-- pauschal 62 %). Diese Objektart-Abhängigkeit bilden wir nicht ab — wie bei
-- allen anderen Leistungsbildern wird der allgemeine Grundleistungssatz
-- gepflegt (62 %), Abweichungen sind manuell in der Berechnung anzupassen.
--
-- Beide Leistungsbilder: Honorarzonen werden direkt gewählt (das
-- Punktesystem aus Anlage 1.4.3/1.4.6 bilden wir nicht ab — siehe
-- docs/HOAI_LEISTUNGSBILDER_ROADMAP.md § 3.5, betrifft alle Leistungsbilder
-- gleichermaßen). Beide LPH-nummeriert, kein SORT_ORDER nötig.
--
-- Quelle: HOAI (BGBl. I 2013, 2276; Anlage 1: BGBl. I 2013, 2306–2323),
-- zuletzt geändert durch Art. 3 G v. 22.3.2023. Werte maschinell aus dem
-- amtlichen Volltext übernommen (Bandgrenzen-Rundtrip gegen die Quelle
-- geprüft: 19 + 20 Zeilen lückenlos), nicht abgetippt.
--
-- Voraussetzung: 0115_hoai_reference_seed.sql.
-- Manuell im Supabase SQL-Editor ausführen (als ganzes Skript, nicht
-- Anweisung für Anweisung — sonst laufen INSERTs vor ihren FK-Referenzen).

-- ── Schema-Erweiterung ────────────────────────────────────────────────────
ALTER TABLE "FEE_MASTERS" DROP CONSTRAINT IF EXISTS chk_fee_masters_base_type;
ALTER TABLE "FEE_MASTERS" ADD CONSTRAINT chk_fee_masters_base_type
  CHECK ("BASE_TYPE" IN ('cost_eur', 'area_ha', 'verrechnungseinheiten'));

INSERT INTO "FEE_MASTERS" ("ID", "FEE_GROUP_ID", "NAME_SHORT", "NAME_LONG", "MIN", "MAX", "BASE_TYPE") VALUES
  (106, 1, '2021_A1_4_8_1', 'Planungsbegleitende Vermessung', 6, 11726, 'verrechnungseinheiten'),
  (107, 1, '2021_A1_4_8_2', 'Bauvermessung', 50000, 10000000, 'cost_eur')
ON CONFLICT ("ID") DO NOTHING;

INSERT INTO "FEE_ZONES" ("ID", "FEE_MASTER_ID", "NAME_SHORT", "NAME_LONG") VALUES
  (1022, 106, 'I', 'sehr geringe Anforderungen'),
  (1023, 106, 'II', 'geringe Anforderungen'),
  (1024, 106, 'III', 'durchschnittliche Anforderungen'),
  (1025, 106, 'IV', 'hohe Anforderungen'),
  (1026, 106, 'V', 'sehr hohe Anforderungen'),
  (1027, 107, 'I', 'sehr geringe Anforderungen'),
  (1028, 107, 'II', 'geringe Anforderungen'),
  (1029, 107, 'III', 'durchschnittliche Anforderungen'),
  (1030, 107, 'IV', 'hohe Anforderungen'),
  (1031, 107, 'V', 'sehr hohe Anforderungen')
ON CONFLICT ("ID") DO NOTHING;

INSERT INTO "FEE_PHASE" ("ID", "FEE_MASTER_ID", "NAME_SHORT", "NAME_LONG", "FEE_PERCENT") VALUES
  (1029, 106, 'LPH 1', 'Grundlagenermittlung', 5),
  (1030, 106, 'LPH 2', 'Geodätischer Raumbezug', 20),
  (1031, 106, 'LPH 3', 'Vermessungstechnische Grundlagen', 65),
  (1032, 106, 'LPH 4', 'Digitales Geländemodell', 10),
  (1033, 107, 'LPH 1', 'Baugeometrische Beratung', 2),
  (1034, 107, 'LPH 2', 'Absteckungsunterlagen', 5),
  (1035, 107, 'LPH 3', 'Bauvorbereitende Vermessung', 16),
  (1036, 107, 'LPH 4', 'Bauausführungsvermessung', 62),
  (1037, 107, 'LPH 5', 'Vermessungstechnische Überwachung der Bauausführung', 15)
ON CONFLICT ("ID") DO NOTHING;

-- Honorartafel Anlage 1.4.8 Abs. 1 (Planungsbegleitende Vermessung, VE).
-- Spaltenbelegung wie im Bestand: ZONE_1..ZONE_TOP sind Bandgrenzen, "bis"
-- der Zone n ist "von" der Zone n+1.
INSERT INTO "FEE_TABLES" ("ID", "FEE_MASTER_ID", "BASE", "ZONE_1", "ZONE_2", "ZONE_3", "ZONE_4", "ZONE_5", "ZONE_TOP") VALUES
  (10101, 106, 6, 658, 777, 914, 1051, 1170, 1289),
  (10102, 106, 20, 953, 1123, 1306, 1489, 1659, 1828),
  (10103, 106, 50, 1480, 1740, 2000, 2260, 2520, 2780),
  (10104, 106, 103, 2225, 2616, 3007, 3399, 3790, 4182),
  (10105, 106, 188, 3325, 3826, 4327, 4829, 5330, 5831),
  (10106, 106, 278, 4320, 4931, 5542, 6153, 6765, 7376),
  (10107, 106, 359, 5156, 5826, 6547, 7217, 7939, 8609),
  (10108, 106, 435, 5881, 6656, 7437, 8212, 8994, 9768),
  (10109, 106, 506, 6547, 7383, 8219, 9055, 9892, 10728),
  (10110, 106, 659, 7867, 8859, 9815, 10809, 11765, 12757),
  (10111, 106, 822, 9187, 10299, 11413, 12513, 13625, 14737),
  (10112, 106, 1105, 11332, 12667, 14002, 15336, 16672, 18006),
  (10113, 106, 1400, 13525, 14977, 16532, 18086, 19642, 21196),
  (10114, 106, 2033, 17714, 19597, 21592, 23586, 25582, 27576),
  (10115, 106, 2713, 21894, 24217, 26652, 29086, 31522, 33956),
  (10116, 106, 3430, 26074, 28837, 31712, 34586, 37462, 40336),
  (10117, 106, 4949, 34434, 38077, 41832, 45586, 49342, 53096),
  (10118, 106, 7385, 46974, 51937, 57012, 62086, 67162, 72236),
  (10119, 106, 11726, 67874, 75037, 82312, 89586, 96862, 104136)
ON CONFLICT ("ID") DO NOTHING;

-- Honorartafel Anlage 1.4.8 Abs. 2 (Bauvermessung, anrechenbare Kosten €).
INSERT INTO "FEE_TABLES" ("ID", "FEE_MASTER_ID", "BASE", "ZONE_1", "ZONE_2", "ZONE_3", "ZONE_4", "ZONE_5", "ZONE_TOP") VALUES
  (10120, 107, 50000, 4282, 4782, 5283, 5839, 6339, 6840),
  (10121, 107, 75000, 4648, 5191, 5734, 6338, 6881, 7424),
  (10122, 107, 100000, 5002, 5586, 6171, 6820, 7405, 7989),
  (10123, 107, 150000, 5684, 6349, 7013, 7751, 8416, 9080),
  (10124, 107, 200000, 6344, 7086, 7827, 8651, 9393, 10134),
  (10125, 107, 250000, 6987, 7804, 8621, 9528, 10345, 11162),
  (10126, 107, 300000, 7618, 8508, 9399, 10388, 11278, 12169),
  (10127, 107, 400000, 8848, 9883, 10917, 12066, 13100, 14134),
  (10128, 107, 500000, 10048, 11222, 12397, 13702, 14876, 16051),
  (10129, 107, 600000, 11223, 12535, 13847, 15304, 16616, 17928),
  (10130, 107, 750000, 12950, 14464, 15978, 17659, 19173, 20687),
  (10131, 107, 1000000, 15754, 17596, 19437, 21483, 23325, 25166),
  (10132, 107, 1500000, 21165, 23639, 26113, 28862, 31336, 33810),
  (10133, 107, 2000000, 26393, 29478, 32563, 35990, 39075, 42160),
  (10134, 107, 2500000, 31488, 35168, 38849, 42938, 46619, 50299),
  (10135, 107, 3000000, 36480, 40744, 45008, 49745, 54009, 58273),
  (10136, 107, 4000000, 46224, 51626, 57029, 63032, 68435, 73838),
  (10137, 107, 5000000, 55720, 62232, 68745, 75981, 82494, 89007),
  (10138, 107, 7500000, 78690, 87888, 97085, 107305, 116502, 125700),
  (10139, 107, 10000000, 100876, 112667, 124458, 137559, 149350, 161140)
ON CONFLICT ("ID") DO NOTHING;

SELECT setval(pg_get_serial_sequence('"FEE_MASTERS"', 'ID'), COALESCE((SELECT MAX("ID") FROM "FEE_MASTERS"), 1));
SELECT setval(pg_get_serial_sequence('"FEE_ZONES"',   'ID'), COALESCE((SELECT MAX("ID") FROM "FEE_ZONES"),   1));
SELECT setval(pg_get_serial_sequence('"FEE_PHASE"',   'ID'), COALESCE((SELECT MAX("ID") FROM "FEE_PHASE"),   1));
SELECT setval(pg_get_serial_sequence('"FEE_TABLES"',  'ID'), COALESCE((SELECT MAX("ID") FROM "FEE_TABLES"),  1));
