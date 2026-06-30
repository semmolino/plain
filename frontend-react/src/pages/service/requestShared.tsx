import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Modal } from '@/components/ui/Modal'
import {
  fetchMyRequests, fetchRequest, postRequestMessage,
  type ServiceRequestKind, type ServiceRequestStatus, type MyRequest,
} from '@/api/service'

export const REQUEST_STATUS: Record<ServiceRequestStatus, { label: string; cls: string }> = {
  new:         { label: 'Offen',          cls: 'sg-st-reviewing' },
  in_progress: { label: 'In Bearbeitung', cls: 'sg-st-progress' },
  waiting:     { label: 'Wartet auf Sie', cls: 'sg-st-planned' },
  resolved:    { label: 'Gelöst',         cls: 'sg-st-shipped' },
  closed:      { label: 'Geschlossen',    cls: 'sg-st-notplanned' },
}

const FEEDBACK_CAT: Record<string, string> = { lob: 'Lob', kritik: 'Kritik', frage: 'Frage', sonstiges: 'Sonstiges' }
const SUPPORT_CAT: Record<string, string> = {
  datenimport: 'Datenimport', ersteinrichtung: 'Ersteinrichtung', rechnungen: 'Rechnungen & E-Rechnung',
  projekte: 'Projekte & Kalkulation', benutzer: 'Benutzer & Berechtigungen', technik: 'Technisches Problem', sonstiges: 'Sonstiges',
}
function catLabel(kind: ServiceRequestKind, c: string | null): string {
  if (!c) return ''
  return (kind === 'feedback' ? FEEDBACK_CAT[c] : SUPPORT_CAT[c]) || c
}

export function MyRequestsList({ kind }: { kind: ServiceRequestKind }) {
  const [openId, setOpenId] = useState<number | null>(null)
  const q = useQuery({ queryKey: ['service', 'requests', kind], queryFn: () => fetchMyRequests(kind) })
  const rows = q.data?.data ?? []

  if (q.isLoading) return <p className="service-hint-muted">Laden …</p>
  if (rows.length === 0) {
    return (
      <div className="service-empty" style={{ marginTop: 12 }}>
        <h3>Noch keine Anfragen</h3>
        <p>Hier sehen Sie Ihre gesendeten {kind === 'feedback' ? 'Rückmeldungen' : 'Anfragen'} und den jeweiligen Status — inklusive Antworten von plan&simple.</p>
      </div>
    )
  }

  return (
    <>
      <div className="sg-list" style={{ marginTop: 12 }}>
        {rows.map((r: MyRequest) => (
          <div key={r.id} className="sg-card sg-card-mine" style={{ cursor: 'pointer' }}
            role="button" tabIndex={0}
            onClick={() => setOpenId(r.id)} onKeyDown={(e) => { if (e.key === 'Enter') setOpenId(r.id) }}>
            <div className="sg-card-main" style={{ cursor: 'pointer' }}>
              <div className="sg-card-title">{r.subject}</div>
              <div className="sg-card-body">{r.body}</div>
              <div className="sg-card-foot">
                {r.category && <span className="sg-cat">{catLabel(kind, r.category)}</span>}
                <span className={`sg-badge ${REQUEST_STATUS[r.status].cls}`}>{REQUEST_STATUS[r.status].label}</span>
                <span className="sg-submitter">{new Date(r.created_at).toLocaleDateString('de-DE')}</span>
              </div>
            </div>
          </div>
        ))}
      </div>
      {openId != null && <RequestThreadModal id={openId} onClose={() => setOpenId(null)} />}
    </>
  )
}

export function RequestThreadModal({ id, onClose }: { id: number; onClose: () => void }) {
  const qc = useQueryClient()
  const [text, setText] = useState('')
  const q = useQuery({ queryKey: ['service', 'request', id], queryFn: () => fetchRequest(id) })
  const send = useMutation({
    mutationFn: () => postRequestMessage(id, text),
    onSuccess: () => {
      setText('')
      qc.invalidateQueries({ queryKey: ['service', 'request', id] })
      qc.invalidateQueries({ queryKey: ['service', 'requests'] })
    },
  })
  const d = q.data?.data

  return (
    <Modal open onClose={onClose} title={d?.subject || 'Anfrage'}>
      {q.isLoading || !d ? (
        <p className="service-hint-muted">Laden …</p>
      ) : (
        <div className="sg-detail">
          <div>
            {d.category && <span className="sg-cat">{catLabel(d.kind, d.category)}</span>}{' '}
            <span className={`sg-badge ${REQUEST_STATUS[d.status].cls}`}>{REQUEST_STATUS[d.status].label}</span>
          </div>
          <div className="sg-comment-list">
            <div className="sg-comment">
              <div className="sg-comment-author">Sie · {new Date(d.created_at).toLocaleString('de-DE')}</div>
              <div className="sg-comment-body">{d.body}</div>
            </div>
            {d.messages.map((m, i) => (
              <div key={i} className={`sg-comment${m.is_vendor ? ' official' : ''}`}>
                <div className="sg-comment-author">{m.author} · {new Date(m.created_at).toLocaleString('de-DE')}</div>
                <div className="sg-comment-body">{m.body}</div>
              </div>
            ))}
          </div>
          {d.status !== 'closed' && (
            <div className="sg-comment-form">
              <textarea className="sg-textarea" rows={2} value={text} onChange={(e) => setText(e.target.value)} placeholder="Antwort schreiben …" />
              <button type="button" className="btn-primary btn-small" disabled={!text.trim() || send.isPending} onClick={() => send.mutate()}>Senden</button>
            </div>
          )}
        </div>
      )}
    </Modal>
  )
}
