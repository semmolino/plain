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
import { fetchBookingTypes, BOOKING_KIND_LABEL, type BookingType } from '@/api/bookingTypes'

function bezugLabel(s: TextSnippet, typeMap: Map<number, BookingType>): string {
  if (s.BOOKING_TYPE_ID) {
    const t = typeMap.get(s.BOOKING_TYPE_ID)
    return t ? `${BOOKING_KIND_LABEL[t.KIND]}: ${t.NAME_SHORT}` : `Buchungsart #${s.BOOKING_TYPE_ID}`
  }
  if (s.KIND === 'WORK') return 'Stunden'
  if (s.KIND) return `Alle ${BOOKING_KIND_LABEL[s.KIND]}`
  return 'Allgemein'
}

export function BuchungstextvorlagenSection() {
  const qc = useQueryClient()
  const toast = useToast()
  const [editRow,   setEditRow]   = useState<TextSnippet | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [delConfirm, setDelConfirm] = useState<{ id: number; label: string } | null>(null)

  const { data, isLoading } = useQuery({ queryKey: ['booking-text-templates-global'], queryFn: fetchGlobalSnippets })
  const rows = data?.data ?? []
  const { data: btData } = useQuery({ queryKey: ['booking-types'], queryFn: () => fetchBookingTypes({ activeOnly: true }) })
  const bookingTypes = btData?.data ?? []
  const typeMap = new Map<number, BookingType>(bookingTypes.map(t => [t.ID, t]))

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
              <th style={{ textAlign: 'left', padding: '2px 6px 4px 0' }}>Bezug</th>
              <th style={{ textAlign: 'left', padding: '2px 6px 4px 0' }}>Text</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.ID} style={{ borderBottom: '1px solid #f3f4f6' }}>
                <td style={{ padding: '4px 6px 4px 0', fontWeight: 600, whiteSpace: 'nowrap' }}>{r.LABEL || '—'}</td>
                <td style={{ padding: '4px 6px 4px 0', color: '#6b7280', whiteSpace: 'nowrap' }}>{bezugLabel(r, typeMap)}</td>
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
        <SnippetModal bookingTypes={bookingTypes} onClose={() => setCreateOpen(false)}
          onSaved={() => { setCreateOpen(false); void qc.invalidateQueries({ queryKey: ['booking-text-templates-global'] }); void qc.invalidateQueries({ queryKey: ['text-snippets'] }) }} />
      )}
      {editRow && (
        <SnippetModal existing={editRow} bookingTypes={bookingTypes} onClose={() => setEditRow(null)}
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

function SnippetModal({ existing, bookingTypes, onClose, onSaved }: { existing?: TextSnippet; bookingTypes: BookingType[]; onClose: () => void; onSaved: () => void }) {
  const toast = useToast()
  const isCreate = existing == null
  const [label, setLabel] = useState(existing?.LABEL ?? '')
  const [text,  setText]  = useState(existing?.TEXT ?? '')
  const [bezug, setBezug] = useState<string>(
    existing?.BOOKING_TYPE_ID ? `type:${existing.BOOKING_TYPE_ID}` : existing?.KIND ? `kind:${existing.KIND}` : ''
  )
  const [msg,   setMsg]   = useState<{ text: string; type: 'success' | 'error' } | null>(null)

  const byKind = (k: string) => bookingTypes.filter(t => t.KIND === k)

  const saveMut = useMutation({
    mutationFn: () => {
      const body = {
        label: label.trim() || null,
        text: text.trim(),
        kind:            bezug.startsWith('kind:') ? bezug.slice(5) as TextSnippet['KIND'] : null,
        booking_type_id: bezug.startsWith('type:') ? Number(bezug.slice(5)) : null,
      }
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
          <label>Bezug</label>
          <select value={bezug} onChange={e => setBezug(e.target.value)}>
            <option value="">Allgemein (überall)</option>
            <option value="kind:WORK">Stundenleistungen</option>
            <optgroup label="Stückleistungen">
              <option value="kind:UNIT">Alle Stückleistungen</option>
              {byKind('UNIT').map(t => <option key={t.ID} value={`type:${t.ID}`}>{t.NAME_SHORT}{t.NAME_LONG ? ` – ${t.NAME_LONG}` : ''}</option>)}
            </optgroup>
            <optgroup label="Pauschalen (Kosten)">
              <option value="kind:LUMP_COST">Alle Pauschalen (Kosten)</option>
              {byKind('LUMP_COST').map(t => <option key={t.ID} value={`type:${t.ID}`}>{t.NAME_SHORT}{t.NAME_LONG ? ` – ${t.NAME_LONG}` : ''}</option>)}
            </optgroup>
            <optgroup label="Pauschalen (Erlös)">
              <option value="kind:LUMP_REVENUE">Alle Pauschalen (Erlös)</option>
              {byKind('LUMP_REVENUE').map(t => <option key={t.ID} value={`type:${t.ID}`}>{t.NAME_SHORT}{t.NAME_LONG ? ` – ${t.NAME_LONG}` : ''}</option>)}
            </optgroup>
          </select>
          <span style={{ fontSize: 11, color: '#6b7280', display: 'block', marginTop: 2 }}>
            Bestimmt, bei welcher Buchungsart dieser Baustein vorgeschlagen wird.
          </span>
        </div>
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
