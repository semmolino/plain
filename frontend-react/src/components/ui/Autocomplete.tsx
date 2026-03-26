import { useState, useRef, useCallback } from 'react'

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

export function Autocomplete({
  label, htmlId, value, onChange, onSelect, search, placeholder, required,
}: Props) {
  const [options, setOptions] = useState<AutocompleteOption[]>([])
  const [open,    setOpen]    = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const handleChange = useCallback((text: string) => {
    onChange(text)
    if (timer.current) clearTimeout(timer.current)
    if (text.length < 2) { setOpen(false); return }
    timer.current = setTimeout(async () => {
      try {
        const results = await search(text)
        setOptions(results)
        setOpen(results.length > 0)
      } catch {
        setOpen(false)
      }
    }, 250)
  }, [onChange, search])

  function pick(opt: AutocompleteOption) {
    onSelect(opt.id, opt.label)
    setOpen(false)
  }

  return (
    <div className="form-group autocomplete-wrap">
      <label htmlFor={htmlId}>{label}</label>
      <input
        id={htmlId}
        type="text"
        value={value}
        required={required}
        placeholder={placeholder}
        onChange={e => handleChange(e.target.value)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        autoComplete="off"
      />
      {open && (
        <div className="autocomplete-list">
          {options.map(opt => (
            <div
              key={opt.id}
              className="autocomplete-item"
              onMouseDown={e => { e.preventDefault(); pick(opt) }}
            >
              {opt.label}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
