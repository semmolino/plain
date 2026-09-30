-- ============================================================================
-- 0179_rechnungskorrektur.sql — „Gutschrift" wird „Rechnungskorrektur"
--
-- WARUM
--   Die „Gutschrift" war technisch eine Einzelrechnung mit anderem Typcode:
--   ohne Bezug auf die Rechnung, die sie mindern soll, mit POSITIVEN Betraegen
--   (sie erhoehte das Abgerechnete, statt es zu senken), und sie lief als
--   Forderung ins Mahnwesen. Eine Rechnungsberichtigung muss aber spezifisch
--   und eindeutig auf die urspruengliche Rechnung verweisen (§ 31 Abs. 5 UStDV,
--   BMF 15.10.2025 Rn. 51b), und „Gutschrift" heisst im Umsatzsteuerrecht die
--   Abrechnung DURCH den Leistungsempfaenger (§ 14 Abs. 2 S. 5 UStG).
--
--   CORRECTS_INVOICE_ID / CORRECTS_ADVANCE_INVOICE_ID halten den Bezug —
--   bewusst NICHT CANCELS_INVOICE_ID: das nutzt der Storno, und bookInvoice
--   setzt das dort genannte Original auf „storniert". CORRECTION_REASON ist
--   der Grund, der auf dem Beleg steht.
--
--   INVOICE_TYPE bleibt 'gutschrift' — der Wert steht in Bestand, Rechten
--   (invoices.create_credit) und im Belegimport; umbenannt wird, was Nutzer
--   sehen. Betraege sind ab jetzt negativ, wie beim Import und beim Storno.
--
-- RLS
--   DDL plus UPDATE auf den globalen Katalog PERMISSION (ohne TENANT_ID) —
--   kein Claim noetig. Wiederholbar.
-- ============================================================================

ALTER TABLE public."INVOICE"
  ADD COLUMN IF NOT EXISTS "CORRECTS_INVOICE_ID" bigint
  REFERENCES public."INVOICE"("ID") ON DELETE SET NULL;

ALTER TABLE public."INVOICE"
  ADD COLUMN IF NOT EXISTS "CORRECTS_ADVANCE_INVOICE_ID" bigint
  REFERENCES public."ADVANCE_INVOICE"("ID") ON DELETE SET NULL;

ALTER TABLE public."INVOICE"
  ADD COLUMN IF NOT EXISTS "CORRECTION_REASON" text;

COMMENT ON COLUMN public."INVOICE"."CORRECTS_INVOICE_ID" IS
  'Rechnungskorrektur (INVOICE_TYPE gutschrift): die korrigierte Rechnung. Mindert deren offenen Betrag.';
COMMENT ON COLUMN public."INVOICE"."CORRECTS_ADVANCE_INVOICE_ID" IS
  'Rechnungskorrektur (INVOICE_TYPE gutschrift): die korrigierte Abschlagsrechnung. Mindert deren offenen Betrag.';
COMMENT ON COLUMN public."INVOICE"."CORRECTION_REASON" IS
  'Grund der Rechnungskorrektur — steht auf dem Beleg.';

CREATE INDEX IF NOT EXISTS idx_invoice_corrects_invoice
  ON public."INVOICE" ("CORRECTS_INVOICE_ID") WHERE "CORRECTS_INVOICE_ID" IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_invoice_corrects_advance
  ON public."INVOICE" ("CORRECTS_ADVANCE_INVOICE_ID") WHERE "CORRECTS_ADVANCE_INVOICE_ID" IS NOT NULL;

-- Tarif-Funktion umbenennen — nur, wenn niemand das Label in der
-- Owner-Konsole schon angepasst hat (der Seed 0070b ueberschreibt Labels
-- bewusst nicht). LICENSE_CAPABILITY ist ein globaler Katalog.
UPDATE "LICENSE_CAPABILITY"
   SET "LABEL_DE" = 'Rechnungskorrekturen'
 WHERE "KEY" = 'invoices.credit' AND "LABEL_DE" = 'Gutschriften';

UPDATE "PERMISSION"
   SET "LABEL_DE" = 'Rechnungskorrektur anlegen',
       "DESCRIPTION_DE" = 'Gebuchte Rechnungen und Abschlagsrechnungen korrigieren (Minderung mit Bezug auf das Original) und Korrektur-Entwürfe speichern. Buchen braucht zusätzlich „Rechnungen buchen“.'
 WHERE "KEY" = 'invoices.create_credit';
