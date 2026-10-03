import { useCallback, useSyncExternalStore } from 'react'

/**
 * true, solange die Media-Query zutrifft.
 *
 * Wie `useIsNarrow` nur für Fälle, in denen sich der DOM unterscheiden muss —
 * reine Darstellung gehört in eine CSS-Media-Query. Anlass: die Vorschau eines
 * Belegs zeigt die Felder daneben nur, wo Platz für beides ist; nur
 * ausgeblendet stünden sie doppelt im DOM.
 */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback((onChange: () => void) => {
    const mq = window.matchMedia(query)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [query])
  return useSyncExternalStore(subscribe, () => window.matchMedia(query).matches, () => false)
}
