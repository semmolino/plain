import { useState } from 'react'
import { FormField } from '@/components/ui/FormField'
import { Message }   from '@/components/ui/Message'
import { HelpHint }  from '@/components/ui/HelpHint'
import { Autocomplete } from '@/components/ui/Autocomplete'
import { ADDRESS_TYPES, type Address, type Contact, type AddressPayload, type ContactPayload } from '@/api/stammdaten'

// ── Leere Formularwerte ─────────────────────────────────────────────────────

export function emptyAddr(): AddressPayload {
  return {
    address_name_1: '', address_name_2: '', street: '', post_office_box: '',
    post_code: '', city: '', country_id: '', address_type: '',
    phone: '', email: '', website: '',
    customer_number: '', tax_id: '', tax_number: '',
    buyer_reference: '', peppol_endpoint_id: '', peppol_scheme_id: '', notes: '',
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

// ── Adress-Formular (Top-Level, damit der Fokus beim Tippen erhalten bleibt) ──

interface AddrFormProps {
  vals:      AddressPayload
  setK:      (k: keyof AddressPayload) => (v: string) => void
  msg:       { text: string; type: 'success' | 'error' } | null
  countries: { ID: number | string; NAME_LONG?: string; NAME_SHORT?: string }[]
}

export function AddrForm({ vals, setK, msg: m, countries }: AddrFormProps) {
  // E-Rechnungs-Angaben standardmäßig versteckt — automatisch aufgeklappt,
  // wenn beim Bearbeiten bereits Werte vorhanden sind.
  const hasEinvoiceData = !!(vals.buyer_reference || vals.peppol_endpoint_id || vals.peppol_scheme_id)
  const [showEinvoice, setShowEinvoice] = useState(hasEinvoiceData)

  return (
    <div className="master-form">
      <div className="form-group">
        <label htmlFor="atype" style={{ display: 'inline-flex', alignItems: 'center' }}>
          Kategorie <HelpHint id="addresses.type" />
        </label>
        <select id="atype" value={vals.address_type ?? ''} onChange={e => setK('address_type')(e.target.value)}>
          <option value="">— ohne —</option>
          {ADDRESS_TYPES.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
        </select>
      </div>

      <FormField label="Name 1*"        id="an1" value={vals.address_name_1}       onChange={e => setK('address_name_1')(e.target.value)} />
      <FormField label="Name 2"         id="an2" value={vals.address_name_2 ?? ''} onChange={e => setK('address_name_2')(e.target.value)} />
      <FormField label="Straße"         id="ast" value={vals.street ?? ''}         onChange={e => setK('street')(e.target.value)} />
      <div className="form-row">
        <FormField label="PLZ"          id="apc" value={vals.post_code ?? ''}       onChange={e => setK('post_code')(e.target.value)} inputMode="numeric" />
        <FormField label="Ort"          id="aci" value={vals.city ?? ''}            onChange={e => setK('city')(e.target.value)} />
      </div>
      <FormField label="Postfach"       id="apo" value={vals.post_office_box ?? ''} onChange={e => setK('post_office_box')(e.target.value)} />
      <div className="form-group">
        <label htmlFor="aco">Land*</label>
        <select id="aco" value={vals.country_id ?? ''} onChange={e => setK('country_id')(e.target.value)} required>
          <option value="">Bitte wählen …</option>
          {countries.map(c => <option key={c.ID} value={c.ID}>{c.NAME_LONG || c.NAME_SHORT || c.ID}</option>)}
        </select>
      </div>

      <div className="form-row">
        <FormField label="Telefon"      id="aph" value={vals.phone ?? ''}   onChange={e => setK('phone')(e.target.value)} type="tel" />
        <FormField label="E-Mail"       id="aem" value={vals.email ?? ''}   onChange={e => setK('email')(e.target.value)} type="email" />
      </div>
      <FormField label="Website"        id="awe" value={vals.website ?? ''} onChange={e => setK('website')(e.target.value)} placeholder="https://…" />

      <FormField label="Kundennr."      id="acn" value={vals.customer_number ?? ''} onChange={e => setK('customer_number')(e.target.value)} />
      <div className="form-row">
        <div className="form-group">
          <label htmlFor="autid" style={{ display: 'inline-flex', alignItems: 'center' }}>
            USt-IdNr. <HelpHint id="addresses.ustid" />
          </label>
          <input id="autid" type="text" value={vals.tax_id ?? ''} onChange={e => setK('tax_id')(e.target.value)} placeholder="z.B. DE123456789" />
        </div>
        <FormField label="Steuernummer" id="atn" value={vals.tax_number ?? ''} onChange={e => setK('tax_number')(e.target.value)} />
      </div>

      <div className="form-group">
        <label htmlFor="anotes" style={{ display: 'inline-flex', alignItems: 'center' }}>
          Notizen <HelpHint id="addresses.notes" />
        </label>
        <textarea id="anotes" rows={3} value={vals.notes ?? ''} onChange={e => setK('notes')(e.target.value)}
          style={{ resize: 'vertical', whiteSpace: 'pre-line' }} />
      </div>

      {/* E-Rechnungs-Angaben — aufklappbar */}
      <div style={{ background: 'var(--surface-2, #f9fafb)', border: '1px solid var(--border, #e5e7eb)', borderRadius: 6, padding: 14, marginTop: 4 }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', marginBottom: showEinvoice ? 12 : 0 }}>
          <input
            type="checkbox"
            checked={showEinvoice}
            onChange={e => setShowEinvoice(e.target.checked)}
            style={{ width: 16, height: 16, cursor: 'pointer' }}
          />
          <span style={{ fontWeight: 500, display: 'inline-flex', alignItems: 'center' }}>
            Angaben für E-Rechnung <HelpHint id="einvoice.what" />
          </span>
        </label>
        {!showEinvoice && (
          <p style={{ fontSize: 12, color: 'var(--text-muted, #6b7280)', margin: '6px 0 0 26px' }}>
            Käuferreferenz / Leitweg-ID und Peppol-Endpoint — nur bei öffentlichen Auftraggebern oder Kunden im Peppol-Netz nötig.
          </p>
        )}
        {showEinvoice && (
          <>
            <div className="form-group">
              <label htmlFor="abr" style={{ display: 'inline-flex', alignItems: 'center' }}>
                Käuferreferenz / Leitweg-ID <HelpHint id="einvoice.leitweg" />
              </label>
              <input id="abr" type="text" value={vals.buyer_reference ?? ''} onChange={e => setK('buyer_reference')(e.target.value)} />
            </div>
            <div className="form-group">
              <label htmlFor="ape-id" style={{ display: 'inline-flex', alignItems: 'center' }}>
                Peppol Endpoint-ID <HelpHint id="einvoice.peppol" />
              </label>
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
          </>
        )}
      </div>

      <Message text={m?.text ?? null} type={m?.type} />
    </div>
  )
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
  salutations:     { ID: number | string; SALUTATION: string }[]
  genders:         { ID: number | string; GENDER: string }[]
  searchAddresses: (q: string) => Promise<{ id: number; label: string }[]>
}

export function ContactForm({ vals, setK, onPrimaryChange, addrTxt, setAddrTxt, msg: m, isEdit = false, salutations, genders, searchAddresses }: ContactFormProps) {
  const formId = isEdit ? 'e' : 'c'
  return (
    <>
      <FormField label="Titel"       id={`${formId}-ct`} value={vals.title ?? ''} onChange={e => setK('title')(e.target.value)} />
      <div className="form-row">
        <FormField label="Vorname*"  id={`${formId}-fn`} value={vals.first_name} onChange={e => setK('first_name')(e.target.value)} required />
        <FormField label="Nachname*" id={`${formId}-ln`} value={vals.last_name}  onChange={e => setK('last_name')(e.target.value)} required />
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
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', margin: '4px 0' }}>
        <input type="checkbox" checked={!!vals.is_primary} onChange={e => onPrimaryChange(e.target.checked)}
          style={{ width: 16, height: 16, cursor: 'pointer' }} />
        <span>Hauptansprechpartner dieser Adresse</span>
      </label>
      <div className="form-group">
        <label htmlFor={`${formId}-notes`}>Notizen</label>
        <textarea id={`${formId}-notes`} rows={2} value={vals.notes ?? ''} onChange={e => setK('notes')(e.target.value)}
          style={{ resize: 'vertical', whiteSpace: 'pre-line' }} />
      </div>
      <Message text={m?.text ?? null} type={m?.type} />
    </>
  )
}
