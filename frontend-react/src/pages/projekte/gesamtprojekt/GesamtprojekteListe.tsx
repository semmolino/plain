import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ChevronRight } from 'lucide-react'
import { useIsNarrow } from '@/hooks/useIsNarrow'
import { Can } from '@/components/ui/Can'
import { HelpHint } from '@/components/ui/HelpHint'
import { ListLoading } from '@/components/ui/Skeleton'
import { Message } from '@/components/ui/Message'
import { usePermission } from '@/store/permissionsStore'
import { fetchProjectGroups } from '@/api/gesamtprojekte'
import { fetchProjectList } from '@/api/reports'
import { money0 } from '@/utils/money'
import { rowClickHandler } from '@/utils/rowClick'
import { GesamtprojektDialog } from './GesamtprojektDialog'
import { NOW_FILTER } from './gesamtprojektUi'

interface Sums { honorar: number; billed: number; visible: number }

/**
 * Reiter „Gesamtprojekte" der Projekte-Seite.
 *
 * Beträge stehen nur mit `reports.view` da und kommen aus derselben Quelle wie
 * der Report „Alle Projekte" — also nur aus Projekten im eigenen Reporting-
 * Bereich. Fehlen welche, sagt die Zeile „2 von 3" statt eine Summe zu
 * zeigen, die für das ganze Vorhaben gehalten würde.
 */
export function GesamtprojekteListe({ onOpenGroup }: { onOpenGroup: (id: number) => void }) {
  const canReports = usePermission('reports.view')
  const narrow = useIsNarrow()
  const [search, setSearch] = useState('')
  const [showCreate, setShowCreate] = useState(false)

  const { data, isLoading, isError } = useQuery({ queryKey: ['project-groups'], queryFn: fetchProjectGroups })
  const { data: reportData } = useQuery({
    queryKey: ['project-list', NOW_FILTER],
    queryFn:  () => fetchProjectList(NOW_FILTER),
    enabled:  canReports,
    retry:    false,
    staleTime: 60_000,
  })
  const groups = useMemo(() => data?.data ?? [], [data])

  const sums = useMemo(() => {
    const m = new Map<number, Sums>()
    for (const r of reportData?.data ?? []) {
      if (r.PROJECT_GROUP_ID == null) continue
      const s = m.get(r.PROJECT_GROUP_ID) ?? { honorar: 0, billed: 0, visible: 0 }
      s.honorar += Number(r.BUDGET_TOTAL_NET) || 0
      s.billed  += Number(r.BILLED_NET_TOTAL) || 0
      s.visible += 1
      m.set(r.PROJECT_GROUP_ID, s)
    }
    return m
  }, [reportData])
  const showMoney = canReports && !!reportData

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase()
    return q
      ? groups.filter(g => `${g.ABBR ?? ''} ${g.NAME} ${g.ADDRESS_NAME} ${g.MANAGER_NAME} ${g.NOTES ?? ''}`.toLowerCase().includes(q))
      : groups
  }, [groups, search])

  const cols = showMoney ? 6 : 4

  function moneyCell(g: typeof groups[number], pick: (s: Sums) => number) {
    const s = sums.get(g.ID)
    if (g.PROJECT_COUNT === 0) return '—'
    if (!s) return <span className="pg-muted" title="Keines der Projekte liegt in deinem Reporting-Bereich">—</span>
    return (
      <>
        {money0(pick(s))}
        {s.visible < g.PROJECT_COUNT && (
          <span className="pg-partial" title="Nur Projekte in deinem Reporting-Bereich sind enthalten">
            {' '}({s.visible} von {g.PROJECT_COUNT})
          </span>
        )}
      </>
    )
  }

  return (
    <>
      <div className="list-toolbar">
        <input type="search" className="list-search" placeholder="Gesamtprojekt suchen …" aria-label="Gesamtprojekte durchsuchen"
          value={search} onChange={e => setSearch(e.target.value)} />
        <Can permission="projects.edit">
          <button type="button" className="btn-primary btn-small pl-toolbar-actions" onClick={() => setShowCreate(true)}>
            + Neues Gesamtprojekt
          </button>
        </Can>
      </div>

      {isLoading && <ListLoading columns={cols} />}
      {isError && <Message type="error" text="Die Gesamtprojekte konnten nicht geladen werden." />}

      {!isLoading && !isError && groups.length === 0 && (
        <div className="empty-block">
          <p className="empty-note">Noch keine Gesamtprojekte.</p>
          <p className="empty-block-why">
            Läuft ein Vorhaben über mehrere Verträge — Stufen, Nachträge als eigener Vertrag, ein zweiter
            Rechnungsempfänger —, fasst ein Gesamtprojekt die Projekte zusammen. Honorar, Leistungsstand und
            Abrechnung stehen dann für das ganze Vorhaben an einer Stelle; Verträge und Rechnungen bleiben bei
            den einzelnen Projekten.
          </p>
          <Can permission="projects.edit">
            <button type="button" className="btn-primary" onClick={() => setShowCreate(true)}>+ Erstes Gesamtprojekt anlegen</button>
          </Can>
        </div>
      )}

      {!isLoading && !isError && groups.length > 0 && narrow && (
        // Handy: Liste statt Tabelle (Muster .km-*), sonst fielen Anzahl und Betrag weg.
        rows.length === 0
          ? <p className="empty-note">Kein Gesamtprojekt passt zur Suche.</p>
          : (
            <ul className="km-list">
              {rows.map(g => {
                const s = sums.get(g.ID)
                const count = g.PROJECT_COUNT === 1 ? '1 Projekt' : `${g.PROJECT_COUNT} Projekte`
                const partial = s && s.visible < g.PROJECT_COUNT ? ` (${s.visible} von ${g.PROJECT_COUNT} im Reporting)` : ''
                return (
                  <li key={g.ID}>
                    <button type="button" className="km-row" onClick={() => onOpenGroup(g.ID)}>
                      <span className="km-main">
                        <span className="km-title">{[g.ABBR, g.NAME].filter(Boolean).join(' · ')}</span>
                        <span className="km-sub">{[count + partial, g.ADDRESS_NAME].filter(Boolean).join(' · ')}</span>
                      </span>
                      {showMoney && s && <span className="km-value">{money0(s.honorar)}</span>}
                      <ChevronRight size={16} strokeWidth={2} className="km-chev" aria-hidden="true" />
                    </button>
                  </li>
                )
              })}
            </ul>
          )
      )}

      {!isLoading && !isError && groups.length > 0 && !narrow && (
        <div className="list-section">
          <table className="master-table master-table--einzeilig">
            <thead>
              <tr>
                <th scope="col">Kürzel</th>
                <th scope="col">Name</th>
                <th scope="col" className="pg-col-wide">Auftraggeber</th>
                <th scope="col" className="num">Projekte</th>
                {showMoney && <th scope="col" className="num">Honorar <HelpHint id="report.gesamtprojekt" align="right" size={12} /></th>}
                {showMoney && <th scope="col" className="num pg-col-wide">Abgerechnet</th>}
              </tr>
            </thead>
            <tbody>
              {rows.map(g => (
                <tr key={g.ID} className="clickable-row" onClick={rowClickHandler(() => onOpenGroup(g.ID))}>
                  <td className="cell-id">
                    <button type="button" className="link-btn" onClick={() => onOpenGroup(g.ID)}>{g.ABBR || '—'}</button>
                  </td>
                  <td><span className="cell-clamp" title={g.NAME}>{g.NAME}</span></td>
                  <td className="pg-col-wide"><span className="cell-clamp" title={g.ADDRESS_NAME}>{g.ADDRESS_NAME || '—'}</span></td>
                  <td className="num">{g.PROJECT_COUNT}</td>
                  {showMoney && <td className="num">{moneyCell(g, s => s.honorar)}</td>}
                  {showMoney && <td className="num pg-col-wide">{moneyCell(g, s => s.billed)}</td>}
                </tr>
              ))}
              {rows.length === 0 && (
                <tr><td colSpan={cols} className="empty-note">Kein Gesamtprojekt passt zur Suche.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      <GesamtprojektDialog open={showCreate} withProjects onClose={() => setShowCreate(false)}
        onCreated={g => { setShowCreate(false); onOpenGroup(g.ID) }} />
    </>
  )
}
