import { useState, useEffect, useMemo, useRef } from 'react'
import { ListLoading } from '@/components/ui/Skeleton'
import { FilterChip } from '@/components/ui/FilterChip'
import { FilterBar } from '@/components/ui/FilterBar'
import { SortTh } from '@/components/ui/SortTh'
import { RowMenu } from '@/components/ui/RowMenu'
import { DialogFooter } from '@/components/ui/DialogFooter'
import { DensityToggle } from '@/components/ui/DensityToggle'
import { useDensity } from '@/hooks/useDensity'
import { useStickyState, useStickySet } from '@/hooks/useStickyState'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Message }     from '@/components/ui/Message'
import { Modal }       from '@/components/ui/Modal'
import { Pencil, Trash2, ArrowRightLeft, Plus, ChevronDown, Lock } from 'lucide-react'
import { usePermission } from '@/store/permissionsStore'
import { ConfirmModal } from '@/components/ui/ConfirmModal'
import { FormField }   from '@/components/ui/FormField'
import {
  fetchProjectStructure, fetchBuchungen, createBuchung, updateBuchung, deleteBuchung,
  type Buchung, type UpdateBuchungPayload,
} from '@/api/projekte'
import { fetchActiveEmployees, type ActiveEmployee } from '@/api/projekte'
import {
  fetchSelectableBookingTypes, createSpecialBuchung, updateSpecialBuchung, BOOKING_KIND_LABEL,
  type BookingKind, type SelectableBookingType,
} from '@/api/bookingTypes'
import { TextSnippetBar } from '@/components/ui/TextSnippetBar'
import { HelpHint } from '@/components/ui/HelpHint'
import { useAuthStore } from '@/store/authStore'
import { useCtrlS } from '@/hooks/useCtrlS'
import { UmbuchenModal } from './UmbuchenModal'
import { parentStructureIds, structurePaths } from '@/utils/treeUtils'
import { useIsNarrow } from '@/hooks/useIsNarrow'
import { useQuickBooking } from '@/store/quickBookingStore'
import { localIsoDate } from '@/utils/zeit'
import { money } from '@/utils/money'
import { useToast } from '@/store/toastStore'

const FMT_NUM = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 2 })
const fmtN    = (v: number | null | undefined) => v == null ? '—' : FMT_NUM.format(v)
const fmtDate = (v: string | null) => v ? v.slice(0, 10) : ''
/** 2026-07-01 → 01.07.2026 — die ISO-Form stand vorher so in der Tabelle. */
/** „LPH > LP5 > LP5.1: Ausführungsplanung" → „LP5.1: Ausführungsplanung" (Pfad steht im title). */
const leafOf = (path: string) => path.includes(' > ') ? path.slice(path.lastIndexOf(' > ') + 3) : path
const fmtDateDe = (v: string | null) => {
  const d = fmtDate(v)
  return d ? `${d.slice(8, 10)}.${d.slice(5, 7)}.${d.slice(0, 4)}` : ''
}

const SPECIAL_KINDS = new Set(['UNIT', 'LUMP_COST', 'LUMP_REVENUE'])
const isSpecialKind = (k?: string | null) => !!k && SPECIAL_KINDS.has(k)
const isBreakRow = (b?: Buchung | null) => b?.ENTRY_KIND === 'BREAK'
const KIND_BADGE: Record<string, string> = { UNIT: 'Stück', LUMP_COST: 'Pauschale K', LUMP_REVENUE: 'Pauschale E' }

/** Zeigt an, ob eine Buchung bereits einer Rechnung/Abschlag zugeordnet (abgerechnet) ist. */
const isBilled = (b: Buchung) => b.ADVANCE_INVOICE_ID != null || b.INVOICE_ID != null

/** Hat die Buchung einen abrechenbaren (externen) Anteil? Für „0 extern ausblenden". */
function hasBillable(b: Buchung): boolean {
  if (isBreakRow(b))              return false            // Pause: kostenneutral
  if (b.BOOKING_KIND === 'LUMP_COST')    return false    // reine Kostenpauschale
  if (b.BOOKING_KIND === 'LUMP_REVENUE') return (Number(b.HOURLY_RATE_TOTAL) || 0) !== 0
  return (Number(b.QUANTITY_EXT) || 0) !== 0             // Stunden & Stückleistungen
}

/** Menschlicher Buchungstyp-Name für Filter & Anzeige. */
function bookingTypeLabel(b: Buchung): string {
  if (isBreakRow(b)) return 'Pause'
  switch (b.BOOKING_KIND) {
    case 'UNIT':         return 'Stück'
    case 'LUMP_COST':    return 'Pauschale K'
    case 'LUMP_REVENUE': return 'Pauschale E'
    default:             return 'Stunden'
  }
}

// Lokales Datum — das UTC-Datum ist zwischen 0 und 2 Uhr noch gestern.
function todayIso() { return localIsoDate() }

interface BuchungForm {
  EMPLOYEE_ID:         string
  STRUCTURE_ID:        string
  BOOKING_DATE:        string
  TIME_START:          string
  TIME_FINISH:         string
  QUANTITY_INT:        string
  COST_RATE:             string
  QUANTITY_EXT:        string
  HOURLY_RATE:             string
  POSTING_DESCRIPTION: string
}

function emptyForm(): BuchungForm {
  return {
    EMPLOYEE_ID: String(useAuthStore.getState().employeeId ?? ''), STRUCTURE_ID: '', BOOKING_DATE: todayIso(),
    TIME_START: '', TIME_FINISH: '',
    QUANTITY_INT: '', COST_RATE: '', QUANTITY_EXT: '', HOURLY_RATE: '',
    POSTING_DESCRIPTION: '',
  }
}

function buchungToForm(b: Buchung): BuchungForm {
  return {
    EMPLOYEE_ID:         String(b.EMPLOYEE_ID),
    STRUCTURE_ID:        b.STRUCTURE_ID != null ? String(b.STRUCTURE_ID) : '',
    BOOKING_DATE:        fmtDate(b.BOOKING_DATE),
    TIME_START:          b.TIME_START ?? '',
    TIME_FINISH:         b.TIME_FINISH ?? '',
    QUANTITY_INT:        String(b.QUANTITY_INT),
    COST_RATE:             String(b.COST_RATE),
    QUANTITY_EXT:        String(b.QUANTITY_EXT),
    HOURLY_RATE:             String(b.HOURLY_RATE),
    POSTING_DESCRIPTION: b.POSTING_DESCRIPTION,
  }
}

type SortCol = 'date' | 'employee' | 'path' | 'description' | 'h_int' | 'h_ext' | 'cost' | 'revenue'
type SortDir = 'asc' | 'desc'

interface Props { initialProjectId?: number }

/**
 * Buchungen eines Projekts (UI-Pilot 2026-09).
 *
 * Vorher: Werkzeugleiste, darunter eine eigene Zeile mit bis zu fuenf
 * Anlegen-Knoepfen (Stunden, Pause, Stueck, Pauschale K, Pauschale E), ein
 * eigener Stunden-Dialog mit „Speichern" links neben „Abbrechen", ISO-Daten
 * in der Tabelle und ungegatete Zeilenaktionen. Jetzt:
 *  - eine Leiste nach dem Listen-Standard; rechts EINE Hauptaktion
 *    „+ Stunden buchen" (derselbe Dialog wie „Zeit buchen" in der Kopfzeile)
 *    und die seltenen Arten hinter „Weitere Buchungsarten";
 *  - deutsche Daten, Betraege ueber money(), sortierbare Koepfe ueber SortTh;
 *  - Bearbeiten/Loeschen nur mit dem jeweiligen Recht;
 *  - auf dem Handy eine Summenzeile und vier Spalten statt neun.
 */
export function Buchungen({ initialProjectId }: Props = {}) {
  const qc = useQueryClient()
  const toast = useToast()
  const openQuickBooking = useQuickBooking(s => s.open)
  const [density, setDensity] = useDensity()

  // Phase 6: Sichtbarkeit Erloese / Kosten
  const showRevenue = usePermission('projects.bookings.revenue.view')
  const showCosts   = usePermission('projects.bookings.costs.view')
  const canSpecial  = usePermission('projects.bookings.special.create')
  const canCreate   = usePermission('projects.bookings.create')
  const canEdit     = usePermission('projects.bookings.edit')
  const canDelete   = usePermission('projects.bookings.delete')
  // Umbuchen steht unter einem eigenen Recht: es verschiebt Kosten und Erlös
  // zwischen Projekten (Migration 0139).
  const canRebook   = usePermission('projects.bookings.rebook')
  const narrow      = useIsNarrow()
  const [specialKind, setSpecialKind] = useState<BookingKind | null>(null)
  const [editSpecial, setEditSpecial] = useState<Buchung | null>(null)
  const [pauseModal,  setPauseModal]  = useState<{ mode: 'create' | 'edit'; row?: Buchung } | null>(null)
  const pid = initialProjectId ?? null
  const [msg,          setMsg]          = useState<{ text: string; type: 'success'|'error' } | null>(null)
  const [filterStruct,  setFilterStruct]  = useState<string>('')
  const [search,        setSearch]        = useState('')
  const [filterEmp,     setFilterEmp]     = useStickySet('buchungen.emp')
  const [filterKind,    setFilterKind]    = useStickySet('buchungen.kind')
  const [filterStatus,  setFilterStatus]  = useStickySet('buchungen.status')
  const [hideZeroExt,   setHideZeroExt]   = useStickyState<boolean>('buchungen.hideZeroExt', false)
  const [dateFrom,      setDateFrom]      = useState('')
  const [dateTo,        setDateTo]        = useState('')
  const [sortCol,      setSortCol]      = useStickyState<SortCol>('buchungen.sortCol', 'date')
  const [sortDir,      setSortDir]      = useStickyState<SortDir>('buchungen.sortDir', 'asc')
  const [editRow,      setEditRow]      = useState<Buchung | null>(null)
  const [editForm,     setEditForm]     = useState<BuchungForm>(emptyForm)
  const [editMsg,      setEditMsg]      = useState<{ text: string; type: 'success'|'error' } | null>(null)
  const [confirmState, setConfirmState] = useState<{ title: string; message: string; onConfirm: () => void } | null>(null)
  // Mehrfachauswahl für das Umbuchen. Auf Handy-Breite entfällt sie (die
  // Spalte kostet dort 44px) — einzeln umbuchen geht über die Zeilenaktion.
  const [selected,    setSelected]    = useState<Set<number>>(new Set())
  const [rebookRows,  setRebookRows]  = useState<Buchung[] | null>(null)

  const { data: empData }       = useQuery({ queryKey: ['active-employees'], queryFn: fetchActiveEmployees })
  const { data: buchData, isLoading } = useQuery({
    queryKey: ['buchungen', pid],
    queryFn:  () => fetchBuchungen(pid!),
    enabled:  pid !== null,
  })
  const { data: structData } = useQuery({
    queryKey: ['structure', pid],
    queryFn:  () => fetchProjectStructure(pid!),
    enabled:  pid !== null,
  })

  const employees = empData?.data      ?? []

  useEffect(() => { setFilterStruct(''); setSearch(''); setDateFrom(''); setDateTo('') }, [pid])

  const buchungen = useMemo(() => buchData?.data ?? [], [buchData])
  const structure = useMemo(() => structData?.data ?? [], [structData])

  const parentIds = useMemo(() => parentStructureIds(structure), [structure])
  // Pfade („LP1 > LP5: Ausführungsplanung") kommen aus treeUtils — derselbe
  // Baustein, den der Umbuchen-Dialog für das Zielprojekt nutzt.
  const pathCache = useMemo(() => structurePaths(structure), [structure])

  const childrenMap = useMemo(() => {
    const m = new Map<number, number[]>()
    for (const n of structure) {
      if (n.FATHER_ID != null) {
        const fid = Number(n.FATHER_ID)
        if (!m.has(fid)) m.set(fid, [])
        m.get(fid)!.push(n.STRUCTURE_ID)
      }
    }
    return m
  }, [structure])

  const allStructureSorted = useMemo(() =>
    [...structure].sort((a, b) =>
      (pathCache.get(a.STRUCTURE_ID) ?? '').localeCompare(pathCache.get(b.STRUCTURE_ID) ?? '', 'de', { numeric: true })),
    [structure, pathCache]
  )

  const leafStructure = useMemo(() =>
    allStructureSorted.filter(n => !parentIds.has(n.STRUCTURE_ID)),
    [allStructureSorted, parentIds]
  )

  const filterDescendants = useMemo(() => {
    if (!filterStruct) return null
    const result = new Set<number>()
    const queue = [Number(filterStruct)]
    while (queue.length) {
      const cur = queue.shift()!
      result.add(cur)
      for (const child of (childrenMap.get(cur) ?? [])) queue.push(child)
    }
    return result
  }, [filterStruct, childrenMap])

  // Filter-Optionen aus den geladenen Daten ableiten (keine harten Listen).
  const empOptions = useMemo(
    () => [...new Set(buchungen.map(b => b.EMPLOYEE?.ABBR).filter((n): n is string => !!n))]
      .sort((a, b) => a.localeCompare(b, 'de')),
    [buchungen],
  )
  const kindOptions = useMemo(
    () => ['Stunden', 'Pause', 'Stück', 'Pauschale K', 'Pauschale E']
      .filter(k => buchungen.some(b => bookingTypeLabel(b) === k)),
    [buchungen],
  )
  const statusOptions = useMemo(
    () => ['Offen', 'Abgerechnet'].filter(s => buchungen.some(b => (isBilled(b) ? 'Abgerechnet' : 'Offen') === s)),
    [buchungen],
  )

  const visibleBuchungen = useMemo(() => {
    let rows = buchungen

    if (filterDescendants !== null) {
      rows = rows.filter(b => b.STRUCTURE_ID != null && filterDescendants.has(b.STRUCTURE_ID))
    }

    if (filterEmp.size)    rows = rows.filter(b => !!b.EMPLOYEE?.ABBR && filterEmp.has(b.EMPLOYEE.ABBR))
    if (filterKind.size)   rows = rows.filter(b => filterKind.has(bookingTypeLabel(b)))
    if (filterStatus.size) rows = rows.filter(b => filterStatus.has(isBilled(b) ? 'Abgerechnet' : 'Offen'))
    if (hideZeroExt)       rows = rows.filter(hasBillable)
    if (dateFrom)          rows = rows.filter(b => fmtDate(b.BOOKING_DATE) >= dateFrom)
    if (dateTo)            rows = rows.filter(b => fmtDate(b.BOOKING_DATE) <= dateTo)

    if (search.trim()) {
      const q = search.trim().toLowerCase()
      rows = rows.filter(b =>
        fmtDate(b.BOOKING_DATE).includes(q) || fmtDateDe(b.BOOKING_DATE).includes(q) ||
        (b.EMPLOYEE?.ABBR ?? '').toLowerCase().includes(q) ||
        (b.POSTING_DESCRIPTION ?? '').toLowerCase().includes(q) ||
        (b.STRUCTURE_ID != null ? (pathCache.get(b.STRUCTURE_ID) ?? '').toLowerCase().includes(q) : false)
      )
    }

    rows = [...rows].sort((a, b) => {
      let cmp = 0
      switch (sortCol) {
        case 'date':        cmp = (a.BOOKING_DATE ?? '').localeCompare(b.BOOKING_DATE ?? ''); break
        case 'employee':    cmp = (a.EMPLOYEE?.ABBR ?? '').localeCompare(b.EMPLOYEE?.ABBR ?? '', 'de'); break
        case 'path':        cmp = (a.STRUCTURE_ID != null ? pathCache.get(a.STRUCTURE_ID) ?? '' : '').localeCompare(b.STRUCTURE_ID != null ? pathCache.get(b.STRUCTURE_ID) ?? '' : '', 'de', { numeric: true }); break
        case 'description': cmp = (a.POSTING_DESCRIPTION ?? '').localeCompare(b.POSTING_DESCRIPTION ?? '', 'de'); break
        case 'h_int':       cmp = (a.QUANTITY_INT ?? 0) - (b.QUANTITY_INT ?? 0); break
        case 'h_ext':       cmp = (a.QUANTITY_EXT ?? 0) - (b.QUANTITY_EXT ?? 0); break
        case 'cost':        cmp = (a.COST_TOTAL ?? 0) - (b.COST_TOTAL ?? 0); break
        case 'revenue':     cmp = (a.HOURLY_RATE_TOTAL ?? 0) - (b.HOURLY_RATE_TOTAL ?? 0); break
      }
      return sortDir === 'asc' ? cmp : -cmp
    })

    return rows
  }, [buchungen, filterDescendants, filterEmp, filterKind, filterStatus, hideZeroExt, dateFrom, dateTo, search, sortCol, sortDir, pathCache])

  const totalIntH = visibleBuchungen.reduce((s, b) => s + (isSpecialKind(b.BOOKING_KIND) || isBreakRow(b) ? 0 : Number(b.QUANTITY_INT) || 0), 0)
  const totalExtH = visibleBuchungen.reduce((s, b) => s + (isSpecialKind(b.BOOKING_KIND) || isBreakRow(b) ? 0 : Number(b.QUANTITY_EXT) || 0), 0)
  const totalCost = visibleBuchungen.reduce((s, b) => s + (Number(b.COST_TOTAL) || 0), 0)
  const totalRev  = visibleBuchungen.reduce((s, b) => s + (Number(b.HOURLY_RATE_TOTAL) || 0), 0)

  // ── Auswahl fürs Umbuchen ─────────────────────────────────────────────────
  // Auswählbar ist, was sich überhaupt verschieben lässt: Pausen liegen auf
  // keinem Projektelement, abgerechnete Buchungen stecken in einem Beleg.
  // Entwürfe der Stempeluhr erkennt erst der Server (STATUS ist nicht in der
  // Liste) — er überspringt sie und sagt es in der Vorschau.
  const isRebookable = (b: Buchung) => !isBilled(b) && !isBreakRow(b)
  const selectableRows = useMemo(() => visibleBuchungen.filter(isRebookable), [visibleBuchungen])
  const selectedRows   = useMemo(() => selectableRows.filter(b => selected.has(b.ID)), [selectableRows, selected])
  const allSelected    = selectableRows.length > 0 && selectableRows.every(b => selected.has(b.ID))
  const showSelectCol  = canRebook && !narrow

  function toggleAllSelected() {
    setSelected(allSelected ? new Set() : new Set(selectableRows.map(b => b.ID)))
  }
  function toggleRowSelected(id: number) {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }
  // Projektwechsel: eine Auswahl aus dem alten Projekt darf nicht stehen bleiben.
  useEffect(() => { setSelected(new Set()) }, [pid])

  function toggleSort(col: SortCol) {
    if (sortCol === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortCol(col); setSortDir('asc') }
  }

  const patchMut = useMutation({
    mutationFn: ({ id, body }: { id: number; body: UpdateBuchungPayload }) => updateBuchung(id, body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['buchungen', pid] })
      toast.success('Buchung aktualisiert')
      setEditRow(null)
    },
    onError: (e: Error) => setEditMsg({ text: e.message, type: 'error' }),
  })

  const deleteMut = useMutation({
    mutationFn: deleteBuchung,
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['buchungen', pid] }); toast.success('Buchung gelöscht') },
    onError: (e: Error) => setMsg({ text: e.message, type: 'error' }),
  })

  useCtrlS(() => { if (editRow) (document.getElementById('bk-edit-form') as HTMLFormElement | null)?.requestSubmit() }, editRow !== null)

  function submitEdit(e: React.FormEvent) {
    e.preventDefault()
    if (!editRow) return
    setEditMsg(null)
    if (!editForm.EMPLOYEE_ID || !editForm.STRUCTURE_ID || !editForm.BOOKING_DATE || !editForm.QUANTITY_INT || editForm.COST_RATE === '' || !editForm.QUANTITY_EXT || editForm.HOURLY_RATE === '' || !editForm.POSTING_DESCRIPTION) {
      setEditMsg({ text: 'Bitte alle Pflichtfelder ausfüllen', type: 'error' }); return
    }
    patchMut.mutate({
      id: editRow.ID,
      body: {
        EMPLOYEE_ID:         Number(editForm.EMPLOYEE_ID),
        STRUCTURE_ID:        editForm.STRUCTURE_ID ? Number(editForm.STRUCTURE_ID) : null,
        BOOKING_DATE:        editForm.BOOKING_DATE,
        TIME_START:          editForm.TIME_START  || undefined,
        TIME_FINISH:         editForm.TIME_FINISH || undefined,
        QUANTITY_INT:        Number(editForm.QUANTITY_INT),
        COST_RATE:             Number(editForm.COST_RATE),
        QUANTITY_EXT:        Number(editForm.QUANTITY_EXT),
        HOURLY_RATE:             Number(editForm.HOURLY_RATE),
        POSTING_DESCRIPTION: editForm.POSTING_DESCRIPTION,
      },
    })
  }

  const setEF = (k: keyof BuchungForm) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setEditForm(f => ({ ...f, [k]: e.target.value }))

  function openEdit(b: Buchung) {
    if (isBreakRow(b)) { setPauseModal({ mode: 'edit', row: b }); return }
    if (isSpecialKind(b.BOOKING_KIND)) { setEditSpecial(b); return }
    setEditRow(b)
    setEditForm(buchungToForm(b))
    setEditMsg(null)
  }

  function confirmDelete(b: Buchung) {
    setConfirmState({
      title: 'Buchung löschen',
      message: `Buchung vom ${fmtDateDe(b.BOOKING_DATE)} löschen?`,
      onConfirm: () => { setMsg(null); deleteMut.mutate(b.ID) },
    })
  }

  const activeFilterCount = [filterStruct, ...(filterEmp.size ? [1] : []), ...(filterKind.size ? [1] : []), ...(filterStatus.size ? [1] : []), hideZeroExt, dateFrom || dateTo]
    .filter(Boolean).length
  const anyFilter = !!(search || activeFilterCount)
  function resetFilters() {
    setSearch(''); setFilterStruct(''); setFilterEmp(new Set()); setFilterKind(new Set())
    setFilterStatus(new Set()); setHideZeroExt(false); setDateFrom(''); setDateTo('')
  }

  const moreKinds = [
    canCreate  && { key: 'pause', label: 'Pause', run: () => { setPauseModal({ mode: 'create' }); setMsg(null) } },
    canSpecial && { key: 'unit',  label: 'Stückleistung', run: () => { setSpecialKind('UNIT'); setMsg(null) } },
    canSpecial && { key: 'lc',    label: 'Pauschale (Kosten)', run: () => { setSpecialKind('LUMP_COST'); setMsg(null) } },
    canSpecial && { key: 'lr',    label: 'Pauschale (Erlös)', run: () => { setSpecialKind('LUMP_REVENUE'); setMsg(null) } },
  ].filter(Boolean) as { key: string; label: string; run: () => void }[]

  const colCount = narrow ? 4 : 6 + (showRevenue ? 2 : 0) + (showCosts ? 1 : 0) + (showSelectCol ? 1 : 0)

  function rowActions(b: Buchung) {
    if (isBilled(b)) {
      return <span className="bk-billed" title="Abgerechnet – Korrektur nur über Storno/Gutschrift"><Lock size={12} strokeWidth={2} aria-hidden="true" /> abgerechnet</span>
    }
    const acts = [
      canEdit && { key: 'edit', label: 'Bearbeiten', icon: Pencil, run: () => openEdit(b) },
      canRebook && !isBreakRow(b) && { key: 'rebook', label: 'Umbuchen', icon: ArrowRightLeft, run: () => { setMsg(null); setRebookRows([b]) } },
      canDelete && { key: 'del', label: 'Löschen', icon: Trash2, danger: true, run: () => confirmDelete(b) },
    ].filter(Boolean) as { key: string; label: string; icon: typeof Pencil; run: () => void; danger?: boolean }[]
    if (!acts.length) return null
    if (narrow) {
      return (
        <RowMenu label={`Aktionen zur Buchung vom ${fmtDateDe(b.BOOKING_DATE)}`} triggerClassName="row-action-btn">
          {acts.map(a => (
            <button key={a.key} type="button" role="menuitem" className={`row-menu-item${a.danger ? ' danger' : ''}`} onClick={a.run}>{a.label}</button>
          ))}
        </RowMenu>
      )
    }
    return acts.map(a => {
      const Icon = a.icon
      return (
        <button key={a.key} type="button" className={`row-action-btn${a.danger ? ' row-action-btn--danger' : ''}`} onClick={a.run}
          title={a.key === 'rebook' ? 'Umbuchen — auf anderes Projektelement/Projekt verschieben' : a.label} aria-label={a.label}>
          <Icon size={14} strokeWidth={2} />
        </button>
      )
    })
  }

  function kindBadge(b: Buchung) {
    if (isSpecialKind(b.BOOKING_KIND)) return <span className="bk-badge bk-badge--special">{KIND_BADGE[b.BOOKING_KIND!]}</span>
    if (isBreakRow(b)) return <span className="bk-badge bk-badge--break">Pause</span>
    return null
  }

  return (
    <div className="bk-root" data-density={density}>
      {pid === null && <p className="empty-note">Kein Projekt gewählt.</p>}

      {pid !== null && (
        <>
          {isLoading && <ListLoading columns={6} />}
          {!isLoading && (
            <>
              <div className="list-toolbar bk-toolbar">
                <input
                  className="list-search"
                  type="search"
                  placeholder="Suchen …"
                  aria-label="Buchungen durchsuchen"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                />

                <div className="bk-toolbar-right">
                  <DensityToggle value={density} onChange={setDensity} />
                  {moreKinds.length > 0 && (
                    <RowMenu label="Weitere Buchungsarten" triggerClassName="btn-secondary bk-more-kinds"
                      triggerContent={narrow ? undefined : <>Weitere Buchungsarten <ChevronDown size={14} strokeWidth={2} aria-hidden="true" /></>}>
                      {moreKinds.map(k => (
                        <button key={k.key} type="button" role="menuitem" className="row-menu-item" onClick={k.run}>+ {k.label}</button>
                      ))}
                    </RowMenu>
                  )}
                  {canCreate && (
                    <button type="button" className="btn-primary bk-primary"
                      onClick={() => openQuickBooking({ projectId: pid, allowOtherEmployee: true })}>
                      <Plus size={15} strokeWidth={2.25} aria-hidden="true" /> {narrow ? 'Stunden' : 'Stunden buchen'}
                    </button>
                  )}
                </div>
                <div className="bk-filters">
                  <FilterBar activeCount={activeFilterCount} onReset={resetFilters}>
                    <select value={filterStruct} onChange={e => setFilterStruct(e.target.value)}
                      aria-label="Nach Projektelement filtern" className="bk-struct-filter">
                      <option value="">Alle Projektelemente</option>
                      {allStructureSorted.map(n => (
                        <option key={n.STRUCTURE_ID} value={n.STRUCTURE_ID}>
                          {pathCache.get(n.STRUCTURE_ID) ?? n.ABBR}
                        </option>
                      ))}
                    </select>
                    <FilterChip label="Mitarbeiter" options={empOptions}    active={filterEmp}    onChange={setFilterEmp} />
                    <FilterChip label="Buchungstyp" options={kindOptions}   active={filterKind}   onChange={setFilterKind} />
                    <FilterChip label="Status"      options={statusOptions} active={filterStatus} onChange={setFilterStatus} />
                    <label className="filter-daterange bk-daterange">
                      Zeitraum
                      <input type="date" className="inline-date-input" value={dateFrom} max={dateTo || undefined}
                        onChange={e => setDateFrom(e.target.value)} aria-label="Von" />
                      <span>–</span>
                      <input type="date" className="inline-date-input" value={dateTo} min={dateFrom || undefined}
                        onChange={e => setDateTo(e.target.value)} aria-label="Bis" />
                    </label>
                    <label className="bk-check">
                      <input type="checkbox" checked={hideZeroExt} onChange={e => setHideZeroExt(e.target.checked)} />
                      0 zur Abrechnung ausblenden
                    </label>
                  </FilterBar>
                </div>
              </div>

              <Message text={msg?.text ?? null} type={msg?.type} />

              {/* Sammelaktion: erscheint erst mit einer Auswahl. */}
              {showSelectCol && selectedRows.length > 0 && (
                <div className="bk-bulk-bar">
                  <span>{selectedRows.length} ausgewählt</span>
                  <button type="button" className="btn-secondary" onClick={() => { setMsg(null); setRebookRows(selectedRows) }}>
                    <ArrowRightLeft size={13} strokeWidth={2} aria-hidden="true" />
                    Umbuchen ({selectedRows.length})
                  </button>
                  <button type="button" className="btn-secondary" onClick={() => setSelected(new Set())}>
                    Auswahl aufheben
                  </button>
                </div>
              )}

              {narrow && buchungen.length > 0 && (
                <p className="bk-summary" aria-live="polite">
                  {visibleBuchungen.length !== buchungen.length ? `${visibleBuchungen.length} von ${buchungen.length}` : buchungen.length} Einträge
                  {' · '}{fmtN(totalIntH)} h
                  {showCosts   && <> · Kosten {money(totalCost)}</>}
                  {showRevenue && <> · Erlös {money(totalRev)}</>}
                </p>
              )}

              {buchungen.length === 0 ? (
                <div className="bk-empty">
                  <p className="empty-note">In diesem Projekt ist noch keine Zeit gebucht.</p>
                  <p className="bk-empty-why">Gebuchte Stunden fließen in die Projektkosten, das Zeitkonto und – je nach Abrechnungsart – in die nächste Rechnung.</p>
                  {canCreate && (
                    <button type="button" className="btn-secondary" onClick={() => openQuickBooking({ projectId: pid, allowOtherEmployee: true })}>
                      <Plus size={15} strokeWidth={2.25} aria-hidden="true" /> Erste Stunden buchen
                    </button>
                  )}
                </div>
              ) : (
              <div className="list-section">
                <table className="master-table bk-table">
                  <thead>
                    <tr>
                      {showSelectCol && (
                        <th scope="col" className="bk-col-check">
                          <input
                            type="checkbox"
                            checked={allSelected}
                            onChange={toggleAllSelected}
                            disabled={selectableRows.length === 0}
                            aria-label="Alle umbuchbaren Buchungen auswählen"
                          />
                        </th>
                      )}
                      <SortTh label="Datum" column="date" sortKey={sortCol} dir={sortDir} onSort={toggleSort} />
                      {!narrow && <SortTh label="Mitarbeiter" column="employee" sortKey={sortCol} dir={sortDir} onSort={toggleSort} />}
                      {!narrow && <SortTh label="Leistung" column="path" sortKey={sortCol} dir={sortDir} onSort={toggleSort} />}
                      <SortTh label={narrow ? 'Leistung · Beschreibung' : 'Beschreibung'} column="description" sortKey={sortCol} dir={sortDir} onSort={toggleSort} />
                      <SortTh label="Std." column="h_int" sortKey={sortCol} dir={sortDir} onSort={toggleSort} className="num" />
                      {!narrow && showRevenue && <SortTh label="Zur Abr." column="h_ext" sortKey={sortCol} dir={sortDir} onSort={toggleSort} className="num" />}
                      {!narrow && showCosts   && <SortTh label="Kosten €" column="cost" sortKey={sortCol} dir={sortDir} onSort={toggleSort} className="num" />}
                      {!narrow && showRevenue && <SortTh label="Erlös €" column="revenue" sortKey={sortCol} dir={sortDir} onSort={toggleSort} className="num" />}
                      <th scope="col" className="bk-col-actions"><span className="sr-only">Aktionen</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleBuchungen.map(b => {
                      const path  = b.STRUCTURE_ID != null ? pathCache.get(b.STRUCTURE_ID) ?? '—' : '—'
                      const hours = b.BOOKING_KIND === 'UNIT'
                        ? `${fmtN(b.QUANTITY_EXT)}${b.UNIT_LABEL ? ' ' + b.UNIT_LABEL : ''}`
                        : isSpecialKind(b.BOOKING_KIND) ? '—' : fmtN(b.QUANTITY_INT)
                      return (
                      <tr key={b.ID} className={isBilled(b) ? 'bk-row-billed' : undefined}>
                        {showSelectCol && (
                          <td className="bk-col-check">
                            {isRebookable(b) && (
                              <input
                                type="checkbox"
                                checked={selected.has(b.ID)}
                                onChange={() => toggleRowSelected(b.ID)}
                                aria-label={`Buchung vom ${fmtDateDe(b.BOOKING_DATE)} auswählen`}
                              />
                            )}
                          </td>
                        )}
                        <td className="bk-date">
                          {fmtDateDe(b.BOOKING_DATE)}
                          {narrow && <span className="bk-sub">{b.EMPLOYEE?.ABBR}</span>}
                        </td>
                        {!narrow && <td>{b.EMPLOYEE?.ABBR}</td>}
                        {!narrow && <td className="bk-path" title={path}>{leafOf(path)}</td>}
                        <td className="bk-desc">
                          {narrow && <span className="bk-sub bk-sub--path">{path}</span>}
                          <span className="bk-desc-text">{kindBadge(b)}{b.POSTING_DESCRIPTION}</span>
                        </td>
                        <td className="num">{hours}</td>
                        {!narrow && showRevenue && <td className="num">{isSpecialKind(b.BOOKING_KIND) && b.BOOKING_KIND !== 'UNIT' ? '—' : fmtN(b.QUANTITY_EXT)}</td>}
                        {!narrow && showCosts   && <td className="num">{money(b.COST_TOTAL)}</td>}
                        {!narrow && showRevenue && <td className="num">{money(b.HOURLY_RATE_TOTAL)}</td>}
                        <td className="doc-actions bk-col-actions">{rowActions(b)}</td>
                      </tr>
                    )})}
                    {!visibleBuchungen.length && (
                      <tr><td colSpan={colCount} className="empty-note">
                        Keine Buchung passt zu Suche und Filtern.{anyFilter && <> <button type="button" className="link-btn" onClick={resetFilters}>Filter zurücksetzen</button></>}
                      </td></tr>
                    )}
                  </tbody>
                  {!narrow && (
                  <tfoot>
                    <tr className="bk-foot">
                      <td colSpan={showSelectCol ? 4 : 3}>
                        {visibleBuchungen.length !== buchungen.length
                          ? `${visibleBuchungen.length} von ${buchungen.length} Einträgen`
                          : `${buchungen.length} Einträge`}
                      </td>
                      <td></td>
                      <td className="num">{fmtN(totalIntH)}</td>
                      {showRevenue && <td className="num">{fmtN(totalExtH)}</td>}
                      {showCosts && <td className="num">{money(totalCost)}</td>}
                      {showRevenue && <td className="num">{money(totalRev)}</td>}
                      <td></td>
                    </tr>
                  </tfoot>
                  )}
                </table>
              </div>
              )}
            </>
          )}
        </>
      )}

      {/* ── Bearbeiten (Stunden) ── */}
      <Modal open={editRow !== null} onClose={() => setEditRow(null)} title="Buchung bearbeiten">
        <form id="bk-edit-form" onSubmit={submitEdit} className="master-form">
          <div className="form-group">
            <label htmlFor="bk-e-emp">Mitarbeiter*</label>
            <select id="bk-e-emp" value={editForm.EMPLOYEE_ID} onChange={setEF('EMPLOYEE_ID')} required>
              <option value="">Bitte wählen …</option>
              {employees.map(e => <option key={e.ID} value={e.ID}>{e.ABBR}: {e.FIRST_NAME} {e.LAST_NAME}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label htmlFor="bk-e-leaf">Leistung*</label>
            <select id="bk-e-leaf" value={editForm.STRUCTURE_ID} onChange={setEF('STRUCTURE_ID')} required>
              <option value="">Bitte wählen …</option>
              {leafStructure.map(s => <option key={s.STRUCTURE_ID} value={s.STRUCTURE_ID}>{pathCache.get(s.STRUCTURE_ID) ?? s.ABBR}</option>)}
            </select>
          </div>
          <div className="form-row">
            <FormField label="Datum*"      id="eda" type="date"   value={editForm.BOOKING_DATE}  onChange={setEF('BOOKING_DATE')} required />
            <FormField label="Von"         id="ets" type="time"   value={editForm.TIME_START}    onChange={setEF('TIME_START')} />
            <FormField label="Bis"         id="etf" type="time"   value={editForm.TIME_FINISH}   onChange={setEF('TIME_FINISH')} />
          </div>
          <div className="form-row">
            <FormField label="Stunden*" id="eqi" type="number" value={editForm.QUANTITY_INT}  onChange={setEF('QUANTITY_INT')} step="0.25" required />
            {showRevenue && (
              <FormField label="Zur Abrechnung*" id="eqe" type="number" value={editForm.QUANTITY_EXT}  onChange={setEF('QUANTITY_EXT')} step="0.25" required />
            )}
          </div>
          <div className="form-row">
            {showCosts && (
              <FormField label="Kostensatz*"   id="ecr" type="number" value={editForm.COST_RATE}       onChange={setEF('COST_RATE')} step="0.01" required />
            )}
            {showRevenue && (
              <FormField label="Stundensatz*"  id="esr" type="number" value={editForm.HOURLY_RATE}       onChange={setEF('HOURLY_RATE')} step="0.01" required />
            )}
          </div>
          <div className="form-group">
            <label htmlFor="bk-e-desc">Beschreibung*</label>
            <textarea id="bk-e-desc" className="bk-textarea" rows={2} value={editForm.POSTING_DESCRIPTION} onChange={setEF('POSTING_DESCRIPTION')} required />
          </div>
          <Message text={editMsg?.text ?? null} type={editMsg?.type} />
          <DialogFooter>
            <button type="button" className="btn-secondary" onClick={() => setEditRow(null)}>Abbrechen</button>
            <button type="button" className="btn-primary" disabled={patchMut.isPending}
              onClick={() => (document.getElementById('bk-edit-form') as HTMLFormElement | null)?.requestSubmit()}>
              {patchMut.isPending ? 'Speichert …' : 'Speichern'}
            </button>
          </DialogFooter>
        </form>
      </Modal>

      {specialKind !== null && pid !== null && (
        <SpecialBookingModal
          projectId={pid}
          kind={specialKind}
          leafStructure={leafStructure.map(s => ({ STRUCTURE_ID: s.STRUCTURE_ID }))}
          pathCache={pathCache}
          showCosts={showCosts}
          onClose={() => setSpecialKind(null)}
          onSaved={() => {
            setSpecialKind(null)
            toast.success('Buchung gespeichert')
            void qc.invalidateQueries({ queryKey: ['buchungen', pid] })
          }}
        />
      )}

      {editSpecial !== null && pid !== null && (
        <SpecialBookingModal
          projectId={pid}
          kind={(editSpecial.BOOKING_KIND ?? 'UNIT') as BookingKind}
          existing={editSpecial}
          leafStructure={leafStructure.map(s => ({ STRUCTURE_ID: s.STRUCTURE_ID }))}
          pathCache={pathCache}
          showCosts={showCosts}
          onClose={() => setEditSpecial(null)}
          onSaved={() => {
            setEditSpecial(null)
            toast.success('Buchung aktualisiert')
            void qc.invalidateQueries({ queryKey: ['buchungen', pid] })
          }}
        />
      )}

      {pauseModal !== null && pid !== null && (
        <PauseBookingModal
          projectId={pid}
          employees={employees}
          existing={pauseModal.mode === 'edit' ? pauseModal.row : undefined}
          onClose={() => setPauseModal(null)}
          onSaved={(text) => {
            setPauseModal(null)
            toast.success(text)
            void qc.invalidateQueries({ queryKey: ['buchungen', pid] })
          }}
        />
      )}

      {rebookRows !== null && rebookRows.length > 0 && pid !== null && (
        <UmbuchenModal
          bookings={rebookRows}
          sourceProjectId={pid}
          onClose={() => setRebookRows(null)}
          onDone={(text) => {
            setRebookRows(null)
            setSelected(new Set())
            setMsg({ text, type: 'success' })
          }}
        />
      )}

      <ConfirmModal
        open={confirmState !== null}
        title={confirmState?.title ?? ''}
        message={confirmState?.message ?? ''}
        confirmLabel="Löschen"
        confirmClass="danger"
        onConfirm={() => { confirmState?.onConfirm(); setConfirmState(null) }}
        onCancel={() => setConfirmState(null)}
      />
    </div>
  )
}

// ── Spezial-Buchung: Pauschalen & Stückleistungen ──────────────────────────────

interface SpecialBookingModalProps {
  projectId:     number
  kind:          BookingKind
  leafStructure: { STRUCTURE_ID: number }[]
  pathCache:     Map<number, string>
  showCosts:     boolean
  existing?:     Buchung
  onClose:       () => void
  onSaved:       () => void
}

function SpecialBookingModal({ projectId, kind, leafStructure, pathCache, showCosts, existing, onClose, onSaved }: SpecialBookingModalProps) {
  const isUnit = kind === 'UNIT'
  const isEdit = existing != null
  const [bookingTypeId, setBookingTypeId] = useState<string>(existing?.BOOKING_TYPE_ID != null ? String(existing.BOOKING_TYPE_ID) : '')
  const [structureId,   setStructureId]   = useState<string>(existing?.STRUCTURE_ID != null ? String(existing.STRUCTURE_ID) : '')
  const [date,          setDate]          = useState<string>(existing ? fmtDate(existing.BOOKING_DATE) : todayIso())
  const [description,   setDescription]   = useState<string>(existing?.POSTING_DESCRIPTION ?? '')
  const [quantity,      setQuantity]      = useState<string>(existing && kind === 'UNIT' ? String(existing.QUANTITY_EXT ?? '') : '')
  const [unitLabel,     setUnitLabel]     = useState<string>(existing?.UNIT_LABEL ?? '')
  const [spRate,        setSpRate]        = useState<string>(existing && kind === 'UNIT' && existing.HOURLY_RATE != null ? String(existing.HOURLY_RATE) : '')
  const [cpRate,        setCpRate]        = useState<string>(existing && kind === 'UNIT' && existing.COST_RATE != null ? String(existing.COST_RATE) : '')
  const [amount,        setAmount]        = useState<string>(
    existing && kind === 'LUMP_COST'    ? String(existing.COST_TOTAL ?? '') :
    existing && kind === 'LUMP_REVENUE' ? String(existing.HOURLY_RATE_TOTAL ?? '') : ''
  )
  const [msg,           setMsg]           = useState<{ text: string; type: 'success' | 'error' } | null>(null)
  const formRef = useRef<HTMLFormElement>(null)

  const { data: typesData } = useQuery({
    queryKey: ['booking-types-selectable', projectId],
    queryFn:  () => fetchSelectableBookingTypes(projectId),
  })
  const types: SelectableBookingType[] = useMemo(
    () => (typesData?.data ?? []).filter(t => t.KIND === kind),
    [typesData, kind],
  )

  function applyType(id: string) {
    setBookingTypeId(id)
    const t = types.find(x => String(x.ID) === id)
    if (!t) return
    setDescription(t.NAME || t.ABBR)
    if (isUnit) {
      setUnitLabel(t.UNIT_LABEL || '')
      if (t.DEFAULT_SP_RATE != null) setSpRate(String(t.DEFAULT_SP_RATE))
      if (t.DEFAULT_CP_RATE != null) setCpRate(String(t.DEFAULT_CP_RATE))
    } else if (kind === 'LUMP_COST') {
      if (t.DEFAULT_CP_RATE != null) setAmount(String(t.DEFAULT_CP_RATE))
    } else if (kind === 'LUMP_REVENUE') {
      if (t.DEFAULT_SP_RATE != null) setAmount(String(t.DEFAULT_SP_RATE))
    }
  }

  const num = (v: string) => { const n = Number(v.replace(',', '.')); return Number.isFinite(n) ? n : 0 }
  const previewTotal = isUnit
    ? num(quantity) * num(spRate)
    : num(amount)
  const previewCost = isUnit ? num(quantity) * num(cpRate) : (kind === 'LUMP_COST' ? num(amount) : 0)

  const saveMut = useMutation({
    mutationFn: () => {
      const payload = {
        BOOKING_KIND:        kind,
        PROJECT_ID:          projectId,
        STRUCTURE_ID:        structureId ? Number(structureId) : undefined,
        BOOKING_DATE:        date,
        BOOKING_TYPE_ID:     bookingTypeId ? Number(bookingTypeId) : undefined,
        POSTING_DESCRIPTION: description,
        ...(isUnit
          ? { QUANTITY: num(quantity), UNIT_LABEL: unitLabel || undefined, HOURLY_RATE: num(spRate), COST_RATE: num(cpRate) }
          : { AMOUNT: num(amount) }),
      }
      return isEdit ? updateSpecialBuchung(existing!.ID, payload) : createSpecialBuchung(payload)
    },
    onSuccess: onSaved,
    onError: (e: Error) => setMsg({ text: e.message, type: 'error' }),
  })

  const billable = isUnit || kind === 'LUMP_REVENUE'

  function submit(e: React.FormEvent) {
    e.preventDefault()
    setMsg(null)
    if (!description.trim()) { setMsg({ text: 'Bitte eine Bezeichnung angeben', type: 'error' }); return }
    if (billable && !structureId) { setMsg({ text: 'Bitte ein Projektelement wählen — für die Abrechnung erforderlich', type: 'error' }); return }
    if (isUnit) {
      if (num(quantity) <= 0) { setMsg({ text: 'Menge muss größer als 0 sein', type: 'error' }); return }
      if (num(spRate) === 0 && num(cpRate) === 0) { setMsg({ text: 'Bitte Stückpreis und/oder Stückkosten angeben', type: 'error' }); return }
    } else if (num(amount) === 0) {
      setMsg({ text: 'Bitte einen Betrag angeben', type: 'error' }); return
    }
    saveMut.mutate()
  }

  useCtrlS(() => formRef.current?.requestSubmit(), true)

  return (
    <Modal open onClose={onClose} title={`${BOOKING_KIND_LABEL[kind]}${isEdit ? ' bearbeiten' : ''}`}>
      <form ref={formRef} onSubmit={submit} className="master-form">
        <div className="form-group">
          <label>Aus Katalog (optional) <HelpHint id="bookings.special" /></label>
          <select value={bookingTypeId} onChange={e => applyType(e.target.value)}>
            <option value="">— Freitext (ohne Katalog) —</option>
            {types.map(t => (
              <option key={t.ID} value={t.ID}>
                {t.ABBR}{t.NAME ? ` – ${t.NAME}` : ''}{t.SCOPE === 'project' ? ' (Projekt)' : ''}
              </option>
            ))}
          </select>
        </div>

        <div className="form-group">
          <label>Projektelement{billable ? '*' : ''}</label>
          <select value={structureId} onChange={e => setStructureId(e.target.value)} required={billable}>
            <option value="">—</option>
            {leafStructure.map(s => (
              <option key={s.STRUCTURE_ID} value={s.STRUCTURE_ID}>{pathCache.get(s.STRUCTURE_ID) ?? `#${s.STRUCTURE_ID}`}</option>
            ))}
          </select>
          {billable && (
            <span style={{ fontSize: 11, color: 'var(--text-3)', display: 'block', marginTop: 2 }}>
              Erforderlich für die Abrechnung — abgerechnet wird auf <strong>Stunden-Elementen (BT=2)</strong> wie eine Stundenbuchung.
            </span>
          )}
        </div>

        <div className="form-row">
          <FormField label="Datum*" id="sb-date" type="date" value={date} onChange={e => setDate(e.target.value)} required />
        </div>

        <div className="form-group">
          <label>Bezeichnung*</label>
          <textarea className="bk-textarea" rows={2} value={description} onChange={e => setDescription(e.target.value)} required />
          <TextSnippetBar currentText={description} onChange={setDescription} kind={kind} bookingTypeId={bookingTypeId ? Number(bookingTypeId) : undefined} />
        </div>

        {isUnit ? (
          <>
            <div className="form-row">
              <FormField label="Menge*"   id="sb-qty"  type="number" value={quantity}  onChange={e => setQuantity(e.target.value)} step="0.01" required />
              <FormField label="Einheit"  id="sb-unit" value={unitLabel} onChange={e => setUnitLabel(e.target.value)} placeholder="z. B. Stk, m²" />
            </div>
            <div className="form-row">
              <FormField label="Stückpreis (€)" id="sb-sp" type="number" value={spRate} onChange={e => setSpRate(e.target.value)} step="0.01" />
              {showCosts && (
                <FormField label="Stückkosten (€)" id="sb-cp" type="number" value={cpRate} onChange={e => setCpRate(e.target.value)} step="0.01" />
              )}
            </div>
          </>
        ) : (
          <div className="form-row">
            <FormField label={kind === 'LUMP_COST' ? 'Betrag Kosten (€)*' : 'Betrag Erlös (€)*'}
              id="sb-amount" type="number" value={amount} onChange={e => setAmount(e.target.value)} step="0.01" required />
          </div>
        )}

        <div style={{ fontSize: 13, color: 'var(--text-2)', margin: '4px 0 8px' }}>
          {kind === 'LUMP_COST'
            ? <>Belastet das Projekt mit <strong>{FMT_NUM.format(previewCost)} €</strong> Kosten.</>
            : kind === 'LUMP_REVENUE'
              ? <>Abrechenbarer Erlös: <strong>{FMT_NUM.format(previewTotal)} €</strong>.</>
              : <>Erlös: <strong>{FMT_NUM.format(previewTotal)} €</strong>{showCosts ? <> · Kosten: <strong>{FMT_NUM.format(previewCost)} €</strong></> : null}</>}
        </div>

        <Message text={msg?.text ?? null} type={msg?.type} />
        <DialogFooter>
          <button type="button" className="btn-secondary" onClick={onClose}>Abbrechen</button>
          <button type="button" className="btn-primary" disabled={saveMut.isPending} onClick={() => formRef.current?.requestSubmit()}>
            {saveMut.isPending ? 'Speichert …' : 'Buchen'}
          </button>
        </DialogFooter>
      </form>
    </Modal>
  )
}

// ── Pause-Buchung (kostenneutral, ENTRY_KIND='BREAK') ──────────────────────────

interface PauseBookingModalProps {
  projectId: number
  employees: ActiveEmployee[]
  existing?: Buchung
  onClose:   () => void
  onSaved:   (msg: string) => void
}

function PauseBookingModal({ projectId, employees, existing, onClose, onSaved }: PauseBookingModalProps) {
  const isEdit = existing != null
  const [employeeId,  setEmployeeId]  = useState<string>(existing ? String(existing.EMPLOYEE_ID) : String(useAuthStore.getState().employeeId ?? ''))
  const [date,        setDate]        = useState<string>(existing ? fmtDate(existing.BOOKING_DATE) : todayIso())
  const [timeStart,   setTimeStart]   = useState<string>(existing?.TIME_START?.slice(0, 5) ?? '')
  const [timeFinish,  setTimeFinish]  = useState<string>(existing?.TIME_FINISH?.slice(0, 5) ?? '')
  const [hours,       setHours]       = useState<string>(existing ? String(existing.QUANTITY_INT ?? '') : '')
  const [description, setDescription] = useState<string>(existing?.POSTING_DESCRIPTION ?? '')
  const [msg,         setMsg]         = useState<{ text: string; type: 'success' | 'error' } | null>(null)
  const formRef = useRef<HTMLFormElement>(null)

  // Dauer aus Von/Bis ableiten, sobald beide gesetzt sind.
  function recompute(start: string, finish: string) {
    if (!start || !finish) return
    const [sh, sm] = start.split(':').map(Number)
    const [fh, fm] = finish.split(':').map(Number)
    const diffMin = Math.max(0, fh * 60 + fm - (sh * 60 + sm))
    setHours(String(Math.round(diffMin / 60 * 100) / 100))
  }

  const qty = Number(String(hours).replace(',', '.'))

  const saveMut = useMutation({
    mutationFn: async () => {
      const ts = timeStart  ? timeStart  + ':00' : undefined
      const tf = timeFinish ? timeFinish + ':00' : undefined
      if (isEdit) {
        await updateBuchung(existing!.ID, {
          EMPLOYEE_ID:         Number(employeeId),
          BOOKING_DATE:        date,
          TIME_START:          ts,
          TIME_FINISH:         tf,
          QUANTITY_INT:        qty,
          POSTING_DESCRIPTION: description || 'Pause',
        })
        return
      }
      await createBuchung({
        PROJECT_ID:          projectId,
        EMPLOYEE_ID:         Number(employeeId),
        BOOKING_DATE:        date,
        TIME_START:          ts,
        TIME_FINISH:         tf,
        QUANTITY_INT:        qty,
        POSTING_DESCRIPTION: description || 'Pause',
        ENTRY_KIND:          'BREAK',
      })
    },
    onSuccess: () => onSaved(isEdit ? 'Pause aktualisiert' : 'Pause gebucht'),
    onError: (e: Error) => setMsg({ text: e.message, type: 'error' }),
  })

  function submit(e: React.FormEvent) {
    e.preventDefault()
    setMsg(null)
    if (!employeeId) { setMsg({ text: 'Bitte einen Mitarbeiter wählen', type: 'error' }); return }
    if (!date)       { setMsg({ text: 'Bitte ein Datum wählen', type: 'error' }); return }
    if (!(qty > 0))  { setMsg({ text: 'Bitte eine Dauer größer als 0 angeben', type: 'error' }); return }
    saveMut.mutate()
  }

  useCtrlS(() => formRef.current?.requestSubmit(), true)

  return (
    <Modal open onClose={onClose} title={isEdit ? 'Pause bearbeiten' : 'Pause buchen'}>
      <form ref={formRef} onSubmit={submit} className="master-form">
        <div className="form-group">
          <label>Mitarbeiter*</label>
          <select value={employeeId} onChange={e => setEmployeeId(e.target.value)} required>
            <option value="">Bitte wählen …</option>
            {employees.map(e => <option key={e.ID} value={e.ID}>{e.ABBR}: {e.FIRST_NAME} {e.LAST_NAME}</option>)}
          </select>
        </div>
        <div className="form-row">
          <FormField label="Datum*" id="pb-date" type="date" value={date} onChange={e => setDate(e.target.value)} required />
          <FormField label="Von" id="pb-ts" type="time" value={timeStart}  onChange={e => { setTimeStart(e.target.value);  recompute(e.target.value, timeFinish) }} />
          <FormField label="Bis" id="pb-tf" type="time" value={timeFinish} onChange={e => { setTimeFinish(e.target.value); recompute(timeStart, e.target.value) }} />
        </div>
        <div className="form-row">
          <FormField label="Dauer (Std.)*" id="pb-h" type="number" value={hours} onChange={e => setHours(e.target.value)} step="0.25" required />
        </div>
        <div className="form-group">
          <label>Beschreibung</label>
          <textarea className="bk-textarea" rows={2} value={description} onChange={e => setDescription(e.target.value)} placeholder="Pause" />
        </div>
        <div style={{ fontSize: 13, color: 'var(--text-2)', margin: '4px 0 8px' }}>
          Kostenneutral · zählt zur Pausenpflicht (§ 4 ArbZG), <strong>nicht</strong> als Arbeitszeit im Zeitkonto. <HelpHint id="bookings.pause" />
        </div>
        <Message text={msg?.text ?? null} type={msg?.type} />
        <DialogFooter>
          <button type="button" className="btn-secondary" onClick={onClose}>Abbrechen</button>
          <button type="button" className="btn-primary" disabled={saveMut.isPending} onClick={() => formRef.current?.requestSubmit()}>
            {saveMut.isPending ? 'Speichert …' : (isEdit ? 'Speichern' : 'Pause buchen')}
          </button>
        </DialogFooter>
      </form>
    </Modal>
  )
}

// ── Mehrfach-Auswahl-Filter (Chip) ─────────────────────────────────────────────

