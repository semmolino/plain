import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Pencil, Trash2, Plus, Check } from 'lucide-react'
import { Modal }        from '@/components/ui/Modal'
import { Message }      from '@/components/ui/Message'
import { FormField }    from '@/components/ui/FormField'
import { ConfirmModal } from '@/components/ui/ConfirmModal'
import { Can }          from '@/components/ui/Can'
import { useToast }     from '@/store/toastStore'
import {
  fetchAbsenceTypes, createAbsenceType, updateAbsenceType, deleteAbsenceType,
  type AbsenceType, type AbsenceTypePayload,
} from '@/api/abwesenheit'

interface FormState {
  name:              string
  color:             string
  counts_as_worked:  boolean
  reduces_vacation:  boolean
  requires_approval: boolean
  is_paid:           boolean
  active:            boolean
}

function emptyForm(): FormState {
  return { name: '', color: '#2563eb', counts_as_worked: true, reduces_vacation: false, requires_approval: true, is_paid: true, active: true }
}
function toForm(t: AbsenceType): FormState {
  return {
    name: t.NAME, color: t.COLOR ?? '#2563eb',
    counts_as_worked: t.COUNTS_AS_WORKED, reduces_vacation: t.REDUCES_VACATION,
    requires_approval: t.REQUIRES_APPROVAL, is_paid: t.IS_PAID, active: t.ACTIVE !== 0,
  }
}

const Flag = ({ on }: { on: boolean }) =>
  on ? <Check size={14} strokeWidth={2.5} color="#059669" /> : <span style={{ color: '#d1d5db' }}>—</span>

export function AbwesenheitsartenSection() {
  const qc = useQueryClient()
  const toast = useToast()
  const [editId, setEditId] = useState<number | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [confirmState, setConfirmState] = useState<{ id: number; label: string } | null>(null)

  const { data, isLoading } = useQuery({ queryKey: ['absence-types'], queryFn: fetchAbsenceTypes })
  const rows = data?.data ?? []

  const delMut = useMutation({
    mutationFn: deleteAbsenceType,
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: ['absence-types'] })
      toast.success(r?.deactivated ? 'Art deaktiviert (noch in Verwendung)' : 'Abwesenheitsart gelöscht')
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const editing = editId != null ? rows.find(r => r.ID === editId) ?? null : null

  return (
    <div className="admin-block">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
        <h3 className="admin-block-title" style={{ margin: 0 }}>Abwesenheitsarten</h3>
        <Can permission="absence.manage">
          <button className="btn-small" onClick={() => setCreateOpen(true)} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <Plus size={13} strokeWidth={2} /> Neue Art
          </button>
        </Can>
      </div>
      <p style={{ fontSize: 12, color: '#6b7280', margin: '4px 0 0' }}>
        Arten für Urlaub, Krankheit &amp; Co. „Zählt als gearbeitet" schreibt das Tages-Soll im Zeitkonto gut,
        „zehrt vom Urlaub" bucht auf den Urlaubsanspruch, „freigabepflichtig" erfordert eine Genehmigung.
      </p>

      {isLoading && <p style={{ fontSize: 12, color: '#6b7280', marginTop: 8 }}>Laden …</p>}

      {!isLoading && rows.length === 0 && (
        <p style={{ fontSize: 12, color: '#6b7280', marginTop: 8 }}>
          Noch keine Abwesenheitsarten. Mit „Neue Art" z. B. „Urlaub" oder „Krankheit" anlegen.
        </p>
      )}

      {rows.length > 0 && (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, margin: '10px 0' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid #e5e7eb', color: '#6b7280' }}>
              <th style={{ textAlign: 'left', padding: '2px 6px 4px 0' }}>Art</th>
              <th style={{ textAlign: 'center', padding: '2px 6px 4px 0' }} title="Schreibt das Tages-Soll im Zeitkonto gut">Zählt als gearbeitet</th>
              <th style={{ textAlign: 'center', padding: '2px 6px 4px 0' }} title="Reduziert den Urlaubsanspruch">Zehrt vom Urlaub</th>
              <th style={{ textAlign: 'center', padding: '2px 6px 4px 0' }} title="Antrag muss genehmigt werden">Freigabepflichtig</th>
              <th style={{ textAlign: 'center', padding: '2px 6px 4px 0' }}>Bezahlt</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map(t => (
              <tr key={t.ID} style={{ borderBottom: '1px solid #f3f4f6', opacity: t.ACTIVE === 0 ? 0.5 : 1 }}>
                <td style={{ padding: '4px 6px 4px 0', fontWeight: 600 }}>
                  <span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: '50%', background: t.COLOR || '#9ca3af', marginRight: 6 }} />
                  {t.NAME}{t.ACTIVE === 0 && <span style={{ fontWeight: 400, color: '#9ca3af' }}> (inaktiv)</span>}
                </td>
                <td style={{ padding: '4px 6px', textAlign: 'center' }}><Flag on={t.COUNTS_AS_WORKED} /></td>
                <td style={{ padding: '4px 6px', textAlign: 'center' }}><Flag on={t.REDUCES_VACATION} /></td>
                <td style={{ padding: '4px 6px', textAlign: 'center' }}><Flag on={t.REQUIRES_APPROVAL} /></td>
                <td style={{ padding: '4px 6px', textAlign: 'center' }}><Flag on={t.IS_PAID} /></td>
                <td style={{ padding: '4px 0', textAlign: 'right', whiteSpace: 'nowrap' }}>
                  <Can permission="absence.manage">
                    <button className="row-action-btn" onClick={() => setEditId(t.ID)} title="Bearbeiten">
                      <Pencil size={13} strokeWidth={2} />
                    </button>
                    <button className="row-action-btn" style={{ color: '#dc2626', borderColor: '#dc2626' }}
                      onClick={() => setConfirmState({ id: t.ID, label: t.NAME })} title="Löschen">
                      <Trash2 size={13} strokeWidth={2} />
                    </button>
                  </Can>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {createOpen && (
        <AbwesenheitsartModal onClose={() => setCreateOpen(false)}
          onSaved={() => { setCreateOpen(false); void qc.invalidateQueries({ queryKey: ['absence-types'] }) }} />
      )}
      {editing && (
        <AbwesenheitsartModal existing={editing} onClose={() => setEditId(null)}
          onSaved={() => { setEditId(null); void qc.invalidateQueries({ queryKey: ['absence-types'] }) }} />
      )}

      <ConfirmModal
        open={confirmState !== null}
        title="Abwesenheitsart löschen"
        message={`Art „${confirmState?.label ?? ''}" löschen? Ist sie noch in Verwendung, wird sie stattdessen deaktiviert.`}
        confirmLabel="Löschen"
        confirmClass="danger"
        onConfirm={() => { if (confirmState) delMut.mutate(confirmState.id); setConfirmState(null) }}
        onCancel={() => setConfirmState(null)}
      />
    </div>
  )
}

function AbwesenheitsartModal({ existing, onClose, onSaved }: { existing?: AbsenceType; onClose: () => void; onSaved: () => void }) {
  const toast = useToast()
  const isCreate = existing == null
  const [form, setForm] = useState<FormState>(existing ? toForm(existing) : emptyForm())
  const [msg, setMsg] = useState<{ text: string; type: 'success' | 'error' } | null>(null)

  const set = <K extends keyof FormState>(k: K) => (v: FormState[K]) => setForm(f => ({ ...f, [k]: v }))

  const saveMut = useMutation({
    mutationFn: async () => {
      const payload: AbsenceTypePayload = {
        name:              form.name.trim(),
        color:             form.color,
        counts_as_worked:  form.counts_as_worked,
        reduces_vacation:  form.reduces_vacation,
        requires_approval: form.requires_approval,
        is_paid:           form.is_paid,
        active:            form.active ? 1 : 0,
      }
      if (isCreate) await createAbsenceType(payload)
      else          await updateAbsenceType(existing!.ID, payload)
    },
    onSuccess: () => { toast.success(isCreate ? 'Art angelegt' : 'Art aktualisiert'); onSaved() },
    onError: (e: Error) => setMsg({ text: e.message, type: 'error' }),
  })

  function handleSave() {
    if (!form.name.trim()) { setMsg({ text: 'Name erforderlich', type: 'error' }); return }
    setMsg(null); saveMut.mutate()
  }

  const check = (k: keyof FormState, label: string, hint: string) => (
    <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer' }} title={hint}>
      <input type="checkbox" checked={form[k] as boolean} onChange={e => set(k)(e.target.checked as FormState[typeof k])} />
      {label}
    </label>
  )

  return (
    <Modal open onClose={onClose} title={isCreate ? 'Neue Abwesenheitsart' : `Art bearbeiten — ${form.name}`}>
      <div className="master-form">
        <div className="form-row">
          <FormField label="Name*" id="at-name" value={form.name} onChange={e => set('name')(e.target.value)} required />
          <div className="form-group" style={{ maxWidth: 90 }}>
            <label>Farbe</label>
            <input type="color" value={form.color} onChange={e => set('color')(e.target.value)} style={{ width: '100%', height: 34, padding: 2, border: '1px solid #d1d5db', borderRadius: 6 }} />
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, margin: '4px 0' }}>
          {check('counts_as_worked',  'Zählt als gearbeitet', 'Schreibt das Tages-Soll im Zeitkonto gut (z. B. Urlaub, Krankheit).')}
          {check('reduces_vacation',  'Zehrt vom Urlaubsanspruch', 'Bucht auf den Jahres-Urlaubsanspruch (nur Urlaub).')}
          {check('requires_approval', 'Freigabepflichtig', 'Antrag muss genehmigt werden, bevor er zählt.')}
          {check('is_paid',           'Bezahlt', 'Bezahlte Abwesenheit.')}
          {check('active',            'Aktiv (zur Auswahl)', 'Nur aktive Arten erscheinen bei der Erfassung.')}
        </div>

        <Message text={msg?.text ?? null} type={msg?.type} />
        <div className="modal-actions">
          <button className="btn-secondary" onClick={onClose}>Abbrechen</button>
          <button className="btn-primary" onClick={handleSave} disabled={saveMut.isPending}>
            {saveMut.isPending ? 'Speichert …' : 'Speichern'}
          </button>
        </div>
      </div>
    </Modal>
  )
}
