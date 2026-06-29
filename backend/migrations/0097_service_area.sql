-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 0097: Service-Bereich — Datenmodell (Fundament)
-- ─────────────────────────────────────────────────────────────────────────────
-- Tabellen für die drei Sub-Bereiche. Siehe docs/SERVICE_AREA_CONCEPT.md.
--
-- DATENSCHUTZ (hart): Das Vorschlagsportal ist der einzige mandantenübergreifend
-- sichtbare Bereich. Anderen Anwendern werden NIE Name/E-Mail/Organisation des
-- Einreichers ausgespielt — nur die von plan&simple kuratierten PUBLIC_*-Felder,
-- Status und aggregierte Stimmen. BODY/Anhänge bleiben privat (eigene Org + plan&simple).
--
-- Tenant-Isolation: jede App-Query filtert auf TENANT_ID. Die plan&simple-seitige
-- Moderation läuft bewusst mandantenübergreifend über die separate owner-console.
--
-- Manuell im Supabase SQL-Editor ausführen.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Vorschläge ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "SUGGESTION" (
  "ID"               SERIAL  PRIMARY KEY,
  "TENANT_ID"        INTEGER NOT NULL,                 -- einreichende Organisation (privat)
  "EMPLOYEE_ID"      INTEGER NOT NULL,                 -- einreichender Mitarbeiter (privat)
  "TITLE"            TEXT    NOT NULL,                 -- Originaleingabe (privat)
  "BODY"             TEXT    NOT NULL,                 -- Originaleingabe (privat)
  "PUBLIC_TITLE"     TEXT,                             -- von plan&simple kuratiert (öffentlich)
  "PUBLIC_BODY"      TEXT,                             -- von plan&simple kuratiert (öffentlich)
  "CATEGORY"         TEXT,                             -- Modul-Bezug (projekte, rechnungen, ...)
  "PRIORITY_HINT"    TEXT,                             -- nice | important | blocker (vom Einreicher)
  "MODERATION_STATE" TEXT    NOT NULL DEFAULT 'pending',  -- pending | published | declined | merged
  "LIFECYCLE_STATUS" TEXT    NOT NULL DEFAULT 'new',      -- new | reviewing | planned | in_progress | shipped | not_planned
  "MERGED_INTO_ID"   INTEGER,                          -- FK→SUGGESTION (Duplikat-Zusammenführung)
  "VOTE_COUNT"       INTEGER NOT NULL DEFAULT 0,       -- denormalisierter Cache
  "JIRA_ISSUE_KEY"   TEXT,                             -- gesetzt bei Jira-Übergabe (Phase 3)
  "CREATED_AT"       TIMESTAMPTZ NOT NULL DEFAULT now(),
  "UPDATED_AT"       TIMESTAMPTZ NOT NULL DEFAULT now(),
  "PUBLISHED_AT"     TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_suggestion_tenant     ON "SUGGESTION"("TENANT_ID");
CREATE INDEX IF NOT EXISTS idx_suggestion_moderation ON "SUGGESTION"("MODERATION_STATE");
CREATE INDEX IF NOT EXISTS idx_suggestion_lifecycle  ON "SUGGESTION"("LIFECYCLE_STATUS");

-- ── 2. Stimmen — strukturell genau EINE pro Organisation ─────────────────────
CREATE TABLE IF NOT EXISTS "SUGGESTION_VOTE" (
  "ID"            SERIAL  PRIMARY KEY,
  "SUGGESTION_ID" INTEGER NOT NULL,
  "TENANT_ID"     INTEGER NOT NULL,
  "EMPLOYEE_ID"   INTEGER NOT NULL,                    -- der Produkt-Sprecher der Org
  "CREATED_AT"    TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Eine Stimme pro Organisation und Vorschlag (zweite Sicherung neben App-Logik).
CREATE UNIQUE INDEX IF NOT EXISTS uq_suggestion_vote_tenant
  ON "SUGGESTION_VOTE"("SUGGESTION_ID","TENANT_ID");

-- ── 3. Kommentare (moderiert & pseudonym) ────────────────────────────────────
CREATE TABLE IF NOT EXISTS "SUGGESTION_COMMENT" (
  "ID"               SERIAL  PRIMARY KEY,
  "SUGGESTION_ID"    INTEGER NOT NULL,
  "TENANT_ID"        INTEGER,                          -- NULL bei plan&simple-Antwort
  "EMPLOYEE_ID"      INTEGER,                          -- NULL bei plan&simple-Antwort
  "BODY"             TEXT    NOT NULL,
  "AUTHOR_KIND"      TEXT    NOT NULL DEFAULT 'user',  -- user | vendor (plan&simple)
  "VISIBILITY"       TEXT    NOT NULL DEFAULT 'public',-- public | vendor_only (privat an plan&simple)
  "MODERATION_STATE" TEXT    NOT NULL DEFAULT 'pending',-- pending | published | declined
  "CREATED_AT"       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_suggestion_comment_sug ON "SUGGESTION_COMMENT"("SUGGESTION_ID");

-- ── 4. Anhänge zu Vorschlägen (NIE öffentlich) ───────────────────────────────
CREATE TABLE IF NOT EXISTS "SUGGESTION_ATTACHMENT" (
  "ID"            SERIAL  PRIMARY KEY,
  "SUGGESTION_ID" INTEGER NOT NULL,
  "TENANT_ID"     INTEGER NOT NULL,
  "STORAGE_KEY"   TEXT    NOT NULL,                    -- Pfad/Key im Upload-Speicher
  "FILENAME"      TEXT,
  "MIME_TYPE"     TEXT,
  "SIZE_BYTES"    INTEGER,
  "CREATED_BY"    INTEGER,
  "CREATED_AT"    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_suggestion_attach_sug ON "SUGGESTION_ATTACHMENT"("SUGGESTION_ID");

-- ── 5. Feedback UND Unterstützung (gemeinsame Tabelle, privat) ───────────────
CREATE TABLE IF NOT EXISTS "SERVICE_REQUEST" (
  "ID"             SERIAL  PRIMARY KEY,
  "TENANT_ID"      INTEGER NOT NULL,
  "EMPLOYEE_ID"    INTEGER NOT NULL,
  "KIND"           TEXT    NOT NULL,                   -- feedback | support
  "CATEGORY"       TEXT,                               -- Feedback-Art bzw. Support-Kategorie
  "SUBJECT"        TEXT    NOT NULL,
  "BODY"           TEXT    NOT NULL,
  "CONTACT_NAME"   TEXT,                               -- vorbelegt, editierbar
  "CONTACT_EMAIL"  TEXT,                               -- vorbelegt, editierbar
  "WANTS_REPLY"    BOOLEAN NOT NULL DEFAULT TRUE,
  "URGENCY"        TEXT,                               -- nur Support: question | impaired | blocker
  "STATUS"         TEXT    NOT NULL DEFAULT 'new',     -- new | in_progress | waiting | resolved | closed
  "JIRA_ISSUE_KEY" TEXT,
  "CREATED_AT"     TIMESTAMPTZ NOT NULL DEFAULT now(),
  "UPDATED_AT"     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_service_request_tenant ON "SERVICE_REQUEST"("TENANT_ID");
CREATE INDEX IF NOT EXISTS idx_service_request_kind   ON "SERVICE_REQUEST"("KIND","STATUS");

-- ── 6. Antwort-Thread zu Feedback/Unterstützung ──────────────────────────────
CREATE TABLE IF NOT EXISTS "SERVICE_REQUEST_MESSAGE" (
  "ID"          SERIAL  PRIMARY KEY,
  "REQUEST_ID"  INTEGER NOT NULL,
  "AUTHOR_KIND" TEXT    NOT NULL DEFAULT 'user',       -- user | vendor (plan&simple)
  "EMPLOYEE_ID" INTEGER,
  "BODY"        TEXT    NOT NULL,
  "CREATED_AT"  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_service_request_msg_req ON "SERVICE_REQUEST_MESSAGE"("REQUEST_ID");

-- ── 7. Anhänge zu Feedback/Unterstützung ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS "SERVICE_REQUEST_ATTACHMENT" (
  "ID"          SERIAL  PRIMARY KEY,
  "REQUEST_ID"  INTEGER NOT NULL,
  "TENANT_ID"   INTEGER NOT NULL,
  "STORAGE_KEY" TEXT    NOT NULL,
  "FILENAME"    TEXT,
  "MIME_TYPE"   TEXT,
  "SIZE_BYTES"  INTEGER,
  "CREATED_BY"  INTEGER,
  "CREATED_AT"  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_service_request_attach_req ON "SERVICE_REQUEST_ATTACHMENT"("REQUEST_ID");

-- ── 8. Haftungs-/Nutzungsbestätigung (versioniert, pro Mitarbeiter) ──────────
CREATE TABLE IF NOT EXISTS "PORTAL_CONSENT" (
  "ID"          SERIAL  PRIMARY KEY,
  "TENANT_ID"   INTEGER NOT NULL,
  "EMPLOYEE_ID" INTEGER NOT NULL,
  "DOC_VERSION" TEXT    NOT NULL,                      -- Version des akzeptierten Hinweistexts
  "ACCEPTED_AT" TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Pro Mitarbeiter genau eine Bestätigung je Textversion.
CREATE UNIQUE INDEX IF NOT EXISTS uq_portal_consent_emp_ver
  ON "PORTAL_CONSENT"("EMPLOYEE_ID","DOC_VERSION");

-- ── 9. Hinweis: Produkt-Sprecher steht in TENANT_SETTINGS ────────────────────
-- Schlüssel 'suggestion_delegate_employee_id' (genau ein Mitarbeiter pro Org darf
-- voten/kommentieren). Kein DDL nötig — TENANT_SETTINGS ist key/value.
