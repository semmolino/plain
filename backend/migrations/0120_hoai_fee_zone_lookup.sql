-- Migration 0120 — Honorarzonen-Objektliste (Tragwerksplanung)
--
-- Bislang muss die Honorarzone im Kalkulationsmodul frei geschätzt werden.
-- Für mehrere Leistungsbilder definiert die HOAI dafür eine "Objektliste":
-- eine Tabelle, die typische Sachverhalte je nach Schwierigkeitsgrad genau
-- einer Zone zuordnet. Diese Migration legt die dafür nötige Referenztabelle
-- an und befüllt sie für Tragwerksplanung (Anlage 14.2 zu § 52).
--
-- WICHTIG — kein einheitliches Punktesystem über alle Leistungsbilder:
--   - Objektliste (Nachschlagetabelle, dieses Muster): Gebäude/Innenräume
--     (Anlage 10.2/10.3 zu § 35), Freianlagen (11.2 zu § 40),
--     Ingenieurbauwerke (12.2 zu § 44), Verkehrsanlagen (13.2 zu § 48),
--     Technische Ausrüstung (15.2 zu § 56), Tragwerksplanung (14.2 zu § 52
--     — trotz der Paragraphenformulierung "Bewertungsmerkmale" tatsächlich
--     eine Zeilen-Auswahl-Tabelle, keine Punkte-Summierung).
--   - Numerisches Punktesystem (mehrere Kriterien einzeln bewerten, Summe
--     bandet in eine Zone): u. a. UVS (Anlage 1.1.2), Ingenieurvermessung
--     (Anlage 1.4.3/1.4.6), vermutlich Bauleitplanung/Landschaftsplanung
--     (noch nicht verifiziert). Dieses Muster bildet FEE_ZONE_LOOKUP NICHT
--     ab — dafür wäre eine andere Tabelle (Kriterien + Punktwerte) nötig.
-- Diese Migration deckt ausschließlich die Objektliste-Variante ab, mit
-- Tragwerksplanung als erstem (kleinstem) Leistungsbild.
--
-- Schema: FEE_MASTER_ID + CATEGORY (die Gliederungsüberschrift der Anlage,
-- z. B. "Stützwände, Verbau") + DESCRIPTION (der Sachverhaltstext) + ZONE_ID.
-- Globale Referenztabelle ohne TENANT_ID (wie FEE_ZONES/FEE_PHASE/
-- FEE_TABLES) — für alle Mandanten dieselben Zeilen.
--
-- UI: HonorarWizard → Schritt Basisdaten → Button "Zone anhand Objektliste
-- bestimmen …" neben dem Zonen-Dropdown, öffnet ObjektlisteZonePicker.tsx.
-- Übernommene Zone bleibt danach im Dropdown frei änderbar — die Software
-- entscheidet nicht automatisch, sie zeigt nur die passende Zuordnung an.
--
-- Quelle: HOAI (BGBl. I 2013, 2276; Anlage 14: BGBl. I 2013, 2358–2364),
-- zuletzt geändert durch Art. 3 G v. 22.3.2023. Zeilen maschinell aus dem
-- amtlichen Volltext geparst (54/54 Zeilen mit genau einer Zonen-Markierung,
-- keine Warnungen), nicht abgetippt.
--
-- Voraussetzung: 0115_hoai_reference_seed.sql (FEE_ZONES-IDs 50–54 =
-- Tragwerksplanung-Zonen I–V).
-- Manuell im Supabase SQL-Editor ausführen (als ganzes Skript, nicht
-- Anweisung für Anweisung).

CREATE TABLE IF NOT EXISTS "FEE_ZONE_LOOKUP" (
  "ID"            SERIAL PRIMARY KEY,
  "FEE_MASTER_ID" INTEGER NOT NULL REFERENCES "FEE_MASTERS"("ID") ON DELETE CASCADE,
  "CATEGORY"      VARCHAR(255),
  "DESCRIPTION"   TEXT NOT NULL,
  "ZONE_ID"       INTEGER NOT NULL REFERENCES "FEE_ZONES"("ID"),
  "SORT_ORDER"    INTEGER NOT NULL DEFAULT 0,
  "created_at"    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS "idx_fee_zone_lookup_master" ON "FEE_ZONE_LOOKUP" ("FEE_MASTER_ID");

-- Anlage 14.2: Objektliste Tragwerksplanung (FEE_MASTER_ID 13).
-- ZONE_ID-Zuordnung: I=50, II=51, III=52, IV=53, V=54 (aus 0115).
INSERT INTO "FEE_ZONE_LOOKUP" ("ID", "FEE_MASTER_ID", "CATEGORY", "DESCRIPTION", "ZONE_ID", "SORT_ORDER") VALUES
  (1, 13, 'Bewertungsmerkmale zur Ermittlung der Honorarzone bei der Tragwerksplanung', 'Tragwerke mit sehr geringem Schwierigkeitsgrad, insbesondere einfache statisch bestimmte ebene Tragwerke aus Holz, Stahl, Stein oder unbewehrtem Beton mit ruhenden Lasten, ohne Nachweis horizontaler Aussteifung', 50, 1),
  (2, 13, 'Bewertungsmerkmale zur Ermittlung der Honorarzone bei der Tragwerksplanung', 'Tragwerke mit geringem Schwierigkeitsgrad, insbesondere statisch bestimmte ebene Tragwerke in gebräuchlichen Bauarten ohne Vorspann- und Verbundkonstruktionen, mit vorwiegend ruhenden Lasten', 51, 2),
  (3, 13, 'Bewertungsmerkmale zur Ermittlung der Honorarzone bei der Tragwerksplanung', 'Tragwerke mit durchschnittlichem Schwierigkeitsgrad, insbesondere schwierige statisch bestimmte und statisch unbestimmte ebene Tragwerke in gebräuchlichen Bauarten und ohne Gesamtstabilitätsuntersuchungen', 52, 3),
  (4, 13, 'Bewertungsmerkmale zur Ermittlung der Honorarzone bei der Tragwerksplanung', 'Tragwerke mit hohem Schwierigkeitsgrad, insbesondere statisch und konstruktiv schwierige Tragwerke in gebräuchlichen Bauarten und Tragwerke, für deren Standsicherheit- und Festigkeitsnachweis schwierig zu ermittelnde Einflüsse zu berücksichtigen sind', 53, 4),
  (5, 13, 'Bewertungsmerkmale zur Ermittlung der Honorarzone bei der Tragwerksplanung', 'Tragwerke mit sehr hohem Schwierigkeitsgrad, insbesondere statisch und konstruktiv ungewöhnlich schwierige Tragwerke', 54, 5),
  (6, 13, 'Stützwände, Verbau', 'unverankerte Stützwände zur Abfangung von Geländesprüngen bis 2 m Höhe und konstruktive Böschungssicherungen bei einfachen Baugrund-, Belastungs- und Geländeverhältnissen', 50, 6),
  (7, 13, 'Stützwände, Verbau', 'Sicherung von Geländesprüngen bis 4 m Höhe ohne Rückverankerungen bei einfachen Baugrund-, Belastungs- und Geländeverhältnissen wie z. B. Stützwände, Uferwände, Baugrubenverbauten', 51, 7),
  (8, 13, 'Stützwände, Verbau', 'Sicherung von Geländesprüngen ohne Rückverankerungen bei schwierigen Baugrund-, Belastungs- oder Geländeverhältnissen oder mit einfacher Rückverankerung bei einfachen Baugrund-, Belastungs- oder Geländeverhältnissen wie z. B. Stützwände, Uferwände, Baugrubenverbauten', 52, 8),
  (9, 13, 'Stützwände, Verbau', 'schwierige, verankerte Stützwände, Baugrubenverbauten oder Uferwände', 53, 9),
  (10, 13, 'Stützwände, Verbau', 'Baugrubenverbauten mit ungewöhnlich schwierigen Randbedingungen', 54, 10),
  (11, 13, 'Gründung', 'Flachgründungen einfacher Art', 51, 11),
  (12, 13, 'Gründung', 'Flachgründungen mit durchschnittlichem Schwierigkeitsgrad, ebene und räumliche Pfahlgründungen mit durchschnittlichem Schwierigkeitsgrad', 52, 12),
  (13, 13, 'Gründung', 'schwierige Flachgründungen, schwierige ebene und räumliche Pfahlgründungen, besondere Gründungsverfahren, Unterfahrungen', 53, 13),
  (14, 13, 'Mauerwerk', 'Mauerwerksbauten mit bis zur Gründung durchgehenden tragenden Wänden ohne Nachweis horizontaler Aussteifung', 51, 14),
  (15, 13, 'Mauerwerk', 'Tragwerke mit Abfangung der tragenden beziehungsweise aussteifenden Wände', 52, 15),
  (16, 13, 'Mauerwerk', 'Konstruktionen mit Mauerwerk nach Eignungsprüfung (Ingenieurmauerwerk)', 53, 16),
  (17, 13, 'Gewölbe', 'einfache Gewölbe', 52, 17),
  (18, 13, 'Gewölbe', 'schwierige Gewölbe und Gewölbereihen', 53, 18),
  (19, 13, 'Deckenkonstruktionen, Flächentragwerke', 'Deckenkonstruktionen mit einfachem Schwierigkeitsgrad, bei vorwiegend ruhenden Flächenlasten', 51, 19),
  (20, 13, 'Deckenkonstruktionen, Flächentragwerke', 'Deckenkonstruktionen mit durchschnittlichem Schwierigkeitsgrad', 52, 20),
  (21, 13, 'Deckenkonstruktionen, Flächentragwerke', 'schiefwinklige Einfeldplatten', 53, 21),
  (22, 13, 'Deckenkonstruktionen, Flächentragwerke', 'schiefwinklige Mehrfeldplatten', 54, 22),
  (23, 13, 'Deckenkonstruktionen, Flächentragwerke', 'schiefwinklig gelagerte oder gekrümmte Träger', 53, 23),
  (24, 13, 'Deckenkonstruktionen, Flächentragwerke', 'schiefwinklig gelagerte, gekrümmte Träger', 54, 24),
  (25, 13, 'Deckenkonstruktionen, Flächentragwerke', 'Trägerroste und orthotrope Platten mit durchschnittlichem Schwierigkeitsgrad', 53, 25),
  (26, 13, 'Deckenkonstruktionen, Flächentragwerke', 'schwierige Trägerroste und schwierige orthotrope Platten', 54, 26),
  (27, 13, 'Deckenkonstruktionen, Flächentragwerke', 'Flächentragwerke (Platten, Scheiben) mit durchschnittlichem Schwierigkeitsgrad', 53, 27),
  (28, 13, 'Deckenkonstruktionen, Flächentragwerke', 'schwierige Flächentragwerke (Platten, Scheiben, Faltwerke, Schalen)', 54, 28),
  (29, 13, 'Deckenkonstruktionen, Flächentragwerke', 'einfache Faltwerke ohne Vorspannung', 53, 29),
  (30, 13, 'Verbund-Konstruktionen', 'einfache Verbundkonstruktionen ohne Berücksichtigung des Einflusses von Kriechen und Schwinden', 52, 30),
  (31, 13, 'Verbund-Konstruktionen', 'Verbundkonstruktionen mittlerer Schwierigkeit', 53, 31),
  (32, 13, 'Verbund-Konstruktionen', 'Verbundkonstruktionen mit Vorspannung durch Spannglieder oder andere Maßnahmen', 54, 32),
  (33, 13, 'Rahmen- und Skelettbauten', 'ausgesteifte Skelettbauten', 52, 33),
  (34, 13, 'Rahmen- und Skelettbauten', 'Tragwerke für schwierige Rahmen- und Skelettbauten sowie turmartige Bauten, bei denen der Nachweis der Stabilität und Aussteifung die Anwendung besonderer Berechnungsverfahren erfordert', 53, 34),
  (35, 13, 'Rahmen- und Skelettbauten', 'einfache Rahmentragwerke ohne Vorspannkonstruktionen und ohne Gesamtstabilitätsuntersuchungen', 52, 35),
  (36, 13, 'Rahmen- und Skelettbauten', 'Rahmentragwerke mit durchschnittlichem Schwierigkeitsgrad', 53, 36),
  (37, 13, 'Rahmen- und Skelettbauten', 'schwierige Rahmentragwerke mit Vorspannkonstruktionen und Stabilitätsuntersuchungen', 54, 37),
  (38, 13, 'Räumliche Stabwerke', 'räumliche Stabwerke mit durchschnittlichem Schwierigkeitsgrad', 53, 38),
  (39, 13, 'Räumliche Stabwerke', 'schwierige räumliche Stabwerke', 54, 39),
  (40, 13, 'Seilverspannte Konstruktionen', 'einfache seilverspannte Konstruktionen', 53, 40),
  (41, 13, 'Seilverspannte Konstruktionen', 'seilverspannte Konstruktionen mit durchschnittlichem bis sehr hohem Schwierigkeitsgrad', 54, 41),
  (42, 13, 'Konstruktionen mit Schwingungsbeanspruchung', 'Tragwerke mit einfachen Schwingungsuntersuchungen', 53, 42),
  (43, 13, 'Konstruktionen mit Schwingungsbeanspruchung', 'Tragwerke mit Schwingungsuntersuchungen mit durchschnittlichem bis sehr hohem Schwierigkeitsgrad', 54, 43),
  (44, 13, 'Besondere Berechnungsmethoden', 'schwierige Tragwerke, die Schnittgrößenbestimmungen nach der Theorie II. Ordnung erfordern', 53, 44),
  (45, 13, 'Besondere Berechnungsmethoden', 'ungewöhnlich schwierige Tragwerke, die Schnittgrößenbestimmungen nach der Theorie II. Ordnung erfordern', 54, 45),
  (46, 13, 'Besondere Berechnungsmethoden', 'schwierige Tragwerke in neuen Bauarten', 54, 46),
  (47, 13, 'Besondere Berechnungsmethoden', 'Tragwerke mit Standsicherheitsnachweisen, die nur unter Zuhilfenahme modellstatischer Untersuchungen oder durch Berechnungen mit finiten Elementen beurteilt werden können', 54, 47),
  (48, 13, 'Besondere Berechnungsmethoden', 'Tragwerke, bei denen die Nachgiebigkeit der Verbindungsmittel bei der Schnittkraftermittlung zu berücksichtigen ist', 54, 48),
  (49, 13, 'Spannbeton', 'einfache, äußerlich und innerlich statisch bestimmte und zwängungsfrei gelagerte vorgespannte Konstruktionen', 52, 49),
  (50, 13, 'Spannbeton', 'vorgespannte Konstruktionen mit durchschnittlichem Schwierigkeitsgrad', 53, 50),
  (51, 13, 'Spannbeton', 'vorgespannte Konstruktionen mit hohem bis sehr hohem Schwierigkeitsgrad', 54, 51),
  (52, 13, 'Trag-Gerüste', 'einfache Traggerüste und andere einfache Gerüste für Ingenieurbauwerke', 51, 52),
  (53, 13, 'Trag-Gerüste', 'schwierige Traggerüste und andere schwierige Gerüste für Ingenieurbauwerke', 53, 53),
  (54, 13, 'Trag-Gerüste', 'sehr schwierige Traggerüste und andere sehr schwierige Gerüste für Ingenieurbauwerke, zum Beispiel weit gespannte oder hohe Traggerüste', 54, 54)
ON CONFLICT ("ID") DO NOTHING;

SELECT setval(pg_get_serial_sequence('"FEE_ZONE_LOOKUP"', 'ID'), COALESCE((SELECT MAX("ID") FROM "FEE_ZONE_LOOKUP"), 1));
