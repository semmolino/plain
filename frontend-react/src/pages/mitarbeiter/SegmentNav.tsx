import type { CSSProperties } from 'react'

// ── SegmentNav ────────────────────────────────────────────────────────────────
// Einheitlicher Umschalter (Segment-Control) fuer Unter-Navigation/Sektionen.

export function SegmentNav<T extends string>({ items, active, onChange, style }: {
  items:    { id: T; label: string }[]
  active:   T
  onChange: (id: T) => void
  style?:   CSSProperties
}) {
  return (
    <div className="seg-nav" style={style}>
      {items.map(it => (
        <button
          key={it.id}
          type="button"
          className={`seg-nav-btn${active === it.id ? ' active' : ''}`}
          onClick={() => onChange(it.id)}
        >
          {it.label}
        </button>
      ))}
    </div>
  )
}
