-- ============================================================================
-- 0187_dokumentvorlage_mandant.sql — Standardvorlagen ohne Mandant zuordnen
--
-- WARUM
--   Zehn Zeilen in DOCUMENT_TEMPLATE (Standardvorlagen der Firmen 14, 15, 17
--   und 22, Mandanten 4, 6 und 11) trugen TENANT_ID = NULL — angelegt im
--   Juni 2026, vor dem Umzug auf Scalingo, als der Supabase-Dienstschluessel
--   RLS umging und die fehlende Spalte nicht auffiel. Seit RLS greift
--   (Policy "TENANT_ID" = current_tenant_id()), sieht sie kein Mandant mehr,
--   auch ihr eigener nicht. Folgen:
--   - Speichern in Einstellungen → Dokumentvorlagen fand die Vorlage nicht,
--     legte sie neu an und scheiterte am Index
--     document_template_one_default_published — der kennt keine Policy.
--     Nach aussen: „interner Fehler", und die Belegarten davor waren schon
--     gespeichert (halber Stand).
--   - Gerendert wurde mit der eingebauten Gestaltung statt der eigenen.
--
--   Vorab gegen die Produktion geprueft (2026-10-02): jede der zehn Zeilen
--   hat eine Firma mit Mandant, und je Firma und Belegart gibt es genau eine
--   aktive Standardvorlage — nach dem Zuordnen also keine Dublette.
--
-- WIE ES NICHT WIEDER PASSIERT
--   Seit 0131 traegt jede TENANT_ID-Spalte DEFAULT current_tenant_id() — eine
--   Anfrage mit Mandanten-Claim legt keine solche Zeile mehr an, und
--   saveBrandingTheme setzt TENANT_ID jetzt ausdruecklich. Unter dem
--   sys-Claim (Migration, Hintergrunddienst) ist der Standard NULL: wer dort
--   in eine Mandantentabelle schreibt, setzt TENANT_ID selbst.
--
-- MANDANTENTRENNUNG
--   Liest und schreibt eine mandantenbezogene Tabelle → sys-Claim.
--   Wiederholbar: das UPDATE trifft nur Zeilen ohne Mandant.
-- ============================================================================

SET request.jwt.claims = '{"sys":"true"}';

UPDATE "DOCUMENT_TEMPLATE" d
   SET "TENANT_ID" = c."TENANT_ID"
  FROM "COMPANY" c
 WHERE c."ID" = d."COMPANY_ID"
   AND d."TENANT_ID" IS NULL
   AND c."TENANT_ID" IS NOT NULL;

-- Was jetzt noch ohne Mandant ist, hat keine Firma mit Mandant — das
-- Protokoll des Deploys nennt es, statt es still stehen zu lassen.
DO $$
DECLARE n bigint;
BEGIN
  SELECT count(*) INTO n FROM "DOCUMENT_TEMPLATE" WHERE "TENANT_ID" IS NULL;
  IF n > 0 THEN
    RAISE WARNING '0187: DOCUMENT_TEMPLATE hat noch % Zeilen ohne Mandant (Firma ohne Mandant)', n;
  END IF;
END $$;

RESET request.jwt.claims;
