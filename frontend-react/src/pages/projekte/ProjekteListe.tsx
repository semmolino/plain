import { useState, useMemo, useRef, useCallback, useEffect } from 'react'
import { useStickyState } from '@/hooks/useStickyState'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { SlidersHorizontal, Pencil, Copy, Trash2 } from 'lucide-react'
import { Can } from '@/components/ui/Can'
import { Modal }         from '@/components/ui/Modal'
import { Message }       from '@/components/ui/Message'
import { ConfirmModal }  from '@/components/ui/ConfirmModal'
import { useToast }      from '@/store/toastStore'
import { Autocomplete }  from '@/components/ui/Autocomplete'
import { useCtrlS }      from '@/hooks/useCtrlS'
import { ProjekteAnlegen } from '@/pages/projekte/ProjekteAnlegen'
import {
  fetchProjectListFull, updateProject, deleteProject, fetchContractByProject, patchContract,
  fetchProjectStatuses, fetchProjectTypes, fetchProjectManagers, fetchDepartments,
  cascadeProjectInternal, copyProject,
  type Project,
} from '@/api/projekte'
import { searchAddressesApi, fetchContactsByAddress } from '@/api/stammdaten'

const PAGE_SIZE = 25
type SortKey = 'NAME_SHORT' | 'NAME_LONG' | 'STATUS_NAME' | 'MANAGER_NAME' | 'TYPE_NAME' | 'DEPARTMENT_NAME' | 'ADDRESS_NAME'

type OptColKey = 'TYPE_NAME' | 'DEPARTMENT_NAME' | 'ADDRESS_NAME'

interface OptColDef { key: OptColKey; label: string; defaultVisible: boolean }
const OPT_COLS: OptColDef[] = [
  { key: 'TYPE_NAME',       label: 'Typ',       defaultVisible: false },
  { key: 'DEPARTMENT_NAME', label: 'Abteilung', defaultVisible: false },
  { key: 'ADDRESS_NAME',    label: 'Adresse',   defaultVisible: false },
]

type FilterDim = 'status' | 'typ' | 'manager'
type ActiveFilters = Record<FilterDim, Set<string>>
const emptyFilters = (): ActiveFilters => ({ status: new Set(), typ: new Set(), manager: new Set() })

// null = all, true = only internal, false = only external
type InternalFilter = null | boolean

function FilterChip({ label, options, active, onChange }: {
  label: string; options: string[]; active: Set<string>; onChange: (v: Set<string>) => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [open])
  function toggle(val: string) { const s = new Set(active); s.has(val) ? s.delete(val) : s.add(val); onChange(s) }
  const count = active.size
  return (
    <div ref={ref} className="filter-chip-wrap">
      <button className={`filter-chip-btn${count > 0 ? ' active' : ''}`} onClick={() => setOpen(o => !o)}>
        {label}{count > 0 ? ` (${count})` : ''} ▾
      </button>
      {count > 0 && <button className="filter-chip-clear" onClick={() => { onChange(new Set()); setOpen(false) }} title="Zurücksetzen">×</button>}
      {open && (
        <div className="filter-chip-dropdown">
          {options.length === 0 ? <div className="filter-chip-empty">Keine Optionen</div> : options.map(opt => (
            <label key={opt} className="filter-chip-option">
              <input type="checkbox" checked={active.has(opt)} onChange={() => toggle(opt)} />
              {opt || '(ohne)'}
            </label>
          ))}
        </div>
      )}
    </div>
  )
}

function SortTh({ label, k, sortKey, dir, onClick }: {
  label: string; k: SortKey; sortKey: SortKey; dir: 'asc'|'desc'; onClick: (k: SortKey) => void
}) {
  return (
    <th className="sortable-th" onClick={() => onClick(k)}>
      {label} {sortKey === k ? (dir === 'asc' ? '▲' : '▼') : ''}
    </th>
  )
}

type ContactOption = { ID: number; FIRST_NAME: string; LAST_NAME: string }
type ContractConfirm = { contractId: number; addressId: number | null; contactId: number | null }

export function ProjekteListe({ onSelectProject, onProjectCreated }: { onSelectProject?: (id: number) => void; onProjectCreated?: (id: number) => void }) {
  const qc       = useQueryClient()
  const navigate = useNavigate()
  const toast    = useToast()

  const [confirmState, setConfirmState] = useState<{ title: string; message: string; onConfirm: () => void } | null>(null)
  const [showCreate, setShowCreate] = useState(false)

  // list state
  const [search,        setSearch]        = useState('')
  const [sortKey,       setSortKey]       = useStickyState<SortKey>('projekte.sortKey', 'NAME_SHORT')
  const [sortDir,       setSortDir]       = useStickyState<'asc'|'desc'>('projekte.sortDir', 'asc')
  const [page,          setPage]          = useState(1)
  const [activeFilters, setActiveFilters] = useStickyState<ActiveFilters>('projekte.filters', emptyFilters, {
    serialize:   f => ({ status: [...f.status], typ: [...f.typ], manager: [...f.manager] }),
    deserialize: raw => {
      const r = emptyFilters(); const o = (raw ?? {}) as Record<string, unknown>
      if (Array.isArray(o.status))  r.status  = new Set(o.status as string[])
      if (Array.isArray(o.typ))     r.typ     = new Set(o.typ as string[])
      if (Array.isArray(o.manager)) r.manager = new Set(o.manager as string[])
      return r
    },
  })
  const [hiddenCols,    setHiddenCols]    = useStickyState<Set<OptColKey>>(
    'projekte.cols',
    () => new Set(OPT_COLS.filter(c => !c.defaultVisible).map(c => c.key)),
    { serialize: s => [...s], deserialize: raw => new Set(Array.isArray(raw) ? raw as OptColKey[] : []) },
  )
  const [colPanelOpen,    setColPanelOpen]    = useState(false)
  const [internalFilter,  setInternalFilter]  = useStickyState<InternalFilter>('projekte.internal', null)
  const colPanelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!colPanelOpen) return
    const h = (e: MouseEvent) => { if (colPanelRef.current && !colPanelRef.current.contains(e.target as Node)) setColPanelOpen(false) }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [colPanelOpen])

  // edit modal state
  const [editRow, setEditRow] = useState<Project | null>(null)
  const [editForm, setEditForm] = useState({
    name_short: '', name_long: '',
    project_status_id: '', project_type_id: '', project_manager_id: '',
    department_id: '',
    address_id: '', address_text: '',
    contact_id: '',
    is_internal: false,
  })
  const [contacts, setContacts] = useState<ContactOption[]>([])
  const [contractConfirm, setContractConfirm] = useState<ContractConfirm | null>(null)
  const [editMsg, setEditMsg] = useState<{ text: string; type: 'success'|'error' } | null>(null)

  const editFormRef = useRef<HTMLFormElement>(null)

  const { data: listData, isLoading } = useQuery({ queryKey: ['projects-full'], queryFn: fetchProjectListFull })
  const { data: statusData }          = useQuery({ queryKey: ['project-statuses'], queryFn: fetchProjectStatuses })
  const { data: typeData }            = useQuery({ queryKey: ['project-types'], queryFn: fetchProjectTypes })
  const { data: mgrData }             = useQuery({ queryKey: ['project-managers'], queryFn: fetchProjectManagers })
  const { data: deptData }            = useQuery({ queryKey: ['project-departments'], queryFn: fetchDepartments })

  const projects    = listData?.data ?? []
  const statuses    = statusData?.data ?? []
  const types       = typeData?.data   ?? []
  const managers    = mgrData?.data    ?? []
  const departments = deptData?.data   ?? []

  const filterOptions = useMemo(() => {
    const uniq = (fn: (p: Project) => string | null | undefined) =>
      [...new Set(projects.map(fn).filter((v): v is string => v != null && v !== ''))].sort()
    return {
      status:  uniq(p => p.STATUS_NAME),
      typ:     uniq(p => p.TYPE_NAME),
      manager: uniq(p => p.MANAGER_NAME),
    }
  }, [projects])

  const processed = useMemo(() => {
    const q = search.trim().toLowerCase()
    let rows = q
      ? projects.filter(p => `${p.NAME_SHORT} ${p.NAME_LONG} ${p.STATUS_NAME} ${p.MANAGER_NAME} ${p.TYPE_NAME ?? ''} ${p.DEPARTMENT_NAME ?? ''} ${p.ADDRESS_NAME ?? ''}`.toLowerCase().includes(q))
      : projects

    if (activeFilters.status.size > 0) rows = rows.filter(p => p.STATUS_NAME && activeFilters.status.has(p.STATUS_NAME))
    if (activeFilters.typ.size    > 0) rows = rows.filter(p => p.TYPE_NAME    && activeFilters.typ.has(p.TYPE_NAME))
    if (activeFilters.manager.size > 0) rows = rows.filter(p => p.MANAGER_NAME && activeFilters.manager.has(p.MANAGER_NAME))
    if (internalFilter !== null) rows = rows.filter(p => (p.IS_INTERNAL ?? false) === internalFilter)

    rows = [...rows].sort((a, b) => {
      const av = String(a[sortKey] ?? '')
      const bv = String(b[sortKey] ?? '')
      return sortDir === 'asc'
        ? av.localeCompare(bv, 'de', { sensitivity: 'base', numeric: true })
        : bv.localeCompare(av, 'de', { sensitivity: 'base', numeric: true })
    })
    return rows
  }, [projects, search, sortKey, sortDir, activeFilters])

  const totalPages = Math.max(1, Math.ceil(processed.length / PAGE_SIZE))
  const safePage   = Math.min(page, totalPages)
  const pageRows   = processed.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE)

  const hasActiveFilter = Object.values(activeFilters).some(s => s.size > 0) || search.trim() !== '' || internalFilter !== null

  function setDimFilter(dim: FilterDim, vals: Set<string>) {
    setActiveFilters(prev => ({ ...prev, [dim]: vals }))
    setPage(1)
  }

  function toggleSort(k: SortKey) {
    if (sortKey === k) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortKey(k); setSortDir('asc') }
    setPage(1)
  }

  function toggleCol(key: OptColKey) {
    setHiddenCols(prev => { const s = new Set(prev); s.has(key) ? s.delete(key) : s.add(key); return s })
  }

  const visibleOptCols = OPT_COLS.filter(c => !hiddenCols.has(c.key))

  const deleteMut = useMutation({
    mutationFn: deleteProject,
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['projects-full'] }),
    onError: (e: Error) => toast.error(e.message),
  })

  function handleDelete(p: Project) {
    setConfirmState({
      title: 'Projekt löschen',
      message: `Projekt „${p.NAME_SHORT} – ${p.NAME_LONG}" wirklich löschen?`,
      onConfirm: () => deleteMut.mutate(p.ID),
    })
  }

  const updateMut = useMutation({
    mutationFn: ({ id, body }: { id: number; body: Parameters<typeof updateProject>[1] }) =>
      updateProject(id, body),
    onSuccess: async (_data, variables) => {
      void qc.invalidateQueries({ queryKey: ['projects-full'] })

      const origAddressId = editRow?.ADDRESS_ID ? String(editRow.ADDRESS_ID) : ''
      const origContactId = editRow?.CONTACT_ID ? String(editRow.CONTACT_ID) : ''
      const addrChanged   = editForm.address_id !== origAddressId
      const ctctChanged   = editForm.contact_id !== origContactId

      if (addrChanged || ctctChanged) {
        try {
          const res = await fetchContractByProject(variables.id)
          const contract = res.data
          if (contract?.ID) {
            setEditMsg({ text: 'Projekt gespeichert ✅', type: 'success' })
            setContractConfirm({
              contractId: contract.ID,
              addressId:  editForm.address_id ? Number(editForm.address_id) : null,
              contactId:  editForm.contact_id ? Number(editForm.contact_id) : null,
            })
            return
          }
        } catch {
          // contract not found — just close
        }
      }

      setEditMsg({ text: 'Gespeichert ✅', type: 'success' })
      setTimeout(() => closeEdit(), 800)
    },
    onError: (e: Error) => setEditMsg({ text: e.message, type: 'error' }),
  })

  const cascadeMut = useMutation({
    mutationFn: ({ id, val }: { id: number; val: boolean }) => cascadeProjectInternal(id, val),
  })

  const internalMut = useMutation({
    mutationFn: ({ id, val }: { id: number; val: boolean }) => updateProject(id, { is_internal: val }),
    onSuccess: (_data, variables) => {
      void qc.invalidateQueries({ queryKey: ['projects-full'] })
      setConfirmState({
        title: 'Strukturpositionen aktualisieren',
        message: 'Sollen alle Strukturpositionen dieses Projekts ebenfalls entsprechend markiert werden?',
        onConfirm: () => cascadeMut.mutate({ id: variables.id, val: variables.val }),
      })
    },
  })

  const copyMut = useMutation({
    mutationFn: (id: number) => copyProject(id),
    onSuccess: (res) => {
      void qc.invalidateQueries({ queryKey: ['projects-full'] })
      toast.success(`Projekt kopiert: ${res.data.projectName}`)
    },
    onError: (e: Error) => toast.error(e.message),
  })

  async function applyToContract(confirm: ContractConfirm) {
    try {
      await patchContract(confirm.contractId, {
        INVOICE_ADDRESS_ID: confirm.addressId,
        INVOICE_CONTACT_ID: confirm.contactId,
      })
    } catch (e: unknown) {
      setEditMsg({ text: `Vertrag konnte nicht aktualisiert werden: ${e instanceof Error ? e.message : String(e)}`, type: 'error' })
    } finally {
      setContractConfirm(null)
      closeEdit()
    }
  }

  function closeEdit() {
    setEditRow(null)
    setContractConfirm(null)
    setContacts([])
    setEditMsg(null)
  }

  async function openEdit(p: Project) {
    setEditForm({
      name_short:         p.NAME_SHORT ?? '',
      name_long:          p.NAME_LONG  ?? '',
      project_status_id:  String(p.PROJECT_STATUS_ID  ?? ''),
      project_type_id:    String(p.PROJECT_TYPE_ID    ?? ''),
      project_manager_id: String(p.PROJECT_MANAGER_ID ?? ''),
      department_id:      String(p.DEPARTMENT_ID      ?? ''),
      address_id:         String(p.ADDRESS_ID         ?? ''),
      address_text:       p.ADDRESS_NAME              ?? '',
      contact_id:         String(p.CONTACT_ID         ?? ''),
      is_internal:        p.IS_INTERNAL ?? false,
    })
    setContacts([])
    setContractConfirm(null)
    setEditMsg(null)
    setEditRow(p)
    if (p.ADDRESS_ID) {
      try {
        const r = await fetchContactsByAddress(p.ADDRESS_ID)
        setContacts(r.data ?? [])
      } catch { /* ignore */ }
    }
  }

  function submitEdit(e: React.FormEvent) {
    e.preventDefault()
    if (!editRow) return
    updateMut.mutate({
      id: editRow.ID,
      body: {
        name_short:         editForm.name_short,
        name_long:          editForm.name_long,
        project_status_id:  editForm.project_status_id  ? Number(editForm.project_status_id)  : undefined,
        project_type_id:    editForm.project_type_id    ? Number(editForm.project_type_id)    : null,
        project_manager_id: editForm.project_manager_id ? Number(editForm.project_manager_id) : undefined,
        department_id:      editForm.department_id      ? Number(editForm.department_id)      : null,
        address_id:         editForm.address_id         ? Number(editForm.address_id)         : null,
        contact_id:         editForm.contact_id         ? Number(editForm.contact_id)         : null,
        is_internal:        editForm.is_internal,
      },
    })
  }

  useCtrlS(() => editFormRef.current?.requestSubmit(), editRow !== null && contractConfirm === null)

  const setE = (k: keyof typeof editForm) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      setEditForm(f => ({ ...f, [k]: e.target.value }))

  const searchAddresses = useCallback(async (q: string) => {
    const r = await searchAddressesApi(q)
    return (r.data ?? []).map(a => ({ id: a.ID, label: a.ADDRESS_NAME_1 }))
  }, [])

  async function handleAddressSelect(id: string | number, label: string) {
    setEditForm(f => ({ ...f, address_id: String(id), address_text: label, contact_id: '' }))
    setContacts([])
    try {
      const r = await fetchContactsByAddress(Number(id))
      setContacts(r.data ?? [])
    } catch { /* ignore */ }
  }

  const sortProps = { sortKey, dir: sortDir, onClick: toggleSort }
  const actionColSpan = 1 + (onSelectProject ? 1 : 0)

  return (
    <>
      <div className="pl-toolbar">
        <input
          className="list-search"
          placeholder="Suchen …"
          value={search}
          onChange={e => { setSearch(e.target.value); setPage(1) }}
        />
        <div className="pl-filter-chips">
          <FilterChip label="Status"   options={filterOptions.status}  active={activeFilters.status}  onChange={v => setDimFilter('status', v)}  />
          <FilterChip label="Typ"      options={filterOptions.typ}     active={activeFilters.typ}     onChange={v => setDimFilter('typ', v)}     />
          <FilterChip label="Leitung"  options={filterOptions.manager} active={activeFilters.manager} onChange={v => setDimFilter('manager', v)} />
          <button
            className={`filter-chip-btn${internalFilter !== null ? ' active' : ''}`}
            title="Filter: Internes Projekt"
            onClick={() => {
              setInternalFilter(f => f === null ? true : f === true ? false : null)
              setPage(1)
            }}
          >
            Intern{internalFilter === true ? ': Ja' : internalFilter === false ? ': Nein' : ''} ▾
          </button>
          {hasActiveFilter && (
            <button className="pl-clear-btn" onClick={() => { setActiveFilters(emptyFilters()); setSearch(''); setInternalFilter(null); setPage(1) }}>
              Alle Filter löschen
            </button>
          )}
        </div>
        <div ref={colPanelRef} className="pl-col-wrap">
          <button className="pl-col-btn" onClick={() => setColPanelOpen(o => !o)} style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><SlidersHorizontal size={13} strokeWidth={2} />Spalten</button>
          {colPanelOpen && (
            <div className="pl-col-panel">
              <div className="pl-col-panel-title">Optionale Spalten</div>
              {OPT_COLS.map(c => (
                <label key={c.key} className="pl-col-option">
                  <input type="checkbox" checked={!hiddenCols.has(c.key)} onChange={() => toggleCol(c.key)} />
                  {c.label}
                </label>
              ))}
            </div>
          )}
        </div>
        <span className="list-info">
          {processed.length}{processed.length !== projects.length ? ` / ${projects.length}` : ''} Projekte · Seite {safePage}/{totalPages}
        </span>
        <Can permission="projects.create">
          <button className="btn-primary btn-small" style={{ marginLeft: 'auto' }} onClick={() => setShowCreate(true)}>
            + Neues Projekt
          </button>
        </Can>
      </div>

      {hasActiveFilter && (() => {
        const chips: string[] = []
        if (search.trim()) chips.push(`"${search.trim()}"`)
        if (internalFilter === true) chips.push('Intern: Ja')
        if (internalFilter === false) chips.push('Intern: Nein')
        Object.entries(activeFilters).forEach(([, s]) => s.forEach((v: string) => chips.push(v)))
        return (
          <div className="filter-summary">
            <span className="filter-summary-count">{processed.length} von {projects.length}</span>
            {chips.map(c => <span key={c} className="filter-summary-chip">{c}</span>)}
            <button className="filter-summary-clear" onClick={() => { setSearch(''); setInternalFilter(null); setActiveFilters(emptyFilters()) }}>× Alle löschen</button>
          </div>
        )
      })()}

      {isLoading && <p className="empty-note">Laden …</p>}
      {!isLoading && (
        <>
          <div className="list-section">
            <table className="master-table">
              <thead>
                <tr>
                  <SortTh label="Kürzel"   k="NAME_SHORT"   {...sortProps} />
                  <SortTh label="Name"     k="NAME_LONG"    {...sortProps} />
                  <SortTh label="Status"   k="STATUS_NAME"  {...sortProps} />
                  <SortTh label="Leitung"  k="MANAGER_NAME" {...sortProps} />
                  {visibleOptCols.map(c => (
                    <SortTh key={c.key} label={c.label} k={c.key} {...sortProps} />
                  ))}
                  <th style={{ textAlign: 'center', fontSize: 11, color: '#6b7280', whiteSpace: 'nowrap' }}>Intern</th>
                  <th></th>
                  {onSelectProject && <th></th>}
                </tr>
              </thead>
              <tbody>
                {pageRows.map(p => (
                  <tr key={p.ID} style={p.IS_INTERNAL ? { opacity: 0.7 } : undefined}>
                    <td>
                      {p.NAME_SHORT}
                      {p.IS_INTERNAL && <span className="mahnstufe-badge ms-0" style={{ marginLeft: 6, fontSize: 10 }}>intern</span>}
                    </td>
                    <td>{p.NAME_LONG}</td>
                    <td>{p.STATUS_NAME}</td>
                    <td>{p.MANAGER_NAME}</td>
                    {visibleOptCols.map(c => {
                      if (c.key === 'ADDRESS_NAME' && p.ADDRESS_ID) {
                        return <td key={c.key}><button className="link-cell" onClick={() => navigate('/adressen', { state: { openAddressId: p.ADDRESS_ID } })}>{p.ADDRESS_NAME ?? '—'}</button></td>
                      }
                      return <td key={c.key}>{p[c.key] ?? '—'}</td>
                    })}
                    <td style={{ textAlign: 'center' }}>
                      <input
                        type="checkbox"
                        checked={p.IS_INTERNAL ?? false}
                        title="Internes Projekt"
                        disabled={internalMut.isPending}
                        onChange={e => internalMut.mutate({ id: p.ID, val: e.target.checked })}
                        style={{ width: 16, height: 16, cursor: 'pointer' }}
                      />
                    </td>
                    <td className="doc-actions">
                      <Can permission="projects.edit">
                        <button className="row-action-btn" onClick={() => openEdit(p)} title="Bearbeiten">
                          <Pencil size={14} strokeWidth={2} />
                        </button>
                      </Can>
                      <Can permission="projects.create">
                        <button className="row-action-btn" onClick={() => copyMut.mutate(p.ID)} disabled={copyMut.isPending} title="Kopieren">
                          <Copy size={14} strokeWidth={2} />
                        </button>
                      </Can>
                      <Can permission="projects.delete">
                        <button className="row-action-btn" style={{ color: '#dc2626', borderColor: '#dc2626' }} onClick={() => handleDelete(p)} title="Löschen">
                          <Trash2 size={14} strokeWidth={2} />
                        </button>
                      </Can>
                    </td>
                    {onSelectProject && (
                      <td><button className="btn-small btn-save" onClick={() => onSelectProject(p.ID)}>Öffnen</button></td>
                    )}
                  </tr>
                ))}
                {!pageRows.length && (
                  <tr><td colSpan={5 + visibleOptCols.length + actionColSpan} className="empty-note">
                    {hasActiveFilter ? 'Keine Projekte für diese Filter.' : 'Noch keine Projekte angelegt. Lege oben rechts mit „+ Neues Projekt" das erste an.'}
                  </td></tr>
                )}
              </tbody>
              <tfoot>
                <tr style={{ fontWeight: 600, borderTop: '2px solid rgba(17,24,39,0.12)' }}>
                  <td colSpan={5 + visibleOptCols.length + actionColSpan} style={{ fontSize: 13, color: 'rgba(17,24,39,0.5)', paddingTop: 6 }}>
                    {processed.length !== projects.length ? `${processed.length} / ${projects.length} Einträge` : `${projects.length} Einträge`}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
          <div className="pagination">
            <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={safePage <= 1}>← Zurück</button>
            <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={safePage >= totalPages}>Weiter →</button>
          </div>
        </>
      )}

      <ConfirmModal
        open={confirmState !== null}
        title={confirmState?.title ?? ''}
        message={confirmState?.message ?? ''}
        onConfirm={() => confirmState?.onConfirm()}
        onCancel={() => setConfirmState(null)}
      />

      <Modal open={editRow !== null} onClose={closeEdit} title="Projekt bearbeiten">
        {contractConfirm ? (
          <div className="master-form">
            <p style={{ marginBottom: 16 }}>
              Soll die Adresse / der Kontakt auch im Vertrag übernommen werden?
            </p>
            <Message text={editMsg?.text ?? null} type={editMsg?.type} />
            <div className="modal-actions">
              <button className="btn-primary" onClick={() => applyToContract(contractConfirm)}>
                Ja, übernehmen
              </button>
              <button type="button" onClick={closeEdit}>Nein</button>
            </div>
          </div>
        ) : (
          <form ref={editFormRef} onSubmit={submitEdit} className="master-form">
            <div className="form-group">
              <label>Kürzel</label>
              <input value={editForm.name_short} onChange={setE('name_short')} />
            </div>
            <div className="form-group">
              <label>Name</label>
              <input value={editForm.name_long} onChange={setE('name_long')} />
            </div>
            <div className="form-group">
              <label>Status</label>
              <select value={editForm.project_status_id} onChange={setE('project_status_id')}>
                <option value="">—</option>
                {statuses.map(s => <option key={s.ID} value={s.ID}>{s.NAME_SHORT}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label>Typ</label>
              <select value={editForm.project_type_id} onChange={setE('project_type_id')}>
                <option value="">—</option>
                {types.map(t => <option key={t.ID} value={t.ID}>{t.NAME_SHORT}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label>Projektleitung</label>
              <select value={editForm.project_manager_id} onChange={setE('project_manager_id')}>
                <option value="">—</option>
                {managers.map(m => <option key={m.ID} value={m.ID}>{m.SHORT_NAME}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label>Abteilung</label>
              <select value={editForm.department_id} onChange={setE('department_id')}>
                <option value="">—</option>
                {departments.map(d => <option key={d.ID} value={d.ID}>{d.NAME_SHORT}</option>)}
              </select>
            </div>
            <Autocomplete
              label="Adresse"
              htmlId="edit-proj-address"
              value={editForm.address_text}
              onChange={text => setEditForm(f => ({ ...f, address_text: text, address_id: '', contact_id: '' }))}
              onSelect={handleAddressSelect}
              search={searchAddresses}
              placeholder="Name eingeben …"
            />
            <div className="form-group">
              <label>Kontakt</label>
              <select
                value={editForm.contact_id}
                onChange={setE('contact_id')}
                disabled={!editForm.address_id}
              >
                <option value="">—</option>
                {contacts.map(c => (
                  <option key={c.ID} value={c.ID}>
                    {`${c.FIRST_NAME} ${c.LAST_NAME}`.trim()}
                  </option>
                ))}
              </select>
            </div>
            <div className="form-group" style={{ marginTop: 12 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={editForm.is_internal}
                  onChange={e => setEditForm(f => ({ ...f, is_internal: e.target.checked }))}
                />
                <span>Internes Projekt</span>
                <span style={{ fontSize: 11, color: '#6b7280' }}>(nicht Teil von Verträgen / Rechnungen)</span>
              </label>
            </div>
            <Message text={editMsg?.text ?? null} type={editMsg?.type} />
            <div className="modal-actions">
              <button className="btn-primary" type="submit" disabled={updateMut.isPending}>
                {updateMut.isPending ? 'Speichert …' : 'Speichern'}
              </button>
              <button type="button" onClick={closeEdit}>Abbrechen</button>
            </div>
          </form>
        )}
      </Modal>

      <Modal open={showCreate} onClose={() => setShowCreate(false)} title="Neues Projekt anlegen" className="modal-wide">
        <ProjekteAnlegen onProjectCreated={id => { setShowCreate(false); onProjectCreated?.(id) }} />
      </Modal>
    </>
  )
}
