import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Message } from '@/components/ui/Message'
import {
  fetchProjectsShort, fetchProjectStructure, patchStructureCompletion, createProgressSnapshot,
  type StructureNode,
} from '@/api/projekte'
import { buildStructureTree, flattenTree } from '@/utils/treeUtils'

const FMT_EUR = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 })
const fmtEur  = (v: number | null | undefined) => v == null ? '—' : FMT_EUR.format(v)
const fmtPct  = (v: number | null | undefined) => v == null ? '—' : `${v} %`

export function ProjektStruktur({ initialProjectId }: { initialProjectId?: number }) {
  const qc = useQueryClient()
  const [selectedPid, setSelectedPid] = useState<number | null>(initialProjectId ?? null)
  const [completionEdits, setCompletionEdits] = useState<
    Record<number, { rev: string; ext: string }>
  >({})
  const [saveMsg, setSaveMsg]   = useState<{ text: string; type: 'success'|'error' } | null>(null)
  const [snapMsg, setSnapMsg]   = useState<{ text: string; type: 'success'|'error' } | null>(null)

  const { data: projectsData }  = useQuery({ queryKey: ['projects-short'], queryFn: fetchProjectsShort })
  const { data: structData, isLoading } = useQuery({
    queryKey: ['structure', selectedPid],
    queryFn:  () => fetchProjectStructure(selectedPid!),
    enabled:  selectedPid !== null,
  })

  const projects  = projectsData?.data ?? []
  const structure = structData?.data   ?? []

  // Reset edits when project changes
  useEffect(() => { setCompletionEdits({}) }, [selectedPid])
  // Sync initialProjectId from parent (list click)
  useEffect(() => { if (initialProjectId) setSelectedPid(initialProjectId) }, [initialProjectId])

  const flatTree = structure.length
    ? flattenTree(buildStructureTree(structure))
    : []

  function setEdit(structId: number, field: 'rev' | 'ext', value: string) {
    setCompletionEdits(prev => ({
      ...prev,
      [structId]: { rev: '', ext: '', ...prev[structId], [field]: value },
    }))
  }

  const saveMut = useMutation({
    mutationFn: ({ id, rev, ext }: { id: number; rev: number; ext: number }) =>
      patchStructureCompletion(id, { revenue_completion_percent: rev, extras_completion_percent: ext }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['structure', selectedPid] })
      setSaveMsg({ text: 'Leistungsstand gespeichert ✅', type: 'success' })
      setCompletionEdits({})
      setTimeout(() => setSaveMsg(null), 3000)
    },
    onError: (e: Error) => setSaveMsg({ text: e.message, type: 'error' }),
  })

  const snapMut = useMutation({
    mutationFn: () => createProgressSnapshot(selectedPid!),
    onSuccess: () => setSnapMsg({ text: 'Snapshot gespeichert ✅', type: 'success' }),
    onError:   (e: Error) => setSnapMsg({ text: e.message, type: 'error' }),
  })

  function saveAllEdits() {
    setSaveMsg(null)
    const edits = Object.entries(completionEdits)
    if (!edits.length) { setSaveMsg({ text: 'Keine Änderungen', type: 'error' }); return }
    for (const [idStr, { rev, ext }] of edits) {
      const node = structure.find(n => n.STRUCTURE_ID === Number(idStr))
      const revNum = rev !== '' ? Number(rev) : (node?.REVENUE_COMPLETION_PERCENT ?? 0)
      const extNum = ext !== '' ? Number(ext) : (node?.EXTRAS_COMPLETION_PERCENT ?? 0)
      saveMut.mutate({ id: Number(idStr), rev: revNum, ext: extNum })
    }
  }

  return (
    <div>
      <div className="form-group" style={{ maxWidth: 400, marginBottom: 12 }}>
        <label>Projekt</label>
        <select value={selectedPid ?? ''} onChange={e => { setSelectedPid(e.target.value ? Number(e.target.value) : null); setSnapMsg(null) }}>
          <option value="">Bitte wählen …</option>
          {projects.map(p => <option key={p.ID} value={p.ID}>{p.NAME_SHORT} – {p.NAME_LONG}</option>)}
        </select>
      </div>

      {selectedPid !== null && (
        <>
          {isLoading && <p className="empty-note">Lade Struktur …</p>}
          {!isLoading && flatTree.length === 0 && <p className="empty-note">Keine Projektstruktur gefunden.</p>}

          {!isLoading && flatTree.length > 0 && (
            <>
              <div className="list-section">
                <table className="master-table structure-table">
                  <thead>
                    <tr>
                      <th>Element</th>
                      <th className="num">Budget</th>
                      <th className="num">Extras</th>
                      <th className="num">Leistungsstand %</th>
                      <th className="num">Extras-Stand %</th>
                      <th className="num">Stand €</th>
                    </tr>
                  </thead>
                  <tbody>
                    {flatTree.map(({ node, depth }) => {
                      const edit = completionEdits[node.STRUCTURE_ID]
                      const revVal = edit?.rev ?? String(node.REVENUE_COMPLETION_PERCENT ?? '')
                      const extVal = edit?.ext ?? String(node.EXTRAS_COMPLETION_PERCENT ?? '')
                      return (
                        <tr key={node.STRUCTURE_ID}>
                          <td style={{ paddingLeft: 8 + depth * 18 }}>
                            <span className="tree-indent">{'  '.repeat(depth)}</span>
                            <strong>{node.NAME_SHORT}</strong>
                            {node.NAME_LONG && <span className="tree-name-long"> – {node.NAME_LONG}</span>}
                          </td>
                          <td className="num">{fmtEur(node.REVENUE)}</td>
                          <td className="num">{fmtEur(node.EXTRAS)}</td>
                          <td className="num">
                            <input
                              type="number" min={0} max={100} step={1}
                              style={{ width: 64 }}
                              value={revVal}
                              onChange={e => setEdit(node.STRUCTURE_ID, 'rev', e.target.value)}
                            />
                          </td>
                          <td className="num">
                            <input
                              type="number" min={0} max={100} step={1}
                              style={{ width: 64 }}
                              value={extVal}
                              onChange={e => setEdit(node.STRUCTURE_ID, 'ext', e.target.value)}
                            />
                          </td>
                          <td className="num">{fmtEur(node.REVENUE_COMPLETION)}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>

              <div className="structure-actions">
                <button className="btn-primary" type="button" onClick={saveAllEdits} disabled={saveMut.isPending}>
                  {saveMut.isPending ? 'Speichert …' : 'Leistungsstände speichern'}
                </button>
                <button type="button" onClick={() => { setSnapMsg(null); snapMut.mutate() }} disabled={snapMut.isPending}>
                  {snapMut.isPending ? 'Snapshot …' : 'Progress-Snapshot'}
                </button>
              </div>
              <Message text={saveMsg?.text ?? null} type={saveMsg?.type} />
              <Message text={snapMsg?.text ?? null} type={snapMsg?.type} />
            </>
          )}
        </>
      )}
    </div>
  )
}
