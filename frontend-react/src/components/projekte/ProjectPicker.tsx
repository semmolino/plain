import { useState, useEffect, useRef, useMemo, useId } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ArrowRight } from 'lucide-react'
import { fetchRecents } from '@/api/recents'

export interface ProjectOption { ID: number; ABBR: string; NAME: string }

interface Props {
  projects:    ProjectOption[]
  selectedId:  number | null
  onSelect:    (id: number) => void
  /** Optional: Button „Zur Projektliste →" im Dropdown (z.B. Tab-Wechsel auf Liste). */
  onGoToList?: () => void
  placeholder?: string
  /** Feld beim Einblenden fokussieren und die Liste oeffnen (Projekt wechseln im Kopf). */
  autoFocus?: boolean
  /** Liste schon beim Fokussieren oeffnen (Standard). In Dialogen aus: dort
   *  setzt der Dialog den Fokus selbst, und die offene Liste verdeckte sonst
   *  gleich beim Oeffnen das halbe Formular. Klick und Tippen oeffnen weiter. */
  openOnFocus?: boolean
  /** Feld leer beginnen statt mit dem gewaehlten Projekt (Umschalter im
   *  Projektkopf: man will suchen, nicht den aktuellen Namen loeschen). */
  startEmpty?: boolean
  /** Liste immer offen und im Fluss statt als Aufklapper (Handy-Blatt). */
  inline?: boolean
}

const displayName = (p: ProjectOption) => p.ABBR + (p.NAME ? ` – ${p.NAME}` : '')

/**
 * Einheitliche Projekt-Suchbox (Autocomplete) für alle Projekt-Tabs.
 * Beim Fokus: „Zuletzt verwendet" oben, darunter alle Projekte (scrollbar);
 * Tippen filtert. Optional ein Sprung „Zur Projektliste".
 */
export function ProjectPicker({ projects, selectedId, onSelect, onGoToList, placeholder = 'Projekt suchen …', autoFocus, openOnFocus = true, startEmpty = false, inline = false }: Props) {
  const [input, setInput] = useState('')
  const [openState, setOpen] = useState(false)
  const open = inline || openState
  // Tastatur: ↑/↓ waehlen vor, Enter uebernimmt (vorher nur „Enter = erster Treffer").
  const [activeIdx, setActiveIdx] = useState(-1)
  const acRef   = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const listId  = useId()

  const selectedName = useMemo(() => {
    const p = selectedId != null ? projects.find(x => x.ID === selectedId) : undefined
    return p ? displayName(p) : ''
  }, [selectedId, projects])

  // Angezeigten Wert mit der Auswahl synchron halten
  const shownName = startEmpty ? '' : selectedName
  useEffect(() => { setInput(shownName) }, [shownName])

  // Recents nur zum Stöbern (ohne aktive Suche)
  const { data: recentsData } = useQuery({
    queryKey: ['recents', 'project', null, 'recent'],
    queryFn:  () => fetchRecents('project', 6, { sortBy: 'recent' }),
    staleTime: 30_000,
  })

  const query = input.toLowerCase().trim()
  // „Aktiv tippen" = Eingabe weicht vom angezeigten Auswahlnamen ab.
  const isFiltering = query.length > 0 && query !== shownName.toLowerCase()

  const filtered = useMemo(() => {
    if (!isFiltering) return projects
    return projects.filter(p =>
      p.ABBR.toLowerCase().includes(query) || (p.NAME?.toLowerCase().includes(query) ?? false),
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
    if (!open || inline) return
    function onDown(e: MouseEvent) {
      if (acRef.current && !acRef.current.contains(e.target as Node)) {
        setOpen(false)
        setInput(shownName)
      }
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open, inline, shownName])

  // Reihenfolge wie angezeigt: erst „Zuletzt verwendet", dann alle.
  const options = useMemo(() => [
    ...recentProjects.map(p => ({ key: `r${p.ID}`, p })),
    ...filtered.slice(0, 50).map(p => ({ key: String(p.ID), p })),
  ], [recentProjects, filtered])
  const activeKey = activeIdx >= 0 && activeIdx < options.length ? options[activeIdx].key : null

  useEffect(() => {
    if (!activeKey || !listRef.current) return
    const el = listRef.current.querySelector<HTMLElement>(`[data-key="${activeKey}"]`)
    el?.scrollIntoView({ block: 'nearest' })
  }, [activeKey])

  function pick(id: number) {
    onSelect(id)
    const p = projects.find(x => x.ID === id)
    setInput(startEmpty ? '' : p ? displayName(p) : '')
    setOpen(false)
    setActiveIdx(-1)
  }

  const optionId = (key: string) => `${listId}-${key}`
  const option = (key: string, p: ProjectOption) => (
    <button key={key} type="button" role="option" tabIndex={-1}
      id={optionId(key)} data-key={key}
      aria-selected={key === activeKey}
      className={`project-ac-option${p.ID === selectedId ? ' active' : ''}${key === activeKey ? ' kbd-active' : ''}`}
      onMouseDown={ev => { ev.preventDefault(); pick(p.ID) }}>
      <span className="project-ac-short">{p.ABBR}{p.ID === selectedId && <span className="project-ac-current"> · aktuell</span>}</span>
      {p.NAME && <span className="project-ac-long">{p.NAME}</span>}
    </button>
  )

  return (
    <div ref={acRef} className={`project-picker${inline ? ' project-picker--inline' : ''}`}>
      <input
        type="text" className="list-search" placeholder={placeholder}
        autoFocus={autoFocus}
        aria-label={placeholder}
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={activeKey ? optionId(activeKey) : undefined}
        value={input}
        onChange={e => { setInput(e.target.value); setOpen(true); setActiveIdx(-1) }}
        onFocus={e => { if (openOnFocus) setOpen(true); e.currentTarget.select() }}
        onClick={() => setOpen(true)}
        onKeyDown={e => {
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault()
            setOpen(true)
            if (!options.length) return
            const d = e.key === 'ArrowDown' ? 1 : -1
            setActiveIdx(i => (i < 0 ? (d > 0 ? 0 : options.length - 1) : (i + d + options.length) % options.length))
            return
          }
          if (e.key === 'Enter') {
            const hit = activeKey ? options[activeIdx]?.p : options[0]?.p
            if (hit) pick(hit.ID)
            e.preventDefault()
          }
          if (e.key === 'Escape') { setOpen(false); setInput(shownName); setActiveIdx(-1) }
        }}
      />
      {open && (
        <div className={`project-ac-dropdown${inline ? ' project-ac-dropdown--inline' : ''}`} role="listbox" id={listId} ref={listRef} aria-label="Projekte">
          {recentProjects.length > 0 && (
            <>
              <div className="project-ac-section" role="presentation">Zuletzt verwendet</div>
              {recentProjects.map(p => option(`r${p.ID}`, p))}
              <div className="project-ac-section" role="presentation">Alle Projekte</div>
            </>
          )}
          {filtered.length === 0 && <div className="project-ac-empty">Keine Projekte gefunden</div>}
          {filtered.slice(0, 50).map(p => option(String(p.ID), p))}
          {onGoToList && (
            <button type="button" className="project-ac-tolist" tabIndex={-1}
              onMouseDown={ev => { ev.preventDefault(); setOpen(false); onGoToList() }}>
              Zur Projektliste <ArrowRight size={13} strokeWidth={2} aria-hidden="true" />
            </button>
          )}
        </div>
      )}
    </div>
  )
}
