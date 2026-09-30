import { createContext, useContext, useMemo, useState, type ReactNode } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ActionBar } from '@/components/ui/ActionBar'
import { FormSection } from '@/components/ui/FormSection'
import { HelpHint } from '@/components/ui/HelpHint'
import { Message } from '@/components/ui/Message'
import { useConfirm } from '@/hooks/useConfirm'
import { useCtrlS } from '@/hooks/useCtrlS'
import { useRegisterDirty } from '@/hooks/useDirtyGuard'
import { useToast } from '@/store/toastStore'
import type { HelpId } from '@/help/helpContent'
import {
  fetchCountries, fetchCompanies, fetchCurrencies, fetchVatList, fetchPaymentMeans,
  fetchDefaults, putDefaults,
} from '@/api/stammdaten'
import { fetchProjectStatuses } from '@/api/projekte'
import { fetchOfferStatuses } from '@/api/angebote'

/**
 * Einstellungen → Vorbelegungen (UI-Pilot Runde 12).
 *
 * Vorher: 28 Zustände, die ein Effekt bei JEDEM Nachladen der Vorbelegungen
 * zurücksetzte — wer tippte, während eine andere Seite `['defaults']`
 * invalidierte, verlor seine Eingabe. Gespeichert wurde mit 28 PUT-Aufrufen
 * nacheinander, auch für unveränderte Felder; brach einer ab, war die Hälfte
 * geschrieben. Zahlenfelder waren `type="number"` und nahmen „2,5" nicht an,
 * die Hälfte der Beschriftungen hatte keinen Bezug zum Feld, und wer den
 * Reiter wechselte, verlor seine Änderungen ohne Rückfrage.
 *
 * Jetzt im Muster der Arbeitsbereiche: Eingaben liegen über dem geladenen
 * Stand, die Aktionsleiste zählt sie, gespeichert werden nur geänderte
 * Schlüssel in EINER Anfrage — der Server prüft alle, bevor er schreibt
 * (`services/tenantDefaults.js`). Leer heißt „keine Vorbelegung" und löscht
 * die Zeile, statt eine leere zu schreiben.
 */

const KEYS = [
  'default_country_id', 'default_company_id', 'default_project_status_id', 'default_offer_status_id',
  'offer_valid_days', 'default_currency_id', 'default_vat_id',
  'default_cash_discount_percent', 'default_cash_discount_days',
  'default_se_enabled', 'default_se_percent', 'default_se_basis', 'default_se_legal_reference',
  'default_payment_term_days', 'default_payment_means_id',
  'timer_enabled',
  'budget_warning_enabled', 'budget_warning_default_pcts', 'budget_warning_notify_pm', 'budget_warning_notify_booker',
  'wip_cost_factor_percent', 'wip_tax_cost_factor_percent', 'wip_target_cost_ratio_percent', 'wip_method_default',
  'kpi_cpi_watch_threshold', 'kpi_cpi_critical_threshold',
] as const
type Key = typeof KEYS[number]
type Form = Record<Key, string>

/** Zahlen stehen gespeichert mit Punkt da, im Feld mit Komma. */
const DECIMAL = new Set<Key>([
  'default_cash_discount_percent', 'default_se_percent',
  'wip_cost_factor_percent', 'wip_tax_cost_factor_percent', 'wip_target_cost_ratio_percent',
  'kpi_cpi_watch_threshold', 'kpi_cpi_critical_threshold',
])
/** Hängen am Sicherheitseinbehalt — ohne ihn werden sie nicht gespeichert. */
const SE_SUBS: Key[] = ['default_se_percent', 'default_se_basis', 'default_se_legal_reference']

function formFrom(data: Record<string, string | null> | undefined): Form {
  const f = {} as Form
  for (const k of KEYS) {
    const v = data?.[k] ?? ''
    f[k] = DECIMAL.has(k) ? v.replace('.', ',') : v
  }
  return f
}

const NONE = '— keine Vorbelegung —'

// ── Feldbausteine ─────────────────────────────────────────────────────────
// Auf Modulebene, nicht im Formular: eine Komponente, die beim Rendern neu
// entsteht, ist für React jedes Mal eine andere — das Feld verlöre bei jedem
// Tastendruck den Fokus.

interface Ctx { form: Form; saved: Form; set: (k: Key, v: string) => void }
const VbCtx = createContext<Ctx | null>(null)
function useVb(): Ctx {
  const c = useContext(VbCtx)
  if (!c) throw new Error('Vorbelegungen: Feld außerhalb des Formulars')
  return c
}
const fid = (k: Key) => `vb-${k}`
const hid = (k: Key) => `vb-${k}-hint`

function Label({ k, children, help }: { k: Key; children: ReactNode; help?: HelpId }) {
  return (
    <label htmlFor={fid(k)} className={help ? 'ws-label-help' : undefined}>
      {children}{help && <HelpHint id={help} size={13} />}
    </label>
  )
}
function Hint({ k, children, wide }: { k: Key; children: ReactNode; wide?: boolean }) {
  return <p id={hid(k)} className={`form-field-hint${wide ? ' form-section-wide' : ''}`}>{children}</p>
}

function Select({ k, label, options, help, hint }: {
  k: Key; label: string; options: { value: string; label: string }[]; help?: HelpId; hint?: ReactNode
}) {
  const { form, set } = useVb()
  return (
    <div className="form-group">
      <Label k={k} help={help}>{label}</Label>
      <select id={fid(k)} value={form[k]} onChange={e => set(k, e.target.value)} aria-describedby={hint ? hid(k) : undefined}>
        <option value="">{NONE}</option>
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      {hint && <Hint k={k}>{hint}</Hint>}
    </div>
  )
}

function NumberField({ k, label, unit, placeholder, help, hint, integer }: {
  k: Key; label: string; unit?: string; placeholder?: string; help?: HelpId; hint?: ReactNode; integer?: boolean
}) {
  const { form, set } = useVb()
  return (
    <div className="form-group">
      <Label k={k} help={help}>{label}{unit ? ` (${unit})` : ''}</Label>
      <input id={fid(k)} type="text" inputMode={integer ? 'numeric' : 'decimal'} autoComplete="off"
        value={form[k]} placeholder={placeholder} onChange={e => set(k, e.target.value)}
        aria-describedby={hint ? hid(k) : undefined} />
      {hint && <Hint k={k}>{hint}</Hint>}
    </div>
  )
}

/** `defaultOn`: ohne gespeicherte Zeile gilt „an" — gespeichert wird nur „aus". */
function Toggle({ k, label, defaultOn, hint }: { k: Key; label: string; defaultOn: boolean; hint?: ReactNode }) {
  const { form, set } = useVb()
  const checked = defaultOn ? form[k] !== 'false' : form[k] === 'true'
  return (
    <>
      <label className="ws-check form-section-wide">
        <input type="checkbox" checked={checked} aria-describedby={hint ? hid(k) : undefined}
          onChange={e => set(k, defaultOn ? (e.target.checked ? '' : 'false') : (e.target.checked ? 'true' : ''))} />
        <span>{label}</span>
      </label>
      {hint && <Hint k={k} wide>{hint}</Hint>}
    </>
  )
}

/** Auswahl mit Standardwert: der Standard ist „keine Zeile". */
function Choice({ k, label, options, fallback, help, hint }: {
  k: Key; label: string; options: { value: string; label: string }[]; fallback: string; help?: HelpId; hint?: ReactNode
}) {
  const { form, saved, set } = useVb()
  return (
    <div className="form-group">
      <Label k={k} help={help}>{label}</Label>
      <select id={fid(k)} value={form[k] || fallback} aria-describedby={hint ? hid(k) : undefined}
        onChange={e => set(k, e.target.value === fallback && !saved[k] ? '' : e.target.value)}>
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      {hint && <Hint k={k}>{hint}</Hint>}
    </div>
  )
}

function TextField({ k, label, placeholder, help, hint, max, wide, inputMode }: {
  k: Key; label: string; placeholder?: string; help?: HelpId; hint?: ReactNode; max?: number; wide?: boolean
  inputMode?: 'decimal'
}) {
  const { form, set } = useVb()
  return (
    <div className={`form-group${wide ? ' form-section-wide' : ''}`}>
      <Label k={k} help={help}>{label}</Label>
      <input id={fid(k)} type="text" maxLength={max} inputMode={inputMode} autoComplete="off" placeholder={placeholder}
        value={form[k]} onChange={e => set(k, e.target.value)} aria-describedby={hint ? hid(k) : undefined} />
      {hint && <Hint k={k}>{hint}</Hint>}
    </div>
  )
}

export function VorbelegungenPage() {
  const { data, isLoading, isError, error } = useQuery({ queryKey: ['defaults'], queryFn: fetchDefaults })
  if (isLoading) return <p className="empty-note">Lädt …</p>
  if (isError)   return <Message type="error" text={`Die Vorbelegungen konnten nicht geladen werden (${(error as Error)?.message ?? 'Fehler'}).`} />
  return <VorbelegungenForm stored={data?.data} />
}

function VorbelegungenForm({ stored }: { stored: Record<string, string | null> | undefined }) {
  const qc = useQueryClient()
  const toast = useToast()
  const [confirm, confirmDialog] = useConfirm()
  const [edits, setEdits] = useState<Partial<Form>>({})
  const [pending, setPending] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const saved = useMemo(() => formFrom(stored ?? undefined), [stored])
  const form: Form = { ...saved, ...edits }
  const seOn = form.default_se_enabled === 'true'
  // Sichtbare Änderungen — Felder des ausgeschalteten Einbehalts zählen nicht.
  const changedKeys = KEYS.filter(k => form[k] !== saved[k] && !(!seOn && SE_SUBS.includes(k)))
  const changed = changedKeys.length
  const dirty = changed > 0

  const { data: countries }  = useQuery({ queryKey: ['countries'],        queryFn: fetchCountries })
  const { data: companies }  = useQuery({ queryKey: ['companies'],        queryFn: fetchCompanies })
  const { data: currencies } = useQuery({ queryKey: ['currencies'],       queryFn: fetchCurrencies })
  const { data: vats }       = useQuery({ queryKey: ['vat-list'],         queryFn: fetchVatList })
  const { data: payMeans }   = useQuery({ queryKey: ['payment-means'],    queryFn: fetchPaymentMeans })
  const { data: pStatuses }  = useQuery({ queryKey: ['project-statuses'], queryFn: fetchProjectStatuses })
  const { data: oStatuses }  = useQuery({ queryKey: ['offer-statuses'],   queryFn: fetchOfferStatuses })
  const companyList = companies?.data ?? []

  function set(k: Key, v: string) {
    setEdits(e => ({ ...e, [k]: v }))
    setErr(null)
  }

  function payload(): Record<string, string | null> {
    const values: Record<string, string | null> = {}
    for (const k of changedKeys) values[k] = form[k].trim() || null
    // Einbehalt aus: seine Angaben fallen mit weg, wie beim Vertrag.
    if (!seOn) for (const k of SE_SUBS) if (saved[k]) values[k] = null
    return values
  }

  async function save() {
    if (!dirty || pending) return
    setPending(true)
    setErr(null)
    try {
      await putDefaults(payload())
      await qc.invalidateQueries({ queryKey: ['defaults'] })
      setEdits({})
      toast.success('Vorbelegungen gespeichert.')
    } catch (e) {
      setErr((e as Error)?.message || 'Speichern fehlgeschlagen')
      throw e
    } finally {
      setPending(false)
    }
  }

  async function discard() {
    const ok = await confirm({
      title: 'Änderungen verwerfen?',
      message: `${changed === 1 ? '1 Änderung geht' : `${changed} Änderungen gehen`} verloren. Die Vorbelegungen bleiben, wie sie gespeichert sind.`,
      confirmLabel: 'Verwerfen',
    })
    if (ok) { setEdits({}); setErr(null) }
  }

  useRegisterDirty('vorbelegungen', { dirty, label: 'Vorbelegungen', count: changed, save })
  useCtrlS(() => { if (dirty && !pending) void save().catch(() => {}) }, true)

  const status = pending ? 'Speichert …'
    : dirty ? `${changed} ${changed === 1 ? 'Feld' : 'Felder'} geändert`
    : 'Keine Änderungen'

  return (
    <div className="ws-form">
      <p className="ws-form-intro vb-intro">
        Startwerte für neue Adressen, Projekte, Angebote, Verträge und Rechnungen. Jede Vorbelegung
        bleibt im jeweiligen Formular änderbar; Bestehendes ändert sich nicht.
        <HelpHint id="settings.vorbelegungen" size={13} />
      </p>

      <VbCtx.Provider value={{ form, saved, set }}>
      <fieldset className="ws-form-fields" disabled={pending}>
        <legend className="sr-only">Vorbelegungen</legend>

        <FormSection title="Adressen, Projekte und Angebote">
          <Select k="default_country_id" label="Land" hint="Land, mit dem eine neue Adresse startet."
            options={(countries?.data ?? []).map(c => ({ value: String(c.ID), label: c.NAME || c.ABBR }))} />
          {companyList.length > 1 ? (
            <Select k="default_company_id" label="Firma" hint="Firma, mit der neue Projekte und Angebote starten."
              options={companyList.map(c => ({ value: String(c.ID), label: c.COMPANY_NAME_1 }))} />
          ) : (
            <div className="form-group">
              <span className="vb-static-label">Firma</span>
              <p className="form-field-hint vb-static">
                {companyList[0]?.COMPANY_NAME_1 ? `„${companyList[0].COMPANY_NAME_1}"` : 'Die hinterlegte Firma'} wird
                automatisch gesetzt — es gibt nur eine.
              </p>
            </div>
          )}
          <Select k="default_project_status_id" label="Projektstatus"
            options={(pStatuses?.data ?? []).map(s => ({ value: String(s.ID), label: s.ABBR }))} />
          <Select k="default_offer_status_id" label="Angebotsstatus"
            options={(oStatuses?.data ?? []).map(s => ({ value: String(s.ID), label: s.ABBR }))} />
          <NumberField k="offer_valid_days" label="Gültigkeitsdauer eines Angebots" unit="Tage" integer placeholder="z. B. 30"
            hint="Das Gültigkeitsdatum eines neuen Angebots liegt so viele Tage nach dem Angebotsdatum. Ohne Angabe bleibt es leer." />
        </FormSection>

        <FormSection title="Verträge" help="contract.defaults"
          hint="Gilt für neu angelegte Verträge — bestehende ändern sich nicht und lassen sich im Projekt unter „Verträge“ anpassen.">
          <Select k="default_currency_id" label="Währung"
            options={(currencies?.data ?? []).map(c => ({ value: String(c.ID), label: c.ABBR }))} />
          <Select k="default_vat_id" label="MwSt."
            options={(vats?.data ?? []).map(v => ({ value: String(v.ID), label: `${v.VAT}: ${String(v.VAT_PERCENT).replace('.', ',')} %` }))} />
          <NumberField k="default_cash_discount_percent" label="Skonto" unit="%" placeholder="z. B. 2" help="invoice.skonto" />
          <NumberField k="default_cash_discount_days" label="Skonto-Frist" unit="Tage" integer placeholder="z. B. 14" />
          <Toggle k="default_se_enabled" label="Sicherheitseinbehalt vereinbart" defaultOn={false} />
          {seOn && (
            <div className="vb-sub form-section-wide">
              <NumberField k="default_se_percent" label="Sicherheitseinbehalt" unit="%" placeholder="z. B. 5" help="invoice.sicherheitseinbehalt" />
              <Choice k="default_se_basis" label="Basis" fallback="BRUTTO"
                options={[{ value: 'BRUTTO', label: 'vom Brutto' }, { value: 'NETTO', label: 'vom Netto' }]} />
              <TextField k="default_se_legal_reference" label="Rechtsgrundlage" placeholder="z. B. § 17 VOB/B" max={200} wide />
            </div>
          )}
        </FormSection>

        <FormSection title="Rechnungen">
          <NumberField k="default_payment_term_days" label="Zahlungsziel" unit="Kalendertage" integer placeholder="z. B. 14" help="invoice.payment_term"
            hint="Fälligkeit = Rechnungsdatum plus diese Tage — in allen Rechnungsassistenten." />
          <Select k="default_payment_means_id" label="Zahlungsart" help="invoice.payment_means"
            hint="Geht als BT-81 in die E-Rechnung. Die Liste folgt der Codeliste UNTDID 4461."
            options={(payMeans?.data ?? []).map(p => ({ value: String(p.ID), label: p.NAME }))} />
        </FormSection>

        <FormSection title="Zeiterfassung">
          <Toggle k="timer_enabled" label="Stempeluhr in der Kopfzeile" defaultOn
            hint="Aus: Start, Pause und Stopp verschwinden aus der Kopfzeile. Erfasste Buchungen bleiben, wie sie sind." />
        </FormSection>

        <FormSection title="Budget-Warnungen">
          <Toggle k="budget_warning_enabled" label="Budget-Warnungen auswerten" defaultOn
            hint="Aus: neue Projekte bekommen keine Standardregeln, bestehende Regeln lösen nichts aus." />
          <TextField k="budget_warning_default_pcts" label="Standard-Schwellen (%)" placeholder="75, 90, 100" help="budget.warnschwellen"
            inputMode="decimal" wide
            hint="Durch Komma getrennt. Ohne Angabe: 75, 90 und 100 %. Je Projekt im Reiter „Budget“ änderbar." />
          <fieldset className="ws-radio-group form-section-wide vb-recipients">
            <legend className="ws-label-help">Wer benachrichtigt wird<HelpHint id="notifications.budget.recipients" size={13} /></legend>
            <Toggle k="budget_warning_notify_pm" label="Projektleitung" defaultOn />
            <Toggle k="budget_warning_notify_booker" label="Wer die Buchung verursacht hat" defaultOn />
          </fieldset>
        </FormSection>

        <FormSection title="Teilfertige Leistungen" help="report.tfl.was"
          hint="Bewertung im Report „Teilfertige Leistungen“. Den Prozentsatz gibt üblicherweise die Steuerberatung vor.">
          <NumberField k="wip_cost_factor_percent" label="Bewertungsfaktor Kosten" unit="%" placeholder="100" help="report.tfl.kostenfaktor"
            hint="Anteil der gebuchten Kosten, der als Herstellungskosten gilt (ohne Vertriebskosten, § 255 Abs. 2 S. 4 HGB). Ohne Angabe: 100 %." />
          <Choice k="wip_method_default" label="Vorbelegte Bewertungsmethode" fallback="hk" help="report.tfl.methode"
            hint="Im Report bleibt sie umschaltbar."
            options={[{ value: 'hk', label: 'Herstellkosten (HGB) — Bilanzansatz' }, { value: 'erloes', label: 'Leistungswert — Controlling-Sicht' }]} />
          <NumberField k="wip_tax_cost_factor_percent" label="Bewertungsfaktor Steuerbilanz" unit="%" placeholder="leer = kein zweiter Wertansatz" help="report.tfl.steuerbilanz"
            hint="Nur, wenn Handels- und Steuerbilanz verschieden bewerten. Leer heißt: kein zweiter Wert — nicht 0 %." />
          <NumberField k="wip_target_cost_ratio_percent" label="Zielkostenquote für die Gegenprobe" unit="%" placeholder="z. B. 65" help="report.tfl.gegenprobe"
            hint="Kostenanteil am Honorar, mit dem kalkuliert ist. Ohne Angabe bleiben die Spalten der Gegenprobe aus." />
        </FormSection>

        <FormSection title="Controlling-Ampel" help="report.kpi_ampel"
          hint="Ab welchem CPI (Leistung geteilt durch Kosten) ein Projekt in Reports und Übersicht markiert wird. 1,00 heißt: die Leistung deckt die Kosten genau.">
          <NumberField k="kpi_cpi_watch_threshold" label="„beobachten“ unter" placeholder="0,95" help="report.kpi_schwellen"
            hint="Ohne Angabe: 0,95." />
          <NumberField k="kpi_cpi_critical_threshold" label="„Handlungsbedarf“ unter" placeholder="0,80"
            hint="Muss unter „beobachten“ liegen. Ohne Angabe: 0,80." />
        </FormSection>
      </fieldset>
      </VbCtx.Provider>

      <Message type="error" text={err} />

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
      {confirmDialog}
    </div>
  )
}
