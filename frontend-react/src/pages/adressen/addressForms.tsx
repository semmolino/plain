import { FormField } from '@/components/ui/FormField'
import { Message }   from '@/components/ui/Message'
import { HelpHint }  from '@/components/ui/HelpHint'
import { Autocomplete } from '@/components/ui/Autocomplete'
import type { Address, Contact, AddressPayload, ContactPayload } from '@/api/stammdaten'
import { salutationForGender } from '@/utils/vorbelegung'

// ── Leere Formularwerte ─────────────────────────────────────────────────────

/** @param defaultCountryId Vorbelegung „Land" aus den Einstellungen ('' = keine). */
export function emptyAddr(defaultCountryId = ''): AddressPayload {
  return {
    address_name_1: '', address_name_2: '', street: '', post_office_box: '',
    post_code: '', city: '', country_id: defaultCountryId, address_type: '',
    phone: '', email: '', website: '',
    customer_number: '', tax_id: '', tax_number: '',
    buyer_reference: '', peppol_endpoint_id: '', peppol_scheme_id: '', notes: '', is_consumer: '',
  }
}

export function emptyContact(): ContactPayload {
  return {
    title: '', first_name: '', last_name: '', email: '', mobile: '', phone: '',
    position: '', department: '', salutation_id: '', gender_id: '', address_id: '',
    is_primary: false, notes: '',
  }
}

// Mapt eine geladene Adresse/Kontakt auf das editierbare Payload-Format.
export function addressToPayload(a: Address): AddressPayload {
  return {
    address_name_1:     a.ADDRESS_NAME_1  ?? '',
    address_name_2:     a.ADDRESS_NAME_2  ?? '',
    street:             a.STREET          ?? '',
    post_office_box:    a.POST_OFFICE_BOX ?? '',
    post_code:          a.POST_CODE       ?? '',
    city:               a.CITY            ?? '',
    country_id:         a.COUNTRY_ID      ?? '',
    address_type:       a.ADDRESS_TYPE != null ? String(a.ADDRESS_TYPE) : '',
    phone:              a.PHONE           ?? '',
    email:              a.EMAIL           ?? '',
    website:            a.WEBSITE         ?? '',
    customer_number:    a.CUSTOMER_NUMBER ?? '',
    tax_id:             a.TAX_ID          ?? '',
    tax_number:         a.TAX_NUMBER      ?? '',
    buyer_reference:    a.BUYER_REFERENCE ?? '',
    peppol_endpoint_id: a.PEPPOL_ENDPOINT_ID ?? '',
    peppol_scheme_id:   a.PEPPOL_SCHEME_ID   ?? '',
    notes:              a.NOTES           ?? '',
    is_consumer:        a.IS_CONSUMER ? 'true' : '',
  }
}

export function contactToPayload(c: Contact): ContactPayload {
  return {
    title:         c.TITLE         ?? '',
    first_name:    c.FIRST_NAME,
    last_name:     c.LAST_NAME,
    email:         c.EMAIL         ?? '',
    mobile:        c.MOBILE        ?? '',
    phone:         c.PHONE         ?? '',
    position:      c.POSITION      ?? '',
    department:    c.DEPARTMENT    ?? '',
    salutation_id: c.SALUTATION_ID ?? '',
    gender_id:     c.GENDER_ID     ?? '',
    address_id:    c.ADDRESS_ID    ?? '',
    is_primary:    !!c.IS_PRIMARY,
    notes:         c.NOTES         ?? '',
  }
}

// ── Kontakt-Formular (Top-Level) ─────────────────────────────────────────────

interface ContactFormProps {
  vals:            ContactPayload
  setK:            (k: keyof ContactPayload) => (v: string) => void
  onPrimaryChange: (v: boolean) => void
  addrTxt:         string
  setAddrTxt:      (v: string) => void
  msg:             { text: string; type: 'success' | 'error' } | null
  isEdit?:         boolean
  /** Pflichtfelder, die beim Speichern fehlten (Beschriftungen ohne *) */
  invalid?:        string[]
  salutations:     { ID: number | string; SALUTATION: string }[]
  genders:         { ID: number | string; GENDER: string }[]
  searchAddresses: (q: string) => Promise<{ id: number; label: string }[]>
}

export function ContactForm({ vals, setK, onPrimaryChange, addrTxt, setAddrTxt, msg: m, isEdit = false, invalid, salutations, genders, searchAddresses }: ContactFormProps) {
  const formId = isEdit ? 'e' : 'c'
  const bad = (label: string) => (invalid?.includes(label) ? true : undefined)
  return (
    <>
      <FormField label="Titel"       id={`${formId}-ct`} value={vals.title ?? ''} onChange={e => setK('title')(e.target.value)} />
      <div className="form-row">
        <FormField label="Vorname*"  id={`${formId}-fn`} value={vals.first_name} onChange={e => setK('first_name')(e.target.value)} aria-invalid={bad('Vorname')} />
        <FormField label="Nachname*" id={`${formId}-ln`} value={vals.last_name}  onChange={e => setK('last_name')(e.target.value)} aria-invalid={bad('Nachname')} />
      </div>
      <div className="form-row">
        <FormField label="Funktion"  id={`${formId}-po`} value={vals.position ?? ''}   onChange={e => setK('position')(e.target.value)}   placeholder="z.B. Projektleiter" />
        <FormField label="Abteilung" id={`${formId}-de`} value={vals.department ?? ''} onChange={e => setK('department')(e.target.value)} />
      </div>
      <FormField label="E-Mail"      id={`${formId}-em`} value={vals.email ?? ''} onChange={e => setK('email')(e.target.value)} type="email" />
      <div className="form-row">
        <FormField label="Mobil"     id={`${formId}-mo`} value={vals.mobile ?? ''} onChange={e => setK('mobile')(e.target.value)} type="tel" />
        <FormField label="Festnetz"  id={`${formId}-ph`} value={vals.phone ?? ''}  onChange={e => setK('phone')(e.target.value)}  type="tel" />
      </div>
      <div className="form-group">
        <label htmlFor={`${formId}-gen`}>Geschlecht*</label>
        <select
          id={`${formId}-gen`}
          value={String(vals.gender_id ?? '')}
          aria-invalid={bad('Geschlecht')}
          onChange={e => {
            const v = e.target.value
            setK('gender_id')(v)
            // Anrede folgt dem Geschlecht — unten weiterhin frei änderbar.
            const sal = salutationForGender(v, genders, salutations)
            if (sal) setK('salutation_id')(sal)
          }}
        >
          <option value="">Bitte wählen …</option>
          {genders.map(g => <option key={g.ID} value={g.ID}>{g.GENDER}</option>)}
        </select>
      </div>
      <div className="form-group">
        <label htmlFor={`${formId}-sal`} style={{ display: 'inline-flex', alignItems: 'center' }}>
          Anrede* <HelpHint id="addresses.salutation" />
        </label>
        <select id={`${formId}-sal`} value={String(vals.salutation_id ?? '')} onChange={e => setK('salutation_id')(e.target.value)} aria-invalid={bad('Anrede')}>
          <option value="">Bitte wählen …</option>
          {salutations.map(s => <option key={s.ID} value={s.ID}>{s.SALUTATION}</option>)}
        </select>
      </div>
      <Autocomplete
        label="Adresse*"
        htmlId={`${formId}-addr`}
        value={addrTxt}
        // Jede Änderung am Text löst die Auswahl: vorher blieb die alte
        // Adresse gespeichert, während das Feld einen anderen Namen zeigte.
        onChange={(t) => { setAddrTxt(t); setK('address_id')('') }}
        onSelect={(id, lbl) => { setAddrTxt(lbl); setK('address_id')(String(id)) }}
        search={searchAddresses}
        placeholder="Adresse suchen …"
      />
      <label className="ws-check">
        <input type="checkbox" checked={!!vals.is_primary} onChange={e => onPrimaryChange(e.target.checked)}
          aria-describedby={`${formId}-primary-hint`} />
        <span>Hauptansprechpartner dieser Adresse</span>
      </label>
      <p id={`${formId}-primary-hint`} className="form-field-hint">Es gibt einen je Adresse — ein anderer verliert dann die Markierung.</p>
      <div className="form-group">
        <label htmlFor={`${formId}-notes`}>Notizen</label>
        <textarea id={`${formId}-notes`} rows={2} value={vals.notes ?? ''} onChange={e => setK('notes')(e.target.value)}
          style={{ resize: 'vertical', whiteSpace: 'pre-line' }} />
      </div>
      <Message text={m?.text ?? null} type={m?.type} />
    </>
  )
}
