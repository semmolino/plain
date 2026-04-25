-- Add SORT_ORDER to PROJECT_STRUCTURE for explicit sibling ordering
ALTER TABLE "PROJECT_STRUCTURE" ADD COLUMN IF NOT EXISTS "SORT_ORDER" INTEGER DEFAULT 0;

-- Initialise based on existing ID order within each parent group
UPDATE "PROJECT_STRUCTURE" ps
SET "SORT_ORDER" = sub.rn
FROM (
  SELECT "ID",
    (ROW_NUMBER() OVER (
      PARTITION BY "PROJECT_ID", COALESCE("FATHER_ID"::text, '__root__')
      ORDER BY "ID"
    ) - 1) * 10 AS rn
  FROM "PROJECT_STRUCTURE"
) sub
WHERE ps."ID" = sub."ID";
