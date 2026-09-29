import { useCallback } from 'react'
import { Autocomplete } from '@/components/ui/Autocomplete'
import { Disclosure } from '@/components/ui/Disclosure'
import { FormSection } from '@/components/ui/FormSection'
import { HelpHint } from '@/components/ui/HelpHint'
import { searchAddressesApi, type AddressContactOption } from '@/api/stammdaten'

/**
 * Felder eines Angebots (UI-Pilot Runde 9) — eine Stelle für den Reiter
 * „Angebotsdaten" und den Dialog „Neues Angebot".
 *
 * Vorher waren es zwei Kopien desselben langen Formulars ohne verknüpfte
 * Beschriftungen, und zweimal hieß ein Feld „Ansprechpartner": einmal die
 * Person im Büro, einmal die beim Kunden. Die Person im Büro heißt jetzt
 * „Zuständig" (im PDF steht sie weiter als Ansprechpartner), die beim Kunden
 * „Kontakt" — direkt unter der Adresse, zu der sie gehört.
 */

export interface OfferForm {
  name:        string
  statusId:    string
  employeeId:  string
  companyId:   string
  offerDate:   string
  validUntil:  string
  probability: string
  addressId:   number | null
  /** nur die Anzeige zu `addressId` */
  addrText:    string
  contactId:   number | null
  text1:       string
  text2:       string
}

/** Was als Änderung zählt — `addrText` gehört zu `addressId`. */
export const OFFER_FIELDS: (keyof OfferForm)[] = [
  'name', 'statusId', 'employeeId', 'companyId', 'offerDate', 'validUntil', 'probability',
  'addressId', 'contactId', 'text1', 'text2',
]

/** Pflichtfelder wie am Server (createOffer / updateOffer). */
export function missingOfferFields(f: OfferForm): string[] {
  const m: string[] = []
  if (!f.name.trim()) m.push('Angebotstitel')
  if (!f.statusId)    m.push('Status')
  if (!f.employeeId)  m.push('Zuständig')
  if (f.addressId == null) m.push('Adresse')
  if (f.contactId == null) m.push('Kontakt')
  const p = f.probability.trim()
  if (p && !(Number(p.replace(',', '.')) >= 0 && Number(p.replace(',', '.')) <= 100)) m.push('Wahrscheinlichkeit (0–100 %)')
  return m
}

/** Die Nutzlast für POST/PUT /angebote — gleiche Form für Anlegen und Ändern. */
export function offerPayload(f: OfferForm) {
  const p = f.probability.trim().replace(',', '.')
  return {
    name:            f.name.trim(),
    offer_status_id: Number(f.statusId),
    employee_id:     Number(f.employeeId),
    ...(f.companyId ? { company_id: Number(f.companyId) } : {}),
    address_id:      f.addressId ?? '',
    contact_id:      f.contactId ?? '',
    probability:     p === '' ? null : Number(p),
    offer_text_1:    f.text1 || null,
    offer_text_2:    f.text2 || null,
    offer_date:      f.offerDate || null,
    valid_until:     f.validUntil || null,
  }
}

type Opt = { ID: number; ABBR?: string | null }

export function OfferFields({
  form, set, onAddressSelect, onAddressClear,
  statuses, managers, companies, multiCompany, contacts, contactsLoaded = true, contactNote,
  prefix, invalid = [], compact = false,
}: {
  form:        OfferForm
  set:         <K extends keyof OfferForm>(k: K, v: OfferForm[K]) => void
  onAddressSelect: (id: number, label: string) => void
  onAddressClear:  () => void
  statuses:    Opt[]
  managers:    Opt[]
  companies:   { ID: number; COMPANY_NAME_1?: string | null }[]
  multiCompany: boolean
  contacts:    AddressContactOption[]
  /** false, solange die Kontakte der Adresse laden */
  contactsLoaded?: boolean
  /** „Vorbelegt: …" unter dem Kontakt */
  contactNote?: string | null
  /** id-Präfix — Reiter und Dialog können gleichzeitig im DOM sein */
  prefix:      string
  /** Pflichtfelder, die beim Speichern fehlten */
  invalid?:    string[]
  /** Dialog: Kopf- und Fußtext eingeklappt */
  compact?:    boolean
}) {
  const id = (k: string) => `${prefix}-${k}`
  const bad = (label: string) => (invalid.includes(label) ? true : undefined)

  const searchAddresses = useCallback(async (q: string) => {
    const res = await searchAddressesApi(q)
    return (res.data ?? []).map(a => ({ id: a.ID, label: a.ADDRESS_NAME_1 }))
  }, [])

  const texts = (
    <>
      <div className="form-group form-section-wide">
        <label htmlFor={id('t1')}>Kopftext</label>
        <textarea id={id('t1')} rows={4} value={form.text1} onChange={e => set('text1', e.target.value)}
          placeholder="Steht im PDF vor den Positionen, z. B. Anrede und Einleitung" />
      </div>
      <div className="form-group form-section-wide">
        <label htmlFor={id('t2')}>Fußtext</label>
        <textarea id={id('t2')} rows={4} value={form.text2} onChange={e => set('text2', e.target.value)}
          placeholder="Steht im PDF nach den Positionen, z. B. Zahlungsbedingungen und Gruß" />
      </div>
    </>
  )

  return (
    <>
      <FormSection title="Angebot">
        <div className="form-group form-section-wide">
          <label htmlFor={id('name')}>Angebotstitel*</label>
          <input id={id('name')} type="text" value={form.name} aria-invalid={bad('Angebotstitel')}
            onChange={e => set('name', e.target.value)} placeholder="z. B. Neubau Kita, Leistungsphasen 1–4" />
        </div>
        <div className="form-group">
          <label htmlFor={id('status')}>Status*</label>
          <select id={id('status')} value={form.statusId} aria-invalid={bad('Status')}
            onChange={e => set('statusId', e.target.value)}>
            <option value="">Bitte wählen …</option>
            {statuses.map(s => <option key={s.ID} value={s.ID}>{s.ABBR}</option>)}
          </select>
        </div>
        <div className="form-group">
          <label htmlFor={id('emp')}>Zuständig*</label>
          <select id={id('emp')} value={form.employeeId} aria-invalid={bad('Zuständig')} aria-describedby={id('emp-hint')}
            onChange={e => set('employeeId', e.target.value)}>
            <option value="">Bitte wählen …</option>
            {managers.map(m => <option key={m.ID} value={m.ID}>{m.ABBR}</option>)}
          </select>
          <p id={id('emp-hint')} className="form-field-hint">Steht im PDF als Ansprechpartner.</p>
        </div>
        {companies.length > 1 && (
          <div className="form-group">
            <label htmlFor={id('company')}>Firma</label>
            {/* Mehrere Firmen je Mandant sind ein Enterprise-Merkmal — ohne die
                Lizenz bleibt die Zuordnung sichtbar, aber unveränderlich. */}
            <select id={id('company')} value={form.companyId} disabled={!multiCompany}
              aria-describedby={multiCompany ? undefined : id('company-hint')}
              onChange={e => set('companyId', e.target.value)}>
              <option value="">Bitte wählen …</option>
              {companies.map(c => <option key={c.ID} value={c.ID}>{c.COMPANY_NAME_1}</option>)}
            </select>
            {!multiCompany && (
              <p id={id('company-hint')} className="form-field-hint">
                Dein Tarif sieht eine Firma je Mandant vor — es gilt die Vorbelegung aus Einstellungen → Vorbelegungen.
              </p>
            )}
          </div>
        )}
      </FormSection>

      <FormSection title="Termine und Aussicht">
        <div className="form-group">
          <label htmlFor={id('date')}>Angebotsdatum</label>
          <input id={id('date')} type="date" value={form.offerDate} onChange={e => set('offerDate', e.target.value)} />
        </div>
        <div className="form-group">
          <label htmlFor={id('valid')}>Gültig bis</label>
          <input id={id('valid')} type="date" value={form.validUntil} min={form.offerDate || undefined}
            onChange={e => set('validUntil', e.target.value)} />
        </div>
        <div className="form-group">
          <label htmlFor={id('prob')} className="ws-label-help">
            Wahrscheinlichkeit (%) <HelpHint id="offers.probability" size={13} />
          </label>
          <input id={id('prob')} type="text" inputMode="decimal" value={form.probability}
            aria-invalid={bad('Wahrscheinlichkeit (0–100 %)')}
            onChange={e => set('probability', e.target.value)} placeholder="z. B. 50" />
        </div>
      </FormSection>

      <FormSection title="Empfänger" hint="An wen das Angebot geht. Der Kontakt steht im PDF unter der Anschrift.">
        <Autocomplete
          label="Adresse*"
          htmlId={id('addr')}
          value={form.addrText}
          invalid={bad('Adresse')}
          onChange={t => (t ? set('addrText', t) : onAddressClear())}
          onSelect={(aid, label) => onAddressSelect(Number(aid), label)}
          search={searchAddresses}
          placeholder="Adresse suchen …"
        />
        <div className="form-group">
          <label htmlFor={id('contact')}>Kontakt*</label>
          <select id={id('contact')} value={form.contactId ?? ''} disabled={form.addressId == null}
            aria-invalid={bad('Kontakt')} aria-describedby={contactNote ? id('contact-hint') : undefined}
            onChange={e => set('contactId', e.target.value ? Number(e.target.value) : null)}>
            <option value="">{form.addressId == null ? 'Erst eine Adresse wählen' : 'Bitte wählen …'}</option>
            {contacts.map(c => (
              <option key={c.ID} value={c.ID}>
                {`${c.FIRST_NAME ?? ''} ${c.LAST_NAME ?? ''}`.trim()}{Number(c.IS_PRIMARY) === 1 ? ' (Hauptansprechpartner)' : ''}
              </option>
            ))}
          </select>
          {contactNote && <p id={id('contact-hint')} className="form-field-hint">{contactNote}</p>}
          {form.addressId != null && contactsLoaded && contacts.length === 0 && (
            <p className="form-field-hint">Diese Adresse hat noch keinen Kontakt — anlegen unter Adressen.</p>
          )}
        </div>
      </FormSection>

      {compact ? (
        <Disclosure title="Kopf- und Fußtext" className="ad-more">
          <div className="form-section-body">{texts}</div>
        </Disclosure>
      ) : (
        <FormSection title="Texte im PDF" hint="Der Kopftext steht vor den Positionen, der Fußtext danach.">
          {texts}
        </FormSection>
      )}
    </>
  )
}
