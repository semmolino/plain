-- ============================================================================
-- 0132_suggestion_org_release.sql — Freigabe durch den Produkt-Sprecher
--
-- WARUM
--   Bisher ging jeder eingereichte Vorschlag unmittelbar an plan&simple: der
--   Einreicher drueckte auf "Einreichen", und die Idee lag in der
--   Moderationsschlange des Herstellers. Die Organisation hatte keine
--   Gelegenheit, vorher hineinzusehen.
--
--   Das ist aus zwei Gruenden falsch. Fachlich: eine Idee spricht nach aussen
--   fuer das ganze Buero, nicht nur fuer den, der sie getippt hat. Und
--   datenschutzlich ist der Originaltext (TITLE/BODY) ein interner Text — er
--   kann Projektnamen, Bauherren oder Kollegen benennen. Genau diesen Text
--   bekam plan&simple bisher ungefiltert zu sehen.
--
-- WAS ES TUT
--   ORG_STATE trennt die ORGANISATIONSINTERNE Freigabe von der Moderation
--   durch plan&simple (MODERATION_STATE). Zwei Prozesse, zwei Beteiligte,
--   zwei Spalten:
--
--     ORG_STATE = draft     eingereicht, wartet auf den Produkt-Sprecher.
--                           Fuer plan&simple UNSICHTBAR.
--     ORG_STATE = released  vom Sprecher freigegeben -> geht in die
--                           Moderation von plan&simple (MODERATION_STATE).
--     ORG_STATE = rejected  vom Sprecher nicht freigegeben, mit Begruendung.
--                           Bleibt fuer plan&simple unsichtbar.
--
--   Eine zusaetzliche MODERATION_STATE-Auspraegung waere der kuerzere Weg
--   gewesen, aber der falsche: die Owner-Konsole fragt dort nach 'pending' und
--   haette nicht freigegebene Entwuerfe mitgelesen. Getrennte Spalten machen
--   die Sperre explizit statt sie von einer Abfrage abhaengig zu machen.
--
-- BESTANDSDATEN
--   Alles, was es heute gibt, wurde bereits an plan&simple uebermittelt —
--   nachtraeglich auf "draft" zu setzen wuerde eine Freigabe verlangen, die
--   faktisch laengst erfolgt ist. Deshalb erst mit DEFAULT 'released'
--   anlegen (das fuellt die Bestandszeilen) und die Vorgabe fuer NEUE Zeilen
--   danach auf 'draft' umstellen.
-- ============================================================================

ALTER TABLE "SUGGESTION"
  ADD COLUMN IF NOT EXISTS "ORG_STATE" TEXT NOT NULL DEFAULT 'released';

ALTER TABLE "SUGGESTION"
  ALTER COLUMN "ORG_STATE" SET DEFAULT 'draft';

ALTER TABLE "SUGGESTION"
  ADD COLUMN IF NOT EXISTS "ORG_RELEASED_AT"   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS "ORG_RELEASED_BY"   INTEGER,      -- EMPLOYEE.ID des Sprechers
  ADD COLUMN IF NOT EXISTS "ORG_DECIDE_REASON" TEXT;         -- Begruendung bei Ablehnung

COMMENT ON COLUMN "SUGGESTION"."ORG_STATE" IS
  'Organisationsinterne Freigabe: draft | released | rejected. Nur released ist fuer plan&simple sichtbar.';

-- Die Sprecher-Ansicht fragt nach offenen Entwuerfen der eigenen Organisation.
CREATE INDEX IF NOT EXISTS idx_suggestion_org_state
  ON "SUGGESTION"("TENANT_ID", "ORG_STATE");


-- ── Gegenprobe ──────────────────────────────────────────────────────────────
--   SELECT "ORG_STATE", count(*) FROM "SUGGESTION" GROUP BY 1;
--     -> Bestand vollstaendig 'released'
--   SELECT column_default FROM information_schema.columns
--     WHERE table_name = 'SUGGESTION' AND column_name = 'ORG_STATE';
--     -> 'draft'::text
