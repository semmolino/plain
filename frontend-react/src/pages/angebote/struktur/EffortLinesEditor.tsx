import { Plus, X } from 'lucide-react'
import { AmountInput } from '@/components/ui/AmountInput'
import { fmtEur, money } from '@/utils/money'
import { fmtHours } from '@/utils/zeit'
import type { ActiveRole } from '@/api/projekte'
import { emptyLine, lineFee, linesFee, linesHours, type EffortLineEdit } from './offerStrukturCalc'

/**
 * Aufwandszeilen eines Angebotselements (Runde 5): Rolle · Stunden · Satz je
 * Zeile, darunter die Summe. Desktop (Panel unter der Zeile) und Handy (Blatt
 * des Elements) benutzen denselben Editor — die Anordnung macht das CSS.
 *
 * Die Rolle belegt den Satz vor, ueberschreibt aber keinen eigenen: nur ein
 * leerer Satz, 0 oder der Satz der vorher gewaehlten Rolle wird ersetzt.
 */
export function EffortLinesEditor({ lines, roles, readOnly, onChange, idPrefix }: {
  lines:    EffortLineEdit[]
  roles:    ActiveRole[]
  readOnly: boolean
  onChange: (lines: EffortLineEdit[]) => void
  idPrefix: string
}) {
  const rows = lines.length ? lines : [emptyLine()]

  function update(i: number, patch: Partial<EffortLineEdit>) {
    onChange(rows.map((l, j) => j === i ? { ...l, ...patch } : l))
  }

  function chooseRole(i: number, roleId: string) {
    const l = rows[i]
    const role = roles.find(r => String(r.ID) === roleId)
    const prev = roles.find(r => String(r.ID) === l.roleId)
    const rateUntouched = !l.rate || Number(l.rate) === 0 || (prev?.HOURLY_RATE != null && Number(l.rate) === Number(prev.HOURLY_RATE))
    update(i, {
      roleId,
      roleAbbr: role?.ABBR ?? '',
      roleName: role?.NAME ?? '',
      ...(role?.HOURLY_RATE != null && rateUntouched ? { rate: String(role.HOURLY_RATE) } : {}),
    })
  }

  return (
    <div className="ox-effort">
      <div className="ox-effort-head" aria-hidden="true">
        <span>Rolle</span><span>Stunden</span><span>Satz €/h</span><span>Betrag</span><span />
      </div>
      <ol className="ox-effort-list">
        {rows.map((l, i) => {
          const n = i + 1
          const known = !l.roleId || roles.some(r => String(r.ID) === l.roleId)
          return (
            <li className="ox-effort-line" key={i}>
              <select id={`${idPrefix}-role-${i}`} className="tbl-select ox-effort-role" value={l.roleId} disabled={readOnly}
                aria-label={`Rolle, Zeile ${n}`} onChange={e => chooseRole(i, e.target.value)}>
                <option value="">— ohne Rolle —</option>
                {!known && <option value={l.roleId}>{l.roleAbbr || 'Rolle'}{l.roleName ? ` – ${l.roleName}` : ''}</option>}
                {roles.map(r => <option key={r.ID} value={r.ID}>{r.ABBR}{r.NAME ? ` – ${r.NAME}` : ''}</option>)}
              </select>
              <input className="tbl-input ox-effort-hours" type="text" inputMode="decimal" value={l.hours} disabled={readOnly}
                placeholder="0" aria-label={`Stunden, Zeile ${n}`}
                onChange={e => update(i, { hours: e.target.value.replace(',', '.') })} />
              <AmountInput className="tbl-input ox-effort-rate" value={l.rate} disabled={readOnly} placeholder="0,00"
                aria-label={`Stundensatz, Zeile ${n}`} onChange={v => update(i, { rate: v })} />
              <span className="ox-effort-amount">{fmtEur(lineFee(l))}</span>
              {!readOnly ? (
                <button type="button" className="row-action-btn ox-effort-remove" aria-label={`Zeile ${n} entfernen`}
                  title="Zeile entfernen" disabled={rows.length === 1 && !l.roleId && !l.hours && !l.rate}
                  onClick={() => onChange(rows.filter((_, j) => j !== i))}>
                  <X size={12} strokeWidth={2.5} aria-hidden="true" />
                </button>
              ) : <span />}
            </li>
          )
        })}
      </ol>
      <div className="ox-effort-foot">
        {!readOnly && (
          <button type="button" className="btn-secondary ox-effort-add" onClick={() => onChange([...rows, emptyLine()])}>
            <Plus size={13} strokeWidth={2} aria-hidden="true" /> Rolle hinzufügen
          </button>
        )}
        <span className="ox-effort-sum">
          Summe <strong>{fmtHours(linesHours(rows))} h</strong> · <strong>{money(linesFee(rows))}</strong>
        </span>
      </div>
    </div>
  )
}
