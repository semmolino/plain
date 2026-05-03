-- Migration 0020: TENANT_SETTINGS for user-configurable defaults
CREATE TABLE IF NOT EXISTS public."TENANT_SETTINGS" (
  "TENANT_ID"   integer      NOT NULL,
  "KEY"         text         NOT NULL,
  "VALUE"       text,
  "UPDATED_AT"  timestamptz  NOT NULL DEFAULT now(),
  PRIMARY KEY ("TENANT_ID", "KEY")
);
