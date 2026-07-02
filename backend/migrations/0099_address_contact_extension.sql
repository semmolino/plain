-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 0099: Adressen & Kontakte inhaltlich erweitern
-- ─────────────────────────────────────────────────────────────────────────────
-- Ziel: das Adressbuch fachlich brauchbarer machen (Kategorisierung, weitere
-- Kommunikations- und Steuerangaben, Notizen) sowie Kontakte um Funktion,
-- Abteilung, Festnetz und ein Primär-Kennzeichen erweitern.
--
-- Alle Spalten sind nullable und rein additiv. Keine neue Permission nötig —
-- gehört zu den bestehenden Stammdaten (addresses.* / addresses.contacts.*).
--
-- ADDRESS_TYPE: fester Katalog (Auswertung im Code, kein eigenes Lookup-Table):
--   1 = Kunde / Bauherr
--   2 = Fachplaner
--   3 = Behörde
--   4 = Nachunternehmer
--   5 = Lieferant
--   6 = Sonstige
--
-- Steuer-Semantik (analog COMPANY): "TAX-ID" = USt-IdNr., TAX_NUMBER = Steuernummer.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public."ADDRESS"
  ADD COLUMN IF NOT EXISTS "ADDRESS_TYPE" SMALLINT,
  ADD COLUMN IF NOT EXISTS "TAX_NUMBER"   TEXT,
  ADD COLUMN IF NOT EXISTS "PHONE"        TEXT,
  ADD COLUMN IF NOT EXISTS "EMAIL"        TEXT,
  ADD COLUMN IF NOT EXISTS "WEBSITE"      TEXT,
  ADD COLUMN IF NOT EXISTS "NOTES"        TEXT;

ALTER TABLE public."CONTACTS"
  ADD COLUMN IF NOT EXISTS "POSITION"   TEXT,
  ADD COLUMN IF NOT EXISTS "DEPARTMENT" TEXT,
  ADD COLUMN IF NOT EXISTS "PHONE"      TEXT,
  ADD COLUMN IF NOT EXISTS "IS_PRIMARY" SMALLINT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "NOTES"      TEXT;
