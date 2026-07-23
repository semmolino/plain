import { useState } from 'react'

// ── Inline-Edit-Bausteine für Listen ─────────────────────────────────────────
// Kompakte Editoren, um einzelne Stammdaten-Felder direkt in einer Listenzeile
// zu ändern — analog zur Mahnstufe in der Mahnungsliste. Jede Änderung wird
// sofort gespeichert (onChange / onSave). Alle Bausteine stoppen die
// Event-Propagation, damit sie auch in klickbaren Zeilen (clickable-row)
// funktionieren, ohne die Zeilen-Aktion (Modal öffnen / Navigation) auszulösen.

export interface InlineOption {
  value: string
  label: string
}

function fmtDateDe(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split('-')
  if (!y || !m || !d) return iso
  return `${d}.${m}.${y}`
}

// ── InlineSelect ──────────────────────────────────────────────────────────────
// Dropdown für Referenz-/Auswahlspalten (Status, Typ, Abteilung, Anrede …).
// `tone` gibt dem Feld eine farbige Badge-Optik (z. B. grün/rot für Aktiv/Inaktiv).

export function InlineSelect({
  value, options, onChange,
  readOnly = false, allowEmpty = true, placeholder = '—',
  tone, title = 'Direkt bearbeiten', ariaLabel, fallbackLabel,
}: {
  value:         string | number | null | undefined
  options:       InlineOption[]
  onChange:      (value: string) => void
  readOnly?:     boolean
  allowEmpty?:   boolean
  placeholder?:  string
  tone?:         { bg: string; color: string }
  title?:        string
  ariaLabel?:    string
  // Anzeige-Label, falls der aktuelle Wert (noch) nicht in `options` steht — z. B.
  // wenn die Options aus einer separaten Query stammen, die noch lädt/fehlschlägt.
  // Verhindert, dass statt des Namens die rohe ID angezeigt wird.
  fallbackLabel?: string
}) {
  const current  = value == null ? '' : String(value)
  const selected = options.find(o => o.value === current)

  if (readOnly) {
    return (
      <span className={`inline-edit-static${current === '' ? ' is-empty' : ''}`}>
        {selected?.label ?? (current === '' ? placeholder : (fallbackLabel ?? current))}
      </span>
    )
  }

  const toneStyle = tone
    ? { background: tone.bg, color: tone.color, border: '1px solid transparent', borderRadius: 10, fontWeight: 600, padding: '2px 8px' }
    : undefined

  return (
    <select
      className={`inline-edit-select${tone ? ' has-tone' : ''}${current === '' ? ' is-empty' : ''}`}
      style={toneStyle}
      value={current}
      title={title}
      aria-label={ariaLabel}
      onClick={e => e.stopPropagation()}
      onChange={e => { e.stopPropagation(); onChange(e.target.value) }}
    >
      {(allowEmpty || current === '') && <option value="">{placeholder}</option>}
      {/* Fallback, falls der aktuelle Wert nicht in der Optionsliste steht (z. B. Options-Query lädt noch) */}
      {current !== '' && !selected && <option value={current}>{fallbackLabel ?? current}</option>}
      {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  )
}

// ── InlineDate ────────────────────────────────────────────────────────────────
// Klick-zum-Bearbeiten Datumsfeld. Speichert bei Blur / Enter.

export function InlineDate({
  value, onSave, readOnly = false, placeholder = '— setzen',
}: {
  value:        string | null | undefined
  onSave:       (value: string) => void
  readOnly?:    boolean
  placeholder?: string
}) {
  const [editing, setEditing] = useState(false)
  const iso = value ? String(value).slice(0, 10) : ''

  if (readOnly || !editing) {
    return (
      <span
        className="cte-date"
        title={readOnly ? undefined : 'Klicken zum Bearbeiten'}
        onClick={readOnly ? undefined : e => { e.stopPropagation(); setEditing(true) }}
      >
        {iso ? fmtDateDe(iso) : <span className="cte-date-empty">{placeholder}</span>}
      </span>
    )
  }

  return (
    <input
      type="date"
      className="inline-date-input"
      defaultValue={iso}
      autoFocus
      onClick={e => e.stopPropagation()}
      onBlur={e => { onSave(e.target.value); setEditing(false) }}
      onKeyDown={e => {
        if (e.key === 'Escape') setEditing(false)
        if (e.key === 'Enter')  { onSave((e.target as HTMLInputElement).value); setEditing(false) }
      }}
    />
  )
}

// ── InlineNumber ──────────────────────────────────────────────────────────────
// Klick-zum-Bearbeiten Zahlenfeld (z. B. Wahrscheinlichkeit in %). Leerer Wert
// speichert null. Speichert bei Blur / Enter.

export function InlineNumber({
  value, onSave, readOnly = false, suffix = '', min, max, step,
  placeholder = '— setzen',
}: {
  value:        number | null | undefined
  onSave:       (value: number | null) => void
  readOnly?:    boolean
  suffix?:      string
  min?:         number
  max?:         number
  step?:        number
  placeholder?: string
}) {
  const [editing, setEditing] = useState(false)

  function commit(raw: string) {
    const t = raw.trim()
    if (t === '') { onSave(null); return }
    const n = Number(t)
    if (Number.isFinite(n)) onSave(n)
  }

  if (readOnly || !editing) {
    return (
      <span
        className="cte-date"
        title={readOnly ? undefined : 'Klicken zum Bearbeiten'}
        onClick={readOnly ? undefined : e => { e.stopPropagation(); setEditing(true) }}
      >
        {value != null ? `${value}${suffix}` : <span className="cte-date-empty">{placeholder}</span>}
      </span>
    )
  }

  return (
    <input
      type="number"
      className="inline-num-input"
      defaultValue={value ?? ''}
      autoFocus
      min={min} max={max} step={step}
      onClick={e => e.stopPropagation()}
      onBlur={e => { commit(e.target.value); setEditing(false) }}
      onKeyDown={e => {
        if (e.key === 'Escape') setEditing(false)
        if (e.key === 'Enter')  { commit((e.target as HTMLInputElement).value); setEditing(false) }
      }}
    />
  )
}
