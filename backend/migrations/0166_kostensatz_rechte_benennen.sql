-- ============================================================================
-- Migration 0166: „Gehalt" heisst hier Kostensatz
--
-- WARUM
--   Die beiden Rechte employees.salary.view/.edit steuern den KOSTENSATZ in
--   EUR/h (Tabelle EMPLOYEE_COST_RATE) — kein Gehalt, keine Lohnabrechnung.
--   Im Rollen-Editor stand aber „Gehalt sehen" / „Gehalt bearbeiten", und die
--   zugehoerige Lizenz-Capability hiess „Gehaltsdaten".
--
--   Diese Benennung hat bei der wiko-Uebernahme 09/2026 eine Stunde
--   Fehlersuche gekostet: importierte Kostensaetze waren unsichtbar, der
--   Reiter meldete „Noch kein Verlauf erfasst", und niemand suchte die
--   Ursache unter „Gehaltsdaten" — zumal daneben eine zweite Capability
--   „Kostensatz-Rechner" steht und beide verwechselbar aussahen.
--
--   Die SCHLUESSEL bleiben (employees.salary.*). Sie haengen an Rollen,
--   Tarifen und Code; umbenennen hiesse, all das nachziehen zu muessen, und
--   verwechselt wird der Text, nicht der Schluessel.
--
-- PERMISSION ist ein globaler Katalog ohne TENANT_ID — kein Mandanten-Claim
-- noetig, und die Zuordnung zu Rollen (ROLE_PERMISSION) bleibt unberuehrt.
-- ============================================================================

UPDATE "PERMISSION"
   SET "LABEL_DE"       = 'Kostensatz sehen',
       "DESCRIPTION_DE" = 'Individueller Kostensatz je Mitarbeiter (€/h) — sensibel'
 WHERE "KEY" = 'employees.salary.view';

UPDATE "PERMISSION"
   SET "LABEL_DE"       = 'Kostensatz bearbeiten',
       "DESCRIPTION_DE" = 'Kostensatz-Historie erfassen, aendern und importieren'
 WHERE "KEY" = 'employees.salary.edit';

DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM "PERMISSION" WHERE "KEY" LIKE 'employees.salary.%' AND "LABEL_DE" LIKE 'Kostensatz%';
  RAISE NOTICE 'Kostensatz-Rechte umbenannt: % von 2', n;
END $$;
