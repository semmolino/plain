import { useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { AlertOctagon, AlertTriangle, Info, ChevronRight, CheckCircle2 } from 'lucide-react'
import { HelpHint } from '@/components/ui/HelpHint'

export type AttentionLevel = 'critical' | 'watch' | 'info'

export interface AttentionItem {
  id:      string
  level:   AttentionLevel
  text:    ReactNode
  /** Betrag oder Zahl rechts, schon formatiert. */
  amount?: string
  /** Ziel als Link … */
  to?:     string
  state?:  unknown
  /** … oder als Aktion (z. B. „Zeit buchen" oeffnen). */
  onClick?: () => void
}

const LEVEL: Record<AttentionLevel, { icon: typeof Info; label: string }> = {
  critical: { icon: AlertOctagon,  label: 'Dringend' },
  watch:    { icon: AlertTriangle, label: 'Beobachten' },
  info:     { icon: Info,          label: 'Hinweis' },
}

const ORDER: Record<AttentionLevel, number> = { critical: 0, watch: 1, info: 2 }

/**
 * „Jetzt wichtig" (UI-Pilot 2026-09).
 *
 * Vorher standen die Hinweise als farbige Pillen unter Filterleiste und
 * Unterreitern — erst nach Einfuehrung, Checkliste und acht „Zuletzt"-Karten,
 * auf dem Handy rund zwei Bildschirmhoehen tief. Und sie unterschieden sich
 * nur in der Farbe.
 *
 * Jetzt: eine kurze Liste ganz oben, dringend zuerst, jede Zeile ein Ziel.
 * Die Stufe steckt in Form des Symbols und im (vorgelesenen) Klartext, die
 * Farbe kommt aus den Bedeutungs-Tokens (`--kpi-*`) und wechselt nicht mit
 * dem Theme.
 */
export function AttentionList({ items, max = 4, emptyText = 'Nichts Dringendes – alles im Plan.' }: {
  items:      AttentionItem[]
  max?:       number
  emptyText?: string
}) {
  const [all, setAll] = useState(false)
  const sorted = [...items].sort((a, b) => ORDER[a.level] - ORDER[b.level])
  const shown  = all ? sorted : sorted.slice(0, max)
  const rest   = sorted.length - shown.length

  return (
    <section className="dash-band-card dash-attn" aria-labelledby="dash-attn-title">
      <h2 className="dash-band-title" id="dash-attn-title">
        Jetzt wichtig <HelpHint id="dashboard.attention" size={13} />
      </h2>
      {sorted.length === 0 ? (
        <p className="dash-attn-empty">
          <CheckCircle2 size={16} strokeWidth={2} aria-hidden="true" /> {emptyText}
        </p>
      ) : (
        <ul className="dash-attn-list">
          {shown.map(item => {
            const { icon: Icon, label } = LEVEL[item.level]
            const body = (
              <>
                <Icon size={16} strokeWidth={2} className="dash-attn-icon" aria-hidden="true" />
                <span className="sr-only">{label}: </span>
                <span className="dash-attn-text">{item.text}</span>
                {item.amount && <span className="dash-attn-amount">{item.amount}</span>}
                {(item.to || item.onClick) && <ChevronRight size={15} strokeWidth={2} className="dash-attn-chev" aria-hidden="true" />}
              </>
            )
            return (
              <li key={item.id} className={`dash-attn-row dash-attn-row--${item.level}`}>
                {item.to
                  ? <Link to={item.to} state={item.state} className="dash-attn-link">{body}</Link>
                  : item.onClick
                    ? <button type="button" className="dash-attn-link" onClick={item.onClick}>{body}</button>
                    : <div className="dash-attn-link">{body}</div>}
              </li>
            )
          })}
        </ul>
      )}
      {rest > 0 && (
        <button type="button" className="link-btn dash-attn-more" onClick={() => setAll(true)}>
          {rest} weitere anzeigen
        </button>
      )}
    </section>
  )
}
