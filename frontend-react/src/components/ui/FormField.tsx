import { useId, type InputHTMLAttributes, type ReactNode } from 'react'

interface FormFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'id'> {
  label: string
  /** Optional — ohne Angabe wird eine eindeutige id erzeugt. */
  id?: string
  /** Erklaerung unter dem Feld; wird ueber aria-describedby verknuepft. */
  hint?: ReactNode
  /** Fehlermeldung; setzt zusaetzlich aria-invalid. */
  error?: ReactNode
}

/**
 * Beschriftetes Eingabefeld mit korrekter Verknuepfung.
 *
 * Die `id` ist jetzt optional: ohne Angabe erzeugt `useId()` eine, die auch
 * dann eindeutig bleibt, wenn dieselbe Maske mehrfach im Baum haengt. Vorher
 * war `id` Pflicht — was dazu gefuehrt hat, dass die Komponente in weiten
 * Teilen der App gar nicht erst benutzt wurde und Beschriftungen dort ohne
 * Bezug zum Feld stehen (235 Stellen, siehe docs/UX_UI_AUDIT_2026-08.md).
 * Screenreader lesen dort nur „Eingabefeld" vor, und ein Klick auf die
 * Beschriftung setzt den Fokus nicht ins Feld.
 */
export function FormField({ label, id, hint, error, ...inputProps }: FormFieldProps) {
  const generated = useId()
  const fieldId   = id ?? generated
  const hintId    = hint  ? `${fieldId}-hint`  : undefined
  const errorId   = error ? `${fieldId}-error` : undefined
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined

  return (
    <div className="form-group">
      <label htmlFor={fieldId}>{label}</label>
      <input
        id={fieldId}
        aria-describedby={describedBy}
        aria-invalid={error ? true : undefined}
        {...inputProps}
      />
      {hint  && <p id={hintId}  className="form-field-hint">{hint}</p>}
      {error && <p id={errorId} className="form-field-error" role="alert">{error}</p>}
    </div>
  )
}

interface FormSelectProps {
  label: string
  id?: string
  hint?: ReactNode
  children: ReactNode
  value?: string | number
  onChange?: (e: React.ChangeEvent<HTMLSelectElement>) => void
  disabled?: boolean
  required?: boolean
  className?: string
}

/** Gegenstueck fuer Auswahlfelder — dieselbe Verknuepfungslogik. */
export function FormSelect({ label, id, hint, children, className, ...rest }: FormSelectProps) {
  const generated = useId()
  const fieldId   = id ?? generated
  const hintId    = hint ? `${fieldId}-hint` : undefined

  return (
    <div className="form-group">
      <label htmlFor={fieldId}>{label}</label>
      <select id={fieldId} aria-describedby={hintId} className={className} {...rest}>
        {children}
      </select>
      {hint && <p id={hintId} className="form-field-hint">{hint}</p>}
    </div>
  )
}
