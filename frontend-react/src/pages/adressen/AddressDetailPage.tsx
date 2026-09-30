import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Pencil, Trash2, Plus, Download, Star, Mail, Phone, Globe,
  FolderOpen, FileSignature, Receipt, Banknote, FileText, FilePlus2, Layers,
} from 'lucide-react'
import { groupHref } from '@/pages/projekte/gesamtprojekt/gesamtprojektUi'
import { PageHeader } from '@/components/ui/PageHeader'
import { Tabs } from '@/components/ui/Tabs'
import { RowMenu } from '@/components/ui/RowMenu'
import { ActionBar } from '@/components/ui/ActionBar'
import { Message } from '@/components/ui/Message'
import { DirtyGuardProvider } from '@/components/ui/DirtyGuard'
import { useGuardedAction, useRegisterDirty } from '@/hooks/useDirtyGuard'
import { useConfirm } from '@/hooks/useConfirm'
import { useCtrlS } from '@/hooks/useCtrlS'
import { useIsNarrow } from '@/hooks/useIsNarrow'
import { usePermission } from '@/store/permissionsStore'
import { useToast } from '@/store/toastStore'
import { trackRecent } from '@/api/recents'
import { angebotHref } from '@/pages/angebote/angebotUrlState'
import { addressToPayload } from '@/pages/adressen/addressForms'
import { AddressFields, missingAddressFields, type AddressField } from '@/pages/adressen/AddressFields'
import { ContactDialog, type ContactDialogState } from '@/pages/adressen/ContactDialog'
import { downloadText, contactVCard } from '@/utils/exportData'
import {
  fetchAddressDetail, fetchCountries, updateAddress, deleteAddress, deleteContact,
  addressTypeLabel,
  type Address, type AddressDetail, type AddressPayload, type Contact,
} from '@/api/stammdaten'

/**
 * Adresse als Arbeitsbereich (UI-Pilot Runde 8) — im Muster von Projekt und
 * Angebot: Kopf mit dem, was man am häufigsten sucht (Anschrift, Telefon,
 * E-Mail), darunter Reiter, deren Stand in der URL steht
 * (/adressen/:id?tab=kontakte|daten|verwendung).
 *
 * Vorher: eine Leseansicht, bearbeitet wurde im Dialog — ohne Rückfrage beim
 * Schließen, ohne Hinweis, welche Pflichtangabe fehlte. „Verknüpfungen"
 * zeigte nackte Nummern; Rechnungen und Abschläge waren dort wegen eines
 * Serverfehlers immer leer. Am Handy lief die Kontakttabelle aus dem Bild.
 */

type AdrTab = 'kontakte' | 'daten' | 'verwendung'
const TABS: AdrTab[] = ['kontakte', 'daten', 'verwendung']

const FMT_DATE = new Intl.DateTimeFormat('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' })
const fmtDate = (d?: string | null) => (d ? FMT_DATE.format(new Date(d)) : null)

const webHref = (w: string) => (/^https?:\/\//i.test(w) ? w : `https://${w}`)

export function AddressDetailPage() {
  return (
    <DirtyGuardProvider>
      <AddressDetailInner />
    </DirtyGuardProvider>
  )
}

function AddressDetailInner() {
  const { id: idParam } = useParams<{ id: string }>()
  const id = Number(idParam)
  const navigate = useNavigate()
  const guarded = useGuardedAction()
  const [params, setParams] = useSearchParams()

  const { data, isLoading, isError } = useQuery({
    queryKey: ['address-detail', id],
    queryFn: () => fetchAddressDetail(id),
    enabled: Number.isFinite(id) && id > 0,
  })
  const detail = data?.data
  const address = detail?.address

  // Zuletzt verwendet — vorher nur beim Öffnen des Bearbeiten-Dialogs der Liste
  useEffect(() => {
    if (address) void trackRecent('address', address.ID, address.ADDRESS_NAME_1 ?? `#${address.ID}`).catch(() => {})
  }, [address?.ID]) // eslint-disable-line react-hooks/exhaustive-deps

  const visible = detail?.visible ?? {}
  const showContacts = visible.contacts !== false
  const tabs = useMemo(() => {
    const usedCount = detail ? countLinks(detail) : 0
    return [
      ...(showContacts ? [{ id: 'kontakte', label: `Kontakte (${detail?.contacts.length ?? 0})` }] : []),
      { id: 'daten', label: 'Adressdaten' },
      { id: 'verwendung', label: `Verwendet in (${usedCount})` },
    ]
  }, [detail, showContacts])

  const raw = params.get('tab') as AdrTab | null
  const tab: AdrTab = raw && TABS.includes(raw) && (raw !== 'kontakte' || showContacts) ? raw : (showContacts ? 'kontakte' : 'daten')
  const setTab = (t: string) => guarded(() => setParams(t === 'kontakte' ? {} : { tab: t }))

  if (isLoading) return <div className="master-page"><p className="empty-note">Lädt …</p></div>
  if (isError || !address || !detail) return (
    <div className="master-page">
      <PageHeader title="Adresse nicht gefunden" back={{ label: 'Adressen', onClick: () => navigate('/adressen') }} />
      <p className="empty-note">Diese Adresse gibt es nicht (mehr), oder sie ließ sich nicht laden.</p>
    </div>
  )

  return (
    <div className="master-page">
      <AddressHeader address={address} onBack={() => guarded(() => navigate('/adressen'))} contacts={detail.contacts} />
      <Tabs tabs={tabs} active={tab} onChange={setTab} />
      <div className="master-tab-content">
        {tab === 'kontakte'   && <KontakteTab address={address} contacts={detail.contacts} />}
        {tab === 'daten'      && <DatenTab key={address.ID} address={address} />}
        {tab === 'verwendung' && <VerwendungTab detail={detail} />}
      </div>
    </div>
  )
}

function countLinks(d: AddressDetail) {
  return d.projects.length + d.offers.length + (d.contracts?.length ?? 0) + d.invoices.length + d.partials.length + (d.nachtraege?.length ?? 0)
}

// ── Kopf ────────────────────────────────────────────────────────────────────

function AddressHeader({ address, contacts, onBack }: { address: Address; contacts: Contact[]; onBack: () => void }) {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const toast = useToast()
  const canDelete = usePermission('addresses.delete')
  const [confirm, confirmDialog] = useConfirm()
  const typeLabel = addressTypeLabel(address.ADDRESS_TYPE)
  const street = [address.STREET, address.POST_OFFICE_BOX && `Postfach ${address.POST_OFFICE_BOX}`].filter(Boolean).join(', ')
  const place = [address.POST_CODE, address.CITY].filter(Boolean).join(' ')

  async function remove() {
    const ok = await confirm({
      title: 'Adresse löschen?',
      message: `„${address.ADDRESS_NAME_1}" wird gelöscht. Wird sie noch verwendet (Kontakte, Projekte, Rechnungen …), lehnt plan&simple das ab und sagt, wo.`,
      confirmLabel: 'Löschen',
    })
    if (!ok) return
    try {
      await deleteAddress(address.ID)
      void qc.invalidateQueries({ queryKey: ['addresses'] })
      toast.success(`${address.ADDRESS_NAME_1} gelöscht.`)
      navigate('/adressen')
    } catch (e) {
      toast.error((e as Error)?.message || 'Löschen fehlgeschlagen')
    }
  }

  function exportVCards() {
    const cards = contacts.map(c => contactVCard({ ...c, ADDRESS: address.ADDRESS_NAME_1 })).join('\r\n')
    downloadText(`${address.ADDRESS_NAME_1}.vcf`.replace(/[^\wÄÖÜäöüß.-]+/g, '_'), cards, 'text/vcard')
  }

  return (
    <>
      <PageHeader
        className="ad-header"
        back={{ label: 'Adressen', onClick: onBack }}
        eyebrow={<>
          {address.CUSTOMER_NUMBER && <span>Kd.-Nr. {address.CUSTOMER_NUMBER}</span>}
          {typeLabel && <span className="status-pill">{typeLabel}</span>}
        </>}
        title={address.ADDRESS_NAME_1}
        meta={<>
          {address.ADDRESS_NAME_2 && <span>{address.ADDRESS_NAME_2}</span>}
          {(street || place) && <span>{[street, place, address.COUNTRY && address.COUNTRY !== 'Deutschland' ? address.COUNTRY : null].filter(Boolean).join(' · ')}</span>}
          {address.PHONE && <a className="ad-meta-link" href={`tel:${address.PHONE}`}><Phone size={13} strokeWidth={1.75} aria-hidden="true" />{address.PHONE}</a>}
          {address.EMAIL && <a className="ad-meta-link" href={`mailto:${address.EMAIL}`}><Mail size={13} strokeWidth={1.75} aria-hidden="true" />{address.EMAIL}</a>}
          {address.WEBSITE && <a className="ad-meta-link" href={webHref(address.WEBSITE)} target="_blank" rel="noreferrer"><Globe size={13} strokeWidth={1.75} aria-hidden="true" />{address.WEBSITE}</a>}
        </>}
        actions={
          <RowMenu label="Weitere Aktionen zur Adresse" triggerClassName="btn-secondary pw-more-btn">
            {contacts.length > 0 && (
              <button type="button" role="menuitem" className="row-menu-item" onClick={exportVCards}>
                <Download size={13} strokeWidth={1.75} style={{ marginRight: 8 }} aria-hidden="true" />Alle Kontakte als vCard
              </button>
            )}
            {canDelete && (
              <button type="button" role="menuitem" className="row-menu-item danger" onClick={() => void remove()}>
                <Trash2 size={13} strokeWidth={1.75} style={{ marginRight: 8 }} aria-hidden="true" />Adresse löschen
              </button>
            )}
          </RowMenu>
        }
      />
      {confirmDialog}
    </>
  )
}

// ── Reiter Kontakte ─────────────────────────────────────────────────────────

function KontakteTab({ address, contacts }: { address: Address; contacts: Contact[] }) {
  const qc = useQueryClient()
  const toast = useToast()
  const narrow = useIsNarrow()
  const canCreate = usePermission('addresses.contacts.create')
  const canEdit   = usePermission('addresses.contacts.edit')
  const canDelete = usePermission('addresses.contacts.delete')
  const [dialog, setDialog] = useState<ContactDialogState>(null)
  const [confirm, confirmDialog] = useConfirm()

  const sorted = useMemo(
    () => [...contacts].sort((a, b) => (Number(b.IS_PRIMARY) - Number(a.IS_PRIMARY)) || `${a.LAST_NAME}`.localeCompare(`${b.LAST_NAME}`, 'de')),
    [contacts],
  )
  const fullName = (c: Contact) => `${c.TITLE ? `${c.TITLE} ` : ''}${c.FIRST_NAME} ${c.LAST_NAME}`.trim()
  const vcard = (c: Contact) => downloadText(`${c.FIRST_NAME}_${c.LAST_NAME}.vcf`.replace(/\s+/g, '_'), contactVCard({ ...c, ADDRESS: address.ADDRESS_NAME_1 }), 'text/vcard')

  async function remove(c: Contact) {
    const ok = await confirm({ title: 'Kontakt löschen?', message: `${fullName(c)} wird gelöscht.`, confirmLabel: 'Löschen' })
    if (!ok) return
    try {
      await deleteContact(c.ID)
      void qc.invalidateQueries({ queryKey: ['address-detail', address.ID] })
      void qc.invalidateQueries({ queryKey: ['contacts'] })
      void qc.invalidateQueries({ queryKey: ['contacts-by-address'] })
      toast.success(`${fullName(c)} gelöscht.`)
    } catch (e) {
      toast.error((e as Error)?.message || 'Löschen fehlgeschlagen')
    }
  }

  const openNew = () => setDialog({ mode: 'new', addressId: address.ID, addressName: address.ADDRESS_NAME_1 })
  const actions = (c: Contact) => (
    <>
      <button type="button" className="row-action-btn" onClick={() => vcard(c)} title="Als vCard speichern" aria-label={`${fullName(c)} als vCard speichern`}>
        <Download size={14} strokeWidth={2} aria-hidden="true" />
      </button>
      {canEdit && (
        <button type="button" className="row-action-btn" onClick={() => setDialog({ mode: 'edit', contact: { ...c, ADDRESS: address.ADDRESS_NAME_1 } })}
          title="Bearbeiten" aria-label={`${fullName(c)} bearbeiten`}>
          <Pencil size={14} strokeWidth={2} aria-hidden="true" />
        </button>
      )}
      {canDelete && (
        <button type="button" className="row-action-btn row-action-btn--danger" onClick={() => void remove(c)}
          title="Löschen" aria-label={`${fullName(c)} löschen`}>
          <Trash2 size={14} strokeWidth={2} aria-hidden="true" />
        </button>
      )}
    </>
  )
  const primary = (c: Contact) => !!c.IS_PRIMARY && (
    <span className="ad-primary"><Star size={12} strokeWidth={2} fill="currentColor" aria-hidden="true" />Hauptansprechpartner</span>
  )
  const phones = (c: Contact) => [c.MOBILE, c.PHONE].filter((p): p is string => !!p)

  return (
    <div>
      {canCreate && contacts.length > 0 && (
        <div className="ad-toolbar">
          <button type="button" className="btn-primary btn-small" onClick={openNew}>
            <Plus size={14} strokeWidth={2.25} aria-hidden="true" /> Kontakt hinzufügen
          </button>
        </div>
      )}

      {contacts.length === 0 ? (
        <div className="empty-block">
          <p className="empty-note">Zu dieser Adresse gibt es noch keine Kontakte.</p>
          <p className="empty-block-why">Ansprechpartner stehen auf Angeboten und Rechnungen als Empfänger und lassen sich in Projekten und Verträgen auswählen.</p>
          {canCreate && (
            <button type="button" className="btn-primary" onClick={openNew}>
              <Plus size={15} strokeWidth={2.25} aria-hidden="true" /> Kontakt hinzufügen
            </button>
          )}
        </div>
      ) : narrow ? (
        <ul className="ad-cards" aria-label="Kontakte">
          {sorted.map(c => (
            <li key={c.ID} className="ad-card">
              <div className="ad-card-top">
                <div className="ad-card-main">
                  <span className="ad-card-name">{fullName(c)}</span>
                  {primary(c)}
                  {(c.POSITION || c.DEPARTMENT) && <span className="ad-card-sub">{[c.POSITION, c.DEPARTMENT].filter(Boolean).join(' · ')}</span>}
                </div>
                <div className="ad-card-actions">{actions(c)}</div>
              </div>
              <div className="ad-card-links">
                {c.EMAIL && <a href={`mailto:${c.EMAIL}`}><Mail size={14} strokeWidth={1.75} aria-hidden="true" />{c.EMAIL}</a>}
                {phones(c).map(p => <a key={p} href={`tel:${p}`}><Phone size={14} strokeWidth={1.75} aria-hidden="true" />{p}</a>)}
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <div className="list-section ad-list">
          <table className="master-table ad-table">
            <thead>
              <tr>
                <th scope="col">Name</th>
                <th scope="col">E-Mail</th>
                <th scope="col">Telefon</th>
                <th scope="col" className="doc-actions"><span className="sr-only">Aktionen</span></th>
              </tr>
            </thead>
            <tbody>
              {sorted.map(c => (
                <tr key={c.ID}>
                  <td>
                    <div className="ad-name">{fullName(c)}{primary(c)}</div>
                    {(c.POSITION || c.DEPARTMENT) && <div className="ad-sub">{[c.POSITION, c.DEPARTMENT].filter(Boolean).join(' · ')}</div>}
                    {c.NOTES && <div className="ad-sub ad-notes">{c.NOTES}</div>}
                  </td>
                  <td>{c.EMAIL ? <a href={`mailto:${c.EMAIL}`}>{c.EMAIL}</a> : '—'}</td>
                  <td>{phones(c).length ? phones(c).map(p => <div key={p}><a href={`tel:${p}`}>{p}</a></div>) : '—'}</td>
                  <td className="doc-actions">{actions(c)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <ContactDialog state={dialog} onClose={() => setDialog(null)} />
      {confirmDialog}
    </div>
  )
}

// ── Reiter Adressdaten ──────────────────────────────────────────────────────

const FIELDS: AddressField[] = [
  'address_name_1', 'address_name_2', 'address_type', 'street', 'post_office_box', 'post_code', 'city', 'country_id',
  'phone', 'email', 'website', 'customer_number', 'tax_id', 'tax_number',
  'buyer_reference', 'peppol_endpoint_id', 'peppol_scheme_id', 'notes',
]

function DatenTab({ address }: { address: Address }) {
  const qc = useQueryClient()
  const canEdit = usePermission('addresses.edit')
  const [confirm, confirmDialog] = useConfirm()
  const { data: countriesData } = useQuery({ queryKey: ['countries'], queryFn: fetchCountries })
  const [edits, setEdits] = useState<Partial<AddressPayload>>({})
  const [invalid, setInvalid] = useState<string[]>([])
  const [pending, setPending] = useState(false)
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  const saved = useMemo(() => addressToPayload(address), [address])
  const form: AddressPayload = { ...saved, ...edits }
  const changed = FIELDS.filter(k => String(form[k] ?? '') !== String(saved[k] ?? '')).length
  const dirty = changed > 0

  const set = (k: AddressField, v: string) => { setEdits(e => ({ ...e, [k]: v })); setMsg(null) }

  async function save() {
    const missing = missingAddressFields(form)
    setInvalid(missing)
    if (missing.length) {
      const text = `Bitte noch angeben: ${missing.join(', ')}.`
      setMsg({ type: 'error', text })
      throw new Error(text)
    }
    setPending(true)
    setMsg(null)
    try {
      await updateAddress(address.ID, form)
      await qc.invalidateQueries({ queryKey: ['address-detail', address.ID] })
      void qc.invalidateQueries({ queryKey: ['addresses'] })
      void qc.invalidateQueries({ queryKey: ['contacts'] })
      setEdits({})
      setMsg({ type: 'success', text: 'Adresse gespeichert. Neue Angebote und Rechnungen übernehmen die Anschrift; gestellte Belege bleiben, wie sie sind.' })
    } catch (e) {
      setMsg({ type: 'error', text: (e as Error)?.message || 'Speichern fehlgeschlagen' })
      throw e
    } finally {
      setPending(false)
    }
  }

  async function discard() {
    const ok = await confirm({
      title: 'Änderungen verwerfen?',
      message: `${changed === 1 ? '1 Änderung geht' : `${changed} Änderungen gehen`} verloren. Die Adresse bleibt, wie sie gespeichert ist.`,
      confirmLabel: 'Verwerfen',
    })
    if (ok) { setEdits({}); setMsg(null); setInvalid([]) }
  }

  useRegisterDirty('adresse', { dirty, label: 'Adressdaten', count: changed, save })
  useCtrlS(() => { if (dirty && !pending) void save().catch(() => {}) }, canEdit)

  const status = pending ? 'Speichert …' : dirty ? `${changed} ${changed === 1 ? 'Feld' : 'Felder'} geändert` : 'Keine Änderungen'

  return (
    <div className="ws-form">
      {!canEdit && <p className="ws-form-readonly">Nur Lesen — zum Ändern fehlt das Recht „Adressen bearbeiten".</p>}
      <fieldset className="ws-form-fields" disabled={!canEdit || pending}>
        <legend className="sr-only">Adressdaten</legend>
        <AddressFields vals={form} set={set} countries={countriesData?.data ?? []} prefix="ad" invalid={invalid} />
      </fieldset>
      <Message type={msg?.type ?? 'info'} text={msg?.text ?? null} />
      {canEdit && (
        <ActionBar
          dirty={dirty}
          quiet={!dirty && !pending}
          status={status}
          secondary={dirty ? <button type="button" className="btn-secondary" onClick={() => void discard()} disabled={pending}>Verwerfen</button> : undefined}
        >
          <button type="button" className="btn-primary" onClick={() => void save().catch(() => {})} disabled={!dirty || pending}>
            {pending ? 'Speichert …' : 'Speichern'}
          </button>
        </ActionBar>
      )}
      {confirmDialog}
    </div>
  )
}

// ── Reiter Verwendet in ─────────────────────────────────────────────────────

function VerwendungTab({ detail }: { detail: AddressDetail }) {
  const v = detail.visible ?? {}
  const groups: { key: string; title: string; icon: typeof FolderOpen; items: { id: number; to: string; state?: unknown; label: string; sub?: string | null }[] }[] = [
    { key: 'groups', title: 'Gesamtprojekte', icon: Layers,
      items: (detail.groups ?? []).map(g => ({ id: g.ID, to: groupHref(g.ID), label: g.ABBR || g.NAME, sub: g.ABBR ? g.NAME : null })) },
    { key: 'projects', title: 'Projekte (Auftraggeber)', icon: FolderOpen,
      items: detail.projects.map(p => ({
        id: p.ID, to: `/projekte?projectId=${p.ID}&tab=struktur`, label: p.ABBR || `#${p.ID}`,
        sub: [p.NAME, p.GROUP_NAME && `Teil von ${p.GROUP_NAME}`].filter(Boolean).join(' · ') || null,
      })) },
    { key: 'contracts', title: 'Verträge (Rechnungsempfänger)', icon: FileText,
      items: (detail.contracts ?? []).map(c => ({ id: c.ID, to: c.PROJECT_ID ? `/projekte?projectId=${c.PROJECT_ID}&tab=vertraege` : '/projekte', label: c.ABBR || `#${c.ID}`, sub: c.NAME })) },
    { key: 'offers', title: 'Angebote', icon: FileSignature,
      items: detail.offers.map(o => ({ id: o.ID, to: angebotHref(o.ID), label: o.ABBR || `#${o.ID}`, sub: o.NAME ?? null })) },
    { key: 'nachtraege', title: 'Nachträge', icon: FilePlus2,
      items: (detail.nachtraege ?? []).map(n => ({ id: n.ID, to: `/nachtraege/${n.ID}`, label: n.ABBR || `#${n.ID}`, sub: n.NAME })) },
    { key: 'invoices', title: 'Rechnungen', icon: Receipt,
      items: detail.invoices.map(i => ({ id: i.ID, to: '/rechnungen', state: { projectSearch: i.INVOICE_NUMBER ?? '' }, label: i.INVOICE_NUMBER || 'Entwurf', sub: fmtDate(i.INVOICE_DATE) })) },
    { key: 'partials', title: 'Abschlagsrechnungen', icon: Banknote,
      items: detail.partials.map(p => ({ id: p.ID, to: '/rechnungen', state: { projectSearch: p.ADVANCE_INVOICE_NUMBER ?? '' }, label: p.ADVANCE_INVOICE_NUMBER || 'Entwurf', sub: fmtDate(p.ADVANCE_INVOICE_DATE) })) },
  ]
  const shown = groups.filter(g => g.items.length > 0)
  const hidden = groups.filter(g => v[g.key as keyof typeof v] === false).map(g => g.title.replace(/ \(.*\)$/, ''))

  return (
    <div className="ad-usage">
      {shown.length === 0 ? (
        <div className="empty-block">
          <p className="empty-note">Diese Adresse wird noch nirgends verwendet.</p>
          <p className="empty-block-why">Sobald sie Auftraggeber eines Projekts, Empfänger eines Angebots oder einer Rechnung ist, steht das hier. Eine verwendete Adresse lässt sich nicht löschen.</p>
        </div>
      ) : (
        <div className="ad-usage-groups">
          {shown.map(g => {
            const Icon = g.icon
            return (
              <section key={g.key} className="ad-usage-group" aria-labelledby={`adu-${g.key}`}>
                <h3 id={`adu-${g.key}`} className="ad-usage-title"><Icon size={15} strokeWidth={1.75} aria-hidden="true" />{g.title} <span className="ad-usage-count">{g.items.length}</span></h3>
                <ul className="ad-usage-list">
                  {g.items.map(it => (
                    <li key={it.id}>
                      <Link to={it.to} state={it.state} className="ad-usage-link">
                        <span className="ad-usage-label">{it.label}</span>
                        {it.sub && <span className="ad-usage-sub">{it.sub}</span>}
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            )
          })}
        </div>
      )}
      {hidden.length > 0 && (
        <p className="ws-form-readonly">Ohne Recht zum Ansehen nicht aufgeführt: {hidden.join(', ')}.</p>
      )}
    </div>
  )
}
