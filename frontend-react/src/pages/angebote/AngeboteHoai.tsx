import { useState } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import { ConfirmModal } from '@/components/ui/ConfirmModal'
import { Message }      from '@/components/ui/Message'
import { Modal }        from '@/components/ui/Modal'
import { fetchFeeCalcMasters, openHonorarPdf, deleteFeeCalcMaster } from '@/api/fee'
import { HonorarWizard } from '@/pages/projekte/HonorarWizard'
import { Pencil, FileText, Trash2 } from 'lucide-react'

const FMT_EUR = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2, maximumFractionDigits: 2 })

interface Props {
  initialOfferId?: number
}

export function AngeboteHoai({ initialOfferId }: Props) {
  const oid = initialOfferId ?? null
  const [showAdd,    setShowAdd]    = useState(false)
  const [editCalcId, setEditCalcId] = useState<number | null>(null)
  const [confirmState, setConfirmState] = useState<{ title: string; message: string; onConfirm: () => void } | null>(null)

  const { data: feeCalcData, refetch } = useQuery({
    queryKey: ['fee-calc-masters-offer', oid],
    queryFn:  () => fetchFeeCalcMasters({ offer_id: oid! }),
    enabled:  oid !== null,
  })

  const [msg, setMsg] = useState<{ text: string; type: 'success' | 'error' } | null>(null)

  const deleteMut = useMutation({
    mutationFn: (calcId: number) => deleteFeeCalcMaster(calcId),
    onSuccess:  () => { setMsg(null); void refetch() },
    // Ohne diesen Zweig blieb ein fehlgeschlagenes Löschen (fehlende
    // Berechtigung, Serverfehler) völlig unsichtbar: die Zeile stand danach
    // einfach weiter da, ohne Hinweis worauf es gescheitert ist.
    onError: (e: unknown) => setMsg({ text: `Löschen fehlgeschlagen: ${(e as Error).message}`, type: 'error' }),
  })

  const feeCalcs = feeCalcData?.data ?? []

  if (!oid) {
    return <p className="ls-empty" style={{ marginTop: 24 }}>Kein Angebot ausgewählt.</p>
  }

  return (
    <div className="ls-wrap">
      <div style={{ marginBottom: 12 }}>
        <button className="btn-small btn-save" onClick={() => setShowAdd(true)}>+ Kalkulation hinzufügen</button>
      </div>

      {msg && <div style={{ marginBottom: 10 }}><Message text={msg.text} type={msg.type} /></div>}

      {feeCalcs.length === 0 && (
        <p className="ls-empty">Noch keine Kalkulationen vorhanden.</p>
      )}

      {feeCalcs.length > 0 && (
        <div className="table-scroll">
          <table className="ls-table">
            <thead>
              <tr>
                <th scope="col" className="ls-th">§</th>
                <th scope="col" className="ls-th">Bezeichnung</th>
                <th scope="col" className="ls-th ls-col-num">Grundhonorar</th>
                <th scope="col" className="ls-th ls-col-num">Gesamthonorar</th>
                <th scope="col" className="ls-th"></th>
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
                    <button className="row-action-btn" onClick={() => setEditCalcId(c.ID)} title="Bearbeiten">
                      <Pencil size={14} strokeWidth={2} />
                    </button>
                    <button className="row-action-btn" onClick={() => openHonorarPdf(c.ID)} title="PDF">
                      <FileText size={14} strokeWidth={1.75} />
                    </button>
                    <button className="row-action-btn row-action-btn--danger" disabled={deleteMut.isPending} title="Löschen"
                      onClick={() => setConfirmState({
                        title: 'Kalkulation löschen',
                        message: `Kalkulation „${c.NAME_SHORT || c.NAME_LONG || 'Kalkulation'}" löschen?`,
                        onConfirm: () => deleteMut.mutate(c.ID),
                      })}>
                      <Trash2 size={14} strokeWidth={2} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal open={showAdd} onClose={() => setShowAdd(false)} title="Kalkulation hinzufügen" className="modal-xl">
        <HonorarWizard offerId={oid} onDone={() => { setShowAdd(false); void refetch() }} />
      </Modal>

      {editCalcId !== null && (
        <Modal open={true} onClose={() => setEditCalcId(null)} title="Kalkulation bearbeiten" className="modal-xl">
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
