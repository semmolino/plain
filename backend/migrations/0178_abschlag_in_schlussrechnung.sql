-- ============================================================================
-- 0178_abschlag_in_schlussrechnung.sql — Abschlagsrechnung „aufgegangen"
--
-- WARUM
--   Die Schlussrechnung zieht von jeder Abschlagsrechnung nur noch ab, was
--   dort tatsaechlich erledigt ist: Zahlungen und endgueltige Minderungen
--   (§ 14 Abs. 5 UStG, UStAE 14.8 Abs. 7 und 11 — abzusetzen sind die
--   VEREINNAHMTEN Teilentgelte). Was auf der Abschlagsrechnung noch offen ist
--   — ein nicht gezahlter Rest, ein Sicherheitseinbehalt, ein wieder
--   abrechenbar ausgebuchter Betrag —, steht danach in der Schlussrechnung.
--
--   Damit er nicht zusaetzlich auf der Abschlagsrechnung offen bleibt und
--   gemahnt wird (nach Abnahme und Schlussrechnung ist die Abschlagsforderung
--   ohnehin nicht mehr gesondert durchsetzbar, BGH VII ZR 205/07), vermerkt
--   das Buchen der Schlussrechnung hier, in welcher Rechnung die
--   Abschlagsrechnung aufgegangen ist. Ihr offener Betrag ist ab dann 0
--   (services/openAmount.js); eine spaetere Zahlung gehoert auf die
--   Schlussrechnung. Ein Storno der Schlussrechnung leert die Spalte wieder.
--
--   Bewusst eine eigene Spalte statt ADVANCE_INVOICE.INVOICE_ID: die gibt es,
--   sie wird aber nirgends gesetzt — was darin im Altbestand steht, ist
--   ungeklaert, und es umzudeuten haette Belege stillschweigend auf „erledigt"
--   gesetzt.
--
-- RLS
--   Reines DDL auf einer Tabelle mit bestehender Policy — kein Claim noetig.
-- ============================================================================

ALTER TABLE public."ADVANCE_INVOICE"
  ADD COLUMN IF NOT EXISTS "ABSORBED_BY_INVOICE_ID" bigint
  REFERENCES public."INVOICE"("ID") ON DELETE SET NULL;

COMMENT ON COLUMN public."ADVANCE_INVOICE"."ABSORBED_BY_INVOICE_ID" IS
  'Schluss-/Teilschlussrechnung, in der diese Abschlagsrechnung aufgegangen ist. Gesetzt beim Buchen, geleert beim Storno. Offener Betrag ist dann 0.';

CREATE INDEX IF NOT EXISTS idx_advance_invoice_absorbed_by
  ON public."ADVANCE_INVOICE" ("ABSORBED_BY_INVOICE_ID")
  WHERE "ABSORBED_BY_INVOICE_ID" IS NOT NULL;
