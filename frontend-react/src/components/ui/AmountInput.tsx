import { useState, type InputHTMLAttributes } from 'react'
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
  const num = value === '' ? null : Number(value)
  const shown = draft ?? (num == null || !Number.isFinite(num) ? '' : FMT.format(num))

  return (
    <input
      {...rest}
      type="text"
      inputMode="decimal"
      className={className}
      value={shown}
      onFocus={e => {
        setDraft(num == null || !Number.isFinite(num) ? '' : String(num).replace('.', ','))
        onFocus?.(e)
        // Erst markieren, wenn React den Rohwert eingesetzt hat — sonst geht
        // die Markierung beim Neuzeichnen verloren und Getipptes wird angehaengt.
        const el = e.currentTarget
        setTimeout(() => { if (document.activeElement === el) el.select() }, 0)
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
