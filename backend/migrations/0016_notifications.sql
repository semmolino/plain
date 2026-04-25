-- Migration 0016: In-app notifications
--
-- TENANT_ID  – scopes the notification to a tenant
-- USER_ID    – Supabase auth UUID; NULL means the notification is visible to
--              all users in the tenant (tenant-wide broadcast)
-- TYPE       – machine-readable event key, e.g. 'invoice_overdue'
-- LINK       – optional frontend route, e.g. '/rechnungen/123'
-- METADATA   – arbitrary JSON payload for future use (e.g. document IDs)
-- READ_AT    – NULL = unread

CREATE TABLE IF NOT EXISTS "NOTIFICATION" (
  "ID"         BIGSERIAL    PRIMARY KEY,
  "TENANT_ID"  INTEGER      NOT NULL,
  "USER_ID"    TEXT,
  "TYPE"       TEXT         NOT NULL,
  "TITLE"      TEXT         NOT NULL,
  "BODY"       TEXT,
  "LINK"       TEXT,
  "METADATA"   JSONB,
  "READ_AT"    TIMESTAMPTZ,
  "CREATED_AT" TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- Fast lookup: unread notifications for a user (or tenant-wide)
CREATE INDEX IF NOT EXISTS idx_notification_tenant_user_unread
  ON "NOTIFICATION"("TENANT_ID", "USER_ID")
  WHERE "READ_AT" IS NULL;
