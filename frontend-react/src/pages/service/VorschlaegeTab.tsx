import { useMemo, useState } from 'react'
import { useStickyState } from '@/hooks/useStickyState'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Lightbulb, Megaphone, ChevronUp, MessageSquare, Plus, X } from 'lucide-react'
import { Modal } from '@/components/ui/Modal'
import { HelpHint } from '@/components/ui/HelpHint'
import { InfoHint } from '@/components/ui/InfoHint'
import { usePermission } from '@/store/permissionsStore'
import { fetchEmployeeList } from '@/api/mitarbeiter'
import {
  fetchBoard, fetchMineSuggestions, fetchSuggestion, submitSuggestion,
  voteSuggestion, unvoteSuggestion, commentSuggestion, saveDelegate, fetchDelegate,
  SUGGESTION_CATEGORIES,
  type BoardItem, type MineItem, type LifecycleStatus, type PriorityHint,
} from '@/api/service'
import { AttachmentPicker, AttachmentStrip, uploadAttachments } from './attachments'

// ── Status-/Kategorie-Helfer ─────────────────────────────────────────────────
const LIFECYCLE: Record<LifecycleStatus, { label: string; cls: string }> = {
  new:         { label: 'Neu',                    cls: 'sg-st-new' },
  reviewing:   { label: 'In Prüfung',             cls: 'sg-st-reviewing' },
  planned:     { label: 'Geplant',                cls: 'sg-st-planned' },
  in_progress: { label: 'In Umsetzung',           cls: 'sg-st-progress' },
  shipped:     { label: 'Umgesetzt',              cls: 'sg-st-shipped' },
  not_planned: { label: 'Aktuell nicht geplant',  cls: 'sg-st-notplanned' },
}
const CAT_LABEL = Object.fromEntries(SUGGESTION_CATEGORIES.map(c => [c.value, c.label]))

function mineStatus(m: MineItem): { label: string; cls: string } {
  if (m.moderation_state === 'pending')  return { label: 'Wird geprüft',        cls: 'sg-st-reviewing' }
  if (m.moderation_state === 'declined') return { label: 'Nicht veröffentlicht', cls: 'sg-st-notplanned' }
  if (m.moderation_state === 'merged')   return { label: 'Zusammengeführt',      cls: 'sg-st-new' }
  return LIFECYCLE[m.lifecycle_status]
}

function StatusBadge({ status }: { status: { label: string; cls: string } }) {
  return <span className={`sg-badge ${status.cls}`}>{status.label}</span>
}
function CatBadge({ cat }: { cat: string }) {
  return <span className="sg-cat">{CAT_LABEL[cat] || cat}</span>
}

// ── Hauptkomponente ──────────────────────────────────────────────────────────
export function VorschlaegeTab() {
  const isAdmin = usePermission('service.suggestions.admin')
  const [view, setView] = useState<'board' | 'mine'>('board')
  const [submitOpen, setSubmitOpen] = useState(false)
  const [detailId, setDetailId] = useState<number | null>(null)

  return (
    <div className="service-tab">
      <div className="service-tab-head">
        <h2>Vorschläge für Funktionen</h2>
        <HelpHint id="service.vorschlaege" />
      </div>
      <p className="service-tab-lead">
        Wünschen Sie sich eine Funktion? Reichen Sie sie ein. Nach Prüfung durch plan&amp;simple erscheint
        sie im Portal, wo der Produkt-Sprecher Ihrer Organisation abstimmen kann. Andere Anwender sehen
        dabei niemals Ihren Namen oder Ihre Organisation.
      </p>

      {isAdmin && <DelegateCard />}

      <div className="list-toolbar">
        <div className="seg-nav">
          <button type="button" className={`seg-nav-btn${view === 'board' ? ' active' : ''}`} onClick={() => setView('board')}>Portal</button>
          <button type="button" className={`seg-nav-btn${view === 'mine' ? ' active' : ''}`} onClick={() => setView('mine')}>Meine / Unsere</button>
        </div>
        <button className="btn-primary" style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 6 }} onClick={() => setSubmitOpen(true)}>
          <Plus size={15} strokeWidth={2.5} /> Vorschlag einreichen
        </button>
      </div>

      {view === 'board' ? <BoardView onOpen={setDetailId} /> : <MineView />}

      {submitOpen && <SubmitModal onClose={() => setSubmitOpen(false)} />}
      {detailId != null && <DetailModal id={detailId} onClose={() => setDetailId(null)} />}
    </div>
  )
}

// ── Board (veröffentlicht, pseudonym) ────────────────────────────────────────
function BoardView({ onOpen }: { onOpen: (id: number) => void }) {
  const qc = useQueryClient()
  const [sort, setSort] = useStickyState<'popular' | 'new'>('service.vorschlaege.sort', 'popular')
  const [search, setSearch] = useState('')
  const [cat, setCat] = useStickyState<string>('service.vorschlaege.cat', '')

  const boardQuery = useQuery({ queryKey: ['service', 'board', sort], queryFn: () => fetchBoard(sort) })

  const vote = useMutation({
    mutationFn: ({ id, on }: { id: number; on: boolean }) => (on ? voteSuggestion(id) : unvoteSuggestion(id)),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['service', 'board'] }),
  })

  const items = boardQuery.data?.data ?? []
  const canVote = boardQuery.data?.can_vote ?? false
  const filtered = useMemo(() => items.filter(i =>
    (!cat || i.category === cat) &&
    (!search || (i.title + ' ' + i.body).toLowerCase().includes(search.toLowerCase()))
  ), [items, cat, search])

  return (
    <>
      <div className="list-toolbar" style={{ marginTop: 4 }}>
        <input className="list-search" type="search" placeholder="Vorschläge durchsuchen …" value={search} onChange={e => setSearch(e.target.value)} />
        <select className="inline-date-input" value={cat} onChange={e => setCat(e.target.value)}>
          <option value="">Alle Bereiche</option>
          {SUGGESTION_CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
        </select>
        <select className="inline-date-input" value={sort} onChange={e => setSort(e.target.value as 'popular' | 'new')}>
          <option value="popular">Beliebt</option>
          <option value="new">Neu</option>
        </select>
      </div>

      {boardQuery.isLoading ? (
        <p className="service-hint-muted">Laden …</p>
      ) : filtered.length === 0 ? (
        <div className="service-empty">
          <div className="service-empty-icon"><Lightbulb size={26} strokeWidth={1.5} /></div>
          <h3>{items.length === 0 ? 'Noch keine Vorschläge im Portal' : 'Kein Treffer'}</h3>
          <p>{items.length === 0
            ? 'Sobald plan&simple den ersten Vorschlag freigibt, erscheint er hier. Reichen Sie gern den ersten ein — so fließt Ihre Praxis direkt in die Software ein.'
            : 'Für Suche/Filter gibt es keine passenden Vorschläge.'}</p>
        </div>
      ) : (
        <div className="sg-list">
          {filtered.map(item => (
            <BoardCard key={item.id} item={item} canVote={canVote}
              onVote={(on) => vote.mutate({ id: item.id, on })}
              voting={vote.isPending}
              onOpen={() => onOpen(item.id)} />
          ))}
        </div>
      )}
    </>
  )
}

function BoardCard({ item, canVote, onVote, voting, onOpen }: {
  item: BoardItem; canVote: boolean; onVote: (on: boolean) => void; voting: boolean; onOpen: () => void
}) {
  return (
    <div className="sg-card">
      <button
        type="button"
        className={`sg-vote${item.has_my_vote ? ' voted' : ''}`}
        disabled={!canVote || voting}
        title={canVote ? (item.has_my_vote ? 'Stimme zurückziehen' : 'Abstimmen') : 'Abstimmen kann der Produkt-Sprecher Ihrer Organisation'}
        onClick={() => onVote(!item.has_my_vote)}
      >
        <ChevronUp size={16} strokeWidth={2.5} />
        <span>{item.vote_count}</span>
      </button>
      <div className="sg-card-main" onClick={onOpen} role="button" tabIndex={0}
        onKeyDown={e => { if (e.key === 'Enter') onOpen() }}>
        <div className="sg-card-title">{item.title}</div>
        <div className="sg-card-body">{item.body}</div>
        <div className="sg-card-foot">
          <CatBadge cat={item.category} />
          <StatusBadge status={LIFECYCLE[item.lifecycle_status]} />
          <span className="sg-comments"><MessageSquare size={13} strokeWidth={1.75} /> {item.comment_count}</span>
        </div>
      </div>
    </div>
  )
}

// ── Meine / Unsere Vorschläge ────────────────────────────────────────────────
function MineView() {
  const mineQuery = useQuery({ queryKey: ['service', 'mine'], queryFn: () => fetchMineSuggestions() })
  const [search, setSearch] = useState('')

  const rows = mineQuery.data?.data ?? []
  const orgView = mineQuery.data?.org_view ?? false
  const filtered = rows.filter(r => !search || (r.title + ' ' + r.body).toLowerCase().includes(search.toLowerCase()))

  if (mineQuery.isLoading) return <p className="service-hint-muted">Laden …</p>

  return (
    <>
      <div className="list-toolbar" style={{ marginTop: 4 }}>
        <input className="list-search" type="search" placeholder="Durchsuchen …" value={search} onChange={e => setSearch(e.target.value)} />
      </div>
      {filtered.length === 0 ? (
        <div className="service-empty">
          <div className="service-empty-icon"><Lightbulb size={26} strokeWidth={1.5} /></div>
          <h3>{rows.length === 0 ? 'Noch keine eigenen Vorschläge' : 'Kein Treffer'}</h3>
          <p>{rows.length === 0
            ? 'Reichen Sie über „Vorschlag einreichen" Ihre erste Funktionsidee ein. Sie sehen hier jederzeit den Status.'
            : 'Für die Suche gibt es keinen passenden Vorschlag.'}</p>
        </div>
      ) : (
        <div className="sg-list">
          {filtered.map(m => (
            <div key={m.id} className="sg-card sg-card-mine">
              <div className="sg-card-main">
                <div className="sg-card-title">{m.title}</div>
                <div className="sg-card-body">{m.body}</div>
                <div className="sg-card-foot">
                  <CatBadge cat={m.category} />
                  <StatusBadge status={mineStatus(m)} />
                  <span className="sg-comments"><ChevronUp size={13} strokeWidth={2} /> {m.vote_count}</span>
                  {orgView && m.submitter && <span className="sg-submitter">von {m.submitter}</span>}
                </div>
                {m.vendor_responses.length > 0 && (
                  <div className="sg-vendor">
                    {m.vendor_responses.map((r, i) => (
                      <div key={i} className="sg-vendor-msg"><strong>plan&amp;simple:</strong> {r.body}</div>
                    ))}
                  </div>
                )}
                <AttachmentStrip kind="suggestions" id={m.id} canDelete={m.is_mine} />
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  )
}

// ── Einreich-Modal ───────────────────────────────────────────────────────────
function SubmitModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient()
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [category, setCategory] = useState('sonstiges')
  const [priority, setPriority] = useState<PriorityHint | ''>('')
  const [files, setFiles] = useState<File[]>([])

  const submit = useMutation({
    mutationFn: async () => {
      const res = await submitSuggestion({ title, body, category, priority_hint: priority || null })
      if (files.length) await uploadAttachments('suggestions', res.data.ID, files)
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['service', 'mine'] })
      onClose()
    },
  })

  const valid = title.trim().length > 0 && body.trim().length > 0

  return (
    <Modal open onClose={onClose} title="Vorschlag einreichen">
      <div className="sg-form">
        <label className="sg-field">
          <span>Titel</span>
          <input className="list-search" maxLength={80} value={title} onChange={e => setTitle(e.target.value)} placeholder="Worum geht es in einem Satz?" />
        </label>
        <label className="sg-field">
          <span>Bereich</span>
          <select className="inline-date-input" value={category} onChange={e => setCategory(e.target.value)}>
            {SUGGESTION_CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
          </select>
        </label>
        <label className="sg-field">
          <span>Beschreibung</span>
          <textarea className="sg-textarea" rows={5} value={body} onChange={e => setBody(e.target.value)}
            placeholder="Was möchten Sie tun? Was fehlt heute? Welchen Nutzen hätte es?" />
        </label>
        <label className="sg-field">
          <span>Wie wichtig ist es Ihnen?</span>
          <div className="seg-nav">
            {([['', 'Keine Angabe'], ['nice', 'Nice-to-have'], ['important', 'Wichtig'], ['blocker', 'Blocker']] as const).map(([v, l]) => (
              <button key={v} type="button" className={`seg-nav-btn${priority === v ? ' active' : ''}`} onClick={() => setPriority(v as PriorityHint | '')}>{l}</button>
            ))}
          </div>
        </label>
        <label className="sg-field">
          <span>Screenshots (optional)</span>
          <AttachmentPicker files={files} onChange={setFiles} />
        </label>
        <p className="service-hint-muted">
          Bitte keine personenbezogenen Daten Dritter oder vertrauliche Geschäftsdaten eingeben.
        </p>
        {submit.isError && <p className="consent-error">Einreichen fehlgeschlagen. Bitte erneut versuchen.</p>}
        <div className="consent-actions" style={{ gap: 8 }}>
          <button type="button" className="btn-small" onClick={onClose}>Abbrechen</button>
          <button type="button" className="btn-primary" disabled={!valid || submit.isPending} onClick={() => submit.mutate()}>
            {submit.isPending ? 'Wird gesendet …' : 'Einreichen'}
          </button>
        </div>
      </div>
    </Modal>
  )
}

// ── Detail-Modal (Board) mit Kommentaren ─────────────────────────────────────
function DetailModal({ id, onClose }: { id: number; onClose: () => void }) {
  const qc = useQueryClient()
  const [comment, setComment] = useState('')
  const detailQuery = useQuery({ queryKey: ['service', 'suggestion', id], queryFn: () => fetchSuggestion(id) })

  const vote = useMutation({
    mutationFn: (on: boolean) => (on ? voteSuggestion(id) : unvoteSuggestion(id)),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['service', 'suggestion', id] })
      qc.invalidateQueries({ queryKey: ['service', 'board'] })
    },
  })
  const postComment = useMutation({
    mutationFn: () => commentSuggestion(id, comment),
    onSuccess: () => { setComment(''); qc.invalidateQueries({ queryKey: ['service', 'suggestion', id] }) },
  })

  const d = detailQuery.data?.data

  return (
    <Modal open onClose={onClose} title={d?.title || 'Vorschlag'}>
      {detailQuery.isLoading || !d ? (
        <p className="service-hint-muted">Laden …</p>
      ) : (
        <div className="sg-detail">
          <div className="sg-detail-head">
            <button type="button" className={`sg-vote${d.has_my_vote ? ' voted' : ''}`} disabled={!d.can_vote || vote.isPending}
              title={d.can_vote ? (d.has_my_vote ? 'Stimme zurückziehen' : 'Abstimmen') : 'Abstimmen kann der Produkt-Sprecher Ihrer Organisation'}
              onClick={() => vote.mutate(!d.has_my_vote)}>
              <ChevronUp size={16} strokeWidth={2.5} /><span>{d.vote_count}</span>
            </button>
            <div>
              <CatBadge cat={d.category} />{' '}
              <StatusBadge status={LIFECYCLE[d.lifecycle_status]} />
            </div>
          </div>
          <div className="sg-detail-body">{d.body}</div>

          {d.is_own_org && <AttachmentStrip kind="suggestions" id={id} />}

          <h4 className="sg-comments-title">Kommentare</h4>
          {d.comments.length === 0 ? (
            <p className="service-hint-muted">Noch keine Kommentare.</p>
          ) : (
            <div className="sg-comment-list">
              {d.comments.map((c, i) => (
                <div key={i} className={`sg-comment${c.is_official ? ' official' : ''}`}>
                  <div className="sg-comment-author">{c.author}</div>
                  <div className="sg-comment-body">{c.body}</div>
                </div>
              ))}
            </div>
          )}

          {d.can_vote && (
            <div className="sg-comment-form">
              <textarea className="sg-textarea" rows={2} value={comment} onChange={e => setComment(e.target.value)}
                placeholder="Kommentar (wird vor Veröffentlichung von plan&simple geprüft) …" />
              <button type="button" className="btn-primary btn-small" disabled={!comment.trim() || postComment.isPending}
                onClick={() => postComment.mutate()}>Senden</button>
            </div>
          )}
          {postComment.isSuccess && <p className="service-hint-muted">Danke — Ihr Kommentar wird geprüft und erscheint nach Freigabe.</p>}
        </div>
      )}
    </Modal>
  )
}

// ── Produkt-Sprecher festlegen (aus Phase 0 hierher gezogen) ─────────────────
function DelegateCard() {
  const qc = useQueryClient()
  const [selected, setSelected] = useState<string>('')

  const delegateQuery = useQuery({ queryKey: ['service', 'delegate'], queryFn: () => fetchDelegate() })
  const employeesQuery = useQuery({ queryKey: ['service', 'delegate', 'employees'], queryFn: () => fetchEmployeeList(), retry: false })

  const save = useMutation({
    mutationFn: (empId: number | null) => saveDelegate(empId),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['service', 'delegate'] }); setSelected('') },
  })

  const employees = employeesQuery.data?.data ?? []
  const current = delegateQuery.data

  return (
    <div className="service-card">
      <div className="service-card-head">
        <Megaphone size={16} strokeWidth={1.75} />
        <strong>Produkt-Sprecher Ihrer Organisation</strong>
        <InfoHint title="Produkt-Sprecher" align="right">
          Damit nicht eine einzelne Organisation Wünsche überproportional hochstimmt, darf pro Organisation
          genau <strong>ein</strong> Mitarbeiter im Portal abstimmen und kommentieren. Alle anderen können
          Vorschläge weiterhin einsehen und einreichen.
        </InfoHint>
      </div>
      <p className="service-card-current">
        Aktuell: {current?.employee_name ? <strong>{current.employee_name}</strong> : <em>noch nicht festgelegt</em>}
      </p>
      {employeesQuery.isError ? (
        <p className="service-hint-muted">Zur Auswahl wird die Berechtigung „Mitarbeiter sehen" benötigt.</p>
      ) : (
        <div className="service-delegate-row">
          <select className="list-search" value={selected} onChange={e => setSelected(e.target.value)} style={{ maxWidth: 280 }}>
            <option value="">Mitarbeiter auswählen …</option>
            {employees.map(e => (
              <option key={e.ID} value={e.ID}>{e.NAME || `${e.FIRST_NAME} ${e.LAST_NAME}`.trim() || e.SHORT_NAME}</option>
            ))}
          </select>
          <button type="button" className="btn-primary" disabled={!selected || save.isPending} onClick={() => save.mutate(Number(selected))}>Festlegen</button>
          {current?.employee_id != null && (
            <button type="button" className="btn-small" disabled={save.isPending} onClick={() => save.mutate(null)} title="Zurücksetzen">
              <X size={13} strokeWidth={2.5} />
            </button>
          )}
        </div>
      )}
      {save.isError && <p className="consent-error">Speichern fehlgeschlagen. Bitte erneut versuchen.</p>}
    </div>
  )
}
