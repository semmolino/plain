import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import { useAuthStore } from '@/store/authStore'

/**
 * User-bezogene Persistenz von Listen-Zuständen (Filter, Sortierung,
 * Spaltenauswahl) im localStorage.
 *
 * Der Storage-Key wird beim ersten Render auf den eingeloggten Mitarbeiter
 * fixiert (`plain:filt:<employeeId>:<key>`), damit sich mehrere Nutzer an einem
 * geteilten Browser nicht dieselben Filter teilen.
 *
 * Für `Set`-basierte Zustände (Filter-Chips) `useStickySet` verwenden — es
 * kümmert sich um die Serialisierung, die JSON von Haus aus nicht beherrscht.
 *
 * Bewusst NICHT persistiert wird die Freitextsuche: ein gespeicherter Suchtext
 * würde die Liste beim späteren Öffnen ohne erkennbaren Grund einschränken.
 */

interface StickyOpts<T> {
  /** Wandelt den State in etwas JSON-Serialisierbares um (z. B. Set → Array). */
  serialize?:   (value: T) => unknown
  /** Baut den State aus dem geparsten JSON wieder auf (z. B. Array → Set). */
  deserialize?: (raw: unknown) => T
}

export function useStickyState<T>(
  rawKey:  string,
  initial: T | (() => T),
  opts:    StickyOpts<T> = {},
): [T, Dispatch<SetStateAction<T>>] {
  // serialize/deserialize in Refs halten, damit sie nicht in die Effect-Deps
  // müssen (sie werden oft inline neu erzeugt).
  const serRef = useRef(opts.serialize);   serRef.current = opts.serialize
  const desRef = useRef(opts.deserialize); desRef.current = opts.deserialize

  // Storage-Key einmalig pro Instanz auf den aktuellen User festnageln.
  const keyRef = useRef<string>('')
  if (!keyRef.current) {
    const eid = useAuthStore.getState().employeeId ?? 'anon'
    keyRef.current = `plain:filt:${eid}:${rawKey}`
  }
  const key = keyRef.current

  const [state, setState] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key)
      if (raw != null) {
        const parsed = JSON.parse(raw)
        return desRef.current ? desRef.current(parsed) : (parsed as T)
      }
    } catch { /* defekter Eintrag / privater Modus → Default */ }
    return typeof initial === 'function' ? (initial as () => T)() : initial
  })

  useEffect(() => {
    try {
      const toStore = serRef.current ? serRef.current(state) : state
      localStorage.setItem(key, JSON.stringify(toStore))
    } catch { /* Quota voll / privater Modus → ignorieren */ }
  }, [key, state])

  return [state, setState]
}

/** Sticky-Variante für `Set<string>`-Filter (Filter-Chips). */
export function useStickySet(
  rawKey:  string,
  initial: () => Set<string> = () => new Set(),
): [Set<string>, Dispatch<SetStateAction<Set<string>>>] {
  return useStickyState<Set<string>>(rawKey, initial, {
    serialize:   s => [...s],
    deserialize: raw => new Set(Array.isArray(raw) ? (raw as string[]) : []),
  })
}
