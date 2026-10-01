-- ============================================================================
-- 0182_nachtrag_eigenes_projekt.sql — Nachtrag als eigenes Projekt freigeben
--
-- WARUM
--   Bisher hing jede Freigabe die anerkannten Positionen in die Struktur des
--   Projekts, zu dem der Nachtrag gehoert (Knoten „Nachträge"). Ist der
--   Nachtrag aber ein eigener Vertrag — eigener Rechnungsempfaenger, eigene
--   Abrechnung —, gehoert er in ein eigenes Projekt im selben Gesamtprojekt
--   (Migration 0181). Die Freigabe kann das jetzt: sie legt das Projekt an und
--   uebernimmt die Positionen dorthin (services/nachtraege.js → release).
--
--   TARGET_PROJECT_ID haelt fest, wohin eine Freigabe gegangen ist. NULL heisst
--   wie bisher: ins Projekt des Nachtrags. Der Nachtrag selbst bleibt an
--   seinem Projekt (NACHTRAG.PROJECT_ID) — er ist dort entstanden und wird dort
--   gefuehrt; die uebernommenen Elemente tragen NACHTRAG_ID wie bisher.
--
-- RLS
--   Nur DDL auf einer bestehenden, mandantengetrennten Tabelle. Wiederholbar.
-- ============================================================================

ALTER TABLE public."NACHTRAG_RELEASE"
  ADD COLUMN IF NOT EXISTS "TARGET_PROJECT_ID" bigint
  REFERENCES public."PROJECT"("ID") ON DELETE SET NULL;

COMMENT ON COLUMN public."NACHTRAG_RELEASE"."TARGET_PROJECT_ID" IS
  'Projekt, in das diese Freigabe uebernommen wurde, wenn nicht das des Nachtrags (Nachtrag als eigenes Projekt). NULL = Projekt des Nachtrags.';

CREATE INDEX IF NOT EXISTS idx_nachtrag_release_target
  ON public."NACHTRAG_RELEASE" ("TARGET_PROJECT_ID") WHERE "TARGET_PROJECT_ID" IS NOT NULL;
