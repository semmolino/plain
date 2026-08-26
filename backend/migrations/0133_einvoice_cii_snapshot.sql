-- 0133_einvoice_cii_snapshot.sql
--
-- R6 (Audit 25.08.2026): Beim Buchen wurde bisher ausschliesslich die
-- UBL-Fassung eingefroren -- DOCUMENT_XML_PROFILE steht immer auf
-- 'xrechnung-ubl'. Der CII-Endpunkt liefert den Snapshot aber nur, wenn das
-- Profil 'zugferd-*' heisst; diese Bedingung trifft nie zu. Das Hybrid-PDF
-- prueft ueberhaupt keinen Snapshot.
--
-- Folge: CII und Hybrid-PDF wurden bei JEDEM Abruf neu erzeugt. Jede
-- Korrektur an den Buildern veraenderte damit rueckwirkend das Dokument
-- bereits gebuchter Belege, waehrend deren UBL unveraendert blieb -- zwei
-- widersprechende Fassungen desselben Belegs.
--
-- Diese Migration gibt der CII-Fassung ein eigenes Feld, damit sie genauso
-- eingefroren werden kann wie die UBL-Fassung. Die bestehenden Spalten
-- DOCUMENT_XML_ASSET_ID / DOCUMENT_XML_PROFILE bleiben unveraendert der
-- UBL-Fassung vorbehalten.
--
-- Rueckwaertskompatibel: der Code schreibt und liest die neuen Spalten
-- best-effort. Laeuft die Migration nicht, verhaelt sich alles wie bisher.
--
-- Bereits gebuchte Belege bekommen ihren CII-Snapshot NICHT nachtraeglich --
-- ein Nach-Rendern wuerde genau den Zustand festschreiben, den die
-- Korrekturen seit dem Audit veraendert haben. Sie laufen weiter ueber den
-- Live-Pfad. Wer sie einfrieren will, nutzt den bestehenden manuellen
-- Snapshot-Endpunkt bewusst und einzeln.

ALTER TABLE "INVOICE"
  ADD COLUMN IF NOT EXISTS "DOCUMENT_XML_CII_ASSET_ID"   INTEGER,
  ADD COLUMN IF NOT EXISTS "DOCUMENT_XML_CII_PROFILE"    TEXT,
  ADD COLUMN IF NOT EXISTS "DOCUMENT_XML_CII_RENDERED_AT" TIMESTAMPTZ;

ALTER TABLE "PARTIAL_PAYMENT"
  ADD COLUMN IF NOT EXISTS "DOCUMENT_XML_CII_ASSET_ID"   INTEGER,
  ADD COLUMN IF NOT EXISTS "DOCUMENT_XML_CII_PROFILE"    TEXT,
  ADD COLUMN IF NOT EXISTS "DOCUMENT_XML_CII_RENDERED_AT" TIMESTAMPTZ;

COMMENT ON COLUMN "INVOICE"."DOCUMENT_XML_CII_ASSET_ID" IS
  'Eingefrorene CII-Fassung (ZUGFeRD/Factur-X) des gebuchten Belegs. UBL liegt in DOCUMENT_XML_ASSET_ID.';
COMMENT ON COLUMN "INVOICE"."DOCUMENT_XML_CII_PROFILE" IS
  'Profil der eingefrorenen CII-Fassung, z. B. zugferd-en16931.';

COMMENT ON COLUMN "PARTIAL_PAYMENT"."DOCUMENT_XML_CII_ASSET_ID" IS
  'Eingefrorene CII-Fassung (ZUGFeRD/Factur-X) des gebuchten Belegs. UBL liegt in DOCUMENT_XML_ASSET_ID.';
COMMENT ON COLUMN "PARTIAL_PAYMENT"."DOCUMENT_XML_CII_PROFILE" IS
  'Profil der eingefrorenen CII-Fassung, z. B. zugferd-en16931.';
