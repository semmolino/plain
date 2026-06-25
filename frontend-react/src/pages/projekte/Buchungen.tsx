import { useState, useEffect, useRef, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Message }     from '@/components/ui/Message'
import { Modal }       from '@/components/ui/Modal'
import { Pencil, Trash2 } from 'lucide-react'
import { usePermissionsStore } from '@/store/permissionsStore'
import { ConfirmModal } from '@/components/ui/ConfirmModal'
import { FormField }   from '@/components/ui/FormField'
import {
  fetchProjectsShort, fetchProjectStructure, fetchBuchungen, createBuchung, updateBuchung, deleteBuchung,
  fetchEmployee2ProjectPreset,
  type Buchung, type UpdateBuchungPayload,
} from '@/api/projekte'
import { fetchActiveEmployees } from '@/api/projekte'
import { fetchEmployeeCpRateForDate } from '@/api/mitarbeiter'
import {
  fetchSelectableBookingTypes, createSpecialBuchung, updateSpecialBuchung, BOOKING_KIND_LABEL,
  type BookingKind, type SelectableBookingType,
} from '@/api/bookingTypes'
import {
  fetchTextSnippets, createTextSnippet, deleteTextSnippet, type TextSnippet,
} from '@/api/textSnippets'
import { HelpHint } from '@/components/ui/HelpHint'
import { useAuthStore } from '@/store/authStore'
import { useCtrlS } from '@/hooks/useCtrlS'
import { useTrackRecent } from '@/hooks/useTrackRecent'
import { RecentList } from '@/components/recents/RecentList'
import { trackRecent } from '@/api/recents'

const FMT_NUM = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 2 })
const fmtN    = (v: number | null | undefined) => v == null ? '—' : FMT_NUM.format(v)
const fmtDate = (v: string | null) => v ? v.slice(0, 10) : ''

const SPECIAL_KINDS = new Set(['UNIT', 'LUMP_COST', 'LUMP_REVENUE'])
const isSpecialKind = (k?: string | null) => !!k && SPECIAL_KINDS.has(k)
const KIND_BADGE: Record<string, string> = { UNIT: 'Stück', LUMP_COST: 'Pauschale K', LUMP_REVENUE: 'Pauschale E' }

function todayIso() { return new Date().toISOString().slice(0, 10) }

interface BuchungForm {
  EMPLOYEE_ID:         string
  STRUCTURE_ID:        string
  DATE_VOUCHER:        string
  TIME_START:          string
  TIME_FINISH:         string
  QUANTITY_INT:        string
  CP_RATE:             string
  QUANTITY_EXT:        string
  SP_RATE:             string
  POSTING_DESCRIPTION: string
}

function emptyForm(): BuchungForm {
  return {
    EMPLOYEE_ID: String(useAuthStore.getState().employeeId ?? ''), STRUCTURE_ID: '', DATE_VOUCHER: todayIso(),
    TIME_START: '', TIME_FINISH: '',
    QUANTITY_INT: '', CP_RATE: '', QUANTITY_EXT: '', SP_RATE: '',
    POSTING_DESCRIPTION: '',
  }
}

function buchungToForm(b: Buchung): BuchungForm {
  return {
    EMPLOYEE_ID:         String(b.EMPLOYEE_ID),
    STRUCTURE_ID:        b.STRUCTURE_ID != null ? String(b.STRUCTURE_ID) : '',
    DATE_VOUCHER:        fmtDate(b.DATE_VOUCHER),
    TIME_START:          b.TIME_START ?? '',
    TIME_FINISH:         b.TIME_FINISH ?? '',
    QUANTITY_INT:        String(b.QUANTITY_INT),
    CP_RATE:             String(b.CP_RATE),
    QUANTITY_EXT:        String(b.QUANTITY_EXT),
    SP_RATE:             String(b.SP_RATE),
    POSTING_DESCRIPTION: b.POSTING_DESCRIPTION,
  }
}

type SortCol = 'date' | 'employee' | 'path' | 'description' | 'h_int' | 'h_ext' | 'cost' | 'revenue'
type SortDir = 'asc' | 'desc'

interface Props { initialProjectId?: number; onProjectChange?: (id: number | null) => void }

export function Buchungen({ initialProjectId, onProjectChange }: Props = {}) {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const formRef = useRef<HTMLFormElement>(null)

  // Phase 6: Sichtbarkeit Erloese / Kosten
  const showRevenue = usePermissionsStore(s => s.unrestricted || s.keys.has('projects.bookings.revenue.view'))
  const showCosts   = usePermissionsStore(s => s.unrestricted || s.keys.has('projects.bookings.costs.view'))
  const canSpecial  = usePermissionsStore(s => s.unrestricted || s.keys.has('projects.bookings.special.create'))
  const [specialKind, setSpecialKind] = useState<BookingKind | null>(null)
  const [editSpecial, setEditSpecial] = useState<Buchung | null>(null)
  const [pid,          setPid]          = useState<number | null>(initialProjectId ?? null)
  // Notification-Klick mit neuem Projekt soll umschalten.
  useEffect(() => { if (initialProjectId) setPid(initialProjectId) }, [initialProjectId])
  const [showForm,     setShowForm]     = useState(false)
  const [form,         setForm]         = useState<BuchungForm>(emptyForm)
  const [msg,          setMsg]          = useState<{ text: string; type: 'success'|'error' } | null>(null)
  const [filterStruct,  setFilterStruct]  = useState<string>('')
  const [search,        setSearch]        = useState('')
  const [structSearch,  setStructSearch]  = useState('')
  const [sortCol,      setSortCol]      = useState<SortCol>('date')
  const [sortDir,      setSortDir]      = useState<SortDir>('asc')
  const [editRow,      setEditRow]      = useState<Buchung | null>(null)
  const [editForm,     setEditForm]     = useState<BuchungForm>(emptyForm)
  const [editMsg,      setEditMsg]      = useState<{ text: string; type: 'success'|'error' } | null>(null)
  const [cpRateFound,  setCpRateFound]  = useState<boolean | null>(null)
  const [extTouched,   setExtTouched]   = useState(false)
  const [confirmState, setConfirmState] = useState<{ title: string; message: string; onConfirm: () => void } | null>(null)

  const { data: projectsData }  = useQuery({ queryKey: ['projects-short'], queryFn: fetchProjectsShort })
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

  const empId = form.EMPLOYEE_ID ? Number(form.EMPLOYEE_ID) : null

  const { data: presetData } = useQuery({
    queryKey: ['e2p-preset', empId, pid],
    queryFn:  () => fetchEmployee2ProjectPreset(empId!, pid!),
    enabled:  empId !== null && pid !== null && showForm,
  })

  // Persönliche Buchungstexte (Textbausteine) für die Beschreibung
  const { data: snippetsData } = useQuery({ queryKey: ['text-snippets'], queryFn: fetchTextSnippets, enabled: showForm })
  const snippets: TextSnippet[] = snippetsData?.data ?? []
  const createSnippetMut = useMutation({
    mutationFn: createTextSnippet,
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['text-snippets'] }),
  })
  const delSnippetMut = useMutation({
    mutationFn: deleteTextSnippet,
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['text-snippets'] }),
  })

  const projects  = projectsData?.data ?? []
  const employees = empData?.data      ?? []

  useEffect(() => {
    if (!presetData) return
    setForm(f => ({ ...f, SP_RATE: presetData.found && presetData.SP_RATE != null ? String(presetData.SP_RATE) : f.SP_RATE }))
  }, [presetData])

  useEffect(() => {
    if (!empId || !form.DATE_VOUCHER) { setForm(f => ({ ...f, CP_RATE: '' })); setCpRateFound(null); return }
    fetchEmployeeCpRateForDate(empId, form.DATE_VOUCHER)
      .then(res => { setForm(f => ({ ...f, CP_RATE: String(res.data.rate) })); setCpRateFound(res.data.found) })
      .catch(() => {})
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [empId, form.DATE_VOUCHER])

  useEffect(() => { setFilterStruct(''); setSearch('') }, [pid])

  const buchungen = buchData?.data   ?? []
  const structure = structData?.data ?? []

  const nodeById = useMemo(() => new Map(structure.map(n => [n.STRUCTURE_ID, n])), [structure])
  const parentIds = useMemo(() => new Set(structure.filter(n => n.FATHER_ID != null).map(n => String(n.FATHER_ID))), [structure])

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

  function getDescendantIds(id: number): Set<number> {
    const result = new Set<number>()
    const queue = [id]
    while (queue.length) {
      const cur = queue.shift()!
      result.add(cur)
      for (const child of (childrenMap.get(cur) ?? [])) queue.push(child)
    }
    return result
  }

  function structPath(id: number): string {
    const cur = nodeById.get(id)
    if (!cur) return ''
    const leaf = cur.NAME_LONG ? `${cur.NAME_SHORT}: ${cur.NAME_LONG}` : cur.NAME_SHORT
    const ancestors: string[] = []
    let fatherId = cur.FATHER_ID ? Number(cur.FATHER_ID) : null
    while (fatherId != null) {
      const parent = nodeById.get(fatherId)
      if (!parent) break
      ancestors.unshift(parent.NAME_SHORT)
      fatherId = parent.FATHER_ID ? Number(parent.FATHER_ID) : null
    }
    return ancestors.length ? `${ancestors.join(' > ')} > ${leaf}` : leaf
  }

  const allStructureSorted = useMemo(() =>
    [...structure].sort((a, b) => structPath(a.STRUCTURE_ID).localeCompare(structPath(b.STRUCTURE_ID), 'de', { numeric: true })),
    [structure, nodeById]
  )

  const leafStructure = useMemo(() =>
    allStructureSorted.filter(n => !parentIds.has(String(n.STRUCTURE_ID))),
    [allStructureSorted, parentIds]
  )

  const pathCache = useMemo(() => {
    const m = new Map<number, string>()
    for (const n of structure) m.set(n.STRUCTURE_ID, structPath(n.STRUCTURE_ID))
    return m
  }, [structure, nodeById])

  const filteredStructureForSelect = useMemo(() => {
    if (!structSearch.trim()) return allStructureSorted
    const sq = structSearch.toLowerCase()
    return allStructureSorted.filter(n =>
      n.NAME_SHORT.toLowerCase().includes(sq) ||
      (n.NAME_LONG?.toLowerCase().includes(sq) ?? false) ||
      (pathCache.get(n.STRUCTURE_ID) ?? '').toLowerCase().includes(sq)
    )
  }, [allStructureSorted, structSearch, pathCache])

  const filterDescendants = useMemo(() => {
    if (!filterStruct) return null
    return getDescendantIds(Number(filterStruct))
  }, [filterStruct, childrenMap])

  const visibleBuchungen = useMemo(() => {
    let rows = buchungen

    if (filterDescendants !== null) {
      rows = rows.filter(b => b.STRUCTURE_ID != null && filterDescendants.has(b.STRUCTURE_ID))
    }

    if (search.trim()) {
      const q = search.trim().toLowerCase()
      rows = rows.filter(b =>
        fmtDate(b.DATE_VOUCHER).includes(q) ||
        (b.EMPLOYEE?.SHORT_NAME ?? '').toLowerCase().includes(q) ||
        (b.POSTING_DESCRIPTION ?? '').toLowerCase().includes(q) ||
        (b.STRUCTURE_ID != null ? (pathCache.get(b.STRUCTURE_ID) ?? '').toLowerCase().includes(q) : false)
      )
    }

    rows = [...rows].sort((a, b) => {
      let cmp = 0
      switch (sortCol) {
        case 'date':        cmp = (a.DATE_VOUCHER ?? '').localeCompare(b.DATE_VOUCHER ?? ''); break
        case 'employee':    cmp = (a.EMPLOYEE?.SHORT_NAME ?? '').localeCompare(b.EMPLOYEE?.SHORT_NAME ?? '', 'de'); break
        case 'path':        cmp = (a.STRUCTURE_ID != null ? pathCache.get(a.STRUCTURE_ID) ?? '' : '').localeCompare(b.STRUCTURE_ID != null ? pathCache.get(b.STRUCTURE_ID) ?? '' : '', 'de', { numeric: true }); break
        case 'description': cmp = (a.POSTING_DESCRIPTION ?? '').localeCompare(b.POSTING_DESCRIPTION ?? '', 'de'); break
        case 'h_int':       cmp = (a.QUANTITY_INT ?? 0) - (b.QUANTITY_INT ?? 0); break
        case 'h_ext':       cmp = (a.QUANTITY_EXT ?? 0) - (b.QUANTITY_EXT ?? 0); break
        case 'cost':        cmp = (a.CP_TOT ?? 0) - (b.CP_TOT ?? 0); break
        case 'revenue':     cmp = (a.SP_TOT ?? 0) - (b.SP_TOT ?? 0); break
      }
      return sortDir === 'asc' ? cmp : -cmp
    })

    return rows
  }, [buchungen, filterDescendants, search, sortCol, sortDir, pathCache])

  const totalIntH = visibleBuchungen.reduce((s, b) => s + (isSpecialKind(b.BOOKING_KIND) ? 0 : Number(b.QUANTITY_INT) || 0), 0)
  const totalExtH = visibleBuchungen.reduce((s, b) => s + (isSpecialKind(b.BOOKING_KIND) ? 0 : Number(b.QUANTITY_EXT) || 0), 0)
  const totalCost = visibleBuchungen.reduce((s, b) => s + (Number(b.CP_TOT) || 0), 0)
  const totalRev  = visibleBuchungen.reduce((s, b) => s + (Number(b.SP_TOT) || 0), 0)

  function toggleSort(col: SortCol) {
    if (sortCol === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortCol(col); setSortDir('asc') }
  }

  function sortIndicator(col: SortCol) {
    if (sortCol !== col) return <span style={{ opacity: 0.25, marginLeft: 4 }}>↕</span>
    return <span style={{ marginLeft: 4 }}>{sortDir === 'asc' ? '↑' : '↓'}</span>
  }

  const createMut = useMutation({
    mutationFn: createBuchung,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['buchungen', pid] })
      setMsg({ text: 'Buchung gespeichert ✅', type: 'success' })
      setForm(emptyForm())
      setExtTouched(false)
      setShowForm(false)
    },
    onError: (e: Error) => setMsg({ text: e.message, type: 'error' }),
  })

  const patchMut = useMutation({
    mutationFn: ({ id, body }: { id: number; body: UpdateBuchungPayload }) => updateBuchung(id, body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['buchungen', pid] })
      setMsg({ text: 'Buchung aktualisiert ✅', type: 'success' })
      setEditRow(null)
    },
    onError: (e: Error) => setEditMsg({ text: e.message, type: 'error' }),
  })

  const deleteMut = useMutation({
    mutationFn: deleteBuchung,
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['buchungen', pid] }),
    onError: (e: Error) => setMsg({ text: e.message, type: 'error' }),
  })

  useCtrlS(() => formRef.current?.requestSubmit(), showForm)

  function submitForm(e: React.FormEvent) {
    e.preventDefault()
    setMsg(null)
    if (!pid || !form.EMPLOYEE_ID || !form.DATE_VOUCHER || !form.QUANTITY_INT || !form.QUANTITY_EXT || form.SP_RATE === '' || !form.POSTING_DESCRIPTION) {
      setMsg({ text: 'Bitte alle Pflichtfelder ausfüllen', type: 'error' }); return
    }
    // Recents: zuletzt gebuchte Strukturelemente pro Projekt mitschreiben
    if (form.STRUCTURE_ID) {
      const sid = Number(form.STRUCTURE_ID)
      const label = pathCache.get(sid) ?? `#${sid}`
      void trackRecent('project_structure', sid, label, { project_id: pid }).catch(() => {})
    }
    createMut.mutate({
      PROJECT_ID:          pid,
      STRUCTURE_ID:        form.STRUCTURE_ID  ? Number(form.STRUCTURE_ID) : undefined,
      EMPLOYEE_ID:         Number(form.EMPLOYEE_ID),
      DATE_VOUCHER:        form.DATE_VOUCHER,
      TIME_START:          form.TIME_START  || undefined,
      TIME_FINISH:         form.TIME_FINISH || undefined,
      QUANTITY_INT:        Number(form.QUANTITY_INT),
      CP_RATE:             Number(form.CP_RATE),
      QUANTITY_EXT:        Number(form.QUANTITY_EXT),
      SP_RATE:             Number(form.SP_RATE),
      POSTING_DESCRIPTION: form.POSTING_DESCRIPTION,
    })
  }

  function submitEdit(e: React.FormEvent) {
    e.preventDefault()
    if (!editRow) return
    setEditMsg(null)
    if (!editForm.EMPLOYEE_ID || !editForm.DATE_VOUCHER || !editForm.QUANTITY_INT || editForm.CP_RATE === '' || !editForm.QUANTITY_EXT || editForm.SP_RATE === '' || !editForm.POSTING_DESCRIPTION) {
      setEditMsg({ text: 'Bitte alle Pflichtfelder ausfüllen', type: 'error' }); return
    }
    patchMut.mutate({
      id: editRow.ID,
      body: {
        EMPLOYEE_ID:         Number(editForm.EMPLOYEE_ID),
        STRUCTURE_ID:        editForm.STRUCTURE_ID ? Number(editForm.STRUCTURE_ID) : null,
        DATE_VOUCHER:        editForm.DATE_VOUCHER,
        TIME_START:          editForm.TIME_START  || undefined,
        TIME_FINISH:         editForm.TIME_FINISH || undefined,
        QUANTITY_INT:        Number(editForm.QUANTITY_INT),
        CP_RATE:             Number(editForm.CP_RATE),
        QUANTITY_EXT:        Number(editForm.QUANTITY_EXT),
        SP_RATE:             Number(editForm.SP_RATE),
        POSTING_DESCRIPTION: editForm.POSTING_DESCRIPTION,
      },
    })
  }

  const setF = (k: keyof BuchungForm) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const value = e.target.value
    if (k === 'QUANTITY_EXT') { setExtTouched(true) }
    setForm(f => ({
      ...f,
      [k]: value,
      ...(k === 'EMPLOYEE_ID' ? { SP_RATE: '', CP_RATE: '' } : {}),
      ...(k === 'QUANTITY_INT' && !extTouched ? { QUANTITY_EXT: value } : {}),
    }))
  }

  const setEF = (k: keyof BuchungForm) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setEditForm(f => ({ ...f, [k]: e.target.value }))

  function openEdit(b: Buchung) {
    setEditRow(b)
    setEditForm(buchungToForm(b))
    setEditMsg(null)
  }

  function confirmDelete(b: Buchung) {
    setConfirmState({
      title: 'Buchung löschen',
      message: `Buchung vom ${fmtDate(b.DATE_VOUCHER)} löschen?`,
      onConfirm: () => { setMsg(null); deleteMut.mutate(b.ID) },
    })
  }

  const currentProject = projects.find(p => p.ID === pid)
  useTrackRecent('project', pid, currentProject ? ([currentProject.NAME_SHORT, currentProject.NAME_LONG].filter(Boolean).join(' · ') || null) : null)

  return (
    <div>
      <RecentList
        type="project"
        title="Zuletzt verwendete Projekte"
        onSelect={(e) => { setPid(e.ENTITY_ID); onProjectChange?.(e.ENTITY_ID); setMsg(null); setShowForm(false) }}
      />

      <div className="form-group" style={{ maxWidth: 400, marginBottom: 12 }}>
        <label>Projekt</label>
        <select value={pid ?? ''} onChange={e => { const id = e.target.value ? Number(e.target.value) : null; setPid(id); onProjectChange?.(id); setMsg(null); setShowForm(false) }}>
          <option value="">Bitte wählen …</option>
          {projects.map(p => <option key={p.ID} value={p.ID}>{p.NAME_SHORT} – {p.NAME_LONG}</option>)}
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

      {pid !== null && (
        <>
          {isLoading && <p className="empty-note">Laden …</p>}
          {!isLoading && (
            <>
              <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', marginBottom: 10, flexWrap: 'wrap' }}>
                <div className="form-group" style={{ flex: '1 1 260px', minWidth: 200, marginBottom: 0 }}>
                  <label>Projektelement</label>
                  <input type="search" className="list-search" placeholder="Elemente filtern …"
                    style={{ marginBottom: 4, fontSize: 12 }}
                    value={structSearch} onChange={e => setStructSearch(e.target.value)} />
                  <select value={filterStruct} onChange={e => setFilterStruct(e.target.value)}>
                    <option value="">Alle Projektelemente</option>
                    {filteredStructureForSelect.map(n => (
                      <option key={n.STRUCTURE_ID} value={n.STRUCTURE_ID}>
                        {pathCache.get(n.STRUCTURE_ID) ?? n.NAME_SHORT}
                      </option>
                    ))}
                  </select>
                </div>
                <div style={{ flex: '1 1 220px', minWidth: 180, paddingBottom: 2 }}>
                  <input
                    className="list-search"
                    type="search"
                    placeholder="Suchen …"
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    style={{ width: '100%' }}
                  />
                </div>
              </div>

              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 14 }}>
                <button
                  className="btn-primary"
                  style={{ width: 'auto', marginTop: 0 }}
                  onClick={() => { if (!showForm) setExtTouched(false); setShowForm(v => !v); setMsg(null) }}
                >
                  {showForm ? 'Formular schließen' : '+ Stundenbuchung'}
                </button>
                {canSpecial && (
                  <>
                    <button className="btn-small" style={{ width: 'auto' }} onClick={() => { setSpecialKind('UNIT'); setMsg(null) }}>
                      + Stückleistung
                    </button>
                    <button className="btn-small" style={{ width: 'auto' }} onClick={() => { setSpecialKind('LUMP_COST'); setMsg(null) }}>
                      + Pauschale (Kosten)
                    </button>
                    <button className="btn-small" style={{ width: 'auto' }} onClick={() => { setSpecialKind('LUMP_REVENUE'); setMsg(null) }}>
                      + Pauschale (Erlös)
                    </button>
                    <HelpHint id="bookings.special" />
                  </>
                )}
              </div>

              {showForm && (
                <form ref={formRef} onSubmit={submitForm} className="master-form" style={{ marginTop: 12 }}>
                  <div className="form-group">
                    <label>Mitarbeiter*</label>
                    <select value={form.EMPLOYEE_ID} onChange={setF('EMPLOYEE_ID')} required>
                      <option value="">Bitte wählen …</option>
                      {employees.map(e => <option key={e.ID} value={e.ID}>{e.SHORT_NAME}: {e.FIRST_NAME} {e.LAST_NAME}</option>)}
                    </select>
                  </div>
                  <div className="form-group">
                    <label>Projektelement</label>
                    <select value={form.STRUCTURE_ID} onChange={setF('STRUCTURE_ID')}>
                      <option value="">—</option>
                      {leafStructure.map(s => <option key={s.STRUCTURE_ID} value={s.STRUCTURE_ID}>{pathCache.get(s.STRUCTURE_ID) ?? s.NAME_SHORT}</option>)}
                    </select>
                    <RecentList
                      type="project_structure"
                      projectId={pid}
                      title="Zuletzt gebucht in diesem Projekt"
                      onSelect={(e) => setForm(f => ({ ...f, STRUCTURE_ID: String(e.ENTITY_ID) }))}
                    />
                  </div>
                  <div className="form-row">
                    <FormField label="Datum*"      id="bda" type="date"   value={form.DATE_VOUCHER}  onChange={setF('DATE_VOUCHER')} required />
                    <FormField label="Von"         id="bts" type="time"   value={form.TIME_START}    onChange={setF('TIME_START')} />
                    <FormField label="Bis"         id="btf" type="time"   value={form.TIME_FINISH}   onChange={setF('TIME_FINISH')} />
                  </div>
                  <div className="form-row">
                    <FormField label="Stunden*" id="bqi" type="number" value={form.QUANTITY_INT}  onChange={setF('QUANTITY_INT')} step="0.25" required />
                    {showRevenue && (
                      <FormField label="Zur Abrechnung*" id="bqe" type="number" value={form.QUANTITY_EXT}  onChange={setF('QUANTITY_EXT')} step="0.25" required />
                    )}
                  </div>
                  <div className="form-row">
                    {showCosts && (
                      <div className="form-group">
                        <label htmlFor="bcr">Kostensatz</label>
                        <input id="bcr" type="number" step="0.01" value={form.CP_RATE} readOnly
                          style={{ background: 'rgba(17,24,39,0.04)', cursor: 'not-allowed' }}
                          title="Wird automatisch aus dem Kostensatz-Verlauf ermittelt" />
                        {cpRateFound === false && (
                          <span style={{ fontSize: 11, color: '#dc2626', display: 'block', marginTop: 2 }}>
                            ⚠ Kein Kostensatz für dieses Datum hinterlegt — Buchung wird mit 0 gespeichert.
                          </span>
                        )}
                      </div>
                    )}
                    {showRevenue && (
                      <FormField label="Stundensatz*"  id="bsr" type="number" value={form.SP_RATE}       onChange={setF('SP_RATE')} step="0.01" required
                        readOnly={presetData?.found === true && presetData.SP_RATE != null}
                        title={presetData?.found === true && presetData.SP_RATE != null ? 'Aus Mitarbeiter/Projekt-Zuordnung vorbelegt' : undefined}
                        style={{ background: presetData?.found === true && presetData.SP_RATE != null ? 'rgba(17,24,39,0.04)' : undefined }} />
                    )}
                  </div>
                  <div className="form-group">
                    <label>Beschreibung*</label>
                    <textarea rows={2} value={form.POSTING_DESCRIPTION} onChange={setF('POSTING_DESCRIPTION')} required
                      style={{ width: '100%', padding: '10px 12px', border: '1px solid rgba(17,24,39,0.10)', borderRadius: 12, fontSize: 15, outline: 'none' }} />
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', marginTop: 6 }}>
                      <span style={{ fontSize: 11, color: 'rgba(17,24,39,0.5)', display: 'inline-flex', alignItems: 'center' }}>
                        Textbausteine <HelpHint id="bookings.text_snippets" />
                      </span>
                      {snippets.map(s => (
                        <span key={s.ID} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: 'rgba(99,102,241,0.10)', color: '#3730a3', borderRadius: 999, padding: '2px 4px 2px 10px', fontSize: 12 }}>
                          <button type="button"
                            title={s.TEXT}
                            onClick={() => setForm(f => ({ ...f, POSTING_DESCRIPTION: f.POSTING_DESCRIPTION ? `${f.POSTING_DESCRIPTION} ${s.TEXT}` : s.TEXT }))}
                            style={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', padding: 0, fontSize: 12, maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {s.LABEL || s.TEXT}
                          </button>
                          <button type="button" title="Baustein löschen" onClick={() => delSnippetMut.mutate(s.ID)}
                            style={{ background: 'none', border: 'none', color: '#6366f1', cursor: 'pointer', padding: '0 4px', fontSize: 13, lineHeight: 1 }}>×</button>
                        </span>
                      ))}
                      <button type="button"
                        disabled={!form.POSTING_DESCRIPTION.trim() || createSnippetMut.isPending}
                        onClick={() => createSnippetMut.mutate({ text: form.POSTING_DESCRIPTION.trim() })}
                        className="btn-small" style={{ fontSize: 12, padding: '2px 8px' }}>
                        ＋ Als Baustein speichern
                      </button>
                    </div>
                  </div>
                  <Message text={msg?.text ?? null} type={msg?.type} />
                  <button className="btn-primary" type="submit" disabled={createMut.isPending}>
                    {createMut.isPending ? 'Speichert …' : 'Buchung speichern'}
                  </button>
                </form>
              )}
              {!showForm && <Message text={msg?.text ?? null} type={msg?.type} />}

              <div className="list-section">
                <table className="master-table">
                  <thead>
                    <tr>
                      <th style={{ cursor: 'pointer', userSelect: 'none' }} onClick={() => toggleSort('date')}>Datum{sortIndicator('date')}</th>
                      <th style={{ cursor: 'pointer', userSelect: 'none' }} onClick={() => toggleSort('employee')}>Mitarbeiter{sortIndicator('employee')}</th>
                      <th style={{ cursor: 'pointer', userSelect: 'none' }} onClick={() => toggleSort('path')}>Strukturpfad{sortIndicator('path')}</th>
                      <th style={{ cursor: 'pointer', userSelect: 'none' }} onClick={() => toggleSort('description')}>Beschreibung{sortIndicator('description')}</th>
                      <th className="num" style={{ cursor: 'pointer', userSelect: 'none' }} onClick={() => toggleSort('h_int')}>Stunden{sortIndicator('h_int')}</th>
                      {showRevenue && <th className="num" style={{ cursor: 'pointer', userSelect: 'none' }} onClick={() => toggleSort('h_ext')}>Zur Abrechnung{sortIndicator('h_ext')}</th>}
                      {showCosts && <th className="num" style={{ cursor: 'pointer', userSelect: 'none' }} onClick={() => toggleSort('cost')}>Kosten €{sortIndicator('cost')}</th>}
                      {showRevenue && <th className="num" style={{ cursor: 'pointer', userSelect: 'none' }} onClick={() => toggleSort('revenue')}>Erlös €{sortIndicator('revenue')}</th>}
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleBuchungen.map(b => (
                      <tr key={b.ID}>
                        <td>{fmtDate(b.DATE_VOUCHER)}</td>
                        <td>{b.EMPLOYEE?.SHORT_NAME}</td>
                        <td style={{ fontSize: 13, color: 'rgba(17,24,39,0.6)' }}>
                          {b.STRUCTURE_ID != null ? pathCache.get(b.STRUCTURE_ID) ?? '—' : '—'}
                        </td>
                        <td>
                          {isSpecialKind(b.BOOKING_KIND) && (
                            <span style={{ display: 'inline-block', fontSize: 10, fontWeight: 700, letterSpacing: 0.3, color: '#3730a3', background: '#e0e7ff', padding: '1px 6px', borderRadius: 4, marginRight: 6, verticalAlign: 'middle' }}>
                              {KIND_BADGE[b.BOOKING_KIND!]}
                            </span>
                          )}
                          {b.POSTING_DESCRIPTION}
                        </td>
                        <td className="num">
                          {b.BOOKING_KIND === 'UNIT'
                            ? `${fmtN(b.QUANTITY_EXT)}${b.UNIT_LABEL ? ' ' + b.UNIT_LABEL : ''}`
                            : isSpecialKind(b.BOOKING_KIND) ? '—' : fmtN(b.QUANTITY_INT)}
                        </td>
                        {showRevenue && <td className="num">{isSpecialKind(b.BOOKING_KIND) && b.BOOKING_KIND !== 'UNIT' ? '—' : fmtN(b.QUANTITY_EXT)}</td>}
                        {showCosts && <td className="num">{fmtN(b.CP_TOT)}</td>}
                        {showRevenue && <td className="num">{fmtN(b.SP_TOT)}</td>}
                        <td className="doc-actions">
                          {b.PARTIAL_PAYMENT_ID == null && b.INVOICE_ID == null ? (
                            <>
                              <button className="row-action-btn" onClick={() => isSpecialKind(b.BOOKING_KIND) ? setEditSpecial(b) : openEdit(b)} title="Bearbeiten">
                                <Pencil size={14} strokeWidth={2} />
                              </button>
                              <button className="row-action-btn" style={{ color: '#dc2626', borderColor: '#dc2626' }} onClick={() => confirmDelete(b)} title="Löschen">
                                <Trash2 size={14} strokeWidth={2} />
                              </button>
                            </>
                          ) : (
                            <span style={{ fontSize: 11, color: 'rgba(17,24,39,0.4)', whiteSpace: 'nowrap' }}>abgerechnet</span>
                          )}
                        </td>
                      </tr>
                    ))}
                    {!visibleBuchungen.length && <tr><td colSpan={6 + (showRevenue ? 2 : 0) + (showCosts ? 1 : 0)} className="empty-note">Keine Buchungen</td></tr>}
                  </tbody>
                  <tfoot>
                    <tr style={{ fontWeight: 600, borderTop: '2px solid rgba(17,24,39,0.12)' }}>
                      <td colSpan={3} style={{ fontSize: 13, color: 'rgba(17,24,39,0.5)', paddingTop: 6 }}>
                        {visibleBuchungen.length !== buchungen.length
                          ? `${visibleBuchungen.length} / ${buchungen.length} Einträge`
                          : `${buchungen.length} Einträge`}
                      </td>
                      <td></td>
                      <td className="num">{fmtN(totalIntH)}</td>
                      {showRevenue && <td className="num">{fmtN(totalExtH)}</td>}
                      {showCosts && <td className="num">{fmtN(totalCost)}</td>}
                      {showRevenue && <td className="num">{fmtN(totalRev)}</td>}
                      <td></td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </>
          )}
        </>
      )}

      {/* ── Edit modal ── */}
      <Modal open={editRow !== null} onClose={() => setEditRow(null)} title="Buchung bearbeiten">
        <form onSubmit={submitEdit} className="master-form">
          <div className="form-group">
            <label>Mitarbeiter*</label>
            <select value={editForm.EMPLOYEE_ID} onChange={setEF('EMPLOYEE_ID')} required>
              <option value="">Bitte wählen …</option>
              {employees.map(e => <option key={e.ID} value={e.ID}>{e.SHORT_NAME}: {e.FIRST_NAME} {e.LAST_NAME}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label>Projektelement</label>
            <select value={editForm.STRUCTURE_ID} onChange={setEF('STRUCTURE_ID')}>
              <option value="">—</option>
              {leafStructure.map(s => <option key={s.STRUCTURE_ID} value={s.STRUCTURE_ID}>{pathCache.get(s.STRUCTURE_ID) ?? s.NAME_SHORT}</option>)}
            </select>
          </div>
          <div className="form-row">
            <FormField label="Datum*"      id="eda" type="date"   value={editForm.DATE_VOUCHER}  onChange={setEF('DATE_VOUCHER')} required />
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
              <FormField label="Kostensatz*"   id="ecr" type="number" value={editForm.CP_RATE}       onChange={setEF('CP_RATE')} step="0.01" required />
            )}
            {showRevenue && (
              <FormField label="Stundensatz*"  id="esr" type="number" value={editForm.SP_RATE}       onChange={setEF('SP_RATE')} step="0.01" required />
            )}
          </div>
          <div className="form-group">
            <label>Beschreibung*</label>
            <textarea rows={2} value={editForm.POSTING_DESCRIPTION} onChange={setEF('POSTING_DESCRIPTION')} required
              style={{ width: '100%', padding: '10px 12px', border: '1px solid rgba(17,24,39,0.10)', borderRadius: 12, fontSize: 15, outline: 'none' }} />
          </div>
          <Message text={editMsg?.text ?? null} type={editMsg?.type} />
          <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
            <button className="btn-primary" type="submit" disabled={patchMut.isPending}>
              {patchMut.isPending ? 'Speichert …' : 'Speichern'}
            </button>
            <button type="button" className="btn-small" onClick={() => setEditRow(null)}>
              Abbrechen
            </button>
          </div>
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
            setMsg({ text: 'Buchung gespeichert ✅', type: 'success' })
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
            setMsg({ text: 'Buchung aktualisiert ✅', type: 'success' })
            void qc.invalidateQueries({ queryKey: ['buchungen', pid] })
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
  const [date,          setDate]          = useState<string>(existing ? fmtDate(existing.DATE_VOUCHER) : todayIso())
  const [description,   setDescription]   = useState<string>(existing?.POSTING_DESCRIPTION ?? '')
  const [quantity,      setQuantity]      = useState<string>(existing && kind === 'UNIT' ? String(existing.QUANTITY_EXT ?? '') : '')
  const [unitLabel,     setUnitLabel]     = useState<string>(existing?.UNIT_LABEL ?? '')
  const [spRate,        setSpRate]        = useState<string>(existing && kind === 'UNIT' && existing.SP_RATE != null ? String(existing.SP_RATE) : '')
  const [cpRate,        setCpRate]        = useState<string>(existing && kind === 'UNIT' && existing.CP_RATE != null ? String(existing.CP_RATE) : '')
  const [amount,        setAmount]        = useState<string>(
    existing && kind === 'LUMP_COST'    ? String(existing.CP_TOT ?? '') :
    existing && kind === 'LUMP_REVENUE' ? String(existing.SP_TOT ?? '') : ''
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
    setDescription(t.NAME_LONG || t.NAME_SHORT)
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
        DATE_VOUCHER:        date,
        BOOKING_TYPE_ID:     bookingTypeId ? Number(bookingTypeId) : undefined,
        POSTING_DESCRIPTION: description,
        ...(isUnit
          ? { QUANTITY: num(quantity), UNIT_LABEL: unitLabel || undefined, SP_RATE: num(spRate), CP_RATE: num(cpRate) }
          : { AMOUNT: num(amount) }),
      }
      return isEdit ? updateSpecialBuchung(existing!.ID, payload) : createSpecialBuchung(payload)
    },
    onSuccess: onSaved,
    onError: (e: Error) => setMsg({ text: e.message, type: 'error' }),
  })

  function submit(e: React.FormEvent) {
    e.preventDefault()
    setMsg(null)
    if (!description.trim()) { setMsg({ text: 'Bitte eine Bezeichnung angeben', type: 'error' }); return }
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
          <label>Aus Katalog (optional)</label>
          <select value={bookingTypeId} onChange={e => applyType(e.target.value)}>
            <option value="">— Freitext (ohne Katalog) —</option>
            {types.map(t => (
              <option key={t.ID} value={t.ID}>
                {t.NAME_SHORT}{t.NAME_LONG ? ` – ${t.NAME_LONG}` : ''}{t.SCOPE === 'project' ? ' (Projekt)' : ''}
              </option>
            ))}
          </select>
        </div>

        <div className="form-group">
          <label>Projektelement</label>
          <select value={structureId} onChange={e => setStructureId(e.target.value)}>
            <option value="">—</option>
            {leafStructure.map(s => (
              <option key={s.STRUCTURE_ID} value={s.STRUCTURE_ID}>{pathCache.get(s.STRUCTURE_ID) ?? `#${s.STRUCTURE_ID}`}</option>
            ))}
          </select>
          {kind === 'LUMP_REVENUE' && (
            <span style={{ fontSize: 11, color: 'rgba(17,24,39,0.55)', display: 'block', marginTop: 2 }}>
              Wird auf Stunden-Projektelementen (TEC) wie eine Stundenbuchung abgerechnet.
            </span>
          )}
        </div>

        <div className="form-row">
          <FormField label="Datum*" id="sb-date" type="date" value={date} onChange={e => setDate(e.target.value)} required />
        </div>

        <div className="form-group">
          <label>Bezeichnung*</label>
          <textarea rows={2} value={description} onChange={e => setDescription(e.target.value)} required
            style={{ width: '100%', padding: '10px 12px', border: '1px solid rgba(17,24,39,0.10)', borderRadius: 12, fontSize: 15, outline: 'none' }} />
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

        <div style={{ fontSize: 13, color: 'rgba(17,24,39,0.7)', margin: '4px 0 8px' }}>
          {kind === 'LUMP_COST'
            ? <>Belastet das Projekt mit <strong>{FMT_NUM.format(previewCost)} €</strong> Kosten.</>
            : kind === 'LUMP_REVENUE'
              ? <>Abrechenbarer Erlös: <strong>{FMT_NUM.format(previewTotal)} €</strong>.</>
              : <>Erlös: <strong>{FMT_NUM.format(previewTotal)} €</strong>{showCosts ? <> · Kosten: <strong>{FMT_NUM.format(previewCost)} €</strong></> : null}</>}
        </div>

        <Message text={msg?.text ?? null} type={msg?.type} />
        <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
          <button className="btn-primary" type="submit" disabled={saveMut.isPending}>
            {saveMut.isPending ? 'Speichert …' : 'Buchung speichern'}
          </button>
          <button type="button" className="btn-small" onClick={onClose}>Abbrechen</button>
        </div>
      </form>
    </Modal>
  )
}
