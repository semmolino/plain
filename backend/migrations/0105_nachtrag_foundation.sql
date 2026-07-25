-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 0105: Nachträge — Foundation (Phase N1)
-- ─────────────────────────────────────────────────────────────────────────────
-- Neues Modul „Nachträge". Ein Nachtrag ist strukturell ein projektgebundenes
-- Mini-Angebot: NACHTRAG + NACHTRAG_STRUCTURE sind baugleich zu OFFER /
-- OFFER_STRUCTURE (inkl. Zuschlags-Logik). Bei Freigabe werden Positionen
-- inkrementell in PROJECT_STRUCTURE übernommen (siehe Service, analog
-- convertOfferToProject) und über PROJECT_STRUCTURE.NACHTRAG_ID verknüpft.
--
-- Konventionen: UPPER_CASE Tabellen/Spalten, TENANT_ID auf allen mandanten-
-- bezogenen Tabellen (App-Layer-Isolation, keine RLS — wie OFFER). Hierarchie
-- via FATHER_ID (2-Pass). Beträge werden im Service über fmt2() gerundet.
--
-- Manuell im Supabase SQL-Editor ausführen.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── NACHTRAG_STATUS ─────────────────────────────────────────────────────────
-- Global (mandantenunabhängig), analog OFFER_STATUS / PROJECT_STATUS.
-- CODE ist der stabile Maschinen-Schlüssel, auf den der Code referenziert
-- (NAME_SHORT ist nur das deutsche Label und darf sich ändern).
CREATE TABLE IF NOT EXISTS public."NACHTRAG_STATUS" (
  "ID"             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  "CODE"           text NOT NULL UNIQUE,
  "NAME_SHORT"     text NOT NULL,
  "SORT_ORDER"     integer DEFAULT 0,
  "IS_TERMINAL"    boolean DEFAULT FALSE,  -- Endzustand (kein weiterer Fortschritt)
  "ALLOWS_RELEASE" boolean DEFAULT FALSE   -- aus diesem Status heraus (teil-)freigebbar
);

INSERT INTO public."NACHTRAG_STATUS" ("CODE", "NAME_SHORT", "SORT_ORDER", "IS_TERMINAL", "ALLOWS_RELEASE")
SELECT * FROM (VALUES
  ('DRAFT',                  'Entwurf',         10, FALSE, FALSE),
  ('ANNOUNCED',              'Angekündigt',     20, FALSE, FALSE),
  ('SUBMITTED',              'Eingereicht',     30, FALSE, TRUE ),
  ('IN_REVIEW',              'In Prüfung',      40, FALSE, TRUE ),
  ('PARTIALLY_COMMISSIONED', 'Teilbeauftragt',  50, FALSE, TRUE ),
  ('COMMISSIONED',           'Beauftragt',      60, TRUE,  FALSE),
  ('REJECTED',               'Abgelehnt',       70, TRUE,  FALSE),
  ('WITHDRAWN',              'Zurückgezogen',   80, TRUE,  FALSE),
  ('DISPUTED',               'Strittig',        90, FALSE, TRUE )
) AS t(code, name, sort, term, rel)
WHERE NOT EXISTS (SELECT 1 FROM public."NACHTRAG_STATUS");

-- ── NACHTRAG (Kopf) ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public."NACHTRAG" (
  "ID"                  bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  "TENANT_ID"           bigint,
  "PROJECT_ID"          bigint NOT NULL,   -- Nachtrag hängt IMMER an einem Projekt
  "CONTRACT_ID"         bigint,            -- optionaler Bezug auf den geänderten Vertrag
  "OFFER_ID"            bigint,            -- optional: entstand aus einem Angebot
  "NAME_SHORT"          text,              -- Nummer, z. B. "NT-25-003"
  "NAME_LONG"           text NOT NULL,     -- Titel / Betreff
  "NACHTRAG_TYPE"       text DEFAULT 'OWN',-- 'OWN' (eigenes Honorar) | 'MANAGED' (Fremdnachtrag, Phase N3)
  "NACHTRAG_STATUS_ID"  bigint,            -- FK NACHTRAG_STATUS
  "CATEGORY"            text,              -- CHANGED|ADDITIONAL|QUANTITY|SPECIAL|DISRUPTION|CONTENT|CIRCUMSTANCE
  "CLAIM_BASIS"         text,              -- Anspruchsgrundlage (Freitext)
  "REASON"              text,              -- Begründung / Sachverhalt
  "IS_GRANTED_BASIS"    boolean DEFAULT FALSE, -- "dem Grunde nach" anerkannt
  "EMPLOYEE_ID"         bigint,            -- verantwortlicher Bearbeiter
  "ADDRESS_ID"          bigint,            -- Gegenseite (Bauherr; bei MANAGED die Firma)
  "CONTACT_ID"          bigint,
  "COMPANY_ID"          bigint,            -- absendende Firma (Nummernkreis / PDF)
  "VAT_ID"              bigint,
  -- Fristen / Termine
  "ANNOUNCED_DATE"      date,              -- Ankündigung
  "SUBMITTED_DATE"      date,              -- Vorlage / Eingang
  "REVIEW_DUE_DATE"     date,              -- Prüf- / Entscheidungsfrist
  "DECISION_DATE"       date,              -- Entscheidung
  -- Summen (denormalisiert für Listen, analog OFFER)
  "AMOUNT_CLAIMED_NET"  numeric DEFAULT 0, -- gefordert
  "AMOUNT_APPROVED_NET" numeric DEFAULT 0, -- Summe aller Teilfreigaben
  -- Root-Level-Zuschläge (wie OFFER, Option A)
  "SURCHARGE_1_LABEL"   text,
  "SURCHARGE_1_PCT"     numeric,
  "SURCHARGE_1_EUR"     numeric DEFAULT 0,
  "SURCHARGE_1_CUMUL"   boolean DEFAULT TRUE,
  "SURCHARGE_2_LABEL"   text,
  "SURCHARGE_2_PCT"     numeric,
  "SURCHARGE_2_EUR"     numeric DEFAULT 0,
  "SURCHARGE_2_CUMUL"   boolean DEFAULT TRUE,
  "SURCHARGE_3_LABEL"   text,
  "SURCHARGE_3_PCT"     numeric,
  "SURCHARGE_3_EUR"     numeric DEFAULT 0,
  "SURCHARGE_3_CUMUL"   boolean DEFAULT TRUE,
  "SURCHARGES_TOTAL"    numeric DEFAULT 0,
  "CREATED_AT"          timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_nachtrag_tenant  ON public."NACHTRAG" ("TENANT_ID");
CREATE INDEX IF NOT EXISTS idx_nachtrag_project ON public."NACHTRAG" ("PROJECT_ID");
CREATE INDEX IF NOT EXISTS idx_nachtrag_status  ON public."NACHTRAG" ("NACHTRAG_STATUS_ID");

-- ── NACHTRAG_STRUCTURE (Positionen) ─────────────────────────────────────────
-- Baugleich zu OFFER_STRUCTURE + Teilfreigabe-Felder.
CREATE TABLE IF NOT EXISTS public."NACHTRAG_STRUCTURE" (
  "ID"                    bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  "NAME_SHORT"            text,
  "NAME_LONG"             text,
  "NACHTRAG_ID"           bigint NOT NULL,
  "FATHER_ID"             bigint,
  "TENANT_ID"             bigint,
  "SORT_ORDER"            integer DEFAULT 0,
  "BILLING_TYPE_ID"       bigint,   -- 1 = Pauschal, 2 = Stunden/TEC
  "REVENUE_BASIS"         numeric DEFAULT 0,
  "REVENUE"               numeric DEFAULT 0,
  "EXTRAS_PERCENT"        numeric DEFAULT 0,
  "EXTRAS"                numeric DEFAULT 0,
  "QUANTITY"              numeric,
  "SP_RATE"               numeric,
  "ROLE_NAME_SHORT"       text,
  "ROLE_NAME_LONG"        text,
  "ROLE_ID"               bigint,
  -- Zuschläge je Position (wie OFFER_STRUCTURE)
  "SURCHARGE_1_LABEL"     text,
  "SURCHARGE_1_PCT"       numeric,
  "SURCHARGE_1_EUR"       numeric DEFAULT 0,
  "SURCHARGE_1_CUMUL"     boolean DEFAULT TRUE,
  "SURCHARGE_2_LABEL"     text,
  "SURCHARGE_2_PCT"       numeric,
  "SURCHARGE_2_EUR"       numeric DEFAULT 0,
  "SURCHARGE_2_CUMUL"     boolean DEFAULT TRUE,
  "SURCHARGE_3_LABEL"     text,
  "SURCHARGE_3_PCT"       numeric,
  "SURCHARGE_3_EUR"       numeric DEFAULT 0,
  "SURCHARGE_3_CUMUL"     boolean DEFAULT TRUE,
  "SURCHARGES_TOTAL"      numeric DEFAULT 0,
  -- Teilfreigabe
  "APPROVAL_STATE"        text DEFAULT 'OPEN',  -- OPEN | APPROVED | PARTIAL | REJECTED
  "APPROVED_AMOUNT_NET"   numeric,              -- bei Kürzung „der Höhe nach"
  "RELEASED_STRUCTURE_ID" bigint                -- Rückverweis auf erzeugte PROJECT_STRUCTURE-Zeile
);
CREATE INDEX IF NOT EXISTS idx_nachtrag_structure_nachtrag ON public."NACHTRAG_STRUCTURE" ("NACHTRAG_ID");
CREATE INDEX IF NOT EXISTS idx_nachtrag_structure_father   ON public."NACHTRAG_STRUCTURE" ("FATHER_ID");

-- ── NACHTRAG_RELEASE (Teilfreigaben, mehrfach) ──────────────────────────────
CREATE TABLE IF NOT EXISTS public."NACHTRAG_RELEASE" (
  "ID"           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  "TENANT_ID"    bigint,
  "NACHTRAG_ID"  bigint NOT NULL,
  "RELEASE_NO"   integer NOT NULL,           -- 1, 2, 3 …
  "RELEASE_KIND" text DEFAULT 'PARTIAL',     -- FULL | PARTIAL | PROVISIONAL (vorläufige Anordnung)
  "RELEASE_BASIS" text,                      -- WRITTEN | ORAL | ORDER
  "AMOUNT_NET"   numeric DEFAULT 0,          -- in diesem Schritt freigegebenes Netto
  "RELEASED_BY"  bigint,                     -- EMPLOYEE_ID (Entscheidungsstelle)
  "RELEASED_AT"  timestamptz DEFAULT now(),
  "NOTE"         text
);
CREATE INDEX IF NOT EXISTS idx_nachtrag_release_nachtrag ON public."NACHTRAG_RELEASE" ("NACHTRAG_ID");

-- ── NACHTRAG_AUDIT (Historie / Nachweisführung) ─────────────────────────────
CREATE TABLE IF NOT EXISTS public."NACHTRAG_AUDIT" (
  "ID"          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  "TENANT_ID"   bigint,
  "NACHTRAG_ID" bigint NOT NULL,
  "EVENT_TYPE"  text NOT NULL,   -- CREATED | STATUS_CHANGE | AMOUNT_CHANGE | RELEASE | REVIEW | ...
  "ACTOR_ID"    bigint,          -- EMPLOYEE_ID
  "DETAILS"     jsonb,           -- { from, to, ... }
  "CREATED_AT"  timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_nachtrag_audit_nachtrag ON public."NACHTRAG_AUDIT" ("NACHTRAG_ID");

-- ── Herkunfts-Verknüpfung an bestehender Projektstruktur ────────────────────
-- Markiert PROJECT_STRUCTURE-Zeilen, die aus der Freigabe eines Nachtrags
-- stammen (Option A: synthetischer „Nachträge"-Wurzelknoten je Projekt).
ALTER TABLE public."PROJECT_STRUCTURE" ADD COLUMN IF NOT EXISTS "NACHTRAG_ID" bigint;
CREATE INDEX IF NOT EXISTS idx_project_structure_nachtrag ON public."PROJECT_STRUCTURE" ("NACHTRAG_ID");

-- ── Nummernkreis-RPC: NT-YY-NNN ─────────────────────────────────────────────
-- Firmen-/jahresbezogen über DOCUMENT_NUMBER_RANGE (transaktionssicher via
-- FOR UPDATE), exakt analog next_offer_number. DOC_TYPE = 'NACHTRAG'.
CREATE OR REPLACE FUNCTION next_nachtrag_number(p_company_id bigint)
RETURNS text
LANGUAGE plpgsql
AS $$
DECLARE
  yr  int  := EXTRACT(year FROM now())::int;
  yy  text := lpad((yr % 100)::text, 2, '0');
  cur int;
BEGIN
  IF p_company_id IS NULL THEN
    RAISE EXCEPTION 'p_company_id is required';
  END IF;

  SELECT "NEXT_COUNTER" INTO cur
  FROM public."DOCUMENT_NUMBER_RANGE"
  WHERE "COMPANY_ID" = p_company_id
    AND "DOC_TYPE"   = 'NACHTRAG'
    AND "YEAR"       = yr
  FOR UPDATE;

  IF NOT FOUND THEN
    cur := 1;
    INSERT INTO public."DOCUMENT_NUMBER_RANGE"
      ("COMPANY_ID", "DOC_TYPE", "YEAR", "NEXT_COUNTER", "UPDATED_AT")
    VALUES (p_company_id, 'NACHTRAG', yr, cur + 1, now());
  ELSE
    UPDATE public."DOCUMENT_NUMBER_RANGE"
    SET "NEXT_COUNTER" = cur + 1,
        "UPDATED_AT"   = now()
    WHERE "COMPANY_ID" = p_company_id
      AND "DOC_TYPE"   = 'NACHTRAG'
      AND "YEAR"       = yr;
  END IF;

  RETURN 'NT-' || yy || '-' || lpad(cur::text, 3, '0');
END;
$$;
