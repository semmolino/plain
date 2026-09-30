-- ============================================================================
-- 0172_rechnung_entwurf_rechte_texte.sql — Beschreibungen der Rechnungsrechte
-- (UI-Pilot Runde 3)
--
-- WARUM
--   Seit Runde 3 darf, wer eine Rechnungsart ANLEGEN darf, deren Entwuerfe
--   auch ausfuellen und speichern (middleware/draftEdit.js). Vorher verlangte
--   jeder Speicherschritt „Rechnungsentwürfe bearbeiten" — eine eigene Rolle
--   mit nur „Abschlagsrechnung anlegen" kam nicht ueber Schritt 1.
--
--   Die Rollenverwaltung zeigt DESCRIPTION_DE als Hinweis am Recht; die fuenf
--   Eintraege waren leer. Hier steht jetzt, was sie erlauben — und was nicht.
--
-- RLS
--   PERMISSION ist ein globaler Katalog ohne TENANT_ID — kein Claim noetig.
--   Wiederholbar: reines UPDATE auf feste Schluessel.
-- ============================================================================

UPDATE "PERMISSION" SET "DESCRIPTION_DE" = 'Neue Abschlagsrechnungen anlegen und ihre Entwürfe ausfüllen und speichern. Buchen braucht zusätzlich „Rechnungen buchen“.'
 WHERE "KEY" = 'invoices.create_partial';

UPDATE "PERMISSION" SET "DESCRIPTION_DE" = 'Neue Einzelrechnungen anlegen und ihre Entwürfe ausfüllen und speichern. Buchen braucht zusätzlich „Rechnungen buchen“.'
 WHERE "KEY" = 'invoices.create_single';

UPDATE "PERMISSION" SET "DESCRIPTION_DE" = 'Neue Teil- und Schlussrechnungen anlegen und ihre Entwürfe ausfüllen und speichern. Buchen braucht zusätzlich „Rechnungen buchen“.'
 WHERE "KEY" = 'invoices.create_final';

UPDATE "PERMISSION" SET "DESCRIPTION_DE" = 'Neue Gutschriften anlegen und ihre Entwürfe ausfüllen und speichern. Buchen braucht zusätzlich „Rechnungen buchen“.'
 WHERE "KEY" = 'invoices.create_credit';

UPDATE "PERMISSION" SET "DESCRIPTION_DE" = 'Entwürfe aller Rechnungsarten bearbeiten, auch solche, die man selbst nicht anlegen darf.'
 WHERE "KEY" = 'invoices.edit';
