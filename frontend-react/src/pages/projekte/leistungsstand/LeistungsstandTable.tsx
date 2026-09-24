import { Fragment, useRef } from 'react'
import { AlertTriangle, Lock } from 'lucide-react'
import { money, fmtEur } from '@/utils/money'
import { rowState, deDate } from './leistungsstandCalc'
import type { LeistungsstandEditor } from './useLeistungsstandEditor'

const FMT_PCT = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 2 })
const pct = (v: number) => `${FMT_PCT.format(v)}\u202f%`

/**
 * Eingabetabelle der Leistungsstaende — dieselbe im Projekt-Reiter und in der
 * Monatsrunde (UI-Pilot Runde 2).
 *
 * Gegenueber vorher: „Bisher" sagt, von wann der Stand ist; Eingabe „45"
 * oder „45,5"; Enter springt ins naechste Feld und am letzten zur
 * Hauptaktion; Rueckgang und „weniger als schon abgerechnet" stehen als Text
 * unter der Zeile, nicht nur als Farbe. Elemente mit einem Stand nach dem
 * Stichtag sind gesperrt und sagen warum.
 */
export function LeistungsstandTable({ ed, canEdit, onLastEnter, filter = '' }: {
  ed:           LeistungsstandEditor
  canEdit:      boolean
  /** Enter im letzten Feld — z. B. „Speichern & nächstes" fokussieren. */
  onLastEnter?: () => void
  filter?:      string
}) {
  const refs = useRef<Record<number, HTMLInputElement | null>>({})
  const q = filter.trim().toLowerCase()
  const rows = q
    ? ed.rows.filter(r => r.node.ABBR.toLowerCase().includes(q) || (r.node.NAME ?? '').toLowerCase().includes(q))
    : ed.rows
  const inputIds = rows.filter(r => r.editable && !r.lockedAfter && canEdit).map(r => r.node.STRUCTURE_ID)

  function onKey(e: React.KeyboardEvent<HTMLInputElement>, sid: number) {
    if (e.key !== 'Enter') return
    e.preventDefault()
    const i = inputIds.indexOf(sid)
    const next = inputIds[i + (e.shiftKey ? -1 : 1)]
    if (next != null) refs.current[next]?.focus()
    else if (!e.shiftKey) onLastEnter?.()
  }

  return (
    <div className="lr-table-wrap">
      <table className="lr-table">
        <thead>
          <tr>
            <th scope="col">Element</th>
            <th scope="col" className="lr-num" title="Honorar inkl. Nebenkosten">Honorar</th>
            <th scope="col" className="lr-num">Bisher</th>
            <th scope="col" className="lr-num lr-th-in">Neu</th>
            <th scope="col" className="lr-num">Δ €</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(r => {
            const n   = r.node
            const sid = n.STRUCTURE_ID
            const raw = ed.vals[sid]
            const st  = rowState(r, raw)
            const prevAsOf = n.PREV_AS_OF ? String(n.PREV_AS_OF).slice(0, 10) : null
            const errId = `lr-err-${sid}`
            const warnId = `lr-warn-${sid}`
            return (
              <Fragment key={sid}>
                <tr className={`lr-row${n.IS_LEAF ? '' : ' lr-row--parent'}${st.changed ? ' lr-row--changed' : ''}`}>
                  <td className="lr-td-el">
                    <span className="lr-el" style={{ paddingLeft: r.depth * 16 }}>
                      <span className="lr-el-abbr">{n.ABBR}</span>
                      {n.NAME && <span className="lr-el-name">{n.NAME}</span>}
                    </span>
                  </td>
                  <td className="lr-num lr-td-fee">{n.IS_LEAF ? money(r.fee) : <span className="lr-muted">{money(r.fee)}</span>}</td>
                  <td className="lr-num lr-td-prev">
                    {n.IS_LEAF ? (
                      <>
                        <span>{pct(r.nachweis ? 100 : r.current)}</span>
                        {prevAsOf && !r.nachweis && <span className="lr-prev-date">zum {deDate(prevAsOf).slice(0, 6)}</span>}
                      </>
                    ) : null}
                  </td>
                  <td className="lr-num">
                    {r.nachweis ? (
                      <span className="lr-muted" title="Nach Aufwand abgerechnet — steht immer auf 100 %">Nachweis</span>
                    ) : r.lockedAfter ? (
                      <span className="lr-locked" title={`Für dieses Element gibt es schon einen Stand zum ${deDate(r.lockedAfter)}.`}>
                        <Lock size={12} strokeWidth={2} aria-hidden="true" /> Stand {deDate(r.lockedAfter).slice(0, 6)}
                      </span>
                    ) : r.editable && canEdit ? (
                      <span className="lr-input-wrap">
                        <input
                          ref={el => { refs.current[sid] = el }}
                          type="text" inputMode="decimal" className="lr-input"
                          aria-label={`Neuer Stand ${n.ABBR}${n.NAME ? ` ${n.NAME}` : ''} in Prozent`}
                          aria-invalid={st.error ? true : undefined}
                          aria-describedby={st.error ? errId : st.warnings.length ? warnId : undefined}
                          value={ed.valueOf(sid, r.current)}
                          onChange={e => ed.setVal(sid, e.target.value)}
                          onFocus={e => e.currentTarget.select()}
                          onKeyDown={e => onKey(e, sid)}
                        />
                        <span className="lr-unit" aria-hidden="true">%</span>
                      </span>
                    ) : n.IS_LEAF ? (
                      <span>{pct(r.current)}</span>
                    ) : null}
                  </td>
                  <td className="lr-num lr-td-delta">
                    {st.changed ? <span>{st.delta > 0 ? '+' : ''}{money(st.delta)}</span> : null}
                  </td>
                </tr>
                {(st.error || st.warnings.length > 0) && (
                  <tr className="lr-note-row">
                    <td colSpan={5}>
                      {st.error ? (
                        <span id={errId} className="lr-note lr-note--error" role="alert">{n.ABBR}: {st.error}</span>
                      ) : (
                        <span id={warnId} className="lr-note">
                          <AlertTriangle size={13} strokeWidth={2} aria-hidden="true" />
                          {st.warnings.map(w => w.kind === 'decrease'
                            ? `Weniger als bisher (${pct(w.from)})`
                            : `Weniger als schon abgerechnet (${fmtEur(w.billed)})`).join(' · ')}
                        </span>
                      )}
                    </td>
                  </tr>
                )}
              </Fragment>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
