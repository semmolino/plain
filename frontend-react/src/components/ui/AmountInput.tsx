import { useLayoutEffect, useRef, useState, type InputHTMLAttributes } from 'react'
import { parseAmount } from '@/utils/amount'

const FMT = new Intl.NumberFormat('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })


interface Props extends Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type'> {
  /** Betrag in Maschinenform ('1234.56'), wie ihn die Formulare fuehren. */
  value:    string
  onChange: (value: string) => void
}

/**
 * Betragsfeld mit deutscher Schreibweise (UI-Pilot 2026-09).
 *
 * `type="number"` zeigte Honorare als „4012521.56" — ohne Tausenderpunkte,
 * mit Dezimalpunkt, und das Mausrad aenderte den Wert beim Scrollen durch
 * die Tabelle. Hier steht ausserhalb des Fokus „4.012.521,56"; beim Tippen
 * die rohe Zahl mit Komma. Nach aussen bleibt der Wert in Maschinenform,
 * die aufrufenden Formulare aendern sich nicht.
 */
export function AmountInput({ value, onChange, onFocus, onBlur, className, ...rest }: Props) {
  const [draft, setDraft] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const selectAfterRender = useRef(false)
  const num = value === '' ? null : Number(value)

  // Erst markieren, wenn React den Rohwert eingesetzt hat — sonst geht die
  // Markierung beim Neuzeichnen verloren und Getipptes wird angehaengt.
  // Im Layout-Effekt statt per setTimeout: der lief erst nach der naechsten
  // Eingabe, wenn sie schnell genug kam („15000" wurde zu 14.525,715).
  useLayoutEffect(() => {
    if (!selectAfterRender.current) return
    selectAfterRender.current = false
    if (document.activeElement === inputRef.current) inputRef.current?.select()
  })
  const shown = draft ?? (num == null || !Number.isFinite(num) ? '' : FMT.format(num))

  return (
    <input
      {...rest}
      ref={inputRef}
      type="text"
      inputMode="decimal"
      className={className}
      value={shown}
      onFocus={e => {
        setDraft(num == null || !Number.isFinite(num) ? '' : String(num).replace('.', ','))
        selectAfterRender.current = true
        onFocus?.(e)
      }}
      onChange={e => {
        setDraft(e.target.value)
        const n = parseAmount(e.target.value)
        onChange(n == null ? '' : String(n))
      }}
      onBlur={e => { setDraft(null); onBlur?.(e) }}
    />
  )
}
