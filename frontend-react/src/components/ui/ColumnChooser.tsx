import { useEffect, useId, useRef, useState } from 'react'
import { SlidersHorizontal } from 'lucide-react'

export interface ChooserColumn<K extends string> { key: K; label: string }

/**
 * „Spalten"-Knopf mit Auswahl der optionalen Spalten (UI-Pilot Runde 3,
 * zuerst fuer Projekt- und Angebotsstruktur). Aussehen wie die Spaltenwahl
 * der Listen (.pl-col-*); dazu Escape, Klick daneben und aria-expanded.
 * Welche Spalten gerade aus sind, haelt der Aufrufer — meist per
 * useStickyState, damit die Wahl je Mitarbeiter erhalten bleibt.
 */
export function ColumnChooser<K extends string>({ columns, hidden, onToggle, note }: {
  columns:  ChooserColumn<K>[]
  hidden:   Set<K>
  onToggle: (key: K) => void
  note?:    string
}) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)
  const btnRef  = useRef<HTMLButtonElement>(null)
  const panelId = useId()

  useEffect(() => {
    if (!open) return
    function onDown(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false)
    }
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      setOpen(false)
      btnRef.current?.focus()
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey) }
  }, [open])

  return (
    <div ref={wrapRef} className="pl-col-wrap">
      <button ref={btnRef} type="button" className="pl-col-btn col-chooser-btn" aria-expanded={open} aria-controls={panelId}
        onClick={() => setOpen(o => !o)}>
        <SlidersHorizontal size={13} strokeWidth={2} aria-hidden="true" /> Spalten
      </button>
      {open && (
        <div className="pl-col-panel" id={panelId} role="group" aria-label="Spalten ein- und ausblenden">
          <div className="pl-col-panel-title">Spalten</div>
          {columns.map(c => (
            <label key={c.key} className="pl-col-option">
              <input type="checkbox" checked={!hidden.has(c.key)} onChange={() => onToggle(c.key)} />
              {c.label}
            </label>
          ))}
          {note && <p className="pl-col-panel-note">{note}</p>}
        </div>
      )}
    </div>
  )
}
