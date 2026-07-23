import { useState, useCallback, useMemo, useRef, useEffect } from 'react'
import { useStickyState, useStickySet } from '@/hooks/useStickyState'
import { useLocation, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { SlidersHorizontal, Pencil, Trash2, Plus, Download, Star } from 'lucide-react'
import { Can } from '@/components/ui/Can'
import { useFilterTabs, usePermission } from '@/store/permissionsStore'
import { InlineSelect, type InlineOption } from '@/components/ui/InlineEdit'
import { Tabs }        from '@/components/ui/Tabs'
import { Modal }       from '@/components/ui/Modal'
import { ConfirmModal } from '@/components/ui/ConfirmModal'
import { useCtrlS } from '@/hooks/useCtrlS'
import { useToast }  from '@/store/toastStore'
import { RecentList } from '@/components/recents/RecentList'
import { trackRecent } from '@/api/recents'
import { AddrForm, ContactForm, emptyAddr, emptyContact, addressToPayload, contactToPayload } from '@/pages/adressen/addressForms'
import { downloadCsv, downloadText, contactVCard } from '@/utils/exportData'
import {
  fetchCountries, fetchSalutations, fetchGenders,
  fetchAddressList, searchAddressesApi, createAddress, updateAddress, deleteAddress,
  fetchContactList, createContact, updateContact, deleteContact,
  addressTypeLabel, ADDRESS_TYPES,
  type Address, type Contact, type AddressPayload, type ContactPayload,
} from '@/api/stammdaten'

// Inline-Optionen für die Adress-Kategorie (spiegelt den ADDRESS_TYPE-Katalog).
const CATEGORY_OPTS: InlineOption[] = ADDRESS_TYPES.map(t => ({ value: String(t.id), label: t.label }))

// ── Page-level tabs ─────────────────────────────────────────────────────────

const PAGE_TABS: { id: string; label: string; permissions: string[] }[] = [
  { id: 'adressen', label: 'Adressen',  permissions: ['addresses.view'] },
  { id: 'kontakte', label: 'Kontakte',  permissions: ['addresses.contacts.view'] },
]

// ── Filter chip ───────────────────────────────────────────────────────────────

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

// ── Address sort + opt cols ───────────────────────────────────────────────────

type AddrSortKey = 'ADDRESS_NAME_1' | 'CITY' | 'COUNTRY' | 'CUSTOMER_NUMBER'
type AddrOptColKey = 'ADDRESS_TYPE' | 'ADDRESS_NAME_2' | 'STREET' | 'PHONE' | 'EMAIL' | 'TAX_ID' | 'BUYER_REFERENCE'

interface AddrOptColDef { key: AddrOptColKey; label: string }
const ADDR_OPT_COLS: AddrOptColDef[] = [
  { key: 'ADDRESS_TYPE',   label: 'Kategorie'      },
  { key: 'ADDRESS_NAME_2', label: 'Name 2'         },
  { key: 'STREET',         label: 'Straße'          },
  { key: 'PHONE',          label: 'Telefon'         },
  { key: 'EMAIL',          label: 'E-Mail'          },
  { key: 'TAX_ID',         label: 'USt-IdNr.'       },
  { key: 'BUYER_REFERENCE',label: 'Käuferreferenz'  },
]

function addrOptCell(a: Address, key: AddrOptColKey): string {
  if (key === 'ADDRESS_TYPE') return addressTypeLabel(a.ADDRESS_TYPE) || '—'
  return (a[key as keyof Address] as string | null | undefined) ?? '—'
}

// ── Contact sort + opt cols ───────────────────────────────────────────────────

type ConSortKey  = 'NAME' | 'SALUTATION' | 'GENDER' | 'ADDRESS'
type ConOptColKey = 'POSITION' | 'DEPARTMENT' | 'TITLE' | 'EMAIL' | 'MOBILE' | 'PHONE'

interface ConOptColDef { key: ConOptColKey; label: string }
const CON_OPT_COLS: ConOptColDef[] = [
  { key: 'POSITION',   label: 'Funktion'  },
  { key: 'DEPARTMENT', label: 'Abteilung' },
  { key: 'TITLE',      label: 'Titel'     },
  { key: 'EMAIL',      label: 'E-Mail'    },
  { key: 'MOBILE',     label: 'Mobil'     },
  { key: 'PHONE',      label: 'Festnetz'  },
]

function SortTh<K extends string>({ label, k, sortKey, dir, onClick }: {
  label: string; k: K; sortKey: K; dir: 'asc'|'desc'; onClick: (k: K) => void
}) {
  return (
    <th className="sortable-th" onClick={() => onClick(k)}>
      {label} {sortKey === k ? (dir === 'asc' ? '▲' : '▼') : ''}
    </th>
  )
}

// ── Address section ───────────────────────────────────────────────────────────

interface AdressenSectionProps {
  initialSearch?: string
  openAddressId?: number
  onShowKontakte?: (addressName: string, addressId: number) => void
}

function AdressenSection({ initialSearch, openAddressId, onShowKontakte }: AdressenSectionProps) {
  const qc = useQueryClient()
  const toast = useToast()
  const navigate = useNavigate()
  const [createOpen,   setCreateOpen]   = useState(false)
  const [search,       setSearch]       = useState(initialSearch ?? '')
  const [sortKey,      setSortKey]      = useStickyState<AddrSortKey>('adressen.sortKey', 'ADDRESS_NAME_1')
  const [sortDir,      setSortDir]      = useStickyState<'asc'|'desc'>('adressen.sortDir', 'asc')
  const [editAddr,     setEditAddr]     = useState<Address | null>(null)
  const [form,         setForm]         = useState<AddressPayload>(emptyAddr)
  const [editForm,     setEditForm]     = useState<AddressPayload>(emptyAddr)
  const [msg,          setMsg]          = useState<{ text: string; type: 'success' | 'error' } | null>(null)
  const [editMsg,      setEditMsg]      = useState<{ text: string; type: 'success' | 'error' } | null>(null)
  const [confirmState, setConfirmState] = useState<{ title: string; message: string; onConfirm: () => void } | null>(null)

  // Filter + columns state
  const [activeTyp,      setActiveTyp]      = useStickySet('adressen.typ')
  const [activeLand,     setActiveLand]     = useStickySet('adressen.land')
  const [activeStadt,    setActiveStadt]    = useStickySet('adressen.stadt')
  const [hiddenCols,     setHiddenCols]     = useStickyState<Set<AddrOptColKey>>(
    'adressen.cols',
    () => new Set(ADDR_OPT_COLS.map(c => c.key)),
    { serialize: s => [...s], deserialize: raw => new Set(Array.isArray(raw) ? raw as AddrOptColKey[] : []) },
  )
  const [colPanelOpen,   setColPanelOpen]   = useState(false)
  const colPanelRef = useRef<HTMLDivElement>(null)

  // Auto-open tracking
  const [autoOpened, setAutoOpened] = useState<number | null>(null)

  const { data: countriesData } = useQuery({ queryKey: ['countries'],  queryFn: fetchCountries })
  const { data: listData, isLoading } = useQuery({ queryKey: ['addresses'], queryFn: fetchAddressList })
  const { data: contactsData } = useQuery({ queryKey: ['contacts'], queryFn: fetchContactList })

  const countries = countriesData?.data ?? []
  const addresses = listData?.data ?? []

  const contactCountByAddr = useMemo(() => {
    const map: Record<number, number> = {}
    for (const c of contactsData?.data ?? []) {
      if (c.ADDRESS_ID != null) map[c.ADDRESS_ID] = (map[c.ADDRESS_ID] ?? 0) + 1
    }
    return map
  }, [contactsData?.data])

  useEffect(() => {
    if (initialSearch !== undefined) setSearch(initialSearch)
  }, [initialSearch])

  useEffect(() => {
    if (!openAddressId || !listData?.data || autoOpened === openAddressId) return
    const found = listData.data.find(a => a.ID === openAddressId)
    if (found) {
      openEdit(found)
      setAutoOpened(openAddressId)
    }
  }, [openAddressId, listData?.data])

  useEffect(() => {
    if (!colPanelOpen) return
    const h = (e: MouseEvent) => { if (colPanelRef.current && !colPanelRef.current.contains(e.target as Node)) setColPanelOpen(false) }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [colPanelOpen])

  const filterOptions = useMemo(() => ({
    typ:   [...new Set(addresses.map(a => addressTypeLabel(a.ADDRESS_TYPE)).filter((v): v is string => !!v))].sort(),
    land:  [...new Set(addresses.map(a => a.COUNTRY).filter((v): v is string => v != null && v !== ''))].sort(),
    stadt: [...new Set(addresses.map(a => a.CITY).filter((v): v is string => v != null && v !== ''))].sort(),
  }), [addresses])

  function toggleSort(k: AddrSortKey) {
    if (sortKey === k) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortKey(k); setSortDir('asc') }
  }

  function toggleCol(key: AddrOptColKey) {
    setHiddenCols(prev => { const s = new Set(prev); s.has(key) ? s.delete(key) : s.add(key); return s })
  }

  const visibleOptCols = ADDR_OPT_COLS.filter(c => !hiddenCols.has(c.key))

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    let rows = q
      ? addresses.filter(a =>
          `${a.ADDRESS_NAME_1 ?? ''} ${a.ADDRESS_NAME_2 ?? ''} ${a.POST_CODE ?? ''} ${a.CITY ?? ''} ${a.COUNTRY ?? ''} ${a.CUSTOMER_NUMBER ?? ''} ${a.EMAIL ?? ''} ${a.PHONE ?? ''}`
            .toLowerCase().includes(q)
        )
      : addresses
    if (activeTyp.size   > 0) rows = rows.filter(a => activeTyp.has(addressTypeLabel(a.ADDRESS_TYPE)))
    if (activeLand.size  > 0) rows = rows.filter(a => a.COUNTRY && activeLand.has(a.COUNTRY))
    if (activeStadt.size > 0) rows = rows.filter(a => a.CITY    && activeStadt.has(a.CITY))
    return [...rows].sort((a, b) => {
      const av = String(sortKey === 'CITY' ? `${a.POST_CODE ?? ''} ${a.CITY ?? ''}` : (a[sortKey as keyof Address] ?? ''))
      const bv = String(sortKey === 'CITY' ? `${b.POST_CODE ?? ''} ${b.CITY ?? ''}` : (b[sortKey as keyof Address] ?? ''))
      const cmp = av.localeCompare(bv, 'de', { sensitivity: 'base', numeric: true })
      return sortDir === 'asc' ? cmp : -cmp
    })
  }, [addresses, search, sortKey, sortDir, activeTyp, activeLand, activeStadt])

  const createMut = useMutation({
    mutationFn: createAddress,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['addresses'] })
      setMsg({ text: 'Adresse gespeichert ✅', type: 'success' })
      setForm(emptyAddr())
    },
    onError: (e: Error) => setMsg({ text: e.message, type: 'error' }),
  })

  const updateMut = useMutation({
    mutationFn: ({ id, body }: { id: number; body: AddressPayload }) => updateAddress(id, body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['addresses'] })
      setEditMsg({ text: 'Gespeichert ✅', type: 'success' })
      setTimeout(() => setEditAddr(null), 800)
    },
    onError: (e: Error) => setEditMsg({ text: e.message, type: 'error' }),
  })

  const deleteMut = useMutation({
    mutationFn: deleteAddress,
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['addresses'] }),
    onError: (e: Error) => toast.error(e.message),
  })

  // ── Inline-Edit (Kategorie direkt in der Liste) ──
  const canEdit = usePermission('addresses.edit')
  const inlineMut = useMutation({
    mutationFn: ({ id, body }: { id: number; body: AddressPayload }) => updateAddress(id, body),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['addresses'] }),
    onError: (e: Error) => toast.error(e.message),
  })

  function handleDelete(a: Address) {
    setConfirmState({
      title: 'Adresse löschen',
      message: `„${a.ADDRESS_NAME_1}" wirklich löschen?`,
      onConfirm: () => deleteMut.mutate(a.ID),
    })
  }

  function openEdit(a: Address) {
    void trackRecent('address', a.ID, a.ADDRESS_NAME_1 ?? `#${a.ID}`).catch(() => {})
    setEditForm(addressToPayload(a))
    setEditMsg(null)
    setEditAddr(a)
  }

  function openCreate() {
    setForm(emptyAddr())
    setMsg(null)
    setCreateOpen(true)
  }

  function submitCreate(e: React.FormEvent) {
    e.preventDefault()
    setMsg(null)
    if (!form.address_name_1 || !form.country_id) {
      setMsg({ text: 'Name und Land sind Pflichtfelder', type: 'error' }); return
    }
    createMut.mutate(form)
  }

  function submitEdit(e: React.FormEvent) {
    e.preventDefault()
    if (!editAddr) return
    setEditMsg(null)
    updateMut.mutate({ id: editAddr.ID, body: editForm })
  }

  function exportCsv() {
    downloadCsv(
      'adressen.csv',
      ['Kategorie', 'Name 1', 'Name 2', 'Straße', 'PLZ', 'Ort', 'Land', 'Telefon', 'E-Mail', 'Website', 'Kundennr.', 'USt-IdNr.', 'Steuernummer'],
      filtered.map(a => [
        addressTypeLabel(a.ADDRESS_TYPE), a.ADDRESS_NAME_1, a.ADDRESS_NAME_2, a.STREET, a.POST_CODE, a.CITY, a.COUNTRY,
        a.PHONE, a.EMAIL, a.WEBSITE, a.CUSTOMER_NUMBER, a.TAX_ID, a.TAX_NUMBER,
      ]),
    )
  }

  const set  = useCallback((k: keyof AddressPayload) => (v: string) => setForm(f    => ({ ...f, [k]: v })), [])
  const setE = useCallback((k: keyof AddressPayload) => (v: string) => setEditForm(f => ({ ...f, [k]: v })), [])

  const createAddrFormRef = useRef<HTMLFormElement>(null)
  const editAddrFormRef   = useRef<HTMLFormElement>(null)
  useCtrlS(() => createAddrFormRef.current?.requestSubmit(), createOpen)
  useCtrlS(() => editAddrFormRef.current?.requestSubmit(),   editAddr !== null)

  const hasActiveFilter = activeTyp.size > 0 || activeLand.size > 0 || activeStadt.size > 0 || search.trim() !== ''

  return (
    <>
      <div className="list-section">
        <RecentList
          type="address"
          title="Zuletzt verwendete Adressen"
          onSelect={(e) => {
            const found = addresses.find(a => a.ID === e.ENTITY_ID)
            if (found) openEdit(found)
            else       setSearch(e.LABEL ?? '')
          }}
        />
        <div className="pl-toolbar">
          <input className="list-search" placeholder="Suchen …" value={search} onChange={e => setSearch(e.target.value)} />
          <div className="pl-filter-chips">
            <FilterChip label="Kategorie" options={filterOptions.typ}   active={activeTyp}   onChange={setActiveTyp}   />
            <FilterChip label="Land"      options={filterOptions.land}  active={activeLand}  onChange={setActiveLand}  />
            <FilterChip label="Stadt"     options={filterOptions.stadt} active={activeStadt} onChange={setActiveStadt} />
            {hasActiveFilter && (
              <button className="pl-clear-btn" onClick={() => { setActiveTyp(new Set()); setActiveLand(new Set()); setActiveStadt(new Set()); setSearch('') }}>
                Filter löschen
              </button>
            )}
          </div>
          <div ref={colPanelRef} className="pl-col-wrap">
            <button className="pl-col-btn" onClick={() => setColPanelOpen(o => !o)} style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><SlidersHorizontal size={13} strokeWidth={2} />Spalten</button>
            {colPanelOpen && (
              <div className="pl-col-panel">
                <div className="pl-col-panel-title">Optionale Spalten</div>
                {ADDR_OPT_COLS.map(c => (
                  <label key={c.key} className="pl-col-option">
                    <input type="checkbox" checked={!hiddenCols.has(c.key)} onChange={() => toggleCol(c.key)} />
                    {c.label}
                  </label>
                ))}
              </div>
            )}
          </div>
          <button className="pl-col-btn" onClick={exportCsv} title="Gefilterte Liste als CSV exportieren"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }} disabled={filtered.length === 0}>
            <Download size={13} strokeWidth={2} />CSV
          </button>
          <span className="list-info">
            {filtered.length !== addresses.length ? `${filtered.length} / ${addresses.length}` : `${addresses.length}`} Einträge
          </span>
          <Can permission="addresses.create">
            <button className="btn-primary btn-small" onClick={openCreate} style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 5 }}>
              <Plus size={13} strokeWidth={2.25} />Neu
            </button>
          </Can>
        </div>
        {isLoading && <p className="empty-note">Laden …</p>}
        {!isLoading && (
          <table className="master-table">
            <thead>
              <tr>
                <SortTh label="Name"      k="ADDRESS_NAME_1"  sortKey={sortKey} dir={sortDir} onClick={toggleSort} />
                <SortTh label="Ort"       k="CITY"            sortKey={sortKey} dir={sortDir} onClick={toggleSort} />
                <SortTh label="Land"      k="COUNTRY"         sortKey={sortKey} dir={sortDir} onClick={toggleSort} />
                <SortTh label="Kundennr." k="CUSTOMER_NUMBER" sortKey={sortKey} dir={sortDir} onClick={toggleSort} />
                {visibleOptCols.map(c => <th key={c.key}>{c.label}</th>)}
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(a => {
                const cnt = contactCountByAddr[a.ID] ?? 0
                return (
                <tr key={a.ID} className="clickable-row" onClick={() => navigate(`/adressen/${a.ID}`)} style={{ cursor: 'pointer' }}>
                  <td>{a.ADDRESS_NAME_1}</td>
                  <td>{[a.POST_CODE, a.CITY].filter(Boolean).join(' ')}</td>
                  <td>{a.COUNTRY}</td>
                  <td>{a.CUSTOMER_NUMBER}</td>
                  {visibleOptCols.map(c => (
                    c.key === 'ADDRESS_TYPE'
                      ? <td key={c.key} onClick={e => e.stopPropagation()}>
                          <InlineSelect
                            value={a.ADDRESS_TYPE} options={CATEGORY_OPTS} placeholder="—"
                            readOnly={!canEdit} ariaLabel="Kategorie"
                            onChange={v => inlineMut.mutate({ id: a.ID, body: { ...addressToPayload(a), address_type: v } })}
                          />
                        </td>
                      : <td key={c.key}>{addrOptCell(a, c.key)}</td>
                  ))}
                  <td className="doc-actions" onClick={e => e.stopPropagation()}>
                    <button
                      className="btn-small"
                      onClick={() => onShowKontakte?.(a.ADDRESS_NAME_1, a.ID)}
                      title="Kontakte dieser Adresse anzeigen"
                    >
                      Kontakte{cnt > 0 ? ` (${cnt})` : ''}
                    </button>
                    <Can permission="addresses.edit">
                      <button className="row-action-btn" onClick={() => openEdit(a)} title="Bearbeiten">
                        <Pencil size={14} strokeWidth={2} />
                      </button>
                    </Can>
                    <Can permission="addresses.delete">
                      <button className="row-action-btn" style={{ color: '#dc2626', borderColor: '#dc2626' }} onClick={() => handleDelete(a)} title="Löschen">
                        <Trash2 size={14} strokeWidth={2} />
                      </button>
                    </Can>
                  </td>
                </tr>
                )
              })}
              {!filtered.length && (
                <tr><td colSpan={5 + visibleOptCols.length} className="empty-note">
                  {addresses.length === 0
                    ? 'Noch keine Adressen — lege die erste über „+ Neu" an. Adressen sind die Grundlage für Angebote und Rechnungen.'
                    : 'Keine Treffer für die aktuelle Suche/Filterung.'}
                </td></tr>
              )}
            </tbody>
            <tfoot>
              <tr style={{ fontWeight: 600, borderTop: '2px solid rgba(17,24,39,0.12)' }}>
                <td colSpan={5 + visibleOptCols.length} style={{ fontSize: 13, color: 'rgba(17,24,39,0.5)', paddingTop: 6 }}>
                  {filtered.length !== addresses.length ? `${filtered.length} / ${addresses.length} Einträge` : `${addresses.length} Einträge`}
                </td>
              </tr>
            </tfoot>
          </table>
        )}
      </div>

      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title="Neue Adresse">
        <form ref={createAddrFormRef} onSubmit={submitCreate} className="master-form">
          <AddrForm vals={form} setK={set} msg={msg} countries={countries} />
          <div className="modal-actions">
            <button className="btn-primary" type="submit" disabled={createMut.isPending}>
              {createMut.isPending ? 'Speichert …' : 'Speichern'}
            </button>
            <button type="button" onClick={() => setCreateOpen(false)}>Schließen</button>
          </div>
        </form>
      </Modal>

      <Modal open={editAddr !== null} onClose={() => setEditAddr(null)} title="Adresse bearbeiten">
        <form ref={editAddrFormRef} onSubmit={submitEdit} className="master-form">
          <AddrForm vals={editForm} setK={setE} msg={editMsg} countries={countries} />
          <div className="modal-actions">
            <button className="btn-primary" type="submit" disabled={updateMut.isPending}>
              {updateMut.isPending ? 'Speichert …' : 'Speichern'}
            </button>
            <button type="button" onClick={() => setEditAddr(null)}>Abbrechen</button>
          </div>
        </form>
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
    </>
  )
}

// ── Contacts section ──────────────────────────────────────────────────────────

interface KontakteSectionProps {
  initialSearch?: string
  initialAddressId?: number
  initialAddressName?: string
}

function KontakteSection({ initialSearch, initialAddressId, initialAddressName }: KontakteSectionProps) {
  const qc       = useQueryClient()
  const navigate = useNavigate()
  const [createOpen,   setCreateOpen]   = useState(false)
  const [search,       setSearch]       = useState(initialSearch ?? '')
  const [sortKey,      setSortKey]      = useStickyState<ConSortKey>('kontakte.sortKey', 'NAME')
  const [sortDir,      setSortDir]      = useStickyState<'asc'|'desc'>('kontakte.sortDir', 'asc')
  const [editContact,  setEditContact]  = useState<Contact | null>(null)
  const [form,         setForm]         = useState<ContactPayload>(() => ({ ...emptyContact(), address_id: initialAddressId ?? '' }))
  const [editForm,     setEditForm]     = useState<ContactPayload>(emptyContact)
  const [addrText,     setAddrText]     = useState(initialAddressName ?? '')
  const [editAddrText, setEditAddrText] = useState('')
  const [msg,          setMsg]          = useState<{ text: string; type: 'success' | 'error' } | null>(null)
  const [editMsg,      setEditMsg]      = useState<{ text: string; type: 'success' | 'error' } | null>(null)
  const [confirmState, setConfirmState] = useState<{ title: string; message: string; onConfirm: () => void } | null>(null)
  const toast = useToast()

  useEffect(() => {
    if (initialSearch !== undefined) setSearch(initialSearch)
  }, [initialSearch])

  useEffect(() => {
    if (initialAddressId !== undefined) {
      setForm(f => ({ ...f, address_id: initialAddressId }))
      setAddrText(initialAddressName ?? '')
    }
  }, [initialAddressId, initialAddressName])

  // Filter + column state
  const [activeAdresse,  setActiveAdresse]  = useStickySet('kontakte.adresse')
  const [hiddenCols,     setHiddenCols]     = useStickyState<Set<ConOptColKey>>(
    'kontakte.cols',
    () => new Set(CON_OPT_COLS.map(c => c.key)),
    { serialize: s => [...s], deserialize: raw => new Set(Array.isArray(raw) ? raw as ConOptColKey[] : []) },
  )
  const [colPanelOpen,   setColPanelOpen]   = useState(false)
  const colPanelRef = useRef<HTMLDivElement>(null)

  const { data: salData }  = useQuery({ queryKey: ['salutations'], queryFn: fetchSalutations })
  const { data: genData }  = useQuery({ queryKey: ['genders-std'], queryFn: fetchGenders })
  const { data: listData, isLoading } = useQuery({ queryKey: ['contacts'], queryFn: fetchContactList })

  const salutations = salData?.data  ?? []
  const genders     = genData?.data  ?? []
  const contacts    = listData?.data ?? []

  useEffect(() => {
    if (!colPanelOpen) return
    const h = (e: MouseEvent) => { if (colPanelRef.current && !colPanelRef.current.contains(e.target as Node)) setColPanelOpen(false) }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [colPanelOpen])

  const filterOptions = useMemo(() => ({
    adresse: [...new Set(contacts.map(c => c.ADDRESS).filter((v): v is string => v != null && v !== ''))].sort(),
  }), [contacts])

  function toggleSort(k: ConSortKey) {
    if (sortKey === k) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortKey(k); setSortDir('asc') }
  }

  function toggleCol(key: ConOptColKey) {
    setHiddenCols(prev => { const s = new Set(prev); s.has(key) ? s.delete(key) : s.add(key); return s })
  }

  const visibleOptCols = CON_OPT_COLS.filter(c => !hiddenCols.has(c.key))

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    let rows = q
      ? contacts.filter(c =>
          `${c.FIRST_NAME} ${c.LAST_NAME} ${c.ADDRESS ?? ''} ${c.SALUTATION ?? ''} ${c.GENDER ?? ''} ${c.EMAIL ?? ''} ${c.MOBILE ?? ''} ${c.POSITION ?? ''} ${c.DEPARTMENT ?? ''}`
            .toLowerCase().includes(q)
        )
      : contacts
    if (activeAdresse.size > 0) rows = rows.filter(c => c.ADDRESS && activeAdresse.has(c.ADDRESS))
    return [...rows].sort((a, b) => {
      const av = String(sortKey === 'NAME' ? `${a.LAST_NAME ?? ''} ${a.FIRST_NAME ?? ''}` : (a[sortKey as keyof Contact] ?? ''))
      const bv = String(sortKey === 'NAME' ? `${b.LAST_NAME ?? ''} ${b.FIRST_NAME ?? ''}` : (b[sortKey as keyof Contact] ?? ''))
      const cmp = av.localeCompare(bv, 'de', { sensitivity: 'base', numeric: true })
      return sortDir === 'asc' ? cmp : -cmp
    })
  }, [contacts, search, sortKey, sortDir, activeAdresse])

  const searchAddresses = useCallback(async (q: string) => {
    const res = await searchAddressesApi(q)
    return res.data.map(a => ({ id: a.ID, label: a.ADDRESS_NAME_1 }))
  }, [])

  const createMut = useMutation({
    mutationFn: createContact,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['contacts'] })
      setMsg({ text: 'Kontakt gespeichert ✅', type: 'success' })
      setForm(emptyContact())
      setAddrText('')
    },
    onError: (e: Error) => setMsg({ text: e.message, type: 'error' }),
  })

  const updateMut = useMutation({
    mutationFn: ({ id, body }: { id: number; body: ContactPayload }) => updateContact(id, body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['contacts'] })
      setEditMsg({ text: 'Gespeichert ✅', type: 'success' })
      setTimeout(() => setEditContact(null), 800)
    },
    onError: (e: Error) => setEditMsg({ text: e.message, type: 'error' }),
  })

  const deleteConMut = useMutation({
    mutationFn: deleteContact,
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['contacts'] }),
    onError: (e: Error) => toast.error(e.message),
  })

  // ── Inline-Edit (Anrede / Geschlecht direkt in der Liste) ──
  const canEdit = usePermission('addresses.contacts.edit')
  const salOpts:    InlineOption[] = useMemo(() => salutations.map(s => ({ value: String(s.ID), label: s.SALUTATION })), [salutations])
  const genderOpts: InlineOption[] = useMemo(() => genders.map(g    => ({ value: String(g.ID), label: g.GENDER })),     [genders])
  const inlineMut = useMutation({
    mutationFn: ({ id, body }: { id: number; body: ContactPayload }) => updateContact(id, body),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['contacts'] }),
    onError: (e: Error) => toast.error(e.message),
  })

  function handleDeleteContact(c: Contact) {
    setConfirmState({
      title: 'Kontakt löschen',
      message: `${c.FIRST_NAME} ${c.LAST_NAME} wirklich löschen?`,
      onConfirm: () => deleteConMut.mutate(c.ID),
    })
  }

  function openEdit(c: Contact) {
    setEditForm(contactToPayload(c))
    setEditAddrText(c.ADDRESS ?? '')
    setEditMsg(null)
    setEditContact(c)
  }

  function openCreate() {
    setForm({ ...emptyContact(), address_id: initialAddressId ?? '' })
    setAddrText(initialAddressName ?? '')
    setMsg(null)
    setCreateOpen(true)
  }

  function submitCreate(e: React.FormEvent) {
    e.preventDefault()
    setMsg(null)
    if (!form.first_name || !form.last_name || !form.salutation_id || !form.gender_id || !form.address_id) {
      setMsg({ text: 'Bitte alle Pflichtfelder ausfüllen', type: 'error' }); return
    }
    createMut.mutate(form)
  }

  function submitEdit(e: React.FormEvent) {
    e.preventDefault()
    if (!editContact) return
    setEditMsg(null)
    updateMut.mutate({ id: editContact.ID, body: editForm })
  }

  function exportCsv() {
    downloadCsv(
      'kontakte.csv',
      ['Anrede', 'Titel', 'Vorname', 'Nachname', 'Funktion', 'Abteilung', 'E-Mail', 'Mobil', 'Festnetz', 'Adresse'],
      filtered.map(c => [c.SALUTATION, c.TITLE, c.FIRST_NAME, c.LAST_NAME, c.POSITION, c.DEPARTMENT, c.EMAIL, c.MOBILE, c.PHONE, c.ADDRESS]),
    )
  }

  const set  = useCallback((k: keyof ContactPayload) => (v: string) => setForm(f    => ({ ...f, [k]: v })), [])
  const setE = useCallback((k: keyof ContactPayload) => (v: string) => setEditForm(f => ({ ...f, [k]: v })), [])
  const setPrimary     = useCallback((v: boolean) => setForm(f     => ({ ...f, is_primary: v })), [])
  const setEditPrimary = useCallback((v: boolean) => setEditForm(f => ({ ...f, is_primary: v })), [])

  const createConFormRef = useRef<HTMLFormElement>(null)
  const editConFormRef   = useRef<HTMLFormElement>(null)
  useCtrlS(() => createConFormRef.current?.requestSubmit(), createOpen)
  useCtrlS(() => editConFormRef.current?.requestSubmit(),   editContact !== null)

  const hasActiveFilter = activeAdresse.size > 0 || search.trim() !== ''

  return (
    <>
      <div className="list-section">
        <div className="pl-toolbar">
          <input className="list-search" placeholder="Suchen …" value={search} onChange={e => setSearch(e.target.value)} />
          <div className="pl-filter-chips">
            <FilterChip label="Adresse" options={filterOptions.adresse} active={activeAdresse} onChange={setActiveAdresse} />
            {hasActiveFilter && (
              <button className="pl-clear-btn" onClick={() => { setActiveAdresse(new Set()); setSearch('') }}>
                Filter löschen
              </button>
            )}
          </div>
          <div ref={colPanelRef} className="pl-col-wrap">
            <button className="pl-col-btn" onClick={() => setColPanelOpen(o => !o)} style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><SlidersHorizontal size={13} strokeWidth={2} />Spalten</button>
            {colPanelOpen && (
              <div className="pl-col-panel">
                <div className="pl-col-panel-title">Optionale Spalten</div>
                {CON_OPT_COLS.map(c => (
                  <label key={c.key} className="pl-col-option">
                    <input type="checkbox" checked={!hiddenCols.has(c.key)} onChange={() => toggleCol(c.key)} />
                    {c.label}
                  </label>
                ))}
              </div>
            )}
          </div>
          <button className="pl-col-btn" onClick={exportCsv} title="Gefilterte Liste als CSV exportieren"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }} disabled={filtered.length === 0}>
            <Download size={13} strokeWidth={2} />CSV
          </button>
          <span className="list-info">
            {filtered.length !== contacts.length ? `${filtered.length} / ${contacts.length}` : `${contacts.length}`} Einträge
          </span>
          <Can permission="addresses.contacts.create">
            <button className="btn-primary btn-small" onClick={openCreate} style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 5 }}>
              <Plus size={13} strokeWidth={2.25} />Neu
            </button>
          </Can>
        </div>
        {isLoading && <p className="empty-note">Laden …</p>}
        {!isLoading && (
          <table className="master-table">
            <thead>
              <tr>
                <SortTh label="Name"       k="NAME"       sortKey={sortKey} dir={sortDir} onClick={toggleSort} />
                <SortTh label="Anrede"     k="SALUTATION" sortKey={sortKey} dir={sortDir} onClick={toggleSort} />
                <SortTh label="Geschlecht" k="GENDER"     sortKey={sortKey} dir={sortDir} onClick={toggleSort} />
                <SortTh label="Adresse"    k="ADDRESS"    sortKey={sortKey} dir={sortDir} onClick={toggleSort} />
                {visibleOptCols.map(c => <th key={c.key}>{c.label}</th>)}
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(c => (
                <tr key={c.ID}>
                  <td>
                    {!!c.IS_PRIMARY && <Star size={12} strokeWidth={2} fill="currentColor" style={{ color: '#f59e0b', marginRight: 4, verticalAlign: 'middle' }} aria-label="Hauptansprechpartner" />}
                    {c.FIRST_NAME} {c.LAST_NAME}
                  </td>
                  <td>
                    <InlineSelect
                      value={c.SALUTATION_ID} options={salOpts} allowEmpty={false} placeholder="—"
                      readOnly={!canEdit} ariaLabel="Anrede" fallbackLabel={c.SALUTATION || undefined}
                      onChange={v => v && inlineMut.mutate({ id: c.ID, body: { ...contactToPayload(c), salutation_id: v } })}
                    />
                  </td>
                  <td>
                    <InlineSelect
                      value={c.GENDER_ID} options={genderOpts} allowEmpty={false} placeholder="—"
                      readOnly={!canEdit} ariaLabel="Geschlecht" fallbackLabel={c.GENDER || undefined}
                      onChange={v => v && inlineMut.mutate({ id: c.ID, body: { ...contactToPayload(c), gender_id: v } })}
                    />
                  </td>
                  <td>{c.ADDRESS_ID ? (
                    <button className="link-cell" onClick={() => navigate(`/adressen/${c.ADDRESS_ID}`)}>
                      {c.ADDRESS}
                    </button>
                  ) : (c.ADDRESS ?? '—')}</td>
                  {visibleOptCols.map(col => <td key={col.key}>{(c[col.key as keyof Contact] as string | null | undefined) ?? '—'}</td>)}
                  <td className="doc-actions">
                    <button className="row-action-btn" title="Als vCard exportieren"
                      onClick={() => downloadText(`${c.FIRST_NAME}_${c.LAST_NAME}.vcf`.replace(/\s+/g, '_'), contactVCard(c), 'text/vcard')}>
                      <Download size={14} strokeWidth={2} />
                    </button>
                    <Can permission="addresses.contacts.edit">
                      <button className="row-action-btn" onClick={() => openEdit(c)} title="Bearbeiten">
                        <Pencil size={14} strokeWidth={2} />
                      </button>
                    </Can>
                    <Can permission="addresses.contacts.delete">
                      <button className="row-action-btn" style={{ color: '#dc2626', borderColor: '#dc2626' }} onClick={() => handleDeleteContact(c)} title="Löschen">
                        <Trash2 size={14} strokeWidth={2} />
                      </button>
                    </Can>
                  </td>
                </tr>
              ))}
              {!filtered.length && (
                <tr><td colSpan={5 + visibleOptCols.length} className="empty-note">
                  {contacts.length === 0
                    ? 'Noch keine Kontakte — lege Ansprechpartner zu einer Adresse an. Sie werden auf Angeboten und Rechnungen als Empfänger genutzt.'
                    : 'Keine Treffer für die aktuelle Suche/Filterung.'}
                </td></tr>
              )}
            </tbody>
            <tfoot>
              <tr style={{ fontWeight: 600, borderTop: '2px solid rgba(17,24,39,0.12)' }}>
                <td colSpan={5 + visibleOptCols.length} style={{ fontSize: 13, color: 'rgba(17,24,39,0.5)', paddingTop: 6 }}>
                  {filtered.length !== contacts.length ? `${filtered.length} / ${contacts.length} Einträge` : `${contacts.length} Einträge`}
                </td>
              </tr>
            </tfoot>
          </table>
        )}
      </div>

      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title="Neuer Kontakt">
        <form ref={createConFormRef} onSubmit={submitCreate} className="master-form">
          <ContactForm
            vals={form} setK={set} onPrimaryChange={setPrimary} addrTxt={addrText} setAddrTxt={setAddrText}
            msg={msg} salutations={salutations} genders={genders} searchAddresses={searchAddresses}
          />
          <div className="modal-actions">
            <button className="btn-primary" type="submit" disabled={createMut.isPending}>
              {createMut.isPending ? 'Speichert …' : 'Speichern'}
            </button>
            <button type="button" onClick={() => setCreateOpen(false)}>Schließen</button>
          </div>
        </form>
      </Modal>

      <Modal open={editContact !== null} onClose={() => setEditContact(null)} title="Kontakt bearbeiten">
        <form ref={editConFormRef} onSubmit={submitEdit} className="master-form">
          <ContactForm
            vals={editForm} setK={setE} onPrimaryChange={setEditPrimary} addrTxt={editAddrText} setAddrTxt={setEditAddrText}
            msg={editMsg} isEdit salutations={salutations} genders={genders} searchAddresses={searchAddresses}
          />
          <div className="modal-actions">
            <button className="btn-primary" type="submit" disabled={updateMut.isPending}>
              {updateMut.isPending ? 'Speichert …' : 'Speichern'}
            </button>
            <button type="button" onClick={() => setEditContact(null)}>Abbrechen</button>
          </div>
        </form>
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
    </>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export function AdressenPage() {
  const location = useLocation()
  const navigate = useNavigate()
  const [tab, setTab] = useState('adressen')

  const [openAddressId,    setOpenAddressId]    = useState<number | undefined>(
    (location.state as { openAddressId?: number } | null)?.openAddressId
  )
  const [addrInitSearch,   setAddrInitSearch]   = useState<string | undefined>(
    (location.state as { searchAddress?: string } | null)?.searchAddress
  )
  const [konSearch,        setKonSearch]        = useState<string | undefined>()
  const [konAddressId,     setKonAddressId]     = useState<number | undefined>()
  const [konAddressName,   setKonAddressName]   = useState<string | undefined>()

  useEffect(() => {
    const ns = location.state as { openAddressId?: number; searchAddress?: string } | null
    if (!ns) return
    if (ns.openAddressId || ns.searchAddress) {
      setTab('adressen')
      if (ns.openAddressId) setOpenAddressId(ns.openAddressId)
      if (ns.searchAddress) setAddrInitSearch(ns.searchAddress)
      navigate('/adressen', { replace: true, state: null })
    }
  }, [location.state])

  function handleShowKontakte(addressName: string, addressId: number) {
    setKonSearch(addressName)
    setKonAddressId(addressId)
    setKonAddressName(addressName)
    setTab('kontakte')
  }

  return (
    <div className="master-page">
      <div className="master-page-header">
        <h1 className="master-page-title">Adressen &amp; Kontakte</h1>
      </div>
      <Tabs tabs={useFilterTabs(PAGE_TABS)} active={tab} onChange={setTab} />
      <div className="master-section">
        {tab === 'adressen' && (
          <AdressenSection
            initialSearch={addrInitSearch}
            openAddressId={openAddressId}
            onShowKontakte={handleShowKontakte}
          />
        )}
        {tab === 'kontakte' && (
          <KontakteSection
            initialSearch={konSearch}
            initialAddressId={konAddressId}
            initialAddressName={konAddressName}
          />
        )}
      </div>
    </div>
  )
}
