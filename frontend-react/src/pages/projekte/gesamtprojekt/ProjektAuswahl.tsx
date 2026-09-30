import { useMemo, useState } from 'react'
import type { Project } from '@/api/projekte'

const MAX_ROWS = 200

/**
 * Projekte zum Ankreuzen — für „Neues Gesamtprojekt" und „Projekte zuordnen".
 *
 * Ein Projekt, das schon in einem anderen Gesamtprojekt steht, bleibt
 * wählbar (es wechselt dann), trägt aber den bisherigen Namen dabei. Sonst
 * ginge die alte Zuordnung ohne Hinweis verloren.
 */
export function ProjektAuswahl({ projects, selected, onChange, currentGroupId, idPrefix }: {
  projects:       Project[]
  selected:       Set<number>
  onChange:       (next: Set<number>) => void
  /** Gesamtprojekt, für das gewählt wird — dessen Projekte gelten nicht als „anderswo". */
  currentGroupId: number | null
  idPrefix:       string
}) {
  const [search, setSearch] = useState('')

  const matches = useMemo(() => {
    const q = search.trim().toLowerCase()
    const rows = q
      ? projects.filter(p => `${p.ABBR} ${p.NAME} ${p.GROUP_NAME ?? ''} ${p.ADDRESS_NAME ?? ''}`.toLowerCase().includes(q))
      : projects
    return [...rows].sort((a, b) => a.ABBR.localeCompare(b.ABBR, 'de', { numeric: true }))
  }, [projects, search])

  function toggle(id: number) {
    const next = new Set(selected)
    if (next.has(id)) next.delete(id); else next.add(id)
    onChange(next)
  }

  return (
    <div className="pg-pick">
      <label htmlFor={`${idPrefix}-search`} className="sr-only">Projekte durchsuchen</label>
      <input id={`${idPrefix}-search`} type="search" className="list-search" placeholder="Projekt suchen …"
        value={search} onChange={e => setSearch(e.target.value)} />
      <p className="pg-pick-meta" aria-live="polite">
        {selected.size === 0 ? 'Kein Projekt ausgewählt' : selected.size === 1 ? '1 Projekt ausgewählt' : `${selected.size} Projekte ausgewählt`}
      </p>
      {matches.length === 0 ? (
        <p className="empty-note">{projects.length === 0 ? 'Noch keine Projekte angelegt.' : 'Kein Projekt passt zur Suche.'}</p>
      ) : (
        <ul className="pg-pick-list">
          {matches.slice(0, MAX_ROWS).map(p => {
            const elsewhere = p.PROJECT_GROUP_ID != null && p.PROJECT_GROUP_ID !== currentGroupId
            return (
              <li key={p.ID}>
                <label className="pg-pick-row">
                  <input type="checkbox" checked={selected.has(p.ID)} onChange={() => toggle(p.ID)} />
                  <span className="pg-pick-abbr">{p.ABBR}</span>
                  <span className="pg-pick-name" title={p.NAME}>{p.NAME}</span>
                  {elsewhere && <span className="pg-pick-note">bisher: {p.GROUP_NAME}</span>}
                </label>
              </li>
            )
          })}
        </ul>
      )}
      {matches.length > MAX_ROWS && (
        <p className="pg-pick-meta">{matches.length - MAX_ROWS} weitere — bitte die Suche eingrenzen.</p>
      )}
    </div>
  )
}
