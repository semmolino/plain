import { useId, type ReactNode } from 'react'
import { HelpHint } from './HelpHint'
import type { HelpId } from '@/help/helpContent'

/**
 * Abschnitt eines Seitenformulars im Arbeitsbereich (Runde 6: Verträge).
 *
 * Vorher stand jedes Formular als eine lange Spalte da, und wo es Gruppen
 * gab, baute jede Seite sie selbst: hier ein Kasten mit `--dim`, dort einer
 * mit Rahmen und 8px Radius, beide mit fester Breite von 600px. Die
 * Überschrift war ein fett gesetzter Absatz — für Screenreader keine
 * Überschrift, also auch nicht anspringbar.
 *
 * Ab 900px stehen die Felder in zwei Spalten; `.form-section-wide` lässt ein
 * Feld über beide laufen. `layout="block"` für Tabellen (Preislisten, Budget),
 * `actions` steht rechts neben der Überschrift.
 */
export function FormSection({ title, help, hint, actions, layout = 'grid', children, className }: {
  title:      ReactNode
  help?:      HelpId
  hint?:      ReactNode
  actions?:   ReactNode
  layout?:    'grid' | 'block'
  children:   ReactNode
  className?: string
}) {
  const headId = useId()
  return (
    <section className={`form-section${className ? ` ${className}` : ''}`} aria-labelledby={headId}>
      <div className="form-section-head">
        <h3 id={headId} className="form-section-title">{title}</h3>
        {help && <HelpHint id={help} size={13} />}
        {actions && <div className="form-section-actions">{actions}</div>}
      </div>
      {hint && <p className="form-section-hint">{hint}</p>}
      <div className={layout === 'grid' ? 'form-section-body' : 'form-section-block'}>{children}</div>
    </section>
  )
}
