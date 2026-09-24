import { ClockPlus } from 'lucide-react'
import { Can } from '@/components/ui/Can'
import { useQuickBooking } from '@/store/quickBookingStore'

/**
 * „Zeit buchen" in der Kopfzeile — auf jeder Seite erreichbar (UI-Pilot
 * 2026-09). Auf dem Handy nur das Symbol (44 px), die Beschriftung bleibt
 * fuer Screenreader stehen.
 */
export function QuickBookingButton() {
  const open = useQuickBooking(s => s.open)
  return (
    <Can allOf={['projects.bookings.create', 'projects.view']}>
      <button type="button" className="hdr-action hdr-action--accent" onClick={() => open()}
        title="Arbeitszeit buchen">
        <ClockPlus size={15} strokeWidth={2} aria-hidden="true" />
        <span className="hdr-label">Zeit buchen</span>
      </button>
    </Can>
  )
}
