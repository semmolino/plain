import { useCallback, useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Modal } from '@/components/ui/Modal'
import { DialogFooter } from '@/components/ui/DialogFooter'
import { Message } from '@/components/ui/Message'
import { useConfirm } from '@/hooks/useConfirm'
import { useCtrlS } from '@/hooks/useCtrlS'
import { presetNote, useContactPreset } from '@/hooks/useContactPreset'
import { useAuthStore } from '@/store/authStore'
import { useFeature } from '@/store/licenseStore'
import { useToast } from '@/store/toastStore'
import { presetId } from '@/utils/vorbelegung'
import { createOffer, fetchOfferStatuses } from '@/api/angebote'
import { fetchProjectManagers } from '@/api/projekte'
import { fetchCompanies, fetchContactsByAddress, fetchDefaults } from '@/api/stammdaten'
import { OfferFields, OFFER_FIELDS, missingOfferFields, offerPayload, type OfferForm } from './OfferFields'

/**
 * „Neues Angebot" (UI-Pilot Runde 9).
 *
 * Vorher derselbe lange Schritt wie in den Angebotsdaten — ohne verknüpfte
 * Beschriftungen, mit „Angebot anlegen →" als einzigem Knopf (kein Abbrechen,
 * Schließen verwarf alle Eingaben ohne Rückfrage) und einem zweiten Schritt
 * „HOAI-Kalkulationen", der nie erschien: nach dem Anlegen öffnete sich das
 * Angebot jedes Mal gleich. Kalkulationen stehen dort im eigenen Reiter.
 *
 * Vorbelegt wird wie bisher (Firma, Status, Gültigkeit, Texte aus den
 * Vorbelegungen), dazu „Zuständig" mit dem angemeldeten Mitarbeiter und der
 * Kontakt mit dem Hauptansprechpartner der gewählten Adresse.
 */

function todayIso() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
function addDays(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number)
  const t = new Date(y, m - 1, d + days)
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`
}

const EMPTY: OfferForm = {
  name: '', statusId: '', employeeId: '', companyId: '', offerDate: todayIso(), validUntil: '',
  probability: '', addressId: null, addrText: '', contactId: null, text1: '', text2: '',
}

export function AngebotAnlegenDialog({ open, onClose, onCreated }: {
  open:      boolean
  onClose:   () => void
  onCreated: (offerId: number) => void
}) {
  if (!open) return null
  return <AnlegenInner onClose={onClose} onCreated={onCreated} />
}

function AnlegenInner({ onClose, onCreated }: { onClose: () => void; onCreated: (offerId: number) => void }) {
  const qc = useQueryClient()
  const toast = useToast()
  const [confirm, confirmDialog] = useConfirm()
  const ownId = useAuthStore(s => s.employeeId)
  const multiCompany = useFeature('enterprise.multi_company')
  // Was der Nutzer selbst eingegeben hat — Vorbelegungen füllen nur, was hier fehlt.
  const [edits, setEdits] = useState<Partial<OfferForm>>({})
  const [invalid, setInvalid] = useState<string[]>([])
  const [err, setErr] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  const { data: statusData }  = useQuery({ queryKey: ['offer-statuses'],   queryFn: fetchOfferStatuses })
  const { data: mgrData }     = useQuery({ queryKey: ['project-managers'], queryFn: fetchProjectManagers })
  const { data: companyData } = useQuery({ queryKey: ['companies'],        queryFn: fetchCompanies })
  const { data: defData }     = useQuery({ queryKey: ['defaults'],         queryFn: fetchDefaults })
  const statuses  = statusData?.data  ?? []
  const managers  = mgrData?.data     ?? []
  const companies = companyData?.data ?? []
  const defs      = defData?.data     ?? {}

  // Vorbelegungen als Grundstand: sie laden nach und dürfen dann noch
  // einziehen, zählen aber nicht als Eingabe (Schließen fragt nur bei echten).
  const offerDate = edits.offerDate ?? EMPTY.offerDate
  const validDays = parseInt(defs.offer_valid_days ?? '', 10)
  const base: OfferForm = {
    ...EMPTY,
    companyId:  presetId(companies, defs.default_company_id)
      || (companies.length === 1 || !multiCompany ? String(companies[0]?.ID ?? '') : ''),
    statusId:   presetId(statuses, defs.default_offer_status_id),
    employeeId: ownId != null && managers.some(m => m.ID === ownId) ? String(ownId) : '',
    validUntil: Number.isFinite(validDays) && validDays > 0 ? addDays(offerDate || todayIso(), validDays) : '',
    text1:      defs.offer_text_1 ?? '',
    text2:      defs.offer_text_2 ?? '',
  }
  const form: OfferForm = { ...base, ...edits }
  const dirty = OFFER_FIELDS.some(k => edits[k] !== undefined && edits[k] !== base[k])

  const { data: contactData } = useQuery({
    queryKey: ['contacts-by-address', form.addressId],
    queryFn:  () => fetchContactsByAddress(form.addressId!),
    enabled:  form.addressId != null,
  })
  const contacts = form.addressId != null ? contactData?.data : []

  const set = useCallback(<K extends keyof OfferForm>(k: K, v: OfferForm[K]) => {
    setEdits(e => ({ ...e, [k]: v }))
    setErr(null)
  }, [])
  const applyContact = useCallback((id: number) => set('contactId', id), [set])
  const contactPreset = useContactPreset(form.addressId, contacts, applyContact)

  // Fehlermarkierung verschwindet, sobald das Feld gefüllt ist.
  const missing = missingOfferFields(form)
  useEffect(() => { setInvalid(v => v.filter(l => missing.includes(l))) }, [missing.join('|')]) // eslint-disable-line react-hooks/exhaustive-deps

  async function requestClose() {
    if (pending) return
    if (dirty && !(await confirm({ title: 'Eingaben verwerfen?', message: 'Das Angebot wird nicht angelegt.', confirmLabel: 'Verwerfen' }))) return
    onClose()
  }

  async function save() {
    if (pending) return
    setInvalid(missing)
    if (missing.length) { setErr(`Bitte noch angeben: ${missing.join(', ')}.`); return }
    if (!form.companyId) { setErr('Keine Firma hinterlegt — bitte unter Einstellungen → Firmen anlegen.'); return }
    setPending(true)
    setErr(null)
    try {
      const res = await createOffer({ ...offerPayload(form), company_id: Number(form.companyId) })
      void qc.invalidateQueries({ queryKey: ['offers'] })
      void qc.invalidateQueries({ queryKey: ['number-ranges'] })
      toast.success(res.data.ABBR ? `Angebot ${res.data.ABBR} angelegt.` : 'Angebot angelegt.')
      onClose()
      onCreated(res.data.ID)
    } catch (e) {
      setErr((e as Error)?.message || 'Anlegen fehlgeschlagen')
    } finally {
      setPending(false)
    }
  }

  useCtrlS(() => void save(), true)

  return (
    <>
      <Modal open onClose={() => void requestClose()} title="Neues Angebot" className="modal-wide">
        <div className="ad-create-body">
          <OfferFields
            form={form}
            set={set}
            onAddressSelect={(id, label) => {
              setEdits(e => ({ ...e, addressId: id, addrText: label, contactId: null }))
              setErr(null)
              contactPreset.arm(id)
            }}
            onAddressClear={() => { setEdits(e => ({ ...e, addressId: null, addrText: '', contactId: null })); contactPreset.arm(null) }}
            statuses={statuses}
            managers={managers}
            companies={companies}
            multiCompany={multiCompany}
            contacts={contacts ?? []}
            contactsLoaded={contacts !== undefined}
            contactNote={presetNote(contactPreset.preset, form.contactId)}
            prefix="on"
            invalid={invalid}
            compact
          />
          <Message type="error" text={err} />
          <DialogFooter>
            <button type="button" className="btn-secondary" onClick={() => void requestClose()} disabled={pending}>Abbrechen</button>
            <button type="button" className="btn-primary" onClick={() => void save()} disabled={pending}>
              {pending ? 'Legt an …' : 'Anlegen'}
            </button>
          </DialogFooter>
        </div>
      </Modal>
      {confirmDialog}
    </>
  )
}
