import { useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ArrowLeft, CheckCircle2, ChevronRight, Circle, SkipForward, Receipt } from 'lucide-react'
import { fetchLeistungsstandRunde, type RundeProjekt } from '@/api/projekte'
import { ActionBar } from '@/components/ui/ActionBar'
import { HelpHint } from '@/components/ui/HelpHint'
import { Message } from '@/components/ui/Message'
import { useInvoiceKinds } from '@/components/rechnungen/invoiceKinds'
import { useCtrlS } from '@/hooks/useCtrlS'
import { useIsNarrow } from '@/hooks/useIsNarrow'
import { useGuardedAction, useRegisterDirty } from '@/hooks/useDirtyGuard'
import { usePermission } from '@/store/permissionsStore'
import { money, fmtEur, negativeStyle } from '@/utils/money'
import { LeistungsstandTable } from './LeistungsstandTable'
import { useLeistungsstandEditor } from './useLeistungsstandEditor'
import { deDate, monthLabel } from './leistungsstandCalc'

type Scope = 'own' | 'all'
const SS_KEY = 'plain:lsrunde'

function readSession(): { scope?: Scope; skipped?: number[] } {
  try { return JSON.parse(sessionStorage.getItem(SS_KEY) ?? '{}') } catch { return {} }
}
function writeSession(v: { scope?: Scope; skipped?: number[] }) {
  try { sessionStorage.setItem(SS_KEY, JSON.stringify({ ...readSession(), ...v })) } catch { /* privat */ }
}

const FMT_PCT = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 1 })

/**
 * Monatsrunde Leistungsstände (Projektliste → Reiter „Leistungsstände").
 *
 * Einmal im Monat pflegen Projektleitung und Büro die Stände aller laufenden
 * Projekte, je Projekt zwei bis zehn Elemente. Vorher: Projekt öffnen, Reiter,
 * tippen, speichern, nächstes Projekt über das Suchfeld — ohne Liste, was noch
 * offen ist, und ohne Stichtag. Jetzt eine Arbeitsliste mit „Speichern &
 * nächstes", „Unverändert bestätigen" und Fortschritt („7 von 12 erledigt").
 *
 * Desktop: links die Projekte, rechts die Eingabe. Handy: erst die Liste,
 * ein Tipp öffnet die Eingabe als eigene Ansicht.
 */
export function LeistungsstandRunde() {
  const narrow  = useIsNarrow()
  const guarded = useGuardedAction()
  const canEdit = usePermission('projects.performance.edit')
  const [asOf, setAsOf]         = useState<string | null>(null)
  const [scope, setScopeState]  = useState<Scope | null>(() => readSession().scope ?? null)
  const [skipped, setSkipped]   = useState<Set<number>>(() => new Set(readSession().skipped ?? []))
  const [selected, setSelected] = useState<number | null>(null)
  const [search, setSearch]     = useState('')
  const [lastSaved, setLastSaved] = useState<{ id: number; kind: 'saved' | 'confirmed' } | null>(null)

  const effScope: Scope = scope ?? 'own'
  const { data, isLoading, isError } = useQuery({
    queryKey: ['leistungsstand-runde', asOf, effScope],
    queryFn:  () => fetchLeistungsstandRunde(asOf, effScope),
  })
  const r = data?.data
  // Wer keine Projekte leitet, bekommt „Alle laufenden" — einmal, ohne Umweg.
  if (scope === null && r && r.scope === 'own' && r.mine_count === 0) setScopeState('all')

  const projects = useMemo(() => r?.projects ?? [], [r])
  const visible = useMemo(() => {
    const q = search.trim().toLowerCase()
    return q ? projects.filter(p => `${p.ABBR} ${p.NAME} ${p.PROJECT_MANAGER ?? ''}`.toLowerCase().includes(q)) : projects
  }, [projects, search])

  // Desktop: ohne Wahl das erste offene Projekt zeigen.
  const firstOpen = projects.find(p => !p.DONE && !skipped.has(p.ID)) ?? null
  const current = selected != null ? projects.find(p => p.ID === selected) ?? null : (!narrow ? firstOpen : null)

  function setScope(s: Scope) {
    guarded(() => { setScopeState(s); writeSession({ scope: s }); setSelected(null) })
  }
  function pick(id: number) {
    if (id === current?.ID) return
    guarded(() => { setSelected(id); setLastSaved(null) })
  }
  /** Nächstes offenes Projekt nach `fromId` (mit Umlauf), sonst null. */
  function nextOpen(fromId: number, skip = skipped): number | null {
    const i = projects.findIndex(p => p.ID === fromId)
    const order = [...projects.slice(i + 1), ...projects.slice(0, Math.max(0, i))]
    return order.find(p => !p.DONE && !skip.has(p.ID) && p.ID !== fromId)?.ID ?? null
  }
  function skip(id: number) {
    const s = new Set(skipped); s.add(id)
    setSkipped(s); writeSession({ skipped: [...s] })
    setSelected(nextOpen(id, s)); setLastSaved(null)
  }
  function onDone(id: number, kind: 'saved' | 'confirmed') {
    setLastSaved({ id, kind })
    if (skipped.has(id)) { const s = new Set(skipped); s.delete(id); setSkipped(s); writeSession({ skipped: [...s] }) }
    const next = nextOpen(id)
    setSelected(next ?? id)
  }

  const header = (
    <div className="lsr-head">
      <label className="lr-asof">
        <span>Stand zum</span>
        <input type="date" className="inline-date-input" value={r?.as_of ?? ''} max={r?.today}
          onChange={e => { const v = e.target.value || null; guarded(() => { setAsOf(v); setSelected(null) }) }} />
      </label>
      <HelpHint id="performance.round" size={14} />
      <div className="lsr-scope" role="group" aria-label="Welche Projekte">
        <button type="button" aria-pressed={effScope === 'own'} onClick={() => setScope('own')}>Meine Projekte</button>
        <button type="button" aria-pressed={effScope === 'all'} onClick={() => setScope('all')}>Alle laufenden</button>
      </div>
      {r && r.total > 0 && (
        <div className="lsr-progress" aria-label={`${r.done} von ${r.total} erledigt`}>
          <span><strong>{r.done}</strong> von {r.total} erledigt</span>
          <span className="lsr-progress-bar" aria-hidden="true"><span style={{ width: `${Math.round(r.done / r.total * 100)}%` }} /></span>
        </div>
      )}
    </div>
  )

  if (isLoading) return <div className="lsr-root">{header}<p className="ls-empty">Lädt …</p></div>
  if (isError || !r) return <div className="lsr-root">{header}<Message type="error" text="Die Monatsrunde konnte nicht geladen werden." /></div>

  if (!projects.length) {
    return (
      <div className="lsr-root">
        {header}
        <div className="lsr-empty">
          {effScope === 'own' ? (
            <>
              <p><strong>Du leitest keine laufenden Projekte mit Leistungsständen.</strong></p>
              <p>Laufend sind die Projekte mit den Status aus Einstellungen → Monatsabschluss. Die Runde für das ganze Büro findest du unter „Alle laufenden".</p>
              <button type="button" className="btn-secondary" onClick={() => setScope('all')}>Alle laufenden zeigen</button>
            </>
          ) : (
            <>
              <p><strong>Keine laufenden Projekte mit Leistungsständen.</strong></p>
              <p>In die Runde kommen Projekte mit laufendem Status (Einstellungen → Monatsabschluss), die mindestens ein pauschal abgerechnetes Element haben. Nach Aufwand abgerechnete Elemente stehen immer auf 100 %.</p>
            </>
          )}
        </div>
      </div>
    )
  }

  const allDone = r.done === r.total
  const list = (
    <div className="lsr-list" role="navigation" aria-label="Projekte der Monatsrunde">
      {projects.length > 8 && (
        <input type="search" className="list-search lsr-search" placeholder="Projekt suchen …" aria-label="Projekt suchen"
          value={search} onChange={e => setSearch(e.target.value)} />
      )}
      {!visible.length && <p className="lsr-none">Kein Projekt passt zur Suche.</p>}
      <ul>
        {visible.map(p => (
          <li key={p.ID}>
            <RundeListItem p={p} active={p.ID === current?.ID} skipped={skipped.has(p.ID)} asOf={r.as_of}
              saved={lastSaved?.id === p.ID ? lastSaved.kind : null} onClick={() => pick(p.ID)} />
          </li>
        ))}
      </ul>
    </div>
  )

  const editor = current ? (
    <RundeEditor key={`${current.ID}:${r.as_of}`} project={current} asOf={r.as_of} canEdit={canEdit}
      justSaved={lastSaved && lastSaved.id !== current.ID ? projects.find(p => p.ID === lastSaved.id) ?? null : null}
      onBack={narrow ? () => guarded(() => setSelected(null)) : undefined}
      onSkip={() => skip(current.ID)}
      onDone={kind => onDone(current.ID, kind)} />
  ) : allDone ? (
    <div className="lsr-alldone">
      <CheckCircle2 size={28} strokeWidth={1.75} aria-hidden="true" />
      <p><strong>Alles erledigt für den {deDate(r.as_of)}.</strong></p>
      <p>{r.total} {r.total === 1 ? 'Projekt ist' : 'Projekte sind'} für {monthLabel(r.as_of)} gepflegt.</p>
    </div>
  ) : (
    <div className="lsr-alldone"><p>Wähle links ein Projekt.</p></div>
  )

  if (narrow) {
    return <div className="lsr-root">{current ? editor : <>{header}{allDone && editor}{list}</>}</div>
  }
  return (
    <div className="lsr-root">
      {header}
      <div className="lsr-panes">
        {list}
        <div className="lsr-editor">{editor}</div>
      </div>
    </div>
  )
}

function RundeListItem({ p, active, skipped, saved, asOf, onClick }: {
  p: RundeProjekt; active: boolean; skipped: boolean; saved: 'saved' | 'confirmed' | null; asOf: string; onClick: () => void
}) {
  const state = p.DONE ? 'erledigt' : skipped ? 'übersprungen' : 'offen'
  return (
    <button type="button" className={`lsr-item${active ? ' lsr-item--active' : ''}${p.DONE ? ' lsr-item--done' : ''}`}
      aria-current={active ? 'true' : undefined} onClick={onClick}>
      <span className="lsr-item-state" aria-hidden="true">
        {p.DONE ? <CheckCircle2 size={16} strokeWidth={2} /> : skipped ? <SkipForward size={15} strokeWidth={2} /> : <Circle size={15} strokeWidth={2} />}
      </span>
      <span className="lsr-item-main">
        <span className="lsr-item-title"><strong>{p.ABBR}</strong> {p.NAME}</span>
        <span className="lsr-item-meta">
          <span className={`lsr-chip lsr-chip--${p.DONE ? 'done' : skipped ? 'skip' : 'open'}`}>{state}</span>
          {p.PROJECT_MANAGER && <span>{p.PROJECT_MANAGER}</span>}
          {/* Nur, was die Runde weiss: „noch nie gepflegt" stimmte nicht — Staende
              aus dem Projekt-Reiter oder dem Monatsabschluss gibt es fast immer. */}
          {p.REVIEWED_AS_OF && <span>zuletzt {deDate(p.REVIEWED_AS_OF).slice(0, 6)}</span>}
          {p.REVIEWED_AS_OF && p.REVIEWED_AS_OF > asOf && <span>(nach Stichtag)</span>}
        </span>
        {saved && (p.OPEN_NET_TOTAL ?? 0) > 0 && (
          <span className="lsr-item-saved">abrechenbar {fmtEur(p.OPEN_NET_TOTAL ?? 0)}</span>
        )}
      </span>
      <span className="lsr-item-pct">{p.LEISTUNGSSTAND_PERCENT != null ? `${FMT_PCT.format(p.LEISTUNGSSTAND_PERCENT)} %` : ''}</span>
      <ChevronRight size={15} strokeWidth={2} aria-hidden="true" className="lsr-item-chev" />
    </button>
  )
}

function RundeEditor({ project, asOf, canEdit, justSaved, onBack, onSkip, onDone }: {
  project:   RundeProjekt
  asOf:      string
  canEdit:   boolean
  /** Zuletzt gespeichertes Projekt — fuer „abrechenbar … Abschlag erstellen". */
  justSaved: RundeProjekt | null
  onBack?:   () => void
  onSkip:    () => void
  onDone:    (kind: 'saved' | 'confirmed') => void
}) {
  const ed = useLeistungsstandEditor(project.ID, asOf)
  const { summary } = ed
  const primaryRef = useRef<HTMLButtonElement>(null)
  const [err, setErr] = useState<string | null>(null)
  const kinds = useInvoiceKinds()
  const canAbschlag = kinds.some(k => k.id === 'abschlag')

  async function saveNext() {
    setErr(null)
    try {
      await ed.save(); onDone('saved')
    } catch (e) {
      setErr((e as Error)?.message || 'Speichern fehlgeschlagen')
      throw e
    }
  }
  async function confirmNext() {
    setErr(null)
    try { await ed.confirm(); onDone('confirmed') } catch (e) { setErr((e as Error)?.message || 'Bestätigen fehlgeschlagen') }
  }

  useRegisterDirty('leistungsstand-runde', { dirty: ed.dirty, label: `Leistungsstände ${project.ABBR}`, count: summary.changed,
    save: () => ed.save() })
  useCtrlS(() => { if (!ed.pending && summary.changed && !summary.errors) void saveNext().catch(() => {}) }, canEdit)


  return (
    <section className="lsr-ed" aria-labelledby="lsr-ed-title">
      {onBack && (
        <button type="button" className="lsr-back" onClick={onBack}>
          <ArrowLeft size={15} strokeWidth={2} aria-hidden="true" /> Alle Projekte
        </button>
      )}
      <div className="lsr-ed-head">
        <h2 id="lsr-ed-title" className="lsr-ed-title"><span>{project.ABBR}</span> {project.NAME}</h2>
        <p className="lsr-ed-meta">
          Stand zum <strong>{deDate(asOf)}</strong>
          {project.REVIEWED_AS_OF && <> · zuletzt gepflegt zum {deDate(project.REVIEWED_AS_OF)}</>}
          {' · '}<Link to={`/projekte?projectId=${project.ID}&tab=leistungsstand`}>im Projekt öffnen</Link>
        </p>
      </div>

      {justSaved && (
        <div className="lsr-saved" role="status">
          <CheckCircle2 size={15} strokeWidth={2} aria-hidden="true" />
          <span><strong>{justSaved.ABBR}</strong> gespeichert{(justSaved.OPEN_NET_TOTAL ?? 0) > 0 ? <> · abrechenbar {money(justSaved.OPEN_NET_TOTAL ?? 0)}</> : null}</span>
          {canAbschlag && (justSaved.OPEN_NET_TOTAL ?? 0) > 0 && (
            <Link to={`/rechnungen?tab=abschlag&projectId=${justSaved.ID}`} className="lsr-saved-link">
              <Receipt size={13} strokeWidth={1.75} aria-hidden="true" /> Abschlag erstellen
            </Link>
          )}
        </div>
      )}

      <Message type="error" text={err} />
      {ed.query.isLoading && <p className="ls-empty">Lädt …</p>}
      {ed.lockedCount > 0 && (
        <p className="lr-head-note">{ed.lockedCount} {ed.lockedCount === 1 ? 'Element hat' : 'Elemente haben'} schon einen Stand nach dem {deDate(asOf)} und {ed.lockedCount === 1 ? 'ist' : 'sind'} hier gesperrt.</p>
      )}
      {!ed.query.isLoading && <LeistungsstandTable ed={ed} canEdit={canEdit} onLastEnter={() => primaryRef.current?.focus()} />}

      {canEdit && (
        <ActionBar
          className="lsr-bar"
          dirty={ed.dirty}
          status={summary.errors ? `${summary.errors} ungültige${summary.errors === 1 ? 's Feld' : ' Felder'}`
            : summary.changed ? <>{summary.changed} {summary.changed === 1 ? 'Element' : 'Elemente'} geändert · <span style={negativeStyle(summary.delta)}>{summary.delta > 0 ? '+' : ''}{fmtEur(summary.delta)}</span></>
            : 'Keine Änderung'}
          secondary={<button type="button" className="btn-secondary" onClick={onSkip} disabled={!!ed.pending}>Überspringen</button>}
        >
          {summary.changed > 0 ? (
            <>
              <button type="button" className="btn-secondary lsr-discard" onClick={() => ed.reset()} disabled={!!ed.pending}>Verwerfen</button>
              <button ref={primaryRef} type="button" className="btn-primary" onClick={() => void saveNext().catch(() => {})}
                disabled={!!ed.pending || summary.errors > 0}>
                {ed.pending ? 'Speichert …' : 'Speichern & nächstes'}
              </button>
            </>
          ) : (
            <>
              <HelpHint id="performance.confirm" align="right" />
              <button ref={primaryRef} type="button" className="btn-primary" onClick={() => void confirmNext()}
                disabled={!!ed.pending || summary.errors > 0 || ed.query.isLoading}>
                {ed.pending ? 'Bestätigt …' : 'Unverändert bestätigen'}
              </button>
            </>
          )}
        </ActionBar>
      )}
    </section>
  )
}
