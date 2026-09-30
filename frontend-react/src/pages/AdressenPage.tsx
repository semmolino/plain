import { useState, useMemo, useRef, useEffect } from 'react'
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { SlidersHorizontal, Pencil, Trash2, Plus, Download, Star } from 'lucide-react'
import { ListLoading } from '@/components/ui/Skeleton'
import { FilterChip } from '@/components/ui/FilterChip'
import { FilterBar } from '@/components/ui/FilterBar'
import { SortTh } from '@/components/ui/SortTh'
import { Message } from '@/components/ui/Message'
import { Can } from '@/components/ui/Can'
import { InlineSelect, type InlineOption } from '@/components/ui/InlineEdit'
import { Tabs } from '@/components/ui/Tabs'
import { useStickyState, useStickySet } from '@/hooks/useStickyState'
import { useConfirm } from '@/hooks/useConfirm'
import { useFilterTabs, usePermission } from '@/store/permissionsStore'
import { useToast } from '@/store/toastStore'
import { RecentList } from '@/components/recents/RecentList'
import { addressToPayload, contactToPayload } from '@/pages/adressen/addressForms'
import { AddressCreateDialog } from '@/pages/adressen/AddressCreateDialog'
import { ContactDialog, type ContactDialogState } from '@/pages/adressen/ContactDialog'
import { downloadCsv, downloadText, contactVCard } from '@/utils/exportData'
import {
  fetchSalutations, fetchGenders,
  fetchAddressList, updateAddress, deleteAddress,
  fetchContactList, updateContact, deleteContact,
  addressTypeLabel, ADDRESS_TYPES,
  type Address, type Contact, type AddressPayload, type ContactPayload,
} from '@/api/stammdaten'

/**
 * Adressen und Kontakte — die Listen (UI-Pilot Runde 8).
 *
 * Bearbeitet wird auf der Adressseite (/adressen/:id); der Stift, „Zuletzt
 * verwendet" und Links aus anderen Modulen führen dorthin. Vorher öffneten
 * sie einen Dialog — auch für Nutzer ohne Recht zum Bearbeiten. Der Reiter
 * steht in der URL (?tab=kontakte), Zurück wechselt ihn wieder.
 */

// Inline-Optionen für die Adress-Kategorie (spiegelt den ADDRESS_TYPE-Katalog).
const CATEGORY_OPTS: InlineOption[] = ADDRESS_TYPES.map(t => ({ value: String(t.id), label: t.label }))

const PAGE_TABS: { id: string; label: string; permissions: string[] }[] = [
  { id: 'adressen', label: 'Adressen',  permissions: ['addresses.view'] },
  { id: 'kontakte', label: 'Kontakte',  permissions: ['addresses.contacts.view'] },
]

// ── Adressen: Sortierung und optionale Spalten ─────────────────────────────

type AddrSortKey = 'ADDRESS_NAME_1' | 'CITY' | 'COUNTRY' | 'CUSTOMER_NUMBER'
type AddrOptColKey = 'ADDRESS_TYPE' | 'ADDRESS_NAME_2' | 'STREET' | 'PHONE' | 'EMAIL' | 'TAX_ID' | 'BUYER_REFERENCE'

const ADDR_OPT_COLS: { key: AddrOptColKey; label: string }[] = [
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

// ── Kontakte: Sortierung und optionale Spalten ─────────────────────────────

type ConSortKey  = 'NAME' | 'SALUTATION' | 'GENDER' | 'ADDRESS'
type ConOptColKey = 'POSITION' | 'DEPARTMENT' | 'TITLE' | 'EMAIL' | 'MOBILE' | 'PHONE'

const CON_OPT_COLS: { key: ConOptColKey; label: string }[] = [
  { key: 'POSITION',   label: 'Funktion'  },
  { key: 'DEPARTMENT', label: 'Abteilung' },
  { key: 'TITLE',      label: 'Titel'     },
  { key: 'EMAIL',      label: 'E-Mail'    },
  { key: 'MOBILE',     label: 'Mobil'     },
  { key: 'PHONE',      label: 'Festnetz'  },
]

/** Spaltenwahl — gemeinsam für beide Listen (Klick daneben schließt). */
function ColumnPanel<K extends string>({ cols, hidden, onToggle }: {
  cols: { key: K; label: string }[]; hidden: Set<K>; onToggle: (k: K) => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [open])
  return (
    <div ref={ref} className="pl-col-wrap pl-toolbar-actions">
      <button type="button" className="pl-col-btn" aria-expanded={open} onClick={() => setOpen(o => !o)}
        style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
        <SlidersHorizontal size={13} strokeWidth={2} aria-hidden="true" />Spalten
      </button>
      {open && (
        <div className="pl-col-panel">
          <div className="pl-col-panel-title">Optionale Spalten</div>
          {cols.map(c => (
            <label key={c.key} className="pl-col-option">
              <input type="checkbox" checked={!hidden.has(c.key)} onChange={() => onToggle(c.key)} />
              {c.label}
            </label>
          ))}
        </div>
      )}
    </div>
  )
}

function useHiddenCols<K extends string>(key: string, all: K[]) {
  return useStickyState<Set<K>>(key, () => new Set(all), {
    serialize: s => [...s], deserialize: raw => new Set(Array.isArray(raw) ? raw as K[] : []),
  })
}

// ── Adressen ───────────────────────────────────────────────────────────────

function AdressenSection({ initialSearch }: { initialSearch?: string }) {
  const qc = useQueryClient()
  const toast = useToast()
  const navigate = useNavigate()
  const [confirm, confirmDialog] = useConfirm()
  const [createOpen, setCreateOpen] = useState(false)
  const [search, setSearch] = useState(initialSearch ?? '')
  const [sortKey, setSortKey] = useStickyState<AddrSortKey>('adressen.sortKey', 'ADDRESS_NAME_1')
  const [sortDir, setSortDir] = useStickyState<'asc'|'desc'>('adressen.sortDir', 'asc')
  const [activeTyp,   setActiveTyp]   = useStickySet('adressen.typ')
  const [activeLand,  setActiveLand]  = useStickySet('adressen.land')
  const [activeStadt, setActiveStadt] = useStickySet('adressen.stadt')
  const [hiddenCols, setHiddenCols] = useHiddenCols<AddrOptColKey>('adressen.cols', ADDR_OPT_COLS.map(c => c.key))

  const canEdit = usePermission('addresses.edit')
  const canContacts = usePermission('addresses.contacts.view')
  const { data: listData, isLoading, isError } = useQuery({ queryKey: ['addresses'], queryFn: fetchAddressList })
  // Kontaktzahl je Adresse — nur mit Kontakt-Recht. Vorher lief die Abfrage
  // immer und zeigte ohne Recht bei jedem Besuch eine 403-Meldung.
  const { data: contactsData } = useQuery({ queryKey: ['contacts'], queryFn: fetchContactList, enabled: canContacts })
  const addresses = listData?.data ?? []

  useEffect(() => { if (initialSearch !== undefined) setSearch(initialSearch) }, [initialSearch])

  const contactCountByAddr = useMemo(() => {
    const map: Record<number, number> = {}
    for (const c of contactsData?.data ?? []) if (c.ADDRESS_ID != null) map[c.ADDRESS_ID] = (map[c.ADDRESS_ID] ?? 0) + 1
    return map
  }, [contactsData?.data])

  const filterOptions = useMemo(() => ({
    typ:   [...new Set(addresses.map(a => addressTypeLabel(a.ADDRESS_TYPE)).filter((v): v is string => !!v))].sort(),
    land:  [...new Set(addresses.map(a => a.COUNTRY).filter((v): v is string => v != null && v !== ''))].sort(),
    stadt: [...new Set(addresses.map(a => a.CITY).filter((v): v is string => v != null && v !== ''))].sort(),
  }), [addresses])

  function toggleSort(k: AddrSortKey) {
    if (sortKey === k) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortKey(k); setSortDir('asc') }
  }
  const toggleCol = (key: AddrOptColKey) => setHiddenCols(prev => { const s = new Set(prev); s.has(key) ? s.delete(key) : s.add(key); return s })
  const visibleOptCols = ADDR_OPT_COLS.filter(c => !hiddenCols.has(c.key))

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    let rows = q
      ? addresses.filter(a =>
          `${a.ADDRESS_NAME_1 ?? ''} ${a.ADDRESS_NAME_2 ?? ''} ${a.POST_CODE ?? ''} ${a.CITY ?? ''} ${a.COUNTRY ?? ''} ${a.CUSTOMER_NUMBER ?? ''} ${a.EMAIL ?? ''} ${a.PHONE ?? ''}`
            .toLowerCase().includes(q))
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

  const inlineMut = useMutation({
    mutationFn: ({ id, body }: { id: number; body: AddressPayload }) => updateAddress(id, body),
    onSuccess: (_d, v) => {
      void qc.invalidateQueries({ queryKey: ['addresses'] })
      void qc.invalidateQueries({ queryKey: ['address-detail', v.id] })
    },
    onError: (e: Error) => toast.error(e.message),
  })

  async function handleDelete(a: Address) {
    const ok = await confirm({
      title: 'Adresse löschen?',
      message: `„${a.ADDRESS_NAME_1}" wird gelöscht. Wird sie noch verwendet (Kontakte, Projekte, Rechnungen …), lehnt plan&simple das ab und sagt, wo.`,
      confirmLabel: 'Löschen',
    })
    if (!ok) return
    try {
      await deleteAddress(a.ID)
      void qc.invalidateQueries({ queryKey: ['addresses'] })
      toast.success(`${a.ADDRESS_NAME_1} gelöscht.`)
    } catch (e) {
      toast.error((e as Error)?.message || 'Löschen fehlgeschlagen')
    }
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

  const activeFilterCount = activeTyp.size + activeLand.size + activeStadt.size
  const colCount = 4 + visibleOptCols.length + 1

  return (
    <>
      <div className="list-section ad-list">
        <RecentList
          type="address"
          title="Zuletzt verwendete Adressen"
          onSelect={e => navigate(`/adressen/${e.ENTITY_ID}`)}
        />
        <div className="pl-toolbar">
          <input type="search" className="list-search" placeholder="Suchen …" aria-label="Adressen durchsuchen"
            value={search} onChange={e => setSearch(e.target.value)} />
          <FilterBar
            activeCount={activeFilterCount}
            onReset={() => { setActiveTyp(new Set()); setActiveLand(new Set()); setActiveStadt(new Set()); setSearch('') }}
          >
            <FilterChip label="Kategorie" options={filterOptions.typ}   active={activeTyp}   onChange={setActiveTyp}   />
            <FilterChip label="Land"      options={filterOptions.land}  active={activeLand}  onChange={setActiveLand}  />
            <FilterChip label="Stadt"     options={filterOptions.stadt} active={activeStadt} onChange={setActiveStadt} />
          </FilterBar>
          <ColumnPanel cols={ADDR_OPT_COLS} hidden={hiddenCols} onToggle={toggleCol} />
          <button type="button" className="pl-col-btn" onClick={exportCsv} title="Gefilterte Liste als CSV exportieren"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }} disabled={filtered.length === 0}>
            <Download size={13} strokeWidth={2} aria-hidden="true" />CSV
          </button>
          <span className="list-info">
            {isLoading ? '… Einträge'
              : `${filtered.length !== addresses.length ? `${filtered.length} / ${addresses.length}` : `${addresses.length}`} Einträge`}
          </span>
          <Can permission="addresses.create">
            <button type="button" className="btn-primary btn-small" onClick={() => setCreateOpen(true)} style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 5 }}>
              <Plus size={13} strokeWidth={2.25} aria-hidden="true" />Neu
            </button>
          </Can>
        </div>
        {isLoading && <ListLoading columns={6} />}
        {isError && <Message type="error" text="Die Adressen konnten nicht geladen werden." />}
        {!isLoading && !isError && (
          <table className="master-table">
            <thead>
              <tr>
                <SortTh label="Name"      column="ADDRESS_NAME_1"  sortKey={sortKey} dir={sortDir} onSort={toggleSort} />
                <SortTh label="Ort"       column="CITY"            sortKey={sortKey} dir={sortDir} onSort={toggleSort} />
                <SortTh label="Land"      column="COUNTRY"         sortKey={sortKey} dir={sortDir} onSort={toggleSort} />
                <SortTh label="Kundennr." column="CUSTOMER_NUMBER" sortKey={sortKey} dir={sortDir} onSort={toggleSort} />
                {visibleOptCols.map(c => <th scope="col" key={c.key}>{c.label}</th>)}
                <th scope="col" className="doc-actions"><span className="sr-only">Aktionen</span></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(a => {
                const cnt = contactCountByAddr[a.ID] ?? 0
                return (
                  <tr key={a.ID} className="clickable-row" onClick={() => navigate(`/adressen/${a.ID}`)}>
                    {/* Der Name ist der Link — die Zeile war vorher nur mit der Maus zu öffnen */}
                    <td><Link to={`/adressen/${a.ID}`} className="ad-row-link" onClick={e => e.stopPropagation()}>{a.ADDRESS_NAME_1}</Link></td>
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
                      {canContacts && (
                        <Link className="btn-small ad-contacts-link" to={`/adressen/${a.ID}`} title="Kontakte dieser Adresse">
                          Kontakte{cnt > 0 ? ` (${cnt})` : ''}
                        </Link>
                      )}
                      <Can permission="addresses.edit">
                        <button type="button" className="row-action-btn" onClick={() => navigate(`/adressen/${a.ID}?tab=daten`)}
                          title="Adressdaten bearbeiten" aria-label={`${a.ADDRESS_NAME_1} bearbeiten`}>
                          <Pencil size={14} strokeWidth={2} aria-hidden="true" />
                        </button>
                      </Can>
                      <Can permission="addresses.delete">
                        <button type="button" className="row-action-btn row-action-btn--danger" onClick={() => void handleDelete(a)}
                          title="Löschen" aria-label={`${a.ADDRESS_NAME_1} löschen`}>
                          <Trash2 size={14} strokeWidth={2} aria-hidden="true" />
                        </button>
                      </Can>
                    </td>
                  </tr>
                )
              })}
              {!filtered.length && (
                <tr><td colSpan={colCount} className="empty-note">
                  {addresses.length === 0
                    ? 'Noch keine Adressen. Adressen sind die Grundlage für Angebote, Projekte und Rechnungen — lege die erste über „Neu" an oder importiere sie unter Einstellungen → Datenimport.'
                    : 'Keine Treffer für diese Suche oder Filter.'}
                </td></tr>
              )}
            </tbody>
            <tfoot>
              <tr style={{ fontWeight: 600, borderTop: '2px solid var(--border)' }}>
                <td colSpan={colCount} style={{ fontSize: 13, color: 'var(--text-3)', paddingTop: 6 }}>
                  {filtered.length !== addresses.length ? `${filtered.length} / ${addresses.length} Einträge` : `${addresses.length} Einträge`}
                </td>
              </tr>
            </tfoot>
          </table>
        )}
      </div>
      <AddressCreateDialog open={createOpen} onClose={() => setCreateOpen(false)} />
      {confirmDialog}
    </>
  )
}

// ── Kontakte ───────────────────────────────────────────────────────────────

function KontakteSection() {
  const qc = useQueryClient()
  const toast = useToast()
  const [confirm, confirmDialog] = useConfirm()
  const [dialog, setDialog] = useState<ContactDialogState>(null)
  const [search, setSearch] = useState('')
  const [sortKey, setSortKey] = useStickyState<ConSortKey>('kontakte.sortKey', 'NAME')
  const [sortDir, setSortDir] = useStickyState<'asc'|'desc'>('kontakte.sortDir', 'asc')
  const [activeAdresse,   setActiveAdresse]   = useStickySet('kontakte.adresse')
  const [activeFunktion,  setActiveFunktion]  = useStickySet('kontakte.funktion')
  const [activeAbteilung, setActiveAbteilung] = useStickySet('kontakte.abteilung')
  const [onlyPrimary, setOnlyPrimary] = useStickyState<boolean>('kontakte.primary', false)
  const [hiddenCols, setHiddenCols] = useHiddenCols<ConOptColKey>('kontakte.cols', CON_OPT_COLS.map(c => c.key))

  const { data: salData } = useQuery({ queryKey: ['salutations'], queryFn: fetchSalutations })
  const { data: genData } = useQuery({ queryKey: ['genders-std'], queryFn: fetchGenders })
  const { data: listData, isLoading, isError } = useQuery({ queryKey: ['contacts'], queryFn: fetchContactList })
  const salutations = salData?.data ?? []
  const genders     = genData?.data ?? []
  const contacts    = listData?.data ?? []

  const filterOptions = useMemo(() => {
    const uniq = (fn: (c: Contact) => string | null | undefined) =>
      [...new Set(contacts.map(fn).filter((v): v is string => v != null && v !== ''))].sort((a, b) => a.localeCompare(b, 'de'))
    return { adresse: uniq(c => c.ADDRESS), funktion: uniq(c => c.POSITION), abteilung: uniq(c => c.DEPARTMENT) }
  }, [contacts])

  function toggleSort(k: ConSortKey) {
    if (sortKey === k) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortKey(k); setSortDir('asc') }
  }
  const toggleCol = (key: ConOptColKey) => setHiddenCols(prev => { const s = new Set(prev); s.has(key) ? s.delete(key) : s.add(key); return s })
  const visibleOptCols = CON_OPT_COLS.filter(c => !hiddenCols.has(c.key))

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    let rows = q
      ? contacts.filter(c =>
          `${c.FIRST_NAME} ${c.LAST_NAME} ${c.ADDRESS ?? ''} ${c.SALUTATION ?? ''} ${c.GENDER ?? ''} ${c.EMAIL ?? ''} ${c.MOBILE ?? ''} ${c.POSITION ?? ''} ${c.DEPARTMENT ?? ''}`
            .toLowerCase().includes(q))
      : contacts
    if (activeAdresse.size   > 0) rows = rows.filter(c => c.ADDRESS    && activeAdresse.has(c.ADDRESS))
    if (activeFunktion.size  > 0) rows = rows.filter(c => c.POSITION   && activeFunktion.has(c.POSITION))
    if (activeAbteilung.size > 0) rows = rows.filter(c => c.DEPARTMENT && activeAbteilung.has(c.DEPARTMENT))
    if (onlyPrimary)              rows = rows.filter(c => !!c.IS_PRIMARY)
    return [...rows].sort((a, b) => {
      const av = String(sortKey === 'NAME' ? `${a.LAST_NAME ?? ''} ${a.FIRST_NAME ?? ''}` : (a[sortKey as keyof Contact] ?? ''))
      const bv = String(sortKey === 'NAME' ? `${b.LAST_NAME ?? ''} ${b.FIRST_NAME ?? ''}` : (b[sortKey as keyof Contact] ?? ''))
      const cmp = av.localeCompare(bv, 'de', { sensitivity: 'base', numeric: true })
      return sortDir === 'asc' ? cmp : -cmp
    })
  }, [contacts, search, sortKey, sortDir, activeAdresse, activeFunktion, activeAbteilung, onlyPrimary])

  const canEdit = usePermission('addresses.contacts.edit')
  const salOpts:    InlineOption[] = useMemo(() => salutations.map(s => ({ value: String(s.ID), label: s.SALUTATION })), [salutations])
  const genderOpts: InlineOption[] = useMemo(() => genders.map(g    => ({ value: String(g.ID), label: g.GENDER })),     [genders])
  const inlineMut = useMutation({
    mutationFn: ({ id, body }: { id: number; body: ContactPayload }) => updateContact(id, body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['contacts'] })
      void qc.invalidateQueries({ queryKey: ['address-detail'] })
    },
    onError: (e: Error) => toast.error(e.message),
  })

  async function handleDelete(c: Contact) {
    const name = `${c.FIRST_NAME} ${c.LAST_NAME}`.trim()
    if (!(await confirm({ title: 'Kontakt löschen?', message: `${name} wird gelöscht.`, confirmLabel: 'Löschen' }))) return
    try {
      await deleteContact(c.ID)
      void qc.invalidateQueries({ queryKey: ['contacts'] })
      void qc.invalidateQueries({ queryKey: ['address-detail'] })
      void qc.invalidateQueries({ queryKey: ['contacts-by-address'] })
      toast.success(`${name} gelöscht.`)
    } catch (e) {
      toast.error((e as Error)?.message || 'Löschen fehlgeschlagen')
    }
  }

  function exportCsv() {
    downloadCsv(
      'kontakte.csv',
      ['Anrede', 'Titel', 'Vorname', 'Nachname', 'Funktion', 'Abteilung', 'E-Mail', 'Mobil', 'Festnetz', 'Adresse'],
      filtered.map(c => [c.SALUTATION, c.TITLE, c.FIRST_NAME, c.LAST_NAME, c.POSITION, c.DEPARTMENT, c.EMAIL, c.MOBILE, c.PHONE, c.ADDRESS]),
    )
  }

  const activeFilterCount = activeAdresse.size + activeFunktion.size + activeAbteilung.size + (onlyPrimary ? 1 : 0)
  const hasActiveFilter = activeFilterCount > 0 || search.trim() !== ''
  const colCount = 4 + visibleOptCols.length + 1

  return (
    <>
      <div className="list-section ad-list">
        <div className="pl-toolbar">
          <input type="search" className="list-search" placeholder="Suchen …" aria-label="Kontakte durchsuchen"
            value={search} onChange={e => setSearch(e.target.value)} />
          {/* Wie bei den Adressen: am Handy hinter „Filter" eingeklappt */}
          <FilterBar
            activeCount={activeFilterCount}
            onReset={() => { setActiveAdresse(new Set()); setActiveFunktion(new Set()); setActiveAbteilung(new Set()); setOnlyPrimary(false); setSearch('') }}
          >
            <FilterChip label="Adresse"   options={filterOptions.adresse}   active={activeAdresse}   onChange={setActiveAdresse}   />
            <FilterChip label="Funktion"  options={filterOptions.funktion}  active={activeFunktion}  onChange={setActiveFunktion}  />
            <FilterChip label="Abteilung" options={filterOptions.abteilung} active={activeAbteilung} onChange={setActiveAbteilung} />
            <button type="button" className={`filter-chip-btn${onlyPrimary ? ' active' : ''}`}
              onClick={() => setOnlyPrimary(v => !v)} aria-pressed={onlyPrimary}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
              <Star size={12} strokeWidth={2} fill={onlyPrimary ? 'currentColor' : 'none'} aria-hidden="true" />
              Hauptansprechpartner
            </button>
          </FilterBar>
          <ColumnPanel cols={CON_OPT_COLS} hidden={hiddenCols} onToggle={toggleCol} />
          <button type="button" className="pl-col-btn" onClick={exportCsv} title="Gefilterte Liste als CSV exportieren"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }} disabled={filtered.length === 0}>
            <Download size={13} strokeWidth={2} aria-hidden="true" />CSV
          </button>
          <span className="list-info">
            {isLoading ? '… Einträge'
              : `${filtered.length !== contacts.length ? `${filtered.length} / ${contacts.length}` : `${contacts.length}`} Einträge`}
          </span>
          <Can permission="addresses.contacts.create">
            <button type="button" className="btn-primary btn-small" onClick={() => setDialog({ mode: 'new' })} style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 5 }}>
              <Plus size={13} strokeWidth={2.25} aria-hidden="true" />Neu
            </button>
          </Can>
        </div>
        {isLoading && <ListLoading columns={6} />}
        {isError && <Message type="error" text="Die Kontakte konnten nicht geladen werden." />}
        {!isLoading && !isError && (
          <table className="master-table">
            <thead>
              <tr>
                <SortTh label="Name"       column="NAME"       sortKey={sortKey} dir={sortDir} onSort={toggleSort} />
                <SortTh label="Anrede"     column="SALUTATION" sortKey={sortKey} dir={sortDir} onSort={toggleSort} />
                <SortTh label="Geschlecht" column="GENDER"     sortKey={sortKey} dir={sortDir} onSort={toggleSort} />
                <SortTh label="Adresse"    column="ADDRESS"    sortKey={sortKey} dir={sortDir} onSort={toggleSort} />
                {visibleOptCols.map(c => <th scope="col" key={c.key}>{c.label}</th>)}
                <th scope="col" className="doc-actions"><span className="sr-only">Aktionen</span></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(c => {
                const name = `${c.FIRST_NAME} ${c.LAST_NAME}`.trim()
                return (
                  <tr key={c.ID}>
                    <td>
                      {!!c.IS_PRIMARY && <Star size={12} strokeWidth={2} fill="currentColor" className="ad-star" aria-label="Hauptansprechpartner" />}
                      {c.TITLE ? `${c.TITLE} ` : ''}{name}
                    </td>
                    <td>
                      <InlineSelect
                        value={c.SALUTATION_ID} options={salOpts} allowEmpty={false} placeholder="—"
                        readOnly={!canEdit} ariaLabel={`Anrede ${name}`} fallbackLabel={c.SALUTATION || undefined}
                        onChange={v => v && inlineMut.mutate({ id: c.ID, body: { ...contactToPayload(c), salutation_id: v } })}
                      />
                    </td>
                    <td>
                      <InlineSelect
                        value={c.GENDER_ID} options={genderOpts} allowEmpty={false} placeholder="—"
                        readOnly={!canEdit} ariaLabel={`Geschlecht ${name}`} fallbackLabel={c.GENDER || undefined}
                        onChange={v => v && inlineMut.mutate({ id: c.ID, body: { ...contactToPayload(c), gender_id: v } })}
                      />
                    </td>
                    <td>{c.ADDRESS_ID ? <Link className="ad-row-link" to={`/adressen/${c.ADDRESS_ID}`}>{c.ADDRESS || '—'}</Link> : (c.ADDRESS || '—')}</td>
                    {visibleOptCols.map(col => <td key={col.key}>{(c[col.key as keyof Contact] as string | null | undefined) ?? '—'}</td>)}
                    <td className="doc-actions">
                      <button type="button" className="row-action-btn" title="Als vCard speichern" aria-label={`${name} als vCard speichern`}
                        onClick={() => downloadText(`${c.FIRST_NAME}_${c.LAST_NAME}.vcf`.replace(/\s+/g, '_'), contactVCard(c), 'text/vcard')}>
                        <Download size={14} strokeWidth={2} aria-hidden="true" />
                      </button>
                      <Can permission="addresses.contacts.edit">
                        <button type="button" className="row-action-btn" onClick={() => setDialog({ mode: 'edit', contact: c })}
                          title="Bearbeiten" aria-label={`${name} bearbeiten`}>
                          <Pencil size={14} strokeWidth={2} aria-hidden="true" />
                        </button>
                      </Can>
                      <Can permission="addresses.contacts.delete">
                        <button type="button" className="row-action-btn row-action-btn--danger" onClick={() => void handleDelete(c)}
                          title="Löschen" aria-label={`${name} löschen`}>
                          <Trash2 size={14} strokeWidth={2} aria-hidden="true" />
                        </button>
                      </Can>
                    </td>
                  </tr>
                )
              })}
              {!filtered.length && (
                <tr><td colSpan={colCount} className="empty-note">
                  {contacts.length === 0 && !hasActiveFilter
                    ? 'Noch keine Kontakte. Ansprechpartner stehen auf Angeboten und Rechnungen als Empfänger — lege sie auf der Seite einer Adresse oder hier über „Neu" an.'
                    : 'Keine Treffer für diese Suche oder Filter.'}
                </td></tr>
              )}
            </tbody>
            <tfoot>
              <tr style={{ fontWeight: 600, borderTop: '2px solid var(--border)' }}>
                <td colSpan={colCount} style={{ fontSize: 13, color: 'var(--text-3)', paddingTop: 6 }}>
                  {filtered.length !== contacts.length ? `${filtered.length} / ${contacts.length} Einträge` : `${contacts.length} Einträge`}
                </td>
              </tr>
            </tfoot>
          </table>
        )}
      </div>
      <ContactDialog state={dialog} onClose={() => setDialog(null)} />
      {confirmDialog}
    </>
  )
}

// ── Seite ──────────────────────────────────────────────────────────────────

export function AdressenPage() {
  const location = useLocation()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const tabs = useFilterTabs(PAGE_TABS)
  const raw = params.get('tab')
  const tab = tabs.some(t => t.id === raw) ? raw! : (tabs[0]?.id ?? 'adressen')

  // Alte Einstiege: state.openAddressId öffnete den Bearbeiten-Dialog der
  // Liste (Projektliste, „Zuletzt verwendet"), state.searchAddress füllte
  // die Suche (Rechnungsliste). Das erste führt jetzt auf die Adressseite.
  const navState = location.state as { openAddressId?: number; searchAddress?: string } | null
  const [addrInitSearch] = useState<string | undefined>(navState?.searchAddress)
  useEffect(() => {
    if (navState?.openAddressId) navigate(`/adressen/${navState.openAddressId}`, { replace: true })
    else if (navState?.searchAddress) navigate({ pathname: '/adressen', search: location.search }, { replace: true, state: null })
  }, [navState?.openAddressId, navState?.searchAddress]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="master-page">
      <h1 className="sr-only">Adressen &amp; Kontakte</h1>
      <Tabs tabs={tabs} active={tab} onChange={id => setParams(id === 'adressen' ? {} : { tab: id })} />
      <div className="master-section">
        {tab === 'adressen' && <AdressenSection initialSearch={addrInitSearch} />}
        {tab === 'kontakte' && <KontakteSection />}
      </div>
    </div>
  )
}
