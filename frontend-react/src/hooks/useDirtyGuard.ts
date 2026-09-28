import { createContext, useContext, useEffect, useLayoutEffect, useRef } from 'react'

/**
 * Kontext und Hooks zum Guard fuer ungespeicherte Aenderungen
 * (components/ui/DirtyGuard.tsx). Getrennt von der Komponente, damit
 * Fast Refresh die Datei als reine Komponente behandeln kann.
 */

export interface GuardEntry {
  dirty:  boolean
  /** Anzeigename des Bereichs in der Rueckfrage, z. B. „Struktur". */
  label?: string
  /** Zaehler fuer die Rueckfrage („3 Änderungen"). */
  count?: number
  /** Speichert alles Offene; wirft bei Fehler. Ohne `save` gibt es nur „Verwerfen". */
  save?:  () => Promise<unknown>
}

export interface GuardCtx {
  register:   (key: string, entry: { current: GuardEntry }) => void
  unregister: (key: string) => void
  request:    (action: () => void) => void
}

export const GuardContext = createContext<GuardCtx | null>(null)

/** Meldet einen bearbeitbaren Bereich beim Guard der Seite an. */
export function useRegisterDirty(key: string, entry: GuardEntry) {
  const ctx = useContext(GuardContext)
  const ref = useRef(entry)
  // Nach jedem Rendern den aktuellen Stand hinterlegen — der Guard liest ihn
  // erst, wenn jemand wechseln will.
  useLayoutEffect(() => { ref.current = entry })
  useEffect(() => {
    if (!ctx) return
    ctx.register(key, ref)
    return () => ctx.unregister(key)
  }, [ctx, key])
}

/**
 * Liefert eine Funktion, die eine Aktion ausfuehrt — bei offenen Aenderungen
 * erst nach Rueckfrage. Ohne Provider wird die Aktion direkt ausgefuehrt.
 */
export function useGuardedAction(): (action: () => void) => void {
  const ctx = useContext(GuardContext)
  return ctx?.request ?? ((action: () => void) => action())
}
