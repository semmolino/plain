-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 0101: Rueckfrage-Konversation zu Abwesenheitsantraegen
-- ─────────────────────────────────────────────────────────────────────────────
-- Speichert den Verlauf aus Rueckfragen (Genehmiger) und Antworten (Antrag-
-- steller) als JSONB-Array am Antrag. Jeder Eintrag:
--   { "role": "approver" | "requester", "by": <employeeId>, "at": <iso>, "text": "…" }
--
-- Der Antragsteller kann so auf eine Rueckfrage antworten; der Genehmiger sieht
-- den Verlauf im Postfach. DECISION_NOTE bleibt fuer die Kurzanzeige der letzten
-- Rueckfrage erhalten (Abwaertskompatibilitaet). Manuell im Supabase SQL-Editor
-- ausfuehren.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE "ABSENCE" ADD COLUMN IF NOT EXISTS "CLARIFICATION_LOG" JSONB;
