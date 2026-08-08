import { useState, useMemo } from 'react'
import { DialogFooter } from '@/components/ui/DialogFooter'
import { FilterChip } from '@/components/ui/FilterChip'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { FileDiff } from 'lucide-react'
import { Can } from '@/components/ui/Can'
import { Modal } from '@/components/ui/Modal'
import { Message } from '@/components/ui/Message'
import { HelpHint } from '@/components/ui/HelpHint'
import { fetchProjectsShort } from '@/api/projekte'
import {
  fetchNachtraege, createNachtrag, CATEGORY_LABELS,
  type NachtragCategory, type CreateNachtragPayload,
} from '@/api/nachtraege'

const FMT_EUR = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2, maximumFractionDigits: 2 })
const fmtEur  = (v: number | null | undefined) => v == null ? '—' : FMT_EUR.format(v)
const fmtDate = (v: string | null | undefined) => v ? new Date(v).toLocaleDateString('de-DE') : '—'

const STATUS_COLORS: Record<string, string> = {
  DRAFT: '#6b7280', ANNOUNCED: '#0891b2', SUBMITTED: '#2563eb', IN_REVIEW: '#d97706',
  PARTIALLY_COMMISSIONED: '#7c3aed', COMMISSIONED: '#16a34a', REJECTED: '#dc2626',
  WITHDRAWN: '#9ca3af', DISPUTED: '#b91c1c',
}

const CATEGORY_ENTRIES = Object.entries(CATEGORY_LABELS) as [NachtragCategory, string][]


function StatTile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div style={{ flex: '1 1 130px', minWidth: 130, border: '1px solid var(--border)', borderRadius: 8, padding: '10px 12px', background: 'var(--surface-3)' }}>
      <div style={{ fontSize: 11, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: 0.3 }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--text)' }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: 'var(--text-3)' }}>{sub}</div>}
    </div>
  )
}

export function NachtraegeListe({ projectId }: { projectId?: number }) {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const [search, setSearch]         = useState('')
  const [statusFilter, setStatus]   = useState<Set<string>>(new Set())
  const [catFilter, setCat]         = useState<Set<string>>(new Set())
  const [projFilter, setProj]       = useState<Set<string>>(new Set())
  const [msg, setMsg]               = useState<{ text: string; type: 'success' | 'error' } | null>(null)
  const [createOpen, setCreateOpen] = useState(false)

  const { data, isLoading } = useQuery({
    queryKey: ['nachtraege', projectId ?? 'all'],
    queryFn:  () => fetchNachtraege(projectId),
  })
  const rows = data?.data ?? []

  const projectOptions = useMemo(() => {
    const seen = new Map<number, string>()
    for (const r of rows) if (r.PROJECT_ID != null) seen.set(r.PROJECT_ID, r.PROJECT_NAME ?? `#${r.PROJECT_ID}`)
    return [...seen.entries()].map(([value, label]) => ({ value: String(value), label }))
  }, [rows])

  const statusOptions = useMemo(() => {
    const seen = new Map<string, string>()
    for (const r of rows) if (r.STATUS_CODE) seen.set(r.STATUS_CODE, r.STATUS_NAME ?? r.STATUS_CODE)
    return [...seen.entries()].map(([value, label]) => ({ value, label }))
  }, [rows])

  const filtered = useMemo(() => {
    let result = rows
    if (statusFilter.size) result = result.filter(r => r.STATUS_CODE && statusFilter.has(r.STATUS_CODE))
    if (catFilter.size)    result = result.filter(r => r.CATEGORY && catFilter.has(r.CATEGORY))
    if (projFilter.size)   result = result.filter(r => r.PROJECT_ID != null && projFilter.has(String(r.PROJECT_ID)))
    const q = search.trim().toLowerCase()
    if (q) result = result.filter(r =>
      `${r.NAME_SHORT ?? ''} ${r.NAME_LONG} ${r.PROJECT_NAME ?? ''} ${r.STATUS_NAME ?? ''} ${r.EMPLOYEE_NAME ?? ''}`.toLowerCase().includes(q))
    return result
  }, [rows, search, statusFilter, catFilter, projFilter])

  const claimedSum  = useMemo(() => filtered.reduce((s, r) => s + (r.AMOUNT_CLAIMED_NET ?? 0), 0), [filtered])
  const approvedSum = useMemo(() => filtered.reduce((s, r) => s + (r.AMOUNT_APPROVED_NET ?? 0), 0), [filtered])

  const kpi = useMemo(() => {
    const terminal = new Set(['COMMISSIONED', 'REJECTED', 'WITHDRAWN'])
    const open         = filtered.filter(r => !r.STATUS_CODE || !terminal.has(r.STATUS_CODE)).length
    const commissioned = filtered.filter(r => r.STATUS_CODE === 'COMMISSIONED' || r.STATUS_CODE === 'PARTIALLY_COMMISSIONED').length
    const rejected     = filtered.filter(r => r.STATUS_CODE === 'REJECTED').length
    const quote        = claimedSum > 0 ? Math.round(approvedSum / claimedSum * 100) : null
    return { open, commissioned, rejected, quote }
  }, [filtered, claimedSum, approvedSum])

  const hasFilter = search.trim() !== '' || statusFilter.size > 0 || catFilter.size > 0 || projFilter.size > 0

  const createMut = useMutation({
    mutationFn: (body: CreateNachtragPayload) => createNachtrag(body),
    onSuccess: (res) => {
      setCreateOpen(false)
      void qc.invalidateQueries({ queryKey: ['nachtraege'] })
      navigate(`/nachtraege/${res.data.ID}`)
    },
    onError: (e: Error) => setMsg({ text: e.message, type: 'error' }),
  })

  return (
    <div>
      {msg && <Message text={msg.text} type={msg.type} />}

      {rows.length > 0 && (
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
          <StatTile label="Nachträge"     value={String(filtered.length)} sub={`${kpi.open} offen`} />
          <StatTile label="Gefordert"     value={fmtEur(claimedSum)} />
          <StatTile label="Freigegeben"   value={fmtEur(approvedSum)} sub={`${kpi.commissioned} beauftragt`} />
          <StatTile label="Freigabequote" value={kpi.quote != null ? `${kpi.quote} %` : '—'} sub={kpi.rejected > 0 ? `${kpi.rejected} abgelehnt` : undefined} />
        </div>
      )}

      <div className="list-toolbar">
        <input type="search" className="list-search" placeholder="Nachträge suchen …" value={search} onChange={e => setSearch(e.target.value)} />
        {!projectId && projectOptions.length > 0 && (
          <FilterChip label="Projekt" options={projectOptions} active={projFilter} onChange={setProj} />
        )}
        <FilterChip label="Status"    options={statusOptions}   active={statusFilter} onChange={setStatus} />
        <FilterChip label="Kategorie" options={CATEGORY_ENTRIES.map(([value, label]) => ({ value, label }))} active={catFilter} onChange={setCat} />
        <Can permission="nachtraege.create">
          <button className="btn-primary" style={{ marginLeft: 'auto' }} onClick={() => setCreateOpen(true)}>+ Nachtrag</button>
        </Can>
      </div>

      {isLoading ? (
        <p style={{ color: 'var(--text-3)', padding: '1rem' }}>Laden …</p>
      ) : filtered.length === 0 ? (
        <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-3)' }}>
          {hasFilter ? (
            <p>Kein Nachtrag passt zu Suche/Filter.</p>
          ) : (
            <>
              <FileDiff size={28} strokeWidth={1.5} style={{ opacity: 0.5 }} />
              <p style={{ marginTop: 8 }}>Noch keine Nachträge.</p>
              <p style={{ fontSize: 13 }}>Nachträge halten Mehr-/Änderungsleistungen fest, geben sie ins Projekt frei und machen sie abrechenbar.</p>
              <Can permission="nachtraege.create">
                <button className="btn-primary" style={{ marginTop: 8 }} onClick={() => setCreateOpen(true)}>+ Ersten Nachtrag anlegen</button>
              </Can>
            </>
          )}
        </div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table className="master-table">
            <thead>
              <tr>
                <th scope="col">Nr.</th><th scope="col">Betreff</th>{!projectId && <th scope="col">Projekt</th>}<th scope="col">Kategorie</th>
                <th scope="col">Status</th><th scope="col" style={{ textAlign: 'right' }}>Gefordert</th>
                <th scope="col" style={{ textAlign: 'right' }}>Freigegeben</th><th scope="col">Prüffrist</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(r => (
                <tr key={r.ID} style={{ cursor: 'pointer' }} onClick={() => navigate(`/nachtraege/${r.ID}`)}>
                  <td>{r.NAME_SHORT ?? `#${r.ID}`}</td>
                  <td>{r.NAME_LONG}</td>
                  {!projectId && <td>{r.PROJECT_NAME ?? '—'}</td>}
                  <td>{r.CATEGORY ? CATEGORY_LABELS[r.CATEGORY] : '—'}</td>
                  <td>
                    <span style={{
                      display: 'inline-block', padding: '2px 8px', borderRadius: 999, fontSize: 11, color: '#fff',
                      background: STATUS_COLORS[r.STATUS_CODE ?? ''] ?? '#6b7280',
                    }}>{r.STATUS_NAME ?? '—'}</span>
                  </td>
                  <td style={{ textAlign: 'right' }}>{fmtEur(r.AMOUNT_CLAIMED_NET)}</td>
                  <td style={{ textAlign: 'right' }}>{fmtEur(r.AMOUNT_APPROVED_NET)}</td>
                  <td>{fmtDate(r.REVIEW_DUE_DATE)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr style={{ fontWeight: 600 }}>
                <td colSpan={projectId ? 4 : 5} style={{ textAlign: 'right' }}>Summe ({filtered.length}):</td>
                <td style={{ textAlign: 'right' }}>{fmtEur(claimedSum)}</td>
                <td style={{ textAlign: 'right' }}>{fmtEur(approvedSum)}</td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title="Nachtrag anlegen">
        <NachtragCreateForm
          projectId={projectId}
          submitting={createMut.isPending}
          onSubmit={(body) => createMut.mutate(body)}
        />
      </Modal>
    </div>
  )
}

function NachtragCreateForm({ projectId, submitting, onSubmit }: {
  projectId?: number
  submitting: boolean
  onSubmit: (body: CreateNachtragPayload) => void
}) {
  const [proj, setProj]     = useState<string>(projectId ? String(projectId) : '')
  const [nameLong, setName] = useState('')
  const [category, setCat]  = useState<string>('')
  const [claim, setClaim]   = useState('')
  const [err, setErr]       = useState<string | null>(null)

  const { data: projData } = useQuery({ queryKey: ['projects-short'], queryFn: fetchProjectsShort, enabled: !projectId })

  function submit() {
    if (!proj)          { setErr('Bitte ein Projekt wählen.'); return }
    if (!nameLong.trim()) { setErr('Bitte einen Betreff angeben.'); return }
    onSubmit({
      project_id: Number(proj),
      name_long:  nameLong.trim(),
      category:   category ? (category as NachtragCategory) : null,
      claim_basis: claim.trim() || undefined,
    })
  }

  return (
    <div className="form-grid" style={{ display: 'grid', gap: 12 }}>
      {err && <Message text={err} type="error" />}
      {!projectId && (
        <label>Projekt *
          <select value={proj} onChange={e => setProj(e.target.value)}>
            <option value="">— wählen —</option>
            {(projData?.data ?? []).map(p => <option key={p.ID} value={p.ID}>{p.NAME_SHORT} — {p.NAME_LONG}</option>)}
          </select>
        </label>
      )}
      <label>Betreff *
        <input type="text" value={nameLong} onChange={e => setName(e.target.value)} placeholder="z. B. Zusätzliche Tiefgaragenebene" />
      </label>
      <label>Kategorie <HelpHint id="nachtrag.kategorie" />
        <select value={category} onChange={e => setCat(e.target.value)}>
          <option value="">— optional —</option>
          {CATEGORY_ENTRIES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </label>
      <label>Anspruchsgrundlage <HelpHint id="nachtrag.anspruchsgrundlage" />
        <input type="text" value={claim} onChange={e => setClaim(e.target.value)} placeholder="z. B. § 650b BGB / § 10 HOAI" />
      </label>
      <DialogFooter>
        <button type="button" className="btn-primary" disabled={submitting} onClick={submit}>{submitting ? 'Anlegen …' : 'Anlegen'}</button>
      </DialogFooter>
    </div>
  )
}
