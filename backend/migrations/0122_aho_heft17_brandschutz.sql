-- Migration 0122 — AHO Heft 17: Bauordnungsrechtlicher Brandschutz
--
-- Zweites AHO-Leistungsbild (nach Heft 9, Migration 0121). Anders als Heft 9
-- lag hier eine echte, lesbare Quelle vor (User-Hinweis, siehe
-- reference_aho_heft17_source-Memory):
--   https://www.buero-romig.de/Home/Downloadbereich/downloadbereich.html
--   "Leistungsbild und Honorierung gemäß AHO Heft 17 2022" (Stand Dez. 2022)
-- Alle Werte unten sind gegen den PDF-Volltext bzw. die als Bild gerenderten
-- Seiten geprüft (pdftotext -table lieferte bei zweispaltigen Tabellen
-- zunächst FALSCH ausgerichtete Werte — erst der visuelle Seitenvergleich
-- über pdftoppm hat das aufgedeckt und die -table-Extraktion bestätigt).
--
-- HONORARFORMEL (Nr. 1.5, Seite 8, visuell verifiziert):
--   Aq = Σ (Ai · ni · si)   — Gesamt-Flächenäquivalent (m²)
--   si = (1,0 + Σ sP) · (1,0 + Σ sT)
--   H  = 2.600 € + f · Aq^0,61
--   f nach Jahr der Beauftragung: 2022=170, 2023=173, 2024=177, 2025=180,
--     2026=184, 2027=188, 2028=191
--
-- Das ist strukturell etwas ANDERES als BASE_TYPE 'percent_of_baukosten'
-- (Heft 9): keine Prozentsatz-Multiplikation, sondern eine geschlossene
-- Potenzformel mit Sockelbetrag. Neuer, Heft-17-spezifischer BASE_TYPE
-- 'flaechenaequivalent_brandschutz' (bewusst NICHT generisch benannt — diese
-- Formel gilt nur für dieses Leistungsbild, anders als percent_of_baukosten,
-- das für mehrere AHO-Hefte passen könnte).
--
-- K0 trägt Aq (m², vom Vertrag/Nutzer extern aus den Kalkulationseinheiten
-- ermittelt — kein Kalkulationseinheiten-Rechner in der UI, dieselbe
-- Vereinfachung wie bei Verrechnungseinheiten/Anlage 1.4). ZONE_PERCENT wird
-- zum Faktor f zweckentfremdet (kein Zonen-Konzept, kein Prozentsatz).
--
-- NICHT in der Datenbank abgelegt, nur im Wizard-Hinweistext (Aq-Formel +
-- f-Tabelle) und hier dokumentiert — zu granular für eine eigene Tabelle,
-- ohne dass sie praktisch genutzt würde (kein Kalkulationseinheiten-Rechner):
--   Nutzungsbeiwerte n (20 Nutzungsarten 0,6–3,0: Garage 0,7; eingeschossiger
--     Industriebau 0,6; Industriebau mit Ebenen 0,8; Technikfläche/Wohnen/
--     Messe+Ausstellung/Büro/Sportstätte 1,0; Verkauf 1,2; Gaststätte/
--     Beherbergungsstätte 1,4; Kindergarten,Schule,Hochschule/physikalisches
--     Labor 1,5; Justizvollzugsanstalt 1,6; Krankenhaus,Pflegeheim 1,8;
--     Abfertigungsgebäude/Kraftwerk 2,0; Versammlungsstätte,Diskothek 2,5;
--     chemisch-biologisches Labor/Funktionsbereiche im Krankenhaus 3,0)
--   Schwierigkeitsbeiwerte sP (Projekt, 8 Kriterien 0,1–0,6, additiv),
--     sT (Teilfläche, 6 Kriterien 0,1–0,3, additiv)
-- Bei Bedarf (Kalkulationseinheiten-Rechner als Ausbaustufe) siehe
-- docs/HOAI_LEISTUNGSBILDER_ROADMAP.md § 9 für den vollständigen Datensatz.
--
-- Leistungsphasen (Nr. 1.3, Seite 3, Summenprobe 1+15+19+15+18+32=100 ✓):
-- LPH 6 (Vorbereiten der Vergabe) und LPH 7 (Mitwirken bei der Vergabe) sind
-- laut Tabelle NICHT Teil der Regelleistungen ("–") — keine Zeilen dafür,
-- wie bei anderen Leistungsbildern ohne vollständige LPH-Reihe (z. B.
-- Bauleitplanung).
--
-- Manuell im Supabase SQL-Editor ausführen (als ganzes Skript).

ALTER TABLE "FEE_MASTERS" DROP CONSTRAINT IF EXISTS chk_fee_masters_base_type;
ALTER TABLE "FEE_MASTERS" ADD CONSTRAINT chk_fee_masters_base_type
  CHECK ("BASE_TYPE" IN ('cost_eur', 'area_ha', 'verrechnungseinheiten', 'percent_of_baukosten', 'flaechenaequivalent_brandschutz'));

INSERT INTO "FEE_MASTERS" ("ID", "FEE_GROUP_ID", "NAME_SHORT", "NAME_LONG", "MIN", "MAX", "BASE_TYPE") VALUES
  (109, 2, 'AHO_17', 'Brandschutz (bauordnungsrechtlich)', NULL, NULL, 'flaechenaequivalent_brandschutz')
ON CONFLICT ("ID") DO NOTHING;

INSERT INTO "FEE_PHASE" ("ID", "FEE_MASTER_ID", "NAME_SHORT", "NAME_LONG", "FEE_PERCENT") VALUES
  (1038, 109, 'LPH 1', 'Grundlagenermittlung', 1),
  (1039, 109, 'LPH 2', 'Vorplanung', 15),
  (1040, 109, 'LPH 3', 'Entwurfsplanung', 19),
  (1041, 109, 'LPH 4', 'Genehmigungsplanung', 15),
  (1042, 109, 'LPH 5', 'Ausführungsplanung', 18),
  (1043, 109, 'LPH 8', 'Objektüberwachung', 32)
ON CONFLICT ("ID") DO NOTHING;

SELECT setval(pg_get_serial_sequence('"FEE_MASTERS"', 'ID'), COALESCE((SELECT MAX("ID") FROM "FEE_MASTERS"), 1));
SELECT setval(pg_get_serial_sequence('"FEE_PHASE"',   'ID'), COALESCE((SELECT MAX("ID") FROM "FEE_PHASE"),   1));
