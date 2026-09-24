import { Fragment } from 'react'
import { ChevronDown } from 'lucide-react'
import { useIsNarrow } from '@/hooks/useIsNarrow'
import type { ProjektTab } from './projektUrlState'

export interface ProjektTabDef { id: ProjektTab; label: string; group: 'arbeit' | 'einrichtung' }

/**
 * Reiter des Projekt-Arbeitsbereichs (UI-Pilot 2026-09).
 *
 * Neun gleichrangige Reiter — darunter „Liste", also der Weg HINAUS aus dem
 * Projekt — standen vorher in einer Reihe. Jetzt:
 *  - die Liste ist keine Reiterin mehr, sondern die Seite, von der man kommt
 *    (Rueckweg im Kopf);
 *  - zwei Gruppen: was man taeglich tut (Struktur, Leistungsstaende,
 *    Buchungen, Nachtraege) und was man einrichtet (Vertraege, Kalkulationen,
 *    Preislisten, Budgets), mit einer Trennlinie dazwischen;
 *  - auf dem Handy die ersten drei als Reiter, der Rest hinter „Mehr".
 *    Liegt der aktive Reiter dort, traegt „Mehr" dessen Namen — sonst
 *    wuesste man nicht, wo man ist.
 */
export function ProjektTabs({ tabs, active, onChange }: {
  tabs:     ProjektTabDef[]
  active:   ProjektTab
  onChange: (id: ProjektTab) => void
}) {
  const narrow = useIsNarrow()

  if (narrow) {
    const primary  = tabs.slice(0, 3)
    const overflow = tabs.slice(3)
    const activeInOverflow = overflow.find(t => t.id === active)
    return (
      <div className="tabs-wrap pw-tabs">
        <div className="tabs" role="tablist">
          {primary.map(t => (
            <button key={t.id} type="button" role="tab" aria-selected={active === t.id}
              className={'tab-btn' + (active === t.id ? ' active' : '')} onClick={() => onChange(t.id)}>
              {t.label}
            </button>
          ))}
          {overflow.length > 0 && (
            <label className={'tab-btn pw-tab-more' + (activeInOverflow ? ' active' : '')}>
              <span>{activeInOverflow?.label ?? 'Mehr'}</span>
              <ChevronDown size={14} strokeWidth={2} aria-hidden="true" />
              <select aria-label="Weitere Bereiche des Projekts" value={activeInOverflow?.id ?? ''}
                onChange={e => { if (e.target.value) onChange(e.target.value as ProjektTab) }}>
                <option value="" disabled>Weitere Bereiche …</option>
                {overflow.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
              </select>
            </label>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="tabs-wrap pw-tabs">
      <div className="tabs" role="tablist">
        {tabs.map((t, i) => (
          <Fragment key={t.id}>
            {i > 0 && t.group !== tabs[i - 1].group && <span className="pw-tab-divider" aria-hidden="true" />}
            <button type="button" role="tab" aria-selected={active === t.id}
              className={'tab-btn' + (active === t.id ? ' active' : '')} onClick={() => onChange(t.id)}>
              {t.label}
            </button>
          </Fragment>
        ))}
      </div>
    </div>
  )
}
