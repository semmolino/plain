-- Migration 0129 — Leistungsstand-Reminder: eine Nachricht je Projekt ODER
-- eine Sammelnachricht.
--
-- Bisher bekam die Projektleitung pro betroffenem Projekt eine eigene
-- Benachrichtigung. Bei zwanzig laufenden Projekten sind das zwanzig
-- Meldungen am selben Morgen — die Erinnerung erschlaegt genau die Leute,
-- die sie erreichen soll.
--
-- PM_NOTIFY_MODE:
--   'per_project' -- je Projekt eine Nachricht (bisheriges Verhalten, Vorgabe)
--   'summary'     -- eine Nachricht je Person, unabhaengig von der Projektanzahl
--
-- Nur der Projektleitungs-Pfad braucht die Wahl. Die Empfaenger aus
-- Rollen/Abteilungen/Personen erhalten ohnehin schon genau eine Sammelnachricht.

ALTER TABLE "NOTIFICATION_SCHEDULE_CONFIG"
  ADD COLUMN IF NOT EXISTS "PM_NOTIFY_MODE" TEXT NOT NULL DEFAULT 'per_project';

-- Bestehende Zeilen behalten damit ihr gewohntes Verhalten; niemand wird von
-- einem stillen Wechsel der Zustellart ueberrascht.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_notif_schedule_pm_mode'
  ) THEN
    ALTER TABLE "NOTIFICATION_SCHEDULE_CONFIG"
      ADD CONSTRAINT chk_notif_schedule_pm_mode
      CHECK ("PM_NOTIFY_MODE" IN ('per_project', 'summary'));
  END IF;
END $$;
