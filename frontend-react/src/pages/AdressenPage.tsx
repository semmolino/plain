import { useState, useCallback, useMemo, useRef, useEffect } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { SlidersHorizontal } from 'lucide-react'
import { Tabs }        from '@/components/ui/Tabs'
import { Modal }       from '@/components/ui/Modal'
import { Message }     from '@/components/ui/Message'
import { ConfirmModal } from '@/components/ui/ConfirmModal'
import { FormField }   from '@/components/ui/FormField'
import { Autocomplete } from '@/components/ui/Autocomplete'
import { useCtrlS } from '@/hooks/useCtrlS'
import { useToast }  from '@/store/toastStore'
import {
  fetchCountries, fetchSalutations, fetchGenders,
  fetchAddressList, searchAddressesApi, createAddress, updateAddress, deleteAddress,
  fetchContactList, createContact, updateContact, deleteContact,
  type Address, type Contact, type AddressPayload, type ContactPayload,
} from '@/api/stammdaten'

// ── Helpers ───────────────────────────────────────────────────────────────────

const ADDR_TABS = [
  { id: 'list',   label: 'Adressen' },
  { id: 'create', label: 'Neue Adresse' },
]
const CON_TABS = [
  { id: 'list',   label: 'Kontakte' },
  { id: 'create', label: 'Neuer Kontakt' },
]
const PAGE_TABS = [
  { id: 'adressen', label: 'Adressen'  },
  { id: 'kontakte', label: 'Kontakte'  },
]

function emptyAddr(): AddressPayload {
  return { address_name_1: '', address_name_2: '', street: '', post_code: '', city: '', country_id: '', customer_number: '', tax_id: '', buyer_reference: '', peppol_endpoint_id: '', peppol_scheme_id: '' }
}
function emptyContact(): ContactPayload {
  return { title: '', first_name: '', last_name: '', email: '', mobile: '', salutation_id: '', gender_id: '', address_id: '' }
}

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

// ── AddrForm (top-level to preserve focus) ────────────────────────────────────

interface AddrFormProps {
  vals:        AddressPayload
  setK:        (k: keyof AddressPayload) => (v: string) => void
  msg:         { text: string; type: 'success' | 'error' } | null
  countries:   { ID: number | string; NAME_LONG?: string; NAME_SHORT?: string }[]
}

function AddrForm({ vals, setK, msg: m, countries }: AddrFormProps) {
  return (
    <div className="master-form">
      <FormField label="Name 1*"        id="an1" value={vals.address_name_1}       onChange={e => setK('address_name_1')(e.target.value)} />
      <FormField label="Name 2"         id="an2" value={vals.address_name_2 ?? ''} onChange={e => setK('address_name_2')(e.target.value)} />
      <FormField label="Straße"         id="ast" value={vals.street ?? ''}         onChange={e => setK('street')(e.target.value)} />
      <div className="form-row">
        <FormField label="PLZ"          id="apc" value={vals.post_code ?? ''}      onChange={e => setK('post_code')(e.target.value)} />
        <FormField label="Ort"          id="aci" value={vals.city ?? ''}           onChange={e => setK('city')(e.target.value)} />
      </div>
      <div className="form-group">
        <label htmlFor="aco">Land*</label>
        <select id="aco" value={vals.country_id ?? ''} onChange={e => setK('country_id')(e.target.value)} required>
          <option value="">Bitte wählen …</option>
          {countries.map(c => <option key={c.ID} value={c.ID}>{c.NAME_LONG || c.NAME_SHORT || c.ID}</option>)}
        </select>
      </div>
      <FormField label="Kundennr."      id="acn" value={vals.customer_number ?? ''} onChange={e => setK('customer_number')(e.target.value)} />
      <FormField label="Steuernummer"   id="ati" value={vals.tax_id ?? ''}          onChange={e => setK('tax_id')(e.target.value)} />
      <FormField label="Käuferreferenz" id="abr" value={vals.buyer_reference ?? ''} onChange={e => setK('buyer_reference')(e.target.value)} />
      <div className="form-group">
        <label htmlFor="ape-id">Peppol Endpoint-ID</label>
        <input id="ape-id" type="text"
          value={vals.peppol_endpoint_id ?? ''}
          onChange={e => setK('peppol_endpoint_id')(e.target.value)}
          placeholder="z.B. DE123456789 oder GLN" />
      </div>
      <div className="form-group">
        <label htmlFor="ape-sc">Peppol Scheme-ID (EAS)</label>
        <select id="ape-sc" value={vals.peppol_scheme_id ?? ''} onChange={e => setK('peppol_scheme_id')(e.target.value)}>
          <option value="">— keiner —</option>
          <option value="0088">0088 — GLN</option>
          <option value="9930">9930 — DE USt-IdNr.</option>
          <option value="9931">9931 — AT VAT</option>
          <option value="9957">9957 — FR SIRET</option>
          <option value="9959">9959 — BE Enterprise</option>
          <option value="0184">0184 — DK CVR</option>
          <option value="0192">0192 — NO Org.nr</option>
          <option value="EM">EM — E-Mail</option>
        </select>
      </div>
      <Message text={m?.text ?? null} type={m?.type} />
    </div>
  )
}

// ── ContactForm (top-level to preserve focus) ─────────────────────────────────

interface ContactFormProps {
  vals:         ContactPayload
  setK:         (k: keyof ContactPayload) => (v: string) => void
  addrTxt:      string
  setAddrTxt:   (v: string) => void
  msg:          { text: string; type: 'success' | 'error' } | null
  isEdit?:      boolean
  salutations:  { ID: number | string; SALUTATION: string }[]
  genders:      { ID: number | string; GENDER: string }[]
  searchAddresses: (q: string) => Promise<{ id: number; label: string }[]>
}

function ContactForm({ vals, setK, addrTxt, setAddrTxt, msg: m, isEdit = false, salutations, genders, searchAddresses }: ContactFormProps) {
  const formId = isEdit ? 'e' : 'c'
  return (
    <>
      <FormField label="Titel"       id={`${formId}-ct`} value={vals.title ?? ''} onChange={e => setK('title')(e.target.value)} />
      <div className="form-row">
        <FormField label="Vorname*"  id={`${formId}-fn`} value={vals.first_name} onChange={e => setK('first_name')(e.target.value)} required />
        <FormField label="Nachname*" id={`${formId}-ln`} value={vals.last_name}  onChange={e => setK('last_name')(e.target.value)} required />
      </div>
      <FormField label="E-Mail"      id={`${formId}-em`} value={vals.email ?? ''} onChange={e => setK('email')(e.target.value)} type="email" />
      <FormField label="Mobil"       id={`${formId}-mo`} value={vals.mobile ?? ''} onChange={e => setK('mobile')(e.target.value)} />
      <div className="form-group">
        <label htmlFor={`${formId}-sal`}>Anrede*</label>
        <select id={`${formId}-sal`} value={String(vals.salutation_id ?? '')} onChange={e => setK('salutation_id')(e.target.value)} required>
          <option value="">Bitte wählen …</option>
          {salutations.map(s => <option key={s.ID} value={s.ID}>{s.SALUTATION}</option>)}
        </select>
      </div>
      <div className="form-group">
        <label htmlFor={`${formId}-gen`}>Geschlecht*</label>
        <select id={`${formId}-gen`} value={String(vals.gender_id ?? '')} onChange={e => setK('gender_id')(e.target.value)} required>
          <option value="">Bitte wählen …</option>
          {genders.map(g => <option key={g.ID} value={g.ID}>{g.GENDER}</option>)}
        </select>
      </div>
      <Autocomplete
        label="Adresse*"
        htmlId={`${formId}-addr`}
        value={addrTxt}
        onChange={(t) => { setAddrTxt(t); if (!t) setK('address_id')('') }}
        onSelect={(id, lbl) => { setAddrTxt(lbl); setK('address_id')(String(id)) }}
        search={searchAddresses}
        placeholder="Name eingeben …"
        required
      />
      <Message text={m?.text ?? null} type={m?.type} />
    </>
  )
}

// ── Address sort + opt cols ───────────────────────────────────────────────────

type AddrSortKey = 'ADDRESS_NAME_1' | 'CITY' | 'COUNTRY' | 'CUSTOMER_NUMBER'
type AddrOptColKey = 'ADDRESS_NAME_2' | 'STREET' | 'TAX_ID' | 'BUYER_REFERENCE'

interface AddrOptColDef { key: AddrOptColKey; label: string }
const ADDR_OPT_COLS: AddrOptColDef[] = [
  { key: 'ADDRESS_NAME_2', label: 'Name 2'         },
  { key: 'STREET',         label: 'Straße'          },
  { key: 'TAX_ID',         label: 'Steuernummer'    },
  { key: 'BUYER_REFERENCE',label: 'Käuferreferenz'  },
]

// ── Contact sort + opt cols ───────────────────────────────────────────────────

type ConSortKey  = 'NAME' | 'SALUTATION' | 'GENDER' | 'ADDRESS'
type ConOptColKey = 'TITLE' | 'EMAIL' | 'MOBILE'

interface ConOptColDef { key: ConOptColKey; label: string }
const CON_OPT_COLS: ConOptColDef[] = [
  { key: 'TITLE',  label: 'Titel'   },
  { key: 'EMAIL',  label: 'E-Mail'  },
  { key: 'MOBILE', label: 'Mobil'   },
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
  const [tab,          setTab]          = useState('list')
  const [search,       setSearch]       = useState(initialSearch ?? '')
  const [sortKey,      setSortKey]      = useState<AddrSortKey>('ADDRESS_NAME_1')
  const [sortDir,      setSortDir]      = useState<'asc'|'desc'>('asc')
  const [editAddr,     setEditAddr]     = useState<Address | null>(null)
  const [form,         setForm]         = useState<AddressPayload>(emptyAddr)
  const [editForm,     setEditForm]     = useState<AddressPayload>(emptyAddr)
  const [msg,          setMsg]          = useState<{ text: string; type: 'success' | 'error' } | null>(null)
  const [editMsg,      setEditMsg]      = useState<{ text: string; type: 'success' | 'error' } | null>(null)
  const [confirmState, setConfirmState] = useState<{ title: string; message: string; onConfirm: () => void } | null>(null)

  // Filter + columns state
  const [activeLand,     setActiveLand]     = useState<Set<string>>(new Set())
  const [activeStadt,    setActiveStadt]    = useState<Set<string>>(new Set())
  const [hiddenCols,     setHiddenCols]     = useState<Set<AddrOptColKey>>(new Set(ADDR_OPT_COLS.map(c => c.key)))
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
          `${a.ADDRESS_NAME_1 ?? ''} ${a.ADDRESS_NAME_2 ?? ''} ${a.POST_CODE ?? ''} ${a.CITY ?? ''} ${a.COUNTRY ?? ''} ${a.CUSTOMER_NUMBER ?? ''}`
            .toLowerCase().includes(q)
        )
      : addresses
    if (activeLand.size  > 0) rows = rows.filter(a => a.COUNTRY && activeLand.has(a.COUNTRY))
    if (activeStadt.size > 0) rows = rows.filter(a => a.CITY    && activeStadt.has(a.CITY))
    return [...rows].sort((a, b) => {
      const av = String(sortKey === 'CITY' ? `${a.POST_CODE ?? ''} ${a.CITY ?? ''}` : (a[sortKey as keyof Address] ?? ''))
      const bv = String(sortKey === 'CITY' ? `${b.POST_CODE ?? ''} ${b.CITY ?? ''}` : (b[sortKey as keyof Address] ?? ''))
      const cmp = av.localeCompare(bv, 'de', { sensitivity: 'base', numeric: true })
      return sortDir === 'asc' ? cmp : -cmp
    })
  }, [addresses, search, sortKey, sortDir, activeLand])

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

  function handleDelete(a: Address) {
    setConfirmState({
      title: 'Adresse löschen',
      message: `„${a.ADDRESS_NAME_1}" wirklich löschen?`,
      onConfirm: () => deleteMut.mutate(a.ID),
    })
  }

  function openEdit(a: Address) {
    setEditForm({
      address_name_1:  a.ADDRESS_NAME_1  ?? '',
      address_name_2:  a.ADDRESS_NAME_2  ?? '',
      street:          a.STREET          ?? '',
      post_code:       a.POST_CODE        ?? '',
      city:            a.CITY            ?? '',
      country_id:      a.COUNTRY_ID      ?? '',
      customer_number: a.CUSTOMER_NUMBER ?? '',
      tax_id:          a.TAX_ID          ?? '',
      buyer_reference: a.BUYER_REFERENCE ?? '',
    })
    setEditMsg(null)
    setEditAddr(a)
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

  const set  = useCallback((k: keyof AddressPayload) => (v: string) => setForm(f    => ({ ...f, [k]: v })), [])
  const setE = useCallback((k: keyof AddressPayload) => (v: string) => setEditForm(f => ({ ...f, [k]: v })), [])

  const createAddrFormRef = useRef<HTMLFormElement>(null)
  const editAddrFormRef   = useRef<HTMLFormElement>(null)
  useCtrlS(() => createAddrFormRef.current?.requestSubmit(), tab === 'create')
  useCtrlS(() => editAddrFormRef.current?.requestSubmit(),   editAddr !== null)

  const hasActiveFilter = activeLand.size > 0 || activeStadt.size > 0 || search.trim() !== ''

  return (
    <>
      <Tabs tabs={ADDR_TABS} active={tab} onChange={setTab} />

      {tab === 'list' && (
        <div className="list-section">
          <div className="pl-toolbar">
            <input className="list-search" placeholder="Suchen …" value={search} onChange={e => setSearch(e.target.value)} />
            <div className="pl-filter-chips">
              <FilterChip label="Land"  options={filterOptions.land}  active={activeLand}  onChange={setActiveLand}  />
              <FilterChip label="Stadt" options={filterOptions.stadt} active={activeStadt} onChange={setActiveStadt} />
              {hasActiveFilter && (
                <button className="pl-clear-btn" onClick={() => { setActiveLand(new Set()); setActiveStadt(new Set()); setSearch('') }}>
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
            <span className="list-info">
              {filtered.length !== addresses.length ? `${filtered.length} / ${addresses.length}` : `${addresses.length}`} Einträge
            </span>
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
                  <tr key={a.ID}>
                    <td>{a.ADDRESS_NAME_1}</td>
                    <td>{[a.POST_CODE, a.CITY].filter(Boolean).join(' ')}</td>
                    <td>{a.COUNTRY}</td>
                    <td>{a.CUSTOMER_NUMBER}</td>
                    {visibleOptCols.map(c => <td key={c.key}>{(a[c.key as keyof Address] as string | null | undefined) ?? '—'}</td>)}
                    <td className="doc-actions">
                      <button
                        className="btn-small"
                        onClick={() => onShowKontakte?.(a.ADDRESS_NAME_1, a.ID)}
                        title="Kontakte dieser Adresse anzeigen"
                      >
                        Kontakte{cnt > 0 ? ` (${cnt})` : ''}
                      </button>
                      <button className="btn-small" onClick={() => openEdit(a)}>Bearbeiten</button>
                      <button className="btn-small btn-danger" onClick={() => handleDelete(a)}>Löschen</button>
                    </td>
                  </tr>
                  )
                })}
                {!filtered.length && <tr><td colSpan={5 + visibleOptCols.length} className="empty-note">Keine Einträge</td></tr>}
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
      )}

      {tab === 'create' && (
        <form ref={createAddrFormRef} onSubmit={submitCreate} className="master-form">
          <AddrForm vals={form} setK={set} msg={msg} countries={countries} />
          <button className="btn-primary" type="submit" disabled={createMut.isPending}>
            {createMut.isPending ? 'Speichert …' : 'Speichern'}
          </button>
        </form>
      )}

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
  const [tab,          setTab]          = useState('list')
  const [search,       setSearch]       = useState(initialSearch ?? '')
  const [sortKey,      setSortKey]      = useState<ConSortKey>('NAME')
  const [sortDir,      setSortDir]      = useState<'asc'|'desc'>('asc')
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
  const [activeAdresse,  setActiveAdresse]  = useState<Set<string>>(new Set())
  const [hiddenCols,     setHiddenCols]     = useState<Set<ConOptColKey>>(new Set(CON_OPT_COLS.map(c => c.key)))
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
          `${c.FIRST_NAME} ${c.LAST_NAME} ${c.ADDRESS ?? ''} ${c.SALUTATION ?? ''} ${c.GENDER ?? ''} ${c.EMAIL ?? ''} ${c.MOBILE ?? ''}`
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

  function handleDeleteContact(c: Contact) {
    setConfirmState({
      title: 'Kontakt löschen',
      message: `${c.FIRST_NAME} ${c.LAST_NAME} wirklich löschen?`,
      onConfirm: () => deleteConMut.mutate(c.ID),
    })
  }

  function openEdit(c: Contact) {
    setEditForm({
      title:         c.TITLE         ?? '',
      first_name:    c.FIRST_NAME,
      last_name:     c.LAST_NAME,
      email:         c.EMAIL         ?? '',
      mobile:        c.MOBILE        ?? '',
      salutation_id: c.SALUTATION_ID ?? '',
      gender_id:     c.GENDER_ID     ?? '',
      address_id:    c.ADDRESS_ID    ?? '',
    })
    setEditAddrText(c.ADDRESS ?? '')
    setEditMsg(null)
    setEditContact(c)
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

  const set  = useCallback((k: keyof ContactPayload) => (v: string) => setForm(f    => ({ ...f, [k]: v })), [])
  const setE = useCallback((k: keyof ContactPayload) => (v: string) => setEditForm(f => ({ ...f, [k]: v })), [])

  const createConFormRef = useRef<HTMLFormElement>(null)
  const editConFormRef   = useRef<HTMLFormElement>(null)
  useCtrlS(() => createConFormRef.current?.requestSubmit(), tab === 'create')
  useCtrlS(() => editConFormRef.current?.requestSubmit(),   editContact !== null)

  const hasActiveFilter = activeAdresse.size > 0 || search.trim() !== ''

  return (
    <>
      <Tabs tabs={CON_TABS} active={tab} onChange={setTab} />

      {tab === 'list' && (
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
            <span className="list-info">
              {filtered.length !== contacts.length ? `${filtered.length} / ${contacts.length}` : `${contacts.length}`} Einträge
            </span>
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
                    <td>{c.FIRST_NAME} {c.LAST_NAME}</td>
                    <td>{c.SALUTATION}</td>
                    <td>{c.GENDER}</td>
                    <td>{c.ADDRESS_ID ? (
                      <button className="link-cell" onClick={() => navigate('/adressen', { state: { openAddressId: c.ADDRESS_ID } })}>
                        {c.ADDRESS}
                      </button>
                    ) : (c.ADDRESS ?? '—')}</td>
                    {visibleOptCols.map(col => <td key={col.key}>{(c[col.key as keyof Contact] as string | null | undefined) ?? '—'}</td>)}
                    <td className="doc-actions">
                      <button className="btn-small" onClick={() => openEdit(c)}>Bearbeiten</button>
                      <button className="btn-small btn-danger" onClick={() => handleDeleteContact(c)}>Löschen</button>
                    </td>
                  </tr>
                ))}
                {!filtered.length && <tr><td colSpan={5 + visibleOptCols.length} className="empty-note">Keine Einträge</td></tr>}
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
      )}

      {tab === 'create' && (
        <form ref={createConFormRef} onSubmit={submitCreate} className="master-form">
          <ContactForm
            vals={form} setK={set} addrTxt={addrText} setAddrTxt={setAddrText}
            msg={msg} salutations={salutations} genders={genders} searchAddresses={searchAddresses}
          />
          <button className="btn-primary" type="submit" disabled={createMut.isPending}>
            {createMut.isPending ? 'Speichert …' : 'Speichern'}
          </button>
        </form>
      )}

      <Modal open={editContact !== null} onClose={() => setEditContact(null)} title="Kontakt bearbeiten">
        <form ref={editConFormRef} onSubmit={submitEdit} className="master-form">
          <ContactForm
            vals={editForm} setK={setE} addrTxt={editAddrText} setAddrTxt={setEditAddrText}
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
      <Tabs tabs={PAGE_TABS} active={tab} onChange={setTab} />
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
