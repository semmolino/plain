import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Pencil, Plus, Trash2 } from 'lucide-react'
import { DialogFooter } from '@/components/ui/DialogFooter'
import { FormSection } from '@/components/ui/FormSection'
import { Message } from '@/components/ui/Message'
import { Modal } from '@/components/ui/Modal'
import { useConfirm } from '@/hooks/useConfirm'
import { useCtrlS } from '@/hooks/useCtrlS'
import { usePermission } from '@/store/permissionsStore'
import { useToast } from '@/store/toastStore'
import { fetchRollen, createRolle, updateRolle, deleteRolle, type Rolle } from '@/api/stammdaten'
import { fmtEur, NO_VALUE } from '@/utils/money'

/**
 * Projektrollen mit Standard-Stundensatz (UI-Pilot Runde 12).
 *
 * Vorher eine 12-px-Tabelle, die beim Bearbeiten in der Zeile zu drei
 * Eingaben mit „✓" und „✗" wurde; der Satz stand als „95 €/h" (ohne
 * Nachkommastellen, ohne Tausenderpunkt), und `type="number"` nahm „95,50"
 * nicht an. Gelöscht wurde per „×" ohne Rückfrage — auch eine Rolle, an der
 * Team-Zuordnungen hängen (der Server lehnt das inzwischen mit 409 ab).
 *
 * Jetzt: Liste plus ein Dialog für Anlegen und Bearbeiten.
 */
export function ProjektrollenEditor() {
  const qc = useQueryClient()
  const toast = useToast()
  const canEdit = usePermission('settings.basedata.edit')
  const [confirm, confirmDialog] = useConfirm()
  const [dialog, setDialog] = useState<{ role: Rolle | null } | null>(null)
  const [err, setErr] = useState<string | null>(null)

  const { data, isLoading, isError } = useQuery({ queryKey: ['rollen'], queryFn: fetchRollen })
  const rows = [...(data?.data ?? [])].sort((a, b) => a.ABBR.localeCompare(b.ABBR, 'de'))

  const deleteMut = useMutation({
    mutationFn: (id: number) => deleteRolle(id),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['rollen'] })
      void qc.invalidateQueries({ queryKey: ['active-roles'] })
      toast.success('Rolle gelöscht.')
    },
    onError: (e: Error) => setErr(e.message),
  })

  async function askDelete(r: Rolle) {
    setErr(null)
    const ok = await confirm({
      title: 'Rolle löschen?',
      message: `„${r.ABBR}${r.NAME ? ` – ${r.NAME}` : ''}“ wird gelöscht. Hängt sie noch an einer Team-Zuordnung oder Buchung, bleibt sie stehen, und Sie sehen, wo.`,
      confirmLabel: 'Löschen',
    })
    if (ok) deleteMut.mutate(r.ID)
  }

  return (
    <FormSection
      title="Projektrollen" help="settings.projektrollen" layout="block" className="st-section"
      hint="Rollen im Projektteam mit ihrem Standard-Stundensatz für den Verkauf."
      actions={canEdit ? (
        <button type="button" className="btn-primary st-btn" onClick={() => { setErr(null); setDialog({ role: null }) }}>
          <Plus size={14} strokeWidth={2} aria-hidden="true" />Neue Rolle
        </button>
      ) : undefined}
    >
      <Message type="error" text={err} />
      {isLoading ? <p className="empty-note">Lädt …</p>
        : isError ? <Message type="error" text="Die Projektrollen konnten nicht geladen werden." />
        : rows.length === 0 ? (
          <p className="st-empty">
            {canEdit ? 'Noch keine Rollen. Legen Sie z. B. „PL – Projektleitung“ mit ihrem Stundensatz an — er wird dann bei Team-Zuordnung und Aufwandskalkulation vorgeschlagen.'
              : 'Noch keine Rollen.'}
          </p>
        ) : (
          <div className="table-scroll st-table-wrap">
            <table className="master-table st-table">
              <thead>
                <tr>
                  <th scope="col">Rolle</th>
                  <th scope="col" className="num">Stundensatz</th>
                  {canEdit && <th scope="col"><span className="sr-only">Aktionen</span></th>}
                </tr>
              </thead>
              <tbody>
                {rows.map(r => (
                  <tr key={r.ID}>
                    <th scope="row">
                      <span className="st-role-abbr">{r.ABBR}</span>
                      {r.NAME && <span className="st-role-name">{r.NAME}</span>}
                    </th>
                    <td className="num">{r.HOURLY_RATE != null ? `${fmtEur(r.HOURLY_RATE)}/h` : NO_VALUE}</td>
                    {canEdit && (
                      <td className="st-row-actions-cell">
                        <span className="st-row-actions">
                          <button type="button" className="row-action-btn" onClick={() => { setErr(null); setDialog({ role: r }) }}
                            aria-label={`Rolle ${r.ABBR} bearbeiten`} title="Bearbeiten">
                            <Pencil size={14} strokeWidth={1.75} aria-hidden="true" />
                          </button>
                          <button type="button" className="row-action-btn row-action-btn--danger" onClick={() => void askDelete(r)}
                            disabled={deleteMut.isPending} aria-label={`Rolle ${r.ABBR} löschen`} title="Löschen">
                            <Trash2 size={14} strokeWidth={1.75} aria-hidden="true" />
                          </button>
                        </span>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      {!canEdit && <p className="ws-form-readonly">Nur Lesen — zum Ändern fehlt das Recht „Stammdaten bearbeiten“.</p>}
      {dialog && <RolleDialog role={dialog.role} taken={rows} onClose={() => setDialog(null)} />}
      {confirmDialog}
    </FormSection>
  )
}

interface RolleForm { abbr: string; name: string; rate: string }
const rateText = (n: number | null) => (n == null ? '' : String(n).replace('.', ','))

function RolleDialog({ role, taken, onClose }: { role: Rolle | null; taken: Rolle[]; onClose: () => void }) {
  const qc = useQueryClient()
  const toast = useToast()
  const [confirm, confirmDialog] = useConfirm()
  const initial: RolleForm = { abbr: role?.ABBR ?? '', name: role?.NAME ?? '', rate: rateText(role?.HOURLY_RATE ?? null) }
  const [f, setF] = useState<RolleForm>(initial)
  const [tried, setTried] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const dirty = f.abbr !== initial.abbr || f.name !== initial.name || f.rate !== initial.rate

  const abbr = f.abbr.trim()
  const rateRaw = f.rate.trim().replace(',', '.')
  const rateBad = rateRaw !== '' && !/^\d+(\.\d{1,2})?$/.test(rateRaw)
  const duplicate = !!abbr && taken.some(r => r.ID !== role?.ID && r.ABBR.trim().toLocaleLowerCase('de') === abbr.toLocaleLowerCase('de'))

  const saveMut = useMutation({
    mutationFn: async () => {
      if (role) await updateRolle(role.ID, { abbr, name: f.name.trim(), hourly_rate: f.rate.trim() })
      else await createRolle(abbr, f.name.trim(), f.rate.trim())
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['rollen'] })
      void qc.invalidateQueries({ queryKey: ['active-roles'] })
      toast.success(role ? `Rolle ${abbr} gespeichert.` : `Rolle ${abbr} angelegt.`)
      onClose()
    },
    onError: (e: Error) => setErr(e.message),
  })

  function save() {
    if (saveMut.isPending) return
    setTried(true)
    if (!abbr)     { setErr('Bitte ein Kürzel angeben.'); return }
    if (duplicate) { setErr(`Die Rolle „${abbr}“ gibt es schon.`); return }
    if (rateBad)   { setErr('Stundensatz: bitte einen Betrag wie 95,50.'); return }
    setErr(null)
    saveMut.mutate()
  }

  async function requestClose() {
    if (saveMut.isPending) return
    if (dirty && !(await confirm({ title: 'Eingaben verwerfen?', message: role ? 'Die Rolle bleibt, wie sie war.' : 'Es wird keine Rolle angelegt.', confirmLabel: 'Verwerfen' }))) return
    onClose()
  }

  useCtrlS(save, true)
  const set = (k: keyof RolleForm, v: string) => { setF(x => ({ ...x, [k]: v })); setErr(null) }

  return (
    <>
      <Modal open onClose={() => void requestClose()} title={role ? `Rolle ${role.ABBR} bearbeiten` : 'Neue Rolle'}>
        <div className="st-dialog">
          <div className="form-row">
            <div className="form-group st-field-abbr">
              <label htmlFor="rl-abbr">Kürzel*</label>
              <input id="rl-abbr" type="text" value={f.abbr} maxLength={20} placeholder="z. B. PL" autoComplete="off"
                aria-invalid={tried && (!abbr || duplicate) ? true : undefined} onChange={e => set('abbr', e.target.value)} />
            </div>
            <div className="form-group">
              <label htmlFor="rl-name">Bezeichnung</label>
              <input id="rl-name" type="text" value={f.name} maxLength={100} placeholder="z. B. Projektleitung" autoComplete="off"
                onChange={e => set('name', e.target.value)} />
            </div>
          </div>
          <div className="form-group st-field-rate">
            <label htmlFor="rl-rate">Stundensatz (€/h)</label>
            <input id="rl-rate" type="text" inputMode="decimal" value={f.rate} placeholder="z. B. 95,50" autoComplete="off"
              aria-invalid={tried && rateBad ? true : undefined} aria-describedby="rl-rate-hint" onChange={e => set('rate', e.target.value)} />
            <p id="rl-rate-hint" className="form-field-hint">
              Wird bei Team-Zuordnung und Aufwandskalkulation vorgeschlagen. Bestehende Zuordnungen behalten ihren Satz.
            </p>
          </div>
          <Message type="error" text={err} />
        </div>
        <DialogFooter>
          <button type="button" className="btn-secondary" onClick={() => void requestClose()}>Abbrechen</button>
          <button type="button" className="btn-primary" onClick={save} disabled={saveMut.isPending}>
            {saveMut.isPending ? 'Speichert …' : role ? 'Speichern' : 'Anlegen'}
          </button>
        </DialogFooter>
      </Modal>
      {confirmDialog}
    </>
  )
}
