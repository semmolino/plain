-- ============================================================================
-- 0138_wip_closing_tax.sql — Steuerbilanz-Wertansatz im festgeschriebenen Abschluss
--
-- WARUM
--   Handels- und Steuerbilanz koennen bei den teilfertigen Leistungen
--   auseinanderfallen: die Wertuntergrenze der Herstellungskosten ist steuerlich
--   anders gezogen (R 6.3 EStR), und der Drohverlust ist steuerlich gar nicht
--   ansetzbar (§ 5 Abs. 4a EStG). Der Report kann beide Werte nebeneinander
--   ausweisen, sobald der Mandant einen zweiten Bewertungsfaktor pflegt
--   (TENANT_SETTINGS: wip_tax_cost_factor_percent).
--
--   Ein festgeschriebener Abschluss muss beide Werte halten. Sonst waere der
--   handelsrechtliche Wert reproduzierbar und der steuerliche nicht — und
--   genau der landet in der Steuererklaerung.
--
--   Alle Spalten sind NULL-bar: ohne gepflegten zweiten Faktor gibt es keinen
--   steuerlichen Wert, und 0 waere dort eine Aussage, die niemand getroffen hat.
--
-- EINSPIELEN (nach 0137)
--   scalingo --app planandsimple run 'psql "$SCALINGO_POSTGRESQL_URL" -f backend/migrations/0138_wip_closing_tax.sql'
-- ============================================================================

ALTER TABLE public."WIP_CLOSING"
  ADD COLUMN IF NOT EXISTS "TAX_COST_FACTOR_PERCENT" numeric(6,2),
  ADD COLUMN IF NOT EXISTS "TOTAL_WIP_TAX"           numeric(15,2);

ALTER TABLE public."WIP_CLOSING_LINE"
  ADD COLUMN IF NOT EXISTS "COST_UNBILLED_TAX_NET" numeric(15,2),
  ADD COLUMN IF NOT EXISTS "WIP_TAX_NET"           numeric(15,2);

NOTIFY pgrst, 'reload schema';
