-- Migration 0058 — E-Rechnung Branch 1 Quick Wins
--
-- Neue Felder fuer EN 16931 BT-13 (Bestellnummer Kaeufer),
-- BT-19 (Buyer Accounting Reference / Kostenstelle) und BT-83
-- (Verwendungszweck / Remittance Information) an INVOICE und
-- PARTIAL_PAYMENT.
--
-- BT-11 (Projekt-Referenz) wird beim Rendern aus PROJECT.NAME_SHORT
-- gezogen — kein neues Feld noetig.
-- BT-10 (Buyer Reference / Leitweg-ID) ist via ADDRESS.BUYER_REFERENCE
-- bereits vorhanden und wird beim Erstellen kopiert.
-- BT-56-60 (Buyer Contact) sind via CONTACT / CONTACT_MAIL /
-- CONTACT_PHONE bereits vorhanden und werden beim Erstellen geschrieben;
-- es muss nur der XML-Generator nachgezogen werden.

ALTER TABLE "INVOICE"
  ADD COLUMN IF NOT EXISTS "BUYER_ORDER_REFERENCE"      TEXT,
  ADD COLUMN IF NOT EXISTS "BUYER_ACCOUNTING_REFERENCE" TEXT,
  ADD COLUMN IF NOT EXISTS "REMITTANCE_INFORMATION"     TEXT;

ALTER TABLE "PARTIAL_PAYMENT"
  ADD COLUMN IF NOT EXISTS "BUYER_ORDER_REFERENCE"      TEXT,
  ADD COLUMN IF NOT EXISTS "BUYER_ACCOUNTING_REFERENCE" TEXT,
  ADD COLUMN IF NOT EXISTS "REMITTANCE_INFORMATION"     TEXT;
