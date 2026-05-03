import { useState, useEffect, useCallback, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Message } from '@/components/ui/Message'
import {
  fetchProjectsShort, fetchProjectStructure, fetchBillingTypes,
  inheritStructureExtras, patchStructureNode,
  createStructureNode, deleteStructureNode, moveStructureNode,
} from '@/api/projekte'
import { buildStructureTree, flattenTree } from '@/utils/treeUtils'

const FMT_EUR = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 })
const fmtEur  = (v: number | null | undefined) => v == null ? '—' : FMT_EUR.format(v)

type RowEdit = {
  nameShort: string; nameLong: string; billingTypeId: string
  nk: string; budget: string
}

type AddForm = {
  NAME_SHORT: string; NAME_LONG: string; BILLING_TYPE_ID: string
  FATHER_ID: string; REVENUE: string; EXTRAS_PERCENT: string
}

function emptyAdd(): AddForm {
  return { NAME_SHORT: '', NAME_LONG: '', BILLING_TYPE_ID: '', FATHER_ID: '', REVENUE: '', EXTRAS_PERCENT: '' }
}

function depthOf(id: number, parentMap: Map<number, number | null>): number {
  let d = 0, cur: number | null | undefined = id
  const seen = new Set<number>()
  while (cur != null) {
    if (seen.has(cur)) break
    seen.add(cur)
    cur = parentMap.get(cur)
    d++
  }
  return d
}

export function ProjektStruktur({ initialProjectId }: { initialProjectId?: number }) {
  const qc = useQueryClient()
  const [selectedPid, setSelectedPid]   = useState<number | null>(initialProjectId ?? null)
  const [edits, setEdits]               = useState<Record<number, RowEdit>>({})
  const [selectedIds, setSelectedIds]   = useState<Set<number>>(new Set())
  const [dragIds, setDragIds]           = useState<Set<number>>(new Set())
  const [dragOverId, setDragOverId]     = useState<number | null | 'root'>(null)
  const [dragZone, setDragZone]         = useState<'above' | 'on'>('on')
  const parentMapRef                    = useRef<Map<number, number | null>>(new Map())
  const tbodyRef                        = useRef<HTMLTableSectionElement>(null)
  const rootZoneRef                     = useRef<HTMLDivElement>(null)
  const pointerDragRef                  = useRef<{ id: number; idsToMove: number[]; active: boolean; zone: 'above' | 'on'; targetId: number | null } | null>(null)
  const flatTreeRef                     = useRef<typeof flatTree>([])
  const selectedIdsRef                  = useRef<Set<number>>(new Set())
  const [saveMsg, setSaveMsg]           = useState<{ text: string; type: 'success'|'error' } | null>(null)
  const [addForm, setAddForm]           = useState<AddForm | null>(null)

  const { data: projectsData } = useQuery({ queryKey: ['projects-short'], queryFn: fetchProjectsShort })
  const { data: structData, isLoading } = useQuery({
    queryKey: ['structure', selectedPid],
    queryFn:  () => fetchProjectStructure(selectedPid!),
    enabled:  selectedPid !== null,
  })
  const { data: btData } = useQuery({ queryKey: ['billing-types'], queryFn: fetchBillingTypes })

  const projects  = projectsData?.data ?? []
  const structure = structData?.data   ?? []
  const btypes    = btData?.data       ?? []

  useEffect(() => { setEdits({}); setAddForm(null); setSelectedIds(new Set()) }, [selectedPid])
  useEffect(() => { if (initialProjectId) setSelectedPid(initialProjectId) }, [initialProjectId])

  const flatTree = structure.length ? flattenTree(buildStructureTree(structure)) : []
  const parentIds = new Set(structure.filter(n => n.FATHER_ID != null).map(n => Number(n.FATHER_ID)))
  const parentMap = new Map(structure.map(n => [n.STRUCTURE_ID, n.FATHER_ID ? Number(n.FATHER_ID) : null]))

  function nodeDefault(structId: number): RowEdit {
    const node = structure.find(n => n.STRUCTURE_ID === structId)
    return {
      nameShort:    node?.NAME_SHORT ?? '',
      nameLong:     node?.NAME_LONG  ?? '',
      billingTypeId: String(node?.BILLING_TYPE_ID ?? ''),
      nk:     String(node?.EXTRAS_PERCENT ?? 0),
      budget: String(node?.REVENUE ?? 0),
    }
  }

  function setField(structId: number, field: keyof RowEdit, value: string) {
    setEdits(prev => {
      const cur = prev[structId] ?? nodeDefault(structId)
      return { ...prev, [structId]: { ...cur, [field]: value } }
    })
  }

  // ── Mutations ────────────────────────────────────────────────────────────

  const saveMut = useMutation({
    mutationFn: async (rows: Array<{
      id: number; name: string; nk: number; budget: number
      nameShort: string; nameLong: string; billingTypeId: string
      nkChanged: boolean; budgetChanged: boolean
      nameShortChanged: boolean; nameLongChanged: boolean; billingTypeIdChanged: boolean
    }>) => {
      for (const r of rows) {
        await patchStructureNode(r.id, {
          ...(r.nameShortChanged     ? { NAME_SHORT:      r.nameShort }              : {}),
          ...(r.nameLongChanged      ? { NAME_LONG:       r.nameLong }               : {}),
          ...(r.billingTypeIdChanged ? { BILLING_TYPE_ID: Number(r.billingTypeId) }  : {}),
          ...(r.nkChanged            ? { EXTRAS_PERCENT:  r.nk }                     : {}),
          ...(r.budgetChanged        ? { REVENUE:         r.budget }                 : {}),
        })
      }
      return rows
    },
    onSuccess: (rows) => {
      void qc.invalidateQueries({ queryKey: ['structure', selectedPid] })
      setSaveMsg({ text: 'Gespeichert ✅', type: 'success' })
      setEdits({})
      setTimeout(() => setSaveMsg(null), 3000)
      const toInherit = rows.filter(r => r.nkChanged && parentIds.has(r.id))
      for (const r of toInherit) {
        if (confirm(`NK % (${r.nk} %) für „${r.name}" auch an alle untergeordneten Elemente übertragen?`))
          inheritMut.mutate({ id: r.id, val: r.nk })
      }
    },
    onError: (e: Error) => setSaveMsg({ text: e.message, type: 'error' }),
  })

  const inheritMut = useMutation({
    mutationFn: ({ id, val }: { id: number; val: number }) => inheritStructureExtras(id, val),
    onSuccess: (res) => {
      void qc.invalidateQueries({ queryKey: ['structure', selectedPid] })
      setSaveMsg({ text: `NK % an ${(res as { updated?: number }).updated ?? '?'} Kind-Elemente vererbt ✅`, type: 'success' })
      setTimeout(() => setSaveMsg(null), 3000)
    },
    onError: (e: Error) => setSaveMsg({ text: e.message, type: 'error' }),
  })

  const addMut = useMutation({
    mutationFn: (f: AddForm) => createStructureNode(selectedPid!, {
      NAME_SHORT:      f.NAME_SHORT.trim(),
      NAME_LONG:       f.NAME_LONG.trim() || undefined,
      BILLING_TYPE_ID: Number(f.BILLING_TYPE_ID),
      FATHER_ID:       f.FATHER_ID ? Number(f.FATHER_ID) : null,
      REVENUE:         f.REVENUE !== '' ? Number(f.REVENUE) : undefined,
      EXTRAS_PERCENT:  f.EXTRAS_PERCENT !== '' ? Number(f.EXTRAS_PERCENT) : undefined,
    }),
    onSuccess: (res) => {
      void qc.invalidateQueries({ queryKey: ['structure', selectedPid] })
      const tec_moved = (res as { data?: { tec_moved?: boolean } }).data?.tec_moved
      setSaveMsg({
        text: tec_moved
          ? 'Element angelegt ✅ — Hinweis: TEC-Einträge des übergeordneten Elements wurden auf dieses Element übertragen.'
          : 'Element angelegt ✅',
        type: 'success',
      })
      setAddForm(null)
      setTimeout(() => setSaveMsg(null), 6000)
    },
    onError: (e: Error) => setSaveMsg({ text: e.message, type: 'error' }),
  })

  const deleteMut = useMutation({
    mutationFn: (id: number) => deleteStructureNode(id, true),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['structure', selectedPid] })
      setSaveMsg({ text: 'Element gelöscht ✅', type: 'success' })
      setTimeout(() => setSaveMsg(null), 3000)
    },
    onError: (e: Error) => setSaveMsg({ text: e.message, type: 'error' }),
  })


  // ── Bulk delete ───────────────────────────────────────────────────────────

  async function bulkDelete() {
    const ids = Array.from(selectedIds)
    if (!ids.length) return
    if (!confirm(`${ids.length} Element${ids.length > 1 ? 'e' : ''} löschen?\nHinweis: Nur möglich wenn keine Buchungen/Rechnungen darauf verweisen.`)) return
    // deepest first (children before parents)
    ids.sort((a, b) => depthOf(b, parentMap) - depthOf(a, parentMap))
    setSaveMsg(null)
    let failed = 0
    for (const id of ids) {
      try { await deleteStructureNode(id, false) }
      catch { failed++ }
    }
    void qc.invalidateQueries({ queryKey: ['structure', selectedPid] })
    setSelectedIds(new Set())
    setSaveMsg(failed
      ? { text: `${ids.length - failed} gelöscht, ${failed} fehlgeschlagen`, type: 'error' }
      : { text: `${ids.length} Element${ids.length > 1 ? 'e' : ''} gelöscht ✅`, type: 'success' })
    setTimeout(() => setSaveMsg(null), 4000)
  }

  // ── Save ─────────────────────────────────────────────────────────────────

  const saveAll = useCallback(() => {
    setSaveMsg(null)
    const rows = Object.entries(edits).map(([idStr, edit]) => {
      const id   = Number(idStr)
      const node = structure.find(n => n.STRUCTURE_ID === id)
      const origNk           = node?.EXTRAS_PERCENT ?? 0
      const origBudget       = node?.REVENUE ?? 0
      const origNameShort    = node?.NAME_SHORT ?? ''
      const origNameLong     = node?.NAME_LONG  ?? ''
      const origBillingTypeId = String(node?.BILLING_TYPE_ID ?? '')
      const nk     = edit.nk     !== '' ? Number(edit.nk)     : origNk
      const budget = edit.budget !== '' ? Number(edit.budget) : origBudget
      return {
        id, name: origNameShort,
        nk, budget,
        nameShort:    edit.nameShort    ?? origNameShort,
        nameLong:     edit.nameLong     ?? origNameLong,
        billingTypeId: edit.billingTypeId ?? origBillingTypeId,
        nkChanged:           nk     !== origNk,
        budgetChanged:       budget !== origBudget,
        nameShortChanged:    (edit.nameShort    ?? origNameShort)    !== origNameShort,
        nameLongChanged:     (edit.nameLong     ?? origNameLong)     !== origNameLong,
        billingTypeIdChanged: (edit.billingTypeId ?? origBillingTypeId) !== origBillingTypeId,
      }
    }).filter(r =>
      r.nkChanged || r.budgetChanged ||
      r.nameShortChanged || r.nameLongChanged || r.billingTypeIdChanged
    )
    if (!rows.length) { setSaveMsg({ text: 'Keine Änderungen', type: 'error' }); return }
    saveMut.mutate(rows)
  }, [edits, structure, saveMut])

  const submitAdd = useCallback(() => {
    if (!addForm) return
    if (!addForm.NAME_SHORT.trim()) { setSaveMsg({ text: 'Kürzel ist erforderlich', type: 'error' }); return }
    if (!addForm.BILLING_TYPE_ID)  { setSaveMsg({ text: 'Abrechnungsart ist erforderlich', type: 'error' }); return }
    setSaveMsg(null)
    addMut.mutate(addForm)
  }, [addForm, addMut])

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault()
        if (addForm) submitAdd()
        else saveAll()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [addForm, submitAdd, saveAll])

  // ── Drag & Drop (pointer events — reliable across all browsers) ──────────

  parentMapRef.current   = parentMap

  flatTreeRef.current    = flatTree
  selectedIdsRef.current = selectedIds

  function isDescendant(targetId: number, srcId: number, pMap: Map<number, number | null>): boolean {
    let cursor: number | null | undefined = pMap.get(targetId)
    while (cursor != null) {
      if (cursor === srcId) return true
      cursor = pMap.get(cursor)
    }
    return false
  }

  function handleHandlePointerDown(e: React.PointerEvent, id: number) {
    e.preventDefault()
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    // Drag the whole selection if this row is selected, otherwise just this row
    const sel = selectedIdsRef.current
    const idsToMove = sel.has(id) && sel.size > 1 ? [...sel] : [id]
    pointerDragRef.current = { id, idsToMove, active: false, zone: 'on', targetId: null }

    function onMove(ev: PointerEvent) {
      const state = pointerDragRef.current
      if (!state) return
      if (!state.active) {
        state.active = true
        setDragIds(new Set(idsToMove))
      }
      const el = document.elementFromPoint(ev.clientX, ev.clientY) as HTMLElement | null
      const rootZone = el?.closest('.struct-root-drop')
      const tr = el?.closest('tr[data-struct-id]') as HTMLElement | null

      if (rootZone) {
        state.targetId = null; state.zone = 'on'
        setDragOverId('root'); setDragZone('on')
      } else if (tr) {
        const targetId = Number(tr.dataset.structId)
        // Block if target is one of the dragged items or a descendant of the anchor
        if (idsToMove.includes(targetId) || isDescendant(targetId, id, parentMapRef.current)) {
          state.targetId = null; setDragOverId(null)
        } else {
          const rect = tr.getBoundingClientRect()
          const zone: 'above' | 'on' = (ev.clientY - rect.top) / rect.height < 0.35 ? 'above' : 'on'
          state.targetId = targetId; state.zone = zone
          setDragOverId(targetId); setDragZone(zone)
        }
      } else {
        state.targetId = null; setDragOverId(null)
      }
    }

    async function onUp(ev: PointerEvent) {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      const state = pointerDragRef.current
      if (!state?.active) { pointerDragRef.current = null; return }
      const { targetId, zone, idsToMove: items } = state
      pointerDragRef.current = null
      setDragIds(new Set()); setDragOverId(null)

      const el = document.elementFromPoint(ev.clientX, ev.clientY) as HTMLElement | null
      const rootZone = el?.closest('.struct-root-drop')
      const fatherId = rootZone ? null : zone === 'on' ? targetId : (parentMapRef.current.get(targetId ?? -1) ?? null)
      if (!rootZone && targetId === null) return

      // Sort items by current position in tree (preserve relative order)
      const flatNodes = flatTreeRef.current.map(({ node }) => node)
      const ordered = items
        .map(iid => flatNodes.find(n => n.STRUCTURE_ID === iid))
        .filter((n): n is NonNullable<typeof n> => n != null)
        .filter(n => !isDescendant(fatherId ?? -1, n.STRUCTURE_ID, parentMapRef.current))
        .sort((a, b) => (a.SORT_ORDER ?? a.STRUCTURE_ID ?? 0) - (b.SORT_ORDER ?? b.STRUCTURE_ID ?? 0))
        .map(n => n.STRUCTURE_ID)

      if (ordered.length === 0) return

      try {
        if (zone === 'on' || rootZone) {
          // Child/root drop: append each in order
          for (const iid of ordered) {
            await moveStructureNode(iid, fatherId, '__end__')
          }
        } else {
          // Sibling drop: chain after each other, starting before targetId
          const siblings = flatNodes.filter(n => (parentMapRef.current.get(n.STRUCTURE_ID) ?? null) === fatherId)
          const idx = siblings.findIndex(n => n.STRUCTURE_ID === targetId)
          let sortAfterId: number | null | '__end__' = idx > 0 ? siblings[idx - 1].STRUCTURE_ID : null
          for (const iid of ordered) {
            await moveStructureNode(iid, fatherId, sortAfterId)
            sortAfterId = iid
          }
        }
        void qc.invalidateQueries({ queryKey: ['structure', selectedPid] })
        setSaveMsg({ text: ordered.length > 1 ? `${ordered.length} Elemente verschoben ✅` : 'Verschoben ✅', type: 'success' })
        setTimeout(() => setSaveMsg(null), 3000)
        if (items.length > 1) setSelectedIds(new Set())
      } catch (err) {
        setSaveMsg({ text: (err as Error).message ?? 'Fehler beim Verschieben', type: 'error' })
      }
    }

    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  // ── Select helpers ────────────────────────────────────────────────────────

  const allIds = structure.map(n => n.STRUCTURE_ID)
  const allSelected = allIds.length > 0 && allIds.every(id => selectedIds.has(id))

  function toggleRow(id: number) {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  function toggleAll() {
    setSelectedIds(allSelected ? new Set() : new Set(allIds))
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div>
      <div className="form-group" style={{ maxWidth: 400, marginBottom: 12 }}>
        <label>Projekt</label>
        <select value={selectedPid ?? ''} onChange={e => { setSelectedPid(e.target.value ? Number(e.target.value) : null) }}>
          <option value="">Bitte wählen …</option>
          {projects.map(p => <option key={p.ID} value={p.ID}>{p.NAME_SHORT} – {p.NAME_LONG}</option>)}
        </select>
      </div>

      {selectedPid !== null && (
        <>
          {isLoading && <p className="empty-note">Lade Struktur …</p>}

          {!isLoading && (
            <>
              {/* Bulk toolbar */}
              {selectedIds.size > 0 && (
                <div className="struct-bulk-bar">
                  <span>{selectedIds.size} ausgewählt</span>
                  <button className="btn-small" style={{ color: '#e74c3c', borderColor: '#e74c3c' }}
                    onClick={bulkDelete}>
                    Löschen ({selectedIds.size})
                  </button>
                  <button className="btn-small" onClick={() => setSelectedIds(new Set())}>Auswahl aufheben</button>
                </div>
              )}

              {/* Drop zone to move to root */}
              {dragIds.size > 0 && (
                <div
                  ref={rootZoneRef}
                  className={`struct-root-drop${dragOverId === 'root' ? ' drag-over' : ''}`}
                >
                  Hier ablegen → Root-Element
                </div>
              )}

              {flatTree.length > 0 && (
                <div className="list-section">
                  <table className="master-table structure-table">
                    <thead>
                      <tr>
                        <th style={{ width: 28 }}>
                          <input type="checkbox" checked={allSelected}
                            onChange={toggleAll} title="Alle auswählen" />
                        </th>
                        <th style={{ width: 24 }}></th>
                        <th>Kürzel</th>
                        <th>Bezeichnung</th>
                        <th>Abrechnung</th>
                        <th className="num">Honorar €</th>
                        <th className="num">NK %</th>
                        <th className="num">Extras</th>
                        <th className="num">Stand €</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody ref={tbodyRef}>
                      {flatTree.map(({ node, depth }) => {
                        const edit      = edits[node.STRUCTURE_ID]
                        const nkVal     = edit?.nk     ?? String(node.EXTRAS_PERCENT ?? 0)
                        const budgetVal = edit?.budget ?? String(node.REVENUE ?? 0)
                        const nameShort = edit?.nameShort     ?? (node.NAME_SHORT ?? '')
                        const nameLong  = edit?.nameLong      ?? (node.NAME_LONG  ?? '')
                        const btId      = edit?.billingTypeId ?? String(node.BILLING_TYPE_ID ?? '')
                        const isTec     = Number(btId || node.BILLING_TYPE_ID) === 2
                        const isParent  = parentIds.has(node.STRUCTURE_ID)
                        const isDragOver = dragOverId === node.STRUCTURE_ID

                        return (
                          <tr
                            key={node.STRUCTURE_ID}
                            data-struct-id={node.STRUCTURE_ID}
                            className={[
                              isParent ? 'struct-row-parent' : '',
                              isDragOver && dragZone === 'on'    ? 'ps-drag-over'  : '',
                              isDragOver && dragZone === 'above' ? 'ps-drop-above' : '',
                              dragIds.has(node.STRUCTURE_ID) ? 'ps-dragging' : '',
                            ].filter(Boolean).join(' ')}
                          >
                            <td>
                              <input type="checkbox" checked={selectedIds.has(node.STRUCTURE_ID)}
                                onChange={() => toggleRow(node.STRUCTURE_ID)} />
                            </td>
                            <td>
                              <span
                                className="ps-drag-handle"
                                title="Halten und ziehen zum Verschieben"
                                onPointerDown={e => handleHandlePointerDown(e, node.STRUCTURE_ID)}
                              >⋮⋮</span>
                            </td>
                            <td style={{ paddingLeft: 4 + depth * 16 }}>
                              <input
                                style={{ width: 70, fontWeight: isParent ? 700 : undefined }}
                                value={nameShort}
                                onChange={e => setField(node.STRUCTURE_ID, 'nameShort', e.target.value)}
                              />
                              {isParent && <span className="struct-agg-badge" title="Aggregierter Wert aus Kind-Elementen"> ∑</span>}
                            </td>
                            <td>
                              <input
                                style={{ width: 160 }}
                                value={nameLong}
                                onChange={e => setField(node.STRUCTURE_ID, 'nameLong', e.target.value)}
                              />
                            </td>
                            <td>
                              <select style={{ fontSize: 11 }} value={btId}
                                onChange={e => setField(node.STRUCTURE_ID, 'billingTypeId', e.target.value)}>
                                {btypes.map(b => <option key={b.ID} value={b.ID}>{b.NAME_SHORT}</option>)}
                              </select>
                            </td>
                            <td className="num">
                              {isParent || isTec ? (
                                <span style={{ color: 'rgba(17,24,39,0.45)', fontSize: 12 }}>{fmtEur(isTec ? node.TEC_SP_TOT_SUM : node.REVENUE)}</span>
                              ) : (
                                <input type="number" min={0} step={100} style={{ width: 90, textAlign: 'right' }}
                                  value={budgetVal}
                                  onChange={e => setField(node.STRUCTURE_ID, 'budget', e.target.value)} />
                              )}
                            </td>
                            <td className="num">
                              <div style={{ display: 'flex', gap: 4, alignItems: 'center', justifyContent: 'flex-end' }}>
                                <input type="number" min={0} max={100} step={0.1} style={{ width: 56 }}
                                  value={nkVal}
                                  onChange={e => setField(node.STRUCTURE_ID, 'nk', e.target.value)} />
                                {isParent && (
                                  <button className="btn-small" style={{ padding: '2px 6px', fontSize: 10 }}
                                    disabled={inheritMut.isPending}
                                    title="NK % an alle Kind-Elemente vererben"
                                    onClick={() => {
                                      if (confirm(`NK % (${nkVal} %) an alle untergeordneten Elemente von „${nameShort}" übertragen?`))
                                        inheritMut.mutate({ id: node.STRUCTURE_ID, val: Number(nkVal) })
                                    }}>↓</button>
                                )}
                              </div>
                            </td>
                            <td className="num">{fmtEur(node.EXTRAS)}</td>
                            <td className="num">{fmtEur(node.REVENUE_COMPLETION)}</td>
                            <td>
                              <button className="btn-small" style={{ color: '#e74c3c', borderColor: '#e74c3c' }}
                                disabled={deleteMut.isPending}
                                title="Element löschen"
                                onClick={() => {
                                  if (confirm(`Element „${nameShort}" und alle Kind-Elemente löschen?`))
                                    deleteMut.mutate(node.STRUCTURE_ID)
                                }}>✕</button>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}

              {flatTree.length === 0 && !addForm && (
                <p className="empty-note">Keine Projektstruktur gefunden.</p>
              )}

              {/* ── Add form ── */}
              {addForm && (
                <div className="struct-add-form">
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
                    <div className="form-group" style={{ margin: 0 }}>
                      <label style={{ fontSize: 11 }}>Kürzel*</label>
                      <input style={{ width: 80 }} value={addForm.NAME_SHORT}
                        onChange={e => setAddForm(f => f && { ...f, NAME_SHORT: e.target.value })} />
                    </div>
                    <div className="form-group" style={{ margin: 0 }}>
                      <label style={{ fontSize: 11 }}>Bezeichnung</label>
                      <input style={{ width: 140 }} value={addForm.NAME_LONG}
                        onChange={e => setAddForm(f => f && { ...f, NAME_LONG: e.target.value })} />
                    </div>
                    <div className="form-group" style={{ margin: 0 }}>
                      <label style={{ fontSize: 11 }}>Abrechnungsart*</label>
                      <select style={{ fontSize: 12 }} value={addForm.BILLING_TYPE_ID}
                        onChange={e => setAddForm(f => f && { ...f, BILLING_TYPE_ID: e.target.value })}>
                        <option value="">Bitte wählen …</option>
                        {btypes.map(b => <option key={b.ID} value={b.ID}>{b.NAME_SHORT}{b.NAME_LONG ? ' – ' + b.NAME_LONG : ''}</option>)}
                      </select>
                    </div>
                    <div className="form-group" style={{ margin: 0 }}>
                      <label style={{ fontSize: 11 }}>Honorar €</label>
                      <input type="number" min={0} step={100} style={{ width: 100 }} placeholder="0"
                        value={addForm.REVENUE}
                        onChange={e => setAddForm(f => f && { ...f, REVENUE: e.target.value })} />
                    </div>
                    <div className="form-group" style={{ margin: 0 }}>
                      <label style={{ fontSize: 11 }}>NK %</label>
                      <input type="number" min={0} max={100} step={0.1} style={{ width: 70 }} placeholder="0"
                        value={addForm.EXTRAS_PERCENT}
                        onChange={e => setAddForm(f => f && { ...f, EXTRAS_PERCENT: e.target.value })} />
                    </div>
                    <div className="form-group" style={{ margin: 0 }}>
                      <label style={{ fontSize: 11 }}>Übergeordnet</label>
                      <select style={{ fontSize: 12 }} value={addForm.FATHER_ID}
                        onChange={e => {
                          const fatherId = e.target.value
                          const parent = structure.find(n => String(n.STRUCTURE_ID) === fatherId)
                          setAddForm(f => f && {
                            ...f, FATHER_ID: fatherId,
                            ...(parent ? {
                              BILLING_TYPE_ID: String(parent.BILLING_TYPE_ID ?? f.BILLING_TYPE_ID),
                              EXTRAS_PERCENT:  String(parent.EXTRAS_PERCENT  ?? f.EXTRAS_PERCENT),
                            } : {}),
                          })
                        }}>
                        <option value="">(Root)</option>
                        {flatTree.map(({ node }) => (
                          <option key={node.STRUCTURE_ID} value={node.STRUCTURE_ID}>
                            {node.NAME_SHORT}{node.NAME_LONG ? ' – ' + node.NAME_LONG : ''}
                          </option>
                        ))}
                      </select>
                    </div>
                    <button className="btn-primary btn-small" type="button" onClick={submitAdd} disabled={addMut.isPending}>
                      {addMut.isPending ? '…' : 'Speichern (Strg+S)'}
                    </button>
                    <button className="btn-small" type="button" onClick={() => { setAddForm(null); setSaveMsg(null) }}>
                      Abbrechen
                    </button>
                  </div>
                </div>
              )}

              <div className="structure-actions">
                <button className="btn-primary" type="button"
                  onClick={addForm ? submitAdd : saveAll}
                  disabled={saveMut.isPending || addMut.isPending}>
                  {(saveMut.isPending || addMut.isPending) ? 'Speichert …' : 'Speichern (Strg+S)'}
                </button>
                <button type="button" onClick={() => { setSaveMsg(null); setAddForm(f => f ? null : emptyAdd()) }}>
                  {addForm ? 'Formular schließen' : '+ Neues Element'}
                </button>
              </div>
              <Message text={saveMsg?.text ?? null} type={saveMsg?.type} />
            </>
          )}
        </>
      )}
    </div>
  )
}
