import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { X, Percent } from 'lucide-react'
import { Message }      from '@/components/ui/Message'
import { Modal }        from '@/components/ui/Modal'
import { ConfirmModal } from '@/components/ui/ConfirmModal'
import { HonorarWizard } from '@/pages/projekte/HonorarWizard'
import {
  fetchOffer, fetchOffers, fetchOfferStructure, addOfferStructureNode, updateOfferStructureNode,
  deleteOfferStructureNode, moveOfferStructureNode, updateOfferStructureSurcharges,
  patchOfferRootSurcharges, openOfferPdf,
  type OfferStructureNode,
} from '@/api/angebote'
import { fetchBillingTypes } from '@/api/projekte'
import { buildStructureTree, flattenTree } from '@/utils/treeUtils'
import type { StructureNode } from '@/api/projekte'

const FMT_EUR = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2, maximumFractionDigits: 2 })
const fmtEur  = (v: number | null | undefined) => v == null ? '—' : FMT_EUR.format(v)

type RowEdit = { nameShort: string; nameLong: string; billingTypeId: string; nk: string; budget: string }
type AddForm = { NAME_SHORT: string; NAME_LONG: string; BILLING_TYPE_ID: string; FATHER_ID: string; REVENUE: string; EXTRAS_PERCENT: string }
type SurchargeEdit = {
  s1Label: string; s1Pct: string; s1Cumul: boolean
  s2Label: string; s2Pct: string; s2Cumul: boolean
  s3Label: string; s3Pct: string; s3Cumul: boolean
}

function emptyAdd(): AddForm {
  return { NAME_SHORT: '', NAME_LONG: '', BILLING_TYPE_ID: '', FATHER_ID: '', REVENUE: '', EXTRAS_PERCENT: '' }
}

interface Props { initialOfferId?: number; onOfferChange?: (id: number | null) => void }

export function AngeboteStruktur({ initialOfferId, onOfferChange }: Props) {
  const qc = useQueryClient()
  const oid = initialOfferId ?? null

  const [edits, setEdits]               = useState<Record<number, RowEdit>>({})
  const [selectedIds, setSelectedIds]   = useState<Set<number>>(new Set())
  const [dragIds, setDragIds]           = useState<Set<number>>(new Set())
  const [dragOverId, setDragOverId]     = useState<number | null | 'root'>(null)
  const [dragZone, setDragZone]         = useState<'above' | 'on'>('on')
  const [saveMsg, setSaveMsg]           = useState<{ text: string; type: 'success'|'error' } | null>(null)
  const [addForm, setAddForm]           = useState<AddForm | null>(null)
  const [confirmState, setConfirmState] = useState<{ title: string; message: string; onConfirm: () => void } | null>(null)
  const [surchargePanel, setSurchargePanel] = useState<number | null>(null)
  const [contextMenu, setContextMenu]   = useState<{ x: number; y: number; nodeId: number | null } | null>(null)
  const [kalkFatherId, setKalkFatherId]             = useState<number | null>(null)
  const [offerInput, setOfferInput]                 = useState('')
  const [offerDropdownOpen, setOfferDropdownOpen]   = useState(false)
  const [offerSurchargePanel, setOfferSurchargePanel] = useState<boolean>(false)
  const [offerSurchargeEdit,  setOfferSurchargeEdit]  = useState<SurchargeEdit | null>(null)
  const contextMenuRef                              = useRef<HTMLDivElement>(null)
  const offerAcRef                                  = useRef<HTMLDivElement>(null)
  const [surchargeEdits, setSurchargeEdits] = useState<Record<number, SurchargeEdit>>({})
  const [elementSearch, setElementSearch]   = useState('')

  const tbodyRef     = useRef<HTMLTableSectionElement>(null)
  const rootZoneRef  = useRef<HTMLDivElement>(null)
  const pointerDragRef = useRef<{ id: number; idsToMove: number[]; active: boolean; zone: 'above'|'on'; targetId: number|null } | null>(null)
  const flatTreeRef    = useRef<typeof flatTree>([])
  const selectedIdsRef = useRef<Set<number>>(new Set())
  const parentMapRef   = useRef<Map<string, string|null>>(new Map())

  const { data: offersData } = useQuery({ queryKey: ['offers'], queryFn: fetchOffers })
  const { data: structData, isLoading } = useQuery({
    queryKey: ['offer-structure', oid],
    queryFn:  () => fetchOfferStructure(oid!),
    enabled:  oid !== null,
  })
  const { data: btData } = useQuery({ queryKey: ['billing-types'], queryFn: fetchBillingTypes })

  const offers = offersData?.data ?? []

  const { data: offerDetailData } = useQuery({
    queryKey: ['offer-detail', oid],
    queryFn:  () => fetchOffer(oid!),
    enabled:  oid !== null,
  })
  const offerDetail = offerDetailData?.data ?? null

  const structure = structData?.data ?? []
  const btypes    = btData?.data     ?? []

  useEffect(() => { setEdits({}); setAddForm(null); setSelectedIds(new Set()) }, [oid])

  // Sync offer input display when oid or offers change
  useEffect(() => {
    if (oid && offers.length > 0) {
      const o = offers.find(x => x.ID === oid)
      if (o) setOfferInput(o.NAME_SHORT + (o.NAME_LONG ? ` – ${o.NAME_LONG}` : ''))
    } else if (!oid) {
      setOfferInput('')
    }
  }, [oid, offers])

  // Close offer autocomplete on outside click, restore display name
  useEffect(() => {
    if (!offerDropdownOpen) return
    function onDown(e: MouseEvent) {
      if (offerAcRef.current && !offerAcRef.current.contains(e.target as Node)) {
        setOfferDropdownOpen(false)
        if (oid) {
          const o = offers.find(x => x.ID === oid)
          if (o) setOfferInput(o.NAME_SHORT + (o.NAME_LONG ? ` – ${o.NAME_LONG}` : ''))
        }
      }
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [offerDropdownOpen, oid, offers])

  useEffect(() => {
    if (!contextMenu) return
    function onDown(e: MouseEvent) {
      if (contextMenuRef.current && !contextMenuRef.current.contains(e.target as Node))
        setContextMenu(null)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [contextMenu])

  const flatTree = structure.length
    ? flattenTree(buildStructureTree(structure.map(n => ({ ...n, STRUCTURE_ID: n.ID })) as unknown as StructureNode[]))
    : []
  const parentIds = new Set(structure.filter(n => n.FATHER_ID != null).map(n => String(n.FATHER_ID)))
  const parentMap = new Map(structure.map(n => [String(n.ID), n.FATHER_ID != null ? String(n.FATHER_ID) : null]))

  const aggMap = useMemo(() => {
    const childrenOf = new Map<string, string[]>()
    for (const n of structure) {
      if (n.FATHER_ID != null) {
        const fid = String(n.FATHER_ID)
        const arr = childrenOf.get(fid) ?? []
        arr.push(String(n.ID))
        childrenOf.set(fid, arr)
      }
    }
    const nodeMap = new Map(structure.map(n => [String(n.ID), n]))
    const cache = new Map<string, { surcharges: number; revenueBasis: number; extras: number }>()
    function agg(id: string): { surcharges: number; revenueBasis: number; extras: number } {
      if (cache.has(id)) return cache.get(id)!
      const children = childrenOf.get(id) ?? []
      if (children.length === 0) {
        const node = nodeMap.get(id)!
        const rb = node?.REVENUE_BASIS != null
          ? Number(node.REVENUE_BASIS)
          : Math.max(0, Number(node?.REVENUE ?? 0) - Number(node?.SURCHARGES_TOTAL ?? 0))
        const r = { surcharges: Number(node?.SURCHARGES_TOTAL ?? 0), revenueBasis: rb, extras: Number(node?.EXTRAS ?? 0) }
        cache.set(id, r); return r
      }
      let surcharges = 0, revenueBasis = 0, extras = 0
      for (const cid of children) { const c = agg(cid); surcharges += c.surcharges; revenueBasis += c.revenueBasis; extras += c.extras }
      surcharges += Number(nodeMap.get(id)?.SURCHARGES_TOTAL ?? 0)
      cache.set(id, { surcharges, revenueBasis, extras }); return { surcharges, revenueBasis, extras }
    }
    for (const n of structure) agg(String(n.ID))
    return cache
  }, [structure])

  const filteredOffers = useMemo(() => {
    if (!offerDropdownOpen) return offers
    const sq = offerInput.toLowerCase().trim()
    if (!sq) return offers
    return offers.filter(o =>
      (o.NAME_SHORT?.toLowerCase().includes(sq)) ||
      (o.NAME_LONG?.toLowerCase().includes(sq))
    )
  }, [offers, offerInput, offerDropdownOpen])

  const filteredFlatTree = useMemo(() => {
    if (!elementSearch) return flatTree
    const sq = elementSearch.toLowerCase()
    const matchIds = new Set(
      flatTree.filter(({ node }) =>
        (node.NAME_SHORT?.toLowerCase().includes(sq)) ||
        (node.NAME_LONG?.toLowerCase().includes(sq))
      ).map(({ node }) => (node as unknown as OfferStructureNode).ID)
    )
    for (const id of [...matchIds]) {
      let cursor = parentMap.get(String(id))
      while (cursor != null) { matchIds.add(Number(cursor)); cursor = parentMap.get(cursor) }
    }
    return flatTree.filter(({ node }) => matchIds.has((node as unknown as OfferStructureNode).ID))
  }, [flatTree, elementSearch, parentMap])

  // Root totals
  const rootRevenueBasis  = useMemo(() => structure.filter(n => n.FATHER_ID == null).reduce((s, n) => {
    const isP = parentIds.has(String(n.ID))
    return s + (isP ? (aggMap.get(String(n.ID))?.revenueBasis ?? 0) : (n.REVENUE_BASIS != null ? Number(n.REVENUE_BASIS) : Number(n.REVENUE ?? 0)))
  }, 0), [structure, aggMap, parentIds])
  const structureSurcharges = useMemo(() => structure.reduce((s, n) => s + Number(n.SURCHARGES_TOTAL ?? 0), 0), [structure])
  const offerLevelSurcharges = Number(offerDetail?.SURCHARGES_TOTAL ?? 0)
  const rootSurcharges = structureSurcharges + offerLevelSurcharges
  const rootStructureRevenueSum = useMemo(() => structure.filter(n => n.FATHER_ID == null).reduce((s, n) => s + Number(n.REVENUE ?? 0), 0), [structure])
  const rootRevenueFinal  = rootStructureRevenueSum + offerLevelSurcharges
  const rootExtras        = useMemo(() => structure.filter(n => n.FATHER_ID == null).reduce((s, n) => {
    const isP = parentIds.has(String(n.ID))
    return s + (isP ? (aggMap.get(String(n.ID))?.extras ?? 0) : Number(n.EXTRAS ?? 0))
  }, 0), [structure, aggMap, parentIds])

  // ── Surcharge helpers ────────────────────────────────────────────────────

  function surchargeDefault(n: OfferStructureNode): SurchargeEdit {
    return {
      s1Label: n.SURCHARGE_1_LABEL ?? '', s1Pct: n.SURCHARGE_1_PCT != null ? String(n.SURCHARGE_1_PCT) : '', s1Cumul: n.SURCHARGE_1_CUMUL ?? true,
      s2Label: n.SURCHARGE_2_LABEL ?? '', s2Pct: n.SURCHARGE_2_PCT != null ? String(n.SURCHARGE_2_PCT) : '', s2Cumul: n.SURCHARGE_2_CUMUL ?? true,
      s3Label: n.SURCHARGE_3_LABEL ?? '', s3Pct: n.SURCHARGE_3_PCT != null ? String(n.SURCHARGE_3_PCT) : '', s3Cumul: n.SURCHARGE_3_CUMUL ?? true,
    }
  }

  function computeSurchargesDisplay(base: number, s: SurchargeEdit) {
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

  // ── Mutations ────────────────────────────────────────────────────────────

  const saveMut = useMutation({
    mutationFn: async (rows: Array<{ id: number; nameShort: string; nameLong: string; billingTypeId: string; nk: number; budget: number; changed: Record<string,boolean> }>) => {
      for (const r of rows) {
        const body: Record<string, unknown> = {}
        if (r.changed.nameShort)     body.name_short      = r.nameShort
        if (r.changed.nameLong)      body.name_long       = r.nameLong
        if (r.changed.billingTypeId) body.billing_type_id = Number(r.billingTypeId)
        if (r.changed.nk)            body.extras_percent  = r.nk
        if (r.changed.budget)        body.revenue         = r.budget
        await updateOfferStructureNode(oid!, r.id, body)
      }
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['offer-structure', oid] })
      setSaveMsg({ text: 'Gespeichert ✅', type: 'success' })
      setEdits({})
      setTimeout(() => setSaveMsg(null), 3000)
    },
    onError: (e: Error) => setSaveMsg({ text: e.message, type: 'error' }),
  })

  const surchargeMut = useMutation({
    mutationFn: ({ id, s }: { id: number; s: SurchargeEdit }) =>
      updateOfferStructureSurcharges(oid!, id, {
        SURCHARGE_1_LABEL: s.s1Label || null, SURCHARGE_1_PCT: s.s1Pct !== '' ? Number(s.s1Pct) : null, SURCHARGE_1_CUMUL: s.s1Cumul,
        SURCHARGE_2_LABEL: s.s2Label || null, SURCHARGE_2_PCT: s.s2Pct !== '' ? Number(s.s2Pct) : null, SURCHARGE_2_CUMUL: s.s2Cumul,
        SURCHARGE_3_LABEL: s.s3Label || null, SURCHARGE_3_PCT: s.s3Pct !== '' ? Number(s.s3Pct) : null, SURCHARGE_3_CUMUL: s.s3Cumul,
      }),
    onSuccess: (_, { id }) => {
      void qc.invalidateQueries({ queryKey: ['offer-structure', oid] })
      setSurchargeEdits(prev => { const n = { ...prev }; delete n[id]; return n })
    },
    onError: (e: Error) => setSaveMsg({ text: e.message, type: 'error' }),
  })

  function closeSurchargePanel(nodeId: number) {
    const pending = surchargeEdits[nodeId]
    if (pending) surchargeMut.mutate({ id: nodeId, s: pending })
    setSurchargePanel(null)
  }

  // Offer-level (root) surcharge mutation — Option A
  const offerSurchargeMut = useMutation({
    mutationFn: (s: SurchargeEdit) =>
      patchOfferRootSurcharges(oid!, {
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
      void qc.invalidateQueries({ queryKey: ['offer-detail', oid] })
      setOfferSurchargeEdit(null)
      setSaveMsg({ text: 'Angebotszuschläge gespeichert ✅', type: 'success' })
      setTimeout(() => setSaveMsg(null), 3000)
    },
    onError: (e: Error) => setSaveMsg({ text: e.message, type: 'error' }),
  })

  function closeOfferSurchargePanel() {
    if (offerSurchargeEdit) offerSurchargeMut.mutate(offerSurchargeEdit)
    setOfferSurchargePanel(false)
  }

  function offerSurchargeDefault(): SurchargeEdit {
    const o = offerDetail
    return {
      s1Label: o?.SURCHARGE_1_LABEL ?? '',
      s1Pct:   o?.SURCHARGE_1_PCT != null ? String(o.SURCHARGE_1_PCT) : '',
      s1Cumul: o?.SURCHARGE_1_CUMUL ?? true,
      s2Label: o?.SURCHARGE_2_LABEL ?? '',
      s2Pct:   o?.SURCHARGE_2_PCT != null ? String(o.SURCHARGE_2_PCT) : '',
      s2Cumul: o?.SURCHARGE_2_CUMUL ?? true,
      s3Label: o?.SURCHARGE_3_LABEL ?? '',
      s3Pct:   o?.SURCHARGE_3_PCT != null ? String(o.SURCHARGE_3_PCT) : '',
      s3Cumul: o?.SURCHARGE_3_CUMUL ?? true,
    }
  }

  const addMut = useMutation({
    mutationFn: (f: AddForm) => addOfferStructureNode(oid!, {
      name_short:      f.NAME_SHORT.trim(),
      name_long:       f.NAME_LONG.trim() || undefined,
      billing_type_id: Number(f.BILLING_TYPE_ID),
      father_id:       f.FATHER_ID ? Number(f.FATHER_ID) : null,
      revenue:         f.REVENUE !== '' ? Number(f.REVENUE) : undefined,
      extras_percent:  f.EXTRAS_PERCENT !== '' ? Number(f.EXTRAS_PERCENT) : undefined,
    }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['offer-structure', oid] })
      setSaveMsg({ text: 'Element angelegt ✅', type: 'success' })
      setAddForm(null)
      setTimeout(() => setSaveMsg(null), 3000)
    },
    onError: (e: Error) => setSaveMsg({ text: e.message, type: 'error' }),
  })

  const deleteMut = useMutation({
    mutationFn: (id: number) => deleteOfferStructureNode(oid!, id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['offer-structure', oid] })
      setSaveMsg({ text: 'Element gelöscht ✅', type: 'success' })
      setTimeout(() => setSaveMsg(null), 3000)
    },
    onError: (e: Error) => setSaveMsg({ text: e.message, type: 'error' }),
  })

  const moveMut = useMutation({
    mutationFn: ({ id, fatherId, sortAfterId }: { id: number; fatherId: number|null; sortAfterId: string|null }) =>
      moveOfferStructureNode(oid!, id, { father_id: fatherId, sort_after_id: sortAfterId }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['offer-structure', oid] }),
    onError: (e: Error) => setSaveMsg({ text: e.message, type: 'error' }),
  })

  // ── Inline edit helpers ──────────────────────────────────────────────────

  function nodeDefault(id: number): RowEdit {
    const node = structure.find(n => n.ID === id)
    const isHourly = Number(node?.BILLING_TYPE_ID) === 2
    return {
      nameShort:    node?.NAME_SHORT ?? '',
      nameLong:     node?.NAME_LONG  ?? '',
      billingTypeId: String(node?.BILLING_TYPE_ID ?? ''),
      nk:     String(node?.EXTRAS_PERCENT ?? 0),
      budget: isHourly ? '' : String(node?.REVENUE_BASIS ?? node?.REVENUE ?? 0),
    }
  }

  function setField(id: number, field: keyof RowEdit, value: string) {
    setEdits(prev => {
      const cur = prev[id] ?? nodeDefault(id)
      return { ...prev, [id]: { ...cur, [field]: value } }
    })
  }

  // ── Save all ─────────────────────────────────────────────────────────────

  const saveAll = useCallback(() => {
    setSaveMsg(null)
    const rows = Object.entries(edits).map(([idStr, edit]) => {
      const id   = Number(idStr)
      const node = structure.find(n => n.ID === id)
      const origNS  = node?.NAME_SHORT    ?? ''
      const origNL  = node?.NAME_LONG     ?? ''
      const origBT  = String(node?.BILLING_TYPE_ID ?? '')
      const origNk  = node?.EXTRAS_PERCENT ?? 0
      const origBudget = node?.REVENUE_BASIS ?? node?.REVENUE ?? 0
      const nk     = edit.nk     !== '' ? Number(edit.nk)     : origNk
      const budget = edit.budget !== '' ? Number(edit.budget) : origBudget
      return {
        id, nameShort: edit.nameShort ?? origNS, nameLong: edit.nameLong ?? origNL,
        billingTypeId: edit.billingTypeId ?? origBT, nk, budget,
        changed: {
          nameShort:    (edit.nameShort    ?? origNS)  !== origNS,
          nameLong:     (edit.nameLong     ?? origNL)  !== origNL,
          billingTypeId: (edit.billingTypeId ?? origBT) !== origBT,
          nk:            nk     !== origNk,
          budget:        budget !== origBudget,
        },
      }
    }).filter(r => Object.values(r.changed).some(Boolean))
    if (!rows.length) { setSaveMsg({ text: 'Keine Änderungen', type: 'error' }); return }
    saveMut.mutate(rows)
  }, [edits, structure, saveMut])

  // ── Keyboard shortcut ────────────────────────────────────────────────────

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); if (addForm) submitAdd(); else saveAll() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [addForm, saveAll])

  // ── Add element ──────────────────────────────────────────────────────────

  function submitAdd() {
    if (!addForm) return
    if (!addForm.NAME_SHORT.trim()) { setSaveMsg({ text: 'Kürzel ist erforderlich', type: 'error' }); return }
    if (!addForm.BILLING_TYPE_ID)  { setSaveMsg({ text: 'Abrechnungsart ist erforderlich', type: 'error' }); return }
    setSaveMsg(null)
    addMut.mutate(addForm)
  }

  // ── Multi-select ─────────────────────────────────────────────────────────

  function toggleRow(id: number) {
    setSelectedIds(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n })
  }
  function toggleAll() {
    const allIds = filteredFlatTree.map(({ node }) => (node as unknown as OfferStructureNode).ID)
    if (allIds.every(id => selectedIds.has(id))) setSelectedIds(new Set())
    else setSelectedIds(new Set(allIds))
  }
  const allSelected = filteredFlatTree.length > 0 && filteredFlatTree.every(({ node }) => selectedIds.has((node as unknown as OfferStructureNode).ID))

  async function doBulkDelete(ids: number[]) {
    if (!ids.length) return
    setSaveMsg(null)
    let failed = 0
    for (const id of ids) {
      try { await deleteOfferStructureNode(oid!, id) } catch { failed++ }
    }
    void qc.invalidateQueries({ queryKey: ['offer-structure', oid] })
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
      message: `${ids.length} Element${ids.length > 1 ? 'e' : ''} löschen?`,
      onConfirm: () => void doBulkDelete(ids),
    })
  }

  // ── Drag & Drop ──────────────────────────────────────────────────────────

  flatTreeRef.current    = flatTree
  selectedIdsRef.current = selectedIds
  parentMapRef.current   = parentMap

  function isDescendant(targetId: string, srcId: string, pMap: Map<string, string|null>): boolean {
    let cursor: string|null|undefined = pMap.get(String(targetId))
    while (cursor != null) { if (cursor === String(srcId)) return true; cursor = pMap.get(cursor) }
    return false
  }

  function handleHandlePointerDown(e: React.PointerEvent, id: number) {
    e.preventDefault()
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    const sel = selectedIdsRef.current
    const idsToMove = sel.has(id) && sel.size > 1 ? [...sel] : [id]
    pointerDragRef.current = { id, idsToMove, active: false, zone: 'on', targetId: null }

    function onMove(ev: PointerEvent) {
      const state = pointerDragRef.current
      if (!state) return
      if (!state.active) { state.active = true; setDragIds(new Set(idsToMove)) }
      const el = document.elementFromPoint(ev.clientX, ev.clientY) as HTMLElement|null
      const rootZone = el?.closest('.struct-root-drop')
      const tr = el?.closest('tr[data-struct-id]') as HTMLElement|null
      if (rootZone) {
        state.targetId = null; state.zone = 'on'
        setDragOverId('root'); setDragZone('on')
      } else if (tr) {
        const targetId = Number(tr.dataset.structId)
        const blocked = idsToMove.some(srcId =>
          String(targetId) === String(srcId) || isDescendant(String(targetId), String(srcId), parentMapRef.current)
        )
        if (!blocked) {
          const rect = tr.getBoundingClientRect()
          const zone: 'above'|'on' = ev.clientY < rect.top + rect.height * 0.35 ? 'above' : 'on'
          state.targetId = targetId; state.zone = zone
          setDragOverId(targetId); setDragZone(zone)
        }
      } else {
        state.targetId = null
        setDragOverId(null)
      }
    }

    function onUp() {
      const state = pointerDragRef.current
      pointerDragRef.current = null
      setDragIds(new Set()); setDragOverId(null)
      if (!state?.active) return
      const { idsToMove: ids, targetId, zone } = state

      if (targetId === null) {
        // Drop to root
        for (const mid of ids) moveMut.mutate({ id: mid, fatherId: null, sortAfterId: '__end__' })
        return
      }
      const targetNode = flatTreeRef.current.find(({ node }) => (node as unknown as OfferStructureNode).ID === targetId)
      if (!targetNode) return
      const targetN = targetNode.node as unknown as OfferStructureNode
      if (zone === 'on') {
        for (const mid of ids) moveMut.mutate({ id: mid, fatherId: targetN.ID, sortAfterId: '__end__' })
      } else {
        // Insert above target: same parent, before target
        const tFather = targetN.FATHER_ID ?? null
        const siblings = flatTreeRef.current
          .filter(({ node }) => {
            const n = node as unknown as OfferStructureNode
            return (n.FATHER_ID ?? null) === tFather && !ids.includes(n.ID)
          })
        const idx = siblings.findIndex(({ node }) => (node as unknown as OfferStructureNode).ID === targetId)
        const sortAfterId = idx > 0 ? String((siblings[idx - 1].node as unknown as OfferStructureNode).ID) : null
        for (const mid of ids) moveMut.mutate({ id: mid, fatherId: tFather, sortAfterId })
      }
    }

    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp, { once: true })
    const cleanup = () => { window.removeEventListener('pointermove', onMove) }
    window.addEventListener('pointerup', cleanup, { once: true })
  }

  // ── Render guard ─────────────────────────────────────────────────────────

  return (
    <>
    <div className="ls-wrap">
      {/* ── Offer selector + PDF button ── */}
      <div className="ls-toolbar" style={{ marginBottom: 12 }}>
        <label className="ls-label">Angebot</label>
        <div ref={offerAcRef} className="project-ac-wrap" style={{ flex: 1, maxWidth: 380, position: 'relative' }}>
          <input
            className="ls-select"
            style={{ width: '100%' }}
            placeholder="— Angebot wählen —"
            value={offerInput}
            onFocus={() => setOfferDropdownOpen(true)}
            onChange={e => { setOfferInput(e.target.value); setOfferDropdownOpen(true) }}
          />
          {offerDropdownOpen && (
            <div className="project-ac-dropdown">
              {filteredOffers.length === 0 && (
                <div className="project-ac-option" style={{ color: '#6b7280', fontStyle: 'italic' }}>Keine Treffer</div>
              )}
              {filteredOffers.map(o => (
                <div key={o.ID} className="project-ac-option"
                  onMouseDown={e => {
                    e.preventDefault()
                    setOfferInput(o.NAME_SHORT + (o.NAME_LONG ? ` – ${o.NAME_LONG}` : ''))
                    setOfferDropdownOpen(false)
                    onOfferChange?.(o.ID)
                  }}>
                  <span className="project-ac-short">{o.NAME_SHORT}</span>
                  {o.NAME_LONG && <span className="project-ac-long">{o.NAME_LONG}</span>}
                </div>
              ))}
            </div>
          )}
        </div>
        {oid && (
          <button className="btn-small" onClick={() => openOfferPdf(oid)} title="PDF öffnen">PDF</button>
        )}
      </div>

      {oid && !isLoading && (
        <>
          {selectedIds.size > 0 && (
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
              <button className="btn-small" style={{ color: '#e74c3c', borderColor: '#e74c3c' }} onClick={bulkDelete}>
                Löschen ({selectedIds.size})
              </button>
              <button className="btn-small" onClick={() => setSelectedIds(new Set())}>Auswahl aufheben</button>
            </div>
          )}

          {dragIds.size > 0 && (
            <div ref={rootZoneRef} className={`struct-root-drop${dragOverId === 'root' ? ' drag-over' : ''}`}>
              Hier ablegen → Root-Element
            </div>
          )}

          {flatTree.length > 0 && (
            <div className="list-section">
              <div style={{ marginBottom: 8 }}>
                <input type="search" className="list-search" placeholder="Elemente filtern …"
                  style={{ maxWidth: 260, fontSize: 13 }}
                  value={elementSearch} onChange={e => setElementSearch(e.target.value)} />
              </div>
              <table className="master-table structure-table">
                <thead>
                  <tr>
                    <th style={{ width: 28 }}>
                      <input type="checkbox" checked={allSelected} onChange={toggleAll} title="Alle auswählen" />
                    </th>
                    <th style={{ width: 24 }}></th>
                    <th>Kürzel</th>
                    <th>Bezeichnung</th>
                    <th>Abrechnung</th>
                    <th className="num">Honorar €</th>
                    <th className="num">Zuschläge €</th>
                    <th className="num">Honorar + Zuschl. €</th>
                    <th className="num">NK %</th>
                    <th className="num">Nebenkosten €</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody ref={tbodyRef}>
                  {/* Root totals row */}
                  {structure.length > 0 && (
                    <>
                    <tr style={{ fontWeight: 700, background: 'rgba(37,99,235,0.04)', borderBottom: '2px solid rgba(17,24,39,0.10)', cursor: 'context-menu' }}
                      onContextMenu={e => { e.preventDefault(); setContextMenu({ x: e.clientX, y: e.clientY, nodeId: null }) }}>
                      <td></td><td></td>
                      <td style={{ fontSize: 12, color: 'rgba(17,24,39,0.5)' }}>Gesamt</td>
                      <td></td>
                      <td><span style={{ color: 'rgba(17,24,39,0.3)', fontSize: 12 }}>—</span></td>
                      <td className="num"><span style={{ color: 'rgba(17,24,39,0.45)', fontSize: 12 }}>{fmtEur(rootRevenueBasis)}</span></td>
                      <td className="num"><span style={{ color: rootSurcharges > 0 ? '#16a34a' : 'rgba(17,24,39,0.25)', fontSize: 12 }}>{rootSurcharges > 0 ? fmtEur(rootSurcharges) : '—'}</span></td>
                      <td className="num"><span style={{ fontSize: 12, fontWeight: rootSurcharges > 0 ? 600 : undefined }}>{fmtEur(rootRevenueFinal)}</span></td>
                      <td className="num"><span style={{ color: 'rgba(17,24,39,0.3)', fontSize: 12 }}>—</span></td>
                      <td className="num"><span style={{ color: 'rgba(17,24,39,0.45)', fontSize: 12 }}>{fmtEur(rootExtras)}</span></td>
                      <td>
                        <button
                          className="row-action-btn"
                          title={offerLevelSurcharges > 0 ? `Angebotszuschläge (${fmtEur(offerLevelSurcharges)})` : 'Angebotszuschläge bearbeiten'}
                          style={offerLevelSurcharges > 0 ? { color: '#2563eb', borderColor: '#2563eb' } : { color: '#6b7280' }}
                          onClick={() => {
                            if (offerSurchargePanel) closeOfferSurchargePanel()
                            else { setOfferSurchargeEdit(offerSurchargeDefault()); setOfferSurchargePanel(true) }
                          }}
                        ><Percent size={13} strokeWidth={2} /></button>
                      </td>
                    </tr>
                    {offerSurchargePanel && offerSurchargeEdit && (() => {
                      const sE = offerSurchargeEdit
                      const computed = computeSurchargesDisplay(rootStructureRevenueSum, sE)
                      const setEdit = (f: Partial<SurchargeEdit>) => setOfferSurchargeEdit(prev => prev ? { ...prev, ...f } : prev)
                      return (
                        <tr className="surcharge-panel-row">
                          <td colSpan={11}>
                            <div className="surcharge-panel">
                              <div className="surcharge-panel-basis">
                                Angebotszuschläge – Basis (Summe Wurzel-Honorar): <strong>{fmtEur(rootStructureRevenueSum)}</strong>
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
                                  Gesamt Angebotszuschläge: <strong>{fmtEur(computed.total)}</strong>
                                </div>
                              </div>
                              <div className="surcharge-panel-actions">
                                <button className="btn-small" onClick={closeOfferSurchargePanel}>
                                  {offerSurchargeMut.isPending ? 'Speichert …' : 'Schließen (speichert automatisch)'}
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
                    const n        = node as unknown as OfferStructureNode
                    const edit     = edits[n.ID]
                    const isParent = parentIds.has(String(n.ID))
                    const isHourly = Number(edit?.billingTypeId ?? n.BILLING_TYPE_ID) === 2
                    const isDragOver = dragOverId === n.ID

                    const nameShort    = edit?.nameShort     ?? (n.NAME_SHORT ?? '')
                    const nameLong     = edit?.nameLong      ?? (n.NAME_LONG  ?? '')
                    const btId         = edit?.billingTypeId ?? String(n.BILLING_TYPE_ID ?? '')
                    const nkVal        = edit?.nk            ?? String(n.EXTRAS_PERCENT ?? 0)
                    const budgetVal    = edit?.budget        ?? String(n.REVENUE_BASIS ?? n.REVENUE ?? 0)

                    const hasSurcharges = (n.SURCHARGES_TOTAL ?? 0) > 0
                    const displayRevenueBasis = isParent
                      ? (aggMap.get(String(n.ID))?.revenueBasis ?? (n.REVENUE_BASIS != null ? Number(n.REVENUE_BASIS) : Number(n.REVENUE ?? 0)))
                      : (n.REVENUE_BASIS != null ? Number(n.REVENUE_BASIS) : Number(n.REVENUE ?? 0))
                    const displaySurcharges = isParent
                      ? (aggMap.get(String(n.ID))?.surcharges ?? (n.SURCHARGES_TOTAL ?? 0))
                      : (n.SURCHARGES_TOTAL ?? 0)
                    const displayExtras = isParent
                      ? (aggMap.get(String(n.ID))?.extras ?? Number(n.EXTRAS ?? 0))
                      : Number(n.EXTRAS ?? 0)

                    const sEdit        = surchargeEdits[n.ID] ?? surchargeDefault(n)
                    const surchargeBase = n.REVENUE_BASIS != null ? Number(n.REVENUE_BASIS) : Number(n.REVENUE ?? 0)
                    const computed     = computeSurchargesDisplay(surchargeBase, sEdit)

                    return (
                      <React.Fragment key={n.ID}>
                      <tr
                        data-struct-id={n.ID}
                        className={[
                          isParent ? 'struct-row-parent' : '',
                          isDragOver && dragZone === 'on'    ? 'ps-drag-over'  : '',
                          isDragOver && dragZone === 'above' ? 'ps-drop-above' : '',
                          dragIds.has(n.ID) ? 'ps-dragging' : '',
                        ].filter(Boolean).join(' ')}
                        onContextMenu={e => { e.preventDefault(); setContextMenu({ x: e.clientX, y: e.clientY, nodeId: n.ID }) }}
                      >
                        <td>
                          <input type="checkbox" checked={selectedIds.has(n.ID)} onChange={() => toggleRow(n.ID)} />
                        </td>
                        <td>
                          <span className="ps-drag-handle" title="Ziehen zum Verschieben"
                            onPointerDown={e => handleHandlePointerDown(e, n.ID)}>⋮⋮</span>
                        </td>
                        <td style={{ paddingLeft: 4 + depth * 16 }}>
                          <input className="tbl-input" style={{ width: 70, fontWeight: isParent ? 700 : undefined }}
                            value={nameShort} onChange={e => setField(n.ID, 'nameShort', e.target.value)} />
                          {isParent && <span className="struct-agg-badge" title="Aggregierter Wert"> ∑</span>}
                        </td>
                        <td>
                          <input className="tbl-input" style={{ width: 160 }}
                            value={nameLong} onChange={e => setField(n.ID, 'nameLong', e.target.value)} />
                          {isHourly && n.QUANTITY != null && !isParent && (
                            <span className="ls-muted" style={{ marginLeft: 6, fontSize: 11 }}>
                              {n.QUANTITY}h × {Number(n.SP_RATE || 0).toLocaleString('de-DE')} €/h
                            </span>
                          )}
                        </td>
                        <td>
                          <select className="tbl-select" value={btId}
                            onChange={e => setField(n.ID, 'billingTypeId', e.target.value)}>
                            {btypes.map(b => <option key={b.ID} value={b.ID}>{b.NAME_SHORT}</option>)}
                          </select>
                        </td>
                        <td className="num">
                          {isParent || isHourly ? (
                            <span style={{ color: 'rgba(17,24,39,0.45)', fontSize: 12 }}>{fmtEur(displayRevenueBasis)}</span>
                          ) : (
                            <input className="tbl-input" type="number" min={0} step={100}
                              style={{ width: 90, textAlign: 'right' }}
                              value={budgetVal} onChange={e => setField(n.ID, 'budget', e.target.value)} />
                          )}
                        </td>
                        <td className="num">
                          {displaySurcharges !== 0 ? (
                            <span style={{ color: displaySurcharges > 0 ? '#16a34a' : '#dc2626', fontSize: 12 }}>{fmtEur(displaySurcharges)}</span>
                          ) : (
                            <span style={{ color: 'rgba(17,24,39,0.25)', fontSize: 12 }}>—</span>
                          )}
                        </td>
                        <td className="num">
                          <span style={{ fontSize: 12, fontWeight: hasSurcharges ? 600 : undefined }}>
                            {fmtEur(Number(n.REVENUE ?? 0))}
                          </span>
                        </td>
                        <td className="num">
                          <input className="tbl-input" type="number" min={0} max={100} step={0.1} style={{ width: 56 }}
                            value={nkVal} onChange={e => setField(n.ID, 'nk', e.target.value)} />
                        </td>
                        <td className="num">{fmtEur(displayExtras)}</td>
                        <td>
                          <div style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
                            <button
                              className="row-action-btn"
                              title={hasSurcharges ? `Zuschläge (${fmtEur(n.SURCHARGES_TOTAL ?? 0)})` : 'Zuschläge bearbeiten'}
                              style={hasSurcharges ? { color: '#2563eb', borderColor: '#2563eb' } : { color: '#6b7280' }}
                              onClick={() => { if (surchargePanel === n.ID) closeSurchargePanel(n.ID); else setSurchargePanel(n.ID) }}
                            ><Percent size={13} strokeWidth={2} /></button>
                            <button className="btn-small" style={{ color: '#e74c3c', borderColor: '#e74c3c', display: 'inline-flex', alignItems: 'center' }}
                              disabled={deleteMut.isPending}
                              onClick={() => setConfirmState({
                                title: 'Element löschen',
                                message: `Element „${nameShort}" löschen?`,
                                onConfirm: () => deleteMut.mutate(n.ID),
                              })}
                            ><X size={12} strokeWidth={2.5} /></button>
                          </div>
                        </td>
                      </tr>
                      {surchargePanel === n.ID && (
                        <tr className="surcharge-panel-row">
                          <td colSpan={11}>
                            <div className="surcharge-panel">
                              <div className="surcharge-panel-basis">
                                Basis (Honorar): <strong>{fmtEur(surchargeBase)}</strong>
                              </div>
                              <div className="surcharge-grid">
                                <div className="surcharge-grid-header">
                                  <span>Kumul.</span><span>Bezeichnung</span>
                                  <span style={{ textAlign: 'right' }}>%</span>
                                  <span style={{ textAlign: 'right' }}>Betrag</span>
                                </div>
                                {([
                                  { label: sEdit.s1Label, pct: sEdit.s1Pct, cumul: sEdit.s1Cumul, eur: computed.s1Eur, disableCumul: true,  placeholder: 'z.B. GP-Zuschlag',
                                    onChange: (f: Partial<SurchargeEdit>) => setSurchargeEdits(prev => ({ ...prev, [n.ID]: { ...(prev[n.ID] ?? surchargeDefault(n)), ...f } })),
                                    labelKey: 's1Label' as const, pctKey: 's1Pct' as const, cumulKey: 's1Cumul' as const },
                                  { label: sEdit.s2Label, pct: sEdit.s2Pct, cumul: sEdit.s2Cumul, eur: computed.s2Eur, disableCumul: false, placeholder: '(leer = inaktiv)',
                                    onChange: (f: Partial<SurchargeEdit>) => setSurchargeEdits(prev => ({ ...prev, [n.ID]: { ...(prev[n.ID] ?? surchargeDefault(n)), ...f } })),
                                    labelKey: 's2Label' as const, pctKey: 's2Pct' as const, cumulKey: 's2Cumul' as const },
                                  { label: sEdit.s3Label, pct: sEdit.s3Pct, cumul: sEdit.s3Cumul, eur: computed.s3Eur, disableCumul: false, placeholder: '(leer = inaktiv)',
                                    onChange: (f: Partial<SurchargeEdit>) => setSurchargeEdits(prev => ({ ...prev, [n.ID]: { ...(prev[n.ID] ?? surchargeDefault(n)), ...f } })),
                                    labelKey: 's3Label' as const, pctKey: 's3Pct' as const, cumulKey: 's3Cumul' as const },
                                ] as const).map((row, i) => (
                                  <div className="surcharge-grid-row" key={i}>
                                    <input type="checkbox" checked={row.cumul} disabled={row.disableCumul}
                                      onChange={e => row.onChange({ [row.cumulKey]: e.target.checked })} />
                                    <input className="tbl-input" placeholder={row.placeholder} value={row.label}
                                      onChange={e => row.onChange({ [row.labelKey]: e.target.value })} />
                                    <input className="tbl-input" type="number" min={-100} max={500} step={0.1}
                                      style={{ width: 64, textAlign: 'right' }} value={row.pct}
                                      onChange={e => row.onChange({ [row.pctKey]: e.target.value })} />
                                    <span className="surcharge-eur">{row.label || row.pct ? fmtEur(row.eur) : '—'}</span>
                                  </div>
                                ))}
                                <div className="surcharge-grid-total">
                                  Gesamt Zuschläge: <strong>{fmtEur(computed.total)}</strong>
                                </div>
                              </div>
                              <div className="surcharge-panel-actions">
                                <button className="btn-small" onClick={() => closeSurchargePanel(n.ID)}>
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
            <p className="empty-note">Noch keine Positionen vorhanden.</p>
          )}

          <div className="structure-actions">
            <button className="btn-primary" type="button" onClick={saveAll} disabled={saveMut.isPending}>
              {saveMut.isPending ? 'Speichert …' : 'Speichern (Strg+S)'}
            </button>
            <button type="button" onClick={() => { setSaveMsg(null); setAddForm(emptyAdd()) }}>
              + Neue Position
            </button>
          </div>
          <Message text={saveMsg?.text ?? null} type={saveMsg?.type} />
        </>
      )}
    </div>

    {/* Add element modal */}
    <Modal open={addForm !== null} onClose={() => { setAddForm(null); setSaveMsg(null) }} title="Neue Position anlegen">
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
                  const fid = e.target.value
                  const parent = structure.find(n => String(n.ID) === fid)
                  setAddForm(f => f && {
                    ...f, FATHER_ID: fid,
                    ...(parent ? { BILLING_TYPE_ID: String(parent.BILLING_TYPE_ID ?? f.BILLING_TYPE_ID), EXTRAS_PERCENT: String(parent.EXTRAS_PERCENT ?? f.EXTRAS_PERCENT) } : {}),
                  })
                }}>
                <option value="">(Root)</option>
                {flatTree.map(({ node }) => {
                  const n = node as unknown as OfferStructureNode
                  return <option key={n.ID} value={n.ID}>{n.NAME_SHORT}{n.NAME_LONG ? ' – ' + n.NAME_LONG : ''}</option>
                })}
              </select>
            </div>
          </div>
          <Message text={saveMsg?.text ?? null} type={saveMsg?.type} />
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn-primary btn-small" type="button" onClick={submitAdd} disabled={addMut.isPending}>
              {addMut.isPending ? '…' : 'Speichern (Strg+S)'}
            </button>
            <button className="btn-small" type="button" onClick={() => { setAddForm(null); setSaveMsg(null) }}>Abbrechen</button>
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
      {kalkFatherId !== null && oid && (
        <HonorarWizard
          offerId={oid}
          initialFatherId={kalkFatherId}
          onDone={() => {
            setKalkFatherId(null)
            void qc.invalidateQueries({ queryKey: ['offer-structure', oid] })
          }}
        />
      )}
    </Modal>

    {contextMenu && (() => {
      const cmNode = contextMenu.nodeId != null ? structure.find(n => n.ID === contextMenu.nodeId) : undefined
      const isMultiDelete = contextMenu.nodeId != null && selectedIds.has(contextMenu.nodeId) && selectedIds.size > 1
      const style: React.CSSProperties = { position: 'fixed', top: contextMenu.y, left: contextMenu.x, zIndex: 1500 }
      return (
        <div className="struct-context-menu" ref={contextMenuRef} style={style}>
          <button onClick={() => {
            setAddForm({
              ...emptyAdd(),
              FATHER_ID:       contextMenu.nodeId != null ? String(contextMenu.nodeId) : '',
              BILLING_TYPE_ID: cmNode ? String(cmNode.BILLING_TYPE_ID ?? '') : '',
              EXTRAS_PERCENT:  cmNode ? String(cmNode.EXTRAS_PERCENT  ?? '') : '',
            })
            setContextMenu(null)
          }}>Element anlegen</button>
          {contextMenu.nodeId != null ? (
            <button onClick={() => { setSurchargePanel(contextMenu.nodeId as number); setContextMenu(null) }}>
              Zuschlag hinzufügen
            </button>
          ) : (
            <button onClick={() => {
              setOfferSurchargeEdit(offerSurchargeDefault())
              setOfferSurchargePanel(true)
              setContextMenu(null)
            }}>
              Angebotszuschlag hinzufügen
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
                message: `${ids.length} Elemente löschen?`,
                onConfirm: () => void doBulkDelete(ids),
              })
              setContextMenu(null)
            }}>{selectedIds.size} Elemente löschen</button>
          ) : cmNode ? (
            <button className="struct-context-danger" onClick={() => {
              setConfirmState({
                title: 'Element löschen',
                message: `Element „${cmNode.NAME_SHORT}" löschen?`,
                onConfirm: () => deleteMut.mutate(cmNode.ID),
              })
              setContextMenu(null)
            }}>Element löschen</button>
          ) : null}
        </div>
      )
    })()}
    </>
  )
}
