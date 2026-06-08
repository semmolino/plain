-- Migration 0059 — E-Rechnung Branch 2: Umsatzsteuer-Kategorie (BT-118 / BT-120-123)
--
-- Bisher: VAT-Category wurde hardcoded auf 'S' (Standard) oder 'Z' (Zero)
-- gesetzt — Reverse-Charge §13b UStG (Code 'AE'), Tax-exempt (E),
-- Kleinunternehmer §19 (O) waren nicht moeglich.
--
-- Neu: VAT_CATEGORY pro Vertrag (Default) + pro Rechnung (Override).
--
-- EN 16931 Codes:
--   'S'  Standard rate (default)
--   'AE' VAT reverse charge — Steuerschuldnerschaft Empfaenger §13b
--   'E'  Exempt from VAT — steuerbefreit (§4 UStG)
--   'Z'  Zero rated goods — 0%-Satz
--   'O'  Services outside scope of VAT — z.B. §19 Kleinunternehmer
--   'G'  Free export item — Lieferung in Drittland
--   'K'  VAT exempt for EEA — innergemeinschaftliche Lieferung
--
-- BT-121 EXEMPTION_REASON_CODE: Code-Liste UNTDID 5305 + KoSIT-Erweiterungen
-- BT-120/123 EXEMPTION_REASON_TEXT: freier Text (Pflicht bei E/AE/G/K)

ALTER TABLE "CONTRACT"
  ADD COLUMN IF NOT EXISTS "VAT_CATEGORY"           VARCHAR(3) DEFAULT 'S',
  ADD COLUMN IF NOT EXISTS "VAT_EXEMPTION_REASON_CODE" TEXT,
  ADD COLUMN IF NOT EXISTS "VAT_EXEMPTION_REASON_TEXT" TEXT;

ALTER TABLE "INVOICE"
  ADD COLUMN IF NOT EXISTS "VAT_CATEGORY"           VARCHAR(3) DEFAULT 'S',
  ADD COLUMN IF NOT EXISTS "VAT_EXEMPTION_REASON_CODE" TEXT,
  ADD COLUMN IF NOT EXISTS "VAT_EXEMPTION_REASON_TEXT" TEXT;

ALTER TABLE "PARTIAL_PAYMENT"
  ADD COLUMN IF NOT EXISTS "VAT_CATEGORY"           VARCHAR(3) DEFAULT 'S',
  ADD COLUMN IF NOT EXISTS "VAT_EXEMPTION_REASON_CODE" TEXT,
  ADD COLUMN IF NOT EXISTS "VAT_EXEMPTION_REASON_TEXT" TEXT;

-- Bestehende Datensaetze: Default 'S' (bereits durch DEFAULT-Constraint
-- gesetzt). Wer mehrwertsteuerfrei abrechnete (VAT_PERCENT=0), kann
-- spaeter manuell auf 'O' oder 'E' umstellen — wir lassen das nicht
-- migrieren, damit User bewusst entscheidet.
