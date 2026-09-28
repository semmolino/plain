import { useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Plus, Trash2 } from 'lucide-react'
import { Modal } from '@/components/ui/Modal'
import { DialogFooter } from '@/components/ui/DialogFooter'
import { Message } from '@/components/ui/Message'
import { AmountInput } from '@/components/ui/AmountInput'
import { updateOfferStructureNode, moveOfferStructureNode, type OfferStructureNode } from '@/api/angebote'
import { fmtEur } from '@/utils/money'
import { computeSurcharges, surchargeDefault, type Agg, type SurchargeEdit } from '@/pages/projekte/struktur/strukturCalc'
import { StructureTreeList, type TreeListItem } from '@/pages/projekte/struktur/StructureTreeList'
import { hoursRate, isHourlyBt, offerLeafFee, offerRowChanges, type OfferRowEdit } from './offerStrukturCalc'

/**
 * Angebotsstruktur am Handy (UI-Pilot Runde 3) — dasselbe Muster wie die
 * Projektstruktur: Baumliste, ein Tipp oeffnet das Element als Blatt,
 * gespeichert wird je Element. Anders als im Projekt traegt ein
 * Aufwand-Element (BT 2) Stunden × Satz statt gebuchter Zeit.
 */
export function OfferStrukturMobile({ offerId, flat, parentIds, aggMap, billingTypes, canEdit, root, onAdd, onDelete }: {
  offerId:      number
  flat:         { node: OfferStructureNode; depth: number }[]
  parentIds:    Set<string>
  aggMap:       Map<string, Agg>
  billingTypes: { ID: number; ABBR: string }[]
  canEdit:      boolean
  root:         { label: string; total: number } | null
  onAdd:        (fatherId: number | null) => void
  onDelete:     (node: OfferStructureNode) => void
}) {
  const [openId, setOpenId] = useState<number | null>(null)
  const open = openId != null ? flat.find(f => f.node.ID === openId)?.node ?? null : null

  const items: TreeListItem[] = flat.map(({ node, depth }) => {
    const isParent = parentIds.has(String(node.ID))
    const a = aggMap.get(String(node.ID))
    return {
      id: node.ID, fatherId: node.FATHER_ID, depth, abbr: node.ABBR ?? '', name: node.NAME ?? '', isParent,
      fee:   isParent ? (a?.revenueBasis ?? 0) : offerLeafFee(node, undefined),
      total: Number(node.REVENUE ?? 0) + (isParent ? (a?.extras ?? 0) : Number(node.EXTRAS ?? 0)),
    }
  })

  return (
    <div className="sxm">
      <StructureTreeList items={items} listLabel="Elemente der Angebotsstruktur" canEdit={canEdit} onOpen={setOpenId} root={root} />
      {open && (
        <OfferElementSheet key={open.ID} offerId={offerId} node={open}
          isParent={parentIds.has(String(open.ID))} flat={flat} billingTypes={billingTypes} canEdit={canEdit}
          onClose={() => setOpenId(null)}
          onAdd={() => { setOpenId(null); onAdd(open.ID) }}
          onDelete={() => { setOpenId(null); onDelete(open) }} />
      )}
    </div>
  )
}

const TOP = '__top__'

function OfferElementSheet({ offerId, node, isParent, flat, billingTypes, canEdit, onClose, onAdd, onDelete }: {
  offerId: number; node: OfferStructureNode; isParent: boolean
  flat: { node: OfferStructureNode; depth: number }[]
  billingTypes: { ID: number; ABBR: string }[]
  canEdit: boolean
  onClose: () => void; onAdd: () => void; onDelete: () => void
}) {
  const qc = useQueryClient()
  const [e, setE] = useState<OfferRowEdit>({})
  const [father, setFather] = useState<string>(node.FATHER_ID != null ? String(node.FATHER_ID) : TOP)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const sur: SurchargeEdit = e.surcharge ?? surchargeDefault(node)
  const btId = e.billingTypeId ?? String(node.BILLING_TYPE_ID ?? '')
  const hourly = isHourlyBt(btId)
  const { hours, rate } = hoursRate(node, e)
  const base = isParent ? Number(node.REVENUE_BASIS ?? 0) : offerLeafFee(node, e)
  const computed = computeSurcharges(base, sur)
  const changes = offerRowChanges(node, e)
  const moved = father !== (node.FATHER_ID != null ? String(node.FATHER_ID) : TOP)
  const dirty = Object.keys(changes).length > 0 || moved

  // Moegliche neue Vaeter: nicht das Element selbst und nicht sein Teilbaum.
  const descendants = useMemo(() => {
    const out = new Set<number>([node.ID])
    let grew = true
    while (grew) {
      grew = false
      for (const f of flat) if (f.node.FATHER_ID != null && out.has(Number(f.node.FATHER_ID)) && !out.has(f.node.ID)) { out.add(f.node.ID); grew = true }
    }
    return out
  }, [flat, node.ID])
  const parentChoices = flat.filter(f => !descendants.has(f.node.ID) && flat.some(c => Number(c.node.FATHER_ID) === f.node.ID))

  const set = (patch: Partial<OfferRowEdit>) => setE(p => ({ ...p, ...patch }))
  const setSur = (patch: Partial<SurchargeEdit>) => set({ surcharge: { ...sur, ...patch } })

  async function save() {
    setSaving(true); setErr(null)
    try {
      if (Object.keys(changes).length) await updateOfferStructureNode(offerId, node.ID, changes)
      if (moved) await moveOfferStructureNode(offerId, node.ID, { father_id: father === TOP ? null : Number(father), sort_after_id: '__end__' })
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['offer-structure', offerId] }),
        qc.invalidateQueries({ queryKey: ['offer-detail', offerId] }),
      ])
      void qc.invalidateQueries({ queryKey: ['offers'] })
      onClose()
    } catch (x) {
      setErr((x as Error)?.message || 'Speichern fehlgeschlagen')
      setSaving(false)
    }
  }

  const ro = !canEdit
  return (
    <Modal open onClose={onClose} title={`${node.ABBR ?? ''}${node.NAME ? ` · ${node.NAME}` : ''}`} className="sxm-sheet">
      <div className="qb-form">
        <div className="qb-times">
          <div className="form-group">
            <label htmlFor="oxm-abbr">Kürzel</label>
            <input id="oxm-abbr" value={e.nameShort ?? node.ABBR ?? ''} readOnly={ro} onChange={x => set({ nameShort: x.target.value })} />
          </div>
          <div className="form-group">
            <label htmlFor="oxm-bt">Abrechnung</label>
            <select id="oxm-bt" value={btId} disabled={ro} onChange={x => set({ billingTypeId: x.target.value })}>
              {billingTypes.map(b => <option key={b.ID} value={b.ID}>{b.ABBR}</option>)}
            </select>
          </div>
        </div>
        <div className="form-group">
          <label htmlFor="oxm-name">Bezeichnung</label>
          <input id="oxm-name" value={e.nameLong ?? node.NAME ?? ''} readOnly={ro} onChange={x => set({ nameLong: x.target.value })} />
        </div>
        {!isParent && hourly && !ro && (
          <div className="qb-times">
            <div className="form-group">
              <label htmlFor="oxm-hours">Stunden{node.ROLE_ABBR ? ` (${node.ROLE_ABBR})` : ''}</label>
              <input id="oxm-hours" type="text" inputMode="decimal" value={hours} onChange={x => set({ hours: x.target.value.replace(',', '.') })} />
            </div>
            <div className="form-group">
              <label htmlFor="oxm-rate">Satz €/h</label>
              <AmountInput id="oxm-rate" value={rate} onChange={v => set({ rate: v })} aria-label="Stundensatz" />
            </div>
          </div>
        )}
        <div className="qb-times">
          <div className="form-group">
            <label htmlFor="oxm-fee">Honorar €</label>
            {isParent || hourly || ro ? (
              <p className="sxm-readonly" id="oxm-fee">{fmtEur(base)}<span className="form-field-hint">{isParent ? 'Summe der Unterelemente' : hourly ? 'Stunden × Satz' : ''}</span></p>
            ) : (
              <AmountInput id="oxm-fee" value={e.budget ?? String(node.REVENUE_BASIS ?? node.REVENUE ?? 0)} onChange={v => set({ budget: v })} aria-label="Honorar" />
            )}
          </div>
          <div className="form-group">
            <label htmlFor="oxm-nk">Nebenkosten %</label>
            <input id="oxm-nk" type="text" inputMode="decimal" readOnly={ro}
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
          <label htmlFor="oxm-father">Übergeordnet</label>
          <select id="oxm-father" value={father} disabled={ro} onChange={x => setFather(x.target.value)}>
            <option value={TOP}>— oberste Ebene —</option>
            {parentChoices.map(f => (
              <option key={f.node.ID} value={String(f.node.ID)}>{' '.repeat(f.depth * 2)}{f.node.ABBR} {f.node.NAME}</option>
            ))}
          </select>
        </div>

        <Message type="error" text={err} />
        <DialogFooter secondary={canEdit ? (
          <>
            <button type="button" className="btn-secondary sxm-icon-btn" onClick={onDelete} disabled={isParent}
              aria-label="Element löschen" title={isParent ? 'Erst die Unterelemente löschen' : 'Element löschen'}>
              <Trash2 size={15} strokeWidth={2} aria-hidden="true" />
            </button>
            <button type="button" className="btn-secondary sxm-icon-btn" onClick={onAdd} aria-label="Unterelement anlegen" title="Unterelement anlegen">
              <Plus size={15} strokeWidth={2} aria-hidden="true" />
            </button>
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
