-- Migration 0113: Web-Push-Subscriptions (mobile Push-Benachrichtigungen)
--
-- Speichert pro Gerät/Browser eine Web-Push-Subscription. Ein Nutzer kann auf
-- mehreren Geräten (Handy, Tablet, Desktop) freigeben — daher mehrere Zeilen
-- pro (TENANT_ID, USER_ID) möglich.
--
-- TENANT_ID   – scopt die Subscription auf einen Mandanten
-- USER_ID     – Mitarbeiter-ID (TEXT, analog NOTIFICATION.USER_ID)
-- ENDPOINT    – vom Browser-Push-Dienst vergebene URL (eindeutig pro Gerät)
-- P256DH/AUTH – Verschlüsselungs-Schlüssel aus der PushSubscription
-- USER_AGENT  – zur Anzeige/Debugging (welches Gerät)
-- LAST_USED_AT– letzter erfolgreicher Versand; NULL = noch keiner
--
-- Die eigentliche „wer bekommt welche Benachrichtigung"-Logik bleibt komplett
-- in NOTIFICATION/notificationConfig. Push ist nur ein zusätzlicher
-- Zustellkanal für Nutzer, die auf ihrem Gerät zugestimmt haben.

CREATE TABLE IF NOT EXISTS "PUSH_SUBSCRIPTION" (
  "ID"           BIGSERIAL   PRIMARY KEY,
  "TENANT_ID"    INTEGER     NOT NULL,
  "USER_ID"      TEXT        NOT NULL,
  "ENDPOINT"     TEXT        NOT NULL,
  "P256DH"       TEXT        NOT NULL,
  "AUTH"         TEXT        NOT NULL,
  "USER_AGENT"   TEXT,
  "CREATED_AT"   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "LAST_USED_AT" TIMESTAMPTZ,
  CONSTRAINT uq_push_subscription_endpoint UNIQUE ("ENDPOINT")
);

-- Schneller Versand-Lookup: alle Subscriptions eines Nutzers (oder Mandanten)
CREATE INDEX IF NOT EXISTS idx_push_sub_tenant_user
  ON "PUSH_SUBSCRIPTION"("TENANT_ID", "USER_ID");
