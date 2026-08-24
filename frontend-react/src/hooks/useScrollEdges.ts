import { useCallback, useRef } from 'react'

/**
 * Meldet einem waagerecht scrollenden Container, ob links bzw. rechts noch
 * Inhalt liegt — als Attribute `data-more-left` / `data-more-right`.
 *
 * Warum das noetig ist: Unter Windows und macOS sind Bildlaufleisten
 * ueberlagert und erst waehrend des Scrollens sichtbar. Eine Tabelle, die
 * breiter ist als ihr Container, sieht deshalb aus wie eine, die passt. In
 * der Rechnungsliste sind das auf einem 1280px-Bildschirm 231px — drei
 * Wertspalten, die niemand sucht, weil nichts auf sie hinweist.
 *
 * Verwendung:
 *   const scrollRef = useScrollEdges<HTMLDivElement>()
 *   <div className="table-scroll" ref={scrollRef}> <table>…</table> </div>
 *
 * ── Drei Entscheidungen, die beim Bau je einen Fehler gekostet haben ──
 *
 * 1. **Callback-Ref statt useRef + useEffect.** Die erste Fassung hing an
 *    `useEffect(..., [pruefen, ...deps])`. Die Tabellen rendern aber erst,
 *    wenn die Daten da sind (`{!isLoading && <div …>}`): Beim Mount war
 *    `ref.current` noch null, der Effekt stieg aus — und lief nie wieder,
 *    weil sich seine Abhaengigkeiten nicht mehr aenderten. Ob es trotzdem
 *    funktionierte, hing davon ab, ob die Aufrufstelle zufaellig eine
 *    passende Abhaengigkeit mitgab (Angebote: `rows.length` 0 -> 8, lief;
 *    Rechnungen: `visibleCols.length` konstant, lief nicht). Ein
 *    Callback-Ref feuert, wenn der Knoten kommt und geht — unabhaengig von
 *    Abhaengigkeiten. Deshalb hat der Hook auch keinen `deps`-Parameter
 *    mehr: Es gibt nichts, was die Aufrufstelle falsch machen koennte.
 *
 * 2. **Attribut statt Klasse.** `className` steht im JSX und wird von React
 *    verwaltet; ein imperatives `classList.add` ueberlebt den naechsten
 *    Rerender nicht. `data-*` steht nicht im JSX und bleibt stehen.
 *
 * 3. **Attribut statt State.** Der Wert wird nur in CSS gebraucht. Ein
 *    useState loeste bei jedem Scroll-Ereignis ein Rerender der ganzen Liste
 *    aus — der teuerste Weg zum guenstigsten Effekt.
 *
 * Beobachtet werden Container UND Tabelle: Spalten ein- oder ausblenden
 * aendert die Tabellenbreite, ohne den Container anzufassen. ResizeObserver
 * statt window-resize, weil der Container auch dann seine Breite aendert,
 * wenn die Seitennavigation ein- oder ausklappt (dasselbe Muster wie in
 * `components/ui/Tabs.tsx`).
 */
export function useScrollEdges<T extends HTMLElement>() {
  const aufraeumen = useRef<(() => void) | null>(null)

  return useCallback((el: T | null) => {
    aufraeumen.current?.()
    aufraeumen.current = null
    if (!el) return

    const pruefen = () => {
      // 1px Toleranz: bei gebrochenen Zoomstufen ist scrollLeft nie exakt 0
      // bzw. exakt gleich der Differenz, und die Kante flackerte.
      setzen(el, 'data-more-left',  el.scrollLeft > 1)
      setzen(el, 'data-more-right', el.scrollLeft + el.clientWidth < el.scrollWidth - 1)
    }

    pruefen()
    el.addEventListener('scroll', pruefen, { passive: true })
    const ro = new ResizeObserver(pruefen)
    ro.observe(el)
    const inhalt = el.firstElementChild
    if (inhalt) ro.observe(inhalt)

    aufraeumen.current = () => {
      el.removeEventListener('scroll', pruefen)
      ro.disconnect()
    }
  }, [])
}

function setzen(el: HTMLElement, attr: string, an: boolean) {
  if (an) el.setAttribute(attr, '')
  else    el.removeAttribute(attr)
}
