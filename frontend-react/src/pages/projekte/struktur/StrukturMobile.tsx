import { useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Plus, Target, Trash2 } from 'lucide-react'
import { Modal } from '@/components/ui/Modal'
import { DialogFooter } from '@/components/ui/DialogFooter'
import { Message } from '@/components/ui/Message'
import { AmountInput } from '@/components/ui/AmountInput'
import { patchStructureNode, moveStructureNode, type StructureNode } from '@/api/projekte'
import { fmtEur } from '@/utils/money'
import { fmtHours } from '@/utils/zeit'
import { computeSurcharges, planStatus, rowChanges, surchargeDefault, type Agg, type RowEdit, type SurchargeEdit } from './strukturCalc'
import { StructureTreeList, type TreeListItem } from './StructureTreeList'

/**
 * Projektstruktur am Handy (UI-Pilot Runde 2).
 *
 * Vorher zeigte das Handy dieselbe Tabelle wie der Desktop — 1100 px breit,
 * mit Eingabefeldern in jeder Zelle, seitwaerts zu scrollen. Jetzt eine
 * Baumliste mit dem Noetigsten (Element, Honorar, Gesamt); ein Tipp oeffnet
 * das Element als Blatt mit allen Feldern. Gespeichert wird je Element —
 * der Sammel-Puffer des Desktops (Aktionsleiste, Strg+S) passt nicht zu einem
 * Blatt, das man schliesst.
 */
export function StrukturMobile({ projectId, flat, parentIds, aggMap, billingTypes, canEdit, root, onAdd, onDelete, onPlan }: {
  projectId:    number
  flat:         { node: StructureNode; depth: number }[]
  parentIds:    Set<string>
  aggMap:       Map<string, Agg>
  billingTypes: { ID: number; ABBR: string }[]
  canEdit:      boolean
  root:         { label: string; revenue: number; total: number } | null
  onAdd:        (fatherId: number | null) => void
  onDelete:     (node: StructureNode) => void
  /** Plan eines Elements nach Aufwand bearbeiten (Runde 5) */
  onPlan?:      (node: StructureNode) => void
}) {
  const [openId, setOpenId] = useState<number | null>(null)
  const open = openId != null ? flat.find(f => f.node.STRUCTURE_ID === openId)?.node ?? null : null

  const gesamt = (n: StructureNode, isParent: boolean) =>
    Number(n.REVENUE ?? 0) + (isParent ? (aggMap.get(String(n.STRUCTURE_ID))?.extras ?? 0) : Number(n.EXTRAS ?? 0))
  const honorar = (n: StructureNode, isParent: boolean) =>
    isParent ? (aggMap.get(String(n.STRUCTURE_ID))?.revenueBasis ?? 0)
      : Number(n.BILLING_TYPE_ID) === 2 ? Number(n.TEC_SP_TOT_SUM ?? 0) : Number(n.REVENUE_BASIS ?? n.REVENUE ?? 0)
  const items: TreeListItem[] = flat.map(({ node, depth }) => {
    const isParent = parentIds.has(String(node.STRUCTURE_ID))
    return {
      id: node.STRUCTURE_ID, fatherId: node.FATHER_ID != null ? Number(node.FATHER_ID) : null, depth,
      abbr: node.ABBR, name: node.NAME ?? '', isParent, muted: !!node.IS_INTERNAL,
      fee: honorar(node, isParent), total: gesamt(node, isParent),
    }
  })

  return (
    <div className="sxm">
      <StructureTreeList items={items} listLabel="Elemente der Projektstruktur" canEdit={canEdit} onOpen={setOpenId}
        root={root ? { label: `${root.label} · Projekt gesamt`, total: root.total } : null} />
      {open && (
        <ElementSheet key={open.STRUCTURE_ID} projectId={projectId} node={open}
          isParent={parentIds.has(String(open.STRUCTURE_ID))} flat={flat} billingTypes={billingTypes} canEdit={canEdit}
          onClose={() => setOpenId(null)}
          onAdd={() => { setOpenId(null); onAdd(open.STRUCTURE_ID) }}
          onDelete={() => { setOpenId(null); onDelete(open) }}
          onPlan={onPlan ? () => { setOpenId(null); onPlan(open) } : undefined} />
      )}
    </div>
  )
}

const TOP = '__top__'

function ElementSheet({ projectId, node, isParent, flat, billingTypes, canEdit, onClose, onAdd, onDelete, onPlan }: {
  projectId: number; node: StructureNode; isParent: boolean
  flat: { node: StructureNode; depth: number }[]
  billingTypes: { ID: number; ABBR: string }[]
  canEdit: boolean
  onClose: () => void; onAdd: () => void; onDelete: () => void
  onPlan?: () => void
}) {
  const qc = useQueryClient()
  const [e, setE] = useState<RowEdit>({})
  const [father, setFather] = useState<string>(node.FATHER_ID != null ? String(node.FATHER_ID) : TOP)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const sur: SurchargeEdit = e.surcharge ?? surchargeDefault(node)
  const btId = e.billingTypeId ?? String(node.BILLING_TYPE_ID ?? '')
  const isTec = Number(btId) === 2
  const plan = !isParent ? planStatus(node) : null
  const base = isParent ? Number(node.REVENUE_BASIS ?? 0) : isTec ? Number(node.TEC_SP_TOT_SUM ?? 0) : Number(e.budget ?? node.REVENUE_BASIS ?? node.REVENUE ?? 0)
  const computed = computeSurcharges(base, sur)
  const changes = rowChanges(node, e)
  const moved = father !== (node.FATHER_ID != null ? String(node.FATHER_ID) : TOP)
  const dirty = Object.keys(changes).length > 0 || moved

  // Moegliche neue Vaeter: nicht das Element selbst und nicht sein Teilbaum.
  const descendants = useMemo(() => {
    const out = new Set<number>([node.STRUCTURE_ID])
    let grew = true
    while (grew) {
      grew = false
      for (const f of flat) if (f.node.FATHER_ID != null && out.has(Number(f.node.FATHER_ID)) && !out.has(f.node.STRUCTURE_ID)) { out.add(f.node.STRUCTURE_ID); grew = true }
    }
    return out
  }, [flat, node.STRUCTURE_ID])
  const parentChoices = flat.filter(f => !descendants.has(f.node.STRUCTURE_ID) && flat.some(c => Number(c.node.FATHER_ID) === f.node.STRUCTURE_ID))

  const set = (patch: Partial<RowEdit>) => setE(p => ({ ...p, ...patch }))
  const setSur = (patch: Partial<SurchargeEdit>) => set({ surcharge: { ...sur, ...patch } })

  async function save() {
    setSaving(true); setErr(null)
    try {
      if (Object.keys(changes).length) await patchStructureNode(node.STRUCTURE_ID, changes)
      if (moved) await moveStructureNode(node.STRUCTURE_ID, father === TOP ? null : Number(father), '__end__')
      await qc.invalidateQueries({ queryKey: ['structure', projectId] })
      void qc.invalidateQueries({ queryKey: ['report-header', projectId] })
      onClose()
    } catch (x) {
      setErr((x as Error)?.message || 'Speichern fehlgeschlagen')
      setSaving(false)
    }
  }

  const ro = !canEdit
  return (
    <Modal open onClose={onClose} title={`${node.ABBR}${node.NAME ? ` · ${node.NAME}` : ''}`} className="sxm-sheet">
      <div className="qb-form">
        <div className="qb-times">
          <div className="form-group">
            <label htmlFor="sxm-abbr">Kürzel</label>
            <input id="sxm-abbr" value={e.nameShort ?? node.ABBR ?? ''} readOnly={ro} onChange={x => set({ nameShort: x.target.value })} />
          </div>
          <div className="form-group">
            <label htmlFor="sxm-bt">Abrechnung</label>
            <select id="sxm-bt" value={btId} disabled={ro} onChange={x => set({ billingTypeId: x.target.value })}>
              {billingTypes.map(b => <option key={b.ID} value={b.ID}>{b.ABBR}</option>)}
            </select>
          </div>
        </div>
        <div className="form-group">
          <label htmlFor="sxm-name">Bezeichnung</label>
          <input id="sxm-name" value={e.nameLong ?? node.NAME ?? ''} readOnly={ro} onChange={x => set({ nameLong: x.target.value })} />
        </div>
        <div className="qb-times">
          <div className="form-group">
            <label htmlFor="sxm-fee">Honorar €</label>
            {isParent || isTec || ro ? (
              <p className="sxm-readonly" id="sxm-fee">{fmtEur(base)}<span className="form-field-hint">{isParent ? 'Summe der Unterelemente' : isTec ? 'Summe der Buchungen' : ''}</span>
                {plan && <span className={`sx-plan-note${plan.over ? ' sx-plan-over' : ''}`}>{plan.over ? 'über Plan ' : 'Plan '}{fmtEur(plan.plan)}{plan.hours != null ? ` · ${fmtHours(plan.hours)} h` : ''}</span>}
              </p>
            ) : (
              <AmountInput id="sxm-fee" value={e.budget ?? String(node.REVENUE_BASIS ?? node.REVENUE ?? 0)} onChange={v => set({ budget: v })} aria-label="Honorar" />
            )}
          </div>
          <div className="form-group">
            <label htmlFor="sxm-nk">Nebenkosten %</label>
            <input id="sxm-nk" type="text" inputMode="decimal" readOnly={ro}
              value={e.nk ?? String(node.EXTRAS_PERCENT ?? 0)} onChange={x => set({ nk: x.target.value.replace(',', '.') })} />
          </div>
        </div>

        <fieldset className="sxm-sur">
          <legend>Zuschläge <span className="form-field-hint">Basis {fmtEur(base)}</span></legend>
          {([1, 2, 3] as const).map(i => {
            const k = `s${i}` as 's1' | 's2' | 's3'
            return (
              <div key={i} className="sxm-sur-row">
                <input aria-label={`Zuschlag ${i} Bezeichnung`} placeholder={`Zuschlag ${i}`} value={sur[`${k}Label`]} readOnly={ro}
                  onChange={x => setSur({ [`${k}Label`]: x.target.value } as Partial<SurchargeEdit>)} />
                <input aria-label={`Zuschlag ${i} Prozent`} type="text" inputMode="decimal" placeholder="%" value={sur[`${k}Pct`]} readOnly={ro}
                  onChange={x => setSur({ [`${k}Pct`]: x.target.value.replace(',', '.') } as Partial<SurchargeEdit>)} />
                <span className="sxm-sur-eur">{fmtEur(computed[`${k}Eur`])}</span>
                {i > 1 && (
                  <label className="sxm-sur-cumul">
                    <input type="checkbox" checked={sur[`${k}Cumul`]} disabled={ro}
                      onChange={x => setSur({ [`${k}Cumul`]: x.target.checked } as Partial<SurchargeEdit>)} />
                    auf Zwischensumme
                  </label>
                )}
              </div>
            )
          })}
        </fieldset>

        <div className="form-group">
          <label htmlFor="sxm-father">Übergeordnet</label>
          <select id="sxm-father" value={father} disabled={ro} onChange={x => setFather(x.target.value)}>
            <option value={TOP}>— oberste Ebene —</option>
            {parentChoices.map(f => (
              <option key={f.node.STRUCTURE_ID} value={String(f.node.STRUCTURE_ID)}>{' '.repeat(f.depth * 2)}{f.node.ABBR} {f.node.NAME}</option>
            ))}
          </select>
        </div>

        <Message type="error" text={err} />
        <DialogFooter secondary={canEdit ? (
          <>
            <button type="button" className="btn-secondary sxm-icon-btn" onClick={onDelete} aria-label="Element löschen" title="Element löschen">
              <Trash2 size={15} strokeWidth={2} aria-hidden="true" />
            </button>
            <button type="button" className="btn-secondary sxm-icon-btn" onClick={onAdd} aria-label="Unterelement anlegen" title="Unterelement anlegen">
              <Plus size={15} strokeWidth={2} aria-hidden="true" />
            </button>
            {onPlan && !isParent && isTec && (
              <button type="button" className="btn-secondary sxm-icon-btn" onClick={onPlan} aria-label="Plan bearbeiten" title="Plan bearbeiten">
                <Target size={15} strokeWidth={2} aria-hidden="true" />
              </button>
            )}
          </>
        ) : undefined}>
          <button type="button" className="btn-secondary" onClick={onClose} disabled={saving}>{canEdit ? 'Abbrechen' : 'Schließen'}</button>
          {canEdit && (
            <button type="button" className="btn-primary" onClick={() => void save()} disabled={!dirty || saving}>
              {saving ? 'Speichert …' : 'Speichern'}
            </button>
          )}
        </DialogFooter>
      </div>
    </Modal>
  )
}
