import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useTimerStore, elapsedSeconds, formatDuration, formatDurationHuman, quantityFromSeconds } from '@/store/timerStore'
import type { TimerSession } from '@/store/timerStore'
import { fetchActiveEmployees, fetchProjectsShort, fetchProjectStructure } from '@/api/projekte'
import { createTimerDraft, fetchDrafts, confirmDrafts, deleteTimerDraft, patchDraftDescription } from '@/api/timer'
import { buildStructureTree, flattenTree } from '@/utils/treeUtils'
import type { StructureNode } from '@/api/projekte'

// ── Small helpers ─────────────────────────────────────────────────────────────

function nowDateIso()  { return new Date().toISOString().slice(0, 10) }
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
        {projects.map(p => <option key={p.ID} value={p.ID}>{p.NAME_SHORT} – {p.NAME_LONG}</option>)}
      </select>
      {projectId && (
        <select
          className="tbm-select"
          value={structureId ?? ''}
          onChange={e => {
            const id = e.target.value ? Number(e.target.value) : null
            const name = leaves.find(fn => fn.node.STRUCTURE_ID === id)?.node.NAME_SHORT ?? ''
            onStructureId(id, name)
          }}
        >
          <option value="">— Leistung wählen —</option>
          {leaves.map(({ node, depth }) => (
            <option key={node.STRUCTURE_ID} value={node.STRUCTURE_ID}>
              {'  '.repeat(depth)}{node.NAME_SHORT}{node.NAME_LONG ? ` – ${node.NAME_LONG}` : ''}
            </option>
          ))}
        </select>
      )}
    </div>
  )
}

// ── Start modal ───────────────────────────────────────────────────────────────

function StartModal({ onClose }: { onClose: () => void }) {
  const startSession = useTimerStore(s => s.startSession)
  const { data: empData } = useQuery({ queryKey: ['active-employees'], queryFn: fetchActiveEmployees })
  const employees = empData?.data ?? []

  const [employeeId,    setEmployeeId]    = useState<number | null>(null)
  const [cpRate,        setCpRate]        = useState('0')
  const [projectId,     setProjectId]     = useState<number | null>(null)
  const [structureId,   setStructureId]   = useState<number | null>(null)
  const [structureName, setStructureName] = useState('')

  const projects = useQuery({ queryKey: ['projects-short'], queryFn: fetchProjectsShort })
  const projectMap = Object.fromEntries((projects.data?.data ?? []).map(p => [p.ID, p.NAME_SHORT]))

  function handleStart() {
    if (!employeeId || !structureId || !projectId) return
    const emp = employees.find(e => e.ID === employeeId)
    const session: TimerSession = {
      employeeId,
      employeeName: emp ? `${emp.SHORT_NAME}` : String(employeeId),
      cpRate: Number(cpRate) || 0,
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
    <div className="tbm-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="tbm-modal">
        <div className="tbm-modal-header">
          <span className="tbm-modal-title">▶ Arbeitstag starten</span>
          <button className="tbm-modal-close" onClick={onClose}>✕</button>
        </div>

        <div className="tbm-modal-body">
          <div className="tbm-field-group">
            <label className="tbm-label">Mitarbeiter</label>
            <select className="tbm-select" value={employeeId ?? ''} onChange={e => setEmployeeId(e.target.value ? Number(e.target.value) : null)}>
              <option value="">— Mitarbeiter wählen —</option>
              {employees.map(e => <option key={e.ID} value={e.ID}>{e.SHORT_NAME} – {e.FIRST_NAME} {e.LAST_NAME}</option>)}
            </select>
          </div>

          <div className="tbm-field-group">
            <label className="tbm-label">Kostensatz (€/h)</label>
            <input
              className="tbm-input"
              type="number"
              min={0}
              step={0.01}
              value={cpRate}
              onChange={e => setCpRate(e.target.value)}
              placeholder="z.B. 65"
            />
          </div>

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
  const { session, nextBlock } = useTimerStore()
  const qc = useQueryClient()

  const [description,  setDescription]  = useState('')
  const [projectId,    setProjectId]    = useState<number | null>(null)
  const [structureId,  setStructureId]  = useState<number | null>(null)
  const [structureName, setStructureName] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError]   = useState<string | null>(null)

  const projects = useQuery({ queryKey: ['projects-short'], queryFn: fetchProjectsShort })
  const projectMap = Object.fromEntries((projects.data?.data ?? []).map(p => [p.ID, p.NAME_SHORT]))

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
        DATE_VOUCHER:        nowDateIso(),
        TIME_START:          new Date(session.blockStartIso).toTimeString().slice(0, 8),
        TIME_FINISH:         finishTime,
        QUANTITY_INT:        quantityFromSeconds(elapsed),
        CP_RATE:             session.cpRate,
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
    <div className="tbm-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
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
        DATE_VOUCHER:        nowDateIso(),
        TIME_START:          new Date(session.blockStartIso).toTimeString().slice(0, 8),
        TIME_FINISH:         finishTime,
        QUANTITY_INT:        quantityFromSeconds(elapsed),
        CP_RATE:             session.cpRate,
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
    <div className="tbm-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
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

function DayReviewModal({ onClose }: { onClose: () => void }) {
  const { session, endSession } = useTimerStore()
  const qc = useQueryClient()
  const employeeId = session?.employeeId
  const [editingId,  setEditingId]  = useState<number | null>(null)
  const [editVal,    setEditVal]    = useState('')
  const [confirming, setConfirming] = useState(false)
  const [error,      setError]      = useState<string | null>(null)

  const today = nowDateIso()

  const { data: draftsData, isLoading } = useQuery({
    queryKey: ['timer-drafts', employeeId, today],
    queryFn: () => fetchDrafts(employeeId!, today),
    enabled: !!employeeId,
    refetchOnWindowFocus: false,
  })

  const drafts = draftsData?.data ?? []
  const totalH = drafts.reduce((s, d) => s + Number(d.QUANTITY_INT ?? 0), 0)

  const deleteMut = useMutation({
    mutationFn: (id: number) => deleteTimerDraft(id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['timer-drafts'] }),
  })

  const patchMut = useMutation({
    mutationFn: ({ id, description }: { id: number; description: string }) =>
      patchDraftDescription(id, description),
    onSuccess: () => {
      setEditingId(null)
      void qc.invalidateQueries({ queryKey: ['timer-drafts'] })
    },
  })

  async function handleConfirm() {
    if (!drafts.length) return
    setConfirming(true)
    setError(null)
    try {
      await confirmDrafts(drafts.map(d => d.ID))
      void qc.invalidateQueries({ queryKey: ['buchungen'] })
      void qc.invalidateQueries({ queryKey: ['structure'] })
      endSession()
      onClose()
    } catch (e: unknown) {
      setError((e as { message?: string }).message ?? 'Fehler')
      setConfirming(false)
    }
  }

  return (
    <div className="tbm-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
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

          {drafts.length > 0 && (
            <table className="tbm-review-table">
              <thead>
                <tr>
                  <th>Projekt / Aufgabe</th>
                  <th>Zeit</th>
                  <th>Std.</th>
                  <th>Beschreibung</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {drafts.map(d => (
                  <tr key={d.ID}>
                    <td>
                      <span className="tbm-review-proj">{d.PROJECT?.NAME_SHORT}</span>
                      <span className="tbm-review-struct">{d.STRUCTURE?.NAME_SHORT}</span>
                    </td>
                    <td className="tbm-mono">
                      {d.TIME_START?.slice(0, 5)} – {d.TIME_FINISH?.slice(0, 5)}
                    </td>
                    <td className="tbm-mono">{FMT_H.format(Number(d.QUANTITY_INT))}</td>
                    <td>
                      {editingId === d.ID ? (
                        <div className="tbm-inline-edit">
                          <input
                            className="tbm-input"
                            value={editVal}
                            onChange={e => setEditVal(e.target.value)}
                            autoFocus
                          />
                          <button
                            className="tbm-icon-btn tbm-save"
                            onClick={() => patchMut.mutate({ id: d.ID, description: editVal })}
                          >✓</button>
                          <button className="tbm-icon-btn" onClick={() => setEditingId(null)}>✕</button>
                        </div>
                      ) : (
                        <span
                          className="tbm-review-desc"
                          onClick={() => { setEditingId(d.ID); setEditVal(d.POSTING_DESCRIPTION) }}
                          title="Klicken zum Bearbeiten"
                        >
                          {d.POSTING_DESCRIPTION || <em className="tbm-muted">Keine Beschreibung</em>}
                        </span>
                      )}
                    </td>
                    <td>
                      <button
                        className="tbm-icon-btn tbm-danger"
                        title="Eintrag löschen"
                        onClick={() => deleteMut.mutate(d.ID)}
                      >🗑</button>
                    </td>
                  </tr>
                ))}
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

export function TimerBar() {
  const { session, showReview, closeReview } = useTimerStore()
  const [modal,   setModal]   = useState<ModalState>('none')
  const [elapsed, setElapsed] = useState(0)

  // Live clock tick
  useEffect(() => {
    if (!session) { setElapsed(0); return }
    setElapsed(elapsedSeconds(session.blockStartIso))
    const id = setInterval(() => setElapsed(elapsedSeconds(session.blockStartIso)), 1000)
    return () => clearInterval(id)
  }, [session])

  if (!session) {
    return (
      <>
        <button className="tbr-btn tbr-start" onClick={() => setModal('start')} title="Arbeitstag starten">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><polygon points="5,3 19,12 5,21"/></svg>
          Start
        </button>
        {modal === 'start' && <StartModal onClose={() => setModal('none')} />}
      </>
    )
  }

  return (
    <>
      <div className="tbr-running">
        <span className="tbr-clock">{formatDuration(elapsed)}</span>
        <span className="tbr-task" title={`${session.projectName} / ${session.structureName}`}>
          {session.projectName} / {session.structureName}
        </span>
        <button className="tbr-btn tbr-next" onClick={() => setModal('next')} title="Nächste Aufgabe">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12,5 19,12 12,19"/></svg>
          Nächste Aufgabe
        </button>
        <button className="tbr-btn tbr-finish" onClick={() => setModal('finish')} title="Buchungen abschließen">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="4" y="4" width="16" height="16" rx="2"/></svg>
          Buchungen abschließen
        </button>
      </div>

      {modal === 'next'   && <NextTaskModal onClose={() => setModal('none')} />}
      {modal === 'finish' && <FinishModal   onClose={() => setModal('none')} />}
      {showReview         && <DayReviewModal onClose={closeReview} />}
    </>
  )
}
