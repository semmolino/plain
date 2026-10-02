import type { ReactNode } from 'react'
import { FormSection } from '@/components/ui/FormSection'
import { Disclosure } from '@/components/ui/Disclosure'
import { HelpHint } from '@/components/ui/HelpHint'
import { ADDRESS_TYPES, type AddressPayload } from '@/api/stammdaten'

/**
 * Felder einer Adresse, gegliedert in Abschnitte (UI-Pilot Runde 8).
 *
 * Eine Stelle für die Seite (Reiter „Adressdaten") und den Anlegen-Dialog.
 * Vorher waren es zwei Dialoge mit demselben Formular als eine lange Spalte,
 * die E-Rechnungs-Angaben hinter einem Kästchen, das wie eine Einstellung
 * aussah und nichts speicherte.
 */

/** EAS-Codes (Peppol Scheme-ID), die Büros hier brauchen. */
const PEPPOL_SCHEMES: [string, string][] = [
  ['0204', '0204 — DE Leitweg-ID'],
  ['9930', '9930 — DE USt-IdNr.'],
  ['0088', '0088 — GLN'],
  ['9931', '9931 — AT VAT'],
  ['9957', '9957 — FR SIRET'],
  ['9959', '9959 — BE Enterprise'],
  ['0184', '0184 — DK CVR'],
  ['0192', '0192 — NO Org.nr'],
  ['EM',   'EM — E-Mail'],
]

export type AddressField = keyof AddressPayload

export function missingAddressFields(v: AddressPayload): string[] {
  const m: string[] = []
  if (!v.address_name_1.trim()) m.push('Name 1')
  if (!String(v.country_id ?? '').trim()) m.push('Land')
  return m
}

export function AddressFields({ vals, set, countries, prefix, invalid, compact = false }: {
  vals:      AddressPayload
  set:       (k: AddressField, v: string) => void
  countries: { ID: number | string; NAME?: string; ABBR?: string }[]
  /** id-Präfix — Seite und Dialog können gleichzeitig im DOM sein */
  prefix:    string
  /** Pflichtfelder, die beim Speichern fehlten */
  invalid?:  string[]
  /** Dialog: E-Rechnung und Notizen eingeklappt */
  compact?:  boolean
}) {
  const id = (k: string) => `${prefix}-${k}`
  const bad = (label: string) => (invalid?.includes(label) ? true : undefined)
  const text = (k: AddressField, label: ReactNode, extra: Record<string, unknown> = {}) => (
    <div className="form-group" key={k}>
      <label htmlFor={id(k)}>{label}</label>
      <input id={id(k)} type="text" value={(vals[k] as string | undefined) ?? ''} onChange={e => set(k, e.target.value)} {...extra} />
    </div>
  )
  const scheme = vals.peppol_scheme_id ?? ''
  // Ein gespeicherter Code außerhalb der Liste stand vorher als „— keiner —"
  // da, und wer das Feld berührte, verlor ihn.
  const schemeKnown = !scheme || PEPPOL_SCHEMES.some(([c]) => c === scheme)

  const einvoice = (
    <>
      <div className="form-group">
        <label htmlFor={id('br')} className="ws-label-help">Käuferreferenz / Leitweg-ID <HelpHint id="einvoice.leitweg" size={13} /></label>
        <input id={id('br')} type="text" value={vals.buyer_reference ?? ''} onChange={e => set('buyer_reference', e.target.value)}
          placeholder="z. B. 04011000-12345-34" />
      </div>
      <div className="form-group">
        <label htmlFor={id('pe')} className="ws-label-help">Peppol Endpoint-ID <HelpHint id="einvoice.peppol" size={13} /></label>
        <input id={id('pe')} type="text" value={vals.peppol_endpoint_id ?? ''} onChange={e => set('peppol_endpoint_id', e.target.value)}
          placeholder="z. B. DE123456789 oder GLN" />
      </div>
      <div className="form-group">
        <label htmlFor={id('ps')}>Peppol Scheme-ID (EAS)</label>
        <select id={id('ps')} value={scheme} onChange={e => set('peppol_scheme_id', e.target.value)}>
          <option value="">— keine —</option>
          {!schemeKnown && <option value={scheme}>{scheme} (gespeichert)</option>}
          {PEPPOL_SCHEMES.map(([c, l]) => <option key={c} value={c}>{l}</option>)}
        </select>
      </div>
    </>
  )
  // Auf der Seite trägt der Abschnitt die Überschrift — die Beschriftung
  // stünde sonst zweimal da; im Dialog (eingeklappt) bleibt sie sichtbar.
  const notes = (
    <div className="form-group form-section-wide">
      <label htmlFor={id('notes')} className={compact ? 'ws-label-help' : 'sr-only'}>
        Notizen {compact && <HelpHint id="addresses.notes" size={13} />}
      </label>
      <textarea id={id('notes')} rows={3} value={vals.notes ?? ''} onChange={e => set('notes', e.target.value)}
        placeholder="Nur intern sichtbar, z. B. Zufahrt, Ansprechzeiten, Besonderheiten" />
    </div>
  )

  return (
    <>
      <FormSection title="Anschrift">
        <div className="form-group form-section-wide">
          <label htmlFor={id('n1')}>Name 1*</label>
          <input id={id('n1')} type="text" value={vals.address_name_1} aria-invalid={bad('Name 1')}
            onChange={e => set('address_name_1', e.target.value)} placeholder="z. B. Stadt Ravensburg, Hochbauamt" />
        </div>
        {text('address_name_2', 'Name 2', { placeholder: 'z. B. Abteilung, Zimmer' })}
        <div className="form-group">
          <label htmlFor={id('type')} className="ws-label-help">Kategorie <HelpHint id="addresses.type" size={13} /></label>
          <select id={id('type')} value={vals.address_type ?? ''} onChange={e => set('address_type', e.target.value)}>
            <option value="">— ohne —</option>
            {ADDRESS_TYPES.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
          </select>
        </div>
        <label className="ws-check form-section-wide">
          <input type="checkbox" checked={vals.is_consumer === 'true'} onChange={e => set('is_consumer', e.target.checked ? 'true' : '')} />
          <span>Privatperson (Verbraucher)</span>
          <HelpHint id="addresses.consumer" size={13} />
        </label>
        {text('street', 'Straße')}
        {text('post_office_box', 'Postfach')}
        {text('post_code', 'PLZ', { inputMode: 'numeric', autoComplete: 'postal-code' })}
        {text('city', 'Ort')}
        <div className="form-group">
          <label htmlFor={id('country')}>Land*</label>
          <select id={id('country')} value={vals.country_id ?? ''} aria-invalid={bad('Land')} onChange={e => set('country_id', e.target.value)}>
            <option value="">Bitte wählen …</option>
            {countries.map(c => <option key={c.ID} value={c.ID}>{c.NAME || c.ABBR || c.ID}</option>)}
          </select>
        </div>
      </FormSection>

      <FormSection title="Erreichbarkeit">
        {text('phone', 'Telefon', { type: 'tel', autoComplete: 'tel' })}
        {text('email', 'E-Mail', { type: 'email', autoComplete: 'email' })}
        {text('website', 'Website', { inputMode: 'url', placeholder: 'z. B. www.stadt-ravensburg.de' })}
      </FormSection>

      <FormSection title="Kunde und Steuer">
        {text('customer_number', 'Kundennummer')}
        <div className="form-group">
          <label htmlFor={id('ustid')} className="ws-label-help">USt-IdNr. <HelpHint id="addresses.ustid" size={13} /></label>
          <input id={id('ustid')} type="text" value={vals.tax_id ?? ''} onChange={e => set('tax_id', e.target.value)} placeholder="z. B. DE123456789" />
        </div>
        {text('tax_number', 'Steuernummer')}
      </FormSection>

      {compact ? (
        <Disclosure title="E-Rechnung und Notizen" className="ad-more"
          defaultOpen={!!(vals.buyer_reference || vals.peppol_endpoint_id || vals.peppol_scheme_id || vals.notes)}>
          <div className="form-section-body">{einvoice}{notes}</div>
        </Disclosure>
      ) : (
        <>
          <FormSection title="E-Rechnung" help="einvoice.what"
            hint="Nur bei öffentlichen Auftraggebern (Leitweg-ID) oder Empfängern im Peppol-Netz nötig.">
            {einvoice}
          </FormSection>
          <FormSection title="Notizen" help="addresses.notes">{notes}</FormSection>
        </>
      )}
    </>
  )
}
