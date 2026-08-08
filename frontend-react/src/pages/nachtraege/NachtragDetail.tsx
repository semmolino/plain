import { useState, useMemo, type ReactNode } from 'react'
import { DialogFooter } from '@/components/ui/DialogFooter'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Plus, Trash2, CheckCircle2, FileText } from 'lucide-react'
import { Can } from '@/components/ui/Can'
import { Modal } from '@/components/ui/Modal'
import { Message } from '@/components/ui/Message'
import { ConfirmModal } from '@/components/ui/ConfirmModal'
import { HelpHint } from '@/components/ui/HelpHint'
import { usePermission } from '@/store/permissionsStore'
import {
  fetchNachtrag, updateNachtrag, deleteNachtrag,
  fetchNachtragStatuses, fetchNachtragStructure, addNachtragStructureNode, deleteNachtragStructureNode,
  fetchNachtragReleases, releaseNachtrag, saveNachtragReview, openNachtragPdf,
  CATEGORY_LABELS, RELEASE_KIND_LABELS, RELEASE_BASIS_LABELS, RECOMMENDATION_LABELS,
  type Nachtrag, type NachtragStructureNode, type ReleasePayload, type ReleaseKind, type ReleaseBasis,
  type UpdateNachtragPayload, type ReviewPayload, type ReviewRecommendation,
} from '@/api/nachtraege'

const FMT_EUR = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2, maximumFractionDigits: 2 })
const fmtEur  = (v: number | null | undefined) => v == null ? '—' : FMT_EUR.format(v)
const fmtDate = (v: string | null | undefined) => v ? new Date(v).toLocaleDateString('de-DE') : '—'

const APPROVAL_LABELS: Record<string, string> = { OPEN: 'offen', APPROVED: 'freigegeben', PARTIAL: 'teilw.', REJECTED: 'abgelehnt' }
// Status, die manuell (nicht über die Freigabe) gesetzt werden dürfen
const MANUAL_STATUS = new Set(['DRAFT', 'ANNOUNCED', 'SUBMITTED', 'IN_REVIEW', 'REJECTED', 'WITHDRAWN', 'DISPUTED'])

function depthOf(node: NachtragStructureNode, byId: Map<number, NachtragStructureNode>): number {
  let d = 0, cur: NachtragStructureNode | undefined = node
  while (cur?.FATHER_ID != null && d < 50) { cur = byId.get(cur.FATHER_ID); d++ }
  return d
}

export function NachtragDetail() {
  const { id } = useParams<{ id: string }>()
  const nachtragId = Number(id)
  const qc = useQueryClient()
  const navigate = useNavigate()
  const canReview = usePermission('nachtraege.review')

  const [msg, setMsg]                 = useState<{ text: string; type: 'success' | 'error' } | null>(null)
  const [addOpen, setAddOpen]         = useState(false)
  const [releaseOpen, setReleaseOpen] = useState(false)
  const [confirmDel, setConfirmDel]   = useState<{ kind: 'nachtrag' } | { kind: 'node'; nodeId: number; name: string } | null>(null)

  const { data: nData, isLoading }   = useQuery({ queryKey: ['nachtrag', nachtragId], queryFn: () => fetchNachtrag(nachtragId) })
  const { data: statusData }         = useQuery({ queryKey: ['nachtrag-statuses'], queryFn: fetchNachtragStatuses })
  const { data: structData }         = useQuery({ queryKey: ['nachtrag-structure', nachtragId], queryFn: () => fetchNachtragStructure(nachtragId) })
  const { data: releaseData }        = useQuery({ queryKey: ['nachtrag-releases', nachtragId], queryFn: () => fetchNachtragReleases(nachtragId) })

  const nachtrag  = nData?.data
  const statuses  = statusData?.data ?? []
  const nodes     = useMemo(() => structData?.data ?? [], [structData])
  const releases  = releaseData?.data ?? []

  const curStatus = statuses.find(s => s.ID === nachtrag?.NACHTRAG_STATUS_ID)
  const byId      = useMemo(() => new Map(nodes.map(n => [n.ID, n])), [nodes])
  const withChildren = useMemo(() => new Set(nodes.map(n => n.FATHER_ID).filter(Boolean) as number[]), [nodes])

  const invalidateAll = () => {
    void qc.invalidateQueries({ queryKey: ['nachtrag', nachtragId] })
    void qc.invalidateQueries({ queryKey: ['nachtrag-structure', nachtragId] })
    void qc.invalidateQueries({ queryKey: ['nachtrag-releases', nachtragId] })
    void qc.invalidateQueries({ queryKey: ['nachtraege'] })
  }

  const patchMut = useMutation({
    mutationFn: (body: UpdateNachtragPayload) => updateNachtrag(nachtragId, body),
    onSuccess: () => invalidateAll(),
    onError: (e: Error) => setMsg({ text: e.message, type: 'error' }),
  })
  const delNachtragMut = useMutation({
    mutationFn: () => deleteNachtrag(nachtragId),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['nachtraege'] }); navigate('/nachtraege') },
    onError: (e: Error) => setMsg({ text: e.message, type: 'error' }),
  })
  const delNodeMut = useMutation({
    mutationFn: (nodeId: number) => deleteNachtragStructureNode(nachtragId, nodeId),
    onSuccess: () => invalidateAll(),
    onError: (e: Error) => setMsg({ text: e.message, type: 'error' }),
  })
  const releaseMut = useMutation({
    mutationFn: (body: ReleasePayload) => releaseNachtrag(nachtragId, body),
    onSuccess: (res) => { setReleaseOpen(false); invalidateAll(); setMsg({ text: `Freigabe ${res.data.release_no}: ${fmtEur(res.data.amount_net)} ins Projekt übernommen ✅`, type: 'success' }) },
    onError: (e: Error) => setMsg({ text: e.message, type: 'error' }),
  })

  if (isLoading) return <p style={{ padding: '2rem', color: 'var(--text-3)' }}>Laden …</p>
  if (!nachtrag) return <p style={{ padding: '2rem', color: 'var(--danger-strong)' }}>Nachtrag nicht gefunden.</p>

  const releasable = !!curStatus?.ALLOWS_RELEASE
  const editable   = curStatus?.CODE !== 'COMMISSIONED'

  return (
    <div className="master-page">
      <button className="project-context-back" onClick={() => navigate('/nachtraege')} style={{ marginBottom: 8 }}>
        <ArrowLeft size={14} /> Nachträge
      </button>

      {msg && <Message text={msg.text} type={msg.type} />}

      {/* ── Kopf ─────────────────────────────────────────────── */}
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 12, marginBottom: 6 }}>
        <h1 className="master-title" style={{ margin: 0 }}>{nachtrag.NAME_SHORT} · {nachtrag.NAME_LONG}</h1>
        <span style={{ padding: '2px 10px', borderRadius: 999, fontSize: 12, background: 'var(--info-bg)', color: 'var(--accent2)' }}>
          {curStatus?.NAME_SHORT ?? '—'}
        </span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, margin: '12px 0' }}>
        <Field label={<>Kategorie <HelpHint id="nachtrag.kategorie" /></>} value={nachtrag.CATEGORY ? CATEGORY_LABELS[nachtrag.CATEGORY] : '—'} />
        <Field label={<>Anspruchsgrundlage <HelpHint id="nachtrag.anspruchsgrundlage" /></>} value={nachtrag.CLAIM_BASIS || '—'} />
        <Field label="Gefordert (netto)" value={fmtEur(nachtrag.AMOUNT_CLAIMED_NET)} />
        <Field label="Freigegeben (netto)" value={fmtEur(nachtrag.AMOUNT_APPROVED_NET)} />
        <Field label={<>Prüffrist <HelpHint id="nachtrag.fristen" /></>} value={fmtDate(nachtrag.REVIEW_DUE_DATE)} />
        <Field label="Entscheidung" value={fmtDate(nachtrag.DECISION_DATE)} />
      </div>

      <div className="list-toolbar">
        <Can permission="nachtraege.edit">
          <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 13, color: 'var(--text-3)' }}>Status:</span>
            <select
              value={curStatus?.CODE ?? ''}
              disabled={!editable}
              onChange={e => patchMut.mutate({ status_code: e.target.value })}
            >
              {statuses.filter(s => MANUAL_STATUS.has(s.CODE) || s.CODE === curStatus?.CODE).map(s => (
                <option key={s.CODE} value={s.CODE}>{s.NAME_SHORT}</option>
              ))}
            </select>
          </label>
        </Can>
        {releasable && (
          <Can permission="nachtraege.release">
            <button className="btn-primary" onClick={() => setReleaseOpen(true)}>
              <CheckCircle2 size={14} style={{ marginRight: 4, verticalAlign: 'text-bottom' }} /> Freigeben
            </button>
            <HelpHint id="nachtrag.freigabe" />
          </Can>
        )}
        <button style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }} onClick={() => openNachtragPdf(nachtrag.ID)}>
          <FileText size={14} /> PDF
        </button>
        <Can permission="nachtraege.delete">
          {curStatus?.CODE === 'DRAFT' && (
            <button style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 4, color: 'var(--danger-strong)' }} onClick={() => setConfirmDel({ kind: 'nachtrag' })}>
              <Trash2 size={13} /> Löschen
            </button>
          )}
        </Can>
      </div>

      {/* ── Struktur / Positionen ────────────────────────────── */}
      <h2 style={{ fontSize: 16, marginTop: 20 }}>Positionen</h2>
      <Can permission="nachtraege.edit">
        {editable && (
          <button style={{ marginBottom: 8, display: 'inline-flex', alignItems: 'center', gap: 4 }} onClick={() => setAddOpen(true)}>
            <Plus size={14} /> Position hinzufügen
          </button>
        )}
      </Can>

      {nodes.length === 0 ? (
        <p style={{ color: 'var(--text-3)', fontSize: 13 }}>Noch keine Positionen. Positionen beschreiben Leistung und Preis des Nachtrags.</p>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table className="master-table">
            <thead>
              <tr><th scope="col">Bezeichnung</th><th scope="col">Art</th><th scope="col" style={{ textAlign: 'right' }}>Betrag (netto)</th><th scope="col">Freigabe</th><th scope="col" /></tr>
            </thead>
            <tbody>
              {nodes.map(n => {
                const d = depthOf(n, byId)
                const isLeaf = !withChildren.has(n.ID)
                return (
                  <tr key={n.ID}>
                    <td style={{ paddingLeft: 8 + d * 18 }}>{n.NAME_SHORT ? `${n.NAME_SHORT} — ` : ''}{n.NAME_LONG}</td>
                    <td>{Number(n.BILLING_TYPE_ID) === 2 ? 'Stunden' : Number(n.BILLING_TYPE_ID) === 1 ? 'Pauschal' : '—'}</td>
                    <td style={{ textAlign: 'right' }}>{fmtEur(n.REVENUE)}</td>
                    <td>
                      <span style={{ fontSize: 11, color: n.APPROVAL_STATE === 'APPROVED' ? '#16a34a' : n.APPROVAL_STATE === 'PARTIAL' ? '#7c3aed' : '#6b7280' }}>
                        {APPROVAL_LABELS[n.APPROVAL_STATE] ?? n.APPROVAL_STATE}
                        {n.APPROVED_AMOUNT_NET != null && n.APPROVAL_STATE !== 'OPEN' ? ` (${fmtEur(n.APPROVED_AMOUNT_NET)})` : ''}
                      </span>
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <Can permission="nachtraege.edit">
                        {editable && isLeaf && n.APPROVAL_STATE === 'OPEN' && (
                          <button className="row-action-btn" title="Position löschen" onClick={() => setConfirmDel({ kind: 'node', nodeId: n.ID, name: n.NAME_LONG || '' })}>
                            <Trash2 size={12} strokeWidth={2.5} />
                          </button>
                        )}
                      </Can>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Prüfung (Prüfbarkeit) ────────────────────────────── */}
      <ReviewSection
        nachtrag={nachtrag}
        canReview={canReview}
        onSaved={() => { invalidateAll(); setMsg({ text: 'Prüfvermerk gespeichert ✅', type: 'success' }) }}
        onError={(m) => setMsg({ text: m, type: 'error' })}
      />

      {/* ── Freigabe-Historie ────────────────────────────────── */}
      {releases.length > 0 && (
        <>
          <h2 style={{ fontSize: 16, marginTop: 24 }}>Freigabe-Historie</h2>
          <div style={{ overflowX: 'auto' }}>
            <table className="master-table">
              <thead><tr><th scope="col">Nr.</th><th scope="col">Art</th><th scope="col">Grundlage</th><th scope="col" style={{ textAlign: 'right' }}>Betrag (netto)</th><th scope="col">Am</th><th scope="col">Notiz</th></tr></thead>
              <tbody>
                {releases.map(r => (
                  <tr key={r.ID}>
                    <td>{r.RELEASE_NO}</td>
                    <td>{RELEASE_KIND_LABELS[r.RELEASE_KIND]}</td>
                    <td>{r.RELEASE_BASIS ? RELEASE_BASIS_LABELS[r.RELEASE_BASIS] : '—'}</td>
                    <td style={{ textAlign: 'right' }}>{fmtEur(r.AMOUNT_NET)}</td>
                    <td>{fmtDate(r.RELEASED_AT)}</td>
                    <td>{r.NOTE || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* ── Modals ───────────────────────────────────────────── */}
      <Modal open={addOpen} onClose={() => setAddOpen(false)} title="Position hinzufügen">
        <AddPositionForm
          nodes={nodes}
          submitting={false}
          onSubmit={async (body) => {
            try { await addNachtragStructureNode(nachtragId, body); setAddOpen(false); invalidateAll() }
            catch (e) { setMsg({ text: (e as Error).message, type: 'error' }) }
          }}
        />
      </Modal>

      <Modal open={releaseOpen} onClose={() => setReleaseOpen(false)} title="Nachtrag freigeben">
        <ReleaseForm
          leaves={nodes.filter(n => !withChildren.has(n.ID) && n.APPROVAL_STATE !== 'APPROVED')}
          submitting={releaseMut.isPending}
          onSubmit={(body) => releaseMut.mutate(body)}
        />
      </Modal>

      {confirmDel && (
        <ConfirmModal
          open
          title={confirmDel.kind === 'nachtrag' ? 'Nachtrag löschen' : 'Position löschen'}
          message={confirmDel.kind === 'nachtrag'
            ? `Nachtrag „${nachtrag.NAME_LONG}" wirklich löschen?`
            : `Position „${confirmDel.name}" wirklich löschen?`}
          confirmLabel="Löschen"
          onConfirm={() => { if (confirmDel.kind === 'nachtrag') delNachtragMut.mutate(); else delNodeMut.mutate(confirmDel.nodeId) }}
          onCancel={() => setConfirmDel(null)}
        />
      )}
    </div>
  )
}

function Field({ label, value }: { label: ReactNode; value: string }) {
  return (
    <div>
      <div style={{ fontSize: 11, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: 0.3 }}>{label}</div>
      <div style={{ fontSize: 14 }}>{value}</div>
    </div>
  )
}

function AddPositionForm({ nodes, submitting, onSubmit }: {
  nodes: NachtragStructureNode[]
  submitting: boolean
  onSubmit: (body: import('@/api/nachtraege').AddNachtragStructureNodePayload) => void
}) {
  const [name, setName]   = useState('')
  const [bt, setBt]       = useState<'1' | '2'>('1')
  const [revenue, setRev] = useState('')
  const [qty, setQty]     = useState('')
  const [rate, setRate]   = useState('')
  const [father, setFather] = useState('')
  const [err, setErr]     = useState<string | null>(null)

  function submit() {
    if (!name.trim()) { setErr('Bitte eine Bezeichnung angeben.'); return }
    onSubmit({
      name_long: name.trim(),
      billing_type_id: bt,
      father_id: father || null,
      ...(bt === '2' ? { quantity: qty || 0, sp_rate: rate || 0 } : { revenue: revenue || 0 }),
    })
  }

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      {err && <Message text={err} type="error" />}
      <label>Bezeichnung *
        <input type="text" value={name} onChange={e => setName(e.target.value)} placeholder="z. B. Zusätzliche Statik" />
      </label>
      <label>Abrechnungsart
        <select value={bt} onChange={e => setBt(e.target.value as '1' | '2')}>
          <option value="1">Pauschal (Festbetrag)</option>
          <option value="2">Stunden / TEC</option>
        </select>
      </label>
      {bt === '1' ? (
        <label>Betrag netto (€)
          <input type="number" inputMode="decimal" value={revenue} onChange={e => setRev(e.target.value)} placeholder="0,00" />
        </label>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          <label>Menge (h)<input type="number" inputMode="decimal" value={qty} onChange={e => setQty(e.target.value)} /></label>
          <label>Stundensatz (€)<input type="number" inputMode="decimal" value={rate} onChange={e => setRate(e.target.value)} /></label>
        </div>
      )}
      {nodes.length > 0 && (
        <label>Übergeordnete Position (optional)
          <select value={father} onChange={e => setFather(e.target.value)}>
            <option value="">— oberste Ebene —</option>
            {nodes.map(n => <option key={n.ID} value={n.ID}>{n.NAME_LONG}</option>)}
          </select>
        </label>
      )}
      <DialogFooter>
        <button type="button" className="btn-primary" disabled={submitting} onClick={submit}>Hinzufügen</button>
      </DialogFooter>
    </div>
  )
}

function ReleaseForm({ leaves, submitting, onSubmit }: {
  leaves: NachtragStructureNode[]
  submitting: boolean
  onSubmit: (body: ReleasePayload) => void
}) {
  const [checked, setChecked] = useState<Set<number>>(() => new Set(leaves.map(l => l.ID)))
  const [amounts, setAmounts] = useState<Record<number, string>>({})
  const [kind, setKind]       = useState<ReleaseKind>('PARTIAL')
  const [basis, setBasis]     = useState<ReleaseBasis>('WRITTEN')
  const [note, setNote]       = useState('')
  const [err, setErr]         = useState<string | null>(null)

  const toggle = (idNum: number) => {
    const next = new Set(checked)
    next.has(idNum) ? next.delete(idNum) : next.add(idNum)
    setChecked(next)
  }

  function submit() {
    const positions = leaves.filter(l => checked.has(l.ID)).map(l => {
      const raw = amounts[l.ID]
      const approved = raw != null && raw !== '' ? Number(raw) : null
      return { nachtrag_structure_id: l.ID, approved_amount_net: approved }
    })
    if (!positions.length) { setErr('Bitte mindestens eine Position wählen.'); return }
    onSubmit({ release_kind: kind, release_basis: basis, note: note.trim() || undefined, positions })
  }

  if (!leaves.length) return <p style={{ color: 'var(--text-3)' }}>Keine offenen Positionen zur Freigabe vorhanden.</p>

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      {err && <Message text={err} type="error" />}
      <p style={{ fontSize: 13, color: 'var(--text-3)', margin: 0 }}>
        Ausgewählte Positionen werden ins Projekt übernommen und damit buch- und abrechenbar. Betrag optional kürzen (Anerkennung „der Höhe nach").
      </p>
      <table className="master-table">
        <thead><tr><th scope="col" /><th scope="col">Position</th><th scope="col" style={{ textAlign: 'right' }}>Gefordert</th><th scope="col" style={{ textAlign: 'right' }}>Anerkannt</th></tr></thead>
        <tbody>
          {leaves.map(l => {
            const isBt1 = Number(l.BILLING_TYPE_ID) === 1
            return (
              <tr key={l.ID}>
                <td><input type="checkbox" checked={checked.has(l.ID)} onChange={() => toggle(l.ID)} /></td>
                <td>{l.NAME_LONG}</td>
                <td style={{ textAlign: 'right' }}>{fmtEur(l.REVENUE)}</td>
                <td style={{ textAlign: 'right' }}>
                  {isBt1 ? (
                    <input type="number" inputMode="decimal" style={{ width: 100, textAlign: 'right' }}
                      placeholder={String(l.REVENUE)} value={amounts[l.ID] ?? ''}
                      onChange={e => setAmounts(a => ({ ...a, [l.ID]: e.target.value }))} disabled={!checked.has(l.ID)} />
                  ) : <span style={{ fontSize: 11, color: 'var(--text-3)' }}>über Buchungen</span>}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        <label>Art der Freigabe
          <select value={kind} onChange={e => setKind(e.target.value as ReleaseKind)}>
            {(Object.keys(RELEASE_KIND_LABELS) as ReleaseKind[]).map(k => <option key={k} value={k}>{RELEASE_KIND_LABELS[k]}</option>)}
          </select>
        </label>
        <label>Grundlage
          <select value={basis} onChange={e => setBasis(e.target.value as ReleaseBasis)}>
            {(Object.keys(RELEASE_BASIS_LABELS) as ReleaseBasis[]).map(b => <option key={b} value={b}>{RELEASE_BASIS_LABELS[b]}</option>)}
          </select>
        </label>
      </div>
      <label>Notiz (optional)
        <textarea value={note} onChange={e => setNote(e.target.value)} rows={2} style={{ resize: 'vertical' }} />
      </label>
      <DialogFooter>
        <button type="button" className="btn-primary" disabled={submitting} onClick={submit}>{submitting ? 'Freigeben …' : 'Freigeben & ins Projekt übernehmen'}</button>
      </DialogFooter>
    </div>
  )
}

function ReviewSection({ nachtrag, canReview, onSaved, onError }: {
  nachtrag: Nachtrag
  canReview: boolean
  onSaved: () => void
  onError: (m: string) => void
}) {
  const [formal, setFormal]   = useState(nachtrag.REVIEW_FORMAL)
  const [content, setContent] = useState(nachtrag.REVIEW_CONTENT)
  const [calc, setCalc]       = useState(nachtrag.REVIEW_CALCULATION)
  const [note, setNote]       = useState(nachtrag.REVIEW_NOTE ?? '')
  const [rec, setRec]         = useState<string>(nachtrag.REVIEW_RECOMMENDATION ?? '')

  const mut = useMutation({
    mutationFn: (body: ReviewPayload) => saveNachtragReview(nachtrag.ID, body),
    onSuccess: () => onSaved(),
    onError: (e: Error) => onError(e.message),
  })

  const dirty = formal !== nachtrag.REVIEW_FORMAL || content !== nachtrag.REVIEW_CONTENT ||
    calc !== nachtrag.REVIEW_CALCULATION || note !== (nachtrag.REVIEW_NOTE ?? '') ||
    rec !== (nachtrag.REVIEW_RECOMMENDATION ?? '')

  const save = () => mut.mutate({
    review_formal: formal, review_content: content, review_calculation: calc,
    review_note: note.trim() || undefined,
    review_recommendation: (rec || null) as ReviewRecommendation | null,
  })

  return (
    <>
      <h2 style={{ fontSize: 16, marginTop: 24, display: 'flex', alignItems: 'center', gap: 8 }}>
        Prüfung <HelpHint id="nachtrag.pruefbarkeit" />
      </h2>
      <div style={{ display: 'grid', gap: 8, maxWidth: 640 }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14 }}>
          <input type="checkbox" checked={formal} disabled={!canReview} onChange={e => setFormal(e.target.checked)} />
          Formell prüffähig (Frist, Form, Ankündigung gewahrt)
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14 }}>
          <input type="checkbox" checked={content} disabled={!canReview} onChange={e => setContent(e.target.checked)} />
          Inhaltlich schlüssig (Anspruchsgrundlage, Nachweis)
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14 }}>
          <input type="checkbox" checked={calc} disabled={!canReview} onChange={e => setCalc(e.target.checked)} />
          Rechnerisch nachvollziehbar (Mengen, Preise)
        </label>
        <label style={{ fontSize: 13 }}>Prüfvermerk
          <textarea value={note} disabled={!canReview} onChange={e => setNote(e.target.value)} rows={2}
            style={{ resize: 'vertical', width: '100%' }} placeholder="Ergebnis der Prüfung, offene Punkte …" />
        </label>
        <label style={{ fontSize: 13 }}>Empfehlung
          <select value={rec} disabled={!canReview} onChange={e => setRec(e.target.value)}>
            <option value="">— keine —</option>
            {(Object.keys(RECOMMENDATION_LABELS) as ReviewRecommendation[]).map(k => (
              <option key={k} value={k}>{RECOMMENDATION_LABELS[k]}</option>
            ))}
          </select>
        </label>
        {canReview && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <button className="btn-primary" disabled={!dirty || mut.isPending} onClick={save}>
              {mut.isPending ? 'Speichern …' : 'Prüfung speichern'}
            </button>
            {nachtrag.REVIEWED_AT && (
              <span style={{ fontSize: 11, color: 'var(--text-3)' }}>
                zuletzt geprüft {new Date(nachtrag.REVIEWED_AT).toLocaleDateString('de-DE')}
              </span>
            )}
          </div>
        )}
      </div>
    </>
  )
}
