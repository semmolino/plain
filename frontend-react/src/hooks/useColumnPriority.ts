import { useEffect, useState } from 'react'

/**
 * Spaltenstufe: wie viel Platz hat die Liste gerade?
 *
 *   1 = wenig  (Handy)      — nur Spalten, die man zum Wiedererkennen braucht
 *   2 = mittel (Tablet/Laptop)
 *   3 = viel   (breiter Bildschirm) — alles
 *
 * Warum ueberhaupt: Die Rechnungsliste ist mit allen Spalten rund 1279px
 * breit und liegt damit auf einem 1280px-Bildschirm in einem 1048px-Container
 * (gemessen 24.08.2026). Der Ueberlauf war bisher die einzige Antwort darauf —
 * seitwaerts scrollen, auf dem Handy ueber drei Bildschirmbreiten pro Zeile.
 * Statt alles zu zeigen und den Rest wegzuschieben, zeigen wir bei wenig Platz
 * weniger.
 *
 * Warum in JS und nicht als CSS-Media-Query: Der Spaltenwaehler muss wissen,
 * was gerade ausgeblendet ist — sonst steht dort ein Haken bei einer Spalte,
 * die man nicht sieht. Ein CSS-`display:none` waere fuer die Darstellung
 * einfacher, aber die Liste wuerde ueber ihren eigenen Zustand luegen.
 *
 * Die Schwellen orientieren sich an den vorhandenen Breakpoints (640/700) und
 * daran, ab wann die breiteste Liste tatsaechlich vollstaendig passt.
 */
export type PrioLevel = 1 | 2 | 3

/**
 * 1520px ist nicht gegriffen, sondern gemessen: Die Seitennavigation und die
 * Innenabstaende kosten rund 232px, die Rechnungsliste braucht mit allen
 * Spalten rund 1279px. Erst ab 1511px Fensterbreite passt sie vollstaendig.
 * Bei 1400 stand Stufe 3 zu frueh an und die Tabelle lief wieder 71px ueber —
 * der Nutzer haette Spalten zurueckbekommen und dafuer wieder scrollen muessen.
 */
const SCHWELLEN: [string, PrioLevel][] = [
  ['(min-width: 1520px)', 3],
  ['(min-width: 700px)',  2],
]

function ermitteln(): PrioLevel {
  if (typeof window === 'undefined') return 3
  for (const [q, stufe] of SCHWELLEN) if (window.matchMedia(q).matches) return stufe
  return 1
}

export function useColumnPriority(): PrioLevel {
  const [stufe, setStufe] = useState<PrioLevel>(ermitteln)

  useEffect(() => {
    const mqs = SCHWELLEN.map(([q]) => window.matchMedia(q))
    const onChange = () => setStufe(ermitteln())
    onChange()
    mqs.forEach(mq => mq.addEventListener('change', onChange))
    return () => mqs.forEach(mq => mq.removeEventListener('change', onChange))
  }, [])

  return stufe
}
