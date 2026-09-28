import { useState, useRef, useCallback, useEffect, useId } from 'react'

export interface AutocompleteOption {
  id:    string | number
  label: string
}

interface Props {
  label:       string
  htmlId:      string
  value:       string
  onChange:    (text: string) => void
  onSelect:    (id: string | number, label: string) => void
  search:      (q: string) => Promise<AutocompleteOption[]>
  placeholder?: string
  required?:   boolean
}

/**
 * Suchfeld mit Trefferliste (Adressen in Vertrag, Projekt, Angebot, Rechnung).
 *
 * Runde 7: vorher ging die Liste nur mit der Maus — ↑/↓ taten nichts, Enter
 * schickte im Zweifel das Formular ab, und Screenreader hörten von den
 * Treffern nichts. Jetzt im Combobox-Muster wie der Projektwechsel (ARIA
 * 1.2: role=combobox am Feld, aria-activedescendant zeigt den Treffer, der
 * Fokus bleibt im Feld). Escape schliesst nur die Liste, auch im Dialog
 * (useDialog lässt einer offenen Combobox den Vortritt).
 *
 * „Keine Treffer" steht da, statt dass die Liste still ausbleibt — sonst
 * sah ein Tippfehler aus wie eine langsame Suche. Antworten auf ältere
 * Eingaben werden verworfen: wer schnell tippt, bekam sonst die Treffer zu
 * „Sta" über denen zu „Stadt".
 */
export function Autocomplete({
  label, htmlId, value, onChange, onSelect, search, placeholder, required,
}: Props) {
  const [options, setOptions] = useState<AutocompleteOption[]>([])
  const [open,    setOpen]    = useState(false)
  const [empty,   setEmpty]   = useState<string | null>(null)
  const [active,  setActive]  = useState(-1)
  const timer  = useRef<ReturnType<typeof setTimeout> | null>(null)
  const reqId  = useRef(0)
  const listRef = useRef<HTMLDivElement>(null)
  const listId = `${useId()}-list`
  const optionId = (i: number) => `${listId}-${i}`

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])

  const close = useCallback(() => { setOpen(false); setEmpty(null); setActive(-1) }, [])

  const handleChange = useCallback((text: string) => {
    onChange(text)
    if (timer.current) clearTimeout(timer.current)
    const q = text.trim()
    if (q.length < 2) { reqId.current++; close(); return }
    timer.current = setTimeout(async () => {
      const mine = ++reqId.current
      try {
        const results = await search(q)
        if (mine !== reqId.current) return
        setOptions(results)
        setActive(-1)
        setOpen(results.length > 0)
        setEmpty(results.length === 0 ? q : null)
      } catch {
        if (mine === reqId.current) close()
      }
    }, 250)
  }, [onChange, search, close])

  function pick(opt: AutocompleteOption) {
    reqId.current++
    onSelect(opt.id, opt.label)
    close()
  }

  // Aktiven Treffer im Blick halten, wenn die Liste scrollt
  useEffect(() => {
    if (active >= 0) listRef.current?.children[active]?.scrollIntoView({ block: 'nearest' })
  }, [active])

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (!options.length) return
      e.preventDefault()
      if (!open) { setOpen(true); setActive(e.key === 'ArrowDown' ? 0 : options.length - 1); return }
      const d = e.key === 'ArrowDown' ? 1 : -1
      setActive(i => (i + d + options.length) % options.length)
    } else if (e.key === 'Enter') {
      if (open && active >= 0 && options[active]) { e.preventDefault(); pick(options[active]) }
    } else if (e.key === 'Escape') {
      if (open || empty) { e.preventDefault(); close() }
    } else if (e.key === 'Tab') {
      close()
    }
  }

  return (
    <div className="form-group autocomplete-wrap">
      <label htmlFor={htmlId}>{label}</label>
      <input
        id={htmlId}
        type="text"
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls={listId}
        aria-activedescendant={open && active >= 0 ? optionId(active) : undefined}
        value={value}
        required={required}
        placeholder={placeholder}
        onChange={e => handleChange(e.target.value)}
        onKeyDown={onKeyDown}
        onBlur={() => setTimeout(close, 150)}
        autoComplete="off"
      />
      <div className="autocomplete-list" role="listbox" id={listId} ref={listRef} aria-label="Treffer" hidden={!open}>
        {open && options.map((opt, i) => (
          <div
            key={opt.id}
            id={optionId(i)}
            role="option"
            aria-selected={i === active}
            className={`autocomplete-item${i === active ? ' autocomplete-item--active' : ''}`}
            onMouseDown={e => { e.preventDefault(); pick(opt) }}
            onMouseEnter={() => setActive(i)}
          >
            {opt.label}
          </div>
        ))}
      </div>
      {empty && (
        <div className="autocomplete-list autocomplete-empty" role="status">Keine Treffer für „{empty}"</div>
      )}
    </div>
  )
}
