import { useQuery } from '@tanstack/react-query'
import { CalendarRange, X } from 'lucide-react'
import { useState } from 'react'
import { fetchMyRecap, type RecapPeriod } from '@/api/mitarbeiter'
import { useGamificationConfig } from '@/hooks/useGamificationConfig'

/**
 * Bestimmt anhand des heutigen Datums, welcher Recap (falls ueberhaupt einer)
 * gezeigt werden soll.
 *
 *   Fr/Sa/So               -> 'week'   (aktuelle Woche zusammenfassen)
 *   1.-3. eines Monats     -> 'month'  (Vormonat anzeigen)
 *   1.-7. Januar           -> 'year'   (Vorjahr anzeigen)
 *   sonst                  -> null
 *
 * Year hat Vorrang vor Month, Month vor Week.
 */
function suggestPeriod(now = new Date()): RecapPeriod | null {
  const dom    = now.getDate()
  const month  = now.getMonth() // 0-11
  const dow    = now.getDay()   // 0=So..6=Sa
  if (month === 0 && dom <= 7) return 'year'
  if (dom <= 3)                return 'month'
  if (dow === 5 || dow === 6 || dow === 0) return 'week'
  return null
}

function fmtH(n: number) {
  return n.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

const DISMISS_KEY_PREFIX = 'plain:recap-dismissed'

export function RecapCard() {
  const { isFeatureEnabled } = useGamificationConfig()
  const enabled = isFeatureEnabled('recaps')
  const period  = suggestPeriod()

  const { data, isLoading } = useQuery({
    queryKey: ['my-recap', period],
    queryFn:  () => fetchMyRecap(period!),
    staleTime: 60_000 * 5,
    enabled:   enabled && period != null,
  })

  // Dismiss-State pro Period+Label, damit der User die Karte schliessen kann
  // und sie nicht jeden Tag wieder kommt.
  const dismissKey = data?.data ? `${DISMISS_KEY_PREFIX}:${period}:${data.data.label}` : ''
  const [dismissed, setDismissed] = useState(() => dismissKey ? localStorage.getItem(dismissKey) === '1' : false)

  if (!enabled || period === null || isLoading || !data?.data || dismissed) return null
  const r = data.data

  // Nicht anzeigen wenn der Zeitraum komplett leer war -- sonst wirkt der
  // Rueckblick auf neue / inaktive User unsinnig.
  const totalActivity = r.hours_booked + r.bookings_count + r.projects_count + r.offers_count + r.invoices_count
  if (totalActivity === 0) return null

  function handleDismiss() {
    if (dismissKey) localStorage.setItem(dismissKey, '1')
    setDismissed(true)
  }

  const headline =
    period === 'week'  ? `Rückblick auf deine Woche` :
    period === 'month' ? `Rückblick auf ${r.label}` :
                         `Dein PlaIn-Jahr ${r.label}`

  return (
    <div className="recap-card">
      <button className="recap-card-close" onClick={handleDismiss} title="Ausblenden">
        <X size={14} strokeWidth={2} />
      </button>
      <div className="recap-card-header">
        <CalendarRange size={16} strokeWidth={2} />
        <strong>{headline}</strong>
      </div>
      <div className="recap-card-stats">
        <Stat value={fmtH(r.hours_booked)}    unit="h"        label="gebucht" />
        <Stat value={r.bookings_count}         unit="Einträge" label="Buchungen" />
        <Stat value={r.projects_count}         unit=""         label="Projekte aktiv" />
        {r.offers_count   > 0 && <Stat value={r.offers_count}   unit="" label="Angebote" />}
        {r.invoices_count > 0 && <Stat value={r.invoices_count} unit="" label="Rechnungen" />}
      </div>
    </div>
  )
}

function Stat({ value, unit, label }: { value: number | string; unit: string; label: string }) {
  return (
    <div className="recap-stat">
      <div className="recap-stat-value">
        {value}{unit && <span className="recap-stat-unit"> {unit}</span>}
      </div>
      <div className="recap-stat-label">{label}</div>
    </div>
  )
}
