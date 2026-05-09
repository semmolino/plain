import { useState, useEffect, useCallback } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Tabs }      from '@/components/ui/Tabs'
import { Message }   from '@/components/ui/Message'
import { FormField } from '@/components/ui/FormField'
import { fetchCountries, fetchCompanies, createDepartment, createTyp, createRolle,
         createCompany, updateCompany, fetchCurrencies, fetchVatList, fetchDefaults, putDefault,
         type Company } from '@/api/stammdaten'
import { fetchNumberRanges, saveNumberRanges } from '@/api/numberRanges'

const PAGE_TABS = [
  { id: 'stammdaten',    label: 'Stammdaten'    },
  { id: 'nummernkreise', label: 'Nummernkreise' },
  { id: 'unternehmen',   label: 'Unternehmen'   },
  { id: 'vorbelegungen', label: 'Vorbelegungen' },
]

// ── Stammdaten ────────────────────────────────────────────────────────────────

function SingleInputMutation({
  label, placeholder, onSubmit, isPending,
}: {
  label: string; placeholder?: string; onSubmit: (v: string) => void; isPending: boolean
}) {
  const [val, setVal] = useState('')
  return (
    <div className="admin-input-row">
      <input
        className="admin-single-input"
        placeholder={placeholder ?? 'Name eingeben …'}
        value={val}
        onChange={e => setVal(e.target.value)}
      />
      <button
        className="btn-small btn-save"
        disabled={isPending || !val.trim()}
        onClick={() => { onSubmit(val.trim()); setVal('') }}
        type="button"
      >
        {isPending ? '…' : 'Speichern'}
      </button>
      <span className="admin-field-label">{label}</span>
    </div>
  )
}

function StammdatenSection() {
  const [msg, setMsg] = useState<{ text: string; type: 'success' | 'error' } | null>(null)
  const [rolleShort, setRolleShort] = useState('')
  const [rolleLong,  setRolleLong]  = useState('')
  const [rolleSpRate, setRolleSpRate] = useState('')

  function withMsg(mutFn: () => void) {
    setMsg(null); mutFn()
  }

  const deptMut = useMutation({
    mutationFn: createDepartment,
    onSuccess: () => setMsg({ text: 'Abteilung gespeichert ✅', type: 'success' }),
    onError: (e: Error) => setMsg({ text: e.message, type: 'error' }),
  })
  const typMut = useMutation({
    mutationFn: createTyp,
    onSuccess: () => setMsg({ text: 'Typ gespeichert ✅', type: 'success' }),
    onError: (e: Error) => setMsg({ text: e.message, type: 'error' }),
  })
  const rolleMut = useMutation({
    mutationFn: ({ short, long, spRate }: { short: string; long: string; spRate: string }) => createRolle(short, long, spRate),
    onSuccess: () => { setMsg({ text: 'Rolle gespeichert ✅', type: 'success' }); setRolleShort(''); setRolleLong(''); setRolleSpRate('') },
    onError: (e: Error) => setMsg({ text: e.message, type: 'error' }),
  })

  return (
    <div className="admin-section">
      <p className="admin-section-hint">Neue Einträge hinzufügen</p>

      <div className="admin-block">
        <h3 className="admin-block-title">Abteilung</h3>
        <SingleInputMutation
          label="Abteilung"
          onSubmit={v => withMsg(() => deptMut.mutate(v))}
          isPending={deptMut.isPending}
        />
      </div>

      <div className="admin-block">
        <h3 className="admin-block-title">Projekttyp</h3>
        <SingleInputMutation
          label="Typ"
          onSubmit={v => withMsg(() => typMut.mutate(v))}
          isPending={typMut.isPending}
        />
      </div>

      <div className="admin-block">
        <h3 className="admin-block-title">Rollen</h3>
        <div className="form-row">
          <div className="form-group">
            <label>Kürzel*</label>
            <input value={rolleShort} onChange={e => setRolleShort(e.target.value)} placeholder="z. B. PL" />
          </div>
          <div className="form-group">
            <label>Bezeichnung</label>
            <input value={rolleLong} onChange={e => setRolleLong(e.target.value)} placeholder="z. B. Projektleiter" />
          </div>
          <div className="form-group">
            <label>SP-Rate</label>
            <input type="number" step="0.01" min="0" value={rolleSpRate} onChange={e => setRolleSpRate(e.target.value)} placeholder="z. B. 95.00" />
          </div>
        </div>
        <button
          className="btn-small btn-save"
          disabled={rolleMut.isPending || !rolleShort.trim()}
          onClick={() => { setMsg(null); rolleMut.mutate({ short: rolleShort.trim(), long: rolleLong.trim(), spRate: rolleSpRate.trim() }) }}
          type="button"
        >
          {rolleMut.isPending ? 'Speichert …' : 'Speichern'}
        </button>
      </div>

      <Message text={msg?.text ?? null} type={msg?.type} />
    </div>
  )
}

// ── Nummernkreise ─────────────────────────────────────────────────────────────

const YEAR = new Date().getFullYear()

function nrFormatInvoice(v: number) {
  const c = String(Math.max(0, v)).padStart(4, '0')
  return `RE-${YEAR}-${c}`
}
function nrFormatProject(v: number) {
  const yy = String(YEAR % 100).padStart(2, '0')
  const c  = String(Math.max(0, v)).padStart(3, '0')
  return `P-${yy}-${c}`
}

function NummernkreiseSection() {
  const [invoiceNext, setInvoiceNext] = useState(1)
  const [projectNext, setProjectNext] = useState(1)
  const [msg, setMsg] = useState<{ text: string; type: 'success' | 'error' | 'info' } | null>(null)

  const { data, isLoading } = useQuery({
    queryKey: ['number-ranges', YEAR],
    queryFn:  () => fetchNumberRanges(YEAR),
  })

  useEffect(() => {
    if (data) {
      setInvoiceNext(data.next_counter ?? 1)
      setProjectNext(data.project_next_counter ?? 1)
    }
  }, [data])

  const saveMut = useMutation({
    mutationFn: saveNumberRanges,
    onSuccess: () => setMsg({ text: 'Nummernkreise gespeichert ✅', type: 'success' }),
    onError: (e: Error) => setMsg({ text: e.message, type: 'error' }),
  })

  function handleSave() {
    const v = invoiceNext
    const p = projectNext
    if (!Number.isFinite(v) || v < 1 || v > 9999) {
      setMsg({ text: 'Rechnungsnummer: Wert 1–9999', type: 'error' }); return
    }
    if (!Number.isFinite(p) || p < 1 || p > 999) {
      setMsg({ text: 'Projektnummer: Wert 1–999', type: 'error' }); return
    }
    setMsg(null)
    saveMut.mutate({ year: YEAR, next_counter: v, project_next_counter: p })
  }

  return (
    <div className="admin-section">
      {isLoading && <p className="empty-note">Laden …</p>}
      {!isLoading && (
        <>
          <div className="admin-block">
            <h3 className="admin-block-title">Rechnungen / Abschlagsrechnungen ({YEAR})</h3>
            <div className="form-group">
              <label>Nächste Nummer</label>
              <input
                type="number" min={1} max={9999}
                value={invoiceNext}
                onChange={e => setInvoiceNext(parseInt(e.target.value, 10) || 1)}
              />
            </div>
            <p className="nr-preview">Vorschau: {nrFormatInvoice(invoiceNext)}</p>
          </div>

          <div className="admin-block">
            <h3 className="admin-block-title">Projekte ({YEAR})</h3>
            <div className="form-group">
              <label>Nächste Nummer</label>
              <input
                type="number" min={1} max={999}
                value={projectNext}
                onChange={e => setProjectNext(parseInt(e.target.value, 10) || 1)}
              />
            </div>
            <p className="nr-preview">Vorschau: {nrFormatProject(projectNext)}</p>
          </div>

          <Message text={msg?.text ?? null} type={msg?.type} />
          <button className="btn-primary" style={{ marginTop: 8 }} onClick={handleSave} disabled={saveMut.isPending} type="button">
            {saveMut.isPending ? 'Speichert …' : 'Speichern'}
          </button>
        </>
      )}
    </div>
  )
}

// ── Unternehmen ───────────────────────────────────────────────────────────────

const EMPTY_COMPANY_FORM = {
  company_name_1: '', company_name_2: '', street: '', post_code: '', city: '',
  post_office_box: '', country_id: '', tax_number: '', tax_id: '',
  bic: '', iban: '', creditor_id: '',
}

function companyToForm(c: Company) {
  return {
    company_name_1: c.COMPANY_NAME_1 ?? '',
    company_name_2: c.COMPANY_NAME_2 ?? '',
    street:         c.STREET ?? '',
    post_code:      c.POST_CODE ?? '',
    city:           c.CITY ?? '',
    post_office_box: c.POST_OFFICE_BOX ?? '',
    country_id:     c.COUNTRY_ID ?? '',
    tax_number:     c.TAX_NUMBER ?? '',
    tax_id:         c['TAX-ID'] ?? '',
    bic:            c.BIC ?? '',
    iban:           c.IBAN ?? '',
    creditor_id:    c['CREDITOR-ID'] ?? '',
  }
}

function UnternehmenSection() {
  const qc = useQueryClient()
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [form, setForm] = useState({ ...EMPTY_COMPANY_FORM })
  const [msg, setMsg] = useState<{ text: string; type: 'success' | 'error' } | null>(null)

  const { data: companiesData } = useQuery({ queryKey: ['companies'], queryFn: fetchCompanies })
  const { data: countriesData } = useQuery({ queryKey: ['countries'], queryFn: fetchCountries })
  const companies = companiesData?.data ?? []
  const countries = countriesData?.data ?? []

  const loadCompany = useCallback((c: Company) => {
    setSelectedId(c.ID)
    setForm(companyToForm(c))
    setMsg(null)
  }, [])

  function newCompany() {
    setSelectedId(null)
    setForm({ ...EMPTY_COMPANY_FORM })
    setMsg(null)
  }

  const onSuccess = () => {
    qc.invalidateQueries({ queryKey: ['companies'] })
    setMsg({ text: 'Unternehmen gespeichert ✅', type: 'success' })
  }
  const onError = (e: Error) => setMsg({ text: e.message, type: 'error' })

  const createMut = useMutation({ mutationFn: createCompany, onSuccess, onError })
  const updateMut = useMutation({
    mutationFn: (body: typeof form) => updateCompany(selectedId!, body),
    onSuccess, onError,
  })

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setMsg(null)
    if (!form.company_name_1.trim()) {
      setMsg({ text: 'Firmenname 1 ist erforderlich', type: 'error' }); return
    }
    if (selectedId !== null) {
      updateMut.mutate(form)
    } else {
      createMut.mutate(form)
    }
  }

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm(f => ({ ...f, [k]: e.target.value }))

  const isPending = createMut.isPending || updateMut.isPending

  return (
    <div className="admin-section">
      {/* Company selector */}
      <div className="admin-company-selector">
        {companies.map(c => (
          <button
            key={c.ID}
            type="button"
            className={`admin-company-btn${selectedId === c.ID ? ' active' : ''}`}
            onClick={() => loadCompany(c)}
          >
            {c.COMPANY_NAME_1}
          </button>
        ))}
        <button
          type="button"
          className={`admin-company-btn${selectedId === null ? ' active' : ''}`}
          onClick={newCompany}
        >
          + Neue Firma
        </button>
      </div>

      <form onSubmit={handleSubmit} className="master-form">
        <FormField label="Unternehmen*"               id="ufn1" value={form.company_name_1}  onChange={set('company_name_1')}  required />
        <FormField label="Unternehmen (Zusatz)"        id="ufn2" value={form.company_name_2}  onChange={set('company_name_2')} />
        <FormField label="Straße"                      id="ust"  value={form.street}          onChange={set('street')} />
        <div className="form-row">
          <FormField label="PLZ"                       id="upc"  value={form.post_code}       onChange={set('post_code')} />
          <FormField label="Stadt"                     id="uct"  value={form.city}            onChange={set('city')} />
        </div>
        <FormField label="Postfach"                    id="upob" value={form.post_office_box} onChange={set('post_office_box')} />
        <div className="form-group">
          <label htmlFor="uco">Land</label>
          <select id="uco" value={form.country_id} onChange={set('country_id')}>
            <option value="">Bitte wählen …</option>
            {countries.map(c => (
              <option key={c.ID} value={c.ID}>{c.NAME_SHORT}: {c.NAME_LONG}</option>
            ))}
          </select>
        </div>
        <FormField label="Steuernummer"                id="utn"  value={form.tax_number}      onChange={set('tax_number')} />
        <FormField label="Steuer-IdNr."                id="uti"  value={form.tax_id}          onChange={set('tax_id')} />
        <FormField label="BIC"                         id="ubic" value={form.bic}             onChange={set('bic')} />
        <FormField label="IBAN"                        id="uiban" value={form.iban}           onChange={set('iban')} />
        <FormField label="Gläubiger-Identifikationsnummer" id="ucid" value={form.creditor_id} onChange={set('creditor_id')} />
        <Message text={msg?.text ?? null} type={msg?.type} />
        <button className="btn-primary" type="submit" disabled={isPending}>
          {isPending ? 'Speichert …' : selectedId !== null ? 'Änderungen speichern' : 'Neu anlegen'}
        </button>
      </form>
    </div>
  )
}

// ── Vorbelegungen ─────────────────────────────────────────────────────────────

function VorbelegungenSection() {
  const [msg, setMsg] = useState<{ text: string; type: 'success' | 'error' } | null>(null)
  const [currencyId, setCurrencyId] = useState('')
  const [vatId,      setVatId]      = useState('')

  const { data: currData } = useQuery({ queryKey: ['currencies'],   queryFn: fetchCurrencies })
  const { data: vatData  } = useQuery({ queryKey: ['vat-list'],     queryFn: fetchVatList })
  const { data: defData, isLoading } = useQuery({ queryKey: ['defaults'], queryFn: fetchDefaults })

  const currencies = currData?.data ?? []
  const vatList    = vatData?.data  ?? []

  useEffect(() => {
    if (!defData?.data) return
    setCurrencyId(defData.data.default_currency_id ?? '')
    setVatId(defData.data.default_vat_id ?? '')
  }, [defData?.data])

  const saveMut = useMutation({
    mutationFn: async () => {
      await putDefault('default_currency_id', currencyId || null)
      await putDefault('default_vat_id',      vatId      || null)
    },
    onSuccess: () => setMsg({ text: 'Vorbelegungen gespeichert ✅', type: 'success' }),
    onError:   (e: Error) => setMsg({ text: e.message, type: 'error' }),
  })

  return (
    <div className="admin-section">
      <p className="admin-section-hint">
        Diese Werte werden automatisch bei der Erstellung neuer Verträge vorbelegt.
      </p>

      {isLoading && <p className="empty-note">Laden …</p>}

      {!isLoading && (
        <>
          <div className="admin-block">
            <h3 className="admin-block-title">Vertrag</h3>

            <div className="form-group">
              <label>Währung</label>
              <select value={currencyId} onChange={e => setCurrencyId(e.target.value)}>
                <option value="">— keine Vorbelegung —</option>
                {currencies.map(c => (
                  <option key={c.ID} value={c.ID}>{c.NAME_SHORT}</option>
                ))}
              </select>
            </div>

            <div className="form-group">
              <label>MwSt.</label>
              <select value={vatId} onChange={e => setVatId(e.target.value)}>
                <option value="">— keine Vorbelegung —</option>
                {vatList.map(v => (
                  <option key={v.ID} value={v.ID}>{v.VAT}: {v.VAT_PERCENT} %</option>
                ))}
              </select>
            </div>
          </div>

          <Message text={msg?.text ?? null} type={msg?.type} />
          <button
            className="btn-primary"
            style={{ marginTop: 8 }}
            disabled={saveMut.isPending}
            onClick={() => { setMsg(null); saveMut.mutate() }}
            type="button"
          >
            {saveMut.isPending ? 'Speichert …' : 'Speichern'}
          </button>
        </>
      )}
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export function AdminPage() {
  const [tab, setTab] = useState('stammdaten')
  return (
    <div className="master-page">
      <div className="master-page-header">
        <h1 className="master-page-title">Administration</h1>
      </div>
      <Tabs tabs={PAGE_TABS} active={tab} onChange={setTab} />
      <div className="master-section">
        {tab === 'stammdaten'    && <StammdatenSection />}
        {tab === 'nummernkreise' && <NummernkreiseSection />}
        {tab === 'unternehmen'   && <UnternehmenSection />}
        {tab === 'vorbelegungen' && <VorbelegungenSection />}
      </div>
    </div>
  )
}
