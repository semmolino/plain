import { useLayoutEffect, useState } from 'react'
import type { CSSProperties, RefObject } from 'react'

/** Abstand, den das Menü zum Fensterrand hält. */
const MARGIN = 8

type Anchor = { x: number; y: number } | null

/**
 * Positioniert ein `position: fixed`-Element (Kontextmenü, Popover) am
 * Mauszeiger und klappt es nach oben bzw. links um, wenn dort kein Platz mehr
 * ist. Ohne das läuft ein Menü am unteren Fensterrand aus dem Bild — und weil
 * es fixed liegt, holt es auch kein Scrollen zurück.
 *
 * Die Korrektur läuft in `useLayoutEffect`, also vor dem ersten Paint: der
 * Nutzer sieht das Menü nie an der falschen Stelle.
 */
export function useAnchoredPosition(
  ref: RefObject<HTMLElement | null>,
  anchor: Anchor,
  zIndex = 1500,
): CSSProperties {
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)

  useLayoutEffect(() => {
    if (!anchor) { setPos(null); return }
    const el = ref.current
    if (!el) return

    const w = el.offsetWidth
    const h = el.offsetHeight
    const vw = window.innerWidth
    const vh = window.innerHeight

    // Nach links umklappen, sonst am rechten Rand einhängen
    let left = anchor.x
    if (left + w + MARGIN > vw) left = anchor.x - w
    left = Math.max(MARGIN, Math.min(left, vw - w - MARGIN))

    // Nach oben umklappen, sonst am unteren Rand einhängen
    let top = anchor.y
    if (top + h + MARGIN > vh) top = anchor.y - h
    top = Math.max(MARGIN, Math.min(top, vh - h - MARGIN))

    setPos({ top, left })
  }, [ref, anchor?.x, anchor?.y])

  if (!anchor) return { display: 'none' }
  return {
    position: 'fixed',
    top:  pos?.top  ?? anchor.y,
    left: pos?.left ?? anchor.x,
    zIndex,
  }
}
