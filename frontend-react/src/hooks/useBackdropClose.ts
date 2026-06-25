import { useRef, type MouseEvent } from 'react'

/**
 * Handler-Paar für ein Backdrop/Overlay, das nur schließt, wenn die Maus
 * sowohl GEDRÜCKT als auch LOSGELASSEN auf dem Backdrop selbst wird.
 *
 * Verhindert das versehentliche Schließen, wenn man INNERHALB des Modals
 * (z. B. beim Markieren von Text in einem Feld) die Maus drückt und AUSSERHALB
 * loslässt — dann feuert sonst ein click-Event auf dem Backdrop, obwohl der
 * Nutzer nicht schließen wollte.
 *
 * Verwendung:  const backdrop = useBackdropClose(onClose)
 *              <div className="…-backdrop" {...backdrop}> … </div>
 */
export function useBackdropClose(onClose: () => void) {
  const downOnBackdrop = useRef(false)
  return {
    onMouseDown: (e: MouseEvent) => { downOnBackdrop.current = e.target === e.currentTarget },
    onClick: (e: MouseEvent) => {
      const intentional = e.target === e.currentTarget && downOnBackdrop.current
      downOnBackdrop.current = false
      if (intentional) onClose()
    },
  }
}
