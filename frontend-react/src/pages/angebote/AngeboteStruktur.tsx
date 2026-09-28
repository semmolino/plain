import React, { useState, useEffect, useLayoutEffect, useRef, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, GripVertical, ChevronRight, ChevronsDownUp, ChevronsUpDown } from 'lucide-react'
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
import { ColumnChooser } from '@/components/ui/ColumnChooser'
import { useIsNarrow } from '@/hooks/useIsNarrow'
import { useRegisterDirty } from '@/hooks/useDirtyGuard'
import { HonorarWizard } from '@/pages/projekte/HonorarWizard'
import { SurchargePanelRow } from '@/pages/projekte/struktur/SurchargePanelRow'
import { STRUKTUR_SPALTEN, useStrukturSpalten } from '@/pages/projekte/struktur/strukturSpalten'
import { SurchargeAmount } from '@/pages/projekte/struktur/SurchargeAmount'
import { OfferStrukturMobile } from '@/pages/angebote/struktur/OfferStrukturMobile'
import {
  fetchOffer, fetchOffers, fetchOfferStructure, addOfferStructureNode, updateOfferStructureNode,
  deleteOfferStructureNode, moveOfferStructureNode, patchOfferRootSurcharges,
  type OfferStructureNode,
} from '@/api/angebote'
import { fetchBillingTypes, fetchActiveRoles, type StructureNode } from '@/api/projekte'
import { buildStructureTree, flattenTree } from '@/utils/treeUtils'
import {
  surchargeDefault, sameSurcharge, surchargeBody, computeSurcharges, type SurchargeEdit,
} from '@/pages/projekte/struktur/strukturCalc'
import {
  aggregateOffer, offerRootTotals, offerRowChanges, offerLeafFee, hoursRate, isHourlyBt,
  type OfferRowEdit, type OfferPutBody,
} from '@/pages/angebote/struktur/offerStrukturCalc'
import { fmtEur, money } from '@/utils/money'
import { usePermission } from '@/store/permissionsStore'
import { useFeature, useLicenseReadOnly } from '@/store/licenseStore'
import { useToast } from '@/store/toastStore'

/**
 * Angebotsstruktur (UI-Pilot Runde 3) — dasselbe Muster wie die
 * Projektstruktur aus Runde 2.
 *
 * Vorher speicherte die Tabelle auf zwei Arten: Eingaben mit dem Knopf ganz
 * unten, Zuschlaege beim Schliessen des Panels („speichert automatisch"); wer
 * das Angebot oder den Reiter wechselte, verlor Offenes ohne Rueckfrage. Die
 * Funktionen je Zeile lagen nur hinter dem Rechtsklick. Jetzt:
 *  - Feldaenderungen, Stunden × Satz und Zuschlaege sammeln sich in einem
 *    Puffer; die Aktionsleiste unten nennt die Zahl und haelt „Speichern"
 *    (Strg+S) in Reichweite. Ein geaendertes Element ist genau ein Aufruf.
 *  - Anlegen, Loeschen und Verschieben wirken sofort, mit Rueckfrage.
 *  - Angebots- und Reiterwechsel fragen nach, wenn noch etwas offen ist.
 *  - Das ⋯ jeder Zeile traegt dieselben Befehle wie der Rechtsklick.
 * Die Summen rechnet der mit der Projektstruktur geteilte Kern
 * (struktur/offerStrukturCalc.ts → projekte/struktur/strukturCalc.ts).
 */

type AddForm = {
  ABBR: string; NAME: string; BILLING_TYPE_ID: string; FATHER_ID: string
  REVENUE: string; EXTRAS_PERCENT: string
  // Aufwand (BT 2): Honorar = Stunden × Satz, Satz aus der Rolle vorbelegt
  QUANTITY: string; HOURLY_RATE: string; ROLE_ID: string; ROLE_ABBR: string; ROLE_NAME: string
}

function emptyAdd(): AddForm {
  return {
    ABBR: '', NAME: '', BILLING_TYPE_ID: '', FATHER_ID: '', REVENUE: '', EXTRAS_PERCENT: '',
    QUANTITY: '', HOURLY_RATE: '', ROLE_ID: '', ROLE_ABBR: '', ROLE_NAME: '',
  }
}

// Der Baum aus treeUtils kennt nur Projekt-Elemente (STRUCTURE_ID).
type FlatOffer = { node: OfferStructureNode; depth: number }
function flattenOffer(structure: OfferStructureNode[]): FlatOffer[] {
  if (!structure.length) return []
  return flattenTree(buildStructureTree(structure.map(n => ({ ...n, STRUCTURE_ID: n.ID })) as unknown as StructureNode[]))
    .map(({ node, depth }) => ({ node: node as unknown as OfferStructureNode, depth }))
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

// Welches Angebot, bestimmt der Arbeitsbereich (AngebotePage) — gewechselt
// wird ueber den Kopf, nicht mehr ueber ein eigenes Suchfeld hier.
interface Props { initialOfferId?: number }

export function AngeboteStruktur({ initialOfferId }: Props) {
  const [confirm, confirmDialog] = useConfirm()
  const qc = useQueryClient()
  const toast = useToast()
  const oid = initialOfferId ?? null

  const readOnlyLicense = useLicenseReadOnly()
  const permEdit    = usePermission('offers.edit')
  const permCalc    = usePermission('projects.calculations.edit')
  const featureCalc = useFeature('hoai.calculator')
  const canEdit     = permEdit && !readOnlyLicense
  const canCalc     = permCalc && featureCalc && !readOnlyLicense
  // Immer luftig (Rueckmeldung Runde 3); welche Spalten, waehlt jeder selbst.
  const cols = useStrukturSpalten('angebotsstruktur.spalten')
  const narrow = useIsNarrow()

  const [edits, setEdits]               = useState<Record<number, OfferRowEdit>>({})
  const [rootEdit, setRootEdit]         = useState<SurchargeEdit | null>(null)
  const [selectedIds, setSelectedIds]   = useState<Set<number>>(new Set())
  const [dragIds, setDragIds]           = useState<Set<number>>(new Set())
  const [dragOverId, setDragOverId]     = useState<number | null | 'root'>(null)
  const [dragZone, setDragZone]         = useState<'above' | 'on'>('on')
  const [errorMsg, setErrorMsg]         = useState<string | null>(null)
  const [addForm, setAddForm]           = useState<AddForm | null>(null)
  const [addError, setAddError]         = useState<string | null>(null)
  const [confirmState, setConfirmState] = useState<{ title: string; message: string; onConfirm: () => void } | null>(null)
  const [surchargePanel, setSurchargePanel]       = useState<number | null>(null)
  const [offerSurchargePanel, setOfferSurchargePanel] = useState(false)
  const [kalkFatherId, setKalkFatherId]           = useState<number | null>(null)
  const [elementSearch, setElementSearch]         = useState('')
  const [collapsed, setCollapsed]                 = useState<Set<number>>(new Set())
  const [contextMenu, setContextMenu]             = useState<{ x: number; y: number; nodeId: number | null } | null>(null)
  const [saving, setSaving]                       = useState(false)
  const contextMenuRef  = useRef<HTMLDivElement>(null)
  const longPressRef    = useRef<ReturnType<typeof setTimeout> | null>(null)
  const parentMapRef    = useRef<Map<string, string | null>>(new Map())
  const pointerDragRef  = useRef<{ id: number; idsToMove: number[]; active: boolean; zone: 'above' | 'on'; targetId: number | null } | null>(null)
  const flatTreeRef     = useRef<FlatOffer[]>([])
  const selectedIdsRef  = useRef<Set<number>>(new Set())
  // Long-Press auf dem Handy setzt x=0 — das Menü wird dann zentriert statt verankert
  const contextMenuStyle = useAnchoredPosition(contextMenuRef, contextMenu && contextMenu.x !== 0 ? contextMenu : null)

  const { data: offersData } = useQuery({ queryKey: ['offers'], queryFn: fetchOffers })
  const { data: structData, isLoading } = useQuery({
    queryKey: ['offer-structure', oid],
    queryFn:  () => fetchOfferStructure(oid!),
    enabled:  oid !== null,
  })
  const { data: btData }    = useQuery({ queryKey: ['billing-types'], queryFn: fetchBillingTypes })
  const { data: rolesData } = useQuery({ queryKey: ['active-roles'], queryFn: fetchActiveRoles })
  const { data: offerDetailData } = useQuery({
    queryKey: ['offer-detail', oid],
    queryFn:  () => fetchOffer(oid!),
    enabled:  oid !== null,
  })

  const offers      = useMemo(() => offersData?.data ?? [], [offersData])
  const roles       = rolesData?.data ?? []
  const btypes      = btData?.data ?? []
  const structure   = useMemo(() => structData?.data ?? [], [structData])
  const offerDetail = offerDetailData?.data ?? null
  const currentOffer = offers.find(o => o.ID === oid)

  // Anderes Angebot → Puffer und Auswahl leeren (waehrend des Renderns, statt
  // in einem Effekt einen zweiten Durchlauf anzustossen).
  const [seenOid, setSeenOid] = useState(oid)
  if (seenOid !== oid) {
    setSeenOid(oid)
    setEdits({}); setRootEdit(null); setAddForm(null); setSelectedIds(new Set()); setCollapsed(new Set())
    setSurchargePanel(null); setOfferSurchargePanel(false); setErrorMsg(null)
  }

  useEffect(() => {
    if (!contextMenu) return
    function onDown(e: MouseEvent) {
      if (contextMenuRef.current && !contextMenuRef.current.contains(e.target as Node)) setContextMenu(null)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [contextMenu])

  // ── Baum ─────────────────────────────────────────────────────────────────

  const flatTree  = useMemo(() => flattenOffer(structure), [structure])
  const parentIds = new Set(structure.filter(n => n.FATHER_ID != null).map(n => String(n.FATHER_ID)))
  const parentMap = new Map(structure.map(n => [String(n.ID), n.FATHER_ID != null ? String(n.FATHER_ID) : null]))
  const nodeById  = useMemo(() => new Map(structure.map(n => [n.ID, n])), [structure])
  const aggMap    = useMemo(() => aggregateOffer(structure), [structure])

  const showInklCol  = cols.show('inkl')
  const hasParents   = parentIds.size > 0
  const allCollapsed = hasParents && [...parentIds].every(id => collapsed.has(Number(id)))
  function toggleCollapsed(id: number) {
    setCollapsed(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n })
  }
  function toggleAllCollapsed() {
    setCollapsed(allCollapsed ? new Set() : new Set([...parentIds].map(Number)))
  }
  function isHidden(id: number): boolean {
    let cur = parentMap.get(String(id))
    while (cur != null) { if (collapsed.has(Number(cur))) return true; cur = parentMap.get(cur) }
    return false
  }
  function descendantCount(id: number): number {
    let c = 0
    for (const n of structure) {
      let cur = n.FATHER_ID != null ? String(n.FATHER_ID) : null
      while (cur != null) { if (cur === String(id)) { c++; break } cur = parentMap.get(cur) ?? null }
    }
    return c
  }

  // Beim Filtern gilt das Zuklappen nicht — Treffer sollen sichtbar sein.
  const filteredFlatTree = (() => {
    if (!elementSearch) return collapsed.size ? flatTree.filter(({ node }) => !isHidden(node.ID)) : flatTree
    const sq = elementSearch.toLowerCase()
    const matchIds = new Set(
      flatTree.filter(({ node }) => node.ABBR?.toLowerCase().includes(sq) || node.NAME?.toLowerCase().includes(sq))
        .map(({ node }) => node.ID),
    )
    for (const id of [...matchIds]) {
      let cursor = parentMap.get(String(id))
      while (cursor != null) { matchIds.add(Number(cursor)); cursor = parentMap.get(cursor) }
    }
    return flatTree.filter(({ node }) => matchIds.has(node.ID))
  })()

  // ── Puffer ───────────────────────────────────────────────────────────────

  function editRow(id: number, patch: Partial<OfferRowEdit>) {
    setEdits(prev => ({ ...prev, [id]: { ...prev[id], ...patch } }))
  }

  const pendingRows = useMemo(() => Object.entries(edits)
    .map(([idStr, e]) => {
      const node = nodeById.get(Number(idStr))
      return node ? { id: Number(idStr), node, body: offerRowChanges(node, e) } : null
    })
    .filter((r): r is { id: number; node: OfferStructureNode; body: OfferPutBody } => r != null && Object.keys(r.body).length > 0),
  [edits, nodeById])

  const rootChanged = rootEdit != null && !sameSurcharge(rootEdit, surchargeDefault(offerDetail))
  const dirtyCount  = pendingRows.length + (rootChanged ? 1 : 0)
  const dirty       = dirtyCount > 0

  function discardAll() {
    setEdits({}); setRootEdit(null); setSurchargePanel(null); setOfferSurchargePanel(false); setErrorMsg(null)
  }

  function invalidateOffer() {
    return Promise.all([
      qc.invalidateQueries({ queryKey: ['offer-structure', oid] }),
      qc.invalidateQueries({ queryKey: ['offer-detail', oid] }),
      qc.invalidateQueries({ queryKey: ['offers'] }),
    ])
  }

  // ── Speichern ────────────────────────────────────────────────────────────

  async function saveAll() {
    if (!dirty || oid == null) return
    setSaving(true); setErrorMsg(null)
    const rows = pendingRows
    try {
      for (const r of rows) await updateOfferStructureNode(oid, r.id, r.body)
      if (rootChanged && rootEdit) await patchOfferRootSurcharges(oid, surchargeBody(rootEdit))
    } catch (e) {
      setErrorMsg((e as Error)?.message || 'Speichern fehlgeschlagen')
      setSaving(false)
      void invalidateOffer()
      throw e
    }
    await invalidateOffer()
    setEdits({}); setRootEdit(null); setSurchargePanel(null); setOfferSurchargePanel(false)
    setSaving(false)
    const n = rows.length + (rootChanged ? 1 : 0)
    toast.success(n === 1 ? '1 Element gespeichert' : `${n} Elemente gespeichert`)
  }

  useRegisterDirty('angebotsstruktur', {
    dirty, count: dirtyCount, label: 'Angebotsstruktur',
    save: () => saveAll(),
  })

  async function confirmDiscard() {
    const ok = await confirm({
      title: 'Änderungen verwerfen',
      message: `${dirtyCount === 1 ? 'Die Änderung' : `Alle ${dirtyCount} Änderungen`} an der Angebotsstruktur zurücknehmen? Gespeichertes bleibt unberührt.`,
      confirmLabel: 'Verwerfen',
    })
    if (ok) discardAll()
  }

  // ── Sofort wirkende Befehle ──────────────────────────────────────────────

  const addMut = useMutation({
    mutationFn: (f: AddForm) => {
      const hourly = isHourlyBt(f.BILLING_TYPE_ID)
      return addOfferStructureNode(oid!, {
        abbr:            f.ABBR.trim(),
        name:            f.NAME.trim() || undefined,
        billing_type_id: Number(f.BILLING_TYPE_ID),
        father_id:       f.FATHER_ID ? Number(f.FATHER_ID) : null,
        extras_percent:  f.EXTRAS_PERCENT !== '' ? Number(f.EXTRAS_PERCENT) : undefined,
        ...(hourly
          ? {
              quantity:    f.QUANTITY    !== '' ? Number(f.QUANTITY)    : 0,
              hourly_rate: f.HOURLY_RATE !== '' ? Number(f.HOURLY_RATE) : 0,
              role_id:     f.ROLE_ID ? Number(f.ROLE_ID) : undefined,
              role_abbr:   f.ROLE_ABBR || undefined,
              role_name:   f.ROLE_NAME || undefined,
            }
          : { revenue: f.REVENUE !== '' ? Number(f.REVENUE) : undefined }),
      })
    },
    onSuccess: () => {
      void invalidateOffer()
      toast.success('Element angelegt')
      setAddForm(null)
    },
    onError: (e: Error) => setAddError(e.message),
  })

  const deleteMut = useMutation({
    mutationFn: (id: number) => deleteOfferStructureNode(oid!, id),
    onSuccess: (_, id) => {
      void invalidateOffer()
      setEdits(prev => { const n = { ...prev }; delete n[id]; return n })
      toast.success('Element gelöscht')
    },
    onError: (e: Error) => setErrorMsg(e.message),
  })

  async function doBulkDelete(ids: number[]) {
    if (!ids.length || oid == null) return
    // Tiefste zuerst: das Backend loescht ein Element nur ohne Unterelemente
    // (dependencyCheck.checkOfferStructure) — ein ausgewaehlter Vater
    // klappt also, wenn seine Kinder vor ihm fallen.
    const sorted = [...ids].sort((a, b) => depthOf(String(b), parentMap) - depthOf(String(a), parentMap))
    setErrorMsg(null)
    let failed = 0
    for (const id of sorted) {
      try { await deleteOfferStructureNode(oid, id) } catch { failed++ }
    }
    void invalidateOffer()
    setSelectedIds(new Set())
    setEdits(prev => { const n = { ...prev }; for (const id of ids) delete n[id]; return n })
    if (failed) setErrorMsg(`${ids.length - failed} gelöscht, ${failed} fehlgeschlagen`)
    else toast.success(`${ids.length} Element${ids.length > 1 ? 'e' : ''} gelöscht`)
  }

  function bulkDelete() {
    const ids = Array.from(selectedIds)
    if (!ids.length) return
    setConfirmState({
      title: `${ids.length} Element${ids.length > 1 ? 'e' : ''} löschen`,
      message: `${ids.length} Element${ids.length > 1 ? 'e' : ''} löschen?\nEin Element mit Unterelementen lässt sich nur zusammen mit ihnen löschen.`,
      onConfirm: () => void doBulkDelete(ids),
    })
  }

  function askDelete(node: OfferStructureNode) {
    if (parentIds.has(String(node.ID))) {
      setErrorMsg(`„${node.ABBR ?? ''}" hat Unterelemente — erst diese löschen oder verschieben.`)
      return
    }
    setConfirmState({
      title: 'Element löschen',
      message: `Element „${node.ABBR ?? ''}" löschen?`,
      onConfirm: () => deleteMut.mutate(node.ID),
    })
  }

  /**
   * Ein Blatt mit eigenem Honorar, das Unterelemente bekommt, zeigt danach nur
   * noch deren Summe — sein Betrag waere weg. Frueher geschah das still.
   * Beim Anlegen wird der Betrag deshalb ins neue Element uebernommen.
   */
  function leafValue(fatherId: number | null): { node: OfferStructureNode; fee: number } | null {
    if (fatherId == null) return null
    const f = nodeById.get(fatherId)
    if (!f || parentIds.has(String(f.ID))) return null
    const fee = offerLeafFee(f, undefined)
    return fee > 0 ? { node: f, fee } : null
  }

  function addPrefill(fatherId: number | null): Partial<AddForm> {
    const f = fatherId != null ? nodeById.get(fatherId) : undefined
    if (!f) return {}
    const base: Partial<AddForm> = {
      BILLING_TYPE_ID: String(f.BILLING_TYPE_ID ?? ''),
      EXTRAS_PERCENT:  String(f.EXTRAS_PERCENT ?? ''),
    }
    const lv = leafValue(fatherId)
    if (!lv) return base
    return isHourlyBt(f.BILLING_TYPE_ID)
      ? { ...base, QUANTITY: String(f.QUANTITY ?? ''), HOURLY_RATE: String(f.HOURLY_RATE ?? ''),
          ROLE_ID: f.ROLE_ID != null ? String(f.ROLE_ID) : '', ROLE_ABBR: f.ROLE_ABBR ?? '', ROLE_NAME: f.ROLE_NAME ?? '' }
      : { ...base, REVENUE: String(lv.fee) }
  }

  /**
   * Anderes uebergeordnetes Element im Dialog: Abrechnungsart und NK % kommen
   * von dort (wie bisher). Den Betrag eines Blatts uebernimmt das neue Element
   * nur, solange noch nichts eingegeben ist — Getipptes geht nicht verloren.
   */
  function withParent(f: AddForm, fatherId: number | null): AddForm {
    const p = addPrefill(fatherId)
    const untouched = !f.REVENUE && !f.QUANTITY && !f.HOURLY_RATE && !f.ROLE_ID
    return {
      ...f,
      ...(p.BILLING_TYPE_ID ? { BILLING_TYPE_ID: p.BILLING_TYPE_ID } : {}),
      ...(p.EXTRAS_PERCENT !== undefined ? { EXTRAS_PERCENT: p.EXTRAS_PERCENT } : {}),
      ...(untouched ? p : {}),
    }
  }

  function openAdd(fatherId: number | null) {
    setAddError(null)
    setAddForm({ ...emptyAdd(), FATHER_ID: fatherId != null ? String(fatherId) : '', ...addPrefill(fatherId) })
  }

  function submitAdd() {
    if (!addForm) return
    if (!addForm.ABBR.trim())     { setAddError('Bitte ein Kürzel angeben.'); return }
    if (!addForm.BILLING_TYPE_ID) { setAddError('Bitte eine Abrechnungsart wählen.'); return }
    setAddError(null)
    addMut.mutate(addForm)
  }

  useCtrlS(() => {
    if (addForm) submitAdd()
    else if (dirty && !saving) void saveAll().catch(() => {})
  }, canEdit && oid != null)

  // ── Drag & Drop (Pointer-Events, wie in der Projektstruktur) ─────────────

  // Die Zeiger-Handler lesen den Stand erst waehrend des Ziehens.
  useLayoutEffect(() => {
    parentMapRef.current   = parentMap
    flatTreeRef.current    = flatTree
    selectedIdsRef.current = selectedIds
  })

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
    const sel = selectedIdsRef.current
    const idsToMove = sel.has(id) && sel.size > 1 ? [...sel] : [id]
    pointerDragRef.current = { id, idsToMove, active: false, zone: 'on', targetId: null }

    function onMove(ev: PointerEvent) {
      const state = pointerDragRef.current
      if (!state) return
      if (!state.active) { state.active = true; setDragIds(new Set(idsToMove)) }
      const el = document.elementFromPoint(ev.clientX, ev.clientY) as HTMLElement | null
      const rootZone = el?.closest('.struct-root-drop')
      const tr = el?.closest('tr[data-struct-id]') as HTMLElement | null
      if (rootZone) {
        state.targetId = null; state.zone = 'on'
        setDragOverId('root'); setDragZone('on')
      } else if (tr) {
        const targetId = Number(tr.dataset.structId)
        if (idsToMove.includes(targetId) || idsToMove.some(src => isDescendant(targetId, src, parentMapRef.current))) {
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
      if (oid == null) return

      const el = document.elementFromPoint(ev.clientX, ev.clientY) as HTMLElement | null
      const rootZone = el?.closest('.struct-root-drop')
      if (!rootZone && targetId === null) return
      const fatherIdStr = rootZone ? null : zone === 'on'
        ? String(targetId)
        : (parentMapRef.current.get(String(targetId)) ?? null)
      const fatherId = fatherIdStr != null ? Number(fatherIdStr) : null

      // Reihenfolge wie im Baum behalten; parallele Aufrufe (wie bis Runde 2)
      // ueberschrieben sich gegenseitig die SORT_ORDER.
      const flatNodes = flatTreeRef.current.map(({ node }) => node)
      const ordered = items
        .map(iid => flatNodes.find(n => n.ID === iid))
        .filter((n): n is OfferStructureNode => n != null)
        .filter(n => !isDescendant(fatherIdStr ?? -1, n.ID, parentMapRef.current))
        .sort((a, b) => flatNodes.indexOf(a) - flatNodes.indexOf(b))
        .map(n => n.ID)
      if (ordered.length === 0) return

      const lv = !rootZone && zone === 'on' ? leafValue(fatherId) : null
      if (lv) {
        const ok = await confirm({
          title: 'Honorar wird ersetzt',
          message: `„${lv.node.ABBR ?? ''}" hat ein eigenes Honorar von ${fmtEur(lv.fee)}. Als übergeordnetes Element zählt danach nur die Summe seiner Unterelemente — der bisherige Betrag entfällt. Trotzdem verschieben?`,
          confirmLabel: 'Verschieben',
          confirmClass: 'btn-primary',
        })
        if (!ok) return
      }

      try {
        if (zone === 'on' || rootZone) {
          for (const iid of ordered) await moveOfferStructureNode(oid, iid, { father_id: fatherId, sort_after_id: '__end__' })
        } else {
          const siblings = flatNodes.filter(n => (parentMapRef.current.get(String(n.ID)) ?? null) === fatherIdStr && !ordered.includes(n.ID))
          const idx = siblings.findIndex(n => n.ID === targetId)
          let sortAfterId: string | null = idx > 0 ? String(siblings[idx - 1].ID) : null
          for (const iid of ordered) {
            await moveOfferStructureNode(oid, iid, { father_id: fatherId, sort_after_id: sortAfterId })
            sortAfterId = String(iid)
          }
        }
        void invalidateOffer()
        toast.success(ordered.length > 1 ? `${ordered.length} Elemente verschoben` : 'Verschoben')
        if (items.length > 1) setSelectedIds(new Set())
      } catch (err) {
        setErrorMsg((err as Error).message ?? 'Fehler beim Verschieben')
        void invalidateOffer()
      }
    }

    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  // ── Summen ───────────────────────────────────────────────────────────────

  const offerLevelSurcharges = Number(offerDetail?.SURCHARGES_TOTAL ?? 0)
  const { rootRevenue, rootSurcharges, rootStructureRevenueSum, rootRevenueFinal, rootExtras, rootGesamt } =
    offerRootTotals(structure, aggMap, offerLevelSurcharges)

  const allIds = structure.map(n => n.ID)
  const allSelected = allIds.length > 0 && allIds.every(id => selectedIds.has(id))
  function toggleRow(id: number) {
    setSelectedIds(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n })
  }
  function toggleAll() { setSelectedIds(allSelected ? new Set() : new Set(allIds)) }

  const addParent  = addForm?.FATHER_ID ? nodeById.get(Number(addForm.FATHER_ID)) : undefined
  const addTakes   = addForm ? leafValue(addForm.FATHER_ID ? Number(addForm.FATHER_ID) : null) : null
  const COLS = cols.colCount

  // Zeilenmenue und Rechtsklick teilen sich dieselben Befehle.
  function rowCommands(node: OfferStructureNode) {
    const isParent = parentIds.has(String(node.ID))
    return [
      canEdit && { key: 'add',  label: 'Unterelement anlegen', run: () => openAdd(node.ID) },
      canEdit && { key: 'sur',  label: 'Zuschläge bearbeiten', run: () => setSurchargePanel(node.ID) },
      canCalc && { key: 'kalk', label: 'Kalkulation anlegen',  run: () => setKalkFatherId(node.ID) },
      canEdit && { key: 'del',  label: isParent ? 'Löschen (erst Unterelemente)' : 'Element löschen', danger: true, disabled: isParent, run: () => askDelete(node) },
    ].filter(Boolean) as { key: string; label: string; run: () => void; disabled?: boolean; danger?: boolean }[]
  }

  function openOfferSurcharges() {
    setRootEdit(rootEdit ?? surchargeDefault(offerDetail))
    setOfferSurchargePanel(true)
  }

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="sx-root">
      {oid === null && (
        <div className="sx-empty">
          <p className="empty-note">Kein Angebot gewählt.</p>
          <p className="sx-empty-why">In der Angebotsliste ein Angebot öffnen. Die Struktur gliedert das Honorar des Angebots — sie wird bei der Beauftragung zur Projektstruktur.</p>
        </div>
      )}

      {oid !== null && isLoading && <p className="empty-note">Lade Struktur …</p>}

      {oid !== null && !isLoading && (
        <>
          {!narrow && canEdit && selectedIds.size > 0 && (
            <div className="struct-bulk-bar">
              <span>{selectedIds.size} ausgewählt</span>
              <button type="button" className="btn-small" style={{ color: 'var(--danger)', borderColor: 'var(--danger)' }} onClick={bulkDelete}>
                Löschen ({selectedIds.size})
              </button>
              <button type="button" className="btn-small" onClick={() => setSelectedIds(new Set())}>Auswahl aufheben</button>
            </div>
          )}

          {dragIds.size > 0 && (
            <div className={`struct-root-drop${dragOverId === 'root' ? ' drag-over' : ''}`}>
              Hier ablegen → oberste Ebene
            </div>
          )}

          <div className="list-toolbar sx-toolbar">
            {flatTree.length > 0 && (
              <input type="search" className="list-search sx-search" placeholder="Elemente filtern …"
                aria-label="Elemente filtern"
                value={elementSearch} onChange={e => setElementSearch(e.target.value)} />
            )}
            <div className="sx-toolbar-right">
              {!narrow && flatTree.length > 0 && <ColumnChooser columns={STRUKTUR_SPALTEN} hidden={cols.hidden} onToggle={cols.toggle} />}
              {canEdit && (
                <button className="btn-secondary" type="button" onClick={() => openAdd(null)}>
                  <Plus size={15} strokeWidth={2.25} aria-hidden="true" /> Neues Element
                </button>
              )}
            </div>
          </div>

          <Message text={errorMsg} type="error" />

          {flatTree.length > 0 && narrow && (
            <OfferStrukturMobile offerId={oid} flat={filteredFlatTree} parentIds={parentIds} aggMap={aggMap}
              billingTypes={btypes} canEdit={canEdit}
              root={{ label: `${currentOffer?.ABBR ?? ''} · Angebot gesamt`, total: rootGesamt }}
              onAdd={openAdd} onDelete={askDelete} />
          )}

          {flatTree.length > 0 && !narrow && (
            <div className="list-section">
              <table className="master-table structure-table sx-table">
                <thead>
                  <tr>
                    <th scope="col" className="sx-col-check">
                      {canEdit && <input type="checkbox" checked={allSelected} onChange={toggleAll} aria-label="Alle auswählen" />}
                    </th>
                    <th scope="col" className="sx-col-grip"><span className="sr-only">Verschieben</span></th>
                    <th scope="col">
                      <span className="sx-th-element">
                        Element
                        {hasParents && (
                          <button type="button" className="sx-collapse-all" onClick={toggleAllCollapsed}
                            aria-label={allCollapsed ? 'Alle Ebenen aufklappen' : 'Alle Ebenen zuklappen'}
                            title={allCollapsed ? 'Alle aufklappen' : 'Alle zuklappen'}>
                            {allCollapsed ? <ChevronsUpDown size={13} strokeWidth={2} aria-hidden="true" /> : <ChevronsDownUp size={13} strokeWidth={2} aria-hidden="true" />}
                          </button>
                        )}
                      </span>
                    </th>
                    {cols.show('bt') && <th scope="col">Abrechnung</th>}
                    <th scope="col" className="num">
                      <span className="sx-th-element ox-th-fee">Honorar € <HelpHint id="offers.structure.hours" size={13} /></span>
                    </th>
                    {cols.show('sur') && <th scope="col" className="num">Zuschläge €</th>}
                    {showInklCol && <th scope="col" className="num" title="Honorar einschließlich Zuschlägen">inkl. Zuschl. €</th>}
                    {cols.show('nkpct') && <th scope="col">NK %</th>}
                    {cols.show('nk') && <th scope="col" className="num">Nebenkosten €</th>}
                    {cols.show('total') && <th scope="col" className="num">Gesamt €</th>}
                    <th scope="col" className="sx-col-menu">
                      <span className="sr-only">Aktionen</span>
                      <HelpHint id="structure.contextmenu" align="right" size={13} />
                    </th>
                  </tr>
                </thead>
                <tbody>
                  <tr className={`sx-root-row${rootChanged ? ' sx-row-changed' : ''}`}
                    onContextMenu={canEdit ? e => { e.preventDefault(); setContextMenu({ x: e.clientX, y: e.clientY, nodeId: null }) } : undefined}>
                    <td></td>
                    <td></td>
                    <td className="sx-cell-element">
                      <span className="sx-root-abbr">{currentOffer?.ABBR ?? ''}</span>
                      <span className="sx-root-name">Angebot gesamt</span>
                    </td>
                    {cols.show('bt') && <td className="sx-muted">—</td>}
                    <td className="num sx-muted">{money(rootRevenue)}</td>
                    {cols.show('sur') && <td className="num"><span className="sx-surcharge-static"><SurchargeAmount value={rootSurcharges} /></span></td>}
                    {showInklCol && <td className="num">{money(rootRevenueFinal)}</td>}
                    {cols.show('nkpct') && <td className="sx-muted">—</td>}
                    {cols.show('nk') && <td className="num sx-muted">{money(rootExtras)}</td>}
                    {cols.show('total') && <td className="num sx-strong" title={showInklCol ? undefined : `Honorar inkl. Zuschläge ${fmtEur(rootRevenueFinal)} + Nebenkosten ${fmtEur(rootExtras)}`}>{money(rootGesamt)}</td>}
                    <td className="sx-col-menu">
                      {canEdit && (
                        <RowMenu label="Aktionen zum Angebot" triggerClassName="row-action-btn">
                          <button type="button" role="menuitem" className="row-menu-item" onClick={openOfferSurcharges}>
                            Angebotszuschläge bearbeiten
                          </button>
                        </RowMenu>
                      )}
                    </td>
                  </tr>
                  {offerSurchargePanel && (() => {
                    const sE = rootEdit ?? surchargeDefault(offerDetail)
                    return (
                      <SurchargePanelRow
                        colSpan={COLS} title="Angebotszuschläge – Basis (Summe Wurzel-Honorar)" basis={rootStructureRevenueSum}
                        edit={sE} computed={computeSurcharges(rootStructureRevenueSum, sE)} readOnly={!canEdit}
                        onChange={f => setRootEdit({ ...sE, ...f })}
                        onDone={() => setOfferSurchargePanel(false)}
                      />
                    )
                  })()}

                  {filteredFlatTree.map(({ node, depth }) => {
                    const edit      = edits[node.ID]
                    const changes   = offerRowChanges(node, edit)
                    const isParent  = parentIds.has(String(node.ID))
                    const nameShort = edit?.nameShort     ?? (node.ABBR ?? '')
                    const nameLong  = edit?.nameLong      ?? (node.NAME ?? '')
                    const btId      = edit?.billingTypeId ?? String(node.BILLING_TYPE_ID ?? '')
                    const nkVal     = edit?.nk            ?? String(node.EXTRAS_PERCENT ?? 0)
                    const budgetVal = edit?.budget        ?? String(node.REVENUE_BASIS ?? node.REVENUE ?? 0)
                    const hourly    = !isParent && isHourlyBt(btId)
                    const { hours, rate } = hoursRate(node, edit)
                    const isDragOver = dragOverId === node.ID

                    const sEdit = edit?.surcharge ?? surchargeDefault(node)
                    // Zuschlaege eines Vaters rechnen auf die Summe der Kinder, eines Blatts auf sein Honorar
                    const surchargeBase = isParent ? Number(node.REVENUE_BASIS ?? 0) : offerLeafFee(node, edit)
                    const computed = computeSurcharges(surchargeBase, sEdit)
                    const surchargeChanged = changes.SURCHARGE_1_CUMUL !== undefined
                    const hasSurcharges = Number(node.SURCHARGES_TOTAL ?? 0) !== 0
                    const cmds = rowCommands(node)
                    const ch = (f: keyof OfferPutBody) => changes[f] !== undefined ? ' sx-changed' : ''
                    const agg = aggMap.get(String(node.ID))

                    return (
                      <React.Fragment key={node.ID}>
                      <tr
                        data-struct-id={node.ID}
                        className={[
                          isParent ? 'struct-row-parent' : '',
                          Object.keys(changes).length ? 'sx-row-changed' : '',
                          isDragOver && dragZone === 'on'    ? 'ps-drag-over'  : '',
                          isDragOver && dragZone === 'above' ? 'ps-drop-above' : '',
                          dragIds.has(node.ID) ? 'ps-dragging' : '',
                        ].filter(Boolean).join(' ')}
                        onContextMenu={cmds.length ? e => { e.preventDefault(); setContextMenu({ x: e.clientX, y: e.clientY, nodeId: node.ID }) } : undefined}
                        onTouchStart={cmds.length ? () => { longPressRef.current = setTimeout(() => setContextMenu({ x: 0, y: 0, nodeId: node.ID }), 600) } : undefined}
                        onTouchEnd={() => { if (longPressRef.current) { clearTimeout(longPressRef.current); longPressRef.current = null } }}
                        onTouchMove={() => { if (longPressRef.current) { clearTimeout(longPressRef.current); longPressRef.current = null } }}
                      >
                        <td className="sx-col-check">
                          {canEdit && <input type="checkbox" checked={selectedIds.has(node.ID)}
                            aria-label={`${node.ABBR ?? ''} auswählen`} onChange={() => toggleRow(node.ID)} />}
                        </td>
                        <td className="sx-col-grip">
                          {canEdit && (
                            <span className="ps-drag-handle" title="Halten und ziehen zum Verschieben"
                              onPointerDown={e => handleHandlePointerDown(e, node.ID)}>
                              <GripVertical size={14} strokeWidth={2} aria-hidden="true" />
                            </span>
                          )}
                        </td>
                        <td className="sx-cell-element" style={{ paddingLeft: `calc(var(--sx-pad-x) + ${depth} * var(--sx-indent))` }}>
                          <div className="sx-element">
                            {isParent ? (
                              <button type="button" className="sx-twisty" onClick={() => toggleCollapsed(node.ID)}
                                aria-expanded={!collapsed.has(node.ID)}
                                aria-label={`${nameShort} ${collapsed.has(node.ID) ? 'aufklappen' : 'zuklappen'}`}>
                                <ChevronRight size={14} strokeWidth={2} aria-hidden="true" />
                              </button>
                            ) : <span className="sx-twisty-space" aria-hidden="true" />}
                            {canEdit ? (
                              <input className={`tbl-input sx-input sx-input-abbr${isParent ? ' sx-input-parent' : ''}${ch('abbr')}`}
                                aria-label="Kürzel" value={nameShort}
                                onChange={e => editRow(node.ID, { nameShort: e.target.value })} />
                            ) : <span className={`sx-abbr-text${isParent ? ' sx-strong' : ''}`}>{nameShort}</span>}
                            {canEdit ? (
                              <input className={`tbl-input sx-input sx-input-name${ch('name')}`}
                                aria-label="Bezeichnung" title={nameLong} value={nameLong}
                                onChange={e => editRow(node.ID, { nameLong: e.target.value })} />
                            ) : <span className="sx-name-text" title={nameLong}>{nameLong}</span>}
                            {isParent && collapsed.has(node.ID) && (
                              <span className="sx-collapsed-count">{descendantCount(node.ID)} ausgeblendet</span>
                            )}
                            {hourly && node.ROLE_ABBR && (
                              <span className="ox-role" title={node.ROLE_NAME ? `Rolle: ${node.ROLE_NAME}` : 'Rolle'}>{node.ROLE_ABBR}</span>
                            )}
                          </div>
                        </td>
                        {cols.show('bt') && (
                        <td>
                          {canEdit ? (
                            <select className={`tbl-select sx-input sx-input-bt${ch('billing_type_id')}`} aria-label="Abrechnungsart" value={btId}
                              onChange={e => editRow(node.ID, { billingTypeId: e.target.value })}>
                              {btypes.map(b => <option key={b.ID} value={b.ID}>{b.ABBR}</option>)}
                            </select>
                          ) : btypes.find(b => String(b.ID) === btId)?.ABBR ?? '—'}
                        </td>
                        )}
                        <td className="num">
                          {hourly && canEdit ? (
                            // Aufwand: Stunden × Satz statt eines Betrags. Das Produkt steht
                            // im Tooltip, in „inkl. Zuschl." und in „Gesamt".
                            <span className="ox-hours" title={`Honorar = ${hours} h × ${fmtEur(Number(rate))} = ${fmtEur(offerLeafFee(node, edit))}`}>
                              <input className={`tbl-input sx-input ox-input-hours${ch('quantity')}`} type="text" inputMode="decimal"
                                aria-label={`Stunden ${nameShort}`} value={hours}
                                onChange={e => editRow(node.ID, { hours: e.target.value.replace(',', '.') })} />
                              <span className="ox-times" aria-hidden="true">h ×</span>
                              <AmountInput className={`tbl-input sx-input ox-input-rate${ch('hourly_rate')}`}
                                aria-label={`Stundensatz ${nameShort}`} value={rate}
                                onChange={v => editRow(node.ID, { rate: v })} />
                            </span>
                          ) : isParent || hourly || !canEdit ? (
                            <span className="sx-muted" title={hourly ? `${hours} h × ${fmtEur(Number(rate))}` : isParent ? 'Summe der Unterelemente' : undefined}>
                              {money(isParent ? (agg?.revenueBasis ?? 0) : offerLeafFee(node, edit))}
                            </span>
                          ) : (
                            <AmountInput className={`tbl-input sx-input sx-input-num${ch('revenue')}`}
                              aria-label="Honorar" value={budgetVal}
                              onChange={v => editRow(node.ID, { budget: v })} />
                          )}
                        </td>
                        {cols.show('sur') && (
                        <td className="num">
                          {(() => {
                            const sv = surchargeChanged ? computed.total : isParent ? (agg?.surcharges ?? 0) : Number(node.SURCHARGES_TOTAL ?? 0)
                            return canEdit ? (
                              <button type="button" className={`sx-surcharge-btn${surchargeChanged ? ' sx-changed' : ''}`}
                                aria-label={`Zuschläge von ${nameShort} bearbeiten`}
                                onClick={() => setSurchargePanel(p => p === node.ID ? null : node.ID)}>
                                <SurchargeAmount value={sv} />
                              </button>
                            ) : <span className="sx-surcharge-static"><SurchargeAmount value={sv} /></span>
                          })()}
                        </td>
                        )}
                        {showInklCol && (
                          <td className={`num${hasSurcharges ? ' sx-strong' : ''}`}>{money(Number(node.REVENUE ?? 0))}</td>
                        )}
                        {cols.show('nkpct') && (
                        <td>
                          {canEdit ? (
                            <input className={`tbl-input sx-input sx-input-pct${ch('extras_percent')}`} type="text" inputMode="decimal"
                              aria-label="Nebenkosten in Prozent" value={nkVal}
                              onChange={e => editRow(node.ID, { nk: e.target.value.replace(',', '.') })} />
                          ) : `${nkVal} %`}
                        </td>
                        )}
                        {cols.show('nk') && <td className="num">{money(isParent ? agg?.extras : node.EXTRAS)}</td>}
                        {cols.show('total') && (() => {
                          const rev = Number(node.REVENUE ?? 0)
                          const ext = isParent ? (agg?.extras ?? 0) : Number(node.EXTRAS ?? 0)
                          return (
                            <td className="num sx-strong" title={showInklCol ? undefined : `Honorar inkl. Zuschläge ${fmtEur(rev)} + Nebenkosten ${fmtEur(ext)}`}>
                              {fmtEur(rev + ext)}
                            </td>
                          )
                        })()}
                        <td className="sx-col-menu">
                          {cmds.length > 0 && (
                            <RowMenu label={`Aktionen zu ${node.ABBR ?? ''}`} triggerClassName="row-action-btn">
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
                      {surchargePanel === node.ID && (
                        <SurchargePanelRow
                          colSpan={COLS} title={`Zuschläge ${node.ABBR ?? ''} – Basis (Honorar)`} basis={surchargeBase}
                          edit={sEdit} computed={computed} readOnly={!canEdit}
                          onChange={f => editRow(node.ID, { surcharge: { ...sEdit, ...f } })}
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
              <p className="empty-note">Dieses Angebot hat noch keine Struktur.</p>
              <p className="sx-empty-why">Die Struktur gliedert das Honorar (z. B. Leistungsphasen oder Stunden nach Aufwand). Sie steht so im Angebots-PDF und wird bei der Beauftragung zur Projektstruktur.</p>
              {canEdit && (
                <button type="button" className="btn-secondary" onClick={() => openAdd(null)}>
                  <Plus size={15} strokeWidth={2.25} aria-hidden="true" /> Erstes Element anlegen
                </button>
              )}
            </div>
          )}

          {canEdit && flatTree.length > 0 && !narrow && (
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
              <HelpHint id="offers.structure.save" align="right" />
              <button className="btn-primary" type="button" onClick={() => void saveAll().catch(() => {})} disabled={!dirty || saving}>
                {saving ? 'Speichert …' : <>Speichern <kbd>Strg+S</kbd></>}
              </button>
            </ActionBar>
          )}
        </>
      )}

      {/* ── Neues Element ── */}
      <Modal open={addForm !== null} onClose={() => { setAddForm(null); setAddError(null) }} title="Neues Element anlegen">
        {addForm && (() => {
          const hourly = isHourlyBt(addForm.BILLING_TYPE_ID)
          const set = (patch: Partial<AddForm>) => setAddForm(f => f && { ...f, ...patch })
          return (
            <form className="sx-add-form" onSubmit={e => { e.preventDefault(); submitAdd() }}>
              <p className="sx-add-context">
                {addParent ? <>unter <strong>{addParent.ABBR}</strong>{addParent.NAME ? ` · ${addParent.NAME}` : ''}</> : 'auf oberster Ebene des Angebots'}
              </p>
              <div className="sx-add-grid">
                <div className="form-group">
                  <label htmlFor="ox-add-abbr">Kürzel*</label>
                  <input id="ox-add-abbr" autoFocus value={addForm.ABBR} placeholder="z. B. LP3"
                    onChange={e => set({ ABBR: e.target.value })} />
                </div>
                <div className="form-group">
                  <label htmlFor="ox-add-bt">Abrechnungsart*</label>
                  <select id="ox-add-bt" value={addForm.BILLING_TYPE_ID} onChange={e => set({ BILLING_TYPE_ID: e.target.value })}>
                    <option value="">Bitte wählen …</option>
                    {btypes.map(b => <option key={b.ID} value={b.ID}>{b.ABBR}{b.NAME ? ' – ' + b.NAME : ''}</option>)}
                  </select>
                </div>
                <div className="form-group sx-add-wide">
                  <label htmlFor="ox-add-name">Bezeichnung</label>
                  <input id="ox-add-name" value={addForm.NAME} onChange={e => set({ NAME: e.target.value })} />
                </div>
                {hourly ? (
                  <>
                    <div className="form-group">
                      <label htmlFor="ox-add-role">Rolle</label>
                      <select id="ox-add-role" value={addForm.ROLE_ID}
                        onChange={e => {
                          const role = roles.find(r => String(r.ID) === e.target.value)
                          set({
                            ROLE_ID: e.target.value,
                            ROLE_ABBR: role?.ABBR ?? '',
                            ROLE_NAME: role?.NAME ?? '',
                            ...(role?.HOURLY_RATE != null ? { HOURLY_RATE: String(role.HOURLY_RATE) } : {}),
                          })
                        }}>
                        <option value="">— ohne Rolle —</option>
                        {roles.map(r => <option key={r.ID} value={r.ID}>{r.ABBR}{r.NAME ? ' – ' + r.NAME : ''}</option>)}
                      </select>
                    </div>
                    <div className="form-group">
                      <label htmlFor="ox-add-hours">Stunden</label>
                      <input id="ox-add-hours" type="text" inputMode="decimal" placeholder="0" value={addForm.QUANTITY}
                        onChange={e => set({ QUANTITY: e.target.value.replace(',', '.') })} />
                    </div>
                    <div className="form-group">
                      <label htmlFor="ox-add-rate">Satz €/h</label>
                      <AmountInput id="ox-add-rate" value={addForm.HOURLY_RATE} placeholder="0,00"
                        onChange={v => set({ HOURLY_RATE: v })} />
                    </div>
                    <div className="form-group">
                      <label htmlFor="ox-add-fee">Honorar</label>
                      <output id="ox-add-fee" className="sxm-readonly">{fmtEur((Number(addForm.QUANTITY) || 0) * (Number(addForm.HOURLY_RATE) || 0))}
                        <span className="form-field-hint">Stunden × Satz</span></output>
                    </div>
                  </>
                ) : (
                  <div className="form-group">
                    <label htmlFor="ox-add-rev">Honorar €</label>
                    <AmountInput id="ox-add-rev" value={addForm.REVENUE} placeholder="0,00" onChange={v => set({ REVENUE: v })} />
                  </div>
                )}
                <div className="form-group">
                  <label htmlFor="ox-add-nk">Nebenkosten %</label>
                  <input id="ox-add-nk" type="text" inputMode="decimal" placeholder="0" value={addForm.EXTRAS_PERCENT}
                    onChange={e => set({ EXTRAS_PERCENT: e.target.value.replace(',', '.') })} />
                </div>
                <div className="form-group sx-add-wide">
                  <label htmlFor="ox-add-father">Übergeordnetes Element</label>
                  <select id="ox-add-father" value={addForm.FATHER_ID}
                    onChange={e => {
                      const fid = e.target.value ? Number(e.target.value) : null
                      setAddForm(f => f && withParent({ ...f, FATHER_ID: e.target.value }, fid))
                    }}>
                    <option value="">— oberste Ebene —</option>
                    {flatTree.map(({ node, depth }) => (
                      <option key={node.ID} value={node.ID}>
                        {'  '.repeat(depth)}{node.ABBR}{node.NAME ? ' – ' + node.NAME : ''}
                      </option>
                    ))}
                  </select>
                  {addTakes && (
                    <span className="form-field-hint">
                      „{addTakes.node.ABBR}" hat bisher ein eigenes Honorar von {fmtEur(addTakes.fee)}. Es ist hier vorbelegt — als
                      übergeordnetes Element zeigt „{addTakes.node.ABBR}" danach die Summe seiner Unterelemente.
                    </span>
                  )}
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
          )
        })()}
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
            onDone={() => { setKalkFatherId(null); void invalidateOffer() }}
          />
        )}
      </Modal>

      {contextMenu && (() => {
        const cmNode = contextMenu.nodeId != null ? nodeById.get(contextMenu.nodeId) : undefined
        const isMultiDelete = contextMenu.nodeId != null && selectedIds.has(contextMenu.nodeId) && selectedIds.size > 1
        const style: React.CSSProperties = contextMenu.x === 0
          ? { position: 'fixed', top: '40%', left: '50%', transform: 'translate(-50%,-50%)', zIndex: 1500 }
          : contextMenuStyle
        const cmds = cmNode ? rowCommands(cmNode) : []
        return (
          <div className="struct-context-menu" ref={contextMenuRef} style={style} role="menu">
            {cmNode ? cmds.filter(c => !c.danger || !isMultiDelete).map(c => (
              <button key={c.key} type="button" role="menuitem" disabled={c.disabled}
                className={c.danger ? 'struct-context-danger' : undefined}
                onClick={() => { c.run(); setContextMenu(null) }}>{c.label}</button>
            )) : (
              <>
                <button type="button" role="menuitem" onClick={() => { openAdd(null); setContextMenu(null) }}>
                  Element auf oberster Ebene anlegen
                </button>
                <button type="button" role="menuitem" onClick={() => { openOfferSurcharges(); setContextMenu(null) }}>
                  Angebotszuschläge bearbeiten
                </button>
              </>
            )}
            {isMultiDelete && canEdit && (
              <>
                <div className="struct-context-divider" />
                <button type="button" role="menuitem" className="struct-context-danger" onClick={() => {
                  const ids = Array.from(selectedIds)
                  setConfirmState({
                    title: `${ids.length} Elemente löschen`,
                    message: `${ids.length} Elemente löschen?\nEin Element mit Unterelementen lässt sich nur zusammen mit ihnen löschen.`,
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
