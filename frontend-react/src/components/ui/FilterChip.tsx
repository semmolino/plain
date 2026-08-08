import { useEffect, useRef, useState } from 'react'
import { ChevronDown, X } from 'lucide-react'

/** Beschriftung und gefilterter Wert duerfen auseinanderfallen (z. B. Projekt-ID / Projektname). */
export interface FilterChipOption { value: string; label: string }

interface Props {
  label: string
  /** Werte kommen aus den geladenen Daten, nicht aus festen Listen. */
  options: string[] | FilterChipOption[]
  active: Set<string>
  onChange: (v: Set<string>) => void
}

/**
 * Mehrfach-Auswahlfilter als Chip.
 *
 * Bisher lag diese Komponente **zehnmal** lokal in den Seiten — CLAUDE.md
 * hat das sogar so vorgeschrieben. Folge: zehnmal eigenes Tastaturverhalten
 * und zehn Stellen fuer jede Korrektur. Neue Verwendungen kommen ab jetzt
 * von hier; die bestehenden Kopien wandern nach und nach nach.
 *
 * Gegenueber den Kopien ergaenzt: Escape schliesst und gibt den Fokus
 * zurueck, `aria-expanded`, und das Aufklapp-Zeichen ist ein lucide-Icon
 * statt des Unicode-Dreiecks „▾".
 */
export function FilterChip({ label, options, active, onChange }: Props) {
  const [open, setOpen] = useState(false)
  const wrapRef    = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return
    function onPointerDown(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false)
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      setOpen(false)
      triggerRef.current?.focus()
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown, true)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown, true)
    }
  }, [open])

  function toggle(value: string) {
    const next = new Set(active)
    next.has(value) ? next.delete(value) : next.add(value)
    onChange(next)
  }

  const count = active.size
  const entries: FilterChipOption[] = options.map(o =>
    typeof o === 'string' ? { value: o, label: o || '(ohne)' } : o)

  return (
    <div ref={wrapRef} className="filter-chip-wrap">
      <button
        ref={triggerRef}
        type="button"
        className={`filter-chip-btn${count > 0 ? ' active' : ''}`}
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
      >
        {label}{count > 0 ? ` (${count})` : ''}
        <ChevronDown size={13} strokeWidth={2} />
      </button>

      {count > 0 && (
        <button
          type="button"
          className="filter-chip-clear"
          onClick={() => { onChange(new Set()); setOpen(false) }}
          aria-label={`Filter ${label} zurücksetzen`}
        >
          <X size={12} strokeWidth={2.5} />
        </button>
      )}

      {open && (
        <div className="filter-chip-dropdown">
          {entries.length === 0
            ? <div className="filter-chip-empty">Keine Optionen</div>
            : entries.map(opt => (
              <label key={opt.value} className="filter-chip-option">
                <input type="checkbox" checked={active.has(opt.value)} onChange={() => toggle(opt.value)} />
                {opt.label}
              </label>
            ))}
        </div>
      )}
    </div>
  )
}
