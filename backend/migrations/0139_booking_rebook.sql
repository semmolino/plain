-- 0139_booking_rebook.sql
--
-- REKONSTRUIERT AM 2026-09-16 AUS DEM LAUFENDEN SCHEMA.
--
-- Diese Migration ist in der Produktionsdatenbank als eingespielt vermerkt
-- (Tabelle _migrations), die Datei fehlte aber im Repository. Damit konnte das
-- Repository die Datenbank nicht mehr vollstaendig aufbauen, und jede Auswertung,
-- die sich auf backend/migrations/ oder db/schema/ stuetzte, kannte TEC_REBOOKING
-- nicht. Genau daran ist die erste Bewertung der Umbenennungsliste vorbeigelaufen.
--
-- Der Inhalt ist aus information_schema und pg_catalog abgeleitet, nicht das
-- Original. Er beschreibt den Zustand korrekt, kann aber in Formulierung und
-- Reihenfolge abweichen. IF NOT EXISTS ueberall, damit ein erneuter Lauf gegen
-- eine Datenbank, die die Tabelle schon hat, folgenlos bleibt.
--
-- Reines DDL: kein sys-Claim noetig (siehe CLAUDE.md, "Migrationen laufen ohne
-- Mandanten-Claim").

CREATE TABLE IF NOT EXISTS "TEC_REBOOKING" (
  "ID"                     BIGINT GENERATED ALWAYS AS IDENTITY,
  "TENANT_ID"              BIGINT DEFAULT public.current_tenant_id(),
  "TEC_ID"                 BIGINT NOT NULL,
  "DATE_VOUCHER"           DATE,
  "BOOKING_EMPLOYEE_ID"    BIGINT,
  "QUANTITY_INT"           NUMERIC(15,2),
  "CP_TOT"                 NUMERIC(15,2),
  "FROM_PROJECT_ID"        BIGINT,
  "FROM_PROJECT_NAME"      TEXT,
  "FROM_STRUCTURE_ID"      BIGINT,
  "FROM_STRUCTURE_NAME"    TEXT,
  "TO_PROJECT_ID"          BIGINT,
  "TO_PROJECT_NAME"        TEXT,
  "TO_STRUCTURE_ID"        BIGINT,
  "TO_STRUCTURE_NAME"      TEXT,
  "SP_RATE_BEFORE"         NUMERIC(15,2),
  "SP_RATE_AFTER"          NUMERIC(15,2),
  "SP_TOT_BEFORE"          NUMERIC(15,2),
  "SP_TOT_AFTER"           NUMERIC(15,2),
  "REASON"                 TEXT,
  "CREATED_BY_EMPLOYEE_ID" BIGINT,
  -- Kleingeschrieben, im Gegensatz zu CREATED_AT im uebrigen Schema. So steht
  -- es in der Datenbank; hier nicht stillschweigend korrigiert.
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT "TEC_REBOOKING_pkey" PRIMARY KEY ("ID")
);

CREATE INDEX IF NOT EXISTS idx_tec_rebooking_tenant_tec
  ON public."TEC_REBOOKING" USING btree ("TENANT_ID", "TEC_ID");
CREATE INDEX IF NOT EXISTS idx_tec_rebooking_created
  ON public."TEC_REBOOKING" USING btree ("TENANT_ID", created_at DESC);

ALTER TABLE "TEC_REBOOKING" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "TEC_REBOOKING" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "TEC_REBOOKING";
CREATE POLICY tenant_isolation ON "TEC_REBOOKING"
  USING      (("TENANT_ID" = public.current_tenant_id()) OR public.is_system_request())
  WITH CHECK (("TENANT_ID" = public.current_tenant_id()) OR public.is_system_request());

-- PostgREST serves from a cached schema; without this it keeps using the old one.
NOTIFY pgrst, 'reload schema';
