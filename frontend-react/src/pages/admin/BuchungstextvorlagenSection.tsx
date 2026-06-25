import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Pencil, Trash2, Plus } from 'lucide-react'
import { Modal }        from '@/components/ui/Modal'
import { Message }      from '@/components/ui/Message'
import { FormField }    from '@/components/ui/FormField'
import { HelpHint }     from '@/components/ui/HelpHint'
import { ConfirmModal } from '@/components/ui/ConfirmModal'
import { Can }          from '@/components/ui/Can'
import { useToast }     from '@/store/toastStore'
import {
  fetchGlobalSnippets, createGlobalSnippet, updateGlobalSnippet, deleteGlobalSnippet,
  type TextSnippet,
} from '@/api/textSnippets'

export function BuchungstextvorlagenSection() {
  const qc = useQueryClient()
  const toast = useToast()
  const [editRow,   setEditRow]   = useState<TextSnippet | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [delConfirm, setDelConfirm] = useState<{ id: number; label: string } | null>(null)

  const { data, isLoading } = useQuery({ queryKey: ['booking-text-templates-global'], queryFn: fetchGlobalSnippets })
  const rows = data?.data ?? []

  const delMut = useMutation({
    mutationFn: deleteGlobalSnippet,
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['booking-text-templates-global'] }); void qc.invalidateQueries({ queryKey: ['text-snippets'] }); toast.success('Textvorlage gelöscht') },
    onError: (e: Error) => toast.error(e.message),
  })

  return (
    <div className="admin-block">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
        <h3 className="admin-block-title" style={{ display: 'inline-flex', alignItems: 'center', margin: 0 }}>
          Buchungstextvorlagen <HelpHint id="settings.booking_text_templates" />
        </h3>
        <Can permission="settings.booking_text_templates.edit">
          <button className="btn-small" onClick={() => setCreateOpen(true)} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <Plus size={13} strokeWidth={2} /> Neue Textvorlage
          </button>
        </Can>
      </div>
      <p style={{ fontSize: 12, color: '#6b7280', margin: '4px 0 8px' }}>
        Globale Beschreibungstexte, die allen Mitarbeitern beim Buchen als Baustein zur Auswahl stehen.
      </p>

      {isLoading && <p style={{ fontSize: 12, color: '#6b7280' }}>Laden …</p>}
      {!isLoading && rows.length === 0 && (
        <p style={{ fontSize: 12, color: '#6b7280' }}>Noch keine globalen Textvorlagen. Mit „Neue Textvorlage" einen Baustein anlegen.</p>
      )}

      {rows.length > 0 && (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, margin: '8px 0' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid #e5e7eb', color: '#6b7280' }}>
              <th style={{ textAlign: 'left', padding: '2px 6px 4px 0' }}>Kürzel</th>
              <th style={{ textAlign: 'left', padding: '2px 6px 4px 0' }}>Text</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.ID} style={{ borderBottom: '1px solid #f3f4f6' }}>
                <td style={{ padding: '4px 6px 4px 0', fontWeight: 600, whiteSpace: 'nowrap' }}>{r.LABEL || '—'}</td>
                <td style={{ padding: '4px 6px 4px 0', color: '#374151', whiteSpace: 'pre-line' }}>{r.TEXT}</td>
                <td style={{ padding: '4px 0', textAlign: 'right', whiteSpace: 'nowrap' }}>
                  <Can permission="settings.booking_text_templates.edit">
                    <button className="row-action-btn" onClick={() => setEditRow(r)} title="Bearbeiten">
                      <Pencil size={13} strokeWidth={2} />
                    </button>
                    <button className="row-action-btn" style={{ color: '#dc2626', borderColor: '#dc2626' }}
                      onClick={() => setDelConfirm({ id: r.ID, label: r.LABEL || r.TEXT.slice(0, 30) })} title="Löschen">
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
        <SnippetModal onClose={() => setCreateOpen(false)}
          onSaved={() => { setCreateOpen(false); void qc.invalidateQueries({ queryKey: ['booking-text-templates-global'] }); void qc.invalidateQueries({ queryKey: ['text-snippets'] }) }} />
      )}
      {editRow && (
        <SnippetModal existing={editRow} onClose={() => setEditRow(null)}
          onSaved={() => { setEditRow(null); void qc.invalidateQueries({ queryKey: ['booking-text-templates-global'] }); void qc.invalidateQueries({ queryKey: ['text-snippets'] }) }} />
      )}

      <ConfirmModal
        open={delConfirm !== null}
        title="Textvorlage löschen"
        message={`Globale Textvorlage „${delConfirm?.label ?? ''}" löschen?`}
        confirmLabel="Löschen"
        confirmClass="danger"
        onConfirm={() => { if (delConfirm) delMut.mutate(delConfirm.id); setDelConfirm(null) }}
        onCancel={() => setDelConfirm(null)}
      />
    </div>
  )
}

function SnippetModal({ existing, onClose, onSaved }: { existing?: TextSnippet; onClose: () => void; onSaved: () => void }) {
  const toast = useToast()
  const isCreate = existing == null
  const [label, setLabel] = useState(existing?.LABEL ?? '')
  const [text,  setText]  = useState(existing?.TEXT ?? '')
  const [msg,   setMsg]   = useState<{ text: string; type: 'success' | 'error' } | null>(null)

  const saveMut = useMutation({
    mutationFn: () => {
      const body = { label: label.trim() || null, text: text.trim() }
      return isCreate ? createGlobalSnippet(body) : updateGlobalSnippet(existing!.ID, body)
    },
    onSuccess: () => { toast.success(isCreate ? 'Textvorlage angelegt' : 'Textvorlage aktualisiert'); onSaved() },
    onError: (e: Error) => setMsg({ text: e.message, type: 'error' }),
  })

  function handleSave() {
    if (!text.trim()) { setMsg({ text: 'Text erforderlich', type: 'error' }); return }
    setMsg(null); saveMut.mutate()
  }

  return (
    <Modal open onClose={onClose} title={isCreate ? 'Neue Textvorlage' : 'Textvorlage bearbeiten'}>
      <div className="master-form">
        <FormField label="Kürzel (optional)" id="bts-label" value={label} onChange={e => setLabel(e.target.value)} placeholder="kurzer Anzeigename (z. B. Abstimmung)" />
        <div className="form-group">
          <label>Text*</label>
          <textarea rows={3} value={text} onChange={e => setText(e.target.value)} required
            style={{ width: '100%', padding: '10px 12px', border: '1px solid rgba(17,24,39,0.10)', borderRadius: 12, fontSize: 15, outline: 'none' }} />
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
