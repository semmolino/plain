import { useState, type ReactNode } from 'react'
import { ChevronRight, Trash2 } from 'lucide-react'
import { Modal } from '@/components/ui/Modal'
import { DialogFooter } from '@/components/ui/DialogFooter'
import { AmountInput } from '@/components/ui/AmountInput'
import { Message } from '@/components/ui/Message'
import type { FeeCalcMaster, FeePhaseRow, FeeCalcSurcharge, FeeCalcBl, BlAmountType } from '@/api/fee'
import { fmtEur } from '@/utils/money'
import { SurchargeAmount } from '@/pages/projekte/struktur/SurchargeAmount'
import {
  type KX, fmtPct, revenueByKx, phaseRevenue, computeSurchargeEffects, BL_AMOUNT_TYPE_LABELS, computeBlItemAmount,
} from '@/pages/projekte/kalkCalc'

/**
 * Kalkulation am Handy (UI-Pilot Runde 8): Leistungsphasen, Besondere
 * Leistungen und Zuschläge als Liste, ein Tipp öffnet die Zeile als Blatt.
 *
 * Vorher stand am Handy dieselbe Tabelle wie am Desktop — sieben bis acht
 * Spalten mit Eingabefeldern, seitwärts zu schieben; von der Zuschlagstabelle
 * war beim Öffnen nur die Kopfzeile zu sehen. Im Blatt stehen die Felder
 * untereinander, beschriftet, mit dem Ergebnis darunter, bevor man übernimmt.
 *
 * Übernehmen schreibt in den Stand des Assistenten, nicht an den Server —
 * gespeichert wird wie am Desktop mit „Weiter" oder „Zurück". Abbrechen
 * verwirft nur, was im Blatt geändert wurde.
 */

// ── Liste ────────────────────────────────────────────────────────────────────

export interface KalkListItem {
  key:    string | number
  title:  ReactNode
  sub?:   ReactNode
  value:  ReactNode
}

export function KalkList({ label, items, onOpen, total, empty }: {
  label:  string
  items:  KalkListItem[]
  onOpen: (index: number) => void
  total?: { label: string; value: ReactNode }[]
  empty?: ReactNode
}) {
  return (
    <div className="km">
      {items.length > 0 ? (
        <ul className="km-list" aria-label={label}>
          {items.map((it, i) => (
            <li key={it.key}>
              <button type="button" className="km-row" onClick={() => onOpen(i)}>
                <span className="km-main">
                  <span className="km-title">{it.title}</span>
                  {it.sub && <span className="km-sub">{it.sub}</span>}
                </span>
                <span className="km-value">{it.value}</span>
                <ChevronRight size={16} strokeWidth={2} aria-hidden="true" className="km-chev" />
              </button>
            </li>
          ))}
        </ul>
      ) : empty}
      {total && items.length > 0 && (
        <dl className="km-total">
          {total.map(t => (
            <div key={t.label}><dt>{t.label}</dt><dd>{t.value}</dd></div>
          ))}
        </dl>
      )}
    </div>
  )
}

/** Ergebniszeile im Blatt: „Honorar 18.406,12 €". */
function Result({ label, children }: { label: string; children: ReactNode }) {
  return (
    <p className="km-result" aria-live="polite">
      <span>{label}</span><strong>{children}</strong>
    </p>
  )
}

const numStr = (v: number | null | undefined) => (v == null ? '' : String(v))
const toNumOrNull = (s: string) => (s === '' ? null : Number(s))

// ── Leistungsphase ───────────────────────────────────────────────────────────

export function PhaseSheet({ phase, calcMaster, kxOptions, singleValue, onApply, onClose }: {
  phase:       FeePhaseRow
  calcMaster:  FeeCalcMaster | null
  kxOptions:   readonly string[]
  singleValue: boolean
  onApply:     (kx: string, pct: number | null) => void
  onClose:     () => void
}) {
  const [kx, setKx]   = useState<string>(phase.KX || 'K0')
  const [pct, setPct] = useState(numStr(phase.FEE_PERCENT))
  const base = calcMaster ? revenueByKx(calcMaster, kx as KX) : phase.REVENUE_BASE
  const basePct = phase.FEE_PERCENT_BASE ?? null
  const revenue = phaseRevenue(base ?? null, toNumOrNull(pct))
  const baseFee = basePct != null && base != null ? (basePct * base) / 100 : null

  return (
    <Modal open onClose={onClose} title={phase.PHASE_LABEL} className="sxm-sheet">
      <div className="qb-form">
        <div className="qb-times">
          <div className="form-group">
            <label htmlFor="km-ph-kx">Kostenstand (Kx)</label>
            <select id="km-ph-kx" value={kx} disabled={singleValue} onChange={e => setKx(e.target.value)}>
              {kxOptions.map(k => <option key={k} value={k}>{k}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label htmlFor="km-ph-pct">Honorar %</label>
            <AmountInput id="km-ph-pct" value={pct} onChange={setPct} placeholder="z. B. 2,00" />
          </div>
        </div>
        <dl className="km-facts">
          <div><dt>Basis nach {kx}</dt><dd>{base != null ? fmtEur(base) : '—'}</dd></div>
          <div><dt>Anteil laut HOAI</dt><dd>{basePct != null ? `${fmtPct(basePct)} %` : '—'}</dd></div>
          <div><dt>Honorar laut HOAI</dt><dd>{baseFee != null ? fmtEur(baseFee) : '—'}</dd></div>
        </dl>
        <Result label="Honorar dieser Phase">{revenue != null ? fmtEur(revenue) : '—'}</Result>
        <DialogFooter>
          <button type="button" className="btn-secondary" onClick={onClose}>Abbrechen</button>
          <button type="button" className="btn-primary" onClick={() => { onApply(kx, toNumOrNull(pct)); onClose() }}>Übernehmen</button>
        </DialogFooter>
      </div>
    </Modal>
  )
}

// ── Besondere Leistung ───────────────────────────────────────────────────────

export function BlSheet({ item, isNew, phases, calcMaster, kxOptions, singleValue, grundhonorar, surchargeNoBlTotal, onApply, onRemove, onClose }: {
  item:               FeeCalcBl
  isNew:              boolean
  phases:             FeePhaseRow[]
  calcMaster:         FeeCalcMaster | null
  kxOptions:          readonly string[]
  singleValue:        boolean
  grundhonorar:       number
  surchargeNoBlTotal: number
  onApply:            (item: FeeCalcBl) => void
  onRemove?:          () => void
  onClose:            () => void
}) {
  const [d, setD] = useState<FeeCalcBl>(item)
  const [err, setErr] = useState<string | null>(null)
  const set = (p: Partial<FeeCalcBl>) => { setD(x => ({ ...x, ...p })); setErr(null) }
  const type = d.AMOUNT_TYPE || 'fixed'
  const isFixed = type === 'fixed'
  const needsKx = type === 'pct_basis' || type === 'pct_baukosten'
  const amount = computeBlItemAmount(d, phases, calcMaster, grundhonorar, surchargeNoBlTotal)

  function apply() {
    if (!d.NAME.trim()) { setErr('Bitte eine Bezeichnung angeben.'); return }
    onApply({ ...d, NAME: d.NAME.trim(), ABBR: d.ABBR?.trim() || null })
    onClose()
  }

  return (
    <Modal open onClose={onClose} title={isNew ? 'Besondere Leistung hinzufügen' : (d.ABBR || d.NAME || 'Besondere Leistung')} className="sxm-sheet">
      <div className="qb-form">
        <div className="qb-times">
          <div className="form-group">
            <label htmlFor="km-bl-abbr">Kürzel</label>
            <input id="km-bl-abbr" value={d.ABBR ?? ''} placeholder="z. B. BL1" onChange={e => set({ ABBR: e.target.value })} />
          </div>
          <div className="form-group">
            <label htmlFor="km-bl-lph">Bezug</label>
            <select id="km-bl-lph" value={d.LPH_PHASE_ID != null ? String(d.LPH_PHASE_ID) : ''}
              onChange={e => set({ LPH_PHASE_ID: e.target.value ? Number(e.target.value) : null })}>
              <option value="">— keine Phase —</option>
              {phases.map(p => <option key={p.ID} value={String(p.ID)}>{p.PHASE_LABEL}</option>)}
            </select>
          </div>
        </div>
        <div className="form-group">
          <label htmlFor="km-bl-name">Bezeichnung*</label>
          <input id="km-bl-name" value={d.NAME} aria-invalid={err ? true : undefined}
            placeholder="z. B. Brandschutzkonzept" onChange={e => set({ NAME: e.target.value })} />
        </div>
        <div className="form-group">
          <label htmlFor="km-bl-type">Berechnungsart</label>
          <select id="km-bl-type" value={type}
            onChange={e => set({ AMOUNT_TYPE: e.target.value as BlAmountType, PERCENT: null, KX_REF: null })}>
            {(Object.entries(BL_AMOUNT_TYPE_LABELS) as [BlAmountType, string][])
              .filter(([k]) => k !== 'pct_gesamthonorar')
              .filter(([k]) => !(singleValue && k === 'pct_baukosten'))
              .map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
        {isFixed ? (
          <div className="form-group">
            <label htmlFor="km-bl-amount">Betrag €</label>
            <AmountInput id="km-bl-amount" value={d.AMOUNT ? String(d.AMOUNT) : ''} placeholder="z. B. 12.500,00"
              onChange={v => set({ AMOUNT: v === '' ? 0 : Number(v) })} />
          </div>
        ) : (
          <div className="qb-times">
            <div className="form-group">
              <label htmlFor="km-bl-pct">Prozent</label>
              <AmountInput id="km-bl-pct" value={numStr(d.PERCENT)} placeholder="z. B. 3,00"
                onChange={v => set({ PERCENT: toNumOrNull(v) })} />
            </div>
            {needsKx && (
              <div className="form-group">
                <label htmlFor="km-bl-kx">Kostenstand (Kx)</label>
                <select id="km-bl-kx" value={d.KX_REF || ''} onChange={e => set({ KX_REF: e.target.value || null })}>
                  <option value="">— Kx wählen —</option>
                  {kxOptions.map(k => <option key={k} value={k}>{k}</option>)}
                </select>
              </div>
            )}
          </div>
        )}
        {!isFixed && <Result label="Betrag">{fmtEur(amount)}</Result>}
        <Message type="error" text={err} />
        <DialogFooter secondary={onRemove ? (
          <button type="button" className="btn-secondary sxm-icon-btn km-remove" onClick={() => { onRemove(); onClose() }}
            aria-label="Besondere Leistung entfernen" title="Entfernen">
            <Trash2 size={15} strokeWidth={2} aria-hidden="true" />
          </button>
        ) : undefined}>
          <button type="button" className="btn-secondary" onClick={onClose}>Abbrechen</button>
          <button type="button" className="btn-primary" onClick={apply}>{isNew ? 'Hinzufügen' : 'Übernehmen'}</button>
        </DialogFooter>
      </div>
    </Modal>
  )
}

// ── Zuschlag / Nachlass ──────────────────────────────────────────────────────

const ids = (json: string | null): number[] | null => {
  if (!json) return null
  try { return JSON.parse(json) as number[] } catch { return null }
}

export function SurchargeSheet({ row, index, isNew, all, phases, blItems, blAmounts, onApply, onRemove, onClose }: {
  row:       FeeCalcSurcharge
  /** Stelle in der Liste — kumulativ rechnet auf die Zuschläge davor */
  index:     number
  isNew:     boolean
  all:       FeeCalcSurcharge[]
  phases:    FeePhaseRow[]
  blItems:   FeeCalcBl[]
  blAmounts: number[]
  onApply:   (row: FeeCalcSurcharge) => void
  onRemove?: () => void
  onClose:   () => void
}) {
  const [d, setD] = useState<FeeCalcSurcharge>(row)
  const [err, setErr] = useState<string | null>(null)
  const set = (p: Partial<FeeCalcSurcharge>) => { setD(x => ({ ...x, ...p })); setErr(null) }

  const list = [...all]
  list[index] = d
  const effect = computeSurchargeEffects(phases, list, blItems, blAmounts)[index]
  const cumulative = d.CALC_MODE === 'cumulative'

  const lph = ids(d.LPH_FILTER) ?? phases.map(p => p.ID)
  const toggleLph = (id: number) => {
    const next = lph.includes(id) ? lph.filter(x => x !== id) : [...lph, id]
    set({ LPH_FILTER: next.length === phases.length ? null : JSON.stringify(next) })
  }
  const bl = ids(d.BL_FILTER) ?? []
  const toggleBl = (id: number) => {
    const next = bl.includes(id) ? bl.filter(x => x !== id) : [...bl, id]
    set({ BL_FILTER: next.length ? JSON.stringify(next) : null })
  }
  const blIds = blItems.map(b => b.ID).filter((id): id is number => id != null)

  function apply() {
    if (!(d.ABBR ?? '').trim()) { setErr('Bitte eine Kurzbezeichnung angeben.'); return }
    onApply({ ...d, ABBR: (d.ABBR ?? '').trim() })
    onClose()
  }

  return (
    <Modal open onClose={onClose} title={isNew ? 'Zuschlag / Nachlass hinzufügen' : (d.ABBR || 'Zuschlag')} className="sxm-sheet">
      <div className="qb-form">
        <div className="form-group">
          <label htmlFor="km-su-abbr">Kurzbezeichnung*</label>
          <input id="km-su-abbr" value={d.ABBR ?? ''} aria-invalid={err ? true : undefined}
            placeholder="z. B. Umbauzuschlag" onChange={e => set({ ABBR: e.target.value })} />
        </div>
        <div className="form-group">
          <label htmlFor="km-su-name">Langbezeichnung</label>
          <input id="km-su-name" value={d.NAME ?? ''} onChange={e => set({ NAME: e.target.value })} />
        </div>
        <div className="form-group">
          <label htmlFor="km-su-pct">Prozent</label>
          <AmountInput id="km-su-pct" value={numStr(d.PERCENT)} placeholder="z. B. 20,00" aria-describedby="km-su-pct-hint"
            onChange={v => set({ PERCENT: toNumOrNull(v) })} />
          <p id="km-su-pct-hint" className="form-field-hint">Negativ für einen Nachlass, z. B. −3.</p>
        </div>

        <fieldset className="ws-radio-group km-group">
          <legend>Berechnung</legend>
          <div className="seg-toggle" role="group" aria-label="Berechnungsmodus">
            <button type="button" aria-pressed={!cumulative} onClick={() => set({ CALC_MODE: 'parallel' })}>Parallel</button>
            <button type="button" aria-pressed={cumulative} onClick={() => set({ CALC_MODE: 'cumulative' })}>Kumulativ</button>
          </div>
          <p className="form-field-hint">
            {cumulative && index > 0 ? 'Auf Honorarbasis plus alle Zuschläge davor.' : 'Auf die Honorarbasis.'}
          </p>
        </fieldset>

        <fieldset className="km-group km-checks">
          <legend>Leistungsphasen</legend>
          <div className="km-check-actions">
            <button type="button" className="btn-small" onClick={() => set({ LPH_FILTER: null })}>Alle</button>
            <button type="button" className="btn-small" onClick={() => set({ LPH_FILTER: JSON.stringify([]) })}>Keine</button>
          </div>
          {phases.map(p => (
            <label key={p.ID} className="ws-check">
              <input type="checkbox" checked={lph.includes(p.ID)} onChange={() => toggleLph(p.ID)} />
              <span>{p.PHASE_LABEL}</span>
            </label>
          ))}
        </fieldset>

        {blIds.length > 0 && (
          <fieldset className="km-group km-checks">
            <legend>Besondere Leistungen</legend>
            <div className="km-check-actions">
              <button type="button" className="btn-small" onClick={() => set({ BL_FILTER: JSON.stringify(blIds) })}>Alle</button>
              <button type="button" className="btn-small" onClick={() => set({ BL_FILTER: null })}>Keine</button>
            </div>
            {blItems.filter(b => b.ID != null).map(b => (
              <label key={b.ID} className="ws-check">
                <input type="checkbox" checked={bl.includes(b.ID!)} onChange={() => toggleBl(b.ID!)} />
                <span>{b.ABBR ? `${b.ABBR} — ${b.NAME}` : b.NAME}</span>
              </label>
            ))}
          </fieldset>
        )}

        <dl className="km-facts">
          <div><dt>Berechnungsbasis</dt><dd>{fmtEur(effect?.effectiveBase ?? 0)}</dd></div>
        </dl>
        <Result label={(d.PERCENT ?? 0) < 0 ? 'Nachlass' : 'Zuschlag'}><SurchargeAmount value={effect?.amount ?? 0} /></Result>
        <Message type="error" text={err} />
        <DialogFooter secondary={onRemove ? (
          <button type="button" className="btn-secondary sxm-icon-btn km-remove" onClick={() => { onRemove(); onClose() }}
            aria-label="Zuschlag entfernen" title="Entfernen">
            <Trash2 size={15} strokeWidth={2} aria-hidden="true" />
          </button>
        ) : undefined}>
          <button type="button" className="btn-secondary" onClick={onClose}>Abbrechen</button>
          <button type="button" className="btn-primary" onClick={apply}>{isNew ? 'Hinzufügen' : 'Übernehmen'}</button>
        </DialogFooter>
      </div>
    </Modal>
  )
}

/** Kurzbeschreibung einer Zuschlagszeile für die Liste. */
export function surchargeScope(r: FeeCalcSurcharge, phases: FeePhaseRow[]): string {
  const sel = ids(r.LPH_FILTER)
  const n = sel == null ? phases.length : phases.filter(p => sel.includes(p.ID)).length
  const scope = n === phases.length ? 'alle Phasen' : n === 0 ? 'keine Phase' : `${n} von ${phases.length} Phasen`
  return `${r.CALC_MODE === 'cumulative' ? 'kumulativ' : 'parallel'} · ${scope}`
}

/** Kurzbeschreibung einer Besonderen Leistung für die Liste. */
export function blScope(b: FeeCalcBl, phases: FeePhaseRow[]): string {
  const type = BL_AMOUNT_TYPE_LABELS[b.AMOUNT_TYPE || 'fixed']
  const pct = b.AMOUNT_TYPE && b.AMOUNT_TYPE !== 'fixed' && b.PERCENT != null ? `${fmtPct(b.PERCENT)} ` : ''
  const phase = phases.find(p => p.ID === b.LPH_PHASE_ID)?.PHASE_LABEL
  return [b.AMOUNT_TYPE && b.AMOUNT_TYPE !== 'fixed' ? `${pct}${type}` : 'Pauschal', phase].filter(Boolean).join(' · ')
}
