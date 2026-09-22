-- ============================================================================
-- Migration 0167: LEGACY_REF — die Kennung aus dem Vorsystem festhalten
--
-- WARUM
--   Bei einer Datenuebernahme (wiko, andere Altsysteme) faellt zu jeder Zeile
--   eine Kennung des Vorsystems an. Sie ist nicht fachlich, aber sie ist das
--   einzige, was einen importierten Datensatz spaeter noch mit seiner Quelle
--   verbindet: "welches wiko-Element ist dieser Knoten geworden?"
--
--   Ohne sie bleibt bei jeder Rueckfrage nur der Abgleich ueber Name und
--   Betrag — und genau der versagt dort, wo man ihn braucht: bei doppelten
--   Kuerzeln, umbenannten Positionen und bei der Frage, warum eine Zeile NICHT
--   angekommen ist.
--
-- BEWUSST OHNE UNIQUE
--   Die Kennung stammt aus einem fremden System. Zwei Uebernahmen in denselben
--   Mandanten (Testlauf, dann Echtlauf nach Zuruecksetzen) koennen dieselbe
--   Kennung tragen, und eine Unique-Regel wuerde daraus einen Abbruch machen.
--   Sie ist eine Spur, kein Schluessel. Siehe auch die Regel zur Eindeutigkeit
--   in CLAUDE.md — hier gehoert der Wert nicht einmal dem Mandanten.
--
-- Reines DDL, kein Mandanten-Claim noetig. Beide Tabellen tragen ihre
-- RLS-Policy bereits; eine zusaetzliche Spalte aendert daran nichts.
-- ============================================================================

ALTER TABLE "PROJECT"           ADD COLUMN IF NOT EXISTS "LEGACY_REF" TEXT;
ALTER TABLE "PROJECT_STRUCTURE" ADD COLUMN IF NOT EXISTS "LEGACY_REF" TEXT;

-- Kein Index auf Gleichheit, sondern nur dort, wo ueberhaupt etwas steht:
-- gefuellt ist die Spalte nur bei importierten Zeilen, und gesucht wird in
-- ihr von Hand bei einer Rueckfrage, nicht im laufenden Betrieb.
CREATE INDEX IF NOT EXISTS idx_project_legacy_ref
  ON "PROJECT"("TENANT_ID", "LEGACY_REF") WHERE "LEGACY_REF" IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_project_structure_legacy_ref
  ON "PROJECT_STRUCTURE"("TENANT_ID", "LEGACY_REF") WHERE "LEGACY_REF" IS NOT NULL;

COMMENT ON COLUMN "PROJECT"."LEGACY_REF" IS
  'Kennung dieses Datensatzes im Vorsystem (Datenuebernahme). Keine fachliche Bedeutung, nicht eindeutig.';
COMMENT ON COLUMN "PROJECT_STRUCTURE"."LEGACY_REF" IS
  'Kennung dieses Elements im Vorsystem (Datenuebernahme). Keine fachliche Bedeutung, nicht eindeutig.';
