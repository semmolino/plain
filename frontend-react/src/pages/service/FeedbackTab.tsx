import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { HelpHint } from '@/components/ui/HelpHint'
import { fetchContactPrefill, submitRequest } from '@/api/service'
import { MyRequestsList } from './requestShared'
import { AttachmentPicker, uploadAttachments } from './attachments'

const ARTEN: { value: string; label: string }[] = [
  { value: 'lob', label: 'Lob' },
  { value: 'kritik', label: 'Kritik' },
  { value: 'frage', label: 'Frage' },
  { value: 'sonstiges', label: 'Sonstiges' },
]

export function FeedbackTab() {
  const qc = useQueryClient()
  const prefill = useQuery({ queryKey: ['service', 'contact'], queryFn: () => fetchContactPrefill() })

  const [category, setCategory] = useState('frage')
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [wantsReply, setWantsReply] = useState(true)
  const [email, setEmail] = useState('')
  const [emailTouched, setEmailTouched] = useState(false)
  const [files, setFiles] = useState<File[]>([])

  const effectiveEmail = emailTouched ? email : (prefill.data?.email ?? '')

  const submit = useMutation({
    mutationFn: async () => {
      const res = await submitRequest({
        kind: 'feedback', category, subject, body,
        contact_name: prefill.data?.name, contact_email: effectiveEmail, wants_reply: wantsReply,
      })
      if (files.length) await uploadAttachments('requests', res.data.ID, files)
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['service', 'requests', 'feedback'] })
      setSubject(''); setBody(''); setFiles([])
    },
  })

  const valid = subject.trim() && body.trim()

  return (
    <div className="service-tab">
      <div className="service-tab-head">
        <h2>Feedback &amp; Kontakt</h2>
        <HelpHint id="service.feedback" />
      </div>
      <p className="service-tab-lead">
        Lob, Kritik oder eine Frage? Schreiben Sie uns direkt. Ihre Nachricht geht ausschließlich an
        plan&amp;simple — andere Anwender sehen sie nicht.
      </p>

      <div className="service-card" style={{ maxWidth: 640 }}>
        <div className="sg-form">
          <div className="sg-prefill">
            <span><strong>Organisation:</strong> {prefill.data?.org || '—'}</span>
            <span><strong>Name:</strong> {prefill.data?.name || '—'}</span>
          </div>

          <label className="sg-field">
            <span>Art</span>
            <div className="seg-nav">
              {ARTEN.map(a => (
                <button key={a.value} type="button" className={`seg-nav-btn${category === a.value ? ' active' : ''}`} onClick={() => setCategory(a.value)}>{a.label}</button>
              ))}
            </div>
          </label>
          <label className="sg-field">
            <span>Betreff</span>
            <input className="list-search" maxLength={120} value={subject} onChange={e => setSubject(e.target.value)} placeholder="Kurz: worum geht es?" />
          </label>
          <label className="sg-field">
            <span>Nachricht</span>
            <textarea className="sg-textarea" rows={5} value={body} onChange={e => setBody(e.target.value)} placeholder="Ihre Rückmeldung an uns …" />
          </label>
          <label className="sg-checkrow">
            <input type="checkbox" checked={wantsReply} onChange={e => setWantsReply(e.target.checked)} />
            <span>Antwort erwünscht</span>
          </label>
          {wantsReply && (
            <label className="sg-field">
              <span>Antwort an</span>
              <input className="list-search" type="email" value={effectiveEmail}
                onChange={e => { setEmailTouched(true); setEmail(e.target.value) }} placeholder="ihre@email.de" />
            </label>
          )}

          <label className="sg-field">
            <span>Anhang (optional)</span>
            <AttachmentPicker files={files} onChange={setFiles} />
          </label>
          {submit.isError && <p className="consent-error">Senden fehlgeschlagen. Bitte erneut versuchen.</p>}
          {submit.isSuccess && <p className="service-hint-muted">Danke! Ihre Nachricht ist bei uns eingegangen.</p>}
          <div className="consent-actions">
            <button type="button" className="btn-primary" disabled={!valid || submit.isPending} onClick={() => submit.mutate()}>
              {submit.isPending ? 'Wird gesendet …' : 'Senden'}
            </button>
          </div>
        </div>
      </div>

      <h3 className="sg-section-title">Meine bisherigen Nachrichten</h3>
      <MyRequestsList kind="feedback" />
    </div>
  )
}
