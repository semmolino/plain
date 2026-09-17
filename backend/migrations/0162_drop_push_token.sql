-- ============================================================================
-- Migration 0162: PUSH_TOKEN entfernen
--
-- WARUM
--   Die Tabelle haelt Geraete-Token fuer NATIVE Push (PLATFORM, TOKEN,
--   DEVICE_NAME) — also fuer den Weg ueber FCM/APNs und eine App im Store.
--   Diese App gibt es nicht, und der Weg wurde nie begonnen: eine Vollsuche
--   ueber das Repository am 2026-09-17 fand ausser den Schema-Dumps keine
--   einzige Fundstelle, weder im Backend noch im Frontend, und die Begriffe
--   FCM/APNs kommen nirgends vor.
--
--   Sie hat auch keine Migration — sie stammt von Hand aus der Supabase-Zeit.
--
-- NICHT ZU VERWECHSELN MIT PUSH_SUBSCRIPTION
--   Der Push, den das Produkt tatsaechlich benutzt, ist Web-Push mit VAPID
--   (Migration 0113, Tabelle PUSH_SUBSCRIPTION, services/push.js). Der bleibt
--   unberuehrt. Wer den Namen PUSH_TOKEN gesucht hat, weil eine Zustellung
--   nicht ankam, war an der falschen Tabelle.
--
--   Sollte native Push spaeter doch kommen, bekommt er eine eigene Tabelle mit
--   einem Schema, das zur dann gewaehlten Loesung passt. Eine tote Tabelle als
--   Platzhalter fuer ein ungeplantes Feature stehen zu lassen, kostet nur
--   Verwirrung — genau die, die diesen Befund ausgeloest hat.
--
-- OHNE CASCADE, ZEILENZAHL MIT CLAIM — dieselbe Begruendung wie in 0161.
-- ============================================================================

SET request.jwt.claims = '{"sys":"true"}';

DO $$
DECLARE n bigint;
BEGIN
  IF to_regclass('public."PUSH_TOKEN"') IS NULL THEN
    RAISE NOTICE 'PUSH_TOKEN existiert nicht (mehr) — nichts zu tun.';
    RETURN;
  END IF;
  EXECUTE 'SELECT count(*) FROM public."PUSH_TOKEN"' INTO n;
  RAISE NOTICE 'PUSH_TOKEN wird entfernt — % Zeilen ueber alle Mandanten.', n;
END $$;

RESET request.jwt.claims;

DROP TABLE IF EXISTS public."PUSH_TOKEN";
