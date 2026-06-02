import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { ConfirmModal } from '@/components/ui/ConfirmModal'
import { Modal }        from '@/components/ui/Modal'
import { fetchFeeCalcMasters, openHonorarPdf, deleteFeeCalcMaster } from '@/api/fee'
import { HonorarWizard } from '@/pages/projekte/HonorarWizard'

const FMT_EUR = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2, maximumFractionDigits: 2 })

interface Props {
  initialOfferId?: number
}

export function AngeboteHoai({ initialOfferId }: Props) {
  const qc = useQueryClient()
  const oid = initialOfferId ?? null
  const [showAdd,    setShowAdd]    = useState(false)
  const [editCalcId, setEditCalcId] = useState<number | null>(null)
  const [confirmState, setConfirmState] = useState<{ title: string; message: string; onConfirm: () => void } | null>(null)

  const { data: feeCalcData, refetch } = useQuery({
    queryKey: ['fee-calc-masters-offer', oid],
    queryFn:  () => fetchFeeCalcMasters({ offer_id: oid! }),
    enabled:  oid !== null,
  })

  const deleteMut = useMutation({
    mutationFn: (calcId: number) => deleteFeeCalcMaster(calcId),
    onSuccess:  () => void refetch(),
  })

  const feeCalcs = feeCalcData?.data ?? []

  if (!oid) {
    return <p className="ls-empty" style={{ marginTop: 24 }}>Kein Angebot ausgewählt.</p>
  }

  return (
    <div className="ls-wrap">
      <div style={{ marginBottom: 12 }}>
        <button className="btn-small btn-save" onClick={() => setShowAdd(true)}>+ HOAI-Kalkulation hinzufügen</button>
      </div>

      {feeCalcs.length === 0 && (
        <p className="ls-empty">Noch keine HOAI-Kalkulationen vorhanden.</p>
      )}

      {feeCalcs.length > 0 && (
        <div className="table-scroll">
          <table className="ls-table">
            <thead>
              <tr>
                <th className="ls-th">§</th>
                <th className="ls-th">Bezeichnung</th>
                <th className="ls-th ls-col-num">Grundhonorar</th>
                <th className="ls-th ls-col-num">Gesamthonorar</th>
                <th className="ls-th"></th>
              </tr>
            </thead>
            <tbody>
              {feeCalcs.map(c => (
                <tr key={c.ID} className="ls-row">
                  <td className="ls-td">{c.NAME_SHORT || '—'}</td>
                  <td className="ls-td">{c.NAME_LONG  || '—'}</td>
                  <td className="ls-td ls-right">
                    {c.grundhonorar != null ? FMT_EUR.format(c.grundhonorar) : '—'}
                  </td>
                  <td className="ls-td ls-right" style={{ fontWeight: 600 }}>
                    {c.gesamthonorar != null ? FMT_EUR.format(c.gesamthonorar) : '—'}
                  </td>
                  <td className="ls-td doc-actions">
                    <button className="btn-small" onClick={() => setEditCalcId(c.ID)}>Bearbeiten</button>
                    <button className="btn-small" onClick={() => openHonorarPdf(c.ID)}>PDF</button>
                    <button className="btn-small btn-danger" disabled={deleteMut.isPending}
                      onClick={() => setConfirmState({
                        title: 'Kalkulation löschen',
                        message: `HOAI-Kalkulation „${c.NAME_SHORT || c.NAME_LONG || 'Kalkulation'}" löschen?`,
                        onConfirm: () => deleteMut.mutate(c.ID),
                      })}>×</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal open={showAdd} onClose={() => setShowAdd(false)} title="HOAI-Kalkulation hinzufügen" className="modal-xl">
        <HonorarWizard offerId={oid} onDone={() => { setShowAdd(false); void refetch() }} />
      </Modal>

      {editCalcId !== null && (
        <Modal open={true} onClose={() => setEditCalcId(null)} title="HOAI-Kalkulation bearbeiten" className="modal-xl">
          <HonorarWizard existingId={editCalcId} offerId={oid} onDone={() => { setEditCalcId(null); void refetch() }} />
        </Modal>
      )}

      <ConfirmModal
        open={confirmState !== null}
        title={confirmState?.title ?? ''}
        message={confirmState?.message ?? ''}
        confirmLabel="Löschen"
        confirmClass="danger"
        onConfirm={() => { confirmState?.onConfirm(); setConfirmState(null) }}
        onCancel={() => setConfirmState(null)}
      />
    </div>
  )
}
