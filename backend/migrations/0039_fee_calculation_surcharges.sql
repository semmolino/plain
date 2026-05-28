-- HOAI Zuschläge / Nachlässe per Honorarberechnung
CREATE TABLE IF NOT EXISTS "FEE_CALCULATION_SURCHARGES" (
  "ID"                  SERIAL PRIMARY KEY,
  "TENANT_ID"           INTEGER NOT NULL,
  "FEE_CALC_MASTER_ID"  INTEGER NOT NULL REFERENCES "FEE_CALCULATION_MASTER"("ID") ON DELETE CASCADE,
  "FEE_SURCHARGE_ID"    INTEGER REFERENCES "FEE_SURCHARGES"("ID"),  -- null = custom entry
  "NAME_SHORT"          VARCHAR(100),
  "NAME_LONG"           VARCHAR(500),
  "PERCENT"             DECIMAL(8,4),    -- positive = Zuschlag, negative = Nachlass
  "BASE_AMOUNT"         DECIMAL(12,2),   -- Grundhonorar at time of save
  "AMOUNT"              DECIMAL(12,2),   -- computed: PERCENT/100 * BASE_AMOUNT
  "SORT_ORDER"          INTEGER NOT NULL DEFAULT 0,
  "created_at"          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
