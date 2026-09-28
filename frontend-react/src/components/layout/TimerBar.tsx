import { useState, useEffect, useMemo, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Pause, Play, ArrowRight, Square, X, Pencil, Trash2, Check, Coffee, AlertTriangle, CheckCircle2, Info, ClipboardCheck } from 'lucide-react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useTimerStore, elapsedSeconds, formatDuration, formatDurationHuman, quantityFromSeconds } from '@/store/timerStore'
import type { TimerSession } from '@/store/timerStore'
import { createTimerDraft, fetchDrafts, confirmDrafts, deleteTimerDraft, patchDraft, fetchWorkstartStatus } from '@/api/timer'
import type { DraftEntry } from '@/api/timer'
import { fetchArbzgLimits } from '@/api/arbzg'
import type { ArbzgLimits, BreakConfirmation, BreakConfirmationMap } from '@/api/arbzg'
import { useAuthStore } from '@/store/authStore'
import { localIsoDate, fmtHours } from '@/utils/zeit'
import { useIsNarrow } from '@/hooks/useIsNarrow'
import { Modal } from '@/components/ui/Modal'
import { DialogFooter } from '@/components/ui/DialogFooter'
import { Message } from '@/components/ui/Message'
import { HelpHint } from '@/components/ui/HelpHint'
import { TextSnippetBar } from '@/components/ui/TextSnippetBar'
import { LeafFields } from '@/components/zeit/LeafChoice'
import { useLeafChoice } from '@/components/zeit/useLeafChoice'

/*
 * Stempeluhr-Dialoge (UI-Pilot 2026-09, Runde 2).
 *
 * Vorher vier handgebaute Overlays (`.tbm-overlay`) ohne Escape, ohne
 * Fokusfalle und ohne Fokus-Rueckgabe, mit Emoji als Symbolen (▶⏭⏹📋✎🗑⚠✓)
 * und zwei nackten Auswahllisten, die als „Leistung" auch Knoten mit
 * Unterelementen anboten. Jetzt `Modal` + `DialogFooter` (Abbrechen links,
 * Hauptaktion rechts) und dieselbe Projekt-/Leistungswahl wie „Zeit buchen",
 * samt „Zuletzt gebucht".
 */

// Lokales Datum — das UTC-Datum ist zwischen 0 und 2 Uhr noch gestern.
function nowDateIso()  { return localIsoDate() }
function nowTimeIso()  { return new Date().toTimeString().slice(0, 8) }
const hhmm = (iso: string) => new Date(iso).toTimeString().slice(0, 5)

/** Der abgeschlossene Abschnitt: was, seit wann, wie lange. */
function FinishedBlock({ label, session, elapsed }: { label: string; session: TimerSession; elapsed: number }) {
  return (
    <div className="tm-block">
      <span className="tm-block-label">{label}</span>
      <span className="tm-block-task">{session.projectName} / {session.structureName}</span>
      <span className="tm-block-time">
        seit {hhmm(session.blockStartIso)} · <strong>{formatDurationHuman(elapsed)}</strong>
      </span>
    </div>
  )
}

function DescriptionField({ id, value, onChange }: { id: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="form-group">
      <label htmlFor={id}>Was hast du gemacht? <span className="tm-optional">(optional, später änderbar)</span></label>
      <textarea id={id} rows={2} value={value} placeholder="z. B. Entwurf Grundrisse EG"
        onChange={e => onChange(e.target.value)} />
      <TextSnippetBar currentText={value} onChange={onChange} kind="WORK" />
    </div>
  )
}

/** Strg+S im Dialog: Hauptaktion, nicht die Seite dahinter. */
function ctrlS(run: () => void) {
  return (e: React.KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
      e.preventDefault(); e.stopPropagation(); run()
    }
  }
}

/**
 * Dialoge der Stempeluhr an <body> haengen. Die Uhr sitzt in der Kopfzeile
 * (z-index 90), die untere Navigation liegt darueber (100) — ein Dialog im
 * Kopf bleibt in dessen Ebene gefangen, und am Handy verdeckte die Navigation
 * die Fusszeile mit „Abbrechen" und der Hauptaktion.
 */
const InBody = ({ children }: { children: ReactNode }) => createPortal(children, document.body)

// ── Start ─────────────────────────────────────────────────────────────────────

function StartModal({ onClose }: { onClose: () => void }) {
  const startSession = useTimerStore(s => s.startSession)
  // Die Stempeluhr laeuft immer fuer den angemeldeten Nutzer. Vorher gab es
  // hier ein Mitarbeiterfeld: gespeichert wurde trotzdem fuer die Sitzung
  // (der Server erzwingt das), gelesen und bestaetigt aber fuer den gewaehlten
  // Kollegen. Den Kostensatz ermittelt der Server selbst; die Anzeige kostete
  // ohne Gehaltsrecht einen 403-Hinweis.
  const employeeId   = useAuthStore(s => s.employeeId)
  const employeeName = useAuthStore(s => s.shortName)
  const leaf = useLeafChoice()
  const ready = !!employeeId && leaf.projectId != null && leaf.structureId != null

  function handleStart() {
    if (!ready || !employeeId || leaf.projectId == null || leaf.structureId == null) return
    leaf.remember()
    startSession({
      employeeId,
      employeeName: employeeName ?? String(employeeId),
      cpRate: 0,
      projectId:     leaf.projectId,
      projectName:   leaf.projectAbbr(leaf.projectId) || String(leaf.projectId),
      structureId:   leaf.structureId,
      structureName: leaf.leafLabel(leaf.structureId),
      blockStartIso: new Date().toISOString(),
    })
    onClose()
  }

  return (
    <Modal open onClose={onClose} title="Stempeluhr starten" className="qb-dialog">
      <div className="qb-form" onKeyDown={ctrlS(handleStart)}>
        <p className="tm-lead">
          Die Uhr misst ab jetzt. Bei „Nächste Aufgabe“, „Pause“ und „Beenden“ wird die Zeit bis dahin
          als Entwurf gesichert; gebucht ist erst, was du am Ende des Tages freigibst.
          <HelpHint id="timer.flow" size={13} />
        </p>
        <LeafFields choice={leaf} idPrefix="tm-start" leafLabel="Woran arbeitest du?" />
        <DialogFooter>
          <button type="button" className="btn-secondary" onClick={onClose}>Abbrechen</button>
          <button type="button" className="btn-primary" disabled={!ready} onClick={handleStart}>
            <Play size={14} strokeWidth={2} aria-hidden="true" /> Starten
          </button>
        </DialogFooter>
      </div>
    </Modal>
  )
}

// ── Nächste Aufgabe ───────────────────────────────────────────────────────────

function NextTaskModal({ onClose }: { onClose: () => void }) {
  const { session, nextBlock } = useTimerStore()
  const qc = useQueryClient()
  const leaf = useLeafChoice()
  const [description, setDescription] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError]   = useState<string | null>(null)
  // Beim Oeffnen einfrieren: die Uhr laeuft weiter, der Dialog zeigt, was
  // beim Klick gesichert wird — gesichert wird trotzdem bis „jetzt".
  const [openedAt] = useState(() => Date.now())

  if (!session) return null
  const elapsed = Math.max(0, Math.floor((openedAt - new Date(session.blockStartIso).getTime()) / 1000))
  const same = leaf.projectId === session.projectId && leaf.structureId === session.structureId
  const ready = leaf.projectId != null && leaf.structureId != null && !same

  async function handleNext() {
    if (!ready || !session || leaf.projectId == null || leaf.structureId == null) return
    setSaving(true)
    setError(null)
    try {
      await createTimerDraft({
        EMPLOYEE_ID:         session.employeeId,
        PROJECT_ID:          session.projectId,
        STRUCTURE_ID:        session.structureId,
        BOOKING_DATE:        nowDateIso(),
        TIME_START:          new Date(session.blockStartIso).toTimeString().slice(0, 8),
        TIME_FINISH:         nowTimeIso(),
        QUANTITY_INT:        quantityFromSeconds(elapsedSeconds(session.blockStartIso)),
        COST_RATE:           session.cpRate,
        POSTING_DESCRIPTION: description,
      })
      leaf.remember()
      nextBlock(leaf.structureId, leaf.leafLabel(leaf.structureId), leaf.projectId,
        leaf.projectAbbr(leaf.projectId) || String(leaf.projectId))
      void qc.invalidateQueries({ queryKey: ['timer-drafts'] })
      onClose()
    } catch (e: unknown) {
      setError((e as { message?: string }).message ?? 'Speichern fehlgeschlagen')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal open onClose={onClose} title="Nächste Aufgabe" className="qb-dialog">
      <div className="qb-form" onKeyDown={ctrlS(() => void handleNext())}>
        <FinishedBlock label="Bisher" session={session} elapsed={elapsed} />
        <DescriptionField id="tm-next-desc" value={description} onChange={setDescription} />
        <div className="tm-divider" role="presentation"><ArrowRight size={14} strokeWidth={2} aria-hidden="true" /> danach</div>
        <LeafFields choice={leaf} idPrefix="tm-next" leafLabel="Nächste Leistung" />
        {same && <p className="form-field-hint">Das ist die laufende Aufgabe.</p>}
        <Message text={error} type="error" />
        <DialogFooter>
          <button type="button" className="btn-secondary" onClick={onClose} disabled={saving}>Abbrechen</button>
          <button type="button" className="btn-primary" disabled={!ready || saving} onClick={() => void handleNext()}>
            <ArrowRight size={14} strokeWidth={2} aria-hidden="true" /> {saving ? 'Sichert …' : 'Wechseln'}
          </button>
        </DialogFooter>
      </div>
    </Modal>
  )
}

// ── Beenden ───────────────────────────────────────────────────────────────────

function FinishModal({ onClose }: { onClose: () => void }) {
  const { session, openReview, endSession } = useTimerStore()
  const qc = useQueryClient()
  const [description, setDescription] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError]   = useState<string | null>(null)
  const [openedAt] = useState(() => Date.now())

  if (!session) return null
  const elapsed = Math.max(0, Math.floor((openedAt - new Date(session.blockStartIso).getTime()) / 1000))

  async function handleFinish() {
    if (!session) return
    setSaving(true)
    setError(null)
    try {
      await createTimerDraft({
        EMPLOYEE_ID:         session.employeeId,
        PROJECT_ID:          session.projectId,
        STRUCTURE_ID:        session.structureId,
        BOOKING_DATE:        nowDateIso(),
        TIME_START:          new Date(session.blockStartIso).toTimeString().slice(0, 8),
        TIME_FINISH:         nowTimeIso(),
        QUANTITY_INT:        quantityFromSeconds(elapsedSeconds(session.blockStartIso)),
        COST_RATE:           session.cpRate,
        POSTING_DESCRIPTION: description,
      })
      void qc.invalidateQueries({ queryKey: ['timer-drafts'] })
      // Die Uhr ist ab hier aus. Vorher lief sie bis zur Freigabe weiter —
      // wer die Tagesuebersicht mit „Spaeter" schloss, hatte eine Uhr, die
      // den schon gesicherten Abschnitt ein zweites Mal zaehlte.
      endSession()
      onClose()
      openReview()
    } catch (e: unknown) {
      setError((e as { message?: string }).message ?? 'Speichern fehlgeschlagen')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal open onClose={onClose} title="Arbeitstag beenden" className="qb-dialog">
      <div className="qb-form" onKeyDown={ctrlS(() => void handleFinish())}>
        <FinishedBlock label="Letzte Aufgabe" session={session} elapsed={elapsed} />
        <DescriptionField id="tm-finish-desc" value={description} onChange={setDescription} />
        <p className="tm-lead">Danach siehst du alle Einträge von heute und gibst sie frei.</p>
        <Message text={error} type="error" />
        <DialogFooter>
          <button type="button" className="btn-secondary" onClick={onClose} disabled={saving}>Abbrechen</button>
          <button type="button" className="btn-primary" disabled={saving} onClick={() => void handleFinish()}>
            <Square size={12} strokeWidth={2} aria-hidden="true" /> {saving ? 'Sichert …' : 'Beenden & prüfen'}
          </button>
        </DialogFooter>
      </div>
    </Modal>
  )
}

// ── Tagesübersicht ────────────────────────────────────────────────────────────

interface EditingRow {
  id:          number
  timeStart:   string
  timeFinish:  string
  quantityInt: string
  description: string
}

const fmtDateDe = (iso: string) => {
  const [y, m, d] = iso.split('-')
  return `${d}.${m}.${y}`
}

function DayReviewModal({ onClose }: { onClose: () => void }) {
  const reviewDate = useTimerStore(s => s.reviewDate)
  const qc = useQueryClient()
  // Immer die eigenen Entwuerfe — auch ohne laufende Uhr (aus „Meine Zeit").
  const employeeId = useAuthStore(s => s.employeeId) ?? undefined
  const [editRow,    setEditRow]    = useState<EditingRow | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [error,      setError]      = useState<string | null>(null)
  const [breakChoice, setBreakChoice] = useState<'auto' | 'manual'>('auto')
  const [breakManualMin, setBreakManualMin] = useState<string>('')

  const today = reviewDate ?? nowDateIso()

  const { data: draftsData, isLoading } = useQuery({
    queryKey: ['timer-drafts', employeeId, today],
    queryFn: () => fetchDrafts(employeeId!, today),
    enabled: !!employeeId,
    refetchOnWindowFocus: false,
  })
  const { data: limitsData } = useQuery({
    queryKey: ['arbzg-limits', employeeId, today],
    queryFn: () => fetchArbzgLimits(employeeId!, today),
    enabled: !!employeeId,
    refetchOnWindowFocus: false,
  })

  const drafts = useMemo(() => (draftsData?.data ?? []) as DraftEntry[], [draftsData])
  const totalH = drafts
    .filter(d => (d.ENTRY_KIND ?? 'WORK') === 'WORK')
    .reduce((s, d) => s + Number(d.QUANTITY_INT ?? 0), 0)
  const breakH = drafts
    .filter(d => d.ENTRY_KIND === 'BREAK')
    .reduce((s, d) => s + Number(d.QUANTITY_INT ?? 0), 0)

  // ── ArbZG-Auswertung der Drafts ───────────────────────────────────────
  const limits = limitsData?.data as ArbzgLimits | undefined
  const breakAnalysis = useMemo(() => {
    if (!limits?.settings.enabled || !limits.settings.checkBreakRequired) return null
    const dayWork = drafts
      .filter(d => (d.ENTRY_KIND ?? 'WORK') === 'WORK')
      .reduce((s, d) => s + Number(d.QUANTITY_INT ?? 0), 0)
    const breakMin = drafts
      .filter(d => d.ENTRY_KIND === 'BREAK')
      .reduce((s, d) => s + Math.round(Number(d.QUANTITY_INT ?? 0) * 60), 0)
    const br = limits.breakRule
    const required = dayWork > Number(br.T2_HOURS) ? Number(br.T2_BREAK_MIN)
                   : dayWork > Number(br.T1_HOURS) ? Number(br.T1_BREAK_MIN)
                   : 0
    const missing  = Math.max(0, required - breakMin)
    return { dayWork, breakMin, required, missing, breakRule: br }
  }, [drafts, limits])

  const dayKey = employeeId ? `${employeeId}|${today}` : ''
  const needsBreakConfirm =
    !!limits?.settings.autoBreakRequireConfirm &&
    !!breakAnalysis &&
    breakAnalysis.missing > 0

  const deleteMut = useMutation({
    mutationFn: (id: number) => deleteTimerDraft(id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['timer-drafts'] }),
    onError:   (e: unknown) => setError((e as { message?: string }).message ?? 'Löschen fehlgeschlagen'),
  })

  const patchMut = useMutation({
    mutationFn: ({ id, body }: { id: number; body: Parameters<typeof patchDraft>[1] }) =>
      patchDraft(id, body),
    onSuccess: () => {
      setEditRow(null)
      void qc.invalidateQueries({ queryKey: ['timer-drafts'] })
    },
    onError: (e: unknown) => setError((e as { message?: string }).message ?? 'Speichern fehlgeschlagen'),
  })

  function startEdit(d: DraftEntry) {
    setEditRow({
      id:          d.ID,
      timeStart:   d.TIME_START?.slice(0, 5) ?? '',
      timeFinish:  d.TIME_FINISH?.slice(0, 5) ?? '',
      quantityInt: d.QUANTITY_INT != null ? fmtHours(Number(d.QUANTITY_INT)) : '',
      description: d.POSTING_DESCRIPTION ?? '',
    })
  }

  function onTimeChange(field: 'timeStart' | 'timeFinish', val: string) {
    if (!editRow) return
    const next = { ...editRow, [field]: val }
    if (next.timeStart && next.timeFinish) {
      const [sh, sm] = next.timeStart.split(':').map(Number)
      const [fh, fm] = next.timeFinish.split(':').map(Number)
      const diffMin = Math.max(0, fh * 60 + fm - (sh * 60 + sm))
      next.quantityInt = fmtHours(Math.round(diffMin / 60 * 100) / 100)
    }
    setEditRow(next)
  }

  function saveEdit() {
    if (!editRow) return
    const qty = Number(editRow.quantityInt.replace(',', '.'))
    patchMut.mutate({
      id: editRow.id,
      body: {
        description:  editRow.description,
        time_start:   editRow.timeStart  ? editRow.timeStart  + ':00' : undefined,
        time_finish:  editRow.timeFinish ? editRow.timeFinish + ':00' : undefined,
        quantity_int: editRow.quantityInt && Number.isFinite(qty) ? qty : undefined,
      },
    })
  }

  async function handleConfirm() {
    if (!drafts.length) return
    setConfirming(true)
    setError(null)
    try {
      const confirmations: BreakConfirmationMap = {}
      if (needsBreakConfirm && dayKey && breakAnalysis) {
        const c: BreakConfirmation = breakChoice === 'manual'
          ? { kind: 'BREAK_TAKEN_UNRECORDED',
              minutes: Number(breakManualMin) || breakAnalysis.missing }
          : { kind: 'ACCEPT_AUTO_DEDUCT' }
        confirmations[dayKey] = c
      }
      await confirmDrafts(drafts.map(d => d.ID), confirmations)
      for (const key of ['buchungen', 'structure', 'arbzg-audit', 'timer-drafts', 'my-time', 'emp-balance', 'workstart-status']) {
        void qc.invalidateQueries({ queryKey: [key] })
      }
      onClose()
    } catch (e: unknown) {
      const err = e as { message?: string; details?: { code?: string } }
      const code = err.details?.code
      setError(code === 'ARBZG_BREAK_CONFIRM_REQUIRED'
        ? 'Bitte Pausenbestätigung wählen, bevor freigegeben wird.'
        : (err.message ?? 'Freigeben fehlgeschlagen'))
      setConfirming(false)
    }
  }

  return (
    <Modal open onClose={onClose} title={`Tagesübersicht ${fmtDateDe(today)}`} className="qb-dialog tm-review">
      <div className="qb-form">
        <p className="tm-lead">
          Prüfe die Einträge der Stempeluhr und gib sie frei — erst dann sind sie gebucht.
          Bis dahin kannst du Zeiten und Beschreibung noch ändern.
          <HelpHint id="timer.review" size={13} />
        </p>

        {isLoading && <p className="tm-empty">Lädt Einträge …</p>}
        {!isLoading && drafts.length === 0 && (
          <p className="tm-empty">Für diesen Tag gibt es keine offenen Einträge der Stempeluhr.</p>
        )}

        {/* ── ArbZG-Block ─────────────────────────────────────────── */}
        {limits?.settings.enabled && breakAnalysis && breakAnalysis.required > 0 && (
          <div className={`tm-arbzg ${breakAnalysis.missing > 0 ? 'tm-arbzg--warn' : 'tm-arbzg--ok'}`}
            role={breakAnalysis.missing > 0 ? 'alert' : undefined}>
            {breakAnalysis.missing > 0 ? (
              <>
                <div className="tm-arbzg-title">
                  <AlertTriangle size={15} strokeWidth={2} aria-hidden="true" />
                  {fmtHours(breakAnalysis.dayWork)} h Arbeit ohne ausreichende Pause
                </div>
                <div className="tm-arbzg-meta">
                  Erforderlich {breakAnalysis.required} min · gestempelt {breakAnalysis.breakMin} min ·
                  es fehlen {breakAnalysis.missing} min
                  {limits.breakRule?.NAME && <> ({limits.breakRule.NAME})</>}
                </div>
                {needsBreakConfirm && (
                  <fieldset className="tm-arbzg-choices">
                    <legend className="sr-only">Wie soll die fehlende Pause behandelt werden?</legend>
                    <label className="tm-arbzg-choice">
                      <input type="radio" name="brkChoice"
                        checked={breakChoice === 'auto'}
                        onChange={() => setBreakChoice('auto')} />
                      <span>
                        {breakAnalysis.missing} min vom letzten Arbeitsblock abziehen
                      </span>
                    </label>
                    <label className="tm-arbzg-choice">
                      <input type="radio" name="brkChoice"
                        checked={breakChoice === 'manual'}
                        onChange={() => setBreakChoice('manual')} />
                      <span className="tm-arbzg-manual">
                        Ich habe zusätzlich
                        <input type="number" min={1} step={5} inputMode="numeric"
                          aria-label="Minuten Pause"
                          value={breakManualMin}
                          placeholder={String(breakAnalysis.missing)}
                          onFocus={() => setBreakChoice('manual')}
                          onChange={e => setBreakManualMin(e.target.value)} />
                        min Pause gemacht (wird nachgetragen)
                      </span>
                    </label>
                  </fieldset>
                )}
              </>
            ) : (
              <div className="tm-arbzg-title">
                <CheckCircle2 size={15} strokeWidth={2} aria-hidden="true" />
                Pausenpflicht (§ 4 ArbZG) erfüllt — {breakAnalysis.breakMin} von {breakAnalysis.required} min
              </div>
            )}
            {breakAnalysis.dayWork > 8 && (
              <div className="tm-arbzg-info">
                <Info size={13} strokeWidth={2} aria-hidden="true" />
                Tagesarbeit {fmtHours(breakAnalysis.dayWork)} h wird nach § 16 Abs. 2 ArbZG dokumentiert.
              </div>
            )}
          </div>
        )}

        {drafts.length > 0 && (
          <ul className="tm-list" aria-label="Einträge der Stempeluhr">
            {drafts.map(d => {
              const isEditing = editRow?.id === d.ID
              const isBreak   = d.ENTRY_KIND === 'BREAK'
              return (
                <li key={d.ID} className={`tm-row${isBreak ? ' tm-row--break' : ''}${isEditing ? ' tm-row--editing' : ''}`}>
                  <div className="tm-row-main">
                    <span className="tm-row-time">
                      {d.TIME_START?.slice(0, 5)}–{d.TIME_FINISH?.slice(0, 5)}
                    </span>
                    <span className="tm-row-task">
                      {isBreak ? (
                        <><Coffee size={13} strokeWidth={2} aria-hidden="true" /> Pause</>
                      ) : (
                        <><strong>{d.PROJECT?.ABBR}</strong> · {d.STRUCTURE?.ABBR}{d.STRUCTURE?.NAME ? ` ${d.STRUCTURE.NAME}` : ''}</>
                      )}
                    </span>
                    <span className="tm-row-hours">{fmtHours(Number(d.QUANTITY_INT))} h</span>
                    {!isEditing && (
                      <span className="tm-row-actions">
                        <button type="button" className="row-action-btn" onClick={() => startEdit(d)}
                          aria-label={`Eintrag ${d.TIME_START?.slice(0, 5) ?? ''} bearbeiten`} title="Bearbeiten">
                          <Pencil size={14} strokeWidth={1.75} aria-hidden="true" />
                        </button>
                        <button type="button" className="row-action-btn row-action-btn--danger" onClick={() => deleteMut.mutate(d.ID)}
                          disabled={deleteMut.isPending}
                          aria-label={`Eintrag ${d.TIME_START?.slice(0, 5) ?? ''} löschen`} title="Löschen">
                          <Trash2 size={14} strokeWidth={1.75} aria-hidden="true" />
                        </button>
                      </span>
                    )}
                  </div>
                  {!isEditing && !isBreak && (
                    <div className={`tm-row-desc${d.POSTING_DESCRIPTION ? '' : ' tm-row-desc--missing'}`}>
                      {d.POSTING_DESCRIPTION || 'Noch keine Beschreibung'}
                    </div>
                  )}
                  {isEditing && editRow && (
                    <div className="tm-edit" onKeyDown={e => {
                      if (e.key === 'Escape') { e.stopPropagation(); setEditRow(null) }
                      if (e.key === 'Enter' && (e.target as HTMLElement).tagName !== 'TEXTAREA') { e.preventDefault(); saveEdit() }
                    }}>
                      <div className="tm-edit-times">
                        <div className="form-group">
                          <label htmlFor={`tm-e-von-${d.ID}`}>Von</label>
                          <input id={`tm-e-von-${d.ID}`} type="time" value={editRow.timeStart}
                            onChange={e => onTimeChange('timeStart', e.target.value)} />
                        </div>
                        <div className="form-group">
                          <label htmlFor={`tm-e-bis-${d.ID}`}>Bis</label>
                          <input id={`tm-e-bis-${d.ID}`} type="time" value={editRow.timeFinish}
                            onChange={e => onTimeChange('timeFinish', e.target.value)} />
                        </div>
                        <div className="form-group">
                          <label htmlFor={`tm-e-h-${d.ID}`}>Stunden</label>
                          <input id={`tm-e-h-${d.ID}`} type="text" inputMode="decimal" value={editRow.quantityInt}
                            onChange={e => setEditRow({ ...editRow, quantityInt: e.target.value })} />
                        </div>
                      </div>
                      {!isBreak && (
                        <div className="form-group">
                          <label htmlFor={`tm-e-d-${d.ID}`}>Beschreibung</label>
                          <input id={`tm-e-d-${d.ID}`} type="text" value={editRow.description} autoFocus
                            onChange={e => setEditRow({ ...editRow, description: e.target.value })} />
                        </div>
                      )}
                      <div className="tm-edit-actions">
                        <button type="button" className="btn-secondary btn-small" onClick={() => setEditRow(null)}>
                          <X size={13} strokeWidth={2} aria-hidden="true" /> Abbrechen
                        </button>
                        <button type="button" className="btn-primary btn-small" onClick={saveEdit} disabled={patchMut.isPending}>
                          <Check size={13} strokeWidth={2} aria-hidden="true" /> Übernehmen
                        </button>
                      </div>
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        )}

        {drafts.length > 0 && (
          <div className="tm-total">
            <span>Arbeit <strong>{fmtHours(totalH)} h</strong></span>
            {breakH > 0 && <span>Pause {fmtHours(breakH)} h</span>}
          </div>
        )}

        <Message text={error} type="error" />

        <DialogFooter>
          <button type="button" className="btn-secondary" onClick={onClose}>Später</button>
          {drafts.length > 0 && (
            <button type="button" className="btn-primary" disabled={confirming || !!editRow} onClick={() => void handleConfirm()}
              title={editRow ? 'Erst die offene Änderung übernehmen oder abbrechen' : undefined}>
              <ClipboardCheck size={14} strokeWidth={2} aria-hidden="true" />
              {confirming ? 'Gibt frei …' : drafts.length === 1 ? '1 Eintrag freigeben' : `${drafts.length} Einträge freigeben`}
            </button>
          )}
        </DialogFooter>
      </div>
    </Modal>
  )
}

/**
 * Tagesuebersicht, unabhaengig von der Kopfzeile eingehaengt (AppLayout).
 * Sie gehoert zum Freigeben, nicht zur laufenden Uhr: nach „Beenden" ist die
 * Uhr aus, und „Meine Zeit" oeffnet sie fuer liegengebliebene Entwuerfe.
 */
export function TimerReview() {
  const show        = useTimerStore(s => s.showReview)
  const closeReview = useTimerStore(s => s.closeReview)
  return show ? <DayReviewModal onClose={closeReview} /> : null
}

// ── Main TimerBar ─────────────────────────────────────────────────────────────

type ModalState = 'none' | 'start' | 'next' | 'finish'

const FMT_H1 = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 1 })
const fmtH1  = (h: number) => FMT_H1.format(h)

export function TimerBar() {
  const { session: storedSession, breakState: storedBreak, startBreak, endBreak, cancelBreak }
    = useTimerStore()
  // Die Sitzung liegt im Browser. Meldet sich am selben Rechner jemand
  // anderes an, gehoert sie nicht ihm: nicht anzeigen, nicht weiterfuehren.
  // Der Besitzer findet sie beim naechsten Anmelden wieder.
  const currentEmployeeId = useAuthStore(s => s.employeeId)
  const ownSession = !!storedSession && storedSession.employeeId === currentEmployeeId
  const session    = ownSession ? storedSession : null
  const breakState = ownSession ? storedBreak : null
  const qc = useQueryClient()
  const [modal,    setModal]    = useState<ModalState>('none')
  const [elapsed,  setElapsed]  = useState(0)
  const [brElapsed, setBrElapsed] = useState(0)
  const [savingBreak, setSavingBreak] = useState(false)
  const [breakErr,    setBreakErr]    = useState<string | null>(null)
  const [sheet,       setSheet]       = useState(false)
  const narrow = useIsNarrow()

  const today = nowDateIso()

  // Live clocks
  useEffect(() => {
    if (!session) { setElapsed(0); return }
    setElapsed(elapsedSeconds(session.blockStartIso))
    const id = setInterval(() => setElapsed(elapsedSeconds(session.blockStartIso)), 1000)
    return () => clearInterval(id)
  }, [session])

  useEffect(() => {
    if (!breakState) { setBrElapsed(0); return }
    setBrElapsed(elapsedSeconds(breakState.startIso))
    const id = setInterval(() => setBrElapsed(elapsedSeconds(breakState.startIso)), 1000)
    return () => clearInterval(id)
  }, [breakState])

  // Tageskumulation (für Live-Farbanzeige)
  const { data: draftsData } = useQuery({
    queryKey: ['timer-drafts', session?.employeeId, today],
    queryFn:  () => fetchDrafts(session!.employeeId, today),
    enabled:  !!session?.employeeId,
    refetchInterval: 60_000,
  })

  // Workstart-Auto-Popup: nur wenn keine Session aktiv ist (Start-Button
  // sichtbar). Wir holen Tenant-Schalter + ob heute schon BOOKING existiert in
  // einem Aufruf — pro eingeloggtem Mitarbeiter (employeeId im QueryKey,
  // damit Login-Wechsel auf demselben Browser nicht den Cache erbt).
  const { data: workstartStatus } = useQuery({
    queryKey: ['workstart-status', currentEmployeeId],
    queryFn:  fetchWorkstartStatus,
    enabled:  !session && !!currentEmployeeId,
    staleTime: 60_000,
  })
  useEffect(() => {
    const s = workstartStatus?.data
    if (!s) return
    if (session) return
    if (!s.autoshowEnabled) return
    if (s.hasBookingsToday) return
    if (modal !== 'none') return
    if (!currentEmployeeId) return
    // localStorage-Sperre: einmal pro Tag und Mitarbeiter automatisch
    // zeigen. Mit employeeId im Key teilt sich nicht der ganze Browser
    // einen einzigen "schon gezeigt"-Flag.
    const key = `workstart-autoshown-${currentEmployeeId}-${s.today}`
    if (localStorage.getItem(key) === '1') return
    localStorage.setItem(key, '1')
    setModal('start')
  }, [workstartStatus?.data, session, modal, currentEmployeeId])
  const persistedWorkH = (draftsData?.data ?? [])
    .filter(d => (d.ENTRY_KIND ?? 'WORK') === 'WORK')
    .reduce((s, d) => s + Number(d.QUANTITY_INT ?? 0), 0)
  const liveBlockH = breakState ? 0 : quantityFromSeconds(elapsed)
  const dayWorkH   = persistedWorkH + liveBlockH

  // Pause: erst den laufenden Arbeitsblock als Entwurf sichern. Vorher setzte
  // der Knopf nur den Pausenzustand — beim Weiterarbeiten begann ein neuer
  // Block, und die Zeit vom Blockbeginn bis zur Pause war verloren.
  async function handleStartBreak() {
    if (!session || breakState) return
    setSavingBreak(true)
    setBreakErr(null)
    try {
      const sec = elapsedSeconds(session.blockStartIso)
      if (sec >= 60) {
        await createTimerDraft({
          EMPLOYEE_ID:         session.employeeId,
          PROJECT_ID:          session.projectId,
          STRUCTURE_ID:        session.structureId,
          BOOKING_DATE:        today,
          TIME_START:          new Date(session.blockStartIso).toTimeString().slice(0, 8),
          TIME_FINISH:         nowTimeIso(),
          QUANTITY_INT:        quantityFromSeconds(sec),
          COST_RATE:           session.cpRate,
          POSTING_DESCRIPTION: '',
        })
        void qc.invalidateQueries({ queryKey: ['timer-drafts'] })
      }
      startBreak()
    } catch (e: unknown) {
      setBreakErr((e as { message?: string }).message ?? 'Arbeitszeit konnte nicht gesichert werden – Pause nicht gestartet')
    } finally {
      setSavingBreak(false)
    }
  }

  async function handleEndBreak() {
    if (!breakState || !session) return
    setSavingBreak(true)
    setBreakErr(null)
    try {
      const sec      = elapsedSeconds(breakState.startIso)
      const qty      = quantityFromSeconds(sec)
      const startStr = new Date(breakState.startIso).toTimeString().slice(0, 8)
      const finStr   = nowTimeIso()
      await createTimerDraft({
        EMPLOYEE_ID:         session.employeeId,
        PROJECT_ID:          null,
        STRUCTURE_ID:        null,
        BOOKING_DATE:        today,
        TIME_START:          startStr,
        TIME_FINISH:         finStr,
        QUANTITY_INT:        qty,
        COST_RATE:             0,
        POSTING_DESCRIPTION: 'Pause',
        ENTRY_KIND:          'BREAK',
      })
      void qc.invalidateQueries({ queryKey: ['timer-drafts'] })
      endBreak()
    } catch (e: unknown) {
      setBreakErr((e as { message?: string }).message ?? 'Fehler beim Speichern der Pause')
    } finally {
      setSavingBreak(false)
    }
  }

  const dayLevel = dayWorkH >= 10 ? 'red' : dayWorkH >= 9 ? 'orange' : dayWorkH >= 6 ? 'yellow' : 'green'
  const dayText  = `Heute ${fmtH1(dayWorkH)} h gearbeitet${dayWorkH >= 10 ? ' – über 10 Stunden' : dayWorkH >= 9 ? ' – über 9 Stunden' : ''}`

  if (!session) {
    return (
      <>
        <button className="hdr-action hdr-action--ghost" onClick={() => setModal('start')} title="Stempeluhr starten – misst die Zeit, während du arbeitest">
          <Play size={15} strokeWidth={2} aria-hidden="true" />
          <span className="hdr-label">Stempeluhr</span>
        </button>
        {modal === 'start' && <InBody><StartModal onClose={() => setModal('none')} /></InBody>}
      </>
    )
  }

  const taskLabel = `${session.projectName} / ${session.structureName}`
  const chip = (
    <>
      <span className={`timer-dot timer-dot--${breakState ? 'break' : dayLevel}`} aria-hidden="true" />
      <span className="timer-clock">{breakState ? `Pause ${formatDuration(brElapsed)}` : formatDuration(elapsed)}</span>
      {!narrow && <span className="timer-task">{breakState ? 'Pause läuft' : taskLabel}</span>}
      <span className="sr-only"> – {breakState ? 'Pause läuft' : `${taskLabel}. ${dayText}`}</span>
    </>
  )

  // Handy: nur der Chip; die Bedienung liegt in einem Sheet mit grossen Knoepfen.
  // Drei Symbole plus Uhr plus „Zeit buchen" passten nicht in 390px Kopfzeile.
  if (narrow) {
    return (
      <>
        <button type="button" className={`timer-chip timer-chip--button${breakState ? ' timer-chip--break' : ''}`}
          onClick={() => setSheet(true)} aria-label={`Stempeluhr: ${breakState ? 'Pause' : formatDuration(elapsed)} – Bedienung öffnen`}>
          {chip}
        </button>
        <InBody>
        <Modal open={sheet} onClose={() => setSheet(false)} title="Stempeluhr">
          <div className="timer-sheet">
            <div className="timer-sheet-now">
              <span className="timer-sheet-clock">{breakState ? formatDuration(brElapsed) : formatDuration(elapsed)}</span>
              <span className="timer-sheet-task">{breakState ? 'Pause läuft' : taskLabel}</span>
              <span className="timer-sheet-day">{dayText}</span>
            </div>
            {breakState ? (
              <>
                <button type="button" className="btn-primary timer-sheet-btn" disabled={savingBreak} onClick={() => { void handleEndBreak(); setSheet(false) }}>
                  <Play size={16} strokeWidth={2} aria-hidden="true" /> {savingBreak ? 'Speichert …' : 'Weiter arbeiten'}
                </button>
                <button type="button" className="btn-secondary timer-sheet-btn" onClick={() => { cancelBreak(); setSheet(false) }}>
                  <X size={16} strokeWidth={2} aria-hidden="true" /> Pause verwerfen
                </button>
              </>
            ) : (
              <>
                <button type="button" className="btn-secondary timer-sheet-btn" disabled={savingBreak} onClick={() => { void handleStartBreak().then(() => setSheet(false)) }}>
                  <Pause size={16} strokeWidth={2} aria-hidden="true" /> Pause
                </button>
                <button type="button" className="btn-secondary timer-sheet-btn" onClick={() => { setSheet(false); setModal('next') }}>
                  <ArrowRight size={16} strokeWidth={2} aria-hidden="true" /> Nächste Aufgabe
                </button>
                <button type="button" className="btn-primary timer-sheet-btn" onClick={() => { setSheet(false); setModal('finish') }}>
                  <Square size={14} strokeWidth={2} aria-hidden="true" /> Beenden &amp; prüfen
                </button>
              </>
            )}
            {breakErr && <p className="tbr-error">{breakErr}</p>}
          </div>
          <DialogFooter>
            <button type="button" className="btn-secondary" onClick={() => setSheet(false)}>Schließen</button>
          </DialogFooter>
        </Modal>
        </InBody>
        {modal === 'next'   && <InBody><NextTaskModal onClose={() => setModal('none')} /></InBody>}
        {modal === 'finish' && <InBody><FinishModal   onClose={() => setModal('none')} /></InBody>}
      </>
    )
  }

  if (breakState) {
    return (
      <div className="timer-run">
        <span className="timer-chip timer-chip--break" title={dayText}>{chip}</span>
        <button className="hdr-action" disabled={savingBreak} onClick={handleEndBreak}>
          <Play size={14} strokeWidth={2} aria-hidden="true" />
          <span className="hdr-label">{savingBreak ? 'Speichert …' : 'Weiter arbeiten'}</span>
        </button>
        <button className="hdr-action hdr-action--ghost" title="Pause verwerfen (nicht buchen)" onClick={cancelBreak}>
          <X size={14} strokeWidth={2} aria-hidden="true" />
          <span className="sr-only">Pause verwerfen</span>
        </button>
        {breakErr && <span className="tbr-error">{breakErr}</span>}
      </div>
    )
  }

  // Drei gleichrangige Knoepfe statt drei verschiedenfarbiger Flaechen
  // (vorher Orange, Blau, Schwarz — zusammen mit dem gruenen Start war die
  // Kopfzeile das Lauteste auf jeder Seite).
  return (
    <>
      <div className="timer-run">
        <span className="timer-chip" title={`${taskLabel} · ${dayText}`}>{chip}</span>
        <button className="hdr-action" onClick={() => void handleStartBreak()} disabled={savingBreak} title="Pause starten – die Arbeitszeit bis jetzt wird gesichert">
          <Pause size={14} strokeWidth={2} aria-hidden="true" />
          <span className="hdr-label">{savingBreak ? 'Sichert …' : 'Pause'}</span>
        </button>
        <button className="hdr-action" onClick={() => setModal('next')} title="Aufgabe wechseln">
          <ArrowRight size={14} strokeWidth={2} aria-hidden="true" />
          <span className="hdr-label">Nächste Aufgabe</span>
        </button>
        <button className="hdr-action" onClick={() => setModal('finish')} title="Arbeitstag beenden und Buchungen prüfen">
          <Square size={12} strokeWidth={2} aria-hidden="true" />
          <span className="hdr-label">Beenden</span>
        </button>
      </div>

      {modal === 'next'   && <InBody><NextTaskModal onClose={() => setModal('none')} /></InBody>}
      {modal === 'finish' && <InBody><FinishModal   onClose={() => setModal('none')} /></InBody>}
    </>
  )
}
