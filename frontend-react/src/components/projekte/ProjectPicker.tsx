import { useState, useEffect, useRef, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { fetchRecents } from '@/api/recents'

export interface ProjectOption { ID: number; NAME_SHORT: string; NAME_LONG: string }

interface Props {
  projects:    ProjectOption[]
  selectedId:  number | null
  onSelect:    (id: number) => void
  /** Optional: Button „Zur Projektliste →" im Dropdown (z.B. Tab-Wechsel auf Liste). */
  onGoToList?: () => void
  placeholder?: string
}

const displayName = (p: ProjectOption) => p.NAME_SHORT + (p.NAME_LONG ? ` – ${p.NAME_LONG}` : '')

/**
 * Einheitliche Projekt-Suchbox (Autocomplete) für alle Projekt-Tabs.
 * Beim Fokus: „Zuletzt verwendet" oben, darunter alle Projekte (scrollbar);
 * Tippen filtert. Optional ein Sprung „Zur Projektliste".
 */
export function ProjectPicker({ projects, selectedId, onSelect, onGoToList, placeholder = 'Projekt suchen …' }: Props) {
  const [input, setInput] = useState('')
  const [open,  setOpen]  = useState(false)
  const acRef = useRef<HTMLDivElement>(null)

  const selectedName = useMemo(() => {
    const p = selectedId != null ? projects.find(x => x.ID === selectedId) : undefined
    return p ? displayName(p) : ''
  }, [selectedId, projects])

  // Angezeigten Wert mit der Auswahl synchron halten
  useEffect(() => { setInput(selectedName) }, [selectedName])

  // Recents nur zum Stöbern (ohne aktive Suche)
  const { data: recentsData } = useQuery({
    queryKey: ['recents', 'project', null, 'recent'],
    queryFn:  () => fetchRecents('project', 6, { sortBy: 'recent' }),
    staleTime: 30_000,
  })

  const query = input.toLowerCase().trim()
  // „Aktiv tippen" = Eingabe weicht vom angezeigten Auswahlnamen ab.
  const isFiltering = query.length > 0 && query !== selectedName.toLowerCase()

  const filtered = useMemo(() => {
    if (!isFiltering) return projects
    return projects.filter(p =>
      p.NAME_SHORT.toLowerCase().includes(query) || (p.NAME_LONG?.toLowerCase().includes(query) ?? false),
    )
  }, [projects, query, isFiltering])

  const recentProjects = useMemo(() => {
    if (isFiltering) return []
    const ids = (recentsData?.data ?? []).map(r => r.ENTITY_ID)
    return ids
      .map(id => projects.find(p => p.ID === id))
      .filter((p): p is ProjectOption => p != null)
      .slice(0, 5)
  }, [recentsData, projects, isFiltering])

  // Außenklick: schließen + Anzeigename wiederherstellen
  useEffect(() => {
    if (!open) return
    function onDown(e: MouseEvent) {
      if (acRef.current && !acRef.current.contains(e.target as Node)) {
        setOpen(false)
        setInput(selectedName)
      }
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open, selectedName])

  function pick(id: number) {
    onSelect(id)
    const p = projects.find(x => x.ID === id)
    setInput(p ? displayName(p) : '')
    setOpen(false)
  }

  return (
    <div ref={acRef} className="project-picker">
      <input
        type="text" className="list-search" placeholder={placeholder}
        value={input}
        onChange={e => { setInput(e.target.value); setOpen(true) }}
        onFocus={e => { setOpen(true); e.currentTarget.select() }}
        onKeyDown={e => {
          if (e.key === 'Enter') {
            const first = (isFiltering ? filtered : [...recentProjects, ...filtered])[0]
            if (first) pick(first.ID)
            e.preventDefault()
          }
          if (e.key === 'Escape') { setOpen(false); setInput(selectedName) }
        }}
      />
      {open && (
        <div className="project-ac-dropdown">
          {recentProjects.length > 0 && (
            <>
              <div className="project-ac-section">Zuletzt verwendet</div>
              {recentProjects.map(p => (
                <button key={`r${p.ID}`} type="button"
                  className={`project-ac-option${p.ID === selectedId ? ' active' : ''}`}
                  onMouseDown={ev => { ev.preventDefault(); pick(p.ID) }}>
                  <span className="project-ac-short">{p.NAME_SHORT}</span>
                  {p.NAME_LONG && <span className="project-ac-long">{p.NAME_LONG}</span>}
                </button>
              ))}
              <div className="project-ac-section">Alle Projekte</div>
            </>
          )}
          {filtered.length === 0 && <div className="project-ac-empty">Keine Projekte gefunden</div>}
          {filtered.slice(0, 50).map(p => (
            <button key={p.ID} type="button"
              className={`project-ac-option${p.ID === selectedId ? ' active' : ''}`}
              onMouseDown={ev => { ev.preventDefault(); pick(p.ID) }}>
              <span className="project-ac-short">{p.NAME_SHORT}</span>
              {p.NAME_LONG && <span className="project-ac-long">{p.NAME_LONG}</span>}
            </button>
          ))}
          {onGoToList && (
            <button type="button" className="project-ac-tolist"
              onMouseDown={ev => { ev.preventDefault(); setOpen(false); onGoToList() }}>
              Zur Projektliste →
            </button>
          )}
        </div>
      )}
    </div>
  )
}
