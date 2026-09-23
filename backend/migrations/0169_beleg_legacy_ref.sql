-- ============================================================================
-- Migration 0169: LEGACY_REF auf den Belegtabellen
--
-- WARUM
--   Migration 0167 hat die Kennung aus dem Vorsystem fuer PROJECT und
--   PROJECT_STRUCTURE eingefuehrt. Bei der Belegoruebernahme braucht sie jeder
--   Beleg genauso — und dort zusaetzlich aus einem zweiten Grund: der
--   Zahlungsimport muss einen Beleg wiederfinden, der in einem FRUEHEREN
--   Stapel entstanden ist. Die Belegnummer ist dafuer der Regelweg, aber sie
--   ist nicht verlaesslich eindeutig (es gibt nirgends einen Unique-Index auf
--   INVOICE_NUMBER), und sie kann in beiden Belegtabellen vorkommen. Die
--   Kennung des Vorsystems loest beides auf.
--
-- BEWUSST OHNE UNIQUE
--   Wie in 0167: die Kennung stammt aus einem fremden System, Testlauf und
--   Echtlauf duerfen dieselbe tragen. Sie ist eine Spur, kein Schluessel.
--
-- Reines DDL, kein Mandanten-Claim noetig. Alle drei Tabellen tragen ihre
-- RLS-Policy bereits; eine zusaetzliche Spalte aendert daran nichts.
-- ============================================================================

ALTER TABLE "INVOICE"         ADD COLUMN IF NOT EXISTS "LEGACY_REF" TEXT;
ALTER TABLE "ADVANCE_INVOICE" ADD COLUMN IF NOT EXISTS "LEGACY_REF" TEXT;
ALTER TABLE "PAYMENT"         ADD COLUMN IF NOT EXISTS "LEGACY_REF" TEXT;

-- Nur dort indiziert, wo ueberhaupt etwas steht: gefuellt ist die Spalte nur
-- bei importierten Zeilen. Gesucht wird darin vom Zahlungsimport (je Stapel
-- einmal, gebuendelt) und von Hand bei einer Rueckfrage.
CREATE INDEX IF NOT EXISTS idx_invoice_legacy_ref
  ON "INVOICE"("TENANT_ID", "LEGACY_REF") WHERE "LEGACY_REF" IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_advance_invoice_legacy_ref
  ON "ADVANCE_INVOICE"("TENANT_ID", "LEGACY_REF") WHERE "LEGACY_REF" IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_payment_legacy_ref
  ON "PAYMENT"("TENANT_ID", "LEGACY_REF") WHERE "LEGACY_REF" IS NOT NULL;

COMMENT ON COLUMN "INVOICE"."LEGACY_REF" IS
  'Kennung dieses Belegs im Vorsystem (Datenuebernahme). Keine fachliche Bedeutung, nicht eindeutig.';
COMMENT ON COLUMN "ADVANCE_INVOICE"."LEGACY_REF" IS
  'Kennung dieses Belegs im Vorsystem (Datenuebernahme). Keine fachliche Bedeutung, nicht eindeutig.';
COMMENT ON COLUMN "PAYMENT"."LEGACY_REF" IS
  'Kennung dieser Zahlung im Vorsystem (Datenuebernahme). Keine fachliche Bedeutung, nicht eindeutig.';
