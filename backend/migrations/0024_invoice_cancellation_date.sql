-- Add CANCELLATION_DATE to INVOICE so the original row records when it was cancelled
ALTER TABLE "INVOICE" ADD COLUMN IF NOT EXISTS "CANCELLATION_DATE" date;
