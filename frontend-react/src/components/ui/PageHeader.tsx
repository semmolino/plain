import type { ReactNode } from 'react'
import { ArrowLeft } from 'lucide-react'

interface Props {
  /** Seitentitel — wird als <h1> gerendert. */
  title:       ReactNode
  /** Rueckweg, z. B. „Projekte" aus dem Projekt-Arbeitsbereich. */
  back?:       { label: string; onClick: () => void }
  /** Kleine Zeile ueber dem Titel (Nummer, Status). */
  eyebrow?:    ReactNode
  /** Direkt neben dem Titel (z. B. „Projekt wechseln"). */
  titleAddon?: ReactNode
  /** Zeile unter dem Titel (Auftraggeber, Datum, …). */
  meta?:       ReactNode
  /** Aktionen rechts. Reihenfolge: sekundaer zuerst, Hauptaktion zuletzt. */
  actions?:    ReactNode
  /** Unter dem Kopf, z. B. eine Kennzahlen-Leiste. */
  children?:   ReactNode
  className?:  string
}

/**
 * Einheitlicher Seitenkopf (UI-Pilot 2026-09).
 *
 * Vorher baute jede Seite ihren Titel selbst — `.master-title`,
 * `.master-page-title`, ein `<div class="dash-title">`, ein inline gestyltes
 * `<h1>` — und darunter stapelten sich Kontextleiste, Sprungleiste und
 * Werkzeugleiste. Wer in einem Projekt arbeitete, sah nirgends, in welchem,
 * und bis zu den Daten lagen vier Leisten.
 *
 * Der Kopf traegt deshalb drei Dinge an fester Stelle: wo bin ich (Titel,
 * Kennung), wie komme ich zurueck (back) und was ist hier die Hauptaktion
 * (actions, rechts, die wichtigste zuletzt). Auf dem Handy rutschen die
 * Aktionen unter den Titel statt ihn zu stauchen.
 */
export function PageHeader({ title, back, eyebrow, titleAddon, meta, actions, children, className }: Props) {
  return (
    <header className={`page-header${className ? ` ${className}` : ''}`}>
      {back && (
        <button type="button" className="page-header-back" onClick={back.onClick}>
          <ArrowLeft size={14} strokeWidth={2} aria-hidden="true" />
          {back.label}
        </button>
      )}
      <div className="page-header-main">
        <div className="page-header-titles">
          {eyebrow && <div className="page-header-eyebrow">{eyebrow}</div>}
          <div className="page-header-titlerow">
            <h1 className="page-header-title">{title}</h1>
            {titleAddon}
          </div>
          {meta && <div className="page-header-meta">{meta}</div>}
        </div>
        {actions && <div className="page-header-actions">{actions}</div>}
      </div>
      {children && <div className="page-header-extra">{children}</div>}
    </header>
  )
}
