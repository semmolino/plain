import { useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { ListChecks } from 'lucide-react'
import { ActionBar } from '@/components/ui/ActionBar'
import { HelpHint } from '@/components/ui/HelpHint'
import { Message } from '@/components/ui/Message'
import { useConfirm } from '@/hooks/useConfirm'
import { useCtrlS } from '@/hooks/useCtrlS'
import { useRegisterDirty } from '@/hooks/useDirtyGuard'
import { usePermission } from '@/store/permissionsStore'
import { fmtEur } from '@/utils/money'
import { LeistungsstandTable } from '@/pages/projekte/leistungsstand/LeistungsstandTable'
import { useLeistungsstandEditor } from '@/pages/projekte/leistungsstand/useLeistungsstandEditor'
import { deDate } from '@/pages/projekte/leistungsstand/leistungsstandCalc'

interface Props {
  initialProjectId?: number
}

/**
 * Leistungsstände eines Projekts (Reiter im Projekt-Arbeitsbereich).
 *
 * Runde 2: Stichtag waehlbar (vorher galt der Stand ab dem Speichern), nur
 * Geaendertes wird gespeichert, feste Aktionsleiste mit Zaehler, Rueckfrage
 * bei offenen Aenderungen, „Unverändert bestätigen", und ohne
 * `projects.performance.edit` gibt es keine Eingabefelder mehr (vorher liess
 * sich tippen, das Speichern scheiterte dann am Server). Dieselbe Tabelle
 * nutzt die Monatsrunde auf der Projektliste.
 */
export function Leistungsstand({ initialProjectId }: Props) {
  // Neuer Zustand je Projekt — Eingaben gehoeren zu genau einem.
  return <LeistungsstandProjekt key={initialProjectId ?? 'none'} projectId={initialProjectId ?? null} />
}

function LeistungsstandProjekt({ projectId }: { projectId: number | null }) {
  const canEdit = usePermission('projects.performance.edit')
  const [asOf, setAsOf] = useState<string | null>(null)
  const [filter, setFilter] = useState('')
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const saveRef = useRef<HTMLButtonElement>(null)
  const [confirm, confirmDialog] = useConfirm()
  const ed = useLeistungsstandEditor(projectId, asOf)
  const { summary, meta } = ed
  const today = meta?.today ?? ''

  async function save() {
    setMsg(null)
    try {
      const r = await ed.save()
      setMsg({ type: 'success', text: `${r.saved === 1 ? '1 Element' : `${r.saved} Elemente`} gespeichert — Stand zum ${deDate(r.as_of)}.` })
    } catch (e) {
      setMsg({ type: 'error', text: (e as Error)?.message || 'Speichern fehlgeschlagen' })
      throw e
    }
  }

  async function confirmUnchanged() {
    setMsg(null)
    try {
      const r = await ed.confirm()
      setMsg({ type: 'success', text: `Unverändert bestätigt — Stand zum ${deDate(r.as_of)}.` })
    } catch (e) {
      setMsg({ type: 'error', text: (e as Error)?.message || 'Bestätigen fehlgeschlagen' })
    }
  }

  async function discard() {
    if (await confirm({ title: 'Änderungen verwerfen?', message: `${summary.changed} Änderung${summary.changed === 1 ? '' : 'en'} gehen verloren.`, confirmLabel: 'Verwerfen' })) ed.reset()
  }

  useRegisterDirty('leistungsstand', { dirty: ed.dirty, label: 'Leistungsstände', count: summary.changed, save })
  useCtrlS(() => { if (ed.dirty && !ed.pending) void save().catch(() => {}) }, canEdit)

  if (projectId == null) return <p className="ls-empty">Bitte oben ein Projekt auswählen.</p>
  if (ed.query.isLoading) return <p className="ls-empty">Lädt …</p>
  if (ed.query.isError)   return <Message type="error" text="Leistungsstände konnten nicht geladen werden." />
  if (!ed.rows.length)    return <p className="ls-empty">Dieses Projekt hat noch keine Struktur. Leistungsstände gibt es je Element der Struktur.</p>

  const status = ed.pending === 'save' ? 'Speichert …'
    : ed.pending === 'confirm' ? 'Bestätigt …'
    : summary.errors ? `${summary.errors} ungültige${summary.errors === 1 ? 's Feld' : ' Felder'}`
    : summary.changed ? `${summary.changed} ${summary.changed === 1 ? 'Element' : 'Elemente'} geändert · ${summary.delta > 0 ? '+' : ''}${fmtEur(summary.delta)}`
    : meta?.reviewed_as_of ? `Zuletzt gepflegt zum ${deDate(meta.reviewed_as_of)}` : 'Keine Änderungen'

  return (
    <div className="lr-wrap">
      <div className="lr-head">
        <label className="lr-asof">
          <span>Stand zum</span>
          <input type="date" className="inline-date-input" value={ed.effAsOf ?? ''} max={today || undefined}
            onChange={e => setAsOf(e.target.value || null)} disabled={!canEdit} />
        </label>
        <HelpHint id="performance.asof" size={14} />
        {ed.lockedCount > 0 && (
          <span className="lr-head-note">{ed.lockedCount} {ed.lockedCount === 1 ? 'Element hat' : 'Elemente haben'} schon einen späteren Stand</span>
        )}
        {ed.rows.length > 12 && (
          <input type="search" className="list-search lr-filter" placeholder="Elemente filtern …" aria-label="Elemente filtern"
            value={filter} onChange={e => setFilter(e.target.value)} />
        )}
        <Link to="/projekte?tab=leistungsstaende" className="lr-round-link">
          <ListChecks size={14} strokeWidth={2} aria-hidden="true" /> Monatsrunde
        </Link>
      </div>

      <Message type={msg?.type ?? 'info'} text={msg?.text ?? null} />

      <LeistungsstandTable ed={ed} canEdit={canEdit} filter={filter} onLastEnter={() => saveRef.current?.focus()} />

      {canEdit && (
        <ActionBar
          dirty={ed.dirty}
          status={status}
          secondary={ed.dirty ? <button type="button" className="btn-secondary" onClick={() => void discard()} disabled={!!ed.pending}>Verwerfen</button> : undefined}
        >
          <HelpHint id="performance.confirm" align="right" />
          <button type="button" className="btn-secondary" onClick={() => void confirmUnchanged()}
            disabled={ed.dirty || !!ed.pending}
            title={ed.dirty ? 'Erst speichern oder verwerfen' : `Die heutigen Werte als Stand zum ${deDate(ed.effAsOf)} festhalten`}>
            Unverändert bestätigen
          </button>
          <button ref={saveRef} type="button" className="btn-primary" onClick={() => void save().catch(() => {})}
            disabled={!summary.changed || summary.errors > 0 || !!ed.pending}>
            {ed.pending === 'save' ? 'Speichert …' : 'Speichern'}
          </button>
        </ActionBar>
      )}
      {confirmDialog}
    </div>
  )
}
