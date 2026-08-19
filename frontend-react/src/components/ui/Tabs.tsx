import { useCallback, useEffect, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'

interface Tab { id: string; label: string }

interface Props {
  tabs:     Tab[]
  active:   string
  onChange: (id: string) => void
}

/**
 * Reiterleiste, die seitlich scrollt, wenn die Reiter nicht in eine Zeile
 * passen — mit Pfeilen an den Raendern als Hinweis darauf.
 *
 * Warum Pfeile: die Bildlaufleiste war ausgeblendet, und selbst eine schmale
 * eingeblendete wird ueberlesen. In der Administration blieben dadurch ganze
 * Bereiche unauffindbar. Ein Pfeil ist zugleich Hinweis UND Bedienelement.
 *
 * Die Pfeile erscheinen nur, wenn es in ihre Richtung tatsaechlich etwas zu
 * sehen gibt — links am Anfang also keiner. Passt alles in eine Zeile, sieht
 * die Leiste aus wie vorher.
 */
export function Tabs({ tabs, active, onChange }: Props) {
  const scrollerRef = useRef<HTMLDivElement>(null)
  const [links, setLinks]   = useState(false)
  const [rechts, setRechts] = useState(false)

  const pruefen = useCallback(() => {
    const el = scrollerRef.current
    if (!el) return
    // 1px Toleranz: bei gebrochenen Zoomstufen ist scrollLeft nie exakt 0
    // bzw. exakt gleich der Differenz, und der Pfeil flackerte.
    setLinks(el.scrollLeft > 1)
    setRechts(el.scrollLeft + el.clientWidth < el.scrollWidth - 1)
  }, [])

  useEffect(() => {
    const el = scrollerRef.current
    if (!el) return
    pruefen()
    // ResizeObserver statt window-resize: die Leiste aendert ihre Breite auch,
    // wenn die Seitennavigation ein- oder ausklappt, ohne dass sich das
    // Fenster aendert.
    const ro = new ResizeObserver(pruefen)
    ro.observe(el)
    return () => ro.disconnect()
  }, [pruefen, tabs.length])

  // Den aktiven Reiter ins Sichtfeld holen. Ohne das landet man nach einem
  // Sprung aus der Navigation auf einem Reiter, den man nicht sieht.
  useEffect(() => {
    const el = scrollerRef.current
    const knopf = el?.querySelector<HTMLElement>('.tab-btn.active')
    knopf?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [active])

  function scrollen(richtung: -1 | 1) {
    const el = scrollerRef.current
    if (!el) return
    // Etwas weniger als eine volle Breite, damit ein Reiter als Anker
    // stehenbleibt und der Sprung nachvollziehbar ist.
    el.scrollBy({ left: richtung * Math.max(120, el.clientWidth * 0.7), behavior: 'smooth' })
  }

  return (
    <div className="tabs-wrap">
      {links && (
        <button type="button" className="tabs-arrow tabs-arrow-left"
          onClick={() => scrollen(-1)} tabIndex={-1} aria-hidden="true">
          <ChevronLeft size={16} strokeWidth={2} />
        </button>
      )}

      <div className="tabs" ref={scrollerRef} onScroll={pruefen} role="tablist">
        {tabs.map(t => (
          <button
            key={t.id}
            className={'tab-btn' + (active === t.id ? ' active' : '')}
            onClick={() => onChange(t.id)}
            type="button"
            role="tab"
            aria-selected={active === t.id}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* aria-hidden + tabIndex -1: die Pfeile sind eine reine Maus-/Tipp-
          Hilfe. Mit der Tastatur laeuft man ohnehin durch die Reiter selbst,
          und der Browser scrollt den fokussierten Reiter automatisch ins Bild —
          ein zusaetzlicher Tabstopp waere dort nur im Weg. */}
      {rechts && (
        <button type="button" className="tabs-arrow tabs-arrow-right"
          onClick={() => scrollen(1)} tabIndex={-1} aria-hidden="true">
          <ChevronRight size={16} strokeWidth={2} />
        </button>
      )}
    </div>
  )
}
