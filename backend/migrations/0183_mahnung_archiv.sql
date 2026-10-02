-- ============================================================================
-- 0183_mahnung_archiv.sql — Versandte Mahnungen als PDF aufbewahren
--
-- WARUM
--   Eine Mahnung wurde bei jedem Abruf neu erzeugt — mit dem heutigen Datum
--   und dem heutigen offenen Betrag. Was tatsaechlich verschickt wurde, liess
--   sich danach nicht mehr zeigen. Kopien versandter Geschaeftsbriefe sind
--   aber sechs Jahre aufzubewahren (§ 257 Abs. 1 Nr. 3, Abs. 4 HGB).
--
--   Beim Versand legt services/mahnungenService.js das PDF jetzt in der
--   Objektablage ab (ASSET, Art PDF_DUNNING) und haelt den Verweis am
--   Verlaufseintrag fest. Altbestand bleibt NULL — fuer frueher versandte
--   Mahnungen gibt es keine Kopie, und das sagt die Oberflaeche auch.
--
-- RLS
--   Nur DDL auf einer bestehenden, mandantengetrennten Tabelle. Wiederholbar.
-- ============================================================================

ALTER TABLE public."MAHNUNG_HISTORY"
  ADD COLUMN IF NOT EXISTS "PDF_ASSET_ID" bigint
  REFERENCES public."ASSET"("ID") ON DELETE SET NULL;

COMMENT ON COLUMN public."MAHNUNG_HISTORY"."PDF_ASSET_ID" IS
  'PDF der Mahnung, wie sie verschickt wurde (Kopie des Geschaeftsbriefs, § 257 HGB). NULL bei Altbestand.';
