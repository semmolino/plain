import { useState, useMemo } from 'react'
import { useParams, useNavigate, useLocation, Link } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Trash2, CheckCircle2, FileText, Pencil, Folder } from 'lucide-react'
import { ActionBar } from '@/components/ui/ActionBar'
import { AmountInput } from '@/components/ui/AmountInput'
import { Can } from '@/components/ui/Can'
import { ConfirmModal } from '@/components/ui/ConfirmModal'
import { DialogFooter } from '@/components/ui/DialogFooter'
import { DirtyGuardProvider } from '@/components/ui/DirtyGuard'
import { FormField } from '@/components/ui/FormField'
import { FormSection } from '@/components/ui/FormSection'
import { HelpHint } from '@/components/ui/HelpHint'
import { Message } from '@/components/ui/Message'
import { Modal } from '@/components/ui/Modal'
import { PageHeader } from '@/components/ui/PageHeader'
import { useCtrlS } from '@/hooks/useCtrlS'
import { useRegisterDirty } from '@/hooks/useDirtyGuard'
import { usePermission } from '@/store/permissionsStore'
import {
  fetchNachtrag, updateNachtrag, deleteNachtrag,
  fetchNachtragStatuses, fetchNachtragStructure, addNachtragStructureNode, updateNachtragStructureNode, deleteNachtragStructureNode,
  fetchNachtragReleases, releaseNachtrag, saveNachtragReview, openNachtragPdf,
  CATEGORY_LABELS, RELEASE_KIND_LABELS, RELEASE_BASIS_LABELS, RECOMMENDATION_LABELS,
  type Nachtrag, type NachtragStructureNode, type ReleasePayload, type ReleaseKind, type ReleaseBasis,
  type ReviewRecommendation, type AddNachtragStructureNodePayload,
} from '@/api/nachtraege'
import { fmtEur, money, NO_VALUE } from '@/utils/money'
import { fmtHours } from '@/utils/zeit'
import { StatusPill, type NachtragFrom } from './NachtraegeListe'
import { isReleasedNode } from './nachtragStatus'

const fmtDate = (v: string | null | undefined) => v ? new Date(v).toLocaleDateString('de-DE') : NO_VALUE

const APPROVAL_LABELS: Record<string, string> = { OPEN: 'offen', APPROVED: 'freigegeben', PARTIAL: 'gekürzt freigegeben', REJECTED: 'abgelehnt' }
// Status, die manuell (nicht über die Freigabe) gesetzt werden dürfen
const MANUAL_STATUS = new Set(['DRAFT', 'ANNOUNCED', 'SUBMITTED', 'IN_REVIEW', 'REJECTED', 'WITHDRAWN', 'DISPUTED'])

/** Positionen in Baumreihenfolge mit Tiefe. */
function inTreeOrder(nodes: NachtragStructureNode[]) {
  const ids = new Set(nodes.map(n => n.ID))
  const kids = new Map<number | null, NachtragStructureNode[]>()
  for (const n of nodes) {
    const f = n.FATHER_ID != null && ids.has(n.FATHER_ID) ? n.FATHER_ID : null
    kids.set(f, [...(kids.get(f) ?? []), n])
  }
  const out: { node: NachtragStructureNode; depth: number }[] = []
  const walk = (f: number | null, depth: number) => {
    for (const n of [...(kids.get(f) ?? [])].sort((a, b) => (a.SORT_ORDER ?? 0) - (b.SORT_ORDER ?? 0) || a.ID - b.ID)) {
      out.push({ node: n, depth }); walk(n.ID, depth + 1)
    }
  }
  walk(null, 0)
  return { rows: out, kids }
}

const posLabel = (n: NachtragStructureNode) => [n.ABBR, n.NAME].filter(Boolean).join(' — ') || `Position ${n.ID}`

export function NachtragDetail() {
  const { id } = useParams<{ id: string }>()
  // Neuer Zustand je Nachtrag — offene Eingaben der Prüfung gehören zu genau einem.
  // Der Provider fragt beim Verlassen nach, wenn die Prüfung ungespeichert ist.
  return <DirtyGuardProvider><NachtragSeite key={id} nachtragId={Number(id)} /></DirtyGuardProvider>
}

function NachtragSeite({ nachtragId }: { nachtragId: number }) {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const location = useLocation()
  const back = (location.state as NachtragFrom | null) ?? { from: '/nachtraege', fromLabel: 'Nachträge' }
  const canEdit    = usePermission('nachtraege.edit')
  const canReview  = usePermission('nachtraege.review')

  const [msg, setMsg]                 = useState<{ text: string; type: 'success' | 'error' } | null>(null)
  const [posDialog, setPosDialog]     = useState<{ node: NachtragStructureNode | null } | null>(null)
  const [releaseOpen, setReleaseOpen] = useState(false)
  const [confirmDel, setConfirmDel]   = useState<{ kind: 'nachtrag' } | { kind: 'node'; node: NachtragStructureNode; branch: number } | null>(null)

  const { data: nData, isLoading, isError } = useQuery({ queryKey: ['nachtrag', nachtragId], queryFn: () => fetchNachtrag(nachtragId) })
  const { data: statusData }  = useQuery({ queryKey: ['nachtrag-statuses'], queryFn: fetchNachtragStatuses })
  const { data: structData }  = useQuery({ queryKey: ['nachtrag-structure', nachtragId], queryFn: () => fetchNachtragStructure(nachtragId) })
  const { data: releaseData } = useQuery({ queryKey: ['nachtrag-releases', nachtragId], queryFn: () => fetchNachtragReleases(nachtragId) })

  const nachtrag = nData?.data
  const statuses = statusData?.data ?? []
  const nodes    = useMemo(() => structData?.data ?? [], [structData])
  const releases = releaseData?.data ?? []
  const tree     = useMemo(() => inTreeOrder(nodes), [nodes])
  const curStatus = statuses.find(s => s.ID === nachtrag?.NACHTRAG_STATUS_ID)

  const invalidateAll = () => {
    void qc.invalidateQueries({ queryKey: ['nachtrag', nachtragId] })
    void qc.invalidateQueries({ queryKey: ['nachtrag-structure', nachtragId] })
    void qc.invalidateQueries({ queryKey: ['nachtrag-releases', nachtragId] })
    void qc.invalidateQueries({ queryKey: ['nachtraege'] })
  }

  const statusMut = useMutation({
    mutationFn: (code: string) => updateNachtrag(nachtragId, { status_code: code }),
    onSuccess: () => { invalidateAll(); setMsg({ text: 'Status geändert.', type: 'success' }) },
    onError: (e: Error) => setMsg({ text: e.message, type: 'error' }),
  })
  const delNachtragMut = useMutation({
    mutationFn: () => deleteNachtrag(nachtragId),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['nachtraege'] }); navigate(back.from) },
    onError: (e: Error) => setMsg({ text: e.message, type: 'error' }),
  })
  const delNodeMut = useMutation({
    mutationFn: (nodeId: number) => deleteNachtragStructureNode(nachtragId, nodeId),
    onSuccess: () => { invalidateAll(); setMsg({ text: 'Position gelöscht.', type: 'success' }) },
    onError: (e: Error) => setMsg({ text: e.message, type: 'error' }),
  })
  const releaseMut = useMutation({
    mutationFn: (body: ReleasePayload) => releaseNachtrag(nachtragId, body),
    onSuccess: (res) => {
      setReleaseOpen(false); invalidateAll()
      setMsg({ text: `Freigabe ${res.data.release_no}: ${fmtEur(res.data.amount_net)} ins Projekt übernommen.`, type: 'success' })
    },
  })

  if (isLoading) return <div className="master-page"><p className="ls-empty">Lädt …</p></div>
  if (isError || !nachtrag) return <div className="master-page"><Message type="error" text="Nachtrag nicht gefunden." /></div>

  const releasable = !!curStatus?.ALLOWS_RELEASE
  const editable   = curStatus?.CODE !== 'COMMISSIONED'
  const openLeaves = nodes.filter(n => !tree.kids.get(n.ID)?.length && !isReleasedNode(n))
  const projectHref = `/projekte?projectId=${nachtrag.PROJECT_ID}&tab=nachtraege`

  /** Anzahl der Positionen im Zweig und ob einer davon schon im Projekt steht. */
  function branchOf(n: NachtragStructureNode) {
    const all: NachtragStructureNode[] = []
    const walk = (x: NachtragStructureNode) => { all.push(x); for (const c of tree.kids.get(x.ID) ?? []) walk(c) }
    walk(n)
    return { count: all.length, released: all.some(isReleasedNode) }
  }

  return (
    <div className="master-page nt-detail">
      <PageHeader
        back={{ label: back.fromLabel, onClick: () => navigate(back.from) }}
        eyebrow={<>Nachtrag {nachtrag.ABBR ?? `#${nachtrag.ID}`}</>}
        title={nachtrag.NAME}
        titleAddon={<StatusPill code={curStatus?.CODE} label={curStatus?.ABBR} />}
        meta={back.fromLabel !== 'Projekt' && (
          <Link to={projectHref} className="nt-project-link"><Folder size={13} strokeWidth={1.75} aria-hidden="true" /> Zum Projekt</Link>
        )}
        actions={<>
          <button type="button" className="btn-secondary nt-btn" onClick={() => openNachtragPdf(nachtrag.ID)}>
            <FileText size={14} strokeWidth={1.75} aria-hidden="true" /> PDF
          </button>
          {releasable && (
            <Can permission="nachtraege.release">
              <button type="button" className="btn-primary nt-btn" onClick={() => { releaseMut.reset(); setReleaseOpen(true) }} disabled={!openLeaves.length}
                title={openLeaves.length ? undefined : 'Alle Positionen sind schon freigegeben'}>
                <CheckCircle2 size={14} strokeWidth={2} aria-hidden="true" /> Freigeben
              </button>
            </Can>
          )}
        </>}
      />

      <Message text={msg?.text ?? null} type={msg?.type} />

      <dl className="nt-facts">
        <div><dt>Kategorie <HelpHint id="nachtrag.kategorie" size={12} /></dt><dd>{nachtrag.CATEGORY ? CATEGORY_LABELS[nachtrag.CATEGORY] : NO_VALUE}</dd></div>
        <div><dt>Anspruchsgrundlage <HelpHint id="nachtrag.anspruchsgrundlage" size={12} /></dt><dd>{nachtrag.CLAIM_BASIS || NO_VALUE}</dd></div>
        <div><dt>Gefordert (netto)</dt><dd>{money(nachtrag.AMOUNT_CLAIMED_NET)}</dd></div>
        <div><dt>Freigegeben (netto)</dt><dd>{money(nachtrag.AMOUNT_APPROVED_NET)}</dd></div>
        <div><dt>Prüffrist <HelpHint id="nachtrag.fristen" size={12} /></dt><dd>{fmtDate(nachtrag.REVIEW_DUE_DATE)}</dd></div>
        <div><dt>Entscheidung</dt><dd>{fmtDate(nachtrag.DECISION_DATE)}</dd></div>
        <Can permission="nachtraege.edit">
          <div className="nt-status-field">
            <dt><label htmlFor="nt-status">Status</label></dt>
            <dd>
              <select id="nt-status" value={curStatus?.CODE ?? ''} disabled={!editable || statusMut.isPending}
                onChange={e => statusMut.mutate(e.target.value)}>
                {statuses.filter(s => MANUAL_STATUS.has(s.CODE) || s.CODE === curStatus?.CODE).map(s => (
                  <option key={s.CODE} value={s.CODE}>{s.ABBR}</option>
                ))}
              </select>
            </dd>
          </div>
        </Can>
      </dl>

      <FormSection
        title="Positionen"
        help="nachtrag.positionen"
        layout="block"
        actions={canEdit && editable && nodes.length > 0 ? (
          <button type="button" className="btn-small nt-btn" onClick={() => setPosDialog({ node: null })}>
            <Plus size={13} strokeWidth={2} aria-hidden="true" /> Position hinzufügen
          </button>
        ) : undefined}
      >
        {nodes.length === 0 ? (
          <div className="empty-block">
            <p className="empty-note">Dieser Nachtrag hat noch keine Positionen.</p>
            <p className="empty-block-why">Positionen beschreiben Leistung und Preis — pauschal oder nach Aufwand. Freigegeben werden später einzelne Positionen.</p>
            {canEdit && editable && (
              <button type="button" className="btn-small nt-btn" onClick={() => setPosDialog({ node: null })}>
                <Plus size={13} strokeWidth={2} aria-hidden="true" /> Erste Position anlegen
              </button>
            )}
          </div>
        ) : (
          <div className="table-scroll">
            <table className="ls-table prl-table">
              <thead>
                <tr>
                  <th scope="col" className="ls-th">Position</th>
                  <th scope="col" className="ls-th ls-col-num">Betrag (netto)</th>
                  <th scope="col" className="ls-th">Freigabe</th>
                  {canEdit && editable && <th scope="col" className="ls-th prl-col-actions"><span className="sr-only">Aktionen</span></th>}
                </tr>
              </thead>
              <tbody>
                {tree.rows.map(({ node: n, depth }) => {
                  const parent = !!tree.kids.get(n.ID)?.length
                  const released = isReleasedNode(n)
                  const hourly = Number(n.BILLING_TYPE_ID) === 2
                  const label = posLabel(n)
                  const br = branchOf(n)
                  return (
                    <tr key={n.ID} className={`ls-row${parent ? ' nt-row-parent' : ''}`}>
                      <td className="ls-td">
                        <div className="prl-name" style={{ paddingLeft: depth * 16 }}>{label}</div>
                        {/* Abrechnung als zweite Zeile statt eigener Spalte — am Handy
                            passte die Tabelle mit fünf Spalten nicht in die Breite. */}
                        <div className="prl-sub" style={{ paddingLeft: depth * 16 }}>
                          {parent ? 'Summe der Unterpositionen'
                            : hourly ? `nach Aufwand${(n.QUANTITY ?? 0) > 0 ? ` · ${fmtHours(n.QUANTITY)} h × ${fmtEur(n.HOURLY_RATE)}/h` : ''}`
                            : 'Pauschal'}
                        </div>
                      </td>
                      <td className="ls-td ls-col-num">{money(n.REVENUE)}</td>
                      <td className="ls-td">
                        {!parent && (
                          <span className={`nt-approval nt-approval--${released ? 'done' : 'open'}`}>
                            {APPROVAL_LABELS[n.APPROVAL_STATE] ?? APPROVAL_LABELS.OPEN}
                            {released && n.APPROVED_AMOUNT_NET != null ? ` · ${fmtEur(n.APPROVED_AMOUNT_NET)}` : ''}
                          </span>
                        )}
                      </td>
                      {canEdit && editable && (
                        <td className="ls-td prl-col-actions">
                          <div className="doc-actions">
                            {!released && (
                              <button type="button" className="row-action-btn" title="Bearbeiten" aria-label={`${label} bearbeiten`}
                                onClick={() => setPosDialog({ node: n })}>
                                <Pencil size={14} strokeWidth={2} aria-hidden="true" />
                              </button>
                            )}
                            {!br.released && (
                              <button type="button" className="row-action-btn row-action-btn--danger" title="Löschen" aria-label={`${label} löschen`}
                                onClick={() => setConfirmDel({ kind: 'node', node: n, branch: br.count })}>
                                <Trash2 size={14} strokeWidth={2} aria-hidden="true" />
                              </button>
                            )}
                          </div>
                        </td>
                      )}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </FormSection>

      {releases.length > 0 && (
        <FormSection title="Freigaben" help="nachtrag.freigabe" layout="block">
          <div className="table-scroll">
            <table className="ls-table prl-table">
              <thead>
                <tr>
                  <th scope="col" className="ls-th">Nr.</th><th scope="col" className="ls-th">Art</th><th scope="col" className="ls-th">Grundlage</th>
                  <th scope="col" className="ls-th ls-col-num">Betrag (netto)</th><th scope="col" className="ls-th">Am</th><th scope="col" className="ls-th">Notiz</th>
                </tr>
              </thead>
              <tbody>
                {releases.map(r => (
                  <tr key={r.ID} className="ls-row">
                    <td className="ls-td">{r.RELEASE_NO}</td>
                    <td className="ls-td">{RELEASE_KIND_LABELS[r.RELEASE_KIND]}</td>
                    <td className="ls-td">{r.RELEASE_BASIS ? RELEASE_BASIS_LABELS[r.RELEASE_BASIS] : NO_VALUE}</td>
                    <td className="ls-td ls-col-num">{money(r.AMOUNT_NET)}</td>
                    <td className="ls-td">{fmtDate(r.RELEASED_AT)}</td>
                    <td className="ls-td nt-note">{r.NOTE || NO_VALUE}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </FormSection>
      )}

      {curStatus?.CODE === 'DRAFT' && (
        <Can permission="nachtraege.delete">
          <div className="nt-danger-zone">
            <button type="button" className="btn-secondary nt-btn nt-btn-danger" onClick={() => setConfirmDel({ kind: 'nachtrag' })}>
              <Trash2 size={13} strokeWidth={2} aria-hidden="true" /> Entwurf löschen
            </button>
          </div>
        </Can>
      )}

      {/* Zuletzt: die Prüfung ist das Formular dieser Seite, ihre Leiste steht am Ende */}
      <ReviewSection nachtrag={nachtrag} canReview={canReview} onSaved={() => { invalidateAll(); setMsg({ text: 'Prüfung gespeichert.', type: 'success' }) }} />

      {posDialog && (
        <PositionDialog
          nachtragId={nachtragId}
          node={posDialog.node}
          nodes={nodes}
          onClose={() => setPosDialog(null)}
          onSaved={text => { setPosDialog(null); invalidateAll(); setMsg({ text, type: 'success' }) }}
        />
      )}

      {releaseOpen && (
        <Modal open onClose={() => setReleaseOpen(false)} title="Nachtrag freigeben">
          <ReleaseForm
            leaves={openLeaves}
            submitting={releaseMut.isPending}
            error={releaseMut.error ? (releaseMut.error as Error).message : null}
            onCancel={() => setReleaseOpen(false)}
            onSubmit={(body) => releaseMut.mutate(body)}
          />
        </Modal>
      )}

      {confirmDel && (
        <ConfirmModal
          open
          title={confirmDel.kind === 'nachtrag' ? 'Nachtrag löschen' : 'Position löschen'}
          message={confirmDel.kind === 'nachtrag'
            ? `Nachtrag „${nachtrag.NAME}" mit allen Positionen löschen?`
            : confirmDel.branch > 1
              ? `Position „${posLabel(confirmDel.node)}" samt ${confirmDel.branch - 1} Unterposition${confirmDel.branch === 2 ? '' : 'en'} löschen?`
              : `Position „${posLabel(confirmDel.node)}" löschen?`}
          confirmLabel="Löschen"
          confirmClass="danger"
          onConfirm={() => {
            if (confirmDel.kind === 'nachtrag') delNachtragMut.mutate()
            else delNodeMut.mutate(confirmDel.node.ID)
            setConfirmDel(null)
          }}
          onCancel={() => setConfirmDel(null)}
        />
      )}
    </div>
  )
}

// ── Position anlegen / bearbeiten ─────────────────────────────────────────────

function PositionDialog({ nachtragId, node, nodes, onClose, onSaved }: {
  nachtragId: number
  node:       NachtragStructureNode | null
  nodes:      NachtragStructureNode[]
  onClose:    () => void
  onSaved:    (text: string) => void
}) {
  const isNew = node == null
  const isParent = !!node && nodes.some(n => n.FATHER_ID === node.ID)
  const [abbr, setAbbr]     = useState(node?.ABBR ?? '')
  const [name, setName]     = useState(node?.NAME ?? '')
  const [bt, setBt]         = useState<'1' | '2'>(Number(node?.BILLING_TYPE_ID) === 2 ? '2' : '1')
  const [revenue, setRev]   = useState(node && Number(node.BILLING_TYPE_ID) !== 2 ? String(node.REVENUE_BASIS ?? node.REVENUE ?? '') : '')
  const [qty, setQty]       = useState(node?.QUANTITY != null ? String(node.QUANTITY) : '')
  const [rate, setRate]     = useState(node?.HOURLY_RATE != null ? String(node.HOURLY_RATE) : '')
  const [father, setFather] = useState('')
  const [err, setErr]       = useState<string | null>(null)

  // Als Vater taugt nur, was noch nicht freigegeben ist — sonst lehnt der Server ab (409)
  const fathers = inTreeOrder(nodes.filter(n => !isReleasedNode(n))).rows

  const mut = useMutation({
    mutationFn: () => {
      const amounts: Partial<AddNachtragStructureNodePayload> = isParent ? {}
        : bt === '2' ? { quantity: qty || 0, hourly_rate: rate || 0 } : { revenue: revenue || 0 }
      const body = { abbr: abbr.trim(), name: name.trim(), ...(isParent ? {} : { billing_type_id: bt }), ...amounts }
      return isNew
        ? addNachtragStructureNode(nachtragId, { ...body, billing_type_id: bt, father_id: father || null })
        : updateNachtragStructureNode(nachtragId, node.ID, body)
    },
    onSuccess: () => onSaved(isNew ? 'Position angelegt.' : 'Position gespeichert.'),
    onError: (e: Error) => setErr(e.message),
  })

  function submit() {
    if (!name.trim()) { setErr('Bitte eine Bezeichnung angeben.'); return }
    setErr(null); mut.mutate()
  }

  const preview = bt === '2' ? (Number(qty) || 0) * (Number(rate) || 0) : Number(revenue) || 0

  return (
    <Modal open onClose={onClose} title={isNew ? 'Position hinzufügen' : 'Position bearbeiten'}>
      <div className="master-form nt-dialog">
        <div className="form-row">
          <FormField label="Kürzel (optional)" id="nt-pos-abbr" value={abbr} onChange={e => setAbbr(e.target.value)} placeholder="z. B. 1.2" />
          <FormField label="Bezeichnung" id="nt-pos-name" value={name} data-autofocus required onChange={e => setName(e.target.value)} placeholder="z. B. Zusätzliche Statik" />
        </div>
        {isParent ? (
          <p className="form-field-hint">Der Betrag ist die Summe der Unterpositionen.</p>
        ) : (
          <>
            <div className="form-group">
              <label htmlFor="nt-pos-bt">Abrechnung</label>
              <select id="nt-pos-bt" value={bt} onChange={e => setBt(e.target.value as '1' | '2')}>
                <option value="1">Pauschal (Festbetrag)</option>
                <option value="2">Nach Aufwand (Stunden)</option>
              </select>
            </div>
            {bt === '1' ? (
              <div className="form-group">
                <label htmlFor="nt-pos-rev">Betrag netto (€)</label>
                <AmountInput id="nt-pos-rev" value={revenue} placeholder="0,00" onChange={setRev} />
              </div>
            ) : (
              <>
                <div className="form-row">
                  <div className="form-group">
                    <label htmlFor="nt-pos-qty">Stunden</label>
                    <AmountInput id="nt-pos-qty" value={qty} placeholder="0,00" onChange={setQty} />
                  </div>
                  <div className="form-group">
                    <label htmlFor="nt-pos-rate">Stundensatz (€/h)</label>
                    <AmountInput id="nt-pos-rate" value={rate} placeholder="0,00" onChange={setRate} />
                  </div>
                </div>
                <p className="form-field-hint">
                  Ergibt {fmtEur(preview)}. Im Projekt startet die Position bei 0 und bringt diese Schätzung als Plan mit.
                </p>
              </>
            )}
          </>
        )}
        {isNew && fathers.length > 0 && (
          <div className="form-group">
            <label htmlFor="nt-pos-father">Übergeordnete Position (optional)</label>
            <select id="nt-pos-father" value={father} onChange={e => setFather(e.target.value)}>
              <option value="">— oberste Ebene —</option>
              {fathers.map(({ node: n, depth }) => <option key={n.ID} value={n.ID}>{`${'  '.repeat(depth)}${posLabel(n)}`}</option>)}
            </select>
          </div>
        )}
        <Message text={err} type="error" />
        <DialogFooter>
          <button type="button" className="btn-secondary" onClick={onClose}>Abbrechen</button>
          <button type="button" className="btn-primary" disabled={mut.isPending} onClick={submit}>
            {mut.isPending ? 'Speichert …' : isNew ? 'Hinzufügen' : 'Speichern'}
          </button>
        </DialogFooter>
      </div>
    </Modal>
  )
}

// ── Freigabe ──────────────────────────────────────────────────────────────────

function ReleaseForm({ leaves, submitting, error, onCancel, onSubmit }: {
  leaves:     NachtragStructureNode[]
  submitting: boolean
  error:      string | null
  onCancel:   () => void
  onSubmit:   (body: ReleasePayload) => void
}) {
  const [checked, setChecked] = useState<Set<number>>(() => new Set(leaves.map(l => l.ID)))
  const [amounts, setAmounts] = useState<Record<number, string>>({})
  const [kind, setKind]       = useState<ReleaseKind>('PARTIAL')
  const [basis, setBasis]     = useState<ReleaseBasis>('WRITTEN')
  const [note, setNote]       = useState('')
  const [err, setErr]         = useState<string | null>(null)

  const toggle = (idNum: number) => setChecked(prev => {
    const next = new Set(prev)
    if (next.has(idNum)) next.delete(idNum); else next.add(idNum)
    return next
  })

  const sum = leaves.filter(l => checked.has(l.ID) && Number(l.BILLING_TYPE_ID) === 1)
    .reduce((s, l) => s + (amounts[l.ID] ? Number(amounts[l.ID]) : Number(l.REVENUE || 0)), 0)

  function submit() {
    const positions = leaves.filter(l => checked.has(l.ID)).map(l => {
      const raw = amounts[l.ID]
      return { nachtrag_structure_id: l.ID, approved_amount_net: raw != null && raw !== '' ? Number(raw) : null }
    })
    if (!positions.length) { setErr('Bitte mindestens eine Position wählen.'); return }
    setErr(null)
    onSubmit({ release_kind: kind, release_basis: basis, note: note.trim() || undefined, positions })
  }

  return (
    <div className="master-form nt-dialog">
      <p className="form-field-hint nt-dialog-intro">
        Die gewählten Positionen gehen ins Projekt und sind danach buch- und abrechenbar. Ein gekürzter Betrag
        („der Höhe nach") gilt als endgültig anerkannt; freigegebene Positionen lassen sich im Nachtrag nicht mehr ändern.
      </p>
      <div className="table-scroll">
        <table className="ls-table prl-table">
          <thead>
            <tr>
              <th scope="col" className="ls-th"><span className="sr-only">Freigeben</span></th>
              <th scope="col" className="ls-th">Position</th>
              <th scope="col" className="ls-th ls-col-num">Gefordert</th>
              <th scope="col" className="ls-th ls-col-num">Anerkannt</th>
            </tr>
          </thead>
          <tbody>
            {leaves.map(l => {
              const isBt1 = Number(l.BILLING_TYPE_ID) === 1
              const label = posLabel(l)
              return (
                <tr key={l.ID} className="ls-row">
                  <td className="ls-td">
                    <input type="checkbox" className="nt-check" checked={checked.has(l.ID)} onChange={() => toggle(l.ID)} aria-label={`${label} freigeben`} />
                  </td>
                  <td className="ls-td">{label}</td>
                  <td className="ls-td ls-col-num">{money(l.REVENUE)}</td>
                  <td className="ls-td ls-col-num">
                    {isBt1 ? (
                      <AmountInput className="tbl-input nt-amount" value={amounts[l.ID] ?? ''} placeholder={fmtEur(l.REVENUE)}
                        aria-label={`Anerkannter Betrag ${label}`} disabled={!checked.has(l.ID)}
                        onChange={v => setAmounts(a => ({ ...a, [l.ID]: v }))} />
                    ) : <span className="prl-sub">als Plan, gebucht wird im Projekt</span>}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <p className="nt-release-sum">Pauschal freigegeben: <strong>{fmtEur(sum)}</strong></p>
      <div className="form-row">
        <div className="form-group">
          <label htmlFor="nt-rel-kind">Art der Freigabe</label>
          <select id="nt-rel-kind" value={kind} onChange={e => setKind(e.target.value as ReleaseKind)}>
            {(Object.keys(RELEASE_KIND_LABELS) as ReleaseKind[]).map(k => <option key={k} value={k}>{RELEASE_KIND_LABELS[k]}</option>)}
          </select>
        </div>
        <div className="form-group">
          <label htmlFor="nt-rel-basis">Grundlage</label>
          <select id="nt-rel-basis" value={basis} onChange={e => setBasis(e.target.value as ReleaseBasis)}>
            {(Object.keys(RELEASE_BASIS_LABELS) as ReleaseBasis[]).map(b => <option key={b} value={b}>{RELEASE_BASIS_LABELS[b]}</option>)}
          </select>
        </div>
      </div>
      <div className="form-group">
        <label htmlFor="nt-rel-note">Notiz (optional)</label>
        <textarea id="nt-rel-note" value={note} onChange={e => setNote(e.target.value)} rows={2} />
      </div>
      <Message text={err ?? error} type="error" />
      <DialogFooter>
        <button type="button" className="btn-secondary" onClick={onCancel}>Abbrechen</button>
        <button type="button" className="btn-primary" disabled={submitting} onClick={submit}>{submitting ? 'Gibt frei …' : 'Freigeben und ins Projekt übernehmen'}</button>
      </DialogFooter>
    </div>
  )
}

// ── Prüfung ───────────────────────────────────────────────────────────────────

interface ReviewForm { formal: boolean; content: boolean; calc: boolean; note: string; rec: string }

function ReviewSection({ nachtrag, canReview, onSaved }: {
  nachtrag:  Nachtrag
  canReview: boolean
  onSaved:   () => void
}) {
  const saved: ReviewForm = {
    formal: !!nachtrag.REVIEW_FORMAL, content: !!nachtrag.REVIEW_CONTENT, calc: !!nachtrag.REVIEW_CALCULATION,
    note: nachtrag.REVIEW_NOTE ?? '', rec: nachtrag.REVIEW_RECOMMENDATION ?? '',
  }
  // Eingaben über dem gespeicherten Stand — ein Nachladen überschreibt nichts
  const [edits, setEdits] = useState<Partial<ReviewForm>>({})
  const [pending, setPending] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const form: ReviewForm = { ...saved, ...edits }
  const changed = (Object.keys(saved) as (keyof ReviewForm)[]).filter(k => form[k] !== saved[k]).length
  const dirty = changed > 0
  const set = <K extends keyof ReviewForm>(k: K, v: ReviewForm[K]) => { setEdits(e => ({ ...e, [k]: v })); setErr(null) }

  async function save() {
    setPending(true); setErr(null)
    try {
      await saveNachtragReview(nachtrag.ID, {
        review_formal: form.formal, review_content: form.content, review_calculation: form.calc,
        review_note: form.note.trim() || undefined,
        review_recommendation: (form.rec || null) as ReviewRecommendation | null,
      })
      setEdits({})
      onSaved()
    } catch (e) {
      setErr((e as Error)?.message || 'Speichern fehlgeschlagen')
      throw e
    } finally {
      setPending(false)
    }
  }

  useRegisterDirty('nachtrag-pruefung', { dirty, label: 'Prüfung', count: changed, save })
  useCtrlS(() => { if (dirty && !pending) void save().catch(() => {}) }, canReview)

  return (<>
    <FormSection title="Prüfung" help="nachtrag.pruefbarkeit"
      hint={nachtrag.REVIEWED_AT ? `Zuletzt geprüft am ${fmtDate(nachtrag.REVIEWED_AT)}.` : 'Noch nicht geprüft.'}>
      <fieldset className="ws-form-fields nt-review form-section-wide" disabled={!canReview || pending}>
        <legend className="sr-only">Prüfung</legend>
        <label className="ws-check">
          <input type="checkbox" checked={form.formal} onChange={e => set('formal', e.target.checked)} />
          <span>Formell prüffähig (Frist, Form, Ankündigung gewahrt)</span>
        </label>
        <label className="ws-check">
          <input type="checkbox" checked={form.content} onChange={e => set('content', e.target.checked)} />
          <span>Inhaltlich schlüssig (Anspruchsgrundlage, Nachweis)</span>
        </label>
        <label className="ws-check">
          <input type="checkbox" checked={form.calc} onChange={e => set('calc', e.target.checked)} />
          <span>Rechnerisch nachvollziehbar (Mengen, Preise)</span>
        </label>
        <div className="form-group">
          <label htmlFor="nt-review-note">Prüfvermerk</label>
          <textarea id="nt-review-note" rows={3} value={form.note} onChange={e => set('note', e.target.value)} placeholder="Ergebnis der Prüfung, offene Punkte …" />
        </div>
        <div className="form-group">
          <label htmlFor="nt-review-rec">Empfehlung</label>
          <select id="nt-review-rec" value={form.rec} onChange={e => set('rec', e.target.value)}>
            <option value="">— keine —</option>
            {(Object.keys(RECOMMENDATION_LABELS) as ReviewRecommendation[]).map(k => <option key={k} value={k}>{RECOMMENDATION_LABELS[k]}</option>)}
          </select>
        </div>
      </fieldset>
      {!canReview && <p className="ws-form-readonly form-section-wide">Nur Lesen — prüfen darf, wer das Recht „Nachträge prüfen" hat.</p>}
      <div className="form-section-wide"><Message text={err} type="error" /></div>
    </FormSection>
    {canReview && (
        <ActionBar
          dirty={dirty}
          quiet={!dirty && !pending}
          status={pending ? 'Speichert …' : dirty ? `Prüfung: ${changed} ${changed === 1 ? 'Angabe' : 'Angaben'} geändert` : 'Prüfung gespeichert'}
          secondary={dirty ? <button type="button" className="btn-secondary" onClick={() => setEdits({})} disabled={pending}>Verwerfen</button> : undefined}
        >
          <button type="button" className="btn-primary" onClick={() => void save().catch(() => {})} disabled={!dirty || pending}>
            {pending ? 'Speichert …' : 'Prüfung speichern'}
          </button>
        </ActionBar>
      )}
  </>)
}
