import type { ReactNode } from 'react'

interface Props {
  /** Rechte Zone. Reihenfolge: sekundaere Aktionen zuerst, die Hauptaktion zuletzt. */
  children:   ReactNode
  /** Linke Zone: Abbrechen / Verwerfen — was vom Weitermachen wegfuehrt. */
  secondary?: ReactNode
  /** Zustandstext neben der linken Zone, z. B. „3 Änderungen nicht gespeichert". */
  status?:    ReactNode
  /** Hebt den Zustand hervor (ungespeicherte Aenderungen). */
  dirty?:     boolean
  className?: string
}

/**
 * Feste Aktionsleiste fuer Seitenformulare und Assistenten (UI-Pilot 2026-09).
 *
 * Vorher stand „Speichern" am Ende langer Tabellen (Projektstruktur) oder
 * als eine von vier gleich breiten Schaltflaechen unter dem Formular
 * (Rechnungs-Assistent: Abbrechen | Zurück | Entwurf | Jetzt buchen, jede
 * `flex: 1`). Wer nicht bis unten scrollte, sah weder den Knopf noch, dass
 * es etwas zu speichern gab.
 *
 * Regeln wie bei DialogFooter: links was abbricht, rechts was weiterfuehrt,
 * die Hauptaktion ganz rechts und als einzige gefuellt. Dazu der Zustand in
 * Worten — nie nur als Farbe.
 *
 * Position: ab 1024px scrollt nur `.app-main`, dort haelt `sticky` die
 * Leiste am unteren Rand. Darunter scrollt das Dokument, sticky griffe nicht;
 * die Leiste sitzt dann fest ueber der Bottom-Nav, und ein Platzhalter im
 * Fluss sorgt dafuer, dass sie die letzte Zeile nicht verdeckt.
 */
export function ActionBar({ children, secondary, status, dirty, className }: Props) {
  return (
    <>
      <div className="action-bar-spacer" aria-hidden="true" />
      <div
        className={`action-bar${dirty ? ' action-bar--dirty' : ''}${className ? ` ${className}` : ''}`}
        role="region"
        aria-label="Seitenaktionen"
      >
        <div className="action-bar-left">
          {secondary}
          {status != null && (
            <span className="action-bar-status" aria-live="polite">
              {dirty && <span className="action-bar-dot" aria-hidden="true" />}
              {status}
            </span>
          )}
        </div>
        <div className="action-bar-right">{children}</div>
      </div>
    </>
  )
}
