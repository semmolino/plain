-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 0104: Projekt-Mengenlimit entfernen
-- ─────────────────────────────────────────────────────────────────────────────
-- Owner-Entscheidung 2026-07-25: Auf Projekte gibt es KEIN Limit. Die Capability
-- 'limits.projects_active' wurde aus dem Manifest entfernt; diese Migration räumt
-- die zugehörigen DB-Zeilen weg, damit die Inbox sie nicht als „verwaiste
-- Capability" meldet.
--
-- Reihenfolge egal; idempotent. Der Fremdschlüssel PLAN_CAPABILITY ->
-- LICENSE_CAPABILITY (ON DELETE CASCADE) räumt Plan-Zuordnungen automatisch mit.
-- ─────────────────────────────────────────────────────────────────────────────

-- Sicherheitshalber zuerst explizit (falls die Cascade in einer Alt-DB fehlt).
DELETE FROM "PLAN_CAPABILITY"            WHERE "CAPABILITY_KEY" = 'limits.projects_active';
DELETE FROM "TENANT_ENTITLEMENT_OVERRIDE" WHERE "CAPABILITY_KEY" = 'limits.projects_active';
DELETE FROM "CAPABILITY_PERMISSION"      WHERE "CAPABILITY_KEY" = 'limits.projects_active';
DELETE FROM "LICENSE_CAPABILITY"         WHERE "KEY"            = 'limits.projects_active';
