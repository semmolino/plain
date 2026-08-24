import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Laesst so viele Spalten weg, wie noetig sind, damit die Tabelle in ihren
 * Container passt — gemessen, nicht geraten.
 *
 * ── Warum nicht Media-Queries ────────────────────────────────────────────
 *
 * Der erste Versuch stufte nach Fensterbreite: „ab 1520px passen alle
 * Spalten". Diese Schwelle war an der Test-Fixture ermittelt, und die war zu
 * ordentlich — dort stand „Abschlag" (8 Zeichen), in der echten Instanz steht
 * „Abschlagsrechnung" (17) und Betraege sind siebenstellig. Ergebnis: In den
 * Tests passte alles, auf dem Bildschirm des Nutzers lief dieselbe Liste in
 * BEIDEN Stufen ueber, und die rechts fixierte Aktionsspalte schnitt Betraege
 * mittendrin ab („5.643,0"). Eine halbe Zahl liest sich nicht als „hier geht
 * es weiter", sondern als Fehler.
 *
 * Eine Schwelle in Pixeln kann das nicht loesen: Wie breit eine Tabelle
 * wirklich wird, haengt an den Daten (Textlaengen, Betragsgroessen), an der
 * Schriftgroesse und am Zoom. Das weiss nur der Browser, und zwar erst nach
 * dem Rendern. Also fragen wir ihn.
 *
 * ── Wie es arbeitet ──────────────────────────────────────────────────────
 *
 * Nach jedem Rendern wird gemessen, um wie viel die Tabelle uebersteht. Dann
 * werden aus `droppable` (niedrigste Wichtigkeit zuerst) so viele Spalten
 * weggelassen, bis der Ueberstand gedeckt ist — in EINEM Schritt, weil die
 * Breiten der sichtbaren Spalten bekannt sind. Wird das Fenster wieder
 * groesser, kommt eine Spalte zurueck, sobald ihre gemerkte Breite
 * nachweislich hineinpasst.
 *
 * `PUFFER` verhindert Flattern an der Grenze: Ohne ihn koennte eine Spalte
 * zurueckkommen, dadurch minimal ueberstehen und sofort wieder verschwinden.
 *
 * ── Voraussetzung im Markup ──────────────────────────────────────────────
 *
 * Jede `<th>` einer wegfallbaren Spalte braucht `data-col="<key>"`, damit ihre
 * Breite zugeordnet werden kann.
 *
 *   const [weg, fitRef] = useFitColumns(['seHeld', 'payable', 'net'])
 *   const sichtbar = COLUMNS.filter(c => !weg.has(c.key))
 *   <div className="table-scroll" ref={fitRef}> <table>…</table> </div>
 *
 * ── Warum ein Callback-Ref und kein useRef-Objekt ────────────────────────
 *
 * Die Listen rendern ihre Tabelle erst, wenn die Daten da sind
 * (`{!isLoading && <div …>}`). Ein Effekt, der beim Mount laeuft, findet
 * deshalb nichts vor und steigt aus — und laeuft danach nie wieder, weil sich
 * seine Abhaengigkeiten nicht aendern. Genau dieser Fehler ist beim Bau
 * zweimal passiert (erst in `useScrollEdges`, dann hier nochmal). Ein
 * Callback-Ref feuert, wenn der Knoten kommt und geht. Er ist die einzige
 * Fassung, bei der die Aufrufstelle nichts falsch machen kann.
 */

/** Reserve in px, damit eine zurueckgeholte Spalte nicht sofort wieder faellt. */
const PUFFER = 16

export function useFitColumns<K extends string>(
  droppable: K[],
  deps: unknown[] = [],
): [Set<K>, (el: HTMLElement | null) => void] {
  const [weg, setWeg] = useState<Set<K>>(() => new Set())
  /** Zuletzt gemessene Breite je Spalte — auch fuer aktuell weggelassene. */
  const breiten = useRef<Map<K, number>>(new Map())
  const elRef   = useRef<HTMLElement | null>(null)
  /** Containerbreite, bei der die jeweilige Spalte weichen musste. */
  const schwelle = useRef<Map<K, number>>(new Map())
  const schluessel = droppable.join('|')

  const pruefen = useCallback(() => {
    const sc = elRef.current
    const tabelle = sc?.firstElementChild as HTMLElement | null
    if (!sc || !tabelle) return

    // Breiten der gerade sichtbaren Spalten merken.
    for (const th of tabelle.querySelectorAll<HTMLElement>('th[data-col]')) {
      const key = th.dataset.col as K | undefined
      if (key) breiten.current.set(key, th.getBoundingClientRect().width)
    }

    const platz    = sc.clientWidth
    const ueber    = tabelle.scrollWidth - platz
    const breiteVon = (k: K) => breiten.current.get(k) ?? 100

    setWeg(bisher => {
      // Erst aussortieren, was gar nicht mehr wegfallen DARF. Nimmt die
      // Aufrufstelle eine Spalte aus `droppable` heraus — weil der Nutzer sie
      // im Waehler bewusst angehakt hat —, muss sie sofort zurueckkommen.
      // Ohne diesen Schritt blieb sie in `weg` haengen und verschwand
      // dauerhaft, obwohl der Nutzer sie ausdruecklich angefordert hatte.
      const erlaubt = new Set(droppable)
      const neu = new Set([...bisher].filter(k => erlaubt.has(k)))

      if (ueber > 1) {
        // GENAU EINE Spalte je Durchgang, dann neu messen.
        //
        // Der naheliegende Weg — Spaltenbreiten aufaddieren, bis der
        // Ueberstand gedeckt ist — schiesst ueber das Ziel hinaus: Die
        // gemessenen Breiten stammen aus einer Tabelle mit `width: 100%`,
        // sind also gestreckt und groesser als das, was die Spalte
        // tatsaechlich braucht. Bei 1280px flogen so fuenf Spalten, obwohl
        // drei gereicht haetten — und zurueckgeholt wird nichts, solange das
        // Fenster gleich breit bleibt. Schrittweise vorgehen kostet ein paar
        // Renderdurchgaenge und trifft dafuer das Minimum.
        for (const k of droppable) {
          if (neu.has(k)) continue
          neu.add(k)
          // Merken, bei WELCHER Containerbreite die Spalte gefallen ist.
          // Daran haengt die Rueckkehr — siehe unten.
          schwelle.current.set(k, platz)
          break
        }
      } else {
        // Rueckkehr. Wichtig: „freier Platz" laesst sich hier NICHT messen.
        // Die Tabelle hat `width: 100%` und fuellt ihren Container nach jedem
        // Weglassen wieder vollstaendig aus — der Ueberstand ist danach
        // immer 0, egal wie breit das Fenster wird. Eine Ruecknahme, die auf
        // freien Platz wartet, traete deshalb nie ein: einmal weggelassene
        // Spalten kaemen beim Aufziehen des Fensters nie zurueck.
        //
        // Stattdessen zaehlt die Containerbreite selbst: Wird sie deutlich
        // groesser als die Breite, bei der die Spalte gefallen ist, passt sie
        // wieder. Der Abstand (Spaltenbreite + Puffer) ist zugleich die
        // Hysterese, die Flattern an der Grenze verhindert.
        for (let i = droppable.length - 1; i >= 0; i--) {
          const k = droppable[i]
          if (!neu.has(k)) continue
          const gefallenBei = schwelle.current.get(k)
          if (gefallenBei === undefined || platz >= gefallenBei + breiteVon(k) + PUFFER) {
            neu.delete(k)
          }
          break   // nur eine je Durchgang; die naechste nach erneutem Messen
        }
      }

      if (neu.size === bisher.size && [...neu].every(k => bisher.has(k))) return bisher
      return neu
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [droppable, schluessel])

  const aufraeumen = useRef<(() => void) | null>(null)

  const setRef = useCallback((el: HTMLElement | null) => {
    aufraeumen.current?.()
    aufraeumen.current = null
    elRef.current = el
    if (!el) return

    pruefen()
    const ro = new ResizeObserver(pruefen)
    ro.observe(el)
    const inhalt = el.firstElementChild
    if (inhalt) ro.observe(inhalt)
    // Zoom aendert die Schriftgroesse, nicht zwingend die Containerbreite —
    // ResizeObserver allein wuerde das verpassen.
    window.addEventListener('resize', pruefen)

    aufraeumen.current = () => {
      ro.disconnect()
      window.removeEventListener('resize', pruefen)
    }
  }, [pruefen])

  // Nach jeder Aenderung erneut messen: Eine weggelassene Spalte veraendert
  // die Breite, wodurch eventuell noch eine weichen muss (oder eine
  // zurueckkommen kann). Das laeuft so lange, bis sich nichts mehr aendert —
  // `pruefen` gibt dann denselben Set zurueck und React haelt an.
  useEffect(() => {
    pruefen()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pruefen, weg, ...deps])

  return [weg, setRef]
}
