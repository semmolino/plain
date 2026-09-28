import { useState } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import { Plus } from 'lucide-react'
import { ConfirmModal } from '@/components/ui/ConfirmModal'
import { Message }      from '@/components/ui/Message'
import { Modal }        from '@/components/ui/Modal'
import { useGuardedAction } from '@/hooks/useDirtyGuard'
import { usePermission } from '@/store/permissionsStore'
import { fetchFeeCalcMasters, deleteFeeCalcMaster } from '@/api/fee'
import { HonorarWizard, HONORAR_WIZARD_GUARD } from '@/pages/projekte/HonorarWizard'
import { KalkulationActions } from '@/pages/projekte/KalkulationActions'
import { money } from '@/utils/money'


interface Props {
  initialOfferId?: number
}

export function AngeboteHoai({ initialOfferId }: Props) {
  const oid = initialOfferId ?? null
  const guarded   = useGuardedAction()
  const canEdit   = usePermission('projects.calculations.edit')
  const canDelete = usePermission('projects.calculations.delete')
  const [showAdd,    setShowAdd]    = useState(false)
  const [editCalcId, setEditCalcId] = useState<number | null>(null)
  const [confirmState, setConfirmState] = useState<{ title: string; message: string; onConfirm: () => void } | null>(null)

  const { data: feeCalcData, isLoading, refetch } = useQuery({
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

  // Schliessen (Escape, X, Hintergrund) fragt wie jeder andere Wechsel nach,
  // solange der Assistent etwas Offenes hat — vorher war die Eingabe weg.
  const closeAdd  = () => guarded(() => setShowAdd(false), [HONORAR_WIZARD_GUARD])
  const closeEdit = () => guarded(() => setEditCalcId(null), [HONORAR_WIZARD_GUARD])

  return (
    <div className="ls-wrap">
      {feeCalcs.length > 0 && canEdit && (
        <div className="list-toolbar">
          <button className="btn-primary btn-small hw-new" type="button" style={{ marginLeft: 'auto' }} onClick={() => setShowAdd(true)}>
            <Plus size={15} strokeWidth={2.25} aria-hidden="true" /> Neue Kalkulation
          </button>
        </div>
      )}

      {msg && <div style={{ marginBottom: 10 }}><Message text={msg.text} type={msg.type} /></div>}

      {isLoading && <p className="empty-note">Lade …</p>}
      {!isLoading && feeCalcs.length === 0 && (
        <div className="empty-block">
          <p className="empty-note">Noch keine Kalkulation für dieses Angebot.</p>
          <p className="empty-block-why">
            Eine Kalkulation rechnet das Honorar nach HOAI oder AHO — aus Honorarzone, anrechenbaren Kosten und
            beauftragten Leistungsphasen — und legt die Leistungsphasen als Elemente der Angebotsstruktur an.
            Beim Beauftragen gehen sie mit ins Projekt.
          </p>
          {canEdit && (
            <button type="button" className="btn-secondary" onClick={() => setShowAdd(true)}>
              <Plus size={15} strokeWidth={2.25} aria-hidden="true" /> Erste Kalkulation anlegen
            </button>
          )}
        </div>
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
                <th scope="col" className="ls-th"><span className="sr-only">Aktionen</span></th>
              </tr>
            </thead>
            <tbody>
              {feeCalcs.map(c => (
                <tr key={c.ID} className="ls-row">
                  <td className="ls-td">{c.ABBR || '—'}</td>
                  <td className="ls-td">{c.NAME  || '—'}</td>
                  <td className="ls-td ls-right">{money(c.grundhonorar)}</td>
                  <td className="ls-td ls-right" style={{ fontWeight: 600 }}>{money(c.gesamthonorar)}</td>
                  <td className="ls-td">
                    <KalkulationActions
                      calc={c} canEdit={canEdit} canDelete={canDelete} deleting={deleteMut.isPending}
                      onEdit={() => setEditCalcId(c.ID)}
                      onDelete={() => setConfirmState({
                        title: 'Kalkulation löschen',
                        message: `Kalkulation „${c.ABBR || c.NAME || 'Kalkulation'}" löschen? Die Elemente, die sie im Angebot angelegt hat, bleiben stehen.`,
                        onConfirm: () => deleteMut.mutate(c.ID),
                      })}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal open={showAdd} onClose={closeAdd} title="Neue Kalkulation" className="modal-xl">
        <HonorarWizard offerId={oid} onDone={() => { setShowAdd(false); void refetch() }} />
      </Modal>

      {editCalcId !== null && (
        <Modal open={true} onClose={closeEdit} title="Kalkulation bearbeiten" className="modal-xl">
          <HonorarWizard existingId={editCalcId} offerId={oid} onDone={() => { setEditCalcId(null); void refetch() }} />
        </Modal>
      )}

      <ConfirmModal
        open={confirmState !== null}
        title={confirmState?.title ?? ''}
        message={confirmState?.message ?? ''}
        confirmLabel="Löschen"
        onConfirm={() => { confirmState?.onConfirm(); setConfirmState(null) }}
        onCancel={() => setConfirmState(null)}
      />
    </div>
  )
}
