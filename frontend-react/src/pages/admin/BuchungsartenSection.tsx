import { useMemo, useState } from 'react'
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
  fetchBookingTypes, createBookingType, updateBookingType, deleteBookingType,
  BOOKING_KIND_LABEL, type BookingType, type BookingKind, type BookingTypePayload,
} from '@/api/bookingTypes'
import {
  fetchGlobalSnippets, createGlobalSnippet, deleteGlobalSnippet, type TextSnippet,
} from '@/api/textSnippets'

const FMT_EUR = new Intl.NumberFormat('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const fmtEur = (v: number | null) => v == null ? '—' : FMT_EUR.format(v) + ' €'

const KINDS: BookingKind[] = ['UNIT', 'LUMP_COST', 'LUMP_REVENUE']

interface FormState {
  kind:            BookingKind
  name_short:      string
  name_long:       string
  unit_label:      string
  unit_code:       string
  default_sp_rate: string
  default_cp_rate: string
  active:          boolean
}

function emptyForm(): FormState {
  return { kind: 'UNIT', name_short: '', name_long: '', unit_label: '', unit_code: '', default_sp_rate: '', default_cp_rate: '', active: true }
}

function toForm(t: BookingType): FormState {
  return {
    kind:            t.KIND,
    name_short:      t.NAME_SHORT,
    name_long:       t.NAME_LONG ?? '',
    unit_label:      t.UNIT_LABEL ?? '',
    unit_code:       t.UNIT_CODE ?? '',
    default_sp_rate: t.DEFAULT_SP_RATE != null ? String(t.DEFAULT_SP_RATE) : '',
    default_cp_rate: t.DEFAULT_CP_RATE != null ? String(t.DEFAULT_CP_RATE) : '',
    active:          t.ACTIVE !== 0,
  }
}

export function BuchungsartenSection() {
  const qc = useQueryClient()
  const toast = useToast()
  const [editId, setEditId] = useState<number | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [confirmState, setConfirmState] = useState<{ id: number; label: string } | null>(null)

  const { data, isLoading } = useQuery({ queryKey: ['booking-types'], queryFn: () => fetchBookingTypes() })
  const all = data?.data ?? []
  // Stammdaten verwaltet die globalen Buchungsarten; projektbezogene werden im Projekt gepflegt.
  const rows = useMemo(() => all.filter(t => t.SCOPE === 'global'), [all])

  const delMut = useMutation({
    mutationFn: deleteBookingType,
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['booking-types'] }); toast.success('Buchungsart gelöscht') },
    onError: (e: Error) => toast.error(e.message),
  })

  const editing = editId != null ? rows.find(r => r.ID === editId) ?? null : null

  return (
    <div className="admin-block">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
        <h3 className="admin-block-title" style={{ display: 'inline-flex', alignItems: 'center', margin: 0 }}>
          Buchungsarten (Pauschalen & Stückleistungen) <HelpHint id="settings.booking_types" />
        </h3>
        <Can permission="settings.booking_types.edit">
          <button className="btn-small" onClick={() => setCreateOpen(true)} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <Plus size={13} strokeWidth={2} /> Neue Buchungsart
          </button>
        </Can>
      </div>

      {isLoading && <p style={{ fontSize: 12, color: '#6b7280', marginTop: 8 }}>Laden …</p>}

      {!isLoading && rows.length === 0 && (
        <p style={{ fontSize: 12, color: '#6b7280', marginTop: 8 }}>
          Noch keine Buchungsarten angelegt. Mit „Neue Buchungsart" eine Pauschale oder Stückleistung mit Standardpreis definieren.
        </p>
      )}

      {rows.length > 0 && (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, margin: '10px 0' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid #e5e7eb', color: '#6b7280' }}>
              <th style={{ textAlign: 'left', padding: '2px 6px 4px 0' }}>Art</th>
              <th style={{ textAlign: 'left', padding: '2px 6px 4px 0' }}>Kürzel</th>
              <th style={{ textAlign: 'left', padding: '2px 6px 4px 0' }}>Bezeichnung</th>
              <th style={{ textAlign: 'left', padding: '2px 6px 4px 0' }}>Einheit</th>
              <th style={{ textAlign: 'right', padding: '2px 6px 4px 0' }}>Std. Verkauf</th>
              <th style={{ textAlign: 'right', padding: '2px 6px 4px 0' }}>Std. Kosten</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map(t => (
              <tr key={t.ID} style={{ borderBottom: '1px solid #f3f4f6', opacity: t.ACTIVE === 0 ? 0.5 : 1 }}>
                <td style={{ padding: '4px 6px 4px 0' }}>{BOOKING_KIND_LABEL[t.KIND]}</td>
                <td style={{ padding: '4px 6px 4px 0', fontWeight: 600 }}>{t.NAME_SHORT}</td>
                <td style={{ padding: '4px 6px 4px 0', color: '#6b7280' }}>{t.NAME_LONG || '—'}</td>
                <td style={{ padding: '4px 6px 4px 0' }}>{t.KIND === 'UNIT' ? (t.UNIT_LABEL || '—') : '—'}</td>
                <td style={{ padding: '4px 6px 4px 0', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fmtEur(t.DEFAULT_SP_RATE)}</td>
                <td style={{ padding: '4px 6px 4px 0', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fmtEur(t.DEFAULT_CP_RATE)}</td>
                <td style={{ padding: '4px 0', textAlign: 'right', whiteSpace: 'nowrap' }}>
                  <Can permission="settings.booking_types.edit">
                    <button className="row-action-btn" onClick={() => setEditId(t.ID)} title="Bearbeiten">
                      <Pencil size={13} strokeWidth={2} />
                    </button>
                    <button className="row-action-btn" style={{ color: '#dc2626', borderColor: '#dc2626' }}
                      onClick={() => setConfirmState({ id: t.ID, label: t.NAME_SHORT })} title="Löschen">
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
        <BuchungsartModal onClose={() => setCreateOpen(false)}
          onSaved={() => { setCreateOpen(false); void qc.invalidateQueries({ queryKey: ['booking-types'] }) }} />
      )}
      {editing && (
        <BuchungsartModal existing={editing} onClose={() => setEditId(null)}
          onSaved={() => { setEditId(null); void qc.invalidateQueries({ queryKey: ['booking-types'] }) }} />
      )}

      <ConfirmModal
        open={confirmState !== null}
        title="Buchungsart löschen"
        message={`Buchungsart „${confirmState?.label ?? ''}" löschen? Bereits erfasste Buchungen bleiben unverändert erhalten.`}
        confirmLabel="Löschen"
        confirmClass="danger"
        onConfirm={() => { if (confirmState) delMut.mutate(confirmState.id); setConfirmState(null) }}
        onCancel={() => setConfirmState(null)}
      />
    </div>
  )
}

function BuchungsartModal({ existing, onClose, onSaved }: { existing?: BookingType; onClose: () => void; onSaved: () => void }) {
  const toast = useToast()
  const isCreate = existing == null
  const [form, setForm] = useState<FormState>(existing ? toForm(existing) : emptyForm())
  const [msg, setMsg] = useState<{ text: string; type: 'success' | 'error' } | null>(null)

  const isUnit = form.kind === 'UNIT'
  const set = <K extends keyof FormState>(k: K) => (v: FormState[K]) => setForm(f => ({ ...f, [k]: v }))

  const saveMut = useMutation({
    mutationFn: () => {
      const payload: BookingTypePayload = {
        kind:            form.kind,
        name_short:      form.name_short.trim(),
        name_long:       form.name_long.trim() || null,
        scope:           'global',
        active:          form.active ? 1 : 0,
        unit_label:      isUnit ? (form.unit_label.trim() || null) : null,
        unit_code:       isUnit ? (form.unit_code.trim() || null) : null,
        default_sp_rate: form.default_sp_rate !== '' ? Number(form.default_sp_rate) : null,
        default_cp_rate: form.default_cp_rate !== '' ? Number(form.default_cp_rate) : null,
      }
      return isCreate ? createBookingType(payload) : updateBookingType(existing!.ID, payload)
    },
    onSuccess: () => { toast.success(isCreate ? 'Buchungsart angelegt' : 'Buchungsart aktualisiert'); onSaved() },
    onError: (e: Error) => setMsg({ text: e.message, type: 'error' }),
  })

  function handleSave() {
    if (!form.name_short.trim()) { setMsg({ text: 'Kürzel erforderlich', type: 'error' }); return }
    setMsg(null); saveMut.mutate()
  }

  // Betrags-Feld für Pauschalen (Kosten = default_cp_rate, Erlös = default_sp_rate)
  const lumpField = form.kind === 'LUMP_COST' ? 'default_cp_rate' : 'default_sp_rate'

  return (
    <Modal open onClose={onClose} title={isCreate ? 'Neue Buchungsart' : `Buchungsart bearbeiten — ${form.name_short}`}>
      <div className="master-form">
        <div className="form-group">
          <label>Art*</label>
          <select value={form.kind} onChange={e => set('kind')(e.target.value as BookingKind)} disabled={!isCreate}>
            {KINDS.map(k => <option key={k} value={k}>{BOOKING_KIND_LABEL[k]}</option>)}
          </select>
        </div>

        <div className="form-row">
          <FormField label="Kürzel*"      id="bt-short" value={form.name_short} onChange={e => set('name_short')(e.target.value)} required />
          <FormField label="Bezeichnung"  id="bt-long"  value={form.name_long}  onChange={e => set('name_long')(e.target.value)} />
        </div>

        {isUnit ? (
          <>
            <div className="form-row">
              <FormField label="Einheit"        id="bt-unit"  value={form.unit_label} onChange={e => set('unit_label')(e.target.value)} placeholder="z. B. Stk, m²" />
              <FormField label="Einheiten-Code" id="bt-code"  value={form.unit_code}  onChange={e => set('unit_code')(e.target.value)} placeholder="UN/ECE, z. B. C62" />
            </div>
            <div className="form-row">
              <FormField label="Std. Stückpreis (€)" id="bt-sp" type="number" step="0.01" value={form.default_sp_rate} onChange={e => set('default_sp_rate')(e.target.value)} />
              <FormField label="Std. Stückkosten (€)" id="bt-cp" type="number" step="0.01" value={form.default_cp_rate} onChange={e => set('default_cp_rate')(e.target.value)} />
            </div>
          </>
        ) : (
          <div className="form-row">
            <FormField
              label={form.kind === 'LUMP_COST' ? 'Standard-Betrag Kosten (€)' : 'Standard-Betrag Erlös (€)'}
              id="bt-amount" type="number" step="0.01"
              value={lumpField === 'default_cp_rate' ? form.default_cp_rate : form.default_sp_rate}
              onChange={e => set(lumpField)(e.target.value)}
            />
          </div>
        )}

        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer' }}>
          <input type="checkbox" checked={form.active} onChange={e => set('active')(e.target.checked)} />
          Aktiv (zur Auswahl beim Buchen)
        </label>

        {!isCreate && (
          <Can permission="settings.booking_text_templates.edit">
            <TypeTextTemplates typeId={existing!.ID} />
          </Can>
        )}
        {isCreate && (
          <p style={{ fontSize: 11, color: '#6b7280', margin: '4px 0 0' }}>
            Textvorlagen für diese Buchungsart kannst du nach dem Speichern (beim Bearbeiten) hinterlegen.
          </p>
        )}

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

// ── Textvorlagen direkt an einer Buchungsart pflegen ───────────────────────────
function TypeTextTemplates({ typeId }: { typeId: number }) {
  const qc = useQueryClient()
  const [label, setLabel] = useState('')
  const [text,  setText]  = useState('')

  const { data } = useQuery({ queryKey: ['booking-text-templates-global'], queryFn: fetchGlobalSnippets })
  const rows = (data?.data ?? []).filter((s: TextSnippet) => s.BOOKING_TYPE_ID === typeId)

  function invalidate() {
    void qc.invalidateQueries({ queryKey: ['booking-text-templates-global'] })
    void qc.invalidateQueries({ queryKey: ['text-snippets'] })
  }
  const addMut = useMutation({
    mutationFn: () => createGlobalSnippet({ label: label.trim() || null, text: text.trim(), booking_type_id: typeId }),
    onSuccess: () => { invalidate(); setLabel(''); setText('') },
  })
  const delMut = useMutation({ mutationFn: deleteGlobalSnippet, onSuccess: invalidate })

  return (
    <div style={{ marginTop: 8, padding: 10, background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 6 }}>
      <strong style={{ fontSize: 13 }}>Textvorlagen für diese Buchungsart</strong>
      <p style={{ fontSize: 11, color: '#6b7280', margin: '2px 0 8px' }}>
        Erscheinen beim Buchen dieser Buchungsart als Baustein.
      </p>

      {rows.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 8 }}>
          {rows.map(r => (
            <div key={r.ID} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
              {r.LABEL && <span style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>{r.LABEL}:</span>}
              <span style={{ color: '#374151', flex: 1, whiteSpace: 'pre-line' }}>{r.TEXT}</span>
              <button type="button" className="row-action-btn" style={{ color: '#dc2626', borderColor: '#dc2626' }}
                onClick={() => delMut.mutate(r.ID)} title="Löschen">
                <Trash2 size={12} strokeWidth={2.5} />
              </button>
            </div>
          ))}
        </div>
      )}

      <div style={{ display: 'flex', gap: 6, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <input className="tbl-input" style={{ width: 110 }} value={label} onChange={e => setLabel(e.target.value)} placeholder="Kürzel (optional)" />
        <textarea rows={2} value={text} onChange={e => setText(e.target.value)} placeholder="Textbaustein …"
          style={{ flex: 1, minWidth: 180, padding: '6px 8px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 13, outline: 'none' }} />
        <button type="button" className="btn-small btn-save" disabled={!text.trim() || addMut.isPending}
          onClick={() => addMut.mutate()}>
          {addMut.isPending ? '…' : 'Hinzufügen'}
        </button>
      </div>
    </div>
  )
}
