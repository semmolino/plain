import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ClockPlus, History } from 'lucide-react'
import { useCanBook, useBookableProjects } from '@/hooks/useBooking'
import { fetchRecents } from '@/api/recents'
import { fetchMonthBalance } from '@/api/mitarbeiter'
import { useQuickBooking } from '@/store/quickBookingStore'
import { localIsoDate, fmtHours } from '@/utils/zeit'

/**
 * „Zeit buchen" als Karte in der Uebersicht (UI-Pilot 2026-09).
 *
 * Die Uebersicht ist die Startseite — und Zeit buchen die haeufigste Aufgabe
 * der meisten Nutzer. Vorher kam man von hier nur ueber Projekte → Projekt →
 * Buchungen → Dialog dorthin. Die Karte zeigt, was heute schon gebucht ist,
 * und bietet die zuletzt gebuchten Leistungen zum erneuten Buchen an.
 *
 * Gleiche Rechte wie der Knopf in der Kopfzeile.
 */
export function QuickTimeCard({ employeeId }: { employeeId: number | null }) {
  const { canBook } = useCanBook()
  return canBook ? <QuickTimeCardInner employeeId={employeeId} /> : null
}

function QuickTimeCardInner({ employeeId }: { employeeId: number | null }) {
  const open  = useQuickBooking(s => s.open)
  const now   = new Date()
  const year  = now.getFullYear()
  const month = now.getMonth() + 1
  const today = localIsoDate(now)

  // Eigener Saldo ist ohne employees.view lesbar (routes/mitarbeiter.js).
  const { data: bal } = useQuery({
    queryKey: ['emp-balance', employeeId, year, month],
    queryFn:  () => fetchMonthBalance(employeeId!, year, month),
    enabled:  employeeId != null,
    staleTime: 60_000,
  })
  const { data: recentsData } = useQuery({
    queryKey: ['recents', 'project_structure', null, 'recent'],
    queryFn:  () => fetchRecents('project_structure', 12, { sortBy: 'recent' }),
    staleTime: 30_000,
  })
  const { data: projectsData } = useBookableProjects()

  // Defensiv: eine unvollstaendige Antwort darf die Startseite nicht mitreissen.
  const days   = Array.isArray(bal?.data?.days) ? bal.data.days : null
  const todayH = days ? (days.find(d => d.date === today)?.actual ?? 0) : null
  const recents = useMemo(() => {
    const projects = Array.isArray(projectsData?.data) ? projectsData.data : []
    const list     = Array.isArray(recentsData?.data) ? recentsData.data : []
    const seen = new Set<number>()
    return list.flatMap(r => {
      const pid = Number((r.META as { project_id?: number } | null)?.project_id)
      const project = projects.find(p => p.ID === pid)
      if (!project || seen.has(r.ENTITY_ID)) return []
      seen.add(r.ENTITY_ID)
      const label = r.LABEL ?? ''
      const leaf  = label.includes(' > ') ? label.slice(label.lastIndexOf(' > ') + 3) : label
      return [{ id: r.ID, pid, sid: r.ENTITY_ID, abbr: project.ABBR, leaf, full: label }]
    }).slice(0, 3)
  }, [recentsData, projectsData])

  return (
    <section className="dash-band-card dash-time" aria-labelledby="dash-time-title">
      <h2 className="dash-band-title" id="dash-time-title">Zeit buchen</h2>
      <p className="dash-time-today">
        {todayH == null ? 'Stunden für heute erfassen' : todayH > 0
          ? <>Heute gebucht: <strong>{fmtHours(todayH)} h</strong></>
          : 'Heute noch nichts gebucht'}
      </p>
      {recents.length > 0 && (
        <div className="dash-time-recents">
          <span className="dash-time-recents-title"><History size={13} strokeWidth={2} aria-hidden="true" /> Nochmal buchen</span>
          {recents.map(r => (
            <button key={r.id} type="button" className="qb-chip qb-recent-chip dash-time-chip" title={`${r.abbr} · ${r.full}`}
              onClick={() => open({ projectId: r.pid, structureId: r.sid })}>
              <span className="qb-chip-project">{r.abbr}</span>
              <span className="qb-chip-leaf">{r.leaf}</span>
            </button>
          ))}
        </div>
      )}
      <button type="button" className="btn-primary dash-time-cta" onClick={() => open({})}>
        <ClockPlus size={16} strokeWidth={2} aria-hidden="true" /> Zeit buchen
      </button>
    </section>
  )
}
