-- ============================================================================
-- 0173_aufwandszeilen_und_plan.sql — Aufwandszeilen im Angebot, Plan am
-- Projekt-Element (UI-Pilot Runde 5, „Vom Angebot zum Projekt")
--
-- WARUM
--   1) Ein Angebotselement nach Aufwand trug genau eine Rolle mit Stunden ×
--      Satz. Mehrere Rollen gingen nur ueber Unterelemente — die beim
--      Beauftragen je ein eigenes Projekt-Element wurden, auf das man dann die
--      Rolle als Leistung buchen musste. EFFORT_LINES haelt beliebig viele
--      Zeilen je Element:
--        [{ "role_id": 3, "role_abbr": "PL", "role_name": "Projektleitung",
--           "hours": 8, "rate": 120 }, …]
--      QUANTITY / HOURLY_RATE / ROLE_* bleiben und werden aus den Zeilen
--      abgeleitet (Summe der Stunden; Satz und Rolle nur bei genau einer
--      Zeile). NULL heisst: Element von vor dieser Migration — dann gelten
--      QUANTITY × HOURLY_RATE als die eine Zeile. Es wird nichts umgeschrieben.
--
--   2) Beim Beauftragen startete ein Element nach Aufwand im Projekt bei 0:
--      weder Stunden noch Betrag aus dem Angebot gingen mit. Das interne
--      Budget eines Elements ist sein Honorar — bei Aufwand die Summe der
--      Buchungen, es waechst also mit jeder Buchung und kann nicht warnen.
--      PLAN_HOURS / PLAN_REVENUE halten fest, was angeboten war; die
--      Budgetwarnung vergleicht bei solchen Elementen das gebuchte Honorar
--      mit dem Plan (services/budgetWarnings.js). NULL = kein Plan, alles wie
--      bisher.
--
-- RLS
--   Reines DDL auf Tabellen mit bestehender Policy — kein Claim noetig, keine
--   Zeile wird gelesen oder geschrieben.
-- ============================================================================

ALTER TABLE "OFFER_STRUCTURE" ADD COLUMN IF NOT EXISTS "EFFORT_LINES" jsonb;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'offer_structure_effort_lines_array'
  ) THEN
    ALTER TABLE "OFFER_STRUCTURE"
      ADD CONSTRAINT offer_structure_effort_lines_array
      CHECK ("EFFORT_LINES" IS NULL OR jsonb_typeof("EFFORT_LINES") = 'array');
  END IF;
END $$;

COMMENT ON COLUMN "OFFER_STRUCTURE"."EFFORT_LINES" IS
  'Aufwandszeilen eines Elements nach Aufwand: [{role_id, role_abbr, role_name, hours, rate}]. NULL = Altbestand, dann gilt QUANTITY × HOURLY_RATE als eine Zeile.';

ALTER TABLE "PROJECT_STRUCTURE" ADD COLUMN IF NOT EXISTS "PLAN_HOURS"   numeric(12,2);
ALTER TABLE "PROJECT_STRUCTURE" ADD COLUMN IF NOT EXISTS "PLAN_REVENUE" numeric(14,2);

COMMENT ON COLUMN "PROJECT_STRUCTURE"."PLAN_HOURS" IS
  'Plan eines Elements nach Aufwand: angebotene Stunden (beim Beauftragen aus den Aufwandszeilen, im Projekt aenderbar). NULL = kein Plan.';
COMMENT ON COLUMN "PROJECT_STRUCTURE"."PLAN_REVENUE" IS
  'Plan eines Elements nach Aufwand: angebotenes Honorar vor Zuschlaegen. Die Budgetwarnung vergleicht damit das gebuchte Honorar. NULL = kein Plan.';
