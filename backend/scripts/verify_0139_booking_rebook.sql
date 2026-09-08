-- ============================================================================
-- verify_0139_booking_rebook.sql — Gegenprüfung nach dem Einspielen von 0139
--
-- ZWECK
--   CLAUDE.md verlangt nach jeder Migration eine Gegenprüfung MIT gesetztem
--   Mandanten-Claim. Der Grund steht in der Geschichte von 0136: ein psql-Lauf
--   traegt kein JWT, RLS blockt fail-closed, das INSERT in "ROLE_PERMISSION"
--   lief ins Leere — und die Migration meldete trotzdem Erfolg. Wer danach
--   ohne Claim nachsieht, prueft dieselbe Blindheit ein zweites Mal.
--   Dieses Skript setzt den Claim selbst und beantwortet in einer Tabelle,
--   ob 0139 (und der Seed 0070b) tatsaechlich angekommen sind.
--
-- AUSFUEHREN (rein lesend, veraendert nichts):
--   scalingo --app planandsimple run \
--     'psql "$SCALINGO_POSTGRESQL_URL" -f backend/scripts/verify_0139_booking_rebook.sql'
--
-- LESEN
--   Spalte "befund": jede Zeile beginnt mit OK, HINWEIS oder FEHLER.
--   FEHLER  = so nicht in Betrieb nehmen, die Ursache steht daneben.
--   HINWEIS = kann richtig sein (z. B. ein nachtraeglich entzogenes Recht),
--             gehoert aber angesehen.
--
-- WIEDERVERWENDEN
--   Die Befunde zu Katalog, Rollenzuweisungen und Capability gelten fuer jede
--   Permission — dafuer nur die Zeile \set perm unten aendern. Die Befunde zu
--   Tabelle, RLS, Policy, Grants und DEFAULT haengen an TEC_REBOOKING.
-- ============================================================================

\set perm 'projects.bookings.rebook'

-- Der Kern dieser Datei. Ohne den Claim liefert "USER_ROLE" null Zeilen
-- (FORCE ROW LEVEL SECURITY gilt auch fuer den Eigentuemer der Tabelle) —
-- und "0 fehlende Rollen" sieht dann aus wie Erfolg.
--
-- Zwei Feinheiten, im lokalen Nachbau geprueft:
--   * "ROLE_PERMISSION" traegt KEINE TENANT_ID und hat deshalb gar keine
--     Policy (05_rls_scalingo.sql setzt sie nur auf Tabellen mit TENANT_ID).
--     Die reine Zaehlung der Zuweisungen laeuft also auch ohne Claim; erst
--     die Frage WELCHE Rolle braucht "USER_ROLE" und damit den Claim.
--   * Ein Superuser umgeht RLS ohnehin. Der Datenbankbenutzer auf Scalingo
--     ist keiner — sonst waere 0136 nie ins Leere gelaufen. Der erste Befund
--     unten prueft deshalb nicht die Rolle, sondern die Wirkung.
SET request.jwt.claims = '{"sys":"true"}';

\echo ''
\echo '════ Gegenprüfung 0139 — Umbuchen von Buchungen ════'
\echo ''

-- ── 1.–4. Alle Prüfungen als eine Befundliste ───────────────────────────────
-- Absichtlich eine Abfrage: auf dem Handy ist eine Tabelle mit OK/FEHLER
-- lesbar, zehn einzelne Ergebnismengen sind es nicht.
WITH
-- 0. Selbsttest: wirkt der Claim ueberhaupt?
--    "ROLE_PERMISSION" traegt keine TENANT_ID und damit keine Policy — die
--    Zaehlung unten laeuft also auch OHNE Claim. "USER_ROLE" dagegen steht
--    unter FORCE ROW LEVEL SECURITY. Ohne wirksamen Claim liefert jede
--    Rollen-Abfrage null Zeilen, und "0 fehlende Rollen" sieht dann aus wie
--    Erfolg. Genau diese Verwechslung ist der 0136-Fehler — deshalb prueft
--    das Skript zuerst sich selbst.
claim AS (
  SELECT public.is_system_request() AS wirkt,
         (SELECT count(*) FROM "USER_ROLE" WHERE "IS_SYSTEM") AS sichtbare_rollen
),
-- 1. Katalog
perm AS (
  SELECT "ID" FROM "PERMISSION" WHERE "KEY" = :'perm'
),
-- 2. Rollenzuweisungen (der 0136-Fall)
zuweisungen AS (
  SELECT count(*) AS n FROM "ROLE_PERMISSION" rp JOIN perm p ON p."ID" = rp."PERMISSION_ID"
),
-- 3. Erwartete Default-Rollen je Mandant — fehlt eine, wurde sie entweder
--    entzogen (legitim) oder die Migration lief nur halb.
soll AS (
  SELECT ur."TENANT_ID", ur."NAME_SHORT"
  FROM "USER_ROLE" ur
  WHERE ur."IS_SYSTEM" AND ur."NAME_SHORT" IN ('Administrator','Geschäftsleitung','Projektleiter')
),
soll_ohne AS (
  SELECT count(*) AS n FROM soll
  WHERE NOT EXISTS (
    SELECT 1 FROM "ROLE_PERMISSION" rp
    JOIN perm p ON p."ID" = rp."PERMISSION_ID"
    JOIN "USER_ROLE" u ON u."ID" = rp."ROLE_ID"
    WHERE u."TENANT_ID" = soll."TENANT_ID" AND u."NAME_SHORT" = soll."NAME_SHORT"
  )
),
-- Die Default-Rolle "Mitarbeiter" darf das Recht nie aus der Migration haben.
mitarbeiter AS (
  SELECT count(*) AS n
  FROM "ROLE_PERMISSION" rp
  JOIN perm p ON p."ID" = rp."PERMISSION_ID"
  JOIN "USER_ROLE" u ON u."ID" = rp."ROLE_ID"
  WHERE u."NAME_SHORT" = 'Mitarbeiter'
),
-- 4. Lizenz-Capability: ohne die Zeile gilt das Recht als "keiner Capability
--    zugeordnet" und wirkt in JEDEM Tarif (fail-open).
capability AS (
  SELECT count(*) AS n FROM "CAPABILITY_PERMISSION" WHERE "PERMISSION_KEY" = :'perm'
),
-- 5. Protokolltabelle. to_regclass statt ::regclass — eine fehlende Tabelle
--    soll einen Befund ergeben, nicht das Skript abbrechen.
tab AS (
  SELECT to_regclass('public."TEC_REBOOKING"') AS oid
),
rls AS (
  SELECT c.relrowsecurity AS aktiv, c.relforcerowsecurity AS erzwungen
  FROM pg_class c JOIN tab ON tab.oid = c.oid
),
policy AS (
  SELECT count(*) AS n FROM pg_policy pol JOIN tab ON tab.oid = pol.polrelid
  WHERE pol.polname = 'tenant_isolation'
),
-- Rechte aus pg_class.relacl, nicht aus information_schema.role_table_grants:
-- die Sicht zeigt nur Grants, die die FRAGENDE Rolle sehen darf, und meldete
-- im Test "0 von 8 Rechten", obwohl alle acht gesetzt waren. Ein Fehlalarm in
-- einem Pruefskript ist schlimmer als keine Pruefung — man glaubt ihm nicht
-- mehr, wenn es einmal zu Unrecht schreit.
grants AS (
  SELECT count(DISTINCT r.rolname) AS rollen, count(*) AS rechte
  FROM tab
  JOIN pg_class c ON c.oid = tab.oid
  CROSS JOIN LATERAL aclexplode(c.relacl) a
  JOIN pg_roles r ON r.oid = a.grantee
  WHERE r.rolname IN ('plain_app','plain_system')
    AND a.privilege_type IN ('SELECT','INSERT','UPDATE','DELETE')
),
tenant_default AS (
  SELECT count(*) AS n FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'TEC_REBOOKING'
    AND column_name = 'TENANT_ID' AND column_default LIKE '%current_tenant_id()%'
)
SELECT befund FROM (
  SELECT 0 AS ord, CASE
    WHEN (SELECT wirkt FROM claim) AND (SELECT sichtbare_rollen FROM claim) > 0
      THEN 'OK      sys-Claim wirkt, ' || (SELECT sichtbare_rollen FROM claim)
        || ' System-Rollen sichtbar'
    WHEN NOT (SELECT wirkt FROM claim)
      THEN 'FEHLER  sys-Claim wirkt NICHT (is_system_request() = false) — jede Aussage '
        || 'zu Rollen unten ist wertlos. Skript unveraendert mit -f ausfuehren.'
    ELSE 'FEHLER  Claim wirkt, aber keine System-Rolle sichtbar — leere Datenbank oder '
      || 'RBAC-Grundlage (0062) fehlt. Rollen-Befunde unten sind nicht aussagekraeftig.' END AS befund
  UNION ALL
  SELECT 1, CASE WHEN EXISTS (SELECT 1 FROM perm)
    THEN 'OK      Permission ' || :'perm' || ' steht im Katalog'
    ELSE 'FEHLER  Permission fehlt im Katalog — 0139 wurde nicht eingespielt' END
  UNION ALL
  SELECT 2, CASE WHEN (SELECT n FROM zuweisungen) > 0
    THEN 'OK      ' || (SELECT n FROM zuweisungen) || ' Rollenzuweisung(en) vorhanden'
    ELSE 'FEHLER  0 Rollenzuweisungen — das Recht haengt an niemandem. '
      || 'Ursache wie bei 0136: der sys-Claim fehlte beim Einspielen. 0139 erneut laufen lassen.' END
  UNION ALL
  SELECT 3, CASE
    WHEN (SELECT count(*) FROM soll) = 0
      THEN 'FEHLER  Keine erwarteten System-Rollen sichtbar — hier ist keine Aussage moeglich '
        || '(siehe ersten Befund). NICHT als Erfolg lesen.'
    WHEN (SELECT n FROM soll_ohne) = 0
    THEN 'OK      Administrator, Geschaeftsleitung und Projektleiter haben es in allen '
      || (SELECT count(DISTINCT "TENANT_ID") FROM soll) || ' Mandanten'
    ELSE 'HINWEIS ' || (SELECT n FROM soll_ohne) || ' erwartete Rolle(n) ohne das Recht — '
      || 'nachtraeglich entzogen (in Ordnung) oder Migration lief nur halb (Liste unten)' END
  UNION ALL
  SELECT 4, CASE
    WHEN (SELECT sichtbare_rollen FROM claim) = 0
      THEN 'FEHLER  Rolle Mitarbeiter nicht pruefbar — keine Rollen sichtbar '
        || '(siehe ersten Befund). NICHT als Erfolg lesen.'
    WHEN (SELECT n FROM mitarbeiter) = 0
    THEN 'OK      Default-Rolle Mitarbeiter hat es nicht'
    ELSE 'HINWEIS Rolle Mitarbeiter hat das Recht in '
      || (SELECT n FROM mitarbeiter) || ' Mandant(en) — bewusst vergeben?' END
  UNION ALL
  SELECT 5, CASE WHEN (SELECT n FROM capability) = 1
    THEN 'OK      An Capability core.time_tracking gehaengt'
    ELSE 'FEHLER  Keine CAPABILITY_PERMISSION-Zeile — das Recht wirkt in jedem Tarif '
      || '(fail-open). 0070b neu einspielen.' END
  UNION ALL
  SELECT 6, CASE WHEN (SELECT oid FROM tab) IS NOT NULL
    THEN 'OK      Tabelle TEC_REBOOKING existiert'
    ELSE 'FEHLER  Tabelle TEC_REBOOKING fehlt — 0139 wurde nicht eingespielt' END
  UNION ALL
  SELECT 7, CASE
    WHEN (SELECT oid FROM tab) IS NULL THEN 'FEHLER  RLS nicht pruefbar — Tabelle fehlt'
    WHEN (SELECT aktiv FROM rls) AND (SELECT erzwungen FROM rls)
      THEN 'OK      RLS aktiv und erzwungen (ENABLE + FORCE)'
    ELSE 'FEHLER  RLS nicht vollstaendig: aktiv=' || coalesce((SELECT aktiv FROM rls)::text,'?')
      || ', erzwungen=' || coalesce((SELECT erzwungen FROM rls)::text,'?')
      || ' — ohne FORCE liest der Eigentuemer an der Policy vorbei' END
  UNION ALL
  SELECT 8, CASE WHEN (SELECT n FROM policy) = 1
    THEN 'OK      Policy tenant_isolation vorhanden'
    ELSE 'FEHLER  Policy tenant_isolation fehlt — keine Mandantentrennung auf dem Protokoll' END
  UNION ALL
  SELECT 9, CASE WHEN (SELECT rollen FROM grants) = 2 AND (SELECT rechte FROM grants) = 8
    THEN 'OK      Grants fuer plain_app und plain_system komplett'
    ELSE 'FEHLER  Grants unvollstaendig (' || (SELECT rollen FROM grants) || ' Rolle(n), '
      || (SELECT rechte FROM grants) || ' von 8 Rechten) — PostgREST antwortet sonst '
      || 'mit "permission denied for table"' END
  UNION ALL
  SELECT 10, CASE WHEN (SELECT n FROM tenant_default) = 1
    THEN 'OK      TENANT_ID traegt DEFAULT current_tenant_id() (Netz wie 0131)'
    ELSE 'HINWEIS TENANT_ID ohne DEFAULT current_tenant_id() — der Service setzt den '
      || 'Mandanten selbst, das Netz darunter fehlt aber' END
) t ORDER BY ord;

\echo ''
\echo '── Wer das Recht hat (je Mandant) ──'
SELECT ur."TENANT_ID" AS mandant, ur."NAME_SHORT" AS rolle
FROM "ROLE_PERMISSION" rp
JOIN "USER_ROLE"  ur ON ur."ID" = rp."ROLE_ID"
JOIN "PERMISSION" p  ON p."ID"  = rp."PERMISSION_ID"
WHERE p."KEY" = :'perm'
ORDER BY 1, 2;

\echo ''
\echo '── System-Rollen OHNE das Recht (zur Gegenprobe) ──'
SELECT ur."TENANT_ID" AS mandant, ur."NAME_SHORT" AS rolle
FROM "USER_ROLE" ur
WHERE ur."IS_SYSTEM" AND NOT EXISTS (
  SELECT 1 FROM "ROLE_PERMISSION" rp
  JOIN "PERMISSION" p ON p."ID" = rp."PERMISSION_ID"
  WHERE rp."ROLE_ID" = ur."ID" AND p."KEY" = :'perm')
ORDER BY 1, 2;

\echo ''
\echo '── Bisherige Umbuchungen (leer ist direkt nach dem Einspielen richtig) ──'
-- Nur zaehlen, wenn die Tabelle da ist: sonst endet das Skript mit einem
-- Abbruch statt mit der Befundliste, und die ist der Zweck der Datei.
SELECT (to_regclass('public."TEC_REBOOKING"') IS NOT NULL) AS tabelle_da \gset
\if :tabelle_da
SELECT count(*) AS eintraege FROM "TEC_REBOOKING";
\else
\echo '(keine — Tabelle fehlt, siehe Befund oben)'
\endif

RESET request.jwt.claims;
