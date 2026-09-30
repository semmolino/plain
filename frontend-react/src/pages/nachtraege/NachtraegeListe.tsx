import { useState, useMemo } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { FileDiff, Plus } from 'lucide-react'
import { DialogFooter } from '@/components/ui/DialogFooter'
import { FilterChip } from '@/components/ui/FilterChip'
import { FormField } from '@/components/ui/FormField'
import { Can } from '@/components/ui/Can'
import { Modal } from '@/components/ui/Modal'
import { Message } from '@/components/ui/Message'
import { HelpHint } from '@/components/ui/HelpHint'
import { fetchProjectsShort } from '@/api/projekte'
import {
  fetchNachtraege, createNachtrag, CATEGORY_LABELS,
  type NachtragCategory, type CreateNachtragPayload,
} from '@/api/nachtraege'
import { money, NO_VALUE } from '@/utils/money'
import { statusTone } from './nachtragStatus'

const fmtDate = (v: string | null | undefined) => v ? new Date(v).toLocaleDateString('de-DE') : NO_VALUE

const CATEGORY_ENTRIES = Object.entries(CATEGORY_LABELS) as [NachtragCategory, string][]

/** Woher die Detailseite zurückführt — aus dem Projekt zurück ins Projekt (Runde 7). */
export interface NachtragFrom { from: string; fromLabel: string }

export function StatusPill({ code, label }: { code: string | null | undefined; label: string | null | undefined }) {
  return <span className={`nt-status nt-status--${statusTone(code)}`}>{label ?? NO_VALUE}</span>
}

export function NachtraegeListe({ projectId }: { projectId?: number }) {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const [search, setSearch]         = useState('')
  const [statusFilter, setStatus]   = useState<Set<string>>(new Set())
  const [catFilter, setCat]         = useState<Set<string>>(new Set())
  const [projFilter, setProj]       = useState<Set<string>>(new Set())
  const [createOpen, setCreateOpen] = useState(false)

  // Aus dem Projekt geöffnet, führt die Detailseite dorthin zurück — vorher
  // landete man im Modul „Nachträge" und hatte das Projekt verloren.
  const from: NachtragFrom = projectId
    ? { from: `/projekte?projectId=${projectId}&tab=nachtraege`, fromLabel: 'Projekt' }
    : { from: '/nachtraege', fromLabel: 'Nachträge' }
  const open = (id: number) => navigate(`/nachtraege/${id}`, { state: from })

  const { data, isLoading, isError } = useQuery({
    queryKey: ['nachtraege', projectId ?? 'all'],
    queryFn:  () => fetchNachtraege(projectId),
  })
  const rows = useMemo(() => data?.data ?? [], [data])

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
      `${r.ABBR ?? ''} ${r.NAME} ${r.PROJECT_NAME ?? ''} ${r.STATUS_NAME ?? ''} ${r.EMPLOYEE_NAME ?? ''}`.toLowerCase().includes(q))
    return result
  }, [rows, search, statusFilter, catFilter, projFilter])

  const claimedSum  = useMemo(() => filtered.reduce((s, r) => s + (r.AMOUNT_CLAIMED_NET ?? 0), 0), [filtered])
  const approvedSum = useMemo(() => filtered.reduce((s, r) => s + (r.AMOUNT_APPROVED_NET ?? 0), 0), [filtered])

  const kpi = useMemo(() => {
    const terminal = new Set(['COMMISSIONED', 'REJECTED', 'WITHDRAWN'])
    const openCount    = filtered.filter(r => !r.STATUS_CODE || !terminal.has(r.STATUS_CODE)).length
    const commissioned = filtered.filter(r => r.STATUS_CODE === 'COMMISSIONED' || r.STATUS_CODE === 'PARTIALLY_COMMISSIONED').length
    const rejected     = filtered.filter(r => r.STATUS_CODE === 'REJECTED').length
    const quote        = claimedSum > 0 ? Math.round(approvedSum / claimedSum * 100) : null
    return { open: openCount, commissioned, rejected, quote }
  }, [filtered, claimedSum, approvedSum])


  const createMut = useMutation({
    mutationFn: (body: CreateNachtragPayload) => createNachtrag(body),
    onSuccess: (res) => {
      setCreateOpen(false)
      void qc.invalidateQueries({ queryKey: ['nachtraege'] })
      open(res.data.ID)
    },
  })

  const createButton = (label: string) => (
    <Can permission="nachtraege.create">
      <button type="button" className="btn-primary nt-new" onClick={() => { createMut.reset(); setCreateOpen(true) }}>
        <Plus size={14} strokeWidth={2} aria-hidden="true" /> {label}
      </button>
    </Can>
  )

  return (
    <div className="nt-list">
      {rows.length > 0 && (
        <div className="ws-tiles">
          <div className="ws-tile">
            <div className="ws-tile-label">Nachträge</div>
            <div className="ws-tile-value">{filtered.length}</div>
            <div className="ws-tile-sub">{kpi.open} offen</div>
          </div>
          <div className="ws-tile">
            <div className="ws-tile-label">Gefordert</div>
            <div className="ws-tile-value">{money(claimedSum)}</div>
          </div>
          <div className="ws-tile">
            <div className="ws-tile-label">Freigegeben</div>
            <div className="ws-tile-value">{money(approvedSum)}</div>
            <div className="ws-tile-sub">{kpi.commissioned} beauftragt</div>
          </div>
          <div className="ws-tile">
            <div className="ws-tile-label">Freigabequote</div>
            <div className="ws-tile-value">{kpi.quote != null ? `${kpi.quote} %` : NO_VALUE}</div>
            {kpi.rejected > 0 && <div className="ws-tile-sub">{kpi.rejected} abgelehnt</div>}
          </div>
        </div>
      )}

      <div className="list-toolbar">
        <input type="search" className="list-search" placeholder="Nachträge suchen …" aria-label="Nachträge suchen"
          value={search} onChange={e => setSearch(e.target.value)} />
        {!projectId && projectOptions.length > 0 && (
          <FilterChip label="Projekt" options={projectOptions} active={projFilter} onChange={setProj} />
        )}
        <FilterChip label="Status"    options={statusOptions}   active={statusFilter} onChange={setStatus} />
        <FilterChip label="Kategorie" options={CATEGORY_ENTRIES.map(([value, label]) => ({ value, label }))} active={catFilter} onChange={setCat} />
        <HelpHint id="nachtrag.overview" />
        {rows.length > 0 && createButton('Nachtrag')}
      </div>

      {isLoading ? (
        <p className="ls-empty">Lädt …</p>
      ) : isError ? (
        <Message type="error" text="Die Nachträge konnten nicht geladen werden." />
      ) : rows.length === 0 ? (
        <div className="empty-block">
          <FileDiff size={28} strokeWidth={1.5} aria-hidden="true" className="nt-empty-icon" />
          <p className="empty-note">{projectId ? 'Zu diesem Projekt gibt es noch keine Nachträge.' : 'Noch keine Nachträge.'}</p>
          <p className="empty-block-why">
            Ein Nachtrag hält eine Mehr- oder Änderungsleistung fest. Er wird geprüft, ganz oder teilweise ins
            Projekt freigegeben und ist danach buch- und abrechenbar.
          </p>
          {createButton('Ersten Nachtrag anlegen')}
        </div>
      ) : filtered.length === 0 ? (
        <p className="ls-empty">Kein Nachtrag passt zu Suche und Filter.</p>
      ) : (
        <div className="table-scroll">
          <table className="master-table">
            <thead>
              <tr>
                <th scope="col">Nachtrag</th>
                {!projectId && <th scope="col">Projekt</th>}
                <th scope="col">Kategorie</th>
                <th scope="col">Status</th>
                <th scope="col" className="num">Gefordert</th>
                <th scope="col" className="num">Freigegeben</th>
                <th scope="col">Prüffrist <HelpHint id="nachtrag.fristen" size={12} /></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(r => (
                <tr key={r.ID} className="nt-row" onClick={() => open(r.ID)}>
                  <td>
                    {/* Der Link macht die Zeile per Tastatur erreichbar — vorher ging
                        sie nur per Klick auf die Zeile. */}
                    <Link to={`/nachtraege/${r.ID}`} state={from} className="nt-link" onClick={e => e.stopPropagation()}>
                      <span className="nt-abbr">{r.ABBR ?? `#${r.ID}`}</span>
                      <span className="nt-name">{r.NAME}</span>
                    </Link>
                  </td>
                  {!projectId && <td>{r.PROJECT_NAME ?? NO_VALUE}</td>}
                  <td>{r.CATEGORY ? CATEGORY_LABELS[r.CATEGORY] : NO_VALUE}</td>
                  <td><StatusPill code={r.STATUS_CODE} label={r.STATUS_NAME} /></td>
                  <td className="num">{money(r.AMOUNT_CLAIMED_NET)}</td>
                  <td className="num">{money(r.AMOUNT_APPROVED_NET)}</td>
                  <td>{fmtDate(r.REVIEW_DUE_DATE)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="nt-sum">
                <td colSpan={projectId ? 3 : 4}>Summe ({filtered.length})</td>
                <td className="num">{money(claimedSum)}</td>
                <td className="num">{money(approvedSum)}</td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {createOpen && (
        <Modal open onClose={() => setCreateOpen(false)} title="Nachtrag anlegen">
          <NachtragCreateForm
            projectId={projectId}
            submitting={createMut.isPending}
            error={createMut.error ? (createMut.error as Error).message : null}
            onCancel={() => setCreateOpen(false)}
            onSubmit={(body) => createMut.mutate(body)}
          />
        </Modal>
      )}
    </div>
  )
}

function NachtragCreateForm({ projectId, submitting, error, onCancel, onSubmit }: {
  projectId?: number
  submitting: boolean
  error:      string | null
  onCancel:   () => void
  onSubmit:   (body: CreateNachtragPayload) => void
}) {
  const [proj, setProj]     = useState<string>(projectId ? String(projectId) : '')
  const [name, setName]     = useState('')
  const [category, setCat]  = useState<string>('')
  const [claim, setClaim]   = useState('')
  const [err, setErr]       = useState<string | null>(null)

  const { data: projData } = useQuery({ queryKey: ['projects-short'], queryFn: fetchProjectsShort, enabled: !projectId })

  function submit() {
    if (!proj)        { setErr('Bitte ein Projekt wählen.'); return }
    if (!name.trim()) { setErr('Bitte einen Betreff angeben.'); return }
    setErr(null)
    onSubmit({
      project_id:  Number(proj),
      name:        name.trim(),
      category:    category ? (category as NachtragCategory) : null,
      claim_basis: claim.trim() || undefined,
    })
  }

  return (
    <div className="master-form nt-dialog">
      {!projectId && (
        <div className="form-group">
          <label htmlFor="nt-new-project">Projekt</label>
          <select id="nt-new-project" value={proj} onChange={e => setProj(e.target.value)}>
            <option value="">— wählen —</option>
            {(projData?.data ?? []).map(p => <option key={p.ID} value={p.ID}>{p.ABBR} — {p.NAME}</option>)}
          </select>
        </div>
      )}
      <FormField label="Betreff" id="nt-new-name" value={name} data-autofocus required
        onChange={e => setName(e.target.value)} placeholder="z. B. Zusätzliche Tiefgaragenebene" />
      <div className="form-group">
        <label htmlFor="nt-new-cat" className="ws-label-help">Kategorie <HelpHint id="nachtrag.kategorie" size={13} /></label>
        <select id="nt-new-cat" value={category} onChange={e => setCat(e.target.value)}>
          <option value="">— optional —</option>
          {CATEGORY_ENTRIES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </div>
      <div className="form-group">
        <label htmlFor="nt-new-claim" className="ws-label-help">Anspruchsgrundlage <HelpHint id="nachtrag.anspruchsgrundlage" size={13} /></label>
        <input id="nt-new-claim" type="text" value={claim} onChange={e => setClaim(e.target.value)} placeholder="z. B. § 650b BGB / § 10 HOAI" />
      </div>
      <Message text={err ?? error} type="error" />
      <p className="form-field-hint">Positionen und Beträge folgen im Nachtrag selbst.</p>
      <DialogFooter>
        <button type="button" className="btn-secondary" onClick={onCancel}>Abbrechen</button>
        <button type="button" className="btn-primary" disabled={submitting} onClick={submit}>{submitting ? 'Legt an …' : 'Anlegen'}</button>
      </DialogFooter>
    </div>
  )
}

