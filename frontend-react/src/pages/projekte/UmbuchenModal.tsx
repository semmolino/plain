import { useMemo, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { ArrowRight, TriangleAlert, Lock } from 'lucide-react'
import { Modal } from '@/components/ui/Modal'
import { usePermissionsStore } from '@/store/permissionsStore'
import { Message } from '@/components/ui/Message'
import { DialogFooter } from '@/components/ui/DialogFooter'
import { HelpHint } from '@/components/ui/HelpHint'
import { money } from '@/utils/money'
import { parentStructureIds, structurePaths } from '@/utils/treeUtils'
import {
  fetchProjectsShort, fetchProjectStructure,
  previewRebookBuchungen, rebookBuchungen,
  type Buchung, type RebookResult,
} from '@/api/projekte'

/**
 * Umbuchen-Dialog — verschiebt ausgewählte Buchungen auf ein anderes
 * Projektelement, auf Wunsch in einem anderen Projekt.
 *
 * Der Dialog zeigt VOR dem Speichern, was passiert: welche Buchungen gesperrt
 * sind (abgerechnete bleiben liegen) und wo sich der Stundensatz ändert, weil
 * im Zielprojekt ein anderer vereinbart ist. Die Vorschau kommt vom Server aus
 * demselben Code, der anschließend schreibt — eine im Frontend nachgebaute
 * Vorhersage wäre genau die Stelle, an der Anzeige und Ergebnis auseinander-
 * laufen.
 */

const fmtDate = (v: string | null | undefined) => (v ? v.slice(0, 10) : '—')

interface Props {
  /** Die ausgewählten Buchungen (Reihenfolge wie in der Liste). */
  bookings:        Buchung[]
  /** Projekt, aus dem die Liste kommt — Vorbelegung des Zielprojekts. */
  sourceProjectId: number
  onClose:  () => void
  onDone:   (message: string) => void
}

export function UmbuchenModal({ bookings, sourceProjectId, onClose, onDone }: Props) {
  const qc = useQueryClient()
  // Erlösbeträge nur mit dem Recht dazu — das Backend filtert sie in der
  // Antwort ohnehin heraus (controllers/buchungen.js).
  const showRevenue = usePermissionsStore(s => s.unrestricted || s.keys.has('projects.bookings.revenue.view'))
  const [targetPid, setTargetPid] = useState<string>(String(sourceProjectId))
  const [targetSid, setTargetSid] = useState<string>('')
  const [reason,    setReason]    = useState('')
  const [error,     setError]     = useState<string | null>(null)

  const ids = useMemo(() => bookings.map(b => b.ID), [bookings])

  const { data: projectsData } = useQuery({ queryKey: ['projects-short'], queryFn: fetchProjectsShort })
  const projects = projectsData?.data ?? []

  const pidNum = targetPid ? Number(targetPid) : null
  const { data: structData, isLoading: structLoading } = useQuery({
    queryKey: ['structure', pidNum],
    queryFn:  () => fetchProjectStructure(pidNum!),
    enabled:  pidNum !== null,
  })
  const structure = structData?.data ?? []

  const paths   = useMemo(() => structurePaths(structure), [structure])
  const parents = useMemo(() => parentStructureIds(structure), [structure])
  const leaves  = useMemo(
    () => structure
      .filter(n => !parents.has(n.STRUCTURE_ID))
      .sort((a, b) => (paths.get(a.STRUCTURE_ID) ?? '').localeCompare(paths.get(b.STRUCTURE_ID) ?? '', 'de', { numeric: true })),
    [structure, parents, paths],
  )

  const sidNum = targetSid ? Number(targetSid) : null

  // Vorschau: lesender Lauf auf dem Server, deshalb als Query (mit Ziel im Key).
  const { data: previewData, isFetching: previewLoading, error: previewError } = useQuery({
    queryKey: ['rebook-preview', [...ids].sort((a, b) => a - b), pidNum, sidNum],
    queryFn:  () => previewRebookBuchungen({ ids, target_project_id: pidNum!, target_structure_id: sidNum! }),
    enabled:  pidNum !== null && sidNum !== null && ids.length > 0,
  })
  const preview: RebookResult | null = previewData?.data ?? null

  const rebookMut = useMutation({
    mutationFn: () => rebookBuchungen({
      ids, target_project_id: pidNum!, target_structure_id: sidNum!, reason: reason.trim() || undefined,
    }),
    onSuccess: (res) => {
      const n = res.data.rebooked ?? 0
      // Beide Projekte neu laden: die Buchung ist im einen weg und im anderen da.
      void qc.invalidateQueries({ queryKey: ['buchungen'] })
      void qc.invalidateQueries({ queryKey: ['structure'] })
      const blocked = res.data.skipped.filter(s => s.reason === 'billed').length
      onDone(
        `${n} ${n === 1 ? 'Buchung' : 'Buchungen'} umgebucht auf ${res.data.target.PROJECT_NAME} · ${res.data.target.STRUCTURE_NAME}`
        + (blocked > 0 ? ` — ${blocked} abgerechnete ${blocked === 1 ? 'Buchung' : 'Buchungen'} unverändert` : ''),
      )
    },
    onError: (e: Error) => setError(e.message),
  })

  const movedCount = preview?.movedCount ?? 0
  const zielGewaehlt = pidNum !== null && sidNum !== null

  // modal-wide: die Vorschau ist eine Tabelle mit fünf Spalten — in einem
  // Dialog mit Standardbreite bricht sie in jeder Zelle um.
  return (
    <Modal
      open
      onClose={onClose}
      className="modal-wide"
      title={`Umbuchen — ${bookings.length} ${bookings.length === 1 ? 'Buchung' : 'Buchungen'}`}
    >
      <div className="master-form">
        <p style={{ fontSize: 13, color: 'var(--text-2)', margin: '0 0 12px' }}>
          Verschiebt die ausgewählten Buchungen auf ein anderes Projektelement. Menge, Datum,
          Mitarbeiter und Beschreibung bleiben unverändert.
          <HelpHint id="bookings.rebook" />
        </p>

        <div className="form-row">
          <div className="form-group">
            <label htmlFor="umb-projekt">Zielprojekt*</label>
            <select
              id="umb-projekt"
              value={targetPid}
              onChange={e => { setTargetPid(e.target.value); setTargetSid(''); setError(null) }}
            >
              <option value="">Bitte wählen …</option>
              {projects.map(p => (
                <option key={p.ID} value={p.ID}>
                  {p.NAME_SHORT}{p.NAME_LONG ? `: ${p.NAME_LONG}` : ''}
                </option>
              ))}
            </select>
          </div>
          <div className="form-group">
            <label htmlFor="umb-element">Ziel-Projektelement*</label>
            <select
              id="umb-element"
              value={targetSid}
              onChange={e => { setTargetSid(e.target.value); setError(null) }}
              disabled={pidNum === null || structLoading}
            >
              <option value="">{structLoading ? 'Lädt …' : 'Bitte wählen …'}</option>
              {leaves.map(n => (
                <option key={n.STRUCTURE_ID} value={n.STRUCTURE_ID}>
                  {paths.get(n.STRUCTURE_ID) ?? n.NAME_SHORT}
                </option>
              ))}
            </select>
            {pidNum !== null && !structLoading && leaves.length === 0 && (
              <span style={{ fontSize: 11, color: 'var(--warning-strong)', display: 'block', marginTop: 2 }}>
                Dieses Projekt hat keine buchbaren Elemente.
              </span>
            )}
          </div>
        </div>

        <div className="form-group">
          <label htmlFor="umb-grund">Grund (optional)</label>
          <textarea
            id="umb-grund"
            rows={2}
            value={reason}
            onChange={e => setReason(e.target.value)}
            maxLength={500}
            placeholder="z. B. auf falsches Projekt gebucht"
            style={{ width: '100%', padding: '10px 12px', border: '1px solid var(--border)', borderRadius: 12, fontSize: 15, outline: 'none' }}
          />
          <span style={{ fontSize: 11, color: 'var(--text-3)' }}>
            Wird mit der Umbuchung protokolliert — hilft bei späteren Rückfragen aus der Buchhaltung.
          </span>
        </div>

        {/* ── Vorschau ── */}
        {zielGewaehlt && previewLoading && (
          <p style={{ fontSize: 13, color: 'var(--text-3)' }}>Vorschau wird berechnet …</p>
        )}
        {previewError instanceof Error && <Message text={previewError.message} type="error" />}

        {zielGewaehlt && preview && !previewLoading && (
          <div style={{ marginTop: 4 }}>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>
              {movedCount} von {bookings.length} {bookings.length === 1 ? 'Buchung' : 'Buchungen'} werden umgebucht
            </div>

            {preview.warnings.map(w => (
              <div
                key={w.code}
                style={{
                  display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 13, lineHeight: 1.45,
                  padding: '8px 10px', marginBottom: 6, borderRadius: 'var(--radius-sm)',
                  background: w.code === 'billed' ? 'var(--info-bg)' : 'var(--warning-bg)',
                  color: w.code === 'billed' ? 'var(--text-2)' : 'var(--warning-strong)',
                }}
              >
                {w.code === 'billed'
                  ? <Lock size={13} strokeWidth={2} style={{ marginTop: 2, flexShrink: 0 }} />
                  : <TriangleAlert size={13} strokeWidth={2} style={{ marginTop: 2, flexShrink: 0 }} />}
                <span>{w.message}</span>
              </div>
            ))}

            {movedCount > 0 && (
              <div style={{ overflowX: 'auto' }}>
                <table className="master-table" style={{ fontSize: 12 }}>
                  <thead>
                    <tr>
                      <th scope="col">Datum</th>
                      <th scope="col">Beschreibung</th>
                      <th scope="col">Bisher</th>
                      {showRevenue && <th scope="col" className="num">Erlös bisher</th>}
                      {showRevenue && <th scope="col" className="num">Erlös neu</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {preview.moved.map(m => (
                      <tr key={m.ID}>
                        <td>{fmtDate(m.DATE_VOUCHER)}</td>
                        <td>{m.POSTING_DESCRIPTION}</td>
                        <td style={{ color: 'var(--text-3)' }}>
                          {m.FROM_PROJECT_NAME ?? '—'}
                          {m.FROM_STRUCTURE_NAME ? ` · ${m.FROM_STRUCTURE_NAME}` : ''}
                        </td>
                        {showRevenue && <td className="num">{money(m.SP_TOT_BEFORE)}</td>}
                        {showRevenue && (
                          <td className="num">
                            {m.SP_TOT_AFTER !== m.SP_TOT_BEFORE
                              ? <strong>{money(m.SP_TOT_AFTER)}</strong>
                              : money(m.SP_TOT_AFTER)}
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {preview.skipped.length > 0 && (
              <ul style={{ margin: '10px 0 0', paddingLeft: 18, fontSize: 12, color: 'var(--text-3)' }}>
                {preview.skipped.map(s => (
                  <li key={s.ID}>
                    {fmtDate(s.DATE_VOUCHER)}
                    {s.POSTING_DESCRIPTION ? ` · ${s.POSTING_DESCRIPTION}` : ''} — bleibt liegen: {s.message}
                  </li>
                ))}
              </ul>
            )}

            {movedCount > 0 && (
              <p style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, marginTop: 12, marginBottom: 0 }}>
                <span style={{ color: 'var(--text-3)' }}>Ziel</span>
                <ArrowRight size={13} strokeWidth={2} />
                <strong>{preview.target.PROJECT_NAME} · {preview.target.STRUCTURE_NAME}</strong>
              </p>
            )}
          </div>
        )}

        <Message text={error} type="error" />

        <DialogFooter>
          <button type="button" className="btn-secondary" onClick={onClose}>Abbrechen</button>
          <button
            type="button"
            className="btn-primary"
            disabled={!zielGewaehlt || previewLoading || movedCount === 0 || rebookMut.isPending}
            title={zielGewaehlt && movedCount === 0 ? 'Keine der ausgewählten Buchungen lässt sich umbuchen' : undefined}
            onClick={() => { setError(null); rebookMut.mutate() }}
          >
            {rebookMut.isPending ? 'Bucht um …' : `Umbuchen${movedCount > 0 ? ` (${movedCount})` : ''}`}
          </button>
        </DialogFooter>
      </div>
    </Modal>
  )
}
