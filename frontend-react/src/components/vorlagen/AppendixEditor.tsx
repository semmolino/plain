import { useState } from 'react'
import { ChevronDown, ChevronUp, GripVertical } from 'lucide-react'
import type { ThemeBlocks } from '@/api/documentTemplates'
import { appendixOrder } from './layoutModel'

/**
 * Anhänge (eigene Seiten nach dem Beleg): an/aus und Reihenfolge. Ein Anhang
 * erscheint nur, wenn er an ist **und** Daten vorliegen.
 */
export function AppendixEditor({ appendices, value, onChange }: {
  appendices: { key: string; label: string }[]
  value:      ThemeBlocks | undefined
  onChange:   (next: ThemeBlocks) => void
}) {
  const [drag, setDrag] = useState<number | null>(null)
  const label = Object.fromEntries(appendices.map(a => [a.key, a.label]))
  const keys = appendixOrder(appendices.map(a => a.key), value)
  const base: ThemeBlocks = value ?? {}

  function move(from: number, to: number) {
    if (to < 0 || to >= keys.length || from === to) return
    const next = [...keys]
    const [k] = next.splice(from, 1)
    next.splice(to, 0, k)
    // Andere Anhänge (anderer Kategorien) in der gespeicherten Reihenfolge behalten
    const rest = (Array.isArray(base.order) ? base.order : []).filter(k2 => !next.includes(k2))
    onChange({ ...base, order: [...next, ...rest] })
  }

  if (!keys.length) return <p className="dv-empty">Diese Belegart hat keine Anhänge.</p>

  return (
    <ul className="dv-list" aria-label="Anhänge">
      {keys.map((k, i) => (
        <li
          key={k}
          className={`dv-row${drag === i ? ' dv-row--drag' : ''}`}
          draggable
          onDragStart={e => { setDrag(i); e.dataTransfer.effectAllowed = 'move' }}
          onDragOver={e => { if (drag !== null) e.preventDefault() }}
          onDrop={e => { e.preventDefault(); if (drag !== null) move(drag, i); setDrag(null) }}
          onDragEnd={() => setDrag(null)}
        >
          <div className="dv-row-main">
            <span className="dv-grip" aria-hidden="true"><GripVertical size={14} strokeWidth={1.75} /></span>
            <label className="dv-row-label">
              <input type="checkbox" checked={base[k] !== false} onChange={e => onChange({ ...base, [k]: e.target.checked })} />
              {label[k]}
            </label>
            <span className="dv-row-actions">
              <button type="button" className="row-action-btn" disabled={i === 0} onClick={() => move(i, i - 1)} aria-label={`${label[k]} nach oben`}>
                <ChevronUp size={14} strokeWidth={2} />
              </button>
              <button type="button" className="row-action-btn" disabled={i === keys.length - 1} onClick={() => move(i, i + 1)} aria-label={`${label[k]} nach unten`}>
                <ChevronDown size={14} strokeWidth={2} />
              </button>
            </span>
          </div>
        </li>
      ))}
    </ul>
  )
}
