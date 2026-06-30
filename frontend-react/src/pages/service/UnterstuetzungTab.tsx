import { useState, type ReactNode } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { HelpHint } from '@/components/ui/HelpHint'
import { submitRequest, type Urgency } from '@/api/service'
import { MyRequestsList } from './requestShared'
import { AttachmentPicker, uploadAttachments } from './attachments'

interface Cat { value: string; label: string; faq: { q: string; a: ReactNode }[] }

const CATEGORIES: Cat[] = [
  {
    value: 'datenimport', label: 'Datenimport & Altdaten',
    faq: [
      { q: 'Wie übernehme ich bestehende Daten?', a: <>Über den <strong>geführten Datenimport</strong> (Einstellungen → Datenimport): Excel-Vorlage füllen, hochladen, Vorschau prüfen, importieren. Jeder Import ist ein Stapel und als Ganzes rücksetzbar.</> },
      { q: 'Was lässt sich übernehmen?', a: <>Adressen, Projekte, Mitarbeiter sowie Anfangsbestände (offene Posten als schreibgeschützte Referenz zu Ihrem Stichtag).</> },
    ],
  },
  {
    value: 'ersteinrichtung', label: 'Ersteinrichtung',
    faq: [
      { q: 'Wo hinterlege ich Firmendaten und Logo?', a: <>Einstellungen → <strong>Unternehmen</strong>.</> },
      { q: 'Wie lege ich Nummernkreise fest?', a: <>Einstellungen → <strong>Nummernkreise</strong> (z. B. für Angebote, Projekte, Rechnungen).</> },
    ],
  },
  {
    value: 'rechnungen', label: 'Rechnungen & E-Rechnung',
    faq: [
      { q: 'Abschlags- oder Schlussrechnung?', a: <>Die Schlussrechnung zieht alle vorherigen Abschlagszahlungen automatisch ab. Den Typ wählen Sie beim Anlegen.</> },
      { q: 'Wie erzeuge ich eine E-Rechnung (XRechnung)?', a: <>Bei jeder finalen Rechnung kann das XML (CII/UBL) erzeugt und heruntergeladen werden.</> },
    ],
  },
  {
    value: 'projekte', label: 'Projekte & Kalkulation',
    faq: [
      { q: 'Pauschal oder Stunden/TEC?', a: <>Die Abrechnungsart wird je Projekt/Struktur festgelegt und steuert, wie Leistungen erfasst und abgerechnet werden.</> },
    ],
  },
  {
    value: 'benutzer', label: 'Benutzer & Berechtigungen',
    faq: [
      { q: 'Wie vergebe ich Rechte?', a: <>Über Rollen (Einstellungen → Rollen). Jeder Mitarbeiter erhält eine Rolle mit den passenden Berechtigungen.</> },
    ],
  },
  {
    value: 'technik', label: 'Technisches Problem',
    faq: [
      { q: 'Etwas funktioniert nicht — was hilft uns?', a: <>Beschreiben Sie die Schritte, das erwartete und das tatsächliche Verhalten. Ein Screenshot hilft (bitte sensible Daten schwärzen).</> },
    ],
  },
  { value: 'sonstiges', label: 'Sonstiges', faq: [] },
]

const URGENCIES: { value: Urgency; label: string }[] = [
  { value: 'question', label: 'Frage' },
  { value: 'impaired', label: 'Behindert meine Arbeit' },
  { value: 'blocker', label: 'Blockiert mich komplett' },
]

export function UnterstuetzungTab() {
  const qc = useQueryClient()
  const [cat, setCat] = useState<Cat | null>(null)
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [urgency, setUrgency] = useState<Urgency>('question')
  const [callback, setCallback] = useState(false)
  const [callbackTime, setCallbackTime] = useState('')
  const [files, setFiles] = useState<File[]>([])

  const submit = useMutation({
    mutationFn: async () => {
      const extra = callback ? `\n\n[Rückruf zur Datenübernahme gewünscht${callbackTime ? `: ${callbackTime}` : ''}]` : ''
      const res = await submitRequest({ kind: 'support', category: cat?.value, subject, body: body + extra, urgency })
      if (files.length) await uploadAttachments('requests', res.data.ID, files)
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['service', 'requests', 'support'] })
      setSubject(''); setBody(''); setCallback(false); setCallbackTime(''); setFiles([])
    },
  })

  const valid = cat && subject.trim() && body.trim()

  return (
    <div className="service-tab">
      <div className="service-tab-head">
        <h2>Unterstützung anfragen</h2>
        <HelpHint id="service.unterstuetzung" />
      </div>
      <p className="service-tab-lead">
        Sie brauchen Hilfe bei einer konkreten Aufgabe? Wählen Sie eine Kategorie — passende Antworten
        zeigen wir vorab. Bleibt etwas offen, geht Ihre Anfrage privat an plan&amp;simple.
      </p>

      {/* Schritt 1: Kategorie */}
      <div className="sg-cat-grid">
        {CATEGORIES.map(c => (
          <button key={c.value} type="button" className={`sg-cat-tile${cat?.value === c.value ? ' active' : ''}`} onClick={() => setCat(c)}>
            {c.label}
          </button>
        ))}
      </div>

      {cat && (
        <div className="service-card" style={{ maxWidth: 680, marginTop: 14 }}>
          {/* Schritt 2: FAQ-Deflection */}
          {cat.faq.length > 0 && (
            <div className="sg-faq">
              <div className="sg-faq-head">Hilft das schon weiter?</div>
              {cat.faq.map((f, i) => (
                <details key={i} className="sg-faq-item">
                  <summary>{f.q}</summary>
                  <div className="sg-faq-a">{f.a}</div>
                </details>
              ))}
            </div>
          )}

          {/* Schritt 3: Formular */}
          <div className="sg-form" style={{ marginTop: cat.faq.length ? 14 : 0 }}>
            <label className="sg-field">
              <span>Betreff</span>
              <input className="list-search" maxLength={120} value={subject} onChange={e => setSubject(e.target.value)} placeholder={`Ihr Anliegen zu „${cat.label}"`} />
            </label>
            <label className="sg-field">
              <span>Beschreibung</span>
              <textarea className="sg-textarea" rows={5} value={body} onChange={e => setBody(e.target.value)} placeholder="Was möchten Sie erreichen? Wobei hakt es?" />
            </label>
            <label className="sg-field">
              <span>Dringlichkeit</span>
              <div className="seg-nav">
                {URGENCIES.map(u => (
                  <button key={u.value} type="button" className={`seg-nav-btn${urgency === u.value ? ' active' : ''}`} onClick={() => setUrgency(u.value)}>{u.label}</button>
                ))}
              </div>
            </label>

            {cat.value === 'datenimport' && (
              <div className="sg-callback">
                <label className="sg-checkrow">
                  <input type="checkbox" checked={callback} onChange={e => setCallback(e.target.checked)} />
                  <span>Rückruf zur Datenübernahme vereinbaren</span>
                </label>
                {callback && (
                  <input className="list-search" value={callbackTime} onChange={e => setCallbackTime(e.target.value)} placeholder="Wunsch-Zeitfenster (z. B. Mo–Mi vormittags)" />
                )}
              </div>
            )}

            <label className="sg-field">
              <span>Screenshots (optional)</span>
              <AttachmentPicker files={files} onChange={setFiles} />
            </label>
            {submit.isError && <p className="consent-error">Senden fehlgeschlagen. Bitte erneut versuchen.</p>}
            {submit.isSuccess && <p className="service-hint-muted">Danke! Ihre Anfrage ist eingegangen — Sie finden sie unten unter „Meine Anfragen".</p>}
            <div className="consent-actions">
              <button type="button" className="btn-primary" disabled={!valid || submit.isPending} onClick={() => submit.mutate()}>
                {submit.isPending ? 'Wird gesendet …' : 'Anfrage senden'}
              </button>
            </div>
          </div>
        </div>
      )}

      <h3 className="sg-section-title">Meine Anfragen</h3>
      <MyRequestsList kind="support" />
    </div>
  )
}
