import { useEffect, useState } from 'react'
import {
  api, ApiError, openConsoleFile,
  type ModSuggestion, type ModComment, type PendingComment, type SgLifecycle, type AttachmentRow,
} from '../api'

const STATES: { id: string; label: string }[] = [
  { id: 'pending', label: 'Neu / zu prüfen' },
  { id: 'published', label: 'Veröffentlicht' },
  { id: 'declined', label: 'Abgelehnt' },
  { id: 'merged', label: 'Zusammengeführt' },
  { id: 'all', label: 'Alle' },
]

const LIFECYCLE: { id: SgLifecycle; label: string }[] = [
  { id: 'new', label: 'Neu' },
  { id: 'reviewing', label: 'In Prüfung' },
  { id: 'planned', label: 'Geplant' },
  { id: 'in_progress', label: 'In Umsetzung' },
  { id: 'shipped', label: 'Umgesetzt' },
  { id: 'not_planned', label: 'Aktuell nicht geplant' },
]

export function SuggestionsView() {
  const [state, setState] = useState<string>('pending')
  const [rows, setRows] = useState<ModSuggestion[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<number | null>(null)
  const [pending, setPending] = useState<PendingComment[]>([])

  async function load() {
    try {
      const [s, pc] = await Promise.all([api.suggestions(state), api.pendingComments()])
      setRows(s.suggestions)
      setPending(pc.comments)
      setError(null)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Laden fehlgeschlagen.')
    }
  }
  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state])

  if (!rows) return <div className="muted">Lädt…</div>

  return (
    <div>
      <h2>Vorschläge — Moderation</h2>
      <p className="muted">
        Einzige Stelle mit echten Identitäten. Vor der Freigabe den öffentlichen Text prüfen/bereinigen —
        andere Anwender sehen nur die <strong>PUBLIC</strong>-Felder, nie Name/Organisation. Alle Aktionen werden auditiert.
      </p>
      {error && <div className="error">{error}</div>}

      {pending.length > 0 && (
        <div className="card" style={{ marginBottom: 16 }}>
          <strong>Kommentare zur Freigabe ({pending.length})</strong>
          <table className="grid" style={{ marginTop: 8 }}>
            <tbody>
              {pending.map((c) => (
                <tr key={c.id}>
                  <td style={{ width: 60 }}>#{c.suggestion_id}</td>
                  <td>{c.body}</td>
                  <td style={{ width: 180, whiteSpace: 'nowrap' }}>
                    <button className="link" onClick={() => moderateComment(c.id, 'publish')}>Freigeben</button>
                    {' · '}
                    <button className="link" onClick={() => moderateComment(c.id, 'decline')}>Ablehnen</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <nav className="tabs" style={{ marginBottom: 12 }}>
        {STATES.map((s) => (
          <button key={s.id} className={state === s.id ? 'active' : ''} onClick={() => { setState(s.id); setSelected(null) }}>
            {s.label}
          </button>
        ))}
      </nav>

      <div className="table-scroll">
        <table className="grid">
          <thead>
            <tr><th>#</th><th>Organisation</th><th>Einreicher</th><th>Titel</th><th>Bereich</th><th>Status</th><th>Stimmen</th></tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className={selected === r.id ? 'active' : ''} style={{ cursor: 'pointer' }}
                onClick={() => setSelected(selected === r.id ? null : r.id)}>
                <td>#{r.id}</td>
                <td>{r.org_name}</td>
                <td>{r.submitter_name}</td>
                <td>{r.title}</td>
                <td>{r.category}</td>
                <td>{r.moderation_state} / {r.lifecycle_status}</td>
                <td>{r.vote_count}</td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={7} className="muted">Keine Vorschläge in diesem Status.</td></tr>}
          </tbody>
        </table>
      </div>

      {selected != null && <Editor id={selected} onChanged={load} onClose={() => setSelected(null)} />}
    </div>
  )

  async function moderateComment(id: number, action: 'publish' | 'decline') {
    try {
      await api.moderateComment(id, action)
      await load()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Aktion fehlgeschlagen.')
    }
  }
}

function Editor({ id, onChanged, onClose }: { id: number; onChanged: () => void; onClose: () => void }) {
  const [sug, setSug] = useState<ModSuggestion | null>(null)
  const [comments, setComments] = useState<ModComment[]>([])
  const [attachments, setAttachments] = useState<AttachmentRow[]>([])
  const [pubTitle, setPubTitle] = useState('')
  const [pubBody, setPubBody] = useState('')
  const [lifecycle, setLifecycle] = useState<SgLifecycle>('new')
  const [reply, setReply] = useState('')
  const [replyVis, setReplyVis] = useState<'public' | 'vendor_only'>('public')
  const [mergeInto, setMergeInto] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function load() {
    const d = await api.suggestionDetail(id)
    setSug(d.suggestion)
    setComments(d.comments)
    setAttachments(d.attachments || [])
    setPubTitle(d.suggestion.public_title ?? d.suggestion.title)
    setPubBody(d.suggestion.public_body ?? d.suggestion.body)
    setLifecycle(d.suggestion.lifecycle_status)
  }
  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  async function run(fn: () => Promise<unknown>) {
    setBusy(true)
    setErr(null)
    try {
      await fn()
      await load()
      onChanged()
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Aktion fehlgeschlagen.')
    } finally {
      setBusy(false)
    }
  }

  if (!sug) return <div className="card" style={{ marginTop: 16 }}>Lädt…</div>

  return (
    <div className="card" style={{ marginTop: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h3 style={{ margin: 0 }}>#{sug.id} — {sug.org_name} · {sug.submitter_name} {sug.submitter_mail ? `(${sug.submitter_mail})` : ''}</h3>
        <button className="link" onClick={onClose}>Schließen</button>
      </div>
      {err && <div className="error">{err}</div>}

      <div className="muted" style={{ marginTop: 8 }}>Originaltext (privat):</div>
      <div style={{ background: '#0000000a', borderRadius: 6, padding: '8px 10px', whiteSpace: 'pre-line' }}>
        <strong>{sug.title}</strong>
        <div>{sug.body}</div>
      </div>

      {attachments.length > 0 && (
        <div style={{ marginTop: 8 }}>
          <span className="muted">Anhänge: </span>
          {attachments.map((a) => (
            <button key={a.id} className="link" style={{ marginRight: 10 }}
              onClick={() => openConsoleFile(`/suggestions/${id}/attachments/${a.id}/file`)}>{a.filename}</button>
          ))}
        </div>
      )}

      <div style={{ marginTop: 12, display: 'grid', gap: 8 }}>
        <label className="muted">Öffentlicher Titel
          <input style={{ width: '100%' }} value={pubTitle} onChange={(e) => setPubTitle(e.target.value)} />
        </label>
        <label className="muted">Öffentlicher Text
          <textarea style={{ width: '100%' }} rows={4} value={pubBody} onChange={(e) => setPubBody(e.target.value)} />
        </label>
        <label className="muted">Öffentlicher Status
          <select value={lifecycle} onChange={(e) => setLifecycle(e.target.value as SgLifecycle)}>
            {LIFECYCLE.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}
          </select>
        </label>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button disabled={busy} onClick={() => run(() => api.patchSuggestion(id, { public_title: pubTitle, public_body: pubBody, lifecycle_status: lifecycle }))}>
            Speichern
          </button>
          {sug.moderation_state !== 'published' && (
            <button disabled={busy} onClick={() => run(async () => { await api.patchSuggestion(id, { public_title: pubTitle, public_body: pubBody, lifecycle_status: lifecycle }); await api.publishSuggestion(id) })}>
              Freigeben & veröffentlichen
            </button>
          )}
          {sug.moderation_state !== 'declined' && (
            <button disabled={busy} onClick={() => run(() => api.declineSuggestion(id))}>Ablehnen</button>
          )}
        </div>

        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input style={{ width: 120 }} placeholder="Ziel-#" value={mergeInto} onChange={(e) => setMergeInto(e.target.value)} />
          <button disabled={busy || !mergeInto} onClick={() => run(() => api.mergeSuggestion(id, Number(mergeInto)))}>Als Duplikat zusammenführen</button>
        </div>

        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {sug.jira_issue_key ? (
            <span className="muted">
              Jira:{' '}
              {sug.jira_url
                ? <a href={sug.jira_url} target="_blank" rel="noreferrer">{sug.jira_issue_key}</a>
                : <strong>{sug.jira_issue_key}</strong>}
            </span>
          ) : (
            <button disabled={busy} onClick={() => run(() => api.createJiraIssue(id))}>Als Jira-Ticket anlegen</button>
          )}
        </div>
      </div>

      <h4 style={{ marginBottom: 6 }}>Kommunikation</h4>
      <div style={{ display: 'grid', gap: 6 }}>
        {comments.length === 0 && <div className="muted">Noch keine Kommentare.</div>}
        {comments.map((c) => (
          <div key={c.id} style={{ borderLeft: '3px solid ' + (c.author_kind === 'vendor' ? '#1d4ed8' : '#cbd5e1'), padding: '4px 8px' }}>
            <div className="muted" style={{ fontSize: 12 }}>
              {c.author_name} · {c.visibility}{c.author_kind === 'user' ? ` · ${c.moderation_state}` : ''}
            </div>
            <div style={{ whiteSpace: 'pre-line' }}>{c.body}</div>
          </div>
        ))}
      </div>

      <div style={{ marginTop: 10, display: 'grid', gap: 6 }}>
        <textarea rows={2} placeholder="Antwort an den Anwender …" value={reply} onChange={(e) => setReply(e.target.value)} />
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <select value={replyVis} onChange={(e) => setReplyVis(e.target.value as 'public' | 'vendor_only')}>
            <option value="public">Öffentlich (am Vorschlag sichtbar)</option>
            <option value="vendor_only">Nur an einreichende Organisation</option>
          </select>
          <button disabled={busy || !reply.trim()} onClick={() => run(async () => { await api.respondSuggestion(id, reply, replyVis); setReply('') })}>
            Antwort senden
          </button>
        </div>
      </div>
    </div>
  )
}
