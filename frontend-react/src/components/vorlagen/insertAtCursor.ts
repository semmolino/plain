import type { RefObject } from 'react'

/** Fügt `token` an der Cursorposition des Textfelds ein und liefert den neuen Text. */
export function insertAtCursor(ref: RefObject<HTMLTextAreaElement | null>, current: string, token: string): string {
  const el = ref.current
  if (!el) return current + token
  const start = el.selectionStart ?? current.length
  const end = el.selectionEnd ?? current.length
  const next = current.slice(0, start) + token + current.slice(end)
  requestAnimationFrame(() => {
    el.focus()
    const pos = start + token.length
    el.setSelectionRange(pos, pos)
  })
  return next
}
