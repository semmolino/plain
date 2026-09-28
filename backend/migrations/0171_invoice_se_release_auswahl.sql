-- ============================================================================
-- 0171_invoice_se_release_auswahl.sql — SE-Auswahl im Schlussrechnungs-
-- Entwurf merken (UI-Pilot Runde 2)
--
-- WARUM
--   Welche Sicherheitseinbehalte eine Schlussrechnung aufloest, entscheidet
--   der Assistent im letzten Schritt; gespeichert wurde die Auswahl nirgends,
--   sie ging erst mit dem Buchungsaufruf an den Server. Wer einzelne
--   Einbehalte abwaehlte, den Entwurf speicherte und spaeter fortsetzte, fand
--   wieder ALLE vorgewaehlt — und haette mit „Jetzt buchen" mehr aufgeloest,
--   als er wollte, ohne es zu sehen.
--
--   Die Spalte haelt die Auswahl des Entwurfs fest (IDs aus ADVANCE_INVOICE).
--   Massgeblich beim Buchen bleibt, was der Buchungsaufruf mitschickt
--   (`release_partial_payment_ids`); die Spalte ist nur das Gedaechtnis des
--   Assistenten. NULL heisst „nie gewaehlt" — dann gilt wie bisher „alle".
--
-- RLS
--   Reines DDL auf einer Tabelle mit bestehender Policy — kein Claim noetig,
--   keine Zeile wird gelesen oder geschrieben.
-- ============================================================================

ALTER TABLE "INVOICE" ADD COLUMN IF NOT EXISTS "SE_RELEASE_ADVANCE_IDS" bigint[];

COMMENT ON COLUMN "INVOICE"."SE_RELEASE_ADVANCE_IDS" IS
  'Entwurf: im Assistenten gewaehlte Abschlagsrechnungen, deren Sicherheitseinbehalt diese Schlussrechnung aufloest. Nur Gedaechtnis des Assistenten; beim Buchen zaehlt der Aufruf.';
