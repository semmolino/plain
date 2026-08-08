import type { ReactNode } from 'react'

interface Props {
  children: ReactNode
  /** Links ausgerichteter Bereich, z. B. ein Loeschen-Knopf. */
  secondary?: ReactNode
  className?: string
}

/**
 * Fusszeile eines Dialogs.
 *
 * Es gab drei Auspraegungen derselben Sache: `.modal-actions` (13 Dateien),
 * `.consent-actions` und rund 14 handgebaute `justifyContent: flex-end`-
 * Zeilen. Folge: Korrekturen mussten mehrfach gesetzt werden — die
 * ueberlaufende Beschriftung („Abbrechen" ragte in den Nachbarknopf) und
 * die volle Breite von `.btn-primary` sind beide zweimal aufgetreten.
 *
 * Diese Komponente ist der eine Ort dafuer. Sie bleibt beim Scrollen am
 * unteren Dialogrand stehen — auf dem Handy sonst der Regelfall, dass man
 * erst ans Formularende scrollen muss, um „Speichern" zu erreichen.
 */
export function DialogFooter({ children, secondary, className }: Props) {
  return (
    <div className={`modal-actions${className ? ` ${className}` : ''}`}>
      {secondary && <div className="modal-actions-secondary">{secondary}</div>}
      <div className="modal-actions-primary">{children}</div>
    </div>
  )
}
