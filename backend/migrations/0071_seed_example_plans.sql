-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 0071: Beispiel-Tarife (Free / Basic / Pro / Enterprise) — STARTVORLAGE
-- ─────────────────────────────────────────────────────────────────────────────
-- Legt vier vermarktbare Pläne mit einer vorgeschlagenen Capability-Matrix an.
--
-- WICHTIG:
--   * Dies ist ein EDITIERBARER Startvorschlag — Preise/Zuordnung danach in der
--     Owner-Konsole per Klick anpassen.
--   * Es wird KEIN Tenant umgestellt: alle bleiben auf Plan 'full' (Vollzugriff).
--     Diese Pläne stehen nur als Katalog bereit (für späteres Zuweisen).
--   * Tarife sind kumulativ aufgebaut (Basic ⊃ Free, Pro ⊃ Basic, …).
--   * Idempotent (ON CONFLICT DO NOTHING) — mehrfach ausführbar.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Pläne ────────────────────────────────────────────────────────────────
INSERT INTO "LICENSE_PLAN" ("KEY","NAME_DE","DESCRIPTION_DE","POSITION","IS_ACTIVE","PRICE_MONTHLY","PRICE_YEARLY","VERSION") VALUES
  ('free',       'Free',       'Zum Reinschnuppern — Grundfunktionen, 1 Nutzer',               10, TRUE,    0,    0, 1),
  ('basic',      'Basic',      'Kleine Büros: Projekte, Angebote, Rechnungen, Mahnungen',      20, TRUE,   29,  290, 1),
  ('pro',        'Pro',        'Volle Abwicklung inkl. E-Rechnung, HOAI, erweiterte Reports',  30, TRUE,   99,  990, 1),
  ('enterprise', 'Enterprise', 'Alles inkl. Mehrfirmen, API, SSO, Priority-Support',           40, TRUE, NULL, NULL, 1)
ON CONFLICT ("KEY") DO NOTHING;

-- ── 2. Boolean-Capabilities (kumulativ) ──────────────────────────────────────

-- Free-Basis -> in allen Plänen
INSERT INTO "PLAN_CAPABILITY" ("PLAN_ID","CAPABILITY_KEY","NUMERIC_LIMIT")
SELECT p."ID", c.k, NULL
FROM "LICENSE_PLAN" p
CROSS JOIN (VALUES
  ('core.dashboard'),('core.addresses'),('core.time_tracking'),
  ('projects.management'),('settings.core')
) AS c(k)
WHERE p."KEY" IN ('free','basic','pro','enterprise')
ON CONFLICT DO NOTHING;

-- Basic-Zusatz -> basic, pro, enterprise
INSERT INTO "PLAN_CAPABILITY" ("PLAN_ID","CAPABILITY_KEY","NUMERIC_LIMIT")
SELECT p."ID", c.k, NULL
FROM "LICENSE_PLAN" p
CROSS JOIN (VALUES
  ('offers.basic'),
  ('invoices.basic'),('invoices.partial'),('invoices.final'),('invoices.cancel'),
  ('dunning.basic'),('reports.standard'),
  ('projects.contracts'),('projects.budgets'),('projects.hourly_rates'),
  ('employees.management'),
  ('settings.roles'),('settings.text_templates'),('settings.notifications'),('settings.dunning_config')
) AS c(k)
WHERE p."KEY" IN ('basic','pro','enterprise')
ON CONFLICT DO NOTHING;

-- Pro-Zusatz -> pro, enterprise
INSERT INTO "PLAN_CAPABILITY" ("PLAN_ID","CAPABILITY_KEY","NUMERIC_LIMIT")
SELECT p."ID", c.k, NULL
FROM "LICENSE_PLAN" p
CROSS JOIN (VALUES
  ('invoices.credit'),('invoices.security_retention'),
  ('einvoice.xrechnung'),('einvoice.zugferd'),('einvoice.peppol'),('einvoice.attachments'),
  ('hoai.calculator'),('dunning.email'),('reports.advanced'),
  ('projects.cost_revenue_insight'),
  ('employees.salary'),('employees.month_close'),
  ('cost_rate.calculator'),('arbzg.compliance')
) AS c(k)
WHERE p."KEY" IN ('pro','enterprise')
ON CONFLICT DO NOTHING;

-- Enterprise-Zusatz -> enterprise
INSERT INTO "PLAN_CAPABILITY" ("PLAN_ID","CAPABILITY_KEY","NUMERIC_LIMIT")
SELECT p."ID", c.k, NULL
FROM "LICENSE_PLAN" p
CROSS JOIN (VALUES
  ('enterprise.multi_company'),('enterprise.custom_pdf_templates'),
  ('enterprise.api_access'),('enterprise.sso_saml'),('enterprise.priority_support')
) AS c(k)
WHERE p."KEY" = 'enterprise'
ON CONFLICT DO NOTHING;

-- ── 3. Mengen-Limits pro Plan (NULL = unbegrenzt) ────────────────────────────
INSERT INTO "PLAN_CAPABILITY" ("PLAN_ID","CAPABILITY_KEY","NUMERIC_LIMIT")
SELECT p."ID", v.cap, v.lim
FROM "LICENSE_PLAN" p
JOIN (VALUES
  ('free','limits.employees',1),        ('basic','limits.employees',5),       ('pro','limits.employees',25),       ('enterprise','limits.employees',NULL::int),
  ('free','limits.projects_active',3),  ('basic','limits.projects_active',25),('pro','limits.projects_active',200),('enterprise','limits.projects_active',NULL::int),
  ('free','limits.storage_mb',100),     ('basic','limits.storage_mb',1000),   ('pro','limits.storage_mb',10000),   ('enterprise','limits.storage_mb',NULL::int)
) AS v(plan_key, cap, lim) ON v.plan_key = p."KEY"
ON CONFLICT DO NOTHING;
