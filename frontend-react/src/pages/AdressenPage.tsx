import { useState, useCallback, useMemo, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Tabs }        from '@/components/ui/Tabs'
import { Modal }       from '@/components/ui/Modal'
import { Message }     from '@/components/ui/Message'
import { FormField }   from '@/components/ui/FormField'
import { Autocomplete } from '@/components/ui/Autocomplete'
import { useCtrlS } from '@/hooks/useCtrlS'
import {
  fetchCountries, fetchSalutations, fetchGenders,
  fetchAddressList, searchAddressesApi, createAddress, updateAddress,
  fetchContactList, createContact, updateContact,
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
  return { address_name_1: '', address_name_2: '', street: '', post_code: '', city: '', country_id: '', customer_number: '', tax_id: '', buyer_reference: '' }
}
function emptyContact(): ContactPayload {
  return { title: '', first_name: '', last_name: '', email: '', mobile: '', salutation_id: '', gender_id: '', address_id: '' }
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

type AddrSortKey = 'ADDRESS_NAME_1' | 'CITY' | 'COUNTRY' | 'CUSTOMER_NUMBER'
type ConSortKey  = 'NAME' | 'SALUTATION' | 'GENDER' | 'ADDRESS'

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

function AdressenSection() {
  const qc = useQueryClient()
  const [tab,      setTab]      = useState('list')
  const [search,   setSearch]   = useState('')
  const [sortKey,  setSortKey]  = useState<AddrSortKey>('ADDRESS_NAME_1')
  const [sortDir,  setSortDir]  = useState<'asc'|'desc'>('asc')
  const [editAddr, setEditAddr] = useState<Address | null>(null)
  const [form,     setForm]     = useState<AddressPayload>(emptyAddr)
  const [editForm, setEditForm] = useState<AddressPayload>(emptyAddr)
  const [msg,      setMsg]      = useState<{ text: string; type: 'success' | 'error' } | null>(null)
  const [editMsg,  setEditMsg]  = useState<{ text: string; type: 'success' | 'error' } | null>(null)

  const { data: countriesData } = useQuery({ queryKey: ['countries'], queryFn: fetchCountries })
  const { data: listData, isLoading } = useQuery({ queryKey: ['addresses'], queryFn: fetchAddressList })

  const countries = countriesData?.data ?? []
  const addresses = listData?.data ?? []

  function toggleSort(k: AddrSortKey) {
    if (sortKey === k) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortKey(k); setSortDir('asc') }
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    let rows = q
      ? addresses.filter(a =>
          `${a.ADDRESS_NAME_1 ?? ''} ${a.POST_CODE ?? ''} ${a.CITY ?? ''} ${a.COUNTRY ?? ''} ${a.CUSTOMER_NUMBER ?? ''}`
            .toLowerCase().includes(q)
        )
      : addresses
    return [...rows].sort((a, b) => {
      const av = String(sortKey === 'CITY' ? `${a.POST_CODE ?? ''} ${a.CITY ?? ''}` : (a[sortKey as keyof Address] ?? ''))
      const bv = String(sortKey === 'CITY' ? `${b.POST_CODE ?? ''} ${b.CITY ?? ''}` : (b[sortKey as keyof Address] ?? ''))
      const cmp = av.localeCompare(bv, 'de', { sensitivity: 'base', numeric: true })
      return sortDir === 'asc' ? cmp : -cmp
    })
  }, [addresses, search, sortKey, sortDir])

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

  return (
    <>
      <Tabs tabs={ADDR_TABS} active={tab} onChange={setTab} />

      {tab === 'list' && (
        <div className="list-section">
          <div className="list-toolbar">
            <input className="list-search" placeholder="Suchen …" value={search} onChange={e => setSearch(e.target.value)} />
            <span className="list-info">
              {filtered.length !== addresses.length ? `${filtered.length} / ${addresses.length} Einträge` : `${addresses.length} Einträge`}
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
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(a => (
                  <tr key={a.ID}>
                    <td>{a.ADDRESS_NAME_1}</td>
                    <td>{[a.POST_CODE, a.CITY].filter(Boolean).join(' ')}</td>
                    <td>{a.COUNTRY}</td>
                    <td>{a.CUSTOMER_NUMBER}</td>
                    <td><button className="btn-small" onClick={() => openEdit(a)}>Bearbeiten</button></td>
                  </tr>
                ))}
                {!filtered.length && <tr><td colSpan={5} className="empty-note">Keine Einträge</td></tr>}
              </tbody>
              <tfoot>
                <tr style={{ fontWeight: 600, borderTop: '2px solid rgba(17,24,39,0.12)' }}>
                  <td colSpan={5} style={{ fontSize: 13, color: 'rgba(17,24,39,0.5)', paddingTop: 6 }}>
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
    </>
  )
}

// ── Contacts section ──────────────────────────────────────────────────────────

function KontakteSection() {
  const qc = useQueryClient()
  const [tab,          setTab]          = useState('list')
  const [search,       setSearch]       = useState('')
  const [sortKey,      setSortKey]      = useState<ConSortKey>('NAME')
  const [sortDir,      setSortDir]      = useState<'asc'|'desc'>('asc')
  const [editContact,  setEditContact]  = useState<Contact | null>(null)
  const [form,         setForm]         = useState<ContactPayload>(emptyContact)
  const [editForm,     setEditForm]     = useState<ContactPayload>(emptyContact)
  const [addrText,     setAddrText]     = useState('')
  const [editAddrText, setEditAddrText] = useState('')
  const [msg,          setMsg]          = useState<{ text: string; type: 'success' | 'error' } | null>(null)
  const [editMsg,      setEditMsg]      = useState<{ text: string; type: 'success' | 'error' } | null>(null)

  const { data: salData }  = useQuery({ queryKey: ['salutations'], queryFn: fetchSalutations })
  const { data: genData }  = useQuery({ queryKey: ['genders-std'], queryFn: fetchGenders })
  const { data: listData, isLoading } = useQuery({ queryKey: ['contacts'], queryFn: fetchContactList })

  const salutations = salData?.data  ?? []
  const genders     = genData?.data  ?? []
  const contacts    = listData?.data ?? []

  function toggleSort(k: ConSortKey) {
    if (sortKey === k) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortKey(k); setSortDir('asc') }
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    let rows = q
      ? contacts.filter(c =>
          `${c.FIRST_NAME} ${c.LAST_NAME} ${c.ADDRESS ?? ''} ${c.SALUTATION ?? ''} ${c.GENDER ?? ''}`
            .toLowerCase().includes(q)
        )
      : contacts
    return [...rows].sort((a, b) => {
      const av = String(sortKey === 'NAME' ? `${a.LAST_NAME ?? ''} ${a.FIRST_NAME ?? ''}` : (a[sortKey as keyof Contact] ?? ''))
      const bv = String(sortKey === 'NAME' ? `${b.LAST_NAME ?? ''} ${b.FIRST_NAME ?? ''}` : (b[sortKey as keyof Contact] ?? ''))
      const cmp = av.localeCompare(bv, 'de', { sensitivity: 'base', numeric: true })
      return sortDir === 'asc' ? cmp : -cmp
    })
  }, [contacts, search, sortKey, sortDir])

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

  return (
    <>
      <Tabs tabs={CON_TABS} active={tab} onChange={setTab} />

      {tab === 'list' && (
        <div className="list-section">
          <div className="list-toolbar">
            <input className="list-search" placeholder="Suchen …" value={search} onChange={e => setSearch(e.target.value)} />
            <span className="list-info">
              {filtered.length !== contacts.length ? `${filtered.length} / ${contacts.length} Einträge` : `${contacts.length} Einträge`}
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
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(c => (
                  <tr key={c.ID}>
                    <td>{c.FIRST_NAME} {c.LAST_NAME}</td>
                    <td>{c.SALUTATION}</td>
                    <td>{c.GENDER}</td>
                    <td>{c.ADDRESS}</td>
                    <td><button className="btn-small" onClick={() => openEdit(c)}>Bearbeiten</button></td>
                  </tr>
                ))}
                {!filtered.length && <tr><td colSpan={5} className="empty-note">Keine Einträge</td></tr>}
              </tbody>
              <tfoot>
                <tr style={{ fontWeight: 600, borderTop: '2px solid rgba(17,24,39,0.12)' }}>
                  <td colSpan={5} style={{ fontSize: 13, color: 'rgba(17,24,39,0.5)', paddingTop: 6 }}>
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
    </>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export function AdressenPage() {
  const [tab, setTab] = useState('adressen')
  return (
    <div className="master-page">
      <div className="master-page-header">
        <h1 className="master-page-title">Adressen &amp; Kontakte</h1>
      </div>
      <Tabs tabs={PAGE_TABS} active={tab} onChange={setTab} />
      <div className="master-section">
        {tab === 'adressen' && <AdressenSection />}
        {tab === 'kontakte' && <KontakteSection />}
      </div>
    </div>
  )
}
