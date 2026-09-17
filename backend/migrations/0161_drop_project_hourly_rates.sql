-- ============================================================================
-- Migration 0161: PROJECT_HOURLY_RATES entfernen
--
-- WARUM
--   Die Tabelle haelt je Projekt und Rolle einen eigenen Stundensatz
--   (PROJECT_ID, ROLE_ID, HOURLY_RATE). Gelesen wird sie nirgends mehr: eine
--   Suche ueber Laufzeitcode, SQL-Funktionen und Views am 2026-09-17 fand
--   keine einzige Fundstelle. Den Stundensatz einer Buchung liefert heute die
--   EMPLOYEE2PROJECT-Zuordnung, ersatzweise ROLE.HOURLY_RATE.
--
--   Sie ist so lange mitgelaufen, dass die Umbenennung 09/2026 sie noch
--   mitgenommen hat — aus PROJECT_SP_RATES wurde PROJECT_HOURLY_RATES
--   (Migration 0142). Umbenannt wurde damit eine Tabelle, die bereits tot war.
--
-- OHNE CASCADE — ABSICHT
--   Haengt wider Erwarten noch ein Fremdschluessel, eine View oder eine
--   Funktion daran, bricht diese Migration ab und der Deploy schlaegt fehl
--   (die alte Version bleibt online). Das ist der gewuenschte Ausgang: ein
--   CASCADE wuerde den abhaengigen Gegenstand stillschweigend mitreissen und
--   der Fehler taeuchte erst irgendwann spaeter im Betrieb auf.
--
-- DIE ZEILENZAHL VORHER — MIT CLAIM
--   Das Protokoll haelt fest, wie viele Zeilen verloren gehen. Der sys-Claim
--   ist dabei nicht schmueckendes Beiwerk: PROJECT_HOURLY_RATES traegt eine
--   TENANT_ID und steht unter FORCE ROW LEVEL SECURITY. Ohne Claim zaehlte das
--   SELECT null Zeilen und das Protokoll behauptete "war ohnehin leer" — die
--   Blindheit, an der Migration 0136 gescheitert ist.
--
--   Zurueckholen laesst sich die Tabelle danach nur aus der Sicherung
--   (Scalingo PostgreSQL, taegliches Backup).
-- ============================================================================

SET request.jwt.claims = '{"sys":"true"}';

DO $$
DECLARE n bigint;
BEGIN
  IF to_regclass('public."PROJECT_HOURLY_RATES"') IS NULL THEN
    RAISE NOTICE 'PROJECT_HOURLY_RATES existiert nicht (mehr) — nichts zu tun.';
    RETURN;
  END IF;
  EXECUTE 'SELECT count(*) FROM public."PROJECT_HOURLY_RATES"' INTO n;
  RAISE NOTICE 'PROJECT_HOURLY_RATES wird entfernt — % Zeilen ueber alle Mandanten.', n;
END $$;

RESET request.jwt.claims;

DROP TABLE IF EXISTS public."PROJECT_HOURLY_RATES";
