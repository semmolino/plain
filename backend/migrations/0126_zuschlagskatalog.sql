-- Migration 0126 — Zuschlagskatalog (FEE_SURCHARGES befüllen)
--
-- Der Anwendungs-Mechanismus für Zuschläge ist seit 0039 fertig
-- (FEE_CALCULATION_SURCHARGES: Prozent oder Festbetrag, wahlweise auf
-- einzelne Leistungsphasen oder BL-Posten begrenzt, parallel/kumulativ).
-- Leer war nur der KATALOG: FEE_SURCHARGES und FEE_SURCHARGES2MASTER hatten
-- keine einzige Zeile, jede Nutzerin tippte Name und Prozentsatz frei ein.
--
-- Diese Migration füllt ihn — mit den Werten, die tatsächlich in der HOAI
-- stehen, gegen den amtlichen Volltext geprüft. Damit die Vorschläge mehr
-- sind als Namen, bekommt FEE_SURCHARGES drei neue Spalten:
--   DEFAULT_PERCENT  Vorschlagswert beim Hinzufügen
--   MAX_PERCENT      gesetzliche Obergrenze (Hinweis in der Oberfläche)
--   LEGAL_REF        Fundstelle, damit die Herkunft nachprüfbar bleibt
--
-- DIE OBERGRENZEN UNTERSCHEIDEN SICH JE LEISTUNGSBILD — deshalb zwei
-- getrennte Katalogeinträge für den Umbauzuschlag:
--   bis 33 %: Gebäude (§ 36 Abs. 1), Freianlagen (§ 40 Abs. 6 → § 36 Abs. 1),
--             Ingenieurbauwerke (§ 44 Abs. 6), Verkehrsanlagen (§ 48 Abs. 6),
--             Bauphysik (Anlage 1.2.3/1.2.4/1.2.5 Abs. 3)
--   bis 50 %: Innenräume (§ 36 Abs. 2), Tragwerksplanung (§ 52 Abs. 4),
--             TGA (§ 56 Abs. 5)
-- Für Geotechnik, UVS und Ingenieurvermessung sieht die HOAI KEINEN
-- Umbauzuschlag vor — dort bewusst nicht verknüpft.
--
-- DEFAULT_PERCENT ist überall 20 %, weil § 6 Abs. 2 Satz 4 genau das als
-- vereinbart fingiert, wenn nichts in Textform vereinbart wurde. Die
-- Obergrenzen (33/50) gelten laut Gesetzestext "bei einem durchschnittlichen
-- Schwierigkeitsgrad" und setzen eine Vereinbarung in Textform voraus.
--
-- INSTANDSETZUNG (§ 12 Abs. 2) erhöht den Prozentsatz der Objektüberwachung
-- bzw. Bauoberleitung um bis zu 50 % — also NICHT das Gesamthonorar. In der
-- Berechnung ist der Zuschlag deshalb über den LPH-Filter auf die
-- Objektüberwachung zu begrenzen; rechnerisch ist das gleichwertig zu einer
-- Erhöhung des Phasen-Prozentsatzes. Nur verknüpft mit Leistungsbildern, die
-- überhaupt eine LPH 8 haben (Tragwerksplanung, Bauphysik, Geotechnik, UVS
-- und Vermessung haben keine).
--
-- WIEDERHOLUNG (§ 11 Abs. 3) ist eine MINDERUNG, keine Erhöhung: die
-- Prozentsätze der Leistungsphasen 1 bis 6 sind für die 1.–4. Wiederholung um
-- 50 %, für die 5.–7. um 60 % und ab der 8. um 90 % zu mindern. Deshalb drei
-- Einträge mit NEGATIVEM DEFAULT_PERCENT und dem Hinweis, den LPH-Filter auf
-- LPH 1–6 zu setzen. § 11 Abs. 3 nennt ausdrücklich Gebäude,
-- Ingenieurbauwerke, Verkehrsanlagen und Tragwerke; § 54 Abs. 3 erstreckt die
-- Rechtsfolge auf die Technische Ausrüstung — genau diese fünf sind verknüpft.
--
-- NEBENKOSTEN (§ 14) haben BEWUSST keinen Vorschlagswert: die HOAI nennt
-- keinen Prozentsatz, sondern lässt pauschal oder Einzelnachweis zu. Ein
-- erfundener Default sähe hier aus wie ein Gesetzeswert.
--
-- Der Katalog gilt für beide HOAI-Fassungen (2021 und die 2013er
-- Leistungsbilder aus Migration 0123) — die genannten Paragraphen sind in
-- beiden Fassungen wortgleich.
--
-- Quelle: HOAI (BGBl. I 2013, 2276), zuletzt geändert durch Art. 3 G v.
-- 22.3.2023 — §§ 6, 11, 12, 14, 36, 40, 44, 48, 52, 56 und Anlage 1.2.
--
-- Voraussetzung: 0115–0119 (Leistungsbilder 2021), 0123 (HOAI 2013).
-- Manuell im Supabase SQL-Editor ausführen (als ganzes Skript).

-- ── Schema-Erweiterung ────────────────────────────────────────────────────
ALTER TABLE "FEE_SURCHARGES" ADD COLUMN IF NOT EXISTS "DEFAULT_PERCENT" DECIMAL(6,2);
ALTER TABLE "FEE_SURCHARGES" ADD COLUMN IF NOT EXISTS "MAX_PERCENT"     DECIMAL(6,2);
ALTER TABLE "FEE_SURCHARGES" ADD COLUMN IF NOT EXISTS "LEGAL_REF"       VARCHAR(120);

-- ── Katalog ───────────────────────────────────────────────────────────────
INSERT INTO "FEE_SURCHARGES" ("ID", "NAME_SHORT", "NAME_LONG", "SURCHARGE_TYPE", "DEFAULT_PERCENT", "MAX_PERCENT", "LEGAL_REF") VALUES
  (1, 'Umbauzuschlag', 'Umbau- oder Modernisierungszuschlag bei durchschnittlichem Schwierigkeitsgrad. Ohne Vereinbarung in Textform gelten 20 % als vereinbart (§ 6 Abs. 2 Satz 4).', 'umbau', 20, 33, '§ 6 Abs. 2, § 36 Abs. 1'),
  (2, 'Umbauzuschlag', 'Umbau- oder Modernisierungszuschlag bei durchschnittlichem Schwierigkeitsgrad. Ohne Vereinbarung in Textform gelten 20 % als vereinbart (§ 6 Abs. 2 Satz 4).', 'umbau', 20, 50, '§ 6 Abs. 2, § 36 Abs. 2'),
  (3, 'Instandsetzung', 'Erhöhung des Prozentsatzes für die Objektüberwachung bzw. Bauoberleitung bei Instandsetzungen und Instandhaltungen. LPH-Filter auf die Objektüberwachung setzen — der Zuschlag gilt nur für diese Leistungsphase.', 'instandsetzung', NULL, 50, '§ 12 Abs. 2'),
  (4, 'Wiederholung 1.–4.', 'Minderung der Prozentsätze der Leistungsphasen 1 bis 6 um 50 % für die erste bis vierte Wiederholung. LPH-Filter auf LPH 1–6 setzen.', 'minderung', -50, NULL, '§ 11 Abs. 3'),
  (5, 'Wiederholung 5.–7.', 'Minderung der Prozentsätze der Leistungsphasen 1 bis 6 um 60 % für die fünfte bis siebte Wiederholung. LPH-Filter auf LPH 1–6 setzen.', 'minderung', -60, NULL, '§ 11 Abs. 3'),
  (6, 'Wiederholung ab 8.', 'Minderung der Prozentsätze der Leistungsphasen 1 bis 6 um 90 % ab der achten Wiederholung. LPH-Filter auf LPH 1–6 setzen.', 'minderung', -90, NULL, '§ 11 Abs. 3'),
  (7, 'Nebenkosten', 'Erforderliche Nebenkosten (Versand, Vervielfältigung, Baustellenbüro, Fahrtkosten über 15 km u. a.). Pauschal oder nach Einzelnachweis — die HOAI nennt bewusst keinen Prozentsatz.', 'nebenkosten', NULL, NULL, '§ 14')
ON CONFLICT ("ID") DO NOTHING;

-- ── Zuordnung Zuschlag → Leistungsbild ────────────────────────────────────
-- Maschinell erzeugt (gen_surcharges.js im Session-Scratchpad); je Eintrag
-- einmal für das 2021er und einmal für das 2013er Leistungsbild (+1000).
INSERT INTO "FEE_SURCHARGES2MASTER" ("ID", "FEE_MASTER_ID", "FEE_SURCHARGE_ID") VALUES
  (1, 1, 1),
  (2, 1001, 1),
  (3, 10, 1),
  (4, 1010, 1),
  (5, 11, 1),
  (6, 1011, 1),
  (7, 12, 1),
  (8, 1012, 1),
  (9, 101, 1),
  (10, 1101, 1),
  (11, 102, 1),
  (12, 1102, 1),
  (13, 103, 1),
  (14, 1103, 1),
  (15, 9, 2),
  (16, 1009, 2),
  (17, 13, 2),
  (18, 1013, 2),
  (19, 14, 2),
  (20, 1014, 2),
  (21, 1, 3),
  (22, 1001, 3),
  (23, 9, 3),
  (24, 1009, 3),
  (25, 10, 3),
  (26, 1010, 3),
  (27, 11, 3),
  (28, 1011, 3),
  (29, 12, 3),
  (30, 1012, 3),
  (31, 14, 3),
  (32, 1014, 3),
  (33, 1, 4),
  (34, 1001, 4),
  (35, 11, 4),
  (36, 1011, 4),
  (37, 12, 4),
  (38, 1012, 4),
  (39, 13, 4),
  (40, 1013, 4),
  (41, 14, 4),
  (42, 1014, 4),
  (43, 1, 5),
  (44, 1001, 5),
  (45, 11, 5),
  (46, 1011, 5),
  (47, 12, 5),
  (48, 1012, 5),
  (49, 13, 5),
  (50, 1013, 5),
  (51, 14, 5),
  (52, 1014, 5),
  (53, 1, 6),
  (54, 1001, 6),
  (55, 11, 6),
  (56, 1011, 6),
  (57, 12, 6),
  (58, 1012, 6),
  (59, 13, 6),
  (60, 1013, 6),
  (61, 14, 6),
  (62, 1014, 6),
  (63, 1, 7),
  (64, 1001, 7),
  (65, 9, 7),
  (66, 1009, 7),
  (67, 10, 7),
  (68, 1010, 7),
  (69, 11, 7),
  (70, 1011, 7),
  (71, 12, 7),
  (72, 1012, 7),
  (73, 13, 7),
  (74, 1013, 7),
  (75, 14, 7),
  (76, 1014, 7),
  (77, 101, 7),
  (78, 1101, 7),
  (79, 102, 7),
  (80, 1102, 7),
  (81, 103, 7),
  (82, 1103, 7),
  (83, 104, 7),
  (84, 1104, 7),
  (85, 105, 7),
  (86, 1105, 7),
  (87, 106, 7),
  (88, 1106, 7),
  (89, 107, 7),
  (90, 1107, 7)
ON CONFLICT ("ID") DO NOTHING;

SELECT setval(pg_get_serial_sequence('"FEE_SURCHARGES"',        'ID'), COALESCE((SELECT MAX("ID") FROM "FEE_SURCHARGES"),        1));
SELECT setval(pg_get_serial_sequence('"FEE_SURCHARGES2MASTER"', 'ID'), COALESCE((SELECT MAX("ID") FROM "FEE_SURCHARGES2MASTER"), 1));
