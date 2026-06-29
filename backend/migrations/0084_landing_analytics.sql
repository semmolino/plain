-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 0084: Landing-Page-Analytics (First-Party, cookieless, anonym)
-- ─────────────────────────────────────────────────────────────────────────────
-- Speichert aggregierbare Besucher-Ereignisse der ÖFFENTLICHEN Marketing-
-- Landingpage (Seitenaufrufe, CTA-Klicks, Scroll-Tiefe, Sektions-Sichtbarkeit,
-- aktive Verweildauer). Ziel: Auswertung im bestehenden Reporting — ohne Dritt-
-- Tool, ohne Cookie, ohne Einwilligungsbanner.
--
-- DATENSCHUTZ / WARUM BANNER-FREI MÖGLICH:
--   • KEIN Cookie, KEIN localStorage → kein Zugriff auf das Endgerät i. S. § 25 TDDDG.
--   • KEINE IP-Speicherung, KEIN geräteübergreifender Identifier.
--   • SESSION_KEY ist ein zufälliger, NUR im Arbeitsspeicher des Browsers
--     gehaltener Wert pro Seitenaufruf — er erlaubt das Gruppieren von Ereignissen
--     INNERHALB eines Besuchs, aber KEIN Wiedererkennen über Besuche/Geräte hinweg.
--   • Rechtsgrundlage: Art. 6 Abs. 1 lit. f DSGVO (berechtigtes Interesse,
--     Reichweitenmessung) — in der Datenschutzerklärung zu nennen (siehe
--     docs/marketing/Analytics_Setup.md).
--
-- BEWUSST OHNE TENANT_ID (Abweichung von der üblichen Mandanten-Isolation):
--   Dies sind Marketing-/Besucherdaten der öffentlichen Seite VOR jedem Login —
--   es existiert kein Tenant-Kontext. Die Tabelle ist daher global und wird NICHT
--   über TENANT_ID gefiltert. Sie enthält keine Kunden-/Mandantendaten.
--
-- Manuell im Supabase SQL-Editor ausführen.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "LANDING_EVENT" (
  "ID"            BIGSERIAL PRIMARY KEY,
  "SESSION_KEY"   TEXT,                       -- zufällig pro Seitenaufruf, NICHT persistent
  "EVENT_TYPE"    TEXT    NOT NULL,           -- 'page_view'|'click'|'scroll_depth'|'section_view'|'engagement'
  "EVENT_LABEL"   TEXT,                       -- z. B. CTA-Label oder Sektionsname
  "PATH"          TEXT,                       -- Pfad der Seite (ohne Query)
  "REFERRER_HOST" TEXT,                       -- nur Host der Referrer-URL, KEINE volle URL/Query
  "SCROLL_DEPTH"  SMALLINT,                   -- 25|50|75|100 (nur bei 'scroll_depth')
  "ENGAGED_MS"    INTEGER,                    -- aktive Verweildauer in ms (nur bei 'engagement')
  "DEVICE_TYPE"   TEXT,                       -- 'mobile'|'tablet'|'desktop'
  "VIEWPORT_W"    SMALLINT,                   -- Viewport-Breite in px (grob)
  "LANGUAGE"      TEXT,                        -- Browser-Sprache (z. B. 'de')
  "UTM_SOURCE"    TEXT,
  "UTM_MEDIUM"    TEXT,
  "UTM_CAMPAIGN"  TEXT,
  "COUNTRY"       TEXT,                        -- optional, grob (Land); serverseitig, OHNE IP-Speicherung
  "CREATED_AT"    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_landing_event_type_time ON "LANDING_EVENT" ("EVENT_TYPE", "CREATED_AT");
CREATE INDEX IF NOT EXISTS idx_landing_event_session   ON "LANDING_EVENT" ("SESSION_KEY");
CREATE INDEX IF NOT EXISTS idx_landing_event_time      ON "LANDING_EVENT" ("CREATED_AT");

-- ── Optionale Aufbewahrungsgrenze (Datensparsamkeit) ────────────────────────
-- Empfehlung: Rohdaten nach z. B. 14 Monaten löschen (oder vorher aggregieren).
-- Als geplanter Job oder manuell:
--   DELETE FROM "LANDING_EVENT" WHERE "CREATED_AT" < now() - INTERVAL '14 months';
