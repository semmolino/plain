import { useCallback, useRef, useState } from 'react'
import { ConfirmModal } from '@/components/ui/ConfirmModal'

interface ConfirmOptions {
  title?:        string
  message:       string
  confirmLabel?: string
  /** `btn-danger` (Vorgabe) fuer Loeschen, `btn-primary` fuer harmlose Rueckfragen. */
  confirmClass?: string
}

interface Offen extends ConfirmOptions {
  resolve: (ok: boolean) => void
}

/**
 * Rueckfrage, auf die man warten kann — `await confirm({ … })`.
 *
 * **Wozu:** Das Projekt hat mit `ConfirmModal` einen richtigen Dialog
 * (Portal, Escape, Fokus-Falle, `role="dialog"`, DialogFooter). Der wird
 * aber ueber Callbacks bedient. An vier Stellen stand deshalb weiterhin das
 * native `window.confirm` — mitten in `async`-Funktionen, die danach
 * weiterlaufen:
 *
 *     if (!confirm('Werte werden uebertragen. Fortfahren?')) return
 *     await transferFatherToChild(…)
 *
 * Mit einem Callback-Dialog laesst sich das nicht eins zu eins ersetzen; man
 * muesste die Funktion in zwei Haelften zerlegen und den Zwischenstand
 * zwischenspeichern. Ein Versprechen macht daraus eine Zeile:
 *
 *     if (!(await confirm({ message: 'Werte werden uebertragen. Fortfahren?' }))) return
 *
 * **Warum das native `confirm` weg muss:** Es steht ausserhalb des Themes,
 * beschriftet seine Knoepfe in der Browsersprache statt auf Deutsch, nennt
 * die Domain als Absender und laesst sich nicht mit dem restlichen Produkt
 * gestalten. Vor allem aber ist die Knopfreihenfolge dort eine andere als
 * die im Produkt verbindliche (Abbrechen links, Hauptaktion rechts).
 *
 * **Verwendung:**
 *
 *     const [confirm, confirmDialog] = useConfirm()
 *     …
 *     if (!(await confirm({ message: '…' }))) return
 *     …
 *     return <>{ … }{confirmDialog}</>
 *
 * Das `confirmDialog` muss gerendert werden, sonst passiert nichts. Es
 * rendert sich selbst per Portal und stoert an keiner Stelle im Baum.
 *
 * Mehrere Rueckfragen nacheinander (`for (…) await confirm(…)`) laufen der
 * Reihe nach — genau wie beim nativen `confirm`, nur ohne den Browserdialog.
 */
export function useConfirm(): [(o: ConfirmOptions) => Promise<boolean>, React.ReactNode] {
  const [offen, setOffen] = useState<Offen | null>(null)
  // Das Versprechen der laufenden Rueckfrage. Ohne diese Ablage bliebe ein
  // Aufrufer haengen, wenn die Komponente waehrend der Rueckfrage verschwindet.
  const laufend = useRef<((ok: boolean) => void) | null>(null)

  const confirm = useCallback((o: ConfirmOptions) => new Promise<boolean>(resolve => {
    laufend.current = resolve
    setOffen({ ...o, resolve })
  }), [])

  const beantworten = useCallback((ok: boolean) => {
    laufend.current?.(ok)
    laufend.current = null
    setOffen(null)
  }, [])

  const dialog = offen ? (
    <ConfirmModal
      open
      title={offen.title ?? 'Bitte bestätigen'}
      message={offen.message}
      confirmLabel={offen.confirmLabel ?? 'Fortfahren'}
      confirmClass={offen.confirmClass ?? 'btn-danger'}
      onConfirm={() => beantworten(true)}
      onCancel={() => beantworten(false)}
    />
  ) : null

  return [confirm, dialog]
}
