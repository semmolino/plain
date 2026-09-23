-- ============================================================================
-- Migration 0170: Stapel-Kennung auf INVOICE_DEDUCTION und SE_RELEASE
--
-- WARUM
--   Der Rollback eines Imports findet seine Zeilen ausschliesslich ueber
--   IMPORT_BATCH_ID. Die beiden Tabellen hier waren die einzigen Zieltabellen
--   des Belegimports ohne diese Spalte — und beide haengen an einer Rechnung:
--
--     INVOICE_DEDUCTION  Abzug einer Abschlagsrechnung von einer Schluss-
--                        rechnung. Bleibt die Zeile beim Zuruecksetzen stehen,
--                        zeigt sie auf eine geloeschte Rechnung und auf einen
--                        geloeschten Abschlag. Der naechste Schlussrechnungs-
--                        lauf haelt den Abschlag dann fuer "bereits
--                        angerechnet" und zieht ihn nicht mehr ab.
--     SE_RELEASE         Nachweis, welche Rechnung einen Sicherheitseinbehalt
--                        aufgeloest hat.
--
--   Der Belegimport traegt die Kennung damit auf JEDER Zeile, die er schreibt.
--   Das ist die Bedingung dafuer, dass ein mittendrin abgebrochener Stapel
--   restlos zuruecknehmbar bleibt.
--
-- Reines DDL. Beide Tabellen tragen ihre Mandantentrennung bereits.
--
-- HINWEIS ZUM DEPLOY
--   PostgREST liest das Schema einmal beim Start, und der Web-Container
--   startet VOR dem postdeploy-Hook. Eine Spalte, die derselbe Deploy anlegt
--   und benutzt, waere danach in der Datenbank, aber nicht im Cache. Der
--   Migrations-Runner schickt deshalb am Ende jedes Laufs
--   NOTIFY pgrst, 'reload schema' — von Hand eingespielte Migrationen muessen
--   das selbst tun.
-- ============================================================================

ALTER TABLE "INVOICE_DEDUCTION" ADD COLUMN IF NOT EXISTS "IMPORT_BATCH_ID" INTEGER;
ALTER TABLE "SE_RELEASE"        ADD COLUMN IF NOT EXISTS "IMPORT_BATCH_ID" INTEGER;

CREATE INDEX IF NOT EXISTS idx_invoice_deduction_batch
  ON "INVOICE_DEDUCTION"("IMPORT_BATCH_ID");
CREATE INDEX IF NOT EXISTS idx_se_release_batch
  ON "SE_RELEASE"("IMPORT_BATCH_ID");

COMMENT ON COLUMN "INVOICE_DEDUCTION"."IMPORT_BATCH_ID" IS
  'Stapel der Datenuebernahme, aus dem diese Zeile stammt. NULL = in der Anwendung entstanden.';
COMMENT ON COLUMN "SE_RELEASE"."IMPORT_BATCH_ID" IS
  'Stapel der Datenuebernahme, aus dem diese Zeile stammt. NULL = in der Anwendung entstanden.';
