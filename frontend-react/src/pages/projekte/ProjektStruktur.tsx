import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Trash2 } from 'lucide-react'
import { Message }       from '@/components/ui/Message'
import { Modal }         from '@/components/ui/Modal'
import { ConfirmModal }  from '@/components/ui/ConfirmModal'
import { HonorarWizard } from '@/pages/projekte/HonorarWizard'
import {
  fetchProjectsShort, fetchProjectStructure, fetchBillingTypes,
  inheritStructureExtras, patchStructureNode,
  createStructureNode, deleteStructureNode, moveStructureNode,
  fetchParentChildCheck, transferFatherToChild,
  fetchProject, patchProjectRootSurcharges,
  type StructureNode,
} from '@/api/projekte'
import { buildStructureTree, flattenTree } from '@/utils/treeUtils'

const FMT_EUR = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2, maximumFractionDigits: 2 })
const fmtEur  = (v: number | null | undefined) => v == null ? '—' : FMT_EUR.format(v)

type RowEdit = {
  nameShort: string; nameLong: string; billingTypeId: string
  nk: string; budget: string
}

type SurchargeEdit = {
  s1Label: string; s1Pct: string; s1Cumul: boolean
  s2Label: string; s2Pct: string; s2Cumul: boolean
  s3Label: string; s3Pct: string; s3Cumul: boolean
}

type AddForm = {
  NAME_SHORT: string; NAME_LONG: string; BILLING_TYPE_ID: string
  FATHER_ID: string; REVENUE: string; EXTRAS_PERCENT: string
}

function emptyAdd(): AddForm {
  return { NAME_SHORT: '', NAME_LONG: '', BILLING_TYPE_ID: '', FATHER_ID: '', REVENUE: '', EXTRAS_PERCENT: '' }
}

function depthOf(id: string, parentMap: Map<string, string | null>): number {
  let d = 0, cur: string | null | undefined = id
  const seen = new Set<string>()
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
  const navigate = useNavigate()
  const [selectedPid, setSelectedPidState] = useState<number | null>(() => {
    if (initialProjectId != null) return initialProjectId
    const saved = localStorage.getItem('projekte-struct-pid')
    return saved ? Number(saved) : null
  })
  function setSelectedPid(id: number | null) {
    setSelectedPidState(id)
    if (id != null) localStorage.setItem('projekte-struct-pid', String(id))
    else localStorage.removeItem('projekte-struct-pid')
  }
  const [edits, setEdits]               = useState<Record<number, RowEdit>>({})
  const [selectedIds, setSelectedIds]   = useState<Set<number>>(new Set())
  const [dragIds, setDragIds]           = useState<Set<number>>(new Set())
  const [dragOverId, setDragOverId]     = useState<number | null | 'root'>(null)
  const [dragZone, setDragZone]         = useState<'above' | 'on'>('on')
  const parentMapRef                    = useRef<Map<string, string | null>>(new Map())
  const tbodyRef                        = useRef<HTMLTableSectionElement>(null)
  const rootZoneRef                     = useRef<HTMLDivElement>(null)
  const pointerDragRef                  = useRef<{ id: number; idsToMove: number[]; active: boolean; zone: 'above' | 'on'; targetId: number | null } | null>(null)
  const flatTreeRef                     = useRef<typeof flatTree>([])
  const selectedIdsRef                  = useRef<Set<number>>(new Set())
  const [saveMsg, setSaveMsg]           = useState<{ text: string; type: 'success'|'error' } | null>(null)
  const [addForm, setAddForm]           = useState<AddForm | null>(null)
  const [confirmState, setConfirmState] = useState<{ title: string; message: string; onConfirm: () => void } | null>(null)
  const [surchargePanel, setSurchargePanel] = useState<number | null>(null)
  const [surchargeEdits, setSurchargeEdits] = useState<Record<number, SurchargeEdit>>({})
  const [kalkFatherId, setKalkFatherId]     = useState<number | null>(null)
  const [projectSurchargePanel, setProjectSurchargePanel] = useState<boolean>(false)
  const [projectSurchargeEdit,  setProjectSurchargeEdit]  = useState<SurchargeEdit | null>(null)
  const [elementSearch, setElementSearch]         = useState('')
  const [contextMenu, setContextMenu]             = useState<{ x: number; y: number; nodeId: number | null } | null>(null)
  const contextMenuRef                            = useRef<HTMLDivElement>(null)
  const longPressRef                              = useRef<ReturnType<typeof setTimeout> | null>(null)

  const { data: projectsData } = useQuery({ queryKey: ['projects-short'], queryFn: fetchProjectsShort })
  const { data: structData, isLoading } = useQuery({
    queryKey: ['structure', selectedPid],
    queryFn:  () => fetchProjectStructure(selectedPid!),
    enabled:  selectedPid !== null,
  })
  const { data: btData } = useQuery({ queryKey: ['billing-types'], queryFn: fetchBillingTypes })
  const { data: projectData } = useQuery({
    queryKey: ['project-detail', selectedPid],
    queryFn:  () => fetchProject(selectedPid!),
    enabled:  selectedPid !== null,
  })

  const projects  = projectsData?.data ?? []
  const structure = structData?.data   ?? []
  const projectRow = projectData?.data ?? null
  const btypes    = btData?.data       ?? []

  useEffect(() => { setEdits({}); setAddForm(null); setSelectedIds(new Set()) }, [selectedPid])
  // Projektauswahl kommt zentral aus dem Seitenkopf (ProjectPicker).
  useEffect(() => { setSelectedPid(initialProjectId ?? null) }, [initialProjectId])

  const flatTree = structure.length ? flattenTree(buildStructureTree(structure)) : []
  // String keys avoid bigint vs number mismatches at runtime
  const parentIds = new Set(structure.filter(n => n.FATHER_ID != null).map(n => String(n.FATHER_ID)))
  const parentMap = new Map(structure.map(n => [String(n.STRUCTURE_ID), n.FATHER_ID != null ? String(n.FATHER_ID) : null]))

  // Bottom-up aggregate: extras, surcharges, and revenueBasis (sum of leaf REVENUE_BASIS values)
  // Parent EXTRAS = sum(children.EXTRAS) + own_surcharges × own_NK%
  // so NK applies to the surcharged total, not just the base.
  const aggMap = (() => {
    const childrenOf = new Map<string, string[]>()
    for (const n of structure) {
      if (n.FATHER_ID != null) {
        const fid = String(n.FATHER_ID)
        const arr = childrenOf.get(fid) ?? []
        arr.push(String(n.STRUCTURE_ID))
        childrenOf.set(fid, arr)
      }
    }
    const nodeMap = new Map(structure.map(n => [String(n.STRUCTURE_ID), n]))
    const r2 = (n: number) => Math.round(n * 100) / 100
    const cache = new Map<string, { extras: number; surcharges: number; revenueBasis: number }>()
    function agg(id: string): { extras: number; surcharges: number; revenueBasis: number } {
      if (cache.has(id)) return cache.get(id)!
      const children = childrenOf.get(id) ?? []
      if (children.length === 0) {
        const n = nodeMap.get(id)!
        const r = { extras: n?.EXTRAS ?? 0, surcharges: n?.SURCHARGES_TOTAL ?? 0, revenueBasis: n?.REVENUE_BASIS ?? n?.REVENUE ?? 0 }
        cache.set(id, r); return r
      }
      let extras = 0, surcharges = 0, revenueBasis = 0
      for (const cid of children) { const c = agg(cid); extras += c.extras; surcharges += c.surcharges; revenueBasis += c.revenueBasis }
      const ownNode = nodeMap.get(id)
      const ownSurcharges = ownNode?.SURCHARGES_TOTAL ?? 0
      const ownNk         = Number(ownNode?.EXTRAS_PERCENT ?? 0)
      surcharges += ownSurcharges  // parent's own surcharges on top
      extras = r2(extras + ownSurcharges * ownNk / 100)  // NK applies to own surcharges too
      cache.set(id, { extras, surcharges, revenueBasis }); return { extras, surcharges, revenueBasis }
    }
    for (const n of structure) agg(String(n.STRUCTURE_ID))
    return cache
  })()

  // These depend on parentMap and aggMap — declared AFTER them to avoid TDZ crash
  const filteredFlatTree = useMemo(() => {
    if (!elementSearch) return flatTree
    const sq = elementSearch.toLowerCase()
    const matchIds = new Set(
      flatTree
        .filter(({ node }) =>
          node.NAME_SHORT.toLowerCase().includes(sq) ||
          (node.NAME_LONG?.toLowerCase().includes(sq))
        )
        .map(({ node }) => node.STRUCTURE_ID)
    )
    for (const id of [...matchIds]) {
      let cursor = parentMap.get(String(id))
      while (cursor != null) { matchIds.add(Number(cursor)); cursor = parentMap.get(cursor) }
    }
    return flatTree.filter(({ node }) => matchIds.has(node.STRUCTURE_ID))
  }, [flatTree, elementSearch, parentMap])

  useEffect(() => {
    if (!contextMenu) return
    function onDown(e: MouseEvent) {
      if (contextMenuRef.current && !contextMenuRef.current.contains(e.target as Node))
        setContextMenu(null)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [contextMenu])


  function nodeDefault(structId: number): RowEdit {
    const node = structure.find(n => n.STRUCTURE_ID === structId)
    return {
      nameShort:    node?.NAME_SHORT ?? '',
      nameLong:     node?.NAME_LONG  ?? '',
      billingTypeId: String(node?.BILLING_TYPE_ID ?? ''),
      nk:     String(node?.EXTRAS_PERCENT ?? 0),
      budget: String(node?.REVENUE_BASIS ?? node?.REVENUE ?? 0),
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
      const toInherit = rows.filter(r => r.nkChanged && parentIds.has(String(r.id)))
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

  const surchargeMut = useMutation({
    mutationFn: ({ id, s }: { id: number; s: SurchargeEdit }) =>
      patchStructureNode(id, {
        SURCHARGE_1_LABEL: s.s1Label || null,
        SURCHARGE_1_PCT:   s.s1Pct !== '' ? Number(s.s1Pct) : null,
        SURCHARGE_1_CUMUL: s.s1Cumul,
        SURCHARGE_2_LABEL: s.s2Label || null,
        SURCHARGE_2_PCT:   s.s2Pct !== '' ? Number(s.s2Pct) : null,
        SURCHARGE_2_CUMUL: s.s2Cumul,
        SURCHARGE_3_LABEL: s.s3Label || null,
        SURCHARGE_3_PCT:   s.s3Pct !== '' ? Number(s.s3Pct) : null,
        SURCHARGE_3_CUMUL: s.s3Cumul,
      }),
    onSuccess: (_, { id }) => {
      void qc.invalidateQueries({ queryKey: ['structure', selectedPid] })
      setSurchargeEdits(prev => { const n = { ...prev }; delete n[id]; return n })
      setSaveMsg({ text: 'Zuschläge gespeichert ✅', type: 'success' })
      setTimeout(() => setSaveMsg(null), 3000)
    },
    onError: (e: Error) => setSaveMsg({ text: e.message, type: 'error' }),
  })

  function closeSurchargePanel(nodeId: number) {
    const pending = surchargeEdits[nodeId]
    if (pending) surchargeMut.mutate({ id: nodeId, s: pending })
    setSurchargePanel(null)
  }

  // Project-level (root) surcharge mutation — Option A
  const projectSurchargeMut = useMutation({
    mutationFn: (s: SurchargeEdit) =>
      patchProjectRootSurcharges(selectedPid!, {
        SURCHARGE_1_LABEL: s.s1Label || null,
        SURCHARGE_1_PCT:   s.s1Pct !== '' ? Number(s.s1Pct) : null,
        SURCHARGE_1_CUMUL: s.s1Cumul,
        SURCHARGE_2_LABEL: s.s2Label || null,
        SURCHARGE_2_PCT:   s.s2Pct !== '' ? Number(s.s2Pct) : null,
        SURCHARGE_2_CUMUL: s.s2Cumul,
        SURCHARGE_3_LABEL: s.s3Label || null,
        SURCHARGE_3_PCT:   s.s3Pct !== '' ? Number(s.s3Pct) : null,
        SURCHARGE_3_CUMUL: s.s3Cumul,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['project-detail', selectedPid] })
      setProjectSurchargeEdit(null)
      setSaveMsg({ text: 'Projektzuschläge gespeichert ✅', type: 'success' })
      setTimeout(() => setSaveMsg(null), 3000)
    },
    onError: (e: Error) => setSaveMsg({ text: e.message, type: 'error' }),
  })

  function closeProjectSurchargePanel() {
    if (projectSurchargeEdit) projectSurchargeMut.mutate(projectSurchargeEdit)
    setProjectSurchargePanel(false)
  }

  function projectSurchargeDefault(): SurchargeEdit {
    const p = projectRow as Record<string, unknown> | null
    return {
      s1Label: (p?.SURCHARGE_1_LABEL as string | null) ?? '',
      s1Pct:   p?.SURCHARGE_1_PCT != null ? String(p.SURCHARGE_1_PCT) : '',
      s1Cumul: (p?.SURCHARGE_1_CUMUL as boolean | undefined) ?? true,
      s2Label: (p?.SURCHARGE_2_LABEL as string | null) ?? '',
      s2Pct:   p?.SURCHARGE_2_PCT != null ? String(p.SURCHARGE_2_PCT) : '',
      s2Cumul: (p?.SURCHARGE_2_CUMUL as boolean | undefined) ?? true,
      s3Label: (p?.SURCHARGE_3_LABEL as string | null) ?? '',
      s3Pct:   p?.SURCHARGE_3_PCT != null ? String(p.SURCHARGE_3_PCT) : '',
      s3Cumul: (p?.SURCHARGE_3_CUMUL as boolean | undefined) ?? true,
    }
  }

  function surchargeDefault(node: StructureNode): SurchargeEdit {
    return {
      s1Label: node.SURCHARGE_1_LABEL ?? '',
      s1Pct:   node.SURCHARGE_1_PCT != null ? String(node.SURCHARGE_1_PCT) : '',
      s1Cumul: node.SURCHARGE_1_CUMUL ?? true,
      s2Label: node.SURCHARGE_2_LABEL ?? '',
      s2Pct:   node.SURCHARGE_2_PCT != null ? String(node.SURCHARGE_2_PCT) : '',
      s2Cumul: node.SURCHARGE_2_CUMUL ?? true,
      s3Label: node.SURCHARGE_3_LABEL ?? '',
      s3Pct:   node.SURCHARGE_3_PCT != null ? String(node.SURCHARGE_3_PCT) : '',
      s3Cumul: node.SURCHARGE_3_CUMUL ?? true,
    }
  }

  function computeSurcharges(base: number, s: SurchargeEdit) {
    const r2 = (n: number) => Math.round(n * 100) / 100
    const s1Active = !!s.s1Label && s.s1Pct !== '' && Number(s.s1Pct) !== 0
    const s1Eur    = s1Active ? r2(base * Number(s.s1Pct) / 100) : 0
    const s1Sub    = base + s1Eur
    const s2Base   = s.s2Cumul ? s1Sub : base
    const s2Active = !!s.s2Label && s.s2Pct !== '' && Number(s.s2Pct) !== 0
    const s2Eur    = s2Active ? r2(s2Base * Number(s.s2Pct) / 100) : 0
    const s2Sub    = s1Sub + s2Eur
    const s3Base   = s.s3Cumul ? s2Sub : base
    const s3Active = !!s.s3Label && s.s3Pct !== '' && Number(s.s3Pct) !== 0
    const s3Eur    = s3Active ? r2(s3Base * Number(s.s3Pct) / 100) : 0
    return { s1Eur, s2Eur, s3Eur, total: r2(s1Eur + s2Eur + s3Eur) }
  }

  const internalMut = useMutation({
    mutationFn: ({ id, val }: { id: number; val: boolean }) => patchStructureNode(id, { IS_INTERNAL: val }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['structure', selectedPid] })
    },
    onError: (e: Error) => setSaveMsg({ text: e.message, type: 'error' }),
  })

  const addMut = useMutation({
    mutationFn: (f: AddForm & { transfer_parent_values?: boolean }) => createStructureNode(selectedPid!, {
      NAME_SHORT:             f.NAME_SHORT.trim(),
      NAME_LONG:              f.NAME_LONG.trim() || undefined,
      BILLING_TYPE_ID:        Number(f.BILLING_TYPE_ID),
      FATHER_ID:              f.FATHER_ID ? Number(f.FATHER_ID) : null,
      REVENUE:                f.REVENUE !== '' ? Number(f.REVENUE) : undefined,
      EXTRAS_PERCENT:         f.EXTRAS_PERCENT !== '' ? Number(f.EXTRAS_PERCENT) : undefined,
      transfer_parent_values: f.transfer_parent_values,
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

  async function doBulkDelete(ids: number[]) {
    if (!ids.length) return
    const sorted = [...ids].sort((a, b) => depthOf(String(b), parentMap) - depthOf(String(a), parentMap))
    setSaveMsg(null)
    let failed = 0
    for (const id of sorted) {
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

  function bulkDelete() {
    const ids = Array.from(selectedIds)
    if (!ids.length) return
    setConfirmState({
      title: `${ids.length} Element${ids.length > 1 ? 'e' : ''} löschen`,
      message: `${ids.length} Element${ids.length > 1 ? 'e' : ''} löschen?\nHinweis: Nur möglich wenn keine Buchungen/Rechnungen darauf verweisen.`,
      onConfirm: () => void doBulkDelete(ids),
    })
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

  const submitAdd = useCallback(async () => {
    if (!addForm) return
    if (!addForm.NAME_SHORT.trim()) { setSaveMsg({ text: 'Kürzel ist erforderlich', type: 'error' }); return }
    if (!addForm.BILLING_TYPE_ID)  { setSaveMsg({ text: 'Abrechnungsart ist erforderlich', type: 'error' }); return }
    setSaveMsg(null)

    if (addForm.FATHER_ID) {
      try {
        const check = await fetchParentChildCheck(Number(addForm.FATHER_ID))
        if (check.status === 'blocked') {
          setSaveMsg({ text: check.reason ?? 'Dieses Element kann keine Unterelemente erhalten.', type: 'error' })
          return
        }
        if (check.status === 'needs_transfer') {
          const confirmMsg = check.hasTec
            ? 'Das übergeordnete Element enthält bereits Werte und/oder Buchungen. Diese werden auf das neue Element übertragen. Möchten Sie fortfahren?'
            : 'Das übergeordnete Element enthält bereits Werte. Diese werden auf das neue Element übertragen. Möchten Sie fortfahren?'
          if (!confirm(confirmMsg)) return
          addMut.mutate({ ...addForm, transfer_parent_values: true } as typeof addForm & { transfer_parent_values: boolean })
          return
        }
      } catch (e) {
        setSaveMsg({ text: (e as Error).message ?? 'Fehler beim Prüfen des übergeordneten Elements', type: 'error' })
        return
      }
    }
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

  function isDescendant(targetId: string | number, srcId: string | number, pMap: Map<string, string | null>): boolean {
    let cursor: string | null | undefined = pMap.get(String(targetId))
    while (cursor != null) {
      if (cursor === String(srcId)) return true
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
      const fatherIdStr = rootZone ? null : zone === 'on'
        ? (targetId != null ? String(targetId) : null)
        : (parentMapRef.current.get(targetId != null ? String(targetId) : '-1') ?? null)
      const fatherId = fatherIdStr != null ? Number(fatherIdStr) : null
      if (!rootZone && targetId === null) return

      // Sort items by current position in tree (preserve relative order)
      const flatNodes = flatTreeRef.current.map(({ node }) => node)
      const ordered = items
        .map(iid => flatNodes.find(n => n.STRUCTURE_ID === iid))
        .filter((n): n is NonNullable<typeof n> => n != null)
        .filter(n => !isDescendant(fatherIdStr ?? -1, n.STRUCTURE_ID, parentMapRef.current))
        .sort((a, b) => (a.SORT_ORDER ?? 0) - (b.SORT_ORDER ?? 0))
        .map(n => Number(n.STRUCTURE_ID))

      if (ordered.length === 0) return

      // When dropping AS A CHILD (zone='on') into a non-root target, check the new parent
      if ((zone === 'on' && !rootZone) && fatherId !== null) {
        try {
          const check = await fetchParentChildCheck(fatherId)
          if (check.status === 'blocked') {
            setSaveMsg({ text: check.reason ?? 'Dieses Element kann keine Unterelemente erhalten.', type: 'error' })
            return
          }
          if (check.status === 'needs_transfer') {
            const confirmMsg = check.hasTec
              ? 'Das Zielelement enthält bereits Werte und/oder Buchungen. Diese werden auf das verschobene Element übertragen. Möchten Sie fortfahren?'
              : 'Das Zielelement enthält bereits Werte. Diese werden auf das verschobene Element übertragen. Möchten Sie fortfahren?'
            if (!confirm(confirmMsg)) return
            // Transfer father's values/TEC to the first element being moved
            await transferFatherToChild(fatherId, ordered[0])
          }
        } catch (e) {
          setSaveMsg({ text: (e as Error).message ?? 'Fehler beim Prüfen des Zielelements', type: 'error' })
          return
        }
      }

      try {
        if (zone === 'on' || rootZone) {
          // Child/root drop: append each in order
          for (const iid of ordered) {
            await moveStructureNode(iid, fatherId, '__end__')
          }
        } else {
          // Sibling drop: chain after each other, starting before targetId
          const siblings = flatNodes.filter(n => (parentMapRef.current.get(String(n.STRUCTURE_ID)) ?? null) === fatherIdStr)
          const idx = siblings.findIndex(n => n.STRUCTURE_ID === targetId)
          let sortAfterId: number | null | '__end__' = idx > 0 ? Number(siblings[idx - 1].STRUCTURE_ID) : null
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

  // ── Root row totals ───────────────────────────────────────────────────────
  const currentProject = projects.find(p => p.ID === selectedPid)
  // rootRevenue = pure sum of leaf REVENUE_BASIS values (before any surcharges at any level)
  const rootRevenue = structure.filter(n => n.FATHER_ID == null).reduce((s, n) => {
    const isP = parentIds.has(String(n.STRUCTURE_ID))
    return s + (isP ? (aggMap.get(String(n.STRUCTURE_ID))?.revenueBasis ?? 0) : (n.REVENUE_BASIS ?? n.REVENUE ?? 0))
  }, 0)
  // Sum surcharges from structure subtree + project-level (root) surcharges
  const structureSurcharges = structure.filter(n => n.FATHER_ID == null).reduce((s, n) => s + (aggMap.get(String(n.STRUCTURE_ID))?.surcharges ?? 0), 0)
  const projectLevelSurcharges = Number((projectRow as Record<string, unknown> | null)?.SURCHARGES_TOTAL || 0)
  const rootSurcharges = structureSurcharges + projectLevelSurcharges
  const rootStructureRevenueSum = structure.filter(n => n.FATHER_ID == null).reduce((s, n) => s + (n.REVENUE ?? 0), 0)
  const rootRevenueFinal = rootStructureRevenueSum + projectLevelSurcharges
  const rootExtras      = structure.filter(n => n.FATHER_ID == null).reduce((s, n) => s + (aggMap.get(String(n.STRUCTURE_ID))?.extras ?? 0), 0)
  // Gesamt-Spalte: Summe aus Honorar + Zuschläge (REVENUE) + Nebenkosten (EXTRAS).
  // Wird auf Root-Ebene aus den Top-Level-Aggregaten + Projekt-Root-Surcharges
  // summiert.
  const rootGesamt = rootRevenueFinal + rootExtras

  // Computed live preview of project-level surcharge amounts (used in the panel)
  function computeProjectSurchargesPreview(s: SurchargeEdit) {
    return computeSurcharges(rootStructureRevenueSum, s)
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
      {selectedPid === null && <p className="empty-note">Bitte oben ein Projekt auswählen.</p>}

      {selectedPid !== null && currentProject && (
        <div className="proj-jump-bar">
          <span className="proj-jump-label">{currentProject.NAME_SHORT}</span>
          <button className="btn-small" onClick={() => navigate('/rechnungen', { state: { projectSearch: currentProject.NAME_LONG ?? currentProject.NAME_SHORT, backProject: { id: selectedPid, name: currentProject.NAME_SHORT } } })}>
            Rechnungen →
          </button>
          <button className="btn-small" onClick={() => navigate('/daten', { state: { tab: 'einzelprojekt', projectId: selectedPid } })}>
            Projekt-Report →
          </button>
          <button className="btn-small" onClick={() => navigate('/projekte', { state: { tab: 'honorar', projectId: selectedPid } })}>
            HOAI →
          </button>
        </div>
      )}

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
                  <div style={{ marginBottom: 8 }}>
                    <input type="search" className="list-search" placeholder="Elemente filtern …"
                      style={{ maxWidth: 260, fontSize: 13 }}
                      value={elementSearch} onChange={e => setElementSearch(e.target.value)}
                    />
                  </div>
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
                        <th className="num">Zuschläge €</th>
                        <th className="num">Honorar + Zuschl. €</th>
                        <th style={{ textAlign: 'left' }}>NK %</th>
                        <th className="num">Nebenkosten €</th>
                        <th className="num">Gesamt €</th>
                        <th style={{ textAlign: 'center', whiteSpace: 'nowrap' }}>Intern</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody ref={tbodyRef}>
                      {currentProject && (
                        <>
                        <tr
                          style={{ fontWeight: 700, background: 'rgba(37,99,235,0.04)', borderBottom: '2px solid rgba(17,24,39,0.10)', cursor: 'context-menu' }}
                          onContextMenu={e => { e.preventDefault(); setContextMenu({ x: e.clientX, y: e.clientY, nodeId: null }) }}
                        >
                          <td></td>
                          <td></td>
                          <td style={{ paddingLeft: 4, fontSize: 13 }}>{currentProject.NAME_SHORT}</td>
                          <td style={{ fontSize: 13, color: 'rgba(17,24,39,0.7)' }}>{currentProject.NAME_LONG}</td>
                          <td><span style={{ color: 'rgba(17,24,39,0.3)', fontSize: 12 }}>—</span></td>
                          <td className="num"><span style={{ color: 'rgba(17,24,39,0.45)', fontSize: 12 }}>{fmtEur(rootRevenue)}</span></td>
                          <td className="num"><span style={{ color: rootSurcharges > 0 ? '#16a34a' : rootSurcharges < 0 ? '#dc2626' : 'rgba(17,24,39,0.25)', fontSize: 12 }}>{rootSurcharges !== 0 ? fmtEur(rootSurcharges) : '—'}</span></td>
                          <td className="num"><span style={{ fontSize: 12, fontWeight: rootSurcharges !== 0 ? 600 : undefined }}>{fmtEur(rootRevenueFinal)}</span></td>
                          <td style={{ textAlign: 'left' }}><span style={{ color: 'rgba(17,24,39,0.3)', fontSize: 12 }}>—</span></td>
                          <td className="num"><span style={{ color: 'rgba(17,24,39,0.45)', fontSize: 12 }}>{fmtEur(rootExtras)}</span></td>
                          <td className="num"><span style={{ fontSize: 12, fontWeight: 700 }}>{fmtEur(rootGesamt)}</span></td>
                          <td></td>
                          <td></td>
                        </tr>
                        {projectSurchargePanel && projectSurchargeEdit && (() => {
                          const sE = projectSurchargeEdit
                          const computed = computeProjectSurchargesPreview(sE)
                          const setEdit = (f: Partial<SurchargeEdit>) => setProjectSurchargeEdit(prev => prev ? { ...prev, ...f } : prev)
                          return (
                            <tr className="surcharge-panel-row">
                              <td colSpan={13}>
                                <div className="surcharge-panel">
                                  <div className="surcharge-panel-basis">
                                    Projektzuschläge – Basis (Summe Wurzel-Honorar): <strong>{fmtEur(rootStructureRevenueSum)}</strong>
                                  </div>
                                  <div className="surcharge-grid">
                                    <div className="surcharge-grid-header">
                                      <span>Kumul.</span>
                                      <span>Bezeichnung</span>
                                      <span style={{ textAlign: 'right' }}>%</span>
                                      <span style={{ textAlign: 'right' }}>Betrag</span>
                                    </div>
                                    {([
                                      { label: sE.s1Label, pct: sE.s1Pct, cumul: sE.s1Cumul, eur: computed.s1Eur, disableCumul: true,  placeholder: 'z.B. GP-Zuschlag', labelKey: 's1Label' as const, pctKey: 's1Pct' as const, cumulKey: 's1Cumul' as const },
                                      { label: sE.s2Label, pct: sE.s2Pct, cumul: sE.s2Cumul, eur: computed.s2Eur, disableCumul: false, placeholder: '(leer = inaktiv)', labelKey: 's2Label' as const, pctKey: 's2Pct' as const, cumulKey: 's2Cumul' as const },
                                      { label: sE.s3Label, pct: sE.s3Pct, cumul: sE.s3Cumul, eur: computed.s3Eur, disableCumul: false, placeholder: '(leer = inaktiv)', labelKey: 's3Label' as const, pctKey: 's3Pct' as const, cumulKey: 's3Cumul' as const },
                                    ] as const).map((row, i) => (
                                      <div className="surcharge-grid-row" key={i}>
                                        <input type="checkbox" checked={row.cumul} disabled={row.disableCumul}
                                          title={row.disableCumul ? 'Erster Zuschlag bezieht sich immer auf die Basis' : 'Kumulativ (auf laufende Zwischensumme)'}
                                          onChange={e => setEdit({ [row.cumulKey]: e.target.checked })} />
                                        <input className="tbl-input" placeholder={row.placeholder} value={row.label}
                                          onChange={e => setEdit({ [row.labelKey]: e.target.value })} />
                                        <input className="tbl-input" type="number" min={-100} max={500} step={0.1}
                                          style={{ width: 64, textAlign: 'right' }} value={row.pct}
                                          onChange={e => setEdit({ [row.pctKey]: e.target.value })} />
                                        <span className="surcharge-eur">{row.label || row.pct ? fmtEur(row.eur) : '—'}</span>
                                      </div>
                                    ))}
                                    <div className="surcharge-grid-total">
                                      Gesamt Projektzuschläge: <strong>{fmtEur(computed.total)}</strong>
                                    </div>
                                  </div>
                                  <div className="surcharge-panel-actions">
                                    <button className="btn-small" onClick={closeProjectSurchargePanel}>
                                      {projectSurchargeMut.isPending ? 'Speichert …' : 'Schließen (speichert automatisch)'}
                                    </button>
                                  </div>
                                </div>
                              </td>
                            </tr>
                          )
                        })()}
                        </>
                      )}
                      {filteredFlatTree.map(({ node, depth }) => {
                        const edit      = edits[node.STRUCTURE_ID]
                        const nkVal     = edit?.nk     ?? String(node.EXTRAS_PERCENT ?? 0)
                        // Editable "Honorar" shows REVENUE_BASIS (the base before surcharges)
                        const budgetVal = edit?.budget ?? String(node.REVENUE_BASIS ?? node.REVENUE ?? 0)
                        const nameShort = edit?.nameShort     ?? (node.NAME_SHORT ?? '')
                        const nameLong  = edit?.nameLong      ?? (node.NAME_LONG  ?? '')
                        const btId      = edit?.billingTypeId ?? String(node.BILLING_TYPE_ID ?? '')
                        const isTec     = Number(btId || node.BILLING_TYPE_ID) === 2
                        const isParent  = parentIds.has(String(node.STRUCTURE_ID))
                        const isDragOver = dragOverId === node.STRUCTURE_ID

                        const sEdit = surchargeEdits[node.STRUCTURE_ID] ?? surchargeDefault(node)
                        // Surcharge base = REVENUE_BASIS only (for leaf) or sum of children's REVENUE (for parent)
                        const surchargeBase = isParent
                          ? (node.REVENUE_BASIS ?? 0)
                          : (isTec ? (node.TEC_SP_TOT_SUM ?? 0) : (node.REVENUE_BASIS ?? node.REVENUE ?? 0))
                        const computed = computeSurcharges(surchargeBase, sEdit)
                        const hasSurcharges = (node.SURCHARGES_TOTAL ?? 0) !== 0

                        return (
                          <React.Fragment key={node.STRUCTURE_ID}>
                          <tr
                            data-struct-id={node.STRUCTURE_ID}
                            className={[
                              isParent ? 'struct-row-parent' : '',
                              isDragOver && dragZone === 'on'    ? 'ps-drag-over'  : '',
                              isDragOver && dragZone === 'above' ? 'ps-drop-above' : '',
                              dragIds.has(node.STRUCTURE_ID) ? 'ps-dragging' : '',
                            ].filter(Boolean).join(' ')}
                            onContextMenu={e => { e.preventDefault(); setContextMenu({ x: e.clientX, y: e.clientY, nodeId: node.STRUCTURE_ID }) }}
                            onTouchStart={() => { longPressRef.current = setTimeout(() => setContextMenu({ x: 0, y: 0, nodeId: node.STRUCTURE_ID }), 600) }}
                            onTouchEnd={() => { if (longPressRef.current) { clearTimeout(longPressRef.current); longPressRef.current = null } }}
                            onTouchMove={() => { if (longPressRef.current) { clearTimeout(longPressRef.current); longPressRef.current = null } }}
                            style={node.IS_INTERNAL ? { opacity: 0.6 } : undefined}
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
                                className="tbl-input"
                                style={{ width: 70, fontWeight: isParent ? 700 : undefined }}
                                value={nameShort}
                                onChange={e => setField(node.STRUCTURE_ID, 'nameShort', e.target.value)}
                              />
                              {isParent && <span className="struct-agg-badge" title="Aggregierter Wert aus Kind-Elementen"> ∑</span>}
                            </td>
                            <td>
                              <input
                                className="tbl-input"
                                style={{ width: 160 }}
                                value={nameLong}
                                onChange={e => setField(node.STRUCTURE_ID, 'nameLong', e.target.value)}
                              />
                            </td>
                            <td>
                              <select className="tbl-select" value={btId}
                                onChange={e => setField(node.STRUCTURE_ID, 'billingTypeId', e.target.value)}>
                                {btypes.map(b => <option key={b.ID} value={b.ID}>{b.NAME_SHORT}</option>)}
                              </select>
                            </td>
                            <td className="num">
                              {/* Honorar € = pure leaf sum (REVENUE_BASIS) so it never includes surcharges */}
                              {isParent || isTec ? (
                                <span style={{ color: 'rgba(17,24,39,0.45)', fontSize: 12 }}>
                                  {fmtEur(isTec ? node.TEC_SP_TOT_SUM : (aggMap.get(String(node.STRUCTURE_ID))?.revenueBasis ?? 0))}
                                </span>
                              ) : (
                                <input className="tbl-input" type="number" min={0} step={100} style={{ width: 90, textAlign: 'right' }}
                                  value={budgetVal}
                                  onChange={e => setField(node.STRUCTURE_ID, 'budget', e.target.value)} />
                              )}
                            </td>
                            <td className="num">
                              {/* davon Zuschläge = aggregate surcharges for whole subtree */}
                              {(() => {
                                const sv = isParent ? (aggMap.get(String(node.STRUCTURE_ID))?.surcharges ?? 0) : (node.SURCHARGES_TOTAL ?? 0)
                                return sv !== 0
                                  ? <span style={{ color: sv > 0 ? '#16a34a' : '#dc2626', fontSize: 12 }}>{fmtEur(sv)}</span>
                                  : <span style={{ color: 'rgba(17,24,39,0.25)', fontSize: 12 }}>—</span>
                              })()}
                            </td>
                            <td className="num">
                              {/* Honorar + Zuschläge = REVENUE (final, all surcharges included) */}
                              <span style={{ fontSize: 12, fontWeight: hasSurcharges ? 600 : undefined }}>
                                {fmtEur(node.REVENUE ?? 0)}
                              </span>
                            </td>
                            <td>
                              <div style={{ display: 'flex', gap: 4, alignItems: 'center', justifyContent: 'flex-start' }}>
                                <input className="tbl-input" type="number" min={0} max={100} step={0.1} style={{ width: 56 }}
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
                            <td className="num">{fmtEur(isParent ? aggMap.get(String(node.STRUCTURE_ID))?.extras : node.EXTRAS)}</td>
                            <td className="num">{(() => {
                              // Honorar + Zuschl. wird in der Vor-Spalte als node.REVENUE
                              // angezeigt (gilt für Leaves wie Parents). Nebenkosten je
                              // nach Ebene aus aggMap oder direkt aus node.EXTRAS.
                              const rev = Number(node.REVENUE ?? 0)
                              const ext = isParent ? (aggMap.get(String(node.STRUCTURE_ID))?.extras ?? 0) : Number(node.EXTRAS ?? 0)
                              return fmtEur(rev + ext)
                            })()}</td>
                            <td style={{ textAlign: 'center' }}>
                              <input
                                type="checkbox"
                                checked={node.IS_INTERNAL ?? false}
                                title={node.IS_INTERNAL ? 'Interne Position — klicken zum Aufheben' : 'Als interne Position markieren'}
                                disabled={internalMut.isPending}
                                onChange={() => internalMut.mutate({ id: node.STRUCTURE_ID, val: !node.IS_INTERNAL })}
                                style={{ width: 16, height: 16, cursor: 'pointer' }}
                              />
                            </td>
                            <td>
                              <button className="row-action-btn" style={{ color: '#dc2626', borderColor: '#dc2626' }}
                                disabled={deleteMut.isPending}
                                title="Element löschen"
                                onClick={() => setConfirmState({
                                  title: 'Element löschen',
                                  message: `Element „${nameShort}" und alle Kind-Elemente löschen?`,
                                  onConfirm: () => deleteMut.mutate(node.STRUCTURE_ID),
                                })}
                              ><Trash2 size={14} strokeWidth={2} /></button>
                            </td>
                          </tr>
                          {surchargePanel === node.STRUCTURE_ID && (
                            <tr className="surcharge-panel-row">
                              <td colSpan={13}>
                                <div className="surcharge-panel">
                                  <div className="surcharge-panel-basis">
                                    Basis (Honorar): <strong>{fmtEur(surchargeBase)}</strong>
                                  </div>
                                  <div className="surcharge-grid">
                                    <div className="surcharge-grid-header">
                                      <span>Kumul.</span>
                                      <span>Bezeichnung</span>
                                      <span style={{ textAlign: 'right' }}>%</span>
                                      <span style={{ textAlign: 'right' }}>Betrag</span>
                                    </div>
                                    {([
                                      {
                                        label: sEdit.s1Label, pct: sEdit.s1Pct, cumul: sEdit.s1Cumul, eur: computed.s1Eur,
                                        disableCumul: true, placeholder: 'z.B. GP-Zuschlag',
                                        onChange: (f: Partial<SurchargeEdit>) => setSurchargeEdits(prev => ({ ...prev, [node.STRUCTURE_ID]: { ...(prev[node.STRUCTURE_ID] ?? surchargeDefault(node)), ...f } })),
                                        labelKey: 's1Label' as const, pctKey: 's1Pct' as const, cumulKey: 's1Cumul' as const,
                                      },
                                      {
                                        label: sEdit.s2Label, pct: sEdit.s2Pct, cumul: sEdit.s2Cumul, eur: computed.s2Eur,
                                        disableCumul: false, placeholder: '(leer = inaktiv)',
                                        onChange: (f: Partial<SurchargeEdit>) => setSurchargeEdits(prev => ({ ...prev, [node.STRUCTURE_ID]: { ...(prev[node.STRUCTURE_ID] ?? surchargeDefault(node)), ...f } })),
                                        labelKey: 's2Label' as const, pctKey: 's2Pct' as const, cumulKey: 's2Cumul' as const,
                                      },
                                      {
                                        label: sEdit.s3Label, pct: sEdit.s3Pct, cumul: sEdit.s3Cumul, eur: computed.s3Eur,
                                        disableCumul: false, placeholder: '(leer = inaktiv)',
                                        onChange: (f: Partial<SurchargeEdit>) => setSurchargeEdits(prev => ({ ...prev, [node.STRUCTURE_ID]: { ...(prev[node.STRUCTURE_ID] ?? surchargeDefault(node)), ...f } })),
                                        labelKey: 's3Label' as const, pctKey: 's3Pct' as const, cumulKey: 's3Cumul' as const,
                                      },
                                    ] as const).map((row, i) => (
                                      <div className="surcharge-grid-row" key={i}>
                                        <input type="checkbox" checked={row.cumul} disabled={row.disableCumul}
                                          title={row.disableCumul ? 'Erster Zuschlag bezieht sich immer auf die Basis' : 'Kumulativ (auf laufende Zwischensumme)'}
                                          onChange={e => row.onChange({ [row.cumulKey]: e.target.checked })} />
                                        <input className="tbl-input" placeholder={row.placeholder}
                                          value={row.label}
                                          onChange={e => row.onChange({ [row.labelKey]: e.target.value })} />
                                        <input className="tbl-input" type="number" min={-100} max={500} step={0.1}
                                          style={{ width: 64, textAlign: 'right' }}
                                          value={row.pct}
                                          onChange={e => row.onChange({ [row.pctKey]: e.target.value })} />
                                        <span className="surcharge-eur">{row.label || row.pct ? fmtEur(row.eur) : '—'}</span>
                                      </div>
                                    ))}
                                    <div className="surcharge-grid-total">
                                      Gesamt Zuschläge: <strong>{fmtEur(computed.total)}</strong>
                                    </div>
                                  </div>
                                  <div className="surcharge-panel-actions">
                                    <button className="btn-small" onClick={() => closeSurchargePanel(node.STRUCTURE_ID)}>
                                      {surchargeMut.isPending ? 'Speichert …' : 'Schließen (speichert automatisch)'}
                                    </button>
                                  </div>
                                </div>
                              </td>
                            </tr>
                          )}
                          </React.Fragment>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}

              {flatTree.length === 0 && !addForm && (
                <p className="empty-note">Keine Projektstruktur gefunden.</p>
              )}

              <div className="structure-actions">
                <button className="btn-primary" type="button"
                  onClick={saveAll}
                  disabled={saveMut.isPending}>
                  {saveMut.isPending ? 'Speichert …' : 'Speichern (Strg+S)'}
                </button>
                <button type="button" onClick={() => { setSaveMsg(null); setAddForm(emptyAdd()) }}>
                  + Neues Element
                </button>
              </div>
              <Message text={saveMsg?.text ?? null} type={saveMsg?.type} />
            </>
          )}
        </>
      )}
    {/* ── Add element modal ── */}
    <Modal open={addForm !== null} onClose={() => { setAddForm(null); setSaveMsg(null) }} title="Neues Element anlegen">
      {addForm && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <div className="form-group" style={{ margin: 0 }}>
              <label style={{ fontSize: 11 }}>Kürzel*</label>
              <input style={{ width: 80 }} value={addForm.NAME_SHORT}
                onChange={e => setAddForm(f => f && { ...f, NAME_SHORT: e.target.value })} />
            </div>
            <div className="form-group" style={{ margin: 0 }}>
              <label style={{ fontSize: 11 }}>Bezeichnung</label>
              <input style={{ width: 160 }} value={addForm.NAME_LONG}
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
          </div>
          <Message text={saveMsg?.text ?? null} type={saveMsg?.type} />
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn-primary btn-small" type="button" onClick={submitAdd} disabled={addMut.isPending}>
              {addMut.isPending ? '…' : 'Speichern (Strg+S)'}
            </button>
            <button className="btn-small" type="button" onClick={() => { setAddForm(null); setSaveMsg(null) }}>
              Abbrechen
            </button>
          </div>
        </div>
      )}
    </Modal>

    <ConfirmModal
      open={confirmState !== null}
      title={confirmState?.title ?? ''}
      message={confirmState?.message ?? ''}
      confirmLabel="Löschen"
      confirmClass="danger"
      onConfirm={() => { confirmState?.onConfirm(); setConfirmState(null) }}
      onCancel={() => setConfirmState(null)}
    />
    <Modal open={kalkFatherId !== null} onClose={() => setKalkFatherId(null)} title="HOAI-Kalkulation anlegen" className="modal-xl">
      {kalkFatherId !== null && selectedPid && (
        <HonorarWizard
          initialProjectId={selectedPid}
          initialFatherId={kalkFatherId}
          onDone={() => {
            setKalkFatherId(null)
            void qc.invalidateQueries({ queryKey: ['structure', selectedPid] })
          }}
        />
      )}
    </Modal>
    {contextMenu && (() => {
      const cmNode = contextMenu.nodeId != null ? structure.find(n => n.STRUCTURE_ID === contextMenu.nodeId) : undefined
      const cmName = cmNode?.NAME_SHORT ?? ''
      const isMultiDelete = contextMenu.nodeId != null && selectedIds.has(contextMenu.nodeId) && selectedIds.size > 1
      const style: React.CSSProperties = contextMenu.x === 0
        ? { position: 'fixed', top: '40%', left: '50%', transform: 'translate(-50%,-50%)', zIndex: 1500 }
        : { position: 'fixed', top: contextMenu.y, left: contextMenu.x, zIndex: 1500 }
      return (
        <div className="struct-context-menu" ref={contextMenuRef} style={style}>
          <button onClick={() => {
            const fNode = contextMenu.nodeId != null ? structure.find(n => n.STRUCTURE_ID === contextMenu.nodeId) : undefined
            setAddForm({
              ...emptyAdd(),
              FATHER_ID:       contextMenu.nodeId != null ? String(contextMenu.nodeId) : '',
              BILLING_TYPE_ID: fNode ? String(fNode.BILLING_TYPE_ID ?? '') : '',
              EXTRAS_PERCENT:  fNode ? String(fNode.EXTRAS_PERCENT  ?? '') : '',
            })
            setContextMenu(null)
          }}>Element anlegen</button>
          <button disabled style={{ opacity: 0.4 }}>Vorlage anlegen</button>
          {contextMenu.nodeId != null ? (
            <button onClick={() => { setSurchargePanel(contextMenu.nodeId as number); setContextMenu(null) }}>
              Zuschlag hinzufügen
            </button>
          ) : (
            <button onClick={() => {
              setProjectSurchargeEdit(projectSurchargeDefault())
              setProjectSurchargePanel(true)
              setContextMenu(null)
            }}>
              Projektzuschlag hinzufügen
            </button>
          )}
          {contextMenu.nodeId != null && (
            <button onClick={() => { setKalkFatherId(contextMenu.nodeId as number); setContextMenu(null) }}>
              Kalkulation anlegen
            </button>
          )}
          {(cmNode || isMultiDelete) && <div className="struct-context-divider" />}
          {isMultiDelete ? (
            <button className="struct-context-danger" onClick={() => {
              const ids = Array.from(selectedIds)
              setConfirmState({
                title: `${ids.length} Elemente löschen`,
                message: `${ids.length} Elemente löschen?\nHinweis: Nur möglich wenn keine Buchungen/Rechnungen darauf verweisen.`,
                onConfirm: () => void doBulkDelete(ids),
              })
              setContextMenu(null)
            }}>{selectedIds.size} Elemente löschen</button>
          ) : cmNode ? (
            <button className="struct-context-danger" onClick={() => {
              setConfirmState({
                title: 'Element löschen',
                message: `Element „${cmName}" und alle Kind-Elemente löschen?`,
                onConfirm: () => deleteMut.mutate(cmNode.STRUCTURE_ID),
              })
              setContextMenu(null)
            }}>Element löschen</button>
          ) : null}
        </div>
      )
    })()}
    </div>
  )
}
