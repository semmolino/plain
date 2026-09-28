import type { ReactNode } from 'react'
import { fmtEur } from '@/utils/money'
import { differs } from './strukturCalc'

/**
 * Ein Summenwert, der schon offene Eingaben enthaelt (Runde 6): kursiv mit
 * Punkt wie in der Aktionsleiste, dazu „noch nicht gespeichert" fuer
 * Screenreader und im Tooltip samt gespeichertem Wert. Ohne Abweichung nur
 * der Inhalt.
 */
export function PendingValue({ now, saved, children }: { now: number | null | undefined; saved: number | null | undefined; children: ReactNode }) {
  if (!differs(now, saved)) return <>{children}</>
  return (
    <span className="sx-pending" title={`Noch nicht gespeichert – gespeichert: ${fmtEur(Number(saved ?? 0))}`}>
      {children}<span className="sr-only"> (noch nicht gespeichert)</span>
    </span>
  )
}
