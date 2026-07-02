import { useCallback, useMemo, useRef, useState, type ReactNode } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  ArrowLeft, Pencil, Trash2, Plus, Download, Star,
  Mail, Phone, Globe, FolderOpen, FileSignature, Receipt, Banknote,
} from 'lucide-react'
import { Can } from '@/components/ui/Can'
import { Modal } from '@/components/ui/Modal'
import { ConfirmModal } from '@/components/ui/ConfirmModal'
import { useCtrlS } from '@/hooks/useCtrlS'
import { useToast } from '@/store/toastStore'
import { AddrForm, ContactForm, emptyContact, addressToPayload, contactToPayload } from '@/pages/adressen/addressForms'
import { downloadText, contactVCard } from '@/utils/exportData'
import {
  fetchAddressDetail, fetchCountries, fetchSalutations, fetchGenders, searchAddressesApi,
  updateAddress, deleteAddress, createContact, updateContact, deleteContact,
  addressTypeLabel,
  type Contact, type AddressPayload, type ContactPayload,
} from '@/api/stammdaten'

// ── Kleine Bausteine ────────────────────────────────────────────────────────

function InfoRow({ label, children }: { label: string; children: ReactNode }) {
  if (children == null || children === '') return null
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '150px 1fr', gap: 8, padding: '4px 0', fontSize: 14 }}>
      <span style={{ color: 'var(--text-muted, #6b7280)' }}>{label}</span>
      <span style={{ whiteSpace: 'pre-line' }}>{children}</span>
    </div>
  )
}

function Card({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section style={{
      background: 'var(--surface, #fff)', border: '1px solid var(--border, #e5e7eb)',
      borderRadius: 8, padding: 16, marginBottom: 16,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 10 }}>
        <h2 style={{ fontSize: 15, fontWeight: 600, margin: 0 }}>{title}</h2>
        {action && <div style={{ marginLeft: 'auto' }}>{action}</div>}
      </div>
      {children}
    </section>
  )
}

function LinkList<T>({ items, icon, label, render, onClick }: {
  items: T[]; icon: ReactNode; label: string; render: (t: T) => string; onClick: (t: T) => void
}) {
  if (!items.length) return null
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 600, color: 'var(--text-muted, #6b7280)', marginBottom: 4 }}>
        {icon}{label} ({items.length})
      </div>
      <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {items.map((t, i) => (
          <li key={i}>
            <button className="link-cell" onClick={() => onClick(t)}>{render(t) || '—'}</button>
          </li>
        ))}
      </ul>
    </div>
  )
}

// ── Seite ───────────────────────────────────────────────────────────────────

export function AddressDetailPage() {
  const { id: idParam } = useParams<{ id: string }>()
  const id = Number(idParam)
  const navigate = useNavigate()
  const qc = useQueryClient()
  const toast = useToast()

  const { data, isLoading, isError } = useQuery({
    queryKey: ['address-detail', id],
    queryFn: () => fetchAddressDetail(id),
    enabled: Number.isFinite(id) && id > 0,
  })
  const { data: countriesData }  = useQuery({ queryKey: ['countries'],  queryFn: fetchCountries })
  const { data: salData }        = useQuery({ queryKey: ['salutations'], queryFn: fetchSalutations })
  const { data: genData }        = useQuery({ queryKey: ['genders-std'], queryFn: fetchGenders })

  const detail    = data?.data
  const address   = detail?.address
  const countries = countriesData?.data ?? []
  const salutations = salData?.data ?? []
  const genders     = genData?.data ?? []

  // ── Adresse bearbeiten ──
  const [editOpen, setEditOpen] = useState(false)
  const [editForm, setEditForm] = useState<AddressPayload>(() => ({ address_name_1: '', country_id: '' }))
  const [editMsg,  setEditMsg]  = useState<{ text: string; type: 'success' | 'error' } | null>(null)
  const editFormRef = useRef<HTMLFormElement>(null)

  function openEdit() {
    if (!address) return
    setEditForm(addressToPayload(address))
    setEditMsg(null)
    setEditOpen(true)
  }

  const updateAddrMut = useMutation({
    mutationFn: ({ addrId, body }: { addrId: number; body: AddressPayload }) => updateAddress(addrId, body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['address-detail', id] })
      void qc.invalidateQueries({ queryKey: ['addresses'] })
      setEditMsg({ text: 'Gespeichert ✅', type: 'success' })
      setTimeout(() => setEditOpen(false), 700)
    },
    onError: (e: Error) => setEditMsg({ text: e.message, type: 'error' }),
  })

  function submitEdit(e: React.FormEvent) {
    e.preventDefault()
    setEditMsg(null)
    if (!editForm.address_name_1 || !editForm.country_id) {
      setEditMsg({ text: 'Name und Land sind Pflichtfelder', type: 'error' }); return
    }
    updateAddrMut.mutate({ addrId: id, body: editForm })
  }

  const setEK = useCallback((k: keyof AddressPayload) => (v: string) => setEditForm(f => ({ ...f, [k]: v })), [])

  const deleteAddrMut = useMutation({
    mutationFn: () => deleteAddress(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['addresses'] })
      toast.success('Adresse gelöscht')
      navigate('/adressen')
    },
    onError: (e: Error) => toast.error(e.message),
  })

  // ── Kontakte anlegen/bearbeiten ──
  const [conCreateOpen, setConCreateOpen] = useState(false)
  const [conForm,       setConForm]       = useState<ContactPayload>(emptyContact)
  const [conAddrText,   setConAddrText]   = useState('')
  const [conMsg,        setConMsg]        = useState<{ text: string; type: 'success' | 'error' } | null>(null)
  const [editContact,   setEditContact]   = useState<Contact | null>(null)
  const [conEditForm,   setConEditForm]   = useState<ContactPayload>(emptyContact)
  const [conEditAddrText, setConEditAddrText] = useState('')
  const [conEditMsg,    setConEditMsg]    = useState<{ text: string; type: 'success' | 'error' } | null>(null)
  const [confirmState,  setConfirmState]  = useState<{ title: string; message: string; onConfirm: () => void } | null>(null)
  const conCreateRef = useRef<HTMLFormElement>(null)
  const conEditRef   = useRef<HTMLFormElement>(null)

  const searchAddresses = useCallback(async (q: string) => {
    const res = await searchAddressesApi(q)
    return res.data.map(a => ({ id: a.ID, label: a.ADDRESS_NAME_1 }))
  }, [])

  function invalidateContacts() {
    void qc.invalidateQueries({ queryKey: ['address-detail', id] })
    void qc.invalidateQueries({ queryKey: ['contacts'] })
  }

  const createConMut = useMutation({
    mutationFn: createContact,
    onSuccess: () => { invalidateContacts(); setConMsg({ text: 'Kontakt gespeichert ✅', type: 'success' }); setConForm({ ...emptyContact(), address_id: id }); setConAddrText(address?.ADDRESS_NAME_1 ?? '') },
    onError: (e: Error) => setConMsg({ text: e.message, type: 'error' }),
  })
  const updateConMut = useMutation({
    mutationFn: ({ conId, body }: { conId: number; body: ContactPayload }) => updateContact(conId, body),
    onSuccess: () => { invalidateContacts(); setConEditMsg({ text: 'Gespeichert ✅', type: 'success' }); setTimeout(() => setEditContact(null), 700) },
    onError: (e: Error) => setConEditMsg({ text: e.message, type: 'error' }),
  })
  const deleteConMut = useMutation({
    mutationFn: (conId: number) => deleteContact(conId),
    onSuccess: () => invalidateContacts(),
    onError: (e: Error) => toast.error(e.message),
  })

  function openConCreate() {
    setConForm({ ...emptyContact(), address_id: id })
    setConAddrText(address?.ADDRESS_NAME_1 ?? '')
    setConMsg(null)
    setConCreateOpen(true)
  }
  function submitConCreate(e: React.FormEvent) {
    e.preventDefault()
    setConMsg(null)
    if (!conForm.first_name || !conForm.last_name || !conForm.salutation_id || !conForm.gender_id || !conForm.address_id) {
      setConMsg({ text: 'Bitte alle Pflichtfelder ausfüllen', type: 'error' }); return
    }
    createConMut.mutate(conForm)
  }
  function openConEdit(c: Contact) {
    setConEditForm(contactToPayload(c))
    setConEditAddrText(c.ADDRESS ?? address?.ADDRESS_NAME_1 ?? '')
    setConEditMsg(null)
    setEditContact(c)
  }
  function submitConEdit(e: React.FormEvent) {
    e.preventDefault()
    if (!editContact) return
    setConEditMsg(null)
    updateConMut.mutate({ conId: editContact.ID, body: conEditForm })
  }
  function handleDeleteContact(c: Contact) {
    setConfirmState({
      title: 'Kontakt löschen',
      message: `${c.FIRST_NAME} ${c.LAST_NAME} wirklich löschen?`,
      onConfirm: () => deleteConMut.mutate(c.ID),
    })
  }

  const setCK  = useCallback((k: keyof ContactPayload) => (v: string) => setConForm(f => ({ ...f, [k]: v })), [])
  const setCEK = useCallback((k: keyof ContactPayload) => (v: string) => setConEditForm(f => ({ ...f, [k]: v })), [])
  const setCPrimary  = useCallback((v: boolean) => setConForm(f => ({ ...f, is_primary: v })), [])
  const setCEPrimary = useCallback((v: boolean) => setConEditForm(f => ({ ...f, is_primary: v })), [])

  useCtrlS(() => editFormRef.current?.requestSubmit(),  editOpen)
  useCtrlS(() => conCreateRef.current?.requestSubmit(), conCreateOpen)
  useCtrlS(() => conEditRef.current?.requestSubmit(),   editContact !== null)

  const contacts = detail?.contacts ?? []
  const sortedContacts = useMemo(
    () => [...contacts].sort((a, b) => (Number(b.IS_PRIMARY) - Number(a.IS_PRIMARY)) || `${a.LAST_NAME}`.localeCompare(`${b.LAST_NAME}`, 'de')),
    [contacts],
  )

  if (isLoading) return <div className="master-page"><p className="empty-note">Laden …</p></div>
  if (isError || !address) return (
    <div className="master-page">
      <button className="link-cell" onClick={() => navigate('/adressen')} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><ArrowLeft size={14} /> Zurück</button>
      <p className="empty-note">Adresse nicht gefunden.</p>
    </div>
  )

  const typeLabel = addressTypeLabel(address.ADDRESS_TYPE)

  return (
    <div className="master-page">
      <div style={{ marginBottom: 8 }}>
        <button className="link-cell" onClick={() => navigate('/adressen')} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <ArrowLeft size={14} /> Adressen
        </button>
      </div>
      <div className="master-page-header" style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <h1 className="master-page-title" style={{ margin: 0 }}>{address.ADDRESS_NAME_1}</h1>
        {typeLabel && (
          <span style={{ fontSize: 12, fontWeight: 600, padding: '2px 10px', borderRadius: 999, background: 'var(--surface-2, #f3f4f6)', color: 'var(--text-muted, #4b5563)' }}>
            {typeLabel}
          </span>
        )}
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          <Can permission="addresses.edit">
            <button className="btn-primary" onClick={openEdit} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <Pencil size={14} strokeWidth={2} /> Bearbeiten
            </button>
          </Can>
          <Can permission="addresses.delete">
            <button className="row-action-btn" style={{ color: '#dc2626', borderColor: '#dc2626' }}
              title="Adresse löschen"
              onClick={() => setConfirmState({
                title: 'Adresse löschen',
                message: `„${address.ADDRESS_NAME_1}" wirklich löschen?`,
                onConfirm: () => deleteAddrMut.mutate(),
              })}>
              <Trash2 size={14} strokeWidth={2} />
            </button>
          </Can>
        </div>
      </div>

      <Card title="Stammdaten">
        <InfoRow label="Name 2">{address.ADDRESS_NAME_2}</InfoRow>
        <InfoRow label="Straße">{address.STREET}</InfoRow>
        <InfoRow label="Postfach">{address.POST_OFFICE_BOX}</InfoRow>
        <InfoRow label="PLZ / Ort">{[address.POST_CODE, address.CITY].filter(Boolean).join(' ')}</InfoRow>
        <InfoRow label="Land">{address.COUNTRY}</InfoRow>
        <InfoRow label="Telefon">{address.PHONE && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><Phone size={13} /><a href={`tel:${address.PHONE}`}>{address.PHONE}</a></span>}</InfoRow>
        <InfoRow label="E-Mail">{address.EMAIL && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><Mail size={13} /><a href={`mailto:${address.EMAIL}`}>{address.EMAIL}</a></span>}</InfoRow>
        <InfoRow label="Website">{address.WEBSITE && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><Globe size={13} /><a href={address.WEBSITE.startsWith('http') ? address.WEBSITE : `https://${address.WEBSITE}`} target="_blank" rel="noreferrer">{address.WEBSITE}</a></span>}</InfoRow>
        <InfoRow label="Kundennr.">{address.CUSTOMER_NUMBER}</InfoRow>
        <InfoRow label="USt-IdNr.">{address.TAX_ID}</InfoRow>
        <InfoRow label="Steuernummer">{address.TAX_NUMBER}</InfoRow>
        <InfoRow label="Käuferreferenz">{address.BUYER_REFERENCE}</InfoRow>
        <InfoRow label="Peppol-Endpoint">{address.PEPPOL_ENDPOINT_ID && `${address.PEPPOL_ENDPOINT_ID}${address.PEPPOL_SCHEME_ID ? ` (${address.PEPPOL_SCHEME_ID})` : ''}`}</InfoRow>
        <InfoRow label="Notizen">{address.NOTES}</InfoRow>
      </Card>

      <Card
        title={`Kontakte (${contacts.length})`}
        action={
          <Can permission="addresses.contacts.create">
            <button className="btn-small" onClick={openConCreate} style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
              <Plus size={14} strokeWidth={2.25} /> Kontakt
            </button>
          </Can>
        }
      >
        {contacts.length === 0 ? (
          <p className="empty-note" style={{ margin: 0 }}>Noch keine Kontakte zu dieser Adresse.</p>
        ) : (
          <table className="master-table">
            <thead>
              <tr><th>Name</th><th>Funktion</th><th>E-Mail</th><th>Telefon</th><th></th></tr>
            </thead>
            <tbody>
              {sortedContacts.map(c => (
                <tr key={c.ID}>
                  <td>
                    {!!c.IS_PRIMARY && <Star size={12} strokeWidth={2} fill="currentColor" style={{ color: '#f59e0b', marginRight: 4, verticalAlign: 'middle' }} aria-label="Hauptansprechpartner" />}
                    {c.TITLE ? `${c.TITLE} ` : ''}{c.FIRST_NAME} {c.LAST_NAME}
                  </td>
                  <td>{c.POSITION ?? '—'}{c.DEPARTMENT ? ` · ${c.DEPARTMENT}` : ''}</td>
                  <td>{c.EMAIL ? <a href={`mailto:${c.EMAIL}`}>{c.EMAIL}</a> : '—'}</td>
                  <td>{c.MOBILE || c.PHONE || '—'}</td>
                  <td className="doc-actions">
                    <button className="row-action-btn" title="Als vCard exportieren"
                      onClick={() => downloadText(`${c.FIRST_NAME}_${c.LAST_NAME}.vcf`.replace(/\s+/g, '_'), contactVCard(c), 'text/vcard')}>
                      <Download size={14} strokeWidth={2} />
                    </button>
                    <Can permission="addresses.contacts.edit">
                      <button className="row-action-btn" onClick={() => openConEdit(c)} title="Bearbeiten"><Pencil size={14} strokeWidth={2} /></button>
                    </Can>
                    <Can permission="addresses.contacts.delete">
                      <button className="row-action-btn" style={{ color: '#dc2626', borderColor: '#dc2626' }} onClick={() => handleDeleteContact(c)} title="Löschen"><Trash2 size={14} strokeWidth={2} /></button>
                    </Can>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      {(detail!.projects.length + detail!.offers.length + detail!.invoices.length + detail!.partials.length) > 0 && (
        <Card title="Verknüpfungen">
          <LinkList items={detail!.projects} icon={<FolderOpen size={14} />} label="Projekte"
            render={p => p.NAME_SHORT || p.NAME_LONG || `#${p.ID}`} onClick={p => navigate('/projekte', { state: { projectId: p.ID } })} />
          <LinkList items={detail!.offers} icon={<FileSignature size={14} />} label="Angebote"
            render={o => o.NAME_SHORT || `#${o.ID}`} onClick={o => navigate('/angebote', { state: { offerId: o.ID } })} />
          <LinkList items={detail!.invoices} icon={<Receipt size={14} />} label="Rechnungen"
            render={i => i.INVOICE_NUMBER || `#${i.ID}`} onClick={() => navigate('/rechnungen')} />
          <LinkList items={detail!.partials} icon={<Banknote size={14} />} label="Abschläge"
            render={p => p.PARTIAL_PAYMENT_NUMBER || `#${p.ID}`} onClick={() => navigate('/rechnungen')} />
        </Card>
      )}

      {/* Adresse bearbeiten */}
      <Modal open={editOpen} onClose={() => setEditOpen(false)} title="Adresse bearbeiten">
        <form ref={editFormRef} onSubmit={submitEdit} className="master-form">
          <AddrForm vals={editForm} setK={setEK} msg={editMsg} countries={countries} />
          <div className="modal-actions">
            <button className="btn-primary" type="submit" disabled={updateAddrMut.isPending}>{updateAddrMut.isPending ? 'Speichert …' : 'Speichern'}</button>
            <button type="button" onClick={() => setEditOpen(false)}>Abbrechen</button>
          </div>
        </form>
      </Modal>

      {/* Kontakt anlegen */}
      <Modal open={conCreateOpen} onClose={() => setConCreateOpen(false)} title="Neuer Kontakt">
        <form ref={conCreateRef} onSubmit={submitConCreate} className="master-form">
          <ContactForm vals={conForm} setK={setCK} onPrimaryChange={setCPrimary} addrTxt={conAddrText} setAddrTxt={setConAddrText}
            msg={conMsg} salutations={salutations} genders={genders} searchAddresses={searchAddresses} />
          <div className="modal-actions">
            <button className="btn-primary" type="submit" disabled={createConMut.isPending}>{createConMut.isPending ? 'Speichert …' : 'Speichern'}</button>
            <button type="button" onClick={() => setConCreateOpen(false)}>Schließen</button>
          </div>
        </form>
      </Modal>

      {/* Kontakt bearbeiten */}
      <Modal open={editContact !== null} onClose={() => setEditContact(null)} title="Kontakt bearbeiten">
        <form ref={conEditRef} onSubmit={submitConEdit} className="master-form">
          <ContactForm vals={conEditForm} setK={setCEK} onPrimaryChange={setCEPrimary} addrTxt={conEditAddrText} setAddrTxt={setConEditAddrText}
            msg={conEditMsg} isEdit salutations={salutations} genders={genders} searchAddresses={searchAddresses} />
          <div className="modal-actions">
            <button className="btn-primary" type="submit" disabled={updateConMut.isPending}>{updateConMut.isPending ? 'Speichert …' : 'Speichern'}</button>
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
    </div>
  )
}
