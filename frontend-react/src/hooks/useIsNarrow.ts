import { useEffect, useState } from 'react'

/** Muss zum Breakpoint der Mobil-Regeln in globals.css passen. */
const QUERY = '(max-width: 640px)'

/**
 * true auf Handy-Breite.
 *
 * Nur benutzen, wenn sich die REIHENFOLGE im DOM aendern muss — reine
 * Darstellungsunterschiede gehoeren in eine CSS-Media-Query.
 *
 * Konkreter Anlass: In der Rechnungsliste steht die Aktionsspalte als
 * letzte Zelle. Auf dem Handy liegt sie damit am Ende einer rund 1200px
 * breiten Tabelle und ist ohne Seitwaerts-Scrollen unerreichbar.
 * `position: sticky; left: 0` half nicht — sticky haelt ein Element erst
 * fest, wenn es den Rand erreicht, es holt es nicht dorthin.
 */
export function useIsNarrow(): boolean {
  const [narrow, setNarrow] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(QUERY).matches
  )

  useEffect(() => {
    const mq = window.matchMedia(QUERY)
    const onChange = (e: MediaQueryListEvent) => setNarrow(e.matches)
    setNarrow(mq.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  return narrow
}
