import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  fetchProjectsShort, fetchLeistungsstand, saveLeistungsstand,
  createProgressSnapshot,
  type LeistungsstandNode,
} from '@/api/projekte'
import { buildStructureTree, flattenTree } from '@/utils/treeUtils'
import type { StructureNode } from '@/api/projekte'
import { Message } from '@/components/ui/Message'

const FMT_EUR = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2, maximumFractionDigits: 2 })
const FMT_PCT = new Intl.NumberFormat('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const fmtE    = (v: number | null | undefined) => v == null ? '—' : FMT_EUR.format(v)
const fmtP    = (v: number | null | undefined) => v == null ? '—' : FMT_PCT.format(v) + '\u202f%'

interface Props {
  initialProjectId?: number
  onProjectChange?: (id: number | null) => void
}

export function Leistungsstand({ initialProjectId, onProjectChange }: Props) {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const [pid,  setPid]  = useState<number | null>(initialProjectId ?? null)
  const [vals, setVals] = useState<Record<number, string>>({})
  const [msg,           setMsg]         = useState<{ text: string; type: 'success' | 'error' } | null>(null)
  const [snapMsg,       setSnapMsg]     = useState<{ text: string; type: 'success' | 'error' } | null>(null)
  const [elementSearch, setElementSearch] = useState('')
  const inputRefs                       = useRef<Record<number, HTMLInputElement | null>>({})

  const { data: projectsData } = useQuery({
    queryKey: ['projects-short'],
    queryFn: fetchProjectsShort,
  })

  const { data: lsData, isLoading, isError } = useQuery({
    queryKey: ['leistungsstand', pid],
    queryFn:  () => fetchLeistungsstand(pid!),
    enabled:  pid !== null,
  })

  useEffect(() => {
    if (!lsData?.data) return
    const init: Record<number, string> = {}
    for (const n of lsData.data) {
      if (n.IS_LEAF) {
        init[n.STRUCTURE_ID] = Number((n as LeistungsstandNode & { BILLING_TYPE_ID?: number }).BILLING_TYPE_ID) === 2
          ? '100'
          : String(n.REVENUE_COMPLETION_PERCENT ?? 0)
      }
    }
    setVals(init)
  }, [lsData?.data])

  const saveMut = useMutation({
    mutationFn: () => {
      const updates = Object.entries(vals).map(([sid, v]) => ({
        structure_id: Number(sid),
        revenue_completion_percent: Math.min(100, Math.max(0, Number(v) || 0)),
      }))
      return saveLeistungsstand(pid!, updates)
    },
    onSuccess: () => {
      setMsg({ text: 'Leistungsstände gespeichert ✅', type: 'success' })
      void qc.invalidateQueries({ queryKey: ['leistungsstand', pid] })
      void qc.invalidateQueries({ queryKey: ['structure', pid] })
    },
    onError: (err: unknown) =>
      setMsg({ text: (err as { message?: string }).message || 'Fehler beim Speichern', type: 'error' }),
  })

  const snapMut = useMutation({
    mutationFn: () => createProgressSnapshot(pid!),
    onSuccess: () => setSnapMsg({ text: 'Snapshot gespeichert ✅', type: 'success' }),
    onError:   (err: unknown) => setSnapMsg({ text: (err as { message?: string }).message || 'Fehler', type: 'error' }),
  })

  const handleSave = useCallback(() => {
    if (pid && !saveMut.isPending) saveMut.mutate()
  }, [pid, saveMut])

  // Ctrl+S / Cmd+S global shortcut
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault()
        handleSave()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [handleSave])

  const projects  = projectsData?.data ?? []
  const lsNodes   = (lsData?.data ?? []) as LeistungsstandNode[]
  const tree      = buildStructureTree(lsNodes as StructureNode[])
  const flatNodes = flattenTree(tree)

  const parentMap = useMemo(
    () => new Map(lsNodes.map(n => [String(n.STRUCTURE_ID), n.FATHER_ID != null ? String(n.FATHER_ID) : null])),
    [lsNodes]
  )

  const filteredFlatNodes = useMemo(() => {
    if (!elementSearch.trim()) return flatNodes
    const sq = elementSearch.toLowerCase().trim()
    const matchIds = new Set(
      flatNodes
        .filter(({ node }) =>
          node.NAME_SHORT.toLowerCase().includes(sq) ||
          (node.NAME_LONG?.toLowerCase().includes(sq) ?? false)
        )
        .map(({ node }) => node.STRUCTURE_ID)
    )
    for (const id of [...matchIds]) {
      let cursor = parentMap.get(String(id))
      while (cursor != null) { matchIds.add(Number(cursor)); cursor = parentMap.get(cursor) }
    }
    return flatNodes.filter(({ node }) => matchIds.has(node.STRUCTURE_ID))
  }, [flatNodes, elementSearch, parentMap])

  const leafIds = filteredFlatNodes
    .filter(fn => (fn.node as unknown as LeistungsstandNode).IS_LEAF)
    .map(fn => fn.node.STRUCTURE_ID)

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>, sid: number) {
    if (e.key !== 'Tab') return
    const idx = leafIds.indexOf(sid)
    if (idx === -1) return
    const nextIdx = e.shiftKey ? idx - 1 : idx + 1
    if (nextIdx < 0 || nextIdx >= leafIds.length) return
    e.preventDefault()
    inputRefs.current[leafIds[nextIdx]]?.focus()
  }

  function setVal(sid: number, raw: string) {
    setVals(prev => ({ ...prev, [sid]: raw }))
    setMsg(null)
  }

  function handleProjectChange(id: number | null) {
    setPid(id)
    onProjectChange?.(id)
    setMsg(null)
    setSnapMsg(null)
  }

  const currentProject = projects.find(p => p.ID === pid)

  return (
    <div className="ls-wrap">
      <div className="ls-toolbar">
        <label className="ls-label">Projekt</label>
        <select
          className="ls-select"
          value={pid ?? ''}
          onChange={e => handleProjectChange(e.target.value ? Number(e.target.value) : null)}
        >
          <option value="">— Projekt wählen —</option>
          {projects.map(p => (
            <option key={p.ID} value={p.ID}>{p.NAME_SHORT} – {p.NAME_LONG}</option>
          ))}
        </select>
      </div>

      {pid !== null && currentProject && (
        <div className="proj-jump-bar">
          <span className="proj-jump-label">{currentProject.NAME_SHORT}</span>
          <button className="btn-small" onClick={() => navigate('/rechnungen', { state: { projectSearch: currentProject.NAME_LONG ?? currentProject.NAME_SHORT, backProject: { id: pid, name: currentProject.NAME_SHORT } } })}>
            Rechnungen →
          </button>
          <button className="btn-small" onClick={() => navigate('/daten', { state: { tab: 'einzelprojekt', projectId: pid } })}>
            Projekt-Report →
          </button>
        </div>
      )}

      {msg && (
        <div style={{ marginBottom: 12 }}>
          <Message type={msg.type} text={msg.text} />
        </div>
      )}

      {!pid && <p className="ls-empty">Bitte ein Projekt auswählen.</p>}
      {pid && isLoading && <p className="ls-empty">Lade Daten…</p>}
      {pid && isError   && <p className="ls-empty" style={{ color: 'var(--color-danger)' }}>Fehler beim Laden.</p>}

      {pid && !isLoading && lsNodes.length > 0 && (
        <>
          <div style={{ marginBottom: 8 }}>
            <input type="search" className="list-search" placeholder="Elemente filtern …"
              style={{ maxWidth: 260, fontSize: 13 }}
              value={elementSearch} onChange={e => setElementSearch(e.target.value)} />
          </div>
          <div className="ls-table-wrap">
            <table className="ls-table">
              <thead>
                <tr>
                  <th className="ls-th ls-col-short">Kürzel</th>
                  <th className="ls-th ls-col-name">Bezeichnung</th>
                  <th className="ls-th ls-col-num">Honorar</th>
                  <th className="ls-th ls-col-num">Letzter Stand</th>
                  <th className="ls-th ls-col-input">Neuer Stand</th>
                  <th className="ls-th ls-col-num">Neuer Wert</th>
                  <th className="ls-th ls-col-delta">Δ €</th>
                </tr>
              </thead>
              <tbody>
                {filteredFlatNodes.map(({ node, depth }) => {
                  const n      = node as unknown as LeistungsstandNode
                  const sid    = n.STRUCTURE_ID
                  const isLeaf = n.IS_LEAF

                  const isNachweis = Number((n as LeistungsstandNode & { BILLING_TYPE_ID?: number }).BILLING_TYPE_ID) === 2
                  const revenue   = Number(n.REVENUE ?? 0)
                  const prevPct   = n.PREV_REVENUE_COMPLETION_PERCENT
                  const curPct    = Number(n.REVENUE_COMPLETION_PERCENT ?? 0)
                  const newPctRaw = isLeaf ? (isNachweis ? 100 : (Number(vals[sid]) || 0)) : curPct
                  const oldVal    = (curPct / 100) * revenue
                  const newVal    = (newPctRaw / 100) * revenue
                  const deltaEur  = newVal - oldVal
                  const isPrefill = isLeaf && prevPct !== null && Math.abs(prevPct - curPct) < 0.001

                  return (
                    <tr key={sid} className={isLeaf ? 'ls-row ls-row-leaf' : 'ls-row ls-row-parent'}>
                      <td className="ls-td ls-col-short">
                        <span style={{ paddingLeft: depth * 16 }}>{n.NAME_SHORT}</span>
                      </td>
                      <td className="ls-td ls-col-name">{n.NAME_LONG}</td>
                      <td className="ls-td ls-col-num ls-right">{fmtE(revenue)}</td>
                      <td className="ls-td ls-col-num ls-right">
                        {isLeaf ? (
                          <span className="ls-prev-wrap">
                            {fmtP(curPct)}
                            {isPrefill && prevPct !== null && (
                              <span className="ls-badge-prev" title="Wert aus letztem Eintrag vorbelegt">Vorwert</span>
                            )}
                          </span>
                        ) : (
                          <span className="ls-muted">{fmtP(curPct)}</span>
                        )}
                      </td>
                      <td className="ls-td ls-col-input">
                        {isLeaf ? (
                          isNachweis ? (
                            <div className="ls-input-wrap">
                              <input
                                type="number"
                                className="ls-input ls-input-readonly"
                                value="100"
                                readOnly
                                tabIndex={-1}
                              />
                              <span className="ls-input-unit">%</span>
                            </div>
                          ) : (
                            <div className="ls-input-wrap">
                              <input
                                ref={el => { inputRefs.current[sid] = el }}
                                type="number"
                                min={0}
                                max={100}
                                step={1}
                                className="ls-input"
                                value={vals[sid] ?? ''}
                                onChange={e => setVal(sid, e.target.value)}
                                onKeyDown={e => handleKeyDown(e, sid)}
                                onFocus={e => e.currentTarget.select()}
                              />
                              <span className="ls-input-unit">%</span>
                            </div>
                          )
                        ) : (
                          <span className="ls-muted ls-right">{fmtP(curPct)}</span>
                        )}
                      </td>
                      <td className="ls-td ls-col-num ls-right">
                        {isLeaf
                          ? fmtE(newVal)
                          : <span className="ls-muted">{fmtE(oldVal)}</span>}
                      </td>
                      <td className="ls-td ls-col-delta ls-right">
                        {isLeaf && Math.abs(deltaEur) >= 0.5 ? (
                          <span className={deltaEur > 0 ? 'ls-delta-pos' : 'ls-delta-neg'}>
                            {deltaEur > 0 ? '+' : ''}{FMT_EUR.format(deltaEur)}
                          </span>
                        ) : (
                          <span className="ls-muted">—</span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          <div className="ls-footer">
            <button
              type="button"
              disabled={snapMut.isPending}
              onClick={() => { setSnapMsg(null); snapMut.mutate() }}
            >
              {snapMut.isPending ? 'Snapshot …' : 'Projekt-Snapshot'}
            </button>
            <button
              className="btn btn-primary"
              disabled={saveMut.isPending}
              onClick={handleSave}
            >
              {saveMut.isPending ? 'Speichern…' : 'Leistungsstände speichern'}
            </button>
          </div>
          {snapMsg && <div style={{ marginTop: 8 }}><Message type={snapMsg.type} text={snapMsg.text} /></div>}
        </>
      )}

      {pid && !isLoading && lsNodes.length === 0 && (
        <p className="ls-empty">Keine Projektstruktur vorhanden.</p>
      )}
    </div>
  )
}