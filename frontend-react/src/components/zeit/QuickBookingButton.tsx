import { ClockPlus } from 'lucide-react'
import { useCanBook } from '@/hooks/useBooking'
import { useQuickBooking } from '@/store/quickBookingStore'

/**
 * „Zeit buchen" in der Kopfzeile — auf jeder Seite erreichbar (UI-Pilot
 * 2026-09). Auf dem Handy nur das Symbol (44 px), die Beschriftung bleibt
 * fuer Screenreader stehen.
 */
export function QuickBookingButton() {
  const open = useQuickBooking(s => s.open)
  const { canBook } = useCanBook()
  if (!canBook) return null
  return (
    <>
      <button type="button" className="hdr-action hdr-action--accent" onClick={() => open()}
        title="Arbeitszeit buchen">
        <ClockPlus size={15} strokeWidth={2} aria-hidden="true" />
        <span className="hdr-label">Zeit buchen</span>
      </button>
    </>
  )
}
