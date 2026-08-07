import { useEffect, useId, useRef } from 'react'

/**
 * Macht ein Overlay zu einem echten, bedienbaren Dialog.
 *
 * Deckt die vier Dinge ab, die `useBackdropClose` bewusst NICHT macht
 * (das kuemmert sich nur um versehentliches Schliessen per Maus):
 *
 *  1. **Escape schliesst** — vorher war ein Modal per Tastatur gar nicht
 *     zu schliessen.
 *  2. **Fokus-Falle** — Tab/Shift+Tab bleiben im Dialog, statt dahinter in
 *     die Seite zu laufen.
 *  3. **Fokus setzen & zurueckgeben** — beim Oeffnen auf das erste sinnvolle
 *     Element, beim Schliessen zurueck auf den ausloesenden Button.
 *  4. **Scroll-Sperre** — der Hintergrund scrollt nicht mehr mit.
 *
 * Verwendung:
 *   const dialog = useDialog(open, onClose)
 *   <div className="modal-backdrop" {...backdrop}>
 *     <div className="modal-card" {...dialog.dialogProps}>
 *       <span id={dialog.titleId}>{title}</span>
 *
 * Die ARIA-Rolle (`role="dialog"`, `aria-modal`, `aria-labelledby`) kommt
 * ueber `dialogProps` mit — dadurch kuendigen Screenreader den Dialog als
 * solchen an und lesen den Titel vor.
 */
export function useDialog(open: boolean, onClose: () => void) {
  const cardRef  = useRef<HTMLDivElement>(null)
  const titleId  = useId()
  // Ref statt State: onClose aendert sich oft pro Render, soll den Effekt
  // aber nicht neu aufsetzen (sonst geht der gemerkte Fokus verloren).
  const closeRef = useRef(onClose)
  closeRef.current = onClose

  useEffect(() => {
    if (!open) return

    const previouslyFocused = document.activeElement as HTMLElement | null

    const SELECTOR = [
      'a[href]', 'button:not([disabled])', 'input:not([disabled]):not([type="hidden"])',
      'select:not([disabled])', 'textarea:not([disabled])', '[tabindex]:not([tabindex="-1"])',
    ].join(',')

    const focusable = () =>
      Array.from(cardRef.current?.querySelectorAll<HTMLElement>(SELECTOR) ?? [])
        .filter(el => el.offsetParent !== null || el === document.activeElement)

    // Fokus auf das erste Bedienelement, das KEIN Schliessen-Button ist —
    // sonst landet man immer auf dem "X" statt im Formular.
    const initial = focusable().find(el => !el.hasAttribute('data-dialog-dismiss')) ?? focusable()[0]
    initial?.focus()

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.stopPropagation()
        closeRef.current()
        return
      }
      if (e.key !== 'Tab') return

      const items = focusable()
      if (!items.length) { e.preventDefault(); return }

      const first = items[0]
      const last  = items[items.length - 1]
      const active = document.activeElement

      // Zyklisch umbrechen — und den Fokus zurueckholen, falls er (z. B. nach
      // dem Schliessen eines Untermenues) ausserhalb des Dialogs gelandet ist.
      if (!cardRef.current?.contains(active)) {
        e.preventDefault(); first.focus()
      } else if (e.shiftKey && active === first) {
        e.preventDefault(); last.focus()
      } else if (!e.shiftKey && active === last) {
        e.preventDefault(); first.focus()
      }
    }

    document.addEventListener('keydown', onKeyDown, true)

    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    return () => {
      document.removeEventListener('keydown', onKeyDown, true)
      document.body.style.overflow = prevOverflow
      // isConnected: das ausloesende Element kann inzwischen unmountet sein
      // (z. B. Zeilen-Button, dessen Zeile der Dialog gerade geloescht hat).
      if (previouslyFocused?.isConnected) previouslyFocused.focus()
    }
  }, [open])

  return {
    titleId,
    dialogProps: {
      ref: cardRef,
      role: 'dialog' as const,
      'aria-modal': true,
      'aria-labelledby': titleId,
    },
  }
}
