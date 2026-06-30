import { useEffect, useState } from 'react'
import { api, ApiError, openConsoleFile, type ModRequest, type ReqMessage, type ReqStatus, type AttachmentRow } from '../api'

const STATUS: { id: string; label: string }[] = [
  { id: 'new', label: 'Offen' },
  { id: 'in_progress', label: 'In Bearbeitung' },
  { id: 'waiting', label: 'Wartet auf Anwender' },
  { id: 'resolved', label: 'Gelöst' },
  { id: 'closed', label: 'Geschlossen' },
  { id: 'all', label: 'Alle' },
]
const STATUS_OPTS: ReqStatus[] = ['new', 'in_progress', 'waiting', 'resolved', 'closed']

export function RequestsView() {
  const [kind, setKind] = useState<string>('')
  const [status, setStatus] = useState<string>('new')
  const [rows, setRows] = useState<ModRequest[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<number | null>(null)

  async function load() {
    try {
      const r = await api.serviceRequests(kind, status)
      setRows(r.requests)
      setError(null)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Laden fehlgeschlagen.')
    }
  }
  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, status])

  if (!rows) return <div className="muted">Lädt…</div>

  return (
    <div>
      <h2>Feedback & Unterstützung — Inbox</h2>
      <p className="muted">Anfragen aus dem Service-Bereich. Privat (Org ↔ plan&simple). Antworten und Status werden auditiert.</p>
      {error && <div className="error">{error}</div>}

      <div style={{ display: 'flex', gap: 16, marginBottom: 12, flexWrap: 'wrap' }}>
        <nav className="tabs">
          {[{ id: '', label: 'Alle Arten' }, { id: 'feedback', label: 'Feedback' }, { id: 'support', label: 'Unterstützung' }].map((k) => (
            <button key={k.id} className={kind === k.id ? 'active' : ''} onClick={() => { setKind(k.id); setSelected(null) }}>{k.label}</button>
          ))}
        </nav>
        <nav className="tabs">
          {STATUS.map((s) => (
            <button key={s.id} className={status === s.id ? 'active' : ''} onClick={() => { setStatus(s.id); setSelected(null) }}>{s.label}</button>
          ))}
        </nav>
      </div>

      <div className="table-scroll">
        <table className="grid">
          <thead>
            <tr><th>#</th><th>Art</th><th>Organisation</th><th>Einreicher</th><th>Betreff</th><th>Status</th><th>Erstellt</th></tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className={selected === r.id ? 'active' : ''} style={{ cursor: 'pointer' }}
                onClick={() => setSelected(selected === r.id ? null : r.id)}>
                <td>#{r.id}</td>
                <td>{r.kind === 'feedback' ? 'Feedback' : 'Support'}{r.category ? ` · ${r.category}` : ''}</td>
                <td>{r.org_name}</td>
                <td>{r.submitter_name}</td>
                <td>{r.subject}</td>
                <td>{r.status}</td>
                <td>{new Date(r.created_at).toLocaleDateString('de-DE')}</td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={7} className="muted">Keine Anfragen in dieser Auswahl.</td></tr>}
          </tbody>
        </table>
      </div>

      {selected != null && <RequestEditor id={selected} onChanged={load} onClose={() => setSelected(null)} />}
    </div>
  )
}

function RequestEditor({ id, onChanged, onClose }: { id: number; onChanged: () => void; onClose: () => void }) {
  const [req, setReq] = useState<ModRequest | null>(null)
  const [msgs, setMsgs] = useState<ReqMessage[]>([])
  const [attachments, setAttachments] = useState<AttachmentRow[]>([])
  const [reply, setReply] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function load() {
    const d = await api.serviceRequestDetail(id)
    setReq(d.request)
    setMsgs(d.messages)
    setAttachments(d.attachments || [])
  }
  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  async function run(fn: () => Promise<unknown>) {
    setBusy(true); setErr(null)
    try { await fn(); await load(); onChanged() }
    catch (e) { setErr(e instanceof ApiError ? e.message : 'Aktion fehlgeschlagen.') }
    finally { setBusy(false) }
  }

  if (!req) return <div className="card" style={{ marginTop: 16 }}>Lädt…</div>

  return (
    <div className="card" style={{ marginTop: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h3 style={{ margin: 0 }}>#{req.id} — {req.subject}</h3>
        <button className="link" onClick={onClose}>Schließen</button>
      </div>
      <div className="muted" style={{ marginTop: 4 }}>
        {req.org_name} · {req.submitter_name} {req.contact_email ? `· ${req.contact_email}` : ''} · {req.kind}{req.category ? ` / ${req.category}` : ''}{req.urgency ? ` · ${req.urgency}` : ''}
      </div>
      {err && <div className="error">{err}</div>}

      {attachments.length > 0 && (
        <div style={{ marginTop: 8 }}>
          <span className="muted">Anhänge: </span>
          {attachments.map((a) => (
            <button key={a.id} className="link" style={{ marginRight: 10 }}
              onClick={() => openConsoleFile(`/requests/${id}/attachments/${a.id}/file`)}>{a.filename}</button>
          ))}
        </div>
      )}

      <div className="sg-thread" style={{ marginTop: 10, display: 'grid', gap: 6 }}>
        <div style={{ borderLeft: '3px solid #cbd5e1', padding: '4px 8px', whiteSpace: 'pre-line' }}>
          <div className="muted" style={{ fontSize: 12 }}>{req.submitter_name}</div>
          {req.body}
        </div>
        {msgs.map((m) => (
          <div key={m.id} style={{ borderLeft: '3px solid ' + (m.author_kind === 'vendor' ? '#1d4ed8' : '#cbd5e1'), padding: '4px 8px', whiteSpace: 'pre-line' }}>
            <div className="muted" style={{ fontSize: 12 }}>{m.author_kind === 'vendor' ? 'plan&simple' : req.submitter_name} · {new Date(m.created_at).toLocaleString('de-DE')}</div>
            {m.body}
          </div>
        ))}
      </div>

      <div style={{ marginTop: 10, display: 'grid', gap: 6 }}>
        <textarea rows={3} placeholder="Antwort an den Anwender …" value={reply} onChange={(e) => setReply(e.target.value)} />
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <button disabled={busy || !reply.trim()} onClick={() => run(async () => { await api.replyRequest(id, reply); setReply('') })}>Antwort senden</button>
          <span className="muted">Status:</span>
          <select value={req.status} disabled={busy} onChange={(e) => run(() => api.setRequestStatus(id, e.target.value as ReqStatus))}>
            {STATUS_OPTS.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
      </div>
    </div>
  )
}
