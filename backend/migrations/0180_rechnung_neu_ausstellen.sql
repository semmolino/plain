-- ============================================================================
-- 0180_rechnung_neu_ausstellen.sql — „Stornieren und neu ausstellen"
--
-- WARUM
--   Bisher hiess eine fehlerhafte Rechnung: stornieren, danach im Assistenten
--   von vorn anlegen. Eingegangene Zahlungen blieben am stornierten Original
--   haengen oder wurden mit dem Storno geloescht und mussten neu erfasst
--   werden — uebertragen liessen sie sich nicht.
--
--   Jetzt legt der Storno auf Wunsch gleich einen Entwurf an, der das Original
--   ersetzt. REPLACES_* haelt den Bezug:
--     - beim Buchen des Entwurfs wandern die Zahlungen des Originals samt
--       PAYMENT_STRUCTURE auf die neue Rechnung (services/reissue.js),
--     - Beleg und XML nennen die ersetzte Rechnung (BT-25).
--   Wird der Entwurf verworfen, bleibt alles, wie es nach einem Storno ist.
--
--   Bewusst NICHT CANCELS_* (das ist der Storno selbst) und nicht CORRECTS_*
--   (die Rechnungskorrektur mindert das Original, sie ersetzt es nicht).
--
-- RLS
--   Nur DDL auf bestehenden, mandantengetrennten Tabellen. Wiederholbar.
-- ============================================================================

ALTER TABLE public."INVOICE"
  ADD COLUMN IF NOT EXISTS "REPLACES_INVOICE_ID" bigint
  REFERENCES public."INVOICE"("ID") ON DELETE SET NULL;

ALTER TABLE public."ADVANCE_INVOICE"
  ADD COLUMN IF NOT EXISTS "REPLACES_ADVANCE_INVOICE_ID" bigint
  REFERENCES public."ADVANCE_INVOICE"("ID") ON DELETE SET NULL;

COMMENT ON COLUMN public."INVOICE"."REPLACES_INVOICE_ID" IS
  'Neu ausgestellt: die stornierte Rechnung, die dieser Beleg ersetzt. Ihre Zahlungen gehen beim Buchen hierher über.';
COMMENT ON COLUMN public."ADVANCE_INVOICE"."REPLACES_ADVANCE_INVOICE_ID" IS
  'Neu ausgestellt: die stornierte Abschlagsrechnung, die dieser Beleg ersetzt. Ihre Zahlungen gehen beim Buchen hierher über.';

CREATE INDEX IF NOT EXISTS idx_invoice_replaces
  ON public."INVOICE" ("REPLACES_INVOICE_ID") WHERE "REPLACES_INVOICE_ID" IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_advance_invoice_replaces
  ON public."ADVANCE_INVOICE" ("REPLACES_ADVANCE_INVOICE_ID") WHERE "REPLACES_ADVANCE_INVOICE_ID" IS NOT NULL;
