import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Modal } from '@/components/ui/Modal'
import { DialogFooter } from '@/components/ui/DialogFooter'
import { Message } from '@/components/ui/Message'
import { AmountInput } from '@/components/ui/AmountInput'
import { HelpHint } from '@/components/ui/HelpHint'
import { patchStructurePlan, type StructureNode } from '@/api/projekte'
import { fmtEur } from '@/utils/money'

/**
 * Plan eines Elements nach Aufwand (Runde 5): angebotene Stunden und
 * angebotenes Honorar. Kommt beim Beauftragen aus den Aufwandszeilen des
 * Angebots und laesst sich hier setzen, aendern oder entfernen. Wirkt sofort
 * (wie Anlegen und Loeschen), nicht ueber den Puffer der Tabelle — der Plan
 * ist kein Feld der Zeile, sondern das Budget, gegen das gebucht wird.
 */
export function PlanDialog({ node, projectId, onClose }: {
  node:      StructureNode
  projectId: number
  onClose:   () => void
}) {
  const qc = useQueryClient()
  const [hours,   setHours]   = useState(node.PLAN_HOURS != null ? String(node.PLAN_HOURS) : '')
  const [revenue, setRevenue] = useState(node.PLAN_REVENUE != null ? String(node.PLAN_REVENUE) : '')
  const [error,   setError]   = useState<string | null>(null)
  const hasPlan = node.PLAN_REVENUE != null || node.PLAN_HOURS != null

  const mut = useMutation({
    mutationFn: (body: { plan_hours: number | null; plan_revenue: number | null }) => patchStructurePlan(node.STRUCTURE_ID, body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['structure', projectId] })
      void qc.invalidateQueries({ queryKey: ['budget-overview', projectId] })
      onClose()
    },
    onError: (e: Error) => setError(e.message),
  })

  const toNum = (v: string) => v.trim() === '' ? null : Number(v.replace(',', '.'))
  function save() {
    const h = toNum(hours), r = toNum(revenue)
    if ((h != null && (!Number.isFinite(h) || h < 0)) || (r != null && (!Number.isFinite(r) || r < 0))) {
      setError('Bitte Zahlen ab 0 eingeben.')
      return
    }
    mut.mutate({ plan_hours: h, plan_revenue: r })
  }

  return (
    <Modal open onClose={onClose} title={`Plan ${node.ABBR ?? ''}`}>
      <form onSubmit={e => { e.preventDefault(); save() }}>
        <p className="guard-text">
          Was für „{node.ABBR}{node.NAME ? ` · ${node.NAME}` : ''}" angeboten war. Gebucht bisher:{' '}
          <strong>{fmtEur(node.TEC_SP_TOT_SUM ?? 0)}</strong>. <HelpHint id="projects.structure.plan" size={13} />
        </p>
        <div className="qb-times">
          <div className="form-group">
            <label htmlFor="plan-hours">Stunden</label>
            <input id="plan-hours" type="text" inputMode="decimal" autoFocus value={hours} placeholder="—"
              onChange={e => setHours(e.target.value.replace(',', '.'))} />
          </div>
          <div className="form-group">
            <label htmlFor="plan-revenue">Honorar €</label>
            <AmountInput id="plan-revenue" value={revenue} placeholder="—" onChange={setRevenue} />
          </div>
        </div>
        <Message text={error} type="error" />
        <DialogFooter secondary={hasPlan ? (
          <button type="button" className="btn-secondary" disabled={mut.isPending}
            onClick={() => mut.mutate({ plan_hours: null, plan_revenue: null })}>Plan entfernen</button>
        ) : undefined}>
          <button type="button" className="btn-secondary" onClick={onClose} disabled={mut.isPending}>Abbrechen</button>
          <button type="button" className="btn-primary" onClick={save} disabled={mut.isPending}>
            {mut.isPending ? 'Speichert …' : 'Plan speichern'}
          </button>
        </DialogFooter>
      </form>
    </Modal>
  )
}
