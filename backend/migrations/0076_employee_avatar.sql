-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 0076: Profilfoto pro Mitarbeiter
-- ─────────────────────────────────────────────────────────────────────────────
-- AVATAR_ASSET_ID  -> Verweis auf ASSET (Upload ueber /assets/upload, Typ AVATAR)
-- AVATAR_DATA_URI  -> base64-Cache, damit das Foto Railway-Redeploys ueberlebt
--                     (uploads/ ist ephemer; gleiches Muster wie Firmenlogo).
--
-- Self-service: jeder Mitarbeiter pflegt ausschliesslich sein eigenes Foto
-- ueber die /mitarbeiter/me/avatar-Endpunkte (keine neue Permission noetig).
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public."EMPLOYEE" ADD COLUMN IF NOT EXISTS "AVATAR_ASSET_ID" INTEGER;
ALTER TABLE public."EMPLOYEE" ADD COLUMN IF NOT EXISTS "AVATAR_DATA_URI" TEXT;
