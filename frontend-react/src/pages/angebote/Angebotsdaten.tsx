import { useCallback, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { FolderOpen } from 'lucide-react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useCtrlS } from '@/hooks/useCtrlS'
import { useConfirm } from '@/hooks/useConfirm'
import { useRegisterDirty } from '@/hooks/useDirtyGuard'
import { presetNote, useContactPreset } from '@/hooks/useContactPreset'
import { usePermission } from '@/store/permissionsStore'
import { useFeature } from '@/store/licenseStore'
import { fetchOffer, fetchOfferStatuses, updateOffer, type Offer } from '@/api/angebote'
import { fetchProjectManagers } from '@/api/projekte'
import { fetchCompanies, fetchContactsByAddress } from '@/api/stammdaten'
import { ActionBar } from '@/components/ui/ActionBar'
import { FormSection } from '@/components/ui/FormSection'
import { Message } from '@/components/ui/Message'
import { OfferFields, OFFER_FIELDS, missingOfferFields, offerPayload, type OfferForm } from './OfferFields'

/**
 * Reiter „Angebotsdaten" (UI-Pilot Runde 9).
 *
 * Vorher: eine lange Spalte mit eigenem Speichern-Knopf und einem zweiten
 * Speicherstand oben, keine Rückfrage beim Verlassen — wer Titel und Texte
 * änderte und in die Struktur wechselte, verlor beides ohne Hinweis. Ein
 * geleerter Kontakt ging als 0 an den Server und endete als Serverfehler,
 * ein leerer Titel wurde gespeichert.
 *
 * Jetzt im Muster von Projektdaten und Vertrag: Eingaben liegen über dem
 * geladenen Stand, die Aktionsleiste zählt sie, Verlassen fragt nach. Ohne
 * `offers.edit` ist der Reiter lesbar statt unsichtbar.
 */

const idStr = (v: number | null | undefined) => (v == null ? '' : String(v))
const FMT_DATE = new Intl.DateTimeFormat('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' })
const deDate = (iso: string | null | undefined) => (iso ? FMT_DATE.format(new Date(iso.length === 10 ? `${iso}T00:00:00` : iso)) : null)

function formFrom(o: Offer): OfferForm {
  return {
    name:        o.NAME ?? '',
    statusId:    idStr(o.OFFER_STATUS_ID),
    employeeId:  idStr(o.EMPLOYEE_ID),
    companyId:   idStr(o.COMPANY_ID),
    offerDate:   o.OFFER_DATE?.slice(0, 10) ?? '',
    validUntil:  o.VALID_UNTIL?.slice(0, 10) ?? '',
    probability: o.PROBABILITY != null ? String(o.PROBABILITY).replace('.', ',') : '',
    addressId:   o.ADDRESS_ID ?? null,
    addrText:    o.ADDRESS_NAME ?? '',
    contactId:   o.CONTACT_ID ?? null,
    text1:       o.OFFER_TEXT_1 ?? '',
    text2:       o.OFFER_TEXT_2 ?? '',
  }
}

export function Angebotsdaten({ offerId }: { offerId: number }) {
  // Neuer Zustand je Angebot — offene Eingaben gehören zu genau einem Angebot.
  return <AngebotsdatenLaden key={offerId} offerId={offerId} />
}

function AngebotsdatenLaden({ offerId }: { offerId: number }) {
  const { data, isLoading, isError } = useQuery({ queryKey: ['offer', offerId], queryFn: () => fetchOffer(offerId) })
  if (isLoading) return <p className="ls-empty">Lädt …</p>
  if (isError)   return <Message type="error" text="Die Angebotsdaten konnten nicht geladen werden." />
  if (!data?.data) return <Message type="error" text="Dieses Angebot gibt es nicht (mehr)." />
  return <AngebotsdatenFormular offer={data.data} />
}

function AngebotsdatenFormular({ offer }: { offer: Offer }) {
  const qc = useQueryClient()
  const oid = offer.ID
  const canEdit = usePermission('offers.edit')
  const canViewProjects = usePermission('projects.view')
  const multiCompany = useFeature('enterprise.multi_company')
  const [confirm, confirmDialog] = useConfirm()
  const [edits, setEdits] = useState<Partial<OfferForm>>({})
  const [pending, setPending] = useState(false)
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [tried, setTried] = useState(false)

  const saved = useMemo(() => formFrom(offer), [offer])
  const form: OfferForm = { ...saved, ...edits }
  const changed = OFFER_FIELDS.filter(k => form[k] !== saved[k]).length
  const dirty = changed > 0
  const missing = missingOfferFields(form)

  const { data: statusData }  = useQuery({ queryKey: ['offer-statuses'],   queryFn: fetchOfferStatuses })
  const { data: mgrData }     = useQuery({ queryKey: ['project-managers'], queryFn: fetchProjectManagers })
  const { data: companyData } = useQuery({ queryKey: ['companies'],        queryFn: fetchCompanies })
  const { data: contactData } = useQuery({
    queryKey: ['contacts-by-address', form.addressId],
    queryFn:  () => fetchContactsByAddress(form.addressId!),
    enabled:  form.addressId != null,
  })
  const contacts = form.addressId != null ? contactData?.data : []

  const set = useCallback(<K extends keyof OfferForm>(k: K, v: OfferForm[K]) => {
    setEdits(e => ({ ...e, [k]: v }))
    setMsg(null)
  }, [])
  const applyContact = useCallback((id: number) => set('contactId', id), [set])
  const contactPreset = useContactPreset(form.addressId, contacts, applyContact)

  async function save() {
    setTried(true)
    if (missing.length) {
      const text = `Bitte noch angeben: ${missing.join(', ')}.`
      setMsg({ type: 'error', text })
      throw new Error(text)
    }
    setPending(true)
    setMsg(null)
    try {
      const res = await updateOffer(oid, offerPayload(form))
      // Der neue Stand ist sofort der gespeicherte — sonst zählte die Leiste
      // bis zum Nachladen weiter Änderungen.
      if (res.data) qc.setQueryData(['offer', oid], { data: { ...res.data, ADDRESS_NAME: form.addrText } })
      void qc.invalidateQueries({ queryKey: ['offer', oid] })
      void qc.invalidateQueries({ queryKey: ['offers'] })
      setEdits({})
      setTried(false)
      setMsg({ type: 'success', text: 'Angebotsdaten gespeichert.' })
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
      message: `${changed === 1 ? '1 Änderung geht' : `${changed} Änderungen gehen`} verloren. Das Angebot bleibt, wie es gespeichert ist.`,
      confirmLabel: 'Verwerfen',
    })
    if (ok) { setEdits({}); setMsg(null); setTried(false) }
  }

  useRegisterDirty('angebotsdaten', { dirty, label: 'Angebotsdaten', count: changed, save })
  useCtrlS(() => { if (dirty && !pending) void save().catch(() => {}) }, canEdit)

  const status = pending ? 'Speichert …'
    : dirty ? `${changed} ${changed === 1 ? 'Feld' : 'Felder'} geändert`
    : 'Keine Änderungen'
  const created = deDate(offer.CREATED_AT)
  const ordered = deDate(offer.ORDER_DATE)

  return (
    <div className="ws-form">
      {!canEdit && (
        <p className="ws-form-readonly">Nur Lesen — zum Ändern fehlt das Recht „Angebote bearbeiten".</p>
      )}

      <fieldset className="ws-form-fields" disabled={!canEdit || pending}>
        <legend className="sr-only">Angebotsdaten</legend>
        <OfferFields
          form={form}
          set={set}
          onAddressSelect={(id, label) => {
            setEdits(e => ({ ...e, addressId: id, addrText: label, contactId: null }))
            setMsg(null)
            contactPreset.arm(id)
          }}
          onAddressClear={() => { setEdits(e => ({ ...e, addressId: null, addrText: '', contactId: null })); contactPreset.arm(null) }}
          statuses={statusData?.data ?? []}
          managers={mgrData?.data ?? []}
          companies={companyData?.data ?? []}
          multiCompany={multiCompany}
          contacts={contacts ?? []}
          contactsLoaded={contacts !== undefined}
          contactNote={presetNote(contactPreset.preset, form.contactId)}
          prefix="od"
          invalid={tried ? missing : []}
        />
      </fieldset>

      <FormSection title="Stand">
        <dl className="ws-facts form-section-wide">
          {offer.ABBR && <div><dt>Angebotsnummer</dt><dd>{offer.ABBR}</dd></div>}
          {created && <div><dt>Angelegt am</dt><dd>{created}</dd></div>}
          <div><dt>Beauftragt</dt><dd>
            {offer.PROJECT_ID != null ? (
              <>
                {ordered ? `am ${ordered} · ` : ''}
                {canViewProjects ? (
                  <Link to={`/projekte?projectId=${offer.PROJECT_ID}&tab=struktur`} className="ws-facts-link">
                    <FolderOpen size={13} strokeWidth={1.75} aria-hidden="true" />
                    Projekt öffnen
                  </Link>
                ) : 'Projekt angelegt'}
              </>
            ) : ordered ? `am ${ordered}` : 'noch nicht'}
          </dd></div>
        </dl>
      </FormSection>

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
