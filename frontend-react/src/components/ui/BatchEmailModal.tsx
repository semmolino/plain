import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Modal } from '@/components/ui/Modal'
import { Message } from '@/components/ui/Message'
import { DialogFooter } from '@/components/ui/DialogFooter'

/** Ein Beleg im Sammelversand. */
export interface BatchEmailItem {
  /** Stabiler Schluessel (Zeilenschluessel der Liste). */
  key:   string
  /** Beleg-/Mahnungsnummer — steht in der Empfaengerliste. */
  label: string
  /** Zusatz (Adresse/Projekt), nur zur Orientierung. */
  sub?:  string | null
  /** Vorbelegte Empfaengeradresse (kann leer sein). */
  to:    string
}

type RowState = 'todo' | 'sending' | 'ok' | 'error' | 'skipped'

interface Props {
  title:    string
  /** z.B. „Rechnung" / „Mahnung" — fuer Texte im Dialog. */
  docLabel: string
  items:    BatchEmailItem[]
  /** Betreff-/Textvorlage MIT Platzhaltern (der Server loest sie je Beleg auf). */
  subject:  string
  body:     string
  /** Optionaler Hinweis ueber der Belegliste (z.B. gemischte Auswahl). */
  notice?:  string
  /** Versendet genau einen Beleg. Fehler werden pro Zeile angezeigt. */
  onSend:   (item: BatchEmailItem, to: string, subject: string, body: string) => Promise<unknown>
  /** Nach Abschluss, wenn mindestens ein Versand geklappt hat — z.B. Queries invalidieren. */
  onSent?:  () => void
  onClose:  () => void
}

/**
 * Sammelversand: ein Betreff/Text fuer viele Belege, versendet nacheinander.
 *
 * Bewusst sequenziell — jeder Versand rendert serverseitig ein PDF; parallele
 * Anfragen wuerden den Renderer unnoetig belasten und die Fehlerzuordnung
 * verwaschen. Der Fortschritt steht pro Zeile im Dialog.
 *
 * Der Aufrufer rendert die Komponente nur, solange der Dialog offen ist
 * (`{open && <BatchEmailModal …/>}`). Dadurch startet jeder Aufruf mit
 * frischem Zustand, ohne Status/Fehler des vorherigen Laufs.
 */
export function BatchEmailModal({
  title, docLabel, items, subject, body, notice, onSend, onSent, onClose,
}: Props) {
  const [recipients, setRecipients] = useState<Record<string, string>>(
    () => Object.fromEntries(items.map(it => [it.key, it.to ?? ''])),
  )
  const [subj,   setSubj]   = useState(subject)
  const [text,   setText]   = useState(body)
  const [state,  setState]  = useState<Record<string, RowState>>({})
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [running,  setRunning]  = useState(false)
  const [finished, setFinished] = useState(false)

  const sendable = items.filter(it => (recipients[it.key] ?? '').trim() !== '')
  const missing  = items.length - sendable.length
  const okCount  = Object.values(state).filter(s => s === 'ok').length
  const errCount = Object.values(state).filter(s => s === 'error').length

  async function run() {
    setRunning(true)
    setFinished(false)
    const start: Record<string, RowState> = {}
    for (const it of items) {
      start[it.key] = (recipients[it.key] ?? '').trim() ? 'todo' : 'skipped'
    }
    setState(start)
    setErrors({})

    let anyOk = false
    for (const it of sendable) {
      setState(s => ({ ...s, [it.key]: 'sending' }))
      try {
        await onSend(it, (recipients[it.key] ?? '').trim(), subj, text)
        anyOk = true
        setState(s => ({ ...s, [it.key]: 'ok' }))
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e)
        setState(s => ({ ...s, [it.key]: 'error' }))
        setErrors(x => ({ ...x, [it.key]: msg }))
      }
    }
    setRunning(false)
    setFinished(true)
    if (anyOk) onSent?.()
  }

  function badge(k: string) {
    switch (state[k]) {
      case 'sending': return <span style={{ color: 'var(--text-3)' }}>sendet …</span>
      case 'ok':      return <span style={{ color: 'var(--success, #059669)' }}>✓ gesendet</span>
      case 'error':   return <span style={{ color: 'var(--danger)' }} title={errors[k]}>✗ Fehler</span>
      case 'skipped': return <span style={{ color: 'var(--text-3)' }}>übersprungen</span>
      default:        return <span style={{ color: 'var(--text-3)' }}>—</span>
    }
  }

  return (
    <Modal open onClose={onClose} title={title}>
      <div style={{ minWidth: 480, maxWidth: 720 }}>
        <p style={{ fontSize: 13, color: 'var(--text-3)', margin: '0 0 12px' }}>
          Jeder Empfänger erhält eine eigene E-Mail mit ausschließlich seinem Beleg als PDF.
        </p>

        {notice && <div style={{ marginBottom: 12 }}><Message type="info" text={notice} /></div>}
        <div className="table-scroll" style={{ maxHeight: 220, marginBottom: 14 }}>
          <table className="master-table" style={{ fontSize: 13 }}>
            <thead>
              <tr>
                <th scope="col">{docLabel}</th>
                <th scope="col">Empfänger</th>
                <th scope="col" style={{ width: 110 }}>Status</th>
              </tr>
            </thead>
            <tbody>
              {items.map(it => (
                <tr key={it.key}>
                  <td>
                    <div style={{ fontWeight: 600 }}>{it.label}</div>
                    {it.sub && <div style={{ fontSize: 11, color: 'var(--text-3)' }}>{it.sub}</div>}
                  </td>
                  <td>
                    <input
                      type="email"
                      className="form-control"
                      style={{ fontSize: 12, padding: '3px 6px' }}
                      value={recipients[it.key] ?? ''}
                      placeholder="keine Adresse hinterlegt"
                      disabled={running}
                      onChange={e => setRecipients(r => ({ ...r, [it.key]: e.target.value }))}
                    />
                  </td>
                  <td style={{ fontSize: 12 }}>{badge(it.key)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {missing > 0 && !finished && (
          <Message
            type="info"
            text={`${missing} Beleg(e) ohne E-Mail-Adresse werden übersprungen — Adresse hier eintragen, um sie mitzusenden.`}
          />
        )}

        <div className="form-group">
          <label className="form-label">Betreff</label>
          <input
            type="text" className="form-control" value={subj} disabled={running}
            onChange={e => setSubj(e.target.value)}
          />
        </div>
        <div className="form-group">
          <label className="form-label">Nachricht</label>
          <textarea
            className="form-control" rows={7} value={text} disabled={running}
            onChange={e => setText(e.target.value)}
          />
        </div>

        <p style={{ fontSize: 12, color: 'var(--text-3)', margin: '0 0 10px' }}>
          Platzhalter wie <code>{'{{belegnummer}}'}</code> oder <code>{'{{betrag}}'}</code> werden je Beleg ersetzt.
          Der Standardtext lässt sich unter{' '}
          <Link to="/admin?tab=email">Einstellungen → E-Mail-Versand</Link> hinterlegen.
          <br />📎 Das PDF wird automatisch angehängt.
        </p>

        {finished && (
          <Message
            type={errCount > 0 ? 'error' : 'success'}
            text={
              errCount > 0
                ? `${okCount} versendet, ${errCount} fehlgeschlagen. Details siehe Statusspalte.`
                : `${okCount} ${docLabel}${okCount === 1 ? '' : 'en'} versendet.`
            }
          />
        )}

        <DialogFooter>
          <button type="button" className="btn-secondary" onClick={onClose} disabled={running}>
            {finished ? 'Schließen' : 'Abbrechen'}
          </button>
          {!finished && (
            <button
              type="button" className="btn btn-primary"
              disabled={running || sendable.length === 0}
              onClick={() => void run()}
            >
              {running
                ? `Sendet … (${okCount + errCount}/${sendable.length})`
                : `Jetzt senden (${sendable.length})`}
            </button>
          )}
          {finished && errCount > 0 && (
            <button type="button" className="btn btn-primary" onClick={() => void run()}>
              Erneut versuchen
            </button>
          )}
        </DialogFooter>
      </div>
    </Modal>
  )
}
