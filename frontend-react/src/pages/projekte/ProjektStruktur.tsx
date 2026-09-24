import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, GripVertical } from 'lucide-react'
import { useConfirm } from '@/hooks/useConfirm'
import { useAnchoredPosition } from '@/hooks/useAnchoredPosition'
import { useCtrlS } from '@/hooks/useCtrlS'
import { HelpHint } from '@/components/ui/HelpHint'
import { Message }       from '@/components/ui/Message'
import { Modal }         from '@/components/ui/Modal'
import { ConfirmModal }  from '@/components/ui/ConfirmModal'
import { DialogFooter }  from '@/components/ui/DialogFooter'
import { ActionBar }     from '@/components/ui/ActionBar'
import { RowMenu }       from '@/components/ui/RowMenu'
import { AmountInput }   from '@/components/ui/AmountInput'
import { DensityToggle } from '@/components/ui/DensityToggle'
import { useDensity } from '@/hooks/useDensity'
import { useRegisterDirty } from '@/hooks/useDirtyGuard'
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
import {
  surchargeDefault, sameSurcharge, surchargeBody, computeSurcharges, rowChanges,
  aggregateStructure, rootTotals, type SurchargeEdit, type RowEdit, type PatchBody,
} from '@/pages/projekte/struktur/strukturCalc'
import { fmtEur, money } from '@/utils/money'
import { usePermission } from '@/store/permissionsStore'
import { useFeature, useLicenseReadOnly } from '@/store/licenseStore'
import { useToast } from '@/store/toastStore'

/**
 * Projektstruktur (UI-Pilot 2026-09: klares Speichermodell).
 *
 * Vorher speicherte die Tabelle auf vier Arten: Eingaben erst mit dem Knopf
 * ganz unten, die Intern-Checkbox sofort, Zuschlaege beim Schliessen des
 * Panels („speichert automatisch"), und beim Tabwechsel ging Offenes still
 * verloren. Jetzt:
 *  - Feldaenderungen, Zuschlaege und „Intern" sammeln sich in einem Puffer.
 *    Geaenderte Zellen sind markiert, die Aktionsleiste unten nennt die Zahl
 *    und haelt „Speichern" (Strg+S) immer in Reichweite.
 *  - Strukturbefehle (anlegen, loeschen, verschieben, vererben) wirken wie
 *    bisher sofort, mit Rueckfrage.
 *  - Tab- und Projektwechsel fragen nach, wenn noch etwas offen ist.
 * Die Funktionen hinter dem Rechtsklick stehen zusaetzlich im ⋯ jeder Zeile.
 */

type AddForm = {
  ABBR: string; NAME: string; BILLING_TYPE_ID: string
  FATHER_ID: string; REVENUE: string; EXTRAS_PERCENT: string
}

function emptyAdd(): AddForm {
  return { ABBR: '', NAME: '', BILLING_TYPE_ID: '', FATHER_ID: '', REVENUE: '', EXTRAS_PERCENT: '' }
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
  const [confirm, confirmDialog] = useConfirm()
  const qc = useQueryClient()
  const toast = useToast()
  const selectedPid = initialProjectId ?? null

  const readOnlyLicense = useLicenseReadOnly()
  const permStructure   = usePermission('projects.structure.edit')
  const permProject     = usePermission('projects.edit')
  const permCalc        = usePermission('projects.calculations.edit')
  const featureCalc     = useFeature('hoai.calculator')
  const canEdit         = permStructure && !readOnlyLicense
  const canEditProject  = permProject && !readOnlyLicense
  const canCalc         = permCalc && featureCalc && !readOnlyLicense
  const [density, setDensity] = useDensity()

  const [edits, setEdits]               = useState<Record<number, RowEdit>>({})
  const [rootEdit, setRootEdit]         = useState<SurchargeEdit | null>(null)
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
  const [errorMsg, setErrorMsg]         = useState<string | null>(null)
  const [addForm, setAddForm]           = useState<AddForm | null>(null)
  const [addError, setAddError]         = useState<string | null>(null)
  const [confirmState, setConfirmState] = useState<{ title: string; message: string; onConfirm: () => void } | null>(null)
  const [surchargePanel, setSurchargePanel] = useState<number | null>(null)
  const [kalkFatherId, setKalkFatherId]     = useState<number | null>(null)
  const [projectSurchargePanel, setProjectSurchargePanel] = useState<boolean>(false)
  const [elementSearch, setElementSearch]         = useState('')
  const [contextMenu, setContextMenu]             = useState<{ x: number; y: number; nodeId: number | null } | null>(null)
  const [saving, setSaving]                       = useState(false)
  const contextMenuRef                            = useRef<HTMLDivElement>(null)
  const longPressRef                              = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Long-Press auf dem Handy setzt x=0 — das Menü wird dann zentriert statt verankert
  const contextMenuStyle = useAnchoredPosition(
    contextMenuRef,
    contextMenu && contextMenu.x !== 0 ? contextMenu : null,
  )

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
  const structure = useMemo(() => structData?.data ?? [], [structData])
  const projectRow = projectData?.data ?? null
  const btypes    = btData?.data       ?? []

  useEffect(() => { setEdits({}); setRootEdit(null); setAddForm(null); setSelectedIds(new Set()) }, [selectedPid])

  const flatTree = structure.length ? flattenTree(buildStructureTree(structure)) : []
  // String keys avoid bigint vs number mismatches at runtime
  const parentIds = new Set(structure.filter(n => n.FATHER_ID != null).map(n => String(n.FATHER_ID)))
  const parentMap = new Map(structure.map(n => [String(n.STRUCTURE_ID), n.FATHER_ID != null ? String(n.FATHER_ID) : null]))

  const aggMap = aggregateStructure(structure)

  // These depend on parentMap and aggMap — declared AFTER them to avoid TDZ crash
  const filteredFlatTree = useMemo(() => {
    if (!elementSearch) return flatTree
    const sq = elementSearch.toLowerCase()
    const matchIds = new Set(
      flatTree
        .filter(({ node }) =>
          node.ABBR.toLowerCase().includes(sq) ||
          (node.NAME?.toLowerCase().includes(sq))
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

  // ── Puffer ───────────────────────────────────────────────────────────────

  const nodeById = useMemo(() => new Map(structure.map(n => [n.STRUCTURE_ID, n])), [structure])

  function editRow(structId: number, patch: Partial<RowEdit>) {
    setEdits(prev => ({ ...prev, [structId]: { ...prev[structId], ...patch } }))
  }

  const pendingRows = useMemo(() => Object.entries(edits)
    .map(([idStr, e]) => {
      const node = nodeById.get(Number(idStr))
      return node ? { id: Number(idStr), node, body: rowChanges(node, e) } : null
    })
    .filter((r): r is { id: number; node: StructureNode; body: PatchBody } => r != null && Object.keys(r.body).length > 0),
  [edits, nodeById])

  const rootChanged = rootEdit != null && !sameSurcharge(rootEdit, surchargeDefault(projectRow))
  const dirtyCount  = pendingRows.length + (rootChanged ? 1 : 0)
  const dirty       = dirtyCount > 0

  function discardAll() {
    setEdits({}); setRootEdit(null); setSurchargePanel(null); setProjectSurchargePanel(false); setErrorMsg(null)
  }

  const inheritMut = useMutation({
    mutationFn: ({ id, val }: { id: number; val: number }) => inheritStructureExtras(id, val),
    onSuccess: (res) => {
      void qc.invalidateQueries({ queryKey: ['structure', selectedPid] })
      toast.success(`NK % an ${(res as { updated?: number }).updated ?? '?'} Unterelemente vererbt`)
    },
    onError: (e: Error) => setErrorMsg(e.message),
  })

  // ── Speichern ────────────────────────────────────────────────────────────

  const saveAll = useCallback(async () => {
    if (!dirty || selectedPid == null) return
    setSaving(true); setErrorMsg(null)
    const rows = pendingRows
    try {
      for (const r of rows) await patchStructureNode(r.id, r.body)
      if (rootChanged && rootEdit) await patchProjectRootSurcharges(selectedPid, surchargeBody(rootEdit))
    } catch (e) {
      const msg = (e as Error)?.message || 'Speichern fehlgeschlagen'
      setErrorMsg(msg)
      setSaving(false)
      void qc.invalidateQueries({ queryKey: ['structure', selectedPid] })
      throw e
    }
    await Promise.all([
      qc.invalidateQueries({ queryKey: ['structure', selectedPid] }),
      qc.invalidateQueries({ queryKey: ['project-detail', selectedPid] }),
      qc.invalidateQueries({ queryKey: ['report-header', selectedPid] }),
    ])
    setEdits({}); setRootEdit(null); setSurchargePanel(null); setProjectSurchargePanel(false)
    setSaving(false)
    const n = rows.length + (rootChanged ? 1 : 0)
    toast.success(n === 1 ? '1 Element gespeichert' : `${n} Elemente gespeichert`)

    // Nebenkosten an Kind-Elemente weitergeben? Nacheinander, nicht parallel:
    // wer drei Elemente geaendert hat, soll drei Rueckfragen hintereinander
    // sehen und nicht drei Dialoge uebereinander.
    for (const r of rows) {
      if (r.body.EXTRAS_PERCENT === undefined || !parentIds.has(String(r.id))) continue
      const ok = await confirm({
        title: 'Nebenkosten vererben',
        message: `„${r.node.ABBR}" hat jetzt ${r.body.EXTRAS_PERCENT} % Nebenkosten. Sollen alle untergeordneten Elemente denselben Satz bekommen?`,
        confirmLabel: 'Übertragen',
        confirmClass: 'btn-primary',
      })
      if (ok) inheritMut.mutate({ id: r.id, val: r.body.EXTRAS_PERCENT })
    }
  }, [dirty, selectedPid, pendingRows, rootChanged, rootEdit]) // eslint-disable-line react-hooks/exhaustive-deps

  useRegisterDirty('struktur', {
    dirty, count: dirtyCount, label: 'Struktur',
    save: () => saveAll(),
  })

  async function confirmDiscard() {
    const ok = await confirm({
      title: 'Änderungen verwerfen',
      message: `${dirtyCount === 1 ? 'Die Änderung' : `Alle ${dirtyCount} Änderungen`} an der Struktur zurücknehmen? Gespeichertes bleibt unberührt.`,
      confirmLabel: 'Verwerfen',
    })
    if (ok) discardAll()
  }

  // ── Sofort wirkende Befehle ──────────────────────────────────────────────


  const addMut = useMutation({
    mutationFn: (f: AddForm & { transfer_parent_values?: boolean }) => createStructureNode(selectedPid!, {
      ABBR:             f.ABBR.trim(),
      NAME:              f.NAME.trim() || undefined,
      BILLING_TYPE_ID:        Number(f.BILLING_TYPE_ID),
      FATHER_ID:              f.FATHER_ID ? Number(f.FATHER_ID) : null,
      REVENUE:                f.REVENUE !== '' ? Number(f.REVENUE) : undefined,
      EXTRAS_PERCENT:         f.EXTRAS_PERCENT !== '' ? Number(f.EXTRAS_PERCENT) : undefined,
      transfer_parent_values: f.transfer_parent_values,
    }),
    onSuccess: (res) => {
      void qc.invalidateQueries({ queryKey: ['structure', selectedPid] })
      const tec_moved = (res as { data?: { tec_moved?: boolean } }).data?.tec_moved
      toast.success(tec_moved
        ? 'Element angelegt – Buchungen des übergeordneten Elements wurden übertragen'
        : 'Element angelegt')
      setAddForm(null)
    },
    onError: (e: Error) => setAddError(e.message),
  })

  const deleteMut = useMutation({
    mutationFn: (id: number) => deleteStructureNode(id, true),
    onSuccess: (_, id) => {
      void qc.invalidateQueries({ queryKey: ['structure', selectedPid] })
      setEdits(prev => { const n = { ...prev }; delete n[id]; return n })
      toast.success('Element gelöscht')
    },
    onError: (e: Error) => setErrorMsg(e.message),
  })

  // ── Bulk delete ───────────────────────────────────────────────────────────

  async function doBulkDelete(ids: number[]) {
    if (!ids.length) return
    const sorted = [...ids].sort((a, b) => depthOf(String(b), parentMap) - depthOf(String(a), parentMap))
    setErrorMsg(null)
    let failed = 0
    for (const id of sorted) {
      try { await deleteStructureNode(id, false) }
      catch { failed++ }
    }
    void qc.invalidateQueries({ queryKey: ['structure', selectedPid] })
    setSelectedIds(new Set())
    if (failed) setErrorMsg(`${ids.length - failed} gelöscht, ${failed} fehlgeschlagen`)
    else toast.success(`${ids.length} Element${ids.length > 1 ? 'e' : ''} gelöscht`)
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

  function askDelete(node: StructureNode) {
    setConfirmState({
      title: 'Element löschen',
      message: `Element „${node.ABBR}" und alle Unterelemente löschen?`,
      onConfirm: () => deleteMut.mutate(node.STRUCTURE_ID),
    })
  }

  function openAdd(fatherId: number | null) {
    const f = fatherId != null ? nodeById.get(fatherId) : undefined
    setAddError(null)
    setAddForm({
      ...emptyAdd(),
      FATHER_ID:       fatherId != null ? String(fatherId) : '',
      BILLING_TYPE_ID: f ? String(f.BILLING_TYPE_ID ?? '') : '',
      EXTRAS_PERCENT:  f ? String(f.EXTRAS_PERCENT  ?? '') : '',
    })
  }

  async function askInherit(node: StructureNode) {
    const nk = edits[node.STRUCTURE_ID]?.nk ?? String(node.EXTRAS_PERCENT ?? 0)
    const ok = await confirm({
      title: 'Nebenkosten vererben',
      message: `Alle untergeordneten Elemente von „${node.ABBR}" bekommen ${nk} % Nebenkosten. Bisherige eigene Werte dort werden überschrieben.`,
      confirmLabel: 'Übertragen',
      confirmClass: 'btn-primary',
    })
    if (ok) inheritMut.mutate({ id: node.STRUCTURE_ID, val: Number(nk) })
  }

  const submitAdd = useCallback(async () => {
    if (!addForm) return
    if (!addForm.ABBR.trim()) { setAddError('Bitte ein Kürzel angeben.'); return }
    if (!addForm.BILLING_TYPE_ID)  { setAddError('Bitte eine Abrechnungsart wählen.'); return }
    setAddError(null)

    if (addForm.FATHER_ID) {
      try {
        const check = await fetchParentChildCheck(Number(addForm.FATHER_ID))
        if (check.status === 'blocked') {
          setAddError(check.reason ?? 'Dieses Element kann keine Unterelemente erhalten.')
          return
        }
        if (check.status === 'needs_transfer') {
          const confirmMsg = check.hasTec
            ? 'Das übergeordnete Element enthält bereits Werte und/oder Buchungen. Diese werden auf das neue Element übertragen. Fortfahren?'
            : 'Das übergeordnete Element enthält bereits Werte. Diese werden auf das neue Element übertragen. Fortfahren?'
          if (!(await confirm({ title: 'Werte übertragen', message: confirmMsg, confirmLabel: 'Fortfahren', confirmClass: 'btn-primary' }))) return
          addMut.mutate({ ...addForm, transfer_parent_values: true } as typeof addForm & { transfer_parent_values: boolean })
          return
        }
      } catch (e) {
        setAddError((e as Error).message ?? 'Fehler beim Prüfen des übergeordneten Elements')
        return
      }
    }
    addMut.mutate(addForm)
  }, [addForm, addMut]) // eslint-disable-line react-hooks/exhaustive-deps

  useCtrlS(() => {
    if (addForm) void submitAdd()
    else if (dirty && !saving) void saveAll().catch(() => {})
  }, canEdit)

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
            setErrorMsg(check.reason ?? 'Dieses Element kann keine Unterelemente erhalten.')
            return
          }
          if (check.status === 'needs_transfer') {
            const confirmMsg = check.hasTec
              ? 'Das Zielelement enthält bereits Werte und/oder Buchungen. Diese werden auf das verschobene Element übertragen. Fortfahren?'
              : 'Das Zielelement enthält bereits Werte. Diese werden auf das verschobene Element übertragen. Fortfahren?'
            if (!(await confirm({ title: 'Werte übertragen', message: confirmMsg, confirmLabel: 'Fortfahren', confirmClass: 'btn-primary' }))) return
            // Transfer father's values/BOOKING to the first element being moved
            await transferFatherToChild(fatherId, ordered[0])
          }
        } catch (e) {
          setErrorMsg((e as Error).message ?? 'Fehler beim Prüfen des Zielelements')
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
        toast.success(ordered.length > 1 ? `${ordered.length} Elemente verschoben` : 'Verschoben')
        if (items.length > 1) setSelectedIds(new Set())
      } catch (err) {
        setErrorMsg((err as Error).message ?? 'Fehler beim Verschieben')
      }
    }

    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  // ── Root row totals ───────────────────────────────────────────────────────
  const currentProject = projects.find(p => p.ID === selectedPid)
  const projectLevelSurcharges = Number((projectRow as Record<string, unknown> | null)?.SURCHARGES_TOTAL || 0)
  const { rootRevenue, rootSurcharges, rootStructureRevenueSum, rootRevenueFinal, rootExtras, rootGesamt } =
    rootTotals(structure, aggMap, projectLevelSurcharges)

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

  const addParent = addForm?.FATHER_ID ? nodeById.get(Number(addForm.FATHER_ID)) : undefined
  const COLS = 12

  // Zeilenmenue und Rechtsklick teilen sich dieselben Befehle.
  function rowCommands(node: StructureNode, isParent: boolean) {
    const internal = edits[node.STRUCTURE_ID]?.internal ?? !!node.IS_INTERNAL
    const nkDirty  = edits[node.STRUCTURE_ID]?.nk !== undefined && rowChanges(node, edits[node.STRUCTURE_ID]).EXTRAS_PERCENT !== undefined
    return [
      canEdit && { key: 'add',  label: 'Unterelement anlegen', run: () => openAdd(node.STRUCTURE_ID) },
      canEdit && { key: 'sur',  label: 'Zuschläge bearbeiten', run: () => setSurchargePanel(node.STRUCTURE_ID) },
      canEdit && isParent && { key: 'inh', label: nkDirty ? 'NK vererben (erst speichern)' : 'NK % an Unterelemente vererben', disabled: nkDirty || inheritMut.isPending, run: () => void askInherit(node) },
      canCalc && { key: 'kalk', label: 'Kalkulation anlegen', run: () => setKalkFatherId(node.STRUCTURE_ID) },
      canEdit && { key: 'int',  label: internal ? 'Intern aufheben' : 'Als intern markieren', run: () => editRow(node.STRUCTURE_ID, { internal: !internal }) },
      canEdit && { key: 'del',  label: 'Element löschen', danger: true, run: () => askDelete(node) },
    ].filter(Boolean) as { key: string; label: string; run: () => void; disabled?: boolean; danger?: boolean }[]
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="sx-root" data-density={density}>
      {selectedPid === null && <p className="empty-note">Kein Projekt gewählt.</p>}

      {selectedPid !== null && (
        <>
          {isLoading && <p className="empty-note">Lade Struktur …</p>}

          {!isLoading && (
            <>
              {/* Bulk toolbar */}
              {canEdit && selectedIds.size > 0 && (
                <div className="struct-bulk-bar">
                  <span>{selectedIds.size} ausgewählt</span>
                  <button className="btn-small" style={{ color: 'var(--danger)', borderColor: 'var(--danger)' }}
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
                  Hier ablegen → oberste Ebene
                </div>
              )}

              <div className="list-toolbar sx-toolbar">
                {flatTree.length > 0 && (
                  <input type="search" className="list-search sx-search" placeholder="Elemente filtern …"
                    aria-label="Elemente filtern"
                    value={elementSearch} onChange={e => setElementSearch(e.target.value)}
                  />
                )}
                <div className="sx-toolbar-right">
                  <DensityToggle value={density} onChange={setDensity} />
                  {canEdit && (
                    <button className="btn-secondary" type="button" onClick={() => openAdd(null)}>
                      <Plus size={15} strokeWidth={2.25} aria-hidden="true" /> Neues Element
                    </button>
                  )}
                </div>
              </div>

              <Message text={errorMsg} type="error" />

              {flatTree.length > 0 && (
                <div className="list-section">
                  <table className="master-table structure-table sx-table">
                    <thead>
                      <tr>
                        <th scope="col" className="sx-col-check">
                          {canEdit && <input type="checkbox" checked={allSelected}
                            onChange={toggleAll} aria-label="Alle auswählen" />}
                        </th>
                        <th scope="col" className="sx-col-grip"><span className="sr-only">Verschieben</span></th>
                        <th scope="col">Kürzel</th>
                        <th scope="col">Bezeichnung</th>
                        <th scope="col">Abrechnung</th>
                        <th scope="col" className="num">Honorar €</th>
                        <th scope="col" className="num">Zuschläge €</th>
                        <th scope="col" className="num" title="Honorar einschließlich Zuschlägen">inkl. Zuschl. €</th>
                        <th scope="col">NK %</th>
                        <th scope="col" className="num">Nebenkosten €</th>
                        <th scope="col" className="num">Gesamt €</th>
                        <th scope="col" className="sx-col-menu">
                          <span className="sr-only">Aktionen</span>
                          <HelpHint id="structure.contextmenu" align="right" size={13} />
                        </th>
                      </tr>
                    </thead>
                    <tbody ref={tbodyRef}>
                      {currentProject && (
                        <>
                        <tr
                          className={`sx-root-row${rootChanged ? ' sx-row-changed' : ''}`}
                          onContextMenu={canEditProject ? e => { e.preventDefault(); setContextMenu({ x: e.clientX, y: e.clientY, nodeId: null }) } : undefined}
                        >
                          <td></td>
                          <td></td>
                          <td className="sx-root-abbr">{currentProject.ABBR}</td>
                          <td className="sx-root-name">Projekt gesamt</td>
                          <td className="sx-muted">—</td>
                          <td className="num sx-muted">{money(rootRevenue)}</td>
                          <td className="num">{rootSurcharges !== 0 ? money(rootSurcharges) : <span className="sx-muted">—</span>}</td>
                          <td className="num">{money(rootRevenueFinal)}</td>
                          <td className="sx-muted">—</td>
                          <td className="num sx-muted">{money(rootExtras)}</td>
                          <td className="num sx-strong">{money(rootGesamt)}</td>
                          <td className="sx-col-menu">
                            {canEditProject && (
                              <RowMenu label="Aktionen zum Projekt" triggerClassName="row-action-btn">
                                <button type="button" role="menuitem" className="row-menu-item"
                                  onClick={() => { setRootEdit(rootEdit ?? surchargeDefault(projectRow)); setProjectSurchargePanel(true) }}>
                                  Projektzuschläge bearbeiten
                                </button>
                              </RowMenu>
                            )}
                          </td>
                        </tr>
                        {projectSurchargePanel && (() => {
                          const sE = rootEdit ?? surchargeDefault(projectRow)
                          const computed = computeSurcharges(rootStructureRevenueSum, sE)
                          const setEdit = (f: Partial<SurchargeEdit>) => setRootEdit({ ...sE, ...f })
                          return (
                            <SurchargePanelRow
                              colSpan={COLS} title="Projektzuschläge – Basis (Summe Wurzel-Honorar)" basis={rootStructureRevenueSum}
                              edit={sE} computed={computed} onChange={setEdit} readOnly={!canEditProject}
                              onDone={() => setProjectSurchargePanel(false)}
                            />
                          )
                        })()}
                        </>
                      )}
                      {filteredFlatTree.map(({ node, depth }) => {
                        const edit      = edits[node.STRUCTURE_ID]
                        const changes   = rowChanges(node, edit)
                        const nkVal     = edit?.nk     ?? String(node.EXTRAS_PERCENT ?? 0)
                        // Editable "Honorar" shows REVENUE_BASIS (the base before surcharges)
                        const budgetVal = edit?.budget ?? String(node.REVENUE_BASIS ?? node.REVENUE ?? 0)
                        const nameShort = edit?.nameShort     ?? (node.ABBR ?? '')
                        const nameLong  = edit?.nameLong      ?? (node.NAME  ?? '')
                        const btId      = edit?.billingTypeId ?? String(node.BILLING_TYPE_ID ?? '')
                        const internal  = edit?.internal      ?? !!node.IS_INTERNAL
                        const isTec     = Number(btId || node.BILLING_TYPE_ID) === 2
                        const isParent  = parentIds.has(String(node.STRUCTURE_ID))
                        const isDragOver = dragOverId === node.STRUCTURE_ID

                        const sEdit = edit?.surcharge ?? surchargeDefault(node)
                        // Surcharge base = REVENUE_BASIS only (for leaf) or sum of children's REVENUE (for parent)
                        const surchargeBase = isParent
                          ? (node.REVENUE_BASIS ?? 0)
                          : (isTec ? (node.TEC_SP_TOT_SUM ?? 0) : (node.REVENUE_BASIS ?? node.REVENUE ?? 0))
                        const computed = computeSurcharges(surchargeBase, sEdit)
                        const surchargeChanged = changes.SURCHARGE_1_CUMUL !== undefined
                        const hasSurcharges = (node.SURCHARGES_TOTAL ?? 0) !== 0
                        const cmds = rowCommands(node, isParent)
                        const ch = (f: keyof PatchBody) => changes[f] !== undefined ? ' sx-changed' : ''

                        return (
                          <React.Fragment key={node.STRUCTURE_ID}>
                          <tr
                            data-struct-id={node.STRUCTURE_ID}
                            className={[
                              isParent ? 'struct-row-parent' : '',
                              internal ? 'sx-row-internal' : '',
                              Object.keys(changes).length ? 'sx-row-changed' : '',
                              isDragOver && dragZone === 'on'    ? 'ps-drag-over'  : '',
                              isDragOver && dragZone === 'above' ? 'ps-drop-above' : '',
                              dragIds.has(node.STRUCTURE_ID) ? 'ps-dragging' : '',
                            ].filter(Boolean).join(' ')}
                            onContextMenu={cmds.length ? e => { e.preventDefault(); setContextMenu({ x: e.clientX, y: e.clientY, nodeId: node.STRUCTURE_ID }) } : undefined}
                            onTouchStart={cmds.length ? () => { longPressRef.current = setTimeout(() => setContextMenu({ x: 0, y: 0, nodeId: node.STRUCTURE_ID }), 600) } : undefined}
                            onTouchEnd={() => { if (longPressRef.current) { clearTimeout(longPressRef.current); longPressRef.current = null } }}
                            onTouchMove={() => { if (longPressRef.current) { clearTimeout(longPressRef.current); longPressRef.current = null } }}
                          >
                            <td className="sx-col-check">
                              {canEdit && <input type="checkbox" checked={selectedIds.has(node.STRUCTURE_ID)}
                                aria-label={`${node.ABBR} auswählen`}
                                onChange={() => toggleRow(node.STRUCTURE_ID)} />}
                            </td>
                            <td className="sx-col-grip">
                              {canEdit && (
                                <span
                                  className="ps-drag-handle"
                                  title="Halten und ziehen zum Verschieben"
                                  onPointerDown={e => handleHandlePointerDown(e, node.STRUCTURE_ID)}
                                ><GripVertical size={14} strokeWidth={2} aria-hidden="true" /></span>
                              )}
                            </td>
                            <td className="sx-cell-abbr" style={{ paddingLeft: `calc(var(--sx-pad-x) + ${depth} * var(--sx-indent))` }}>
                              {canEdit ? (
                                <input
                                  className={`tbl-input sx-input sx-input-abbr${isParent ? ' sx-input-parent' : ''}${ch('ABBR')}`}
                                  aria-label="Kürzel"
                                  value={nameShort}
                                  onChange={e => editRow(node.STRUCTURE_ID, { nameShort: e.target.value })}
                                />
                              ) : <span className={isParent ? 'sx-strong' : undefined}>{nameShort}</span>}
                              {isParent && <span className="struct-agg-badge" title="Summe der Unterelemente"> ∑</span>}
                            </td>
                            <td className="sx-cell-name">
                              <div className="sx-name-wrap">
                                {canEdit ? (
                                  <input
                                    className={`tbl-input sx-input sx-input-name${ch('NAME')}`}
                                    aria-label="Bezeichnung"
                                    title={nameLong}
                                    value={nameLong}
                                    onChange={e => editRow(node.STRUCTURE_ID, { nameLong: e.target.value })}
                                  />
                                ) : <span className="sx-name-text" title={nameLong}>{nameLong}</span>}
                                {internal && <span className={`status-pill sx-internal-pill${ch('IS_INTERNAL')}`}>Intern</span>}
                              </div>
                            </td>
                            <td>
                              {canEdit ? (
                                <select className={`tbl-select sx-input sx-input-bt${ch('BILLING_TYPE_ID')}`} aria-label="Abrechnungsart" value={btId}
                                  onChange={e => editRow(node.STRUCTURE_ID, { billingTypeId: e.target.value })}>
                                  {btypes.map(b => <option key={b.ID} value={b.ID}>{b.ABBR}</option>)}
                                </select>
                              ) : btypes.find(b => String(b.ID) === btId)?.ABBR ?? '—'}
                            </td>
                            <td className="num">
                              {/* Honorar € = pure leaf sum (REVENUE_BASIS) so it never includes surcharges */}
                              {isParent || isTec || !canEdit ? (
                                <span className="sx-muted">
                                  {/* Ein Vater zeigt IMMER die Summe seines Teilbaums — auch wenn er
                                      selbst auf Nachweis steht. */}
                                  {money(isParent
                                    ? (aggMap.get(String(node.STRUCTURE_ID))?.revenueBasis ?? 0)
                                    : isTec ? (node.TEC_SP_TOT_SUM ?? 0) : Number(budgetVal))}
                                </span>
                              ) : (
                                <AmountInput className={`tbl-input sx-input sx-input-num${ch('REVENUE')}`}
                                  aria-label="Honorar"
                                  value={budgetVal}
                                  onChange={v => editRow(node.STRUCTURE_ID, { budget: v })} />
                              )}
                            </td>
                            <td className="num">
                              {(() => {
                                const sv = surchargeChanged ? computed.total
                                  : isParent ? (aggMap.get(String(node.STRUCTURE_ID))?.surcharges ?? 0) : (node.SURCHARGES_TOTAL ?? 0)
                                const label = sv !== 0 ? money(sv) : '—'
                                return canEdit ? (
                                  <button type="button" className={`sx-surcharge-btn${surchargeChanged ? ' sx-changed' : ''}`}
                                    aria-label={`Zuschläge von ${nameShort} bearbeiten`}
                                    onClick={() => setSurchargePanel(p => p === node.STRUCTURE_ID ? null : node.STRUCTURE_ID)}>
                                    {label}
                                  </button>
                                ) : <span className={sv === 0 ? 'sx-muted' : undefined}>{label}</span>
                              })()}
                            </td>
                            <td className={`num${hasSurcharges ? ' sx-strong' : ''}`}>
                              {/* Honorar + Zuschläge = REVENUE (final, all surcharges included) */}
                              {money(node.REVENUE ?? 0)}
                            </td>
                            <td>
                              {canEdit ? (
                                <input className={`tbl-input sx-input sx-input-pct${ch('EXTRAS_PERCENT')}`} type="text" inputMode="decimal"
                                  aria-label="Nebenkosten in Prozent"
                                  value={nkVal}
                                  onChange={e => editRow(node.STRUCTURE_ID, { nk: e.target.value.replace(',', '.') })} />
                              ) : `${nkVal} %`}
                            </td>
                            <td className="num">{money(isParent ? aggMap.get(String(node.STRUCTURE_ID))?.extras : node.EXTRAS)}</td>
                            <td className="num sx-strong">{(() => {
                              const rev = Number(node.REVENUE ?? 0)
                              const ext = isParent ? (aggMap.get(String(node.STRUCTURE_ID))?.extras ?? 0) : Number(node.EXTRAS ?? 0)
                              return fmtEur(rev + ext)
                            })()}</td>
                            <td className="sx-col-menu">
                              {cmds.length > 0 && (
                                <RowMenu label={`Aktionen zu ${node.ABBR}`} triggerClassName="row-action-btn">
                                  {cmds.map(c => (
                                    <button key={c.key} type="button" role="menuitem" disabled={c.disabled}
                                      className={`row-menu-item${c.danger ? ' danger' : ''}`} onClick={c.run}>
                                      {c.label}
                                    </button>
                                  ))}
                                </RowMenu>
                              )}
                            </td>
                          </tr>
                          {surchargePanel === node.STRUCTURE_ID && (
                            <SurchargePanelRow
                              colSpan={COLS} title={`Zuschläge ${node.ABBR} – Basis (Honorar)`} basis={surchargeBase}
                              edit={sEdit} computed={computed} readOnly={!canEdit}
                              onChange={f => editRow(node.STRUCTURE_ID, { surcharge: { ...sEdit, ...f } })}
                              onDone={() => setSurchargePanel(null)}
                            />
                          )}
                          </React.Fragment>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}

              {flatTree.length === 0 && !addForm && (
                <div className="sx-empty">
                  <p className="empty-note">Dieses Projekt hat noch keine Struktur.</p>
                  <p className="sx-empty-why">Die Struktur gliedert Honorar und Leistungen (z. B. Leistungsphasen). Auf ihre Elemente werden Stunden gebucht und Leistungsstände gemeldet.</p>
                  {canEdit && (
                    <button type="button" className="btn-secondary" onClick={() => openAdd(null)}>
                      <Plus size={15} strokeWidth={2.25} aria-hidden="true" /> Erstes Element anlegen
                    </button>
                  )}
                </div>
              )}

              {canEdit && flatTree.length > 0 && (
                <ActionBar
                  dirty={dirty}
                  quiet={!dirty}
                  status={saving ? 'Speichert …' : dirty
                    ? `${dirtyCount} ${dirtyCount === 1 ? 'Element' : 'Elemente'} geändert`
                    : 'Alle Änderungen gespeichert'}
                  secondary={dirty ? (
                    <button type="button" className="btn-secondary" onClick={() => void confirmDiscard()} disabled={saving}>Verwerfen</button>
                  ) : undefined}
                >
                  <HelpHint id="structure.save" align="right" />
                  <button className="btn-primary" type="button"
                    onClick={() => void saveAll().catch(() => {})}
                    disabled={!dirty || saving}>
                    {saving ? 'Speichert …' : <>Speichern <kbd>Strg+S</kbd></>}
                  </button>
                </ActionBar>
              )}
            </>
          )}
        </>
      )}

    {/* ── Neues Element ── */}
    <Modal open={addForm !== null} onClose={() => { setAddForm(null); setAddError(null) }} title="Neues Element anlegen">
      {addForm && (
        <form className="sx-add-form" onSubmit={e => { e.preventDefault(); void submitAdd() }}>
          <p className="sx-add-context">
            {addParent ? <>unter <strong>{addParent.ABBR}</strong>{addParent.NAME ? ` · ${addParent.NAME}` : ''}</> : 'auf oberster Ebene des Projekts'}
          </p>
          <div className="sx-add-grid">
            <div className="form-group">
              <label htmlFor="sx-add-abbr">Kürzel*</label>
              <input id="sx-add-abbr" autoFocus value={addForm.ABBR} placeholder="z. B. LP5.4"
                onChange={e => setAddForm(f => f && { ...f, ABBR: e.target.value })} />
            </div>
            <div className="form-group">
              <label htmlFor="sx-add-bt">Abrechnungsart*</label>
              <select id="sx-add-bt" value={addForm.BILLING_TYPE_ID}
                onChange={e => setAddForm(f => f && { ...f, BILLING_TYPE_ID: e.target.value })}>
                <option value="">Bitte wählen …</option>
                {btypes.map(b => <option key={b.ID} value={b.ID}>{b.ABBR}{b.NAME ? ' – ' + b.NAME : ''}</option>)}
              </select>
            </div>
            <div className="form-group sx-add-wide">
              <label htmlFor="sx-add-name">Bezeichnung</label>
              <input id="sx-add-name" value={addForm.NAME}
                onChange={e => setAddForm(f => f && { ...f, NAME: e.target.value })} />
            </div>
            <div className="form-group">
              <label htmlFor="sx-add-rev">Honorar €</label>
              <AmountInput id="sx-add-rev" value={addForm.REVENUE} placeholder="0,00"
                onChange={v => setAddForm(f => f && { ...f, REVENUE: v })} />
            </div>
            <div className="form-group">
              <label htmlFor="sx-add-nk">Nebenkosten %</label>
              <input id="sx-add-nk" type="text" inputMode="decimal" placeholder="0" value={addForm.EXTRAS_PERCENT}
                onChange={e => setAddForm(f => f && { ...f, EXTRAS_PERCENT: e.target.value.replace(',', '.') })} />
            </div>
            <div className="form-group sx-add-wide">
              <label htmlFor="sx-add-father">Übergeordnetes Element</label>
              <select id="sx-add-father" value={addForm.FATHER_ID}
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
                <option value="">— oberste Ebene —</option>
                {flatTree.map(({ node, depth }) => (
                  <option key={node.STRUCTURE_ID} value={node.STRUCTURE_ID}>
                    {'  '.repeat(depth)}{node.ABBR}{node.NAME ? ' – ' + node.NAME : ''}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <Message text={addError} type="error" />
          <DialogFooter>
            <button type="button" className="btn-secondary" onClick={() => { setAddForm(null); setAddError(null) }}>Abbrechen</button>
            <button type="submit" className="btn-primary" disabled={addMut.isPending}>
              {addMut.isPending ? 'Legt an …' : 'Anlegen'}
            </button>
          </DialogFooter>
        </form>
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
      const cmNode = contextMenu.nodeId != null ? nodeById.get(contextMenu.nodeId) : undefined
      const isMultiDelete = contextMenu.nodeId != null && selectedIds.has(contextMenu.nodeId) && selectedIds.size > 1
      const style: React.CSSProperties = contextMenu.x === 0
        ? { position: 'fixed', top: '40%', left: '50%', transform: 'translate(-50%,-50%)', zIndex: 1500 }
        : contextMenuStyle
      const cmds = cmNode ? rowCommands(cmNode, parentIds.has(String(cmNode.STRUCTURE_ID))) : []
      return (
        <div className="struct-context-menu" ref={contextMenuRef} style={style} role="menu">
          {cmNode ? cmds.filter(c => !c.danger || !isMultiDelete).map(c => (
            <button key={c.key} type="button" role="menuitem" disabled={c.disabled}
              className={c.danger ? 'struct-context-danger' : undefined}
              onClick={() => { c.run(); setContextMenu(null) }}>{c.label}</button>
          )) : (
            <button type="button" role="menuitem" onClick={() => {
              setRootEdit(rootEdit ?? surchargeDefault(projectRow))
              setProjectSurchargePanel(true)
              setContextMenu(null)
            }}>
              Projektzuschläge bearbeiten
            </button>
          )}
          {isMultiDelete && canEdit && (
            <>
              <div className="struct-context-divider" />
              <button type="button" role="menuitem" className="struct-context-danger" onClick={() => {
                const ids = Array.from(selectedIds)
                setConfirmState({
                  title: `${ids.length} Elemente löschen`,
                  message: `${ids.length} Elemente löschen?\nHinweis: Nur möglich wenn keine Buchungen/Rechnungen darauf verweisen.`,
                  onConfirm: () => void doBulkDelete(ids),
                })
                setContextMenu(null)
              }}>{selectedIds.size} Elemente löschen</button>
            </>
          )}
        </div>
      )
    })()}
    {confirmDialog}
    </div>
  )
}

// ── Zuschlags-Panel (eine Tabellenzeile unter dem Element) ────────────────────

function SurchargePanelRow({ colSpan, title, basis, edit, computed, onChange, onDone, readOnly }: {
  colSpan:  number
  title:    string
  basis:    number
  edit:     SurchargeEdit
  computed: ReturnType<typeof computeSurcharges>
  onChange: (f: Partial<SurchargeEdit>) => void
  onDone:   () => void
  readOnly: boolean
}) {
  const rows = [
    { label: edit.s1Label, pct: edit.s1Pct, cumul: edit.s1Cumul, eur: computed.s1Eur, disableCumul: true,  placeholder: 'z. B. Umbauzuschlag', labelKey: 's1Label' as const, pctKey: 's1Pct' as const, cumulKey: 's1Cumul' as const },
    { label: edit.s2Label, pct: edit.s2Pct, cumul: edit.s2Cumul, eur: computed.s2Eur, disableCumul: false, placeholder: '(leer = inaktiv)',    labelKey: 's2Label' as const, pctKey: 's2Pct' as const, cumulKey: 's2Cumul' as const },
    { label: edit.s3Label, pct: edit.s3Pct, cumul: edit.s3Cumul, eur: computed.s3Eur, disableCumul: false, placeholder: '(leer = inaktiv)',    labelKey: 's3Label' as const, pctKey: 's3Pct' as const, cumulKey: 's3Cumul' as const },
  ]
  return (
    <tr className="surcharge-panel-row">
      <td colSpan={colSpan}>
        <div className="surcharge-panel">
          <div className="surcharge-panel-basis">
            {title}: <strong>{money(basis)}</strong>
          </div>
          <div className="surcharge-grid">
            <div className="surcharge-grid-header">
              <span>Kumul.</span>
              <span>Bezeichnung</span>
              <span style={{ textAlign: 'right' }}>%</span>
              <span style={{ textAlign: 'right' }}>Betrag</span>
            </div>
            {rows.map((row, i) => (
              <div className="surcharge-grid-row" key={i}>
                <input type="checkbox" checked={row.cumul} disabled={row.disableCumul || readOnly}
                  aria-label={`Zuschlag ${i + 1} kumulativ`}
                  title={row.disableCumul ? 'Erster Zuschlag bezieht sich immer auf die Basis' : 'Kumulativ (auf laufende Zwischensumme)'}
                  onChange={e => onChange({ [row.cumulKey]: e.target.checked })} />
                <input className="tbl-input" placeholder={row.placeholder} value={row.label} disabled={readOnly}
                  aria-label={`Zuschlag ${i + 1} Bezeichnung`}
                  onChange={e => onChange({ [row.labelKey]: e.target.value })} />
                <input className="tbl-input" type="text" inputMode="decimal" disabled={readOnly}
                  aria-label={`Zuschlag ${i + 1} Prozent`}
                  style={{ width: 64, textAlign: 'right' }} value={row.pct}
                  onChange={e => onChange({ [row.pctKey]: e.target.value.replace(',', '.') })} />
                <span className="surcharge-eur">{row.label || row.pct ? fmtEur(row.eur) : '—'}</span>
              </div>
            ))}
            <div className="surcharge-grid-total">
              Gesamt Zuschläge: <strong>{money(computed.total)}</strong>
            </div>
          </div>
          <div className="surcharge-panel-actions">
            <span className="sx-panel-note">Wird mit „Speichern" übernommen.</span>
            <button type="button" className="btn-secondary" onClick={onDone}>Fertig</button>
          </div>
        </div>
      </td>
    </tr>
  )
}
