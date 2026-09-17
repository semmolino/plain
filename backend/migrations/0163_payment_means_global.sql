-- ============================================================================
-- Migration 0163: PAYMENT_MEANS wird ein globaler, schreibgeschuetzter Katalog
--
-- WARUM
--   PAYMENT_MEANS war die einzige Nachschlagetabelle mit TENANT_ID. Alle
--   fachlichen Geschwister sind laengst global: CURRENCY, VAT, COUNTRY,
--   PROJECT_STATUS, OFFER_STATUS. Eine Zahlungsart ist nichts, was ein Buero
--   selbst erfindet — die zulaessigen Werte stehen in UNTDID 4461, einer
--   Codeliste der EN 16931. Mandantenweise Kopien davon koennen nur
--   auseinanderlaufen.
--
--   Der Bestand bestaetigt das: es gab genau EINE Zeile (ID 1, Mandant 4,
--   ABBR '1', NAME 'Ueberweisung'). Kein Dedupe noetig, keine Fremdschluessel
--   umzuhaengen — 8 INVOICE- und 12 ADVANCE_INVOICE-Zeilen zeigen alle auf
--   dieselbe ID 1.
--
-- WAS SICH AM WERTEBESTAND AENDERT
--   ABBR traegt ab jetzt den UNTDID-4461-Code, nicht mehr eine laufende Nummer.
--   Die Codeliste steht in backend/einvoice/codelists.js und ist ab dieser
--   Aenderung die Quelle, aus der die E-Rechnung BT-81 speist.
--
--   ID 1 wird '58' / 'SEPA-Ueberweisung' und NICHT '30' / 'Ueberweisung',
--   obwohl der alte NAME das nahelegt. Grund: services_einvoice_cii.js und
--   _ubl.js haben den Code bisher FEST als 58 ausgegeben, fuer jeden Beleg.
--   Wuerde ID 1 auf 30 zeigen, aenderte sich das erzeugte XML der 20
--   bestehenden Belege rueckwirkend. 58 haelt es byte-gleich.
--
-- SCHREIBSCHUTZ
--   FORCE ROW LEVEL SECURITY bleibt an, die Mandanten-Policy faellt weg. An
--   ihre Stelle treten zwei Policies: lesen darf jeder, schreiben nur ein
--   Aufruf mit sys-Claim — also eine Migration. Der Anwendung selbst ist die
--   Tabelle damit schreibgeschuetzt, und zwar in der Datenbank und nicht bloss
--   dadurch, dass es keinen Endpunkt gibt. Ohne FORCE waere der Schutz
--   wirkungslos: PostgREST verbindet sich als Tabelleneigentuemer und geht an
--   jeder Policy vorbei (siehe Migration 0160).
-- ============================================================================

SET request.jwt.claims = '{"sys":"true"}';   -- is_system_request() -> true

-- ── 1. Mandantenbindung loesen ──────────────────────────────────────────────
-- Reihenfolge ist zwingend: die Policy nennt TENANT_ID in USING und WITH
-- CHECK und haengt damit an der Spalte. Erst Policy weg, dann die Spalte —
-- sonst "cannot drop column TENANT_ID ... because other objects depend on it".
DROP POLICY IF EXISTS tenant_isolation ON public."PAYMENT_MEANS";

ALTER TABLE public."PAYMENT_MEANS" DROP CONSTRAINT IF EXISTS "PAYMENT_MEANS_TENANT_ID_fkey";
ALTER TABLE public."PAYMENT_MEANS" ALTER COLUMN "TENANT_ID" DROP DEFAULT;
ALTER TABLE public."PAYMENT_MEANS" DROP COLUMN IF EXISTS "TENANT_ID";

-- ── 2. Lesen fuer alle, Schreiben nur aus einer Migration ───────────────────
-- VOR den Werten, nicht danach: zwischen "alte Policy weg" und "neue Policy
-- da" ist die Tabelle unter FORCE fuer niemanden beschreibbar — auch nicht
-- fuer diese Migration. Der Seed unten laeuft dann in
-- "new row violates row-level security policy".
ALTER TABLE public."PAYMENT_MEANS" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."PAYMENT_MEANS" FORCE  ROW LEVEL SECURITY;

DROP POLICY IF EXISTS payment_means_read  ON public."PAYMENT_MEANS";
DROP POLICY IF EXISTS payment_means_write ON public."PAYMENT_MEANS";

CREATE POLICY payment_means_read ON public."PAYMENT_MEANS" FOR SELECT
  USING (true);

CREATE POLICY payment_means_write ON public."PAYMENT_MEANS" FOR ALL
  USING      (public.is_system_request())
  WITH CHECK (public.is_system_request());

-- Nachgeprueft am 2026-09-17 gegen die Live-Datenbank (in einer
-- zurueckgerollten Transaktion): ohne Claim sind alle Zeilen lesbar, INSERT
-- wird hart abgewiesen, UPDATE und DELETE treffen null Zeilen. Das Stille bei
-- UPDATE/DELETE ist RLS-Normalverhalten (USING filtert die Zeile weg, statt zu
-- werfen) — es faellt nicht auf, weil es keinen schreibenden Endpunkt gibt.

-- ── 3. Wertebestand auf UNTDID 4461 ─────────────────────────────────────────
-- Vorbedingung pruefen statt annehmen. Waeren es mehrere Bestandszeilen,
-- bekaemen sie hier alle denselben Code und kollidierten am Unique-Index —
-- ein Abbruch ist besser als eine stille Zuordnung, an der Belege haengen.
DO $$
DECLARE anzahl int;
BEGIN
  SELECT count(*) INTO anzahl FROM public."PAYMENT_MEANS";
  IF anzahl > 1 THEN
    RAISE EXCEPTION
      'PAYMENT_MEANS hat % Zeilen, erwartet war hoechstens 1. Codes von Hand zuordnen, dann erneut einspielen.', anzahl;
  END IF;
END $$;

-- Die Bestandszeile behaelt ihre ID — 20 Belege verweisen darauf — und wird
-- nur umgetextet.
UPDATE public."PAYMENT_MEANS" SET "ABBR" = '58', "NAME" = 'SEPA-Überweisung';

-- Fehlende Codes ergaenzen. Ohne explizite IDs, damit die Identity-Sequenz
-- stimmig bleibt.
INSERT INTO public."PAYMENT_MEANS" ("ABBR", "NAME")
SELECT v.abbr, v.name
  FROM (VALUES
          ('30', 'Überweisung'),
          ('58', 'SEPA-Überweisung'),
          ('59', 'SEPA-Lastschrift')
       ) AS v(abbr, name)
 WHERE NOT EXISTS (SELECT 1 FROM public."PAYMENT_MEANS" p WHERE p."ABBR" = v.abbr);

-- Der Code ist ab jetzt der fachliche Schluessel, nicht mehr freier Text.
ALTER TABLE public."PAYMENT_MEANS" DROP CONSTRAINT IF EXISTS "PAYMENT_MEANS_ABBR_key";
ALTER TABLE public."PAYMENT_MEANS" ADD  CONSTRAINT "PAYMENT_MEANS_ABBR_key" UNIQUE ("ABBR");
ALTER TABLE public."PAYMENT_MEANS" ALTER COLUMN "ABBR" SET NOT NULL;
ALTER TABLE public."PAYMENT_MEANS" ALTER COLUMN "NAME" SET NOT NULL;

-- PostgREST-Rollen wie in 0139/0160: lesen ja, schreiben laeuft ohnehin in die
-- Policy. Die Blocks sind bedingt, weil es die Rollen nicht ueberall gibt.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'plain_app') THEN
    GRANT SELECT ON public."PAYMENT_MEANS" TO plain_app;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'plain_system') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON public."PAYMENT_MEANS" TO plain_system;
  END IF;
END $$;

RESET request.jwt.claims;

NOTIFY pgrst, 'reload schema';
