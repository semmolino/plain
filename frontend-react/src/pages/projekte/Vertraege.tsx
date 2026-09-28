import { useState, useCallback, useMemo } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useCtrlS } from '@/hooks/useCtrlS'
import { useConfirm } from '@/hooks/useConfirm'
import { useRegisterDirty } from '@/hooks/useDirtyGuard'
import { usePermission } from '@/store/permissionsStore'
import { fetchContractByProject, patchContract, type Contract } from '@/api/projekte'
import { searchAddressesApi, fetchContactsByAddress, fetchVatList } from '@/api/stammdaten'
import { VAT_CATEGORY_LABELS, type VatCategory } from '@/api/rechnungen'
import { ActionBar } from '@/components/ui/ActionBar'
import { AmountInput } from '@/components/ui/AmountInput'
import { Autocomplete } from '@/components/ui/Autocomplete'
import { FormSection } from '@/components/ui/FormSection'
import { HelpHint } from '@/components/ui/HelpHint'
import { Message } from '@/components/ui/Message'

interface Props {
  initialProjectId?: number
}

/** Formularstand in Eingabeform — Zahlen als Maschinen-String ('2.5'), leer = kein Wert. */
interface VertragForm {
  abbr:          string
  name:          string
  addressId:     number | null
  addrText:      string
  contactId:     number | null
  cashDiscPct:   string
  cashDiscDays:  string
  vatId:         number | null
  vatCategory:   VatCategory
  vatExemptCode: string
  vatExemptText: string
  seEnabled:     boolean
  sePct:         string
  seBasis:       'BRUTTO' | 'NETTO'
  seLegalRef:    string
}

/** Was als Änderung zählt — `addrText` ist nur die Anzeige zu `addressId`. */
const FIELDS: (keyof VertragForm)[] = [
  'abbr', 'name', 'addressId', 'contactId', 'cashDiscPct', 'cashDiscDays', 'vatId',
  'vatCategory', 'vatExemptCode', 'vatExemptText', 'seEnabled', 'sePct', 'seBasis', 'seLegalRef',
]

const numStr = (v: number | null | undefined) => (v == null ? '' : String(v))

function formFrom(c: Contract): VertragForm {
  return {
    abbr:          c.ABBR ?? '',
    name:          c.NAME ?? '',
    addressId:     c.INVOICE_ADDRESS_ID ?? null,
    addrText:      c.INVOICE_ADDRESS_NAME ?? '',
    contactId:     c.INVOICE_CONTACT_ID ?? null,
    cashDiscPct:   numStr(c.CASH_DISCOUNT_PERCENT),
    cashDiscDays:  numStr(c.CASH_DISCOUNT_DAYS),
    vatId:         c.VAT_ID ?? null,
    vatCategory:   (c.VAT_CATEGORY && c.VAT_CATEGORY in VAT_CATEGORY_LABELS ? c.VAT_CATEGORY : 'S') as VatCategory,
    vatExemptCode: c.VAT_EXEMPTION_REASON_CODE ?? '',
    vatExemptText: c.VAT_EXEMPTION_REASON_TEXT ?? '',
    seEnabled:     !!c.SE_ENABLED,
    sePct:         numStr(c.SE_PERCENT),
    seBasis:       c.SE_BASIS === 'NETTO' ? 'NETTO' : 'BRUTTO',
    seLegalRef:    c.SE_LEGAL_REFERENCE ?? '',
  }
}

function payloadFrom(f: VertragForm) {
  const exempt = f.vatCategory !== 'S'
  return {
    ABBR:                      f.abbr.trim(),
    NAME:                      f.name.trim(),
    INVOICE_ADDRESS_ID:        f.addressId,
    INVOICE_CONTACT_ID:        f.addressId ? f.contactId : null,
    CASH_DISCOUNT_PERCENT:     f.cashDiscPct !== '' ? Number(f.cashDiscPct) : null,
    CASH_DISCOUNT_DAYS:        f.cashDiscDays !== '' ? parseInt(f.cashDiscDays, 10) : null,
    VAT_ID:                    f.vatId,
    SE_ENABLED:                f.seEnabled,
    SE_PERCENT:                f.seEnabled && f.sePct !== '' ? Number(f.sePct) : null,
    SE_BASIS:                  f.seEnabled ? f.seBasis : null,
    SE_LEGAL_REFERENCE:        f.seEnabled && f.seLegalRef.trim() ? f.seLegalRef.trim() : null,
    VAT_CATEGORY:              f.vatCategory,
    // Beim Regelsatz gibt es keinen Befreiungsgrund — ein alter blieb sonst
    // stehen und ging bei einem späteren Wechsel ungefragt wieder mit.
    VAT_EXEMPTION_REASON_CODE: exempt ? f.vatExemptCode.trim() || null : null,
    VAT_EXEMPTION_REASON_TEXT: exempt ? f.vatExemptText.trim() || null : null,
  }
}

export function Vertraege({ initialProjectId }: Props) {
  // Neuer Zustand je Projekt — offene Eingaben gehören zu genau einem Vertrag.
  return <VertragProjekt key={initialProjectId ?? 'none'} projectId={initialProjectId ?? null} />
}

function VertragProjekt({ projectId }: { projectId: number | null }) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['contract', projectId],
    queryFn:  () => fetchContractByProject(projectId!),
    enabled:  projectId !== null,
  })
  const contract = data?.data ?? null

  if (projectId == null) return <p className="ls-empty">Bitte oben ein Projekt auswählen.</p>
  if (isLoading)         return <p className="ls-empty">Lädt …</p>
  if (isError)           return <Message type="error" text="Der Vertrag konnte nicht geladen werden." />
  if (!contract) return (
    <div className="empty-block">
      <p className="empty-note">Zu diesem Projekt gibt es noch keinen Vertrag.</p>
      <p className="empty-block-why">
        Ein Vertrag entsteht beim Anlegen des Projekts oder beim Beauftragen eines Angebots. Er legt fest,
        an wen die Rechnungen gehen und welche Skonto-, Steuer- und Einbehaltsregeln für sie gelten.
      </p>
    </div>
  )
  return <VertragFormular projectId={projectId} contract={contract} />
}

function VertragFormular({ projectId, contract }: { projectId: number; contract: Contract }) {
  const qc = useQueryClient()
  const canEdit = usePermission('projects.contracts.edit')
  const [confirm, confirmDialog] = useConfirm()
  const [edits, setEdits] = useState<Partial<VertragForm>>({})
  const [pending, setPending] = useState(false)
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  // Eingaben liegen über dem geladenen Stand, bis gespeichert wird. Ein
  // Nachladen im Hintergrund (Fensterfokus) überschreibt deshalb nichts,
  // und wer einen Wert zurückstellt, hat keine Änderung mehr offen.
  const saved = useMemo(() => formFrom(contract), [contract])
  const form: VertragForm = { ...saved, ...edits }
  const changed = FIELDS.filter(k => form[k] !== saved[k]).length
  const dirty = changed > 0

  const { data: vatListData } = useQuery({ queryKey: ['vat-list'], queryFn: fetchVatList })
  const { data: contactData } = useQuery({
    queryKey: ['contacts-by-address', form.addressId],
    queryFn:  () => fetchContactsByAddress(form.addressId!),
    enabled:  form.addressId != null,
  })
  const contacts = form.addressId != null ? contactData?.data ?? [] : []

  function set<K extends keyof VertragForm>(k: K, v: VertragForm[K]) {
    setEdits(e => ({ ...e, [k]: v }))
    setMsg(null)
  }
  function patch(p: Partial<VertragForm>) {
    setEdits(e => ({ ...e, ...p }))
    setMsg(null)
  }

  const searchAddresses = useCallback(async (q: string) => {
    const res = await searchAddressesApi(q)
    return (res.data ?? []).map(a => ({ id: a.ID, label: a.ADDRESS_NAME_1 }))
  }, [])

  async function save() {
    setPending(true)
    setMsg(null)
    try {
      await patchContract(contract.ID, payloadFrom(form))
      await qc.invalidateQueries({ queryKey: ['contract', projectId] })
      setEdits({})
      setMsg({ type: 'success', text: 'Vertrag gespeichert. Neue Rechnungen aus diesem Vertrag übernehmen die Werte.' })
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
      message: `${changed === 1 ? '1 Änderung geht' : `${changed} Änderungen gehen`} verloren. Der Vertrag bleibt, wie er gespeichert ist.`,
      confirmLabel: 'Verwerfen',
    })
    if (ok) { setEdits({}); setMsg(null) }
  }

  useRegisterDirty('vertrag', { dirty, label: 'Vertrag', count: changed, save })
  useCtrlS(() => { if (dirty && !pending) void save().catch(() => {}) }, canEdit)

  const status = pending ? 'Speichert …'
    : dirty ? `${changed} ${changed === 1 ? 'Feld' : 'Felder'} geändert`
    : 'Keine Änderungen'

  return (
    <div className="ws-form">
      <p className="ws-form-intro">
        Der Vertrag ist die Vorbelegung für jede Rechnung daraus. <HelpHint id="contract.defaults" size={13} />
      </p>
      {!canEdit && (
        <p className="ws-form-readonly">Nur Lesen — zum Ändern fehlt das Recht „Verträge bearbeiten".</p>
      )}

      <fieldset className="ws-form-fields" disabled={!canEdit || pending}>
        <legend className="sr-only">Vertrag</legend>

        <FormSection title="Vertrag">
          <div className="form-group">
            <label htmlFor="vt-abbr">Vertragsnummer</label>
            <input id="vt-abbr" type="text" value={form.abbr} placeholder="z. B. V-26-001"
              onChange={e => set('abbr', e.target.value)} />
          </div>
          <div className="form-group">
            <label htmlFor="vt-name">Vertragsname</label>
            <input id="vt-name" type="text" value={form.name} placeholder="z. B. Planungsvertrag Hauptauftrag"
              onChange={e => set('name', e.target.value)} />
          </div>
        </FormSection>

        <FormSection title="Rechnungsempfänger" hint="Adresse und Ansprechpartner, an die die Rechnungen gehen.">
          <Autocomplete
            label="Rechnungsadresse"
            htmlId="vt-address"
            value={form.addrText}
            onChange={text => text ? set('addrText', text) : patch({ addrText: '', addressId: null, contactId: null })}
            onSelect={(id, label) => patch({ addressId: Number(id), addrText: label, contactId: null })}
            search={searchAddresses}
            placeholder="Adresse suchen …"
          />
          <div className="form-group">
            <label htmlFor="vt-contact">Rechnungskontakt</label>
            <select id="vt-contact" value={form.contactId ?? ''} disabled={form.addressId == null}
              onChange={e => set('contactId', e.target.value ? Number(e.target.value) : null)}>
              <option value="">{form.addressId == null ? 'Erst eine Adresse wählen' : '— kein Kontakt —'}</option>
              {contacts.map(c => (
                <option key={c.ID} value={c.ID}>{`${c.FIRST_NAME ?? ''} ${c.LAST_NAME ?? ''}`.trim()}</option>
              ))}
            </select>
          </div>
        </FormSection>

        <FormSection title="Zahlung und Steuer">
          <div className="form-group">
            <label htmlFor="vt-skonto-pct" className="ws-label-help">
              Skonto (%) <HelpHint id="invoice.skonto" size={13} />
            </label>
            <AmountInput id="vt-skonto-pct" value={form.cashDiscPct} placeholder="z. B. 2,00"
              onChange={v => set('cashDiscPct', v)} />
          </div>
          <div className="form-group">
            <label htmlFor="vt-skonto-days">Skonto-Frist (Tage)</label>
            <input id="vt-skonto-days" type="number" inputMode="numeric" min={0} step={1} value={form.cashDiscDays}
              placeholder="z. B. 14" onChange={e => set('cashDiscDays', e.target.value)} />
          </div>
          <div className="form-group">
            <label htmlFor="vt-vat">Steuersatz (MwSt.)</label>
            <select id="vt-vat" value={form.vatId ?? ''} aria-describedby="vt-vat-hint"
              onChange={e => set('vatId', e.target.value ? Number(e.target.value) : null)}>
              <option value="">Vorbelegung des Büros</option>
              {(vatListData?.data ?? []).map(v => (
                <option key={v.ID} value={v.ID}>{v.VAT} ({v.VAT_PERCENT} %)</option>
              ))}
            </select>
            <p id="vt-vat-hint" className="form-field-hint">
              Ohne Auswahl gilt der Satz aus Einstellungen → Vorbelegungen.
            </p>
          </div>
          <div className="form-group">
            <label htmlFor="vt-vatcat" className="ws-label-help">
              Umsatzsteuer-Kategorie <HelpHint id="contract.vat_category" size={13} />
            </label>
            <select id="vt-vatcat" value={form.vatCategory}
              onChange={e => set('vatCategory', e.target.value as VatCategory)}>
              {(Object.keys(VAT_CATEGORY_LABELS) as VatCategory[]).map(k => (
                <option key={k} value={k}>{VAT_CATEGORY_LABELS[k]}</option>
              ))}
            </select>
          </div>
          {form.vatCategory !== 'S' && (
            <>
              <div className="form-group">
                <label htmlFor="vt-exempt-code">Befreiungsgrund, Code (optional)</label>
                <input id="vt-exempt-code" type="text" value={form.vatExemptCode} placeholder="z. B. VATEX-EU-AE"
                  onChange={e => set('vatExemptCode', e.target.value)} />
              </div>
              <div className="form-group">
                <label htmlFor="vt-exempt-text">Befreiungsgrund, Text</label>
                <textarea id="vt-exempt-text" rows={2} value={form.vatExemptText} placeholder="Leer lassen für den Standardtext"
                  onChange={e => set('vatExemptText', e.target.value)} />
              </div>
            </>
          )}
        </FormSection>

        <FormSection title="Sicherheitseinbehalt" help="invoice.sicherheitseinbehalt">
          <label className="ws-check form-section-wide">
            <input type="checkbox" checked={form.seEnabled} onChange={e => set('seEnabled', e.target.checked)} />
            <span>Sicherheitseinbehalt vereinbart</span>
          </label>
          {form.seEnabled && (
            <>
              <div className="form-group">
                <label htmlFor="vt-se-pct">Einbehalt (%)</label>
                <AmountInput id="vt-se-pct" value={form.sePct} placeholder="z. B. 5,00"
                  onChange={v => set('sePct', v)} />
              </div>
              <fieldset className="ws-radio-group">
                <legend>Bemessen vom</legend>
                <label className="ws-check">
                  <input type="radio" name="vt-se-basis" checked={form.seBasis === 'BRUTTO'} onChange={() => set('seBasis', 'BRUTTO')} />
                  <span>Brutto</span>
                </label>
                <label className="ws-check">
                  <input type="radio" name="vt-se-basis" checked={form.seBasis === 'NETTO'} onChange={() => set('seBasis', 'NETTO')} />
                  <span>Netto</span>
                </label>
              </fieldset>
              <div className="form-group form-section-wide">
                <label htmlFor="vt-se-ref">Rechtsgrundlage</label>
                <input id="vt-se-ref" type="text" value={form.seLegalRef} placeholder="z. B. § 17 VOB/B oder freier Text"
                  onChange={e => set('seLegalRef', e.target.value)} />
              </div>
              <p className="form-field-hint form-section-wide">
                Wird von jeder Abschlagsrechnung einbehalten und mit der Schluss- oder Teilschlussrechnung aufgelöst.
              </p>
            </>
          )}
        </FormSection>
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
