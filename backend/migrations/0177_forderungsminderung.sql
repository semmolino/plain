-- ============================================================================
-- 0177_forderungsminderung.sql — Rest ausbuchen (Forderungsminderung)
--
-- WARUM
--   Zahlt ein Kunde weniger und das Buero akzeptiert das, gab es bisher nur
--   Storno plus neue Rechnung. Ohne Storno blieb der Rest fuer immer offen:
--   er stand in den Offenen Posten, im Mahnwesen und erzeugte
--   Faelligkeitshinweise. Eine reine Entgeltminderung (Skonto, Nachlass wegen
--   Maengelruege, Kulanz) braucht aber keine Rechnungsberichtigung
--   (§ 17 UStG; BMF 15.10.2025, Rn. 51a) — sie muss nur nachweisbar
--   festgehalten werden: Datum, Betrag, USt-Anteil, Grund.
--
--   RECEIVABLE_ADJUSTMENT haelt genau das, je Beleg beliebig viele Zeilen.
--   Der offene Betrag rechnet sie ab (services/openAmount.js).
--
-- REBILLABLE
--   true  = „wieder abrechenbar": der Betrag gilt als nicht abgerechnet und
--           wird von der naechsten Abschlags- oder Schlussrechnung wieder
--           vorgeschlagen (typisch: der Kunde bestreitet den Leistungsstand).
--   false = „endgueltig": das Honorar ist um den Betrag gemindert (Nachlass,
--           Kulanz, Forderungsausfall).
--
-- MANDANTENTRENNUNG
--   TENANT_ID mit DEFAULT current_tenant_id() plus Policy tenant_isolation
--   (Muster wie 0137). Reines DDL, kein Claim noetig.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public."RECEIVABLE_ADJUSTMENT" (
  "ID"                     bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  "TENANT_ID"              bigint DEFAULT public.current_tenant_id(),
  "INVOICE_ID"             bigint REFERENCES public."INVOICE"("ID") ON DELETE CASCADE,
  "ADVANCE_INVOICE_ID"     bigint REFERENCES public."ADVANCE_INVOICE"("ID") ON DELETE CASCADE,
  "ADJUSTMENT_DATE"        date          NOT NULL,
  "AMOUNT_GROSS"           numeric(14,2) NOT NULL,
  "AMOUNT_NET"             numeric(14,2) NOT NULL,
  "AMOUNT_VAT"             numeric(14,2) NOT NULL,
  "REASON"                 text          NOT NULL,
  "REBILLABLE"             boolean       NOT NULL DEFAULT false,
  "COMMENT"                text,
  "CREATED_BY_EMPLOYEE_ID" bigint,
  created_at               timestamptz   NOT NULL DEFAULT now(),
  CONSTRAINT chk_receivable_adjustment_one_doc
    CHECK (("INVOICE_ID" IS NULL) <> ("ADVANCE_INVOICE_ID" IS NULL)),
  CONSTRAINT chk_receivable_adjustment_amount
    CHECK ("AMOUNT_GROSS" > 0),
  CONSTRAINT chk_receivable_adjustment_reason
    CHECK ("REASON" IN ('skonto', 'kuerzung', 'kulanz', 'ausfall', 'rundung'))
);

COMMENT ON TABLE public."RECEIVABLE_ADJUSTMENT" IS
  'Ausgebuchter Rest einer Forderung (Entgeltminderung nach § 17 UStG). Mindert den offenen Betrag des Belegs; REBILLABLE = wieder abrechenbar.';

CREATE INDEX IF NOT EXISTS idx_receivable_adjustment_invoice
  ON public."RECEIVABLE_ADJUSTMENT" ("INVOICE_ID") WHERE "INVOICE_ID" IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_receivable_adjustment_advance
  ON public."RECEIVABLE_ADJUSTMENT" ("ADVANCE_INVOICE_ID") WHERE "ADVANCE_INVOICE_ID" IS NOT NULL;

-- ── Mandantentrennung in der Datenbank ──────────────────────────────────────
ALTER TABLE public."RECEIVABLE_ADJUSTMENT" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."RECEIVABLE_ADJUSTMENT" FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public."RECEIVABLE_ADJUSTMENT";
CREATE POLICY tenant_isolation ON public."RECEIVABLE_ADJUSTMENT" FOR ALL
  USING      ("TENANT_ID" = public.current_tenant_id() OR public.is_system_request())
  WITH CHECK ("TENANT_ID" = public.current_tenant_id() OR public.is_system_request());

-- PostgREST-Rollen explizit berechtigen (siehe 0137).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'plain_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON public."RECEIVABLE_ADJUSTMENT" TO plain_app;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'plain_system') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON public."RECEIVABLE_ADJUSTMENT" TO plain_system;
  END IF;
END $$;
