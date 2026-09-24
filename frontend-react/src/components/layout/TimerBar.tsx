import { useState, useEffect, useMemo } from 'react'
import { Pause, Play, ArrowRight, Square, X } from 'lucide-react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useTimerStore, elapsedSeconds, formatDuration, formatDurationHuman, quantityFromSeconds } from '@/store/timerStore'
import type { TimerSession } from '@/store/timerStore'
import { fetchProjectsShort, fetchProjectStructure } from '@/api/projekte'
import { createTimerDraft, fetchDrafts, confirmDrafts, deleteTimerDraft, patchDraft, fetchWorkstartStatus } from '@/api/timer'
import type { DraftEntry } from '@/api/timer'
import { fetchArbzgLimits } from '@/api/arbzg'
import type { ArbzgLimits, BreakConfirmation, BreakConfirmationMap } from '@/api/arbzg'
import { buildStructureTree, flattenTree } from '@/utils/treeUtils'
import type { StructureNode } from '@/api/projekte'
import { useAuthStore } from '@/store/authStore'
import { localIsoDate } from '@/utils/zeit'
import { useBackdropClose } from '@/hooks/useBackdropClose'
import { useIsNarrow } from '@/hooks/useIsNarrow'
import { Modal } from '@/components/ui/Modal'
import { DialogFooter } from '@/components/ui/DialogFooter'

// ── Small helpers ─────────────────────────────────────────────────────────────

// Lokales Datum — das UTC-Datum ist zwischen 0 und 2 Uhr noch gestern.
function nowDateIso()  { return localIsoDate() }
function nowTimeIso()  { return new Date().toTimeString().slice(0, 8) }

function LeafPicker({
  label, projectId, onProjectId, structureId, onStructureId,
}: {
  label: string
  projectId: number | null
  onProjectId: (id: number | null) => void
  structureId: number | null
  onStructureId: (id: number | null, name: string) => void
}) {
  const { data: projectsData } = useQuery({ queryKey: ['projects-short'], queryFn: fetchProjectsShort })
  const { data: structData } = useQuery({
    queryKey: ['structure', projectId],
    queryFn: () => fetchProjectStructure(projectId!),
    enabled: projectId !== null,
  })

  const projects = projectsData?.data ?? []
  const allNodes = (structData?.data ?? []) as StructureNode[]
  const tree = buildStructureTree(allNodes)
  const flat = flattenTree(tree)
  const fatherIds = new Set(allNodes.filter(n => n.FATHER_ID != null).map(n => String(n.FATHER_ID)))
  const leaves = flat.filter(fn => !fatherIds.has(String(fn.node.STRUCTURE_ID)))

  return (
    <div className="tbm-field-group">
      <label className="tbm-label">{label}</label>
      <select
        className="tbm-select"
        value={projectId ?? ''}
        onChange={e => { onProjectId(e.target.value ? Number(e.target.value) : null); onStructureId(null, '') }}
      >
        <option value="">— Projekt wählen —</option>
        {projects.map(p => <option key={p.ID} value={p.ID}>{p.ABBR} – {p.NAME}</option>)}
      </select>
      {projectId && (
        <select
          className="tbm-select"
          value={structureId ?? ''}
          onChange={e => {
            const id = e.target.value ? Number(e.target.value) : null
            const name = leaves.find(fn => fn.node.STRUCTURE_ID === id)?.node.ABBR ?? ''
            onStructureId(id, name)
          }}
        >
          <option value="">— Leistung wählen —</option>
          {leaves.map(({ node, depth }) => (
            <option key={node.STRUCTURE_ID} value={node.STRUCTURE_ID}>
              {'  '.repeat(depth)}{node.ABBR}{node.NAME ? ` – ${node.NAME}` : ''}
            </option>
          ))}
        </select>
      )}
    </div>
  )
}

// ── Start modal ───────────────────────────────────────────────────────────────

function StartModal({ onClose }: { onClose: () => void }) {
  const backdrop = useBackdropClose(onClose)
  const startSession = useTimerStore(s => s.startSession)
  // Die Stempeluhr laeuft immer fuer den angemeldeten Nutzer. Vorher gab es
  // hier ein Mitarbeiterfeld: gespeichert wurde trotzdem fuer die Sitzung
  // (der Server erzwingt das), gelesen und bestaetigt aber fuer den gewaehlten
  // Kollegen. Den Kostensatz ermittelt der Server selbst; die Anzeige kostete
  // ohne Gehaltsrecht einen 403-Hinweis.
  const employeeId   = useAuthStore(s => s.employeeId)
  const employeeName = useAuthStore(s => s.shortName)
  const [projectId,     setProjectId]     = useState<number | null>(null)
  const [structureId,   setStructureId]   = useState<number | null>(null)
  const [structureName, setStructureName] = useState('')

  const projects = useQuery({ queryKey: ['projects-short'], queryFn: fetchProjectsShort })
  const projectMap = Object.fromEntries((projects.data?.data ?? []).map(p => [p.ID, p.ABBR]))

  function handleStart() {
    if (!employeeId || !structureId || !projectId) return
    const session: TimerSession = {
      employeeId,
      employeeName: employeeName ?? String(employeeId),
      cpRate: 0,
      projectId,
      projectName: projectMap[projectId] ?? String(projectId),
      structureId,
      structureName,
      blockStartIso: new Date().toISOString(),
    }
    startSession(session)
    onClose()
  }

  const ready = !!employeeId && !!structureId

  return (
    <div className="tbm-overlay" {...backdrop}>
      <div className="tbm-modal">
        <div className="tbm-modal-header">
          <span className="tbm-modal-title">▶ Arbeitstag starten</span>
          <button className="tbm-modal-close" onClick={onClose}>✕</button>
        </div>

        <div className="tbm-modal-body">
          <LeafPicker
            label="Erste Aufgabe"
            projectId={projectId}
            onProjectId={id => { setProjectId(id) }}
            structureId={structureId}
            onStructureId={(id, name) => { setStructureId(id); setStructureName(name) }}
          />
        </div>

        <div className="tbm-modal-footer">
          <button className="btn btn-secondary" onClick={onClose}>Abbrechen</button>
          <button className="btn btn-primary" disabled={!ready} onClick={handleStart}>
            ▶ Aufgabe starten
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Next task modal ───────────────────────────────────────────────────────────

function NextTaskModal({ onClose }: { onClose: () => void }) {
  const backdrop = useBackdropClose(onClose)
  const { session, nextBlock } = useTimerStore()
  const qc = useQueryClient()

  const [description,  setDescription]  = useState('')
  const [projectId,    setProjectId]    = useState<number | null>(null)
  const [structureId,  setStructureId]  = useState<number | null>(null)
  const [structureName, setStructureName] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError]   = useState<string | null>(null)

  const projects = useQuery({ queryKey: ['projects-short'], queryFn: fetchProjectsShort })
  const projectMap = Object.fromEntries((projects.data?.data ?? []).map(p => [p.ID, p.ABBR]))

  if (!session) return null
  const elapsed = elapsedSeconds(session.blockStartIso)
  const finishTime = nowTimeIso()
  const ready = !!structureId

  async function handleNext() {
    if (!structureId || !projectId || !session) return
    setSaving(true)
    setError(null)
    try {
      await createTimerDraft({
        EMPLOYEE_ID:         session.employeeId,
        PROJECT_ID:          session.projectId,
        STRUCTURE_ID:        session.structureId,
        BOOKING_DATE:        nowDateIso(),
        TIME_START:          new Date(session.blockStartIso).toTimeString().slice(0, 8),
        TIME_FINISH:         finishTime,
        QUANTITY_INT:        quantityFromSeconds(elapsed),
        COST_RATE:             session.cpRate,
        POSTING_DESCRIPTION: description,
      })
      nextBlock(structureId, structureName, projectId, projectMap[projectId] ?? String(projectId))
      void qc.invalidateQueries({ queryKey: ['timer-drafts'] })
      onClose()
    } catch (e: unknown) {
      setError((e as { message?: string }).message ?? 'Fehler')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="tbm-overlay" {...backdrop}>
      <div className="tbm-modal">
        <div className="tbm-modal-header">
          <span className="tbm-modal-title">⏭ Nächste Aufgabe</span>
          <button className="tbm-modal-close" onClick={onClose}>✕</button>
        </div>

        <div className="tbm-modal-body">
          <div className="tbm-prev-task">
            <span className="tbm-prev-label">Abgeschlossene Aufgabe</span>
            <span className="tbm-prev-name">{session.projectName} / {session.structureName}</span>
            <span className="tbm-prev-duration">{formatDurationHuman(elapsed)}</span>
          </div>

          <div className="tbm-field-group">
            <label className="tbm-label">Tätigkeitsbeschreibung (optional)</label>
            <textarea
              className="tbm-textarea"
              rows={2}
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="Was wurde gemacht?"
            />
          </div>

          <LeafPicker
            label="Nächste Aufgabe"
            projectId={projectId}
            onProjectId={id => { setProjectId(id) }}
            structureId={structureId}
            onStructureId={(id, name) => { setStructureId(id); setStructureName(name) }}
          />

          {error && <p className="tbm-error">{error}</p>}
        </div>

        <div className="tbm-modal-footer">
          <button className="btn btn-secondary" onClick={onClose}>Abbrechen</button>
          <button className="btn btn-primary" disabled={!ready || saving} onClick={handleNext}>
            {saving ? 'Speichern…' : '⏭ Weiter'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Finish modal ──────────────────────────────────────────────────────────────

function FinishModal({ onClose }: { onClose: () => void }) {
  const backdrop = useBackdropClose(onClose)
  const { session, openReview } = useTimerStore()
  const qc = useQueryClient()

  const [description, setDescription] = useState('')
  const [saving, setSaving]           = useState(false)
  const [error, setError]             = useState<string | null>(null)

  if (!session) return null
  const elapsed    = elapsedSeconds(session.blockStartIso)
  const finishTime = nowTimeIso()

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
        TIME_FINISH:         finishTime,
        QUANTITY_INT:        quantityFromSeconds(elapsed),
        COST_RATE:             session.cpRate,
        POSTING_DESCRIPTION: description,
      })
      void qc.invalidateQueries({ queryKey: ['timer-drafts'] })
      onClose()
      openReview()
    } catch (e: unknown) {
      setError((e as { message?: string }).message ?? 'Fehler')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="tbm-overlay" {...backdrop}>
      <div className="tbm-modal">
        <div className="tbm-modal-header">
          <span className="tbm-modal-title">⏹ Buchungen abschließen</span>
          <button className="tbm-modal-close" onClick={onClose}>✕</button>
        </div>

        <div className="tbm-modal-body">
          <div className="tbm-prev-task">
            <span className="tbm-prev-label">Letzte Aufgabe</span>
            <span className="tbm-prev-name">{session.projectName} / {session.structureName}</span>
            <span className="tbm-prev-duration">{formatDurationHuman(elapsed)}</span>
          </div>

          <div className="tbm-field-group">
            <label className="tbm-label">Tätigkeitsbeschreibung (optional)</label>
            <textarea
              className="tbm-textarea"
              rows={2}
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="Was wurde gemacht?"
            />
          </div>

          {error && <p className="tbm-error">{error}</p>}
        </div>

        <div className="tbm-modal-footer">
          <button className="btn btn-secondary" onClick={onClose}>Abbrechen</button>
          <button className="btn btn-primary" disabled={saving} onClick={handleFinish}>
            {saving ? 'Speichern…' : '⏹ Abschließen & Prüfen'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Day review modal ──────────────────────────────────────────────────────────

const FMT_H = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 2 })

interface EditingRow {
  id:          number
  timeStart:   string
  timeFinish:  string
  quantityInt: string
  description: string
}

function DayReviewModal({ onClose }: { onClose: () => void }) {
  const backdrop = useBackdropClose(onClose)
  const { session, endSession } = useTimerStore()
  const qc = useQueryClient()
  const employeeId = session?.employeeId
  const [editRow,    setEditRow]    = useState<EditingRow | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [error,      setError]      = useState<string | null>(null)
  const [breakChoice, setBreakChoice] = useState<'auto' | 'manual'>('auto')
  const [breakManualMin, setBreakManualMin] = useState<string>('')

  const today = nowDateIso()

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

  const drafts = (draftsData?.data ?? []) as DraftEntry[]
  const totalH = drafts
    .filter(d => (d.ENTRY_KIND ?? 'WORK') === 'WORK')
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
  })

  const patchMut = useMutation({
    mutationFn: ({ id, body }: { id: number; body: Parameters<typeof patchDraft>[1] }) =>
      patchDraft(id, body),
    onSuccess: () => {
      setEditRow(null)
      void qc.invalidateQueries({ queryKey: ['timer-drafts'] })
    },
  })

  function startEdit(d: { ID: number; TIME_START: string | null; TIME_FINISH: string | null; QUANTITY_INT: number; POSTING_DESCRIPTION: string }) {
    setEditRow({
      id:          d.ID,
      timeStart:   d.TIME_START?.slice(0, 5) ?? '',
      timeFinish:  d.TIME_FINISH?.slice(0, 5) ?? '',
      quantityInt: String(d.QUANTITY_INT ?? ''),
      description: d.POSTING_DESCRIPTION,
    })
  }

  function onTimeChange(field: 'timeStart' | 'timeFinish', val: string) {
    if (!editRow) return
    const next = { ...editRow, [field]: val }
    const start  = field === 'timeStart'  ? val : next.timeStart
    const finish = field === 'timeFinish' ? val : next.timeFinish
    if (start && finish) {
      const [sh, sm] = start.split(':').map(Number)
      const [fh, fm] = finish.split(':').map(Number)
      const diffMin = Math.max(0, fh * 60 + fm - (sh * 60 + sm))
      next.quantityInt = String(Math.round(diffMin / 60 * 100) / 100)
    }
    setEditRow(next)
  }

  function saveEdit() {
    if (!editRow) return
    patchMut.mutate({
      id: editRow.id,
      body: {
        description:  editRow.description,
        time_start:   editRow.timeStart  ? editRow.timeStart  + ':00' : undefined,
        time_finish:  editRow.timeFinish ? editRow.timeFinish + ':00' : undefined,
        quantity_int: editRow.quantityInt ? Number(editRow.quantityInt) : undefined,
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
      void qc.invalidateQueries({ queryKey: ['buchungen'] })
      void qc.invalidateQueries({ queryKey: ['structure'] })
      void qc.invalidateQueries({ queryKey: ['arbzg-audit'] })
      endSession()
      onClose()
    } catch (e: unknown) {
      const err = e as { message?: string; details?: { code?: string } }
      const code = err.details?.code
      setError(code === 'ARBZG_BREAK_CONFIRM_REQUIRED'
        ? 'Bitte Pausenbestätigung wählen, bevor freigegeben wird.'
        : (err.message ?? 'Fehler'))
      setConfirming(false)
    }
  }

  return (
    <div className="tbm-overlay" {...backdrop}>
      <div className="tbm-modal tbm-modal-wide">
        <div className="tbm-modal-header">
          <span className="tbm-modal-title">📋 Tagesübersicht – {today}</span>
          <button className="tbm-modal-close" onClick={onClose}>✕</button>
        </div>

        <div className="tbm-modal-body">
          {isLoading && <p className="tbm-info">Lade Einträge…</p>}
          {!isLoading && drafts.length === 0 && (
            <p className="tbm-info">Keine Entwürfe für heute.</p>
          )}

          {/* ── ArbZG-Block ─────────────────────────────────────────── */}
          {limits?.settings.enabled && breakAnalysis && breakAnalysis.required > 0 && (
            <div className={breakAnalysis.missing > 0 ? 'tbm-arbzg-warn' : 'tbm-arbzg-ok'}>
              {breakAnalysis.missing > 0 ? (
                <>
                  <div className="tbm-arbzg-title">
                    ⚠ {breakAnalysis.dayWork.toFixed(2)} h Arbeit ohne ausreichende Pause
                  </div>
                  <div className="tbm-arbzg-meta">
                    Erforderlich: {breakAnalysis.required} min ·
                    gestempelt: {breakAnalysis.breakMin} min ·
                    fehlt: {breakAnalysis.missing} min
                    {limits.breakRule?.NAME && <> ({limits.breakRule.NAME})</>}
                  </div>
                  {needsBreakConfirm && (
                    <div className="tbm-arbzg-choices">
                      <label className="tbm-arbzg-choice">
                        <input type="radio" name="brkChoice"
                          checked={breakChoice === 'auto'}
                          onChange={() => setBreakChoice('auto')} />
                        <span>
                          Auto-Abzug akzeptieren — {breakAnalysis.missing} min werden
                          vom letzten Arbeitsblock abgezogen
                        </span>
                      </label>
                      <label className="tbm-arbzg-choice">
                        <input type="radio" name="brkChoice"
                          checked={breakChoice === 'manual'}
                          onChange={() => setBreakChoice('manual')} />
                        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          Ich habe zusätzlich
                          <input type="number" min={1} step={5}
                            className="tbm-input"
                            style={{ width: 64, padding: '2px 4px' }}
                            value={breakManualMin}
                            placeholder={String(breakAnalysis.missing)}
                            onFocus={() => setBreakChoice('manual')}
                            onChange={e => setBreakManualMin(e.target.value)} />
                          min Pause gemacht (wird nachgetragen)
                        </span>
                      </label>
                    </div>
                  )}
                </>
              ) : (
                <div className="tbm-arbzg-title">
                  ✓ Pausenpflicht (§ 4 ArbZG) erfüllt — {breakAnalysis.breakMin}/{breakAnalysis.required} min
                </div>
              )}
              {breakAnalysis.dayWork > 8 && (
                <div className="tbm-arbzg-info">
                  ℹ Tagesarbeit {breakAnalysis.dayWork.toFixed(2)} h wird gem. § 16 Abs. 2 ArbZG dokumentiert.
                </div>
              )}
            </div>
          )}

          {drafts.length > 0 && (
            <table className="tbm-review-table">
              <thead>
                <tr>
                  <th scope="col">Projekt / Aufgabe</th>
                  <th scope="col">Zeit</th>
                  <th scope="col">Std.</th>
                  <th scope="col">Beschreibung</th>
                  <th scope="col"></th>
                </tr>
              </thead>
              <tbody>
                {drafts.map(d => {
                  const isEditing = editRow?.id === d.ID
                  const isBreak   = d.ENTRY_KIND === 'BREAK'
                  return (
                    <tr key={d.ID} className={isEditing ? 'tbm-row-editing' : ''}>
                      <td>
                        {isBreak ? (
                          <span className="tbm-review-proj" style={{ color: 'var(--warning-strong)' }}>
                            ⏸ Pause
                          </span>
                        ) : (
                          <>
                            <span className="tbm-review-proj">{d.PROJECT?.ABBR}</span>
                            <span className="tbm-review-struct">{d.STRUCTURE?.ABBR}</span>
                          </>
                        )}
                      </td>
                      {isEditing ? (
                        <>
                          <td className="tbm-edit-time">
                            <input
                              type="time"
                              className="tbm-input tbm-input-time"
                              value={editRow.timeStart}
                              onChange={e => onTimeChange('timeStart', e.target.value)}
                            />
                            <span className="tbm-time-sep">–</span>
                            <input
                              type="time"
                              className="tbm-input tbm-input-time"
                              value={editRow.timeFinish}
                              onChange={e => onTimeChange('timeFinish', e.target.value)}
                            />
                          </td>
                          <td>
                            <input
                              type="number"
                              className="tbm-input tbm-input-qty"
                              min={0}
                              step={0.25}
                              value={editRow.quantityInt}
                              onChange={e => setEditRow({ ...editRow, quantityInt: e.target.value })}
                            />
                          </td>
                          <td>
                            <input
                              className="tbm-input"
                              value={editRow.description}
                              onChange={e => setEditRow({ ...editRow, description: e.target.value })}
                              autoFocus
                            />
                          </td>
                          <td className="tbm-row-actions">
                            <button
                              className="tbm-icon-btn tbm-save"
                              onClick={saveEdit}
                              disabled={patchMut.isPending}
                            >✓</button>
                            <button className="tbm-icon-btn" onClick={() => setEditRow(null)}>✕</button>
                          </td>
                        </>
                      ) : (
                        <>
                          <td className="tbm-mono">
                            {d.TIME_START?.slice(0, 5)} – {d.TIME_FINISH?.slice(0, 5)}
                          </td>
                          <td className="tbm-mono">{FMT_H.format(Number(d.QUANTITY_INT))}</td>
                          <td>
                            <span className="tbm-review-desc">
                              {d.POSTING_DESCRIPTION || <em className="tbm-muted">Keine Beschreibung</em>}
                            </span>
                          </td>
                          <td className="tbm-row-actions">
                            <button
                              className="tbm-icon-btn"
                              title="Eintrag bearbeiten"
                              onClick={() => startEdit(d)}
                            >✎</button>
                            <button
                              className="tbm-icon-btn tbm-danger"
                              title="Eintrag löschen"
                              onClick={() => deleteMut.mutate(d.ID)}
                            >🗑</button>
                          </td>
                        </>
                      )}
                    </tr>
                  )
                })}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={2} className="tbm-total-label">Gesamt</td>
                  <td className="tbm-mono tbm-total-val">{FMT_H.format(totalH)}</td>
                  <td colSpan={2}></td>
                </tr>
              </tfoot>
            </table>
          )}

          {error && <p className="tbm-error">{error}</p>}
        </div>

        <div className="tbm-modal-footer">
          <button className="btn btn-secondary" onClick={onClose}>Schließen</button>
          {drafts.length > 0 && (
            <button className="btn btn-primary" disabled={confirming} onClick={handleConfirm}>
              {confirming ? 'Freigeben…' : `✓ ${drafts.length} Buchung${drafts.length !== 1 ? 'en' : ''} freigeben`}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Main TimerBar ─────────────────────────────────────────────────────────────

type ModalState = 'none' | 'start' | 'next' | 'finish'

const FMT_H1 = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 1 })
const fmtH1  = (h: number) => FMT_H1.format(h)

export function TimerBar() {
  const { session: storedSession, breakState: storedBreak, showReview, closeReview, startBreak, endBreak, cancelBreak }
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
        {modal === 'start' && <StartModal onClose={() => setModal('none')} />}
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
        {modal === 'next'   && <NextTaskModal onClose={() => setModal('none')} />}
        {modal === 'finish' && <FinishModal   onClose={() => setModal('none')} />}
        {showReview         && <DayReviewModal onClose={closeReview} />}
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

      {modal === 'next'   && <NextTaskModal onClose={() => setModal('none')} />}
      {modal === 'finish' && <FinishModal   onClose={() => setModal('none')} />}
      {showReview         && <DayReviewModal onClose={closeReview} />}
    </>
  )
}
