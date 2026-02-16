-- Stage B1: DOCUMENT_TEMPLATE lifecycle + versioning
-- Run AFTER your Stage A DOCUMENT_TEMPLATE creation script.

-- 1) Add lifecycle/versioning columns (safe if re-run)
ALTER TABLE "DOCUMENT_TEMPLATE"
  ADD COLUMN IF NOT EXISTS "STATUS" TEXT,
  ADD COLUMN IF NOT EXISTS "VERSION" INTEGER,
  ADD COLUMN IF NOT EXISTS "FAMILY_ID" BIGINT,
  ADD COLUMN IF NOT EXISTS "PUBLISHED_AT" TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS "ARCHIVED_AT" TIMESTAMPTZ;

-- 2) Backfill existing templates -> treat as published v1
UPDATE "DOCUMENT_TEMPLATE"
SET
  "STATUS" = COALESCE("STATUS", 'PUBLISHED'),
  "VERSION" = COALESCE("VERSION", 1),
  "FAMILY_ID" = COALESCE("FAMILY_ID", "ID"),
  "PUBLISHED_AT" = COALESCE("PUBLISHED_AT", NOW())
WHERE "STATUS" IS NULL
   OR "VERSION" IS NULL
   OR "FAMILY_ID" IS NULL
   OR "PUBLISHED_AT" IS NULL;

-- 3) Enforce allowed status values (idempotent)
DO $$
BEGIN
  ALTER TABLE "DOCUMENT_TEMPLATE"
    ADD CONSTRAINT document_template_status_check
    CHECK ("STATUS" IN ('DRAFT','PUBLISHED','ARCHIVED'));
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- 4) Version uniqueness within a template family
CREATE UNIQUE INDEX IF NOT EXISTS document_template_family_version_uniq
  ON "DOCUMENT_TEMPLATE" ("FAMILY_ID", "VERSION");

-- 5) Only one DEFAULT per (company, doc_type) among ACTIVE + PUBLISHED
CREATE UNIQUE INDEX IF NOT EXISTS document_template_one_default_published
  ON "DOCUMENT_TEMPLATE" ("COMPANY_ID", "DOC_TYPE")
  WHERE "IS_DEFAULT" = TRUE AND "STATUS" = 'PUBLISHED' AND "IS_ACTIVE" = TRUE;

-- 6) Helpful query indexes (optional but recommended)
CREATE INDEX IF NOT EXISTS document_template_company_doctype_idx
  ON "DOCUMENT_TEMPLATE" ("COMPANY_ID", "DOC_TYPE");

CREATE INDEX IF NOT EXISTS document_template_status_idx
  ON "DOCUMENT_TEMPLATE" ("STATUS");
