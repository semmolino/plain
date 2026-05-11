import { useState, useEffect, useCallback, useRef } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Tabs }      from '@/components/ui/Tabs'
import { Message }   from '@/components/ui/Message'
import { FormField } from '@/components/ui/FormField'
import {
  fetchCountries, fetchCompanies, createDepartment, createTyp, createRolle,
  createCompany, updateCompany, fetchCurrencies, fetchVatList, fetchDefaults, putDefault,
  fetchDepartments, deleteDepartment, fetchTypen, deleteTyp, fetchRollen, deleteRolle,
  fetchLogo, putLogo, uploadAsset,
  type Company, type StammdatenItem, type Rolle,
} from '@/api/stammdaten'
import { createOfferStatus, deleteOfferStatus, fetchOfferStatuses } from '@/api/angebote'
import { useCtrlS } from '@/hooks/useCtrlS'
import { fetchNumberRanges, saveNumberRanges } from '@/api/numberRanges'

const PAGE_TABS = [
  { id: 'stammdaten',    label: 'Stammdaten'    },
  { id: 'nummernkreise', label: 'Nummernkreise' },
  { id: 'unternehmen',   label: 'Unternehmen'   },
  { id: 'vorbelegungen', label: 'Vorbelegungen' },
]

// ── Small helpers ─────────────────────────────────────────────────────────────

function TagList({ items, onDelete }: { items: { ID: number; label: string }[]; onDelete: (id: number) => void }) {
  if (!items.length) return <p className="empty-note" style={{ margin: '4px 0 8px' }}>Noch keine Einträge.</p>
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
      {items.map(it => (
        <span key={it.ID} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: '#f3f4f6', border: '1px solid #e5e7eb', borderRadius: 4, padding: '2px 8px', fontSize: 12 }}>
          {it.label}
          <button
            type="button"
            onClick={() => onDelete(it.ID)}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#6b7280', fontSize: 14, lineHeight: 1, padding: 0 }}
            title="Löschen"
          >×</button>
        </span>
      ))}
    </div>
  )
}

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
        onKeyDown={e => { if (e.key === 'Enter' && val.trim()) { onSubmit(val.trim()); setVal('') } }}
      />
      <button
        className="btn-small btn-save"
        disabled={isPending || !val.trim()}
        onClick={() => { onSubmit(val.trim()); setVal('') }}
        type="button"
      >
        {isPending ? '…' : 'Hinzufügen'}
      </button>
      <span className="admin-field-label">{label}</span>
    </div>
  )
}

// ── Stammdaten ────────────────────────────────────────────────────────────────

function StammdatenSection() {
  const qc = useQueryClient()
  const [msg, setMsg] = useState<{ text: string; type: 'success' | 'error' } | null>(null)
  const [rolleShort, setRolleShort] = useState('')
  const [rolleLong,  setRolleLong]  = useState('')
  const [rolleSpRate, setRolleSpRate] = useState('')

  const { data: deptData  } = useQuery({ queryKey: ['departments'],   queryFn: fetchDepartments })
  const { data: typenData  } = useQuery({ queryKey: ['typen'],        queryFn: fetchTypen })
  const { data: rollenData } = useQuery({ queryKey: ['rollen'],       queryFn: fetchRollen })
  const { data: statusData } = useQuery({ queryKey: ['offer-statuses'], queryFn: fetchOfferStatuses })

  const departments  = deptData?.data   ?? []
  const typen        = typenData?.data  ?? []
  const rollen       = rollenData?.data ?? []
  const offerStatuses = statusData?.data ?? []

  function withMsg(mutFn: () => void) { setMsg(null); mutFn() }

  const deptMut = useMutation({
    mutationFn: createDepartment,
    onSuccess: () => { setMsg({ text: 'Abteilung gespeichert ✅', type: 'success' }); void qc.invalidateQueries({ queryKey: ['departments'] }) },
    onError: (e: Error) => setMsg({ text: e.message, type: 'error' }),
  })
  const delDeptMut = useMutation({
    mutationFn: deleteDepartment,
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['departments'] }),
    onError: (e: Error) => setMsg({ text: e.message, type: 'error' }),
  })

  const typMut = useMutation({
    mutationFn: createTyp,
    onSuccess: () => { setMsg({ text: 'Typ gespeichert ✅', type: 'success' }); void qc.invalidateQueries({ queryKey: ['typen'] }) },
    onError: (e: Error) => setMsg({ text: e.message, type: 'error' }),
  })
  const delTypMut = useMutation({
    mutationFn: deleteTyp,
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['typen'] }),
    onError: (e: Error) => setMsg({ text: e.message, type: 'error' }),
  })

  const rolleMut = useMutation({
    mutationFn: ({ short, long, spRate }: { short: string; long: string; spRate: string }) => createRolle(short, long, spRate),
    onSuccess: () => {
      setMsg({ text: 'Rolle gespeichert ✅', type: 'success' })
      setRolleShort(''); setRolleLong(''); setRolleSpRate('')
      void qc.invalidateQueries({ queryKey: ['rollen'] })
    },
    onError: (e: Error) => setMsg({ text: e.message, type: 'error' }),
  })
  const delRolleMut = useMutation({
    mutationFn: deleteRolle,
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['rollen'] }),
    onError: (e: Error) => setMsg({ text: e.message, type: 'error' }),
  })

  const offerStatusMut = useMutation({
    mutationFn: (name: string) => createOfferStatus(name),
    onSuccess: () => { setMsg({ text: 'Angebotsstatus gespeichert ✅', type: 'success' }); void qc.invalidateQueries({ queryKey: ['offer-statuses'] }) },
    onError: (e: Error) => setMsg({ text: e.message, type: 'error' }),
  })
  const delOfferStatusMut = useMutation({
    mutationFn: deleteOfferStatus,
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['offer-statuses'] }),
    onError: (e: Error) => setMsg({ text: e.message, type: 'error' }),
  })

  return (
    <div className="admin-section">
      <div className="admin-block">
        <h3 className="admin-block-title">Abteilungen</h3>
        <TagList
          items={departments.map((d: StammdatenItem) => ({ ID: d.ID, label: d.NAME_SHORT }))}
          onDelete={id => withMsg(() => delDeptMut.mutate(id))}
        />
        <SingleInputMutation label="Abteilung" onSubmit={v => withMsg(() => deptMut.mutate(v))} isPending={deptMut.isPending} />
      </div>

      <div className="admin-block">
        <h3 className="admin-block-title">Projekttypen</h3>
        <TagList
          items={typen.map((t: StammdatenItem) => ({ ID: t.ID, label: t.NAME_SHORT }))}
          onDelete={id => withMsg(() => delTypMut.mutate(id))}
        />
        <SingleInputMutation label="Typ" onSubmit={v => withMsg(() => typMut.mutate(v))} isPending={typMut.isPending} />
      </div>

      <div className="admin-block">
        <h3 className="admin-block-title">Rollen</h3>
        {rollen.length > 0 && (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, marginBottom: 10 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #e5e7eb', color: '#6b7280' }}>
                <th style={{ textAlign: 'left', padding: '2px 6px 4px 0' }}>Kürzel</th>
                <th style={{ textAlign: 'left', padding: '2px 6px 4px 0' }}>Bezeichnung</th>
                <th style={{ textAlign: 'right', padding: '2px 0 4px 6px' }}>SP-Rate</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rollen.map((r: Rolle) => (
                <tr key={r.ID} style={{ borderBottom: '1px solid #f3f4f6' }}>
                  <td style={{ padding: '3px 6px 3px 0', fontWeight: 600 }}>{r.NAME_SHORT}</td>
                  <td style={{ padding: '3px 6px 3px 0', color: '#374151' }}>{r.NAME_LONG ?? '—'}</td>
                  <td style={{ padding: '3px 0 3px 6px', textAlign: 'right', color: '#374151' }}>
                    {r.SP_RATE != null ? `${r.SP_RATE} €/h` : '—'}
                  </td>
                  <td style={{ padding: '3px 0 3px 6px' }}>
                    <button type="button" className="btn-small btn-danger" style={{ padding: '1px 6px', fontSize: 11 }} onClick={() => withMsg(() => delRolleMut.mutate(r.ID))}>×</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {!rollen.length && <p className="empty-note" style={{ margin: '4px 0 8px' }}>Noch keine Rollen.</p>}
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
          {rolleMut.isPending ? 'Speichert …' : 'Hinzufügen'}
        </button>
      </div>

      <div className="admin-block">
        <h3 className="admin-block-title">Angebotsstatus</h3>
        <TagList
          items={offerStatuses.map(s => ({ ID: s.ID, label: s.NAME_SHORT }))}
          onDelete={id => withMsg(() => delOfferStatusMut.mutate(id))}
        />
        <SingleInputMutation
          label="Angebotsstatus"
          placeholder="z. B. In Bearbeitung"
          onSubmit={v => withMsg(() => offerStatusMut.mutate(v))}
          isPending={offerStatusMut.isPending}
        />
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
function nrFormatOffer(v: number) {
  const yy = String(YEAR % 100).padStart(2, '0')
  const c  = String(Math.max(0, v)).padStart(3, '0')
  return `A-${yy}-${c}`
}

function NummernkreiseSection() {
  const [invoiceNext, setInvoiceNext] = useState(1)
  const [projectNext, setProjectNext] = useState(1)
  const [offerNext,   setOfferNext]   = useState(1)
  const [msg, setMsg] = useState<{ text: string; type: 'success' | 'error' | 'info' } | null>(null)

  const { data, isLoading } = useQuery({
    queryKey: ['number-ranges', YEAR],
    queryFn:  () => fetchNumberRanges(YEAR),
    staleTime: 0,
  })

  useEffect(() => {
    if (data) {
      setInvoiceNext(data.next_counter ?? 1)
      setProjectNext(data.project_next_counter ?? 1)
      setOfferNext(data.offer_next_counter ?? 1)
    }
  }, [data])

  const saveMut = useMutation({
    mutationFn: saveNumberRanges,
    onSuccess: () => setMsg({ text: 'Nummernkreise gespeichert ✅', type: 'success' }),
    onError: (e: Error) => setMsg({ text: e.message, type: 'error' }),
  })

  function handleSave() {
    if (!Number.isFinite(invoiceNext) || invoiceNext < 1 || invoiceNext > 9999) {
      setMsg({ text: 'Rechnungsnummer: Wert 1–9999', type: 'error' }); return
    }
    if (!Number.isFinite(projectNext) || projectNext < 1 || projectNext > 999) {
      setMsg({ text: 'Projektnummer: Wert 1–999', type: 'error' }); return
    }
    if (!Number.isFinite(offerNext) || offerNext < 1 || offerNext > 999) {
      setMsg({ text: 'Angebotsnummer: Wert 1–999', type: 'error' }); return
    }
    setMsg(null)
    saveMut.mutate({ year: YEAR, next_counter: invoiceNext, project_next_counter: projectNext, offer_next_counter: offerNext })
  }

  useCtrlS(handleSave, !isLoading)

  return (
    <div className="admin-section">
      {isLoading && <p className="empty-note">Laden …</p>}
      {!isLoading && (
        <>
          <div className="admin-block">
            <h3 className="admin-block-title">Rechnungen / Abschlagsrechnungen ({YEAR})</h3>
            <div className="form-group">
              <label>Nächste Nummer</label>
              <input type="number" min={1} max={9999} value={invoiceNext} onChange={e => setInvoiceNext(parseInt(e.target.value, 10) || 1)} />
            </div>
            <p className="nr-preview">Vorschau: {nrFormatInvoice(invoiceNext)}</p>
          </div>
          <div className="admin-block">
            <h3 className="admin-block-title">Projekte ({YEAR})</h3>
            <div className="form-group">
              <label>Nächste Nummer</label>
              <input type="number" min={1} max={999} value={projectNext} onChange={e => setProjectNext(parseInt(e.target.value, 10) || 1)} />
            </div>
            <p className="nr-preview">Vorschau: {nrFormatProject(projectNext)}</p>
          </div>
          <div className="admin-block">
            <h3 className="admin-block-title">Angebote ({YEAR})</h3>
            <div className="form-group">
              <label>Nächste Nummer</label>
              <input type="number" min={1} max={999} value={offerNext} onChange={e => setOfferNext(parseInt(e.target.value, 10) || 1)} />
            </div>
            <p className="nr-preview">Vorschau: {nrFormatOffer(offerNext)}</p>
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

function LogoSection() {
  const qc = useQueryClient()
  const [msg, setMsg] = useState<{ text: string; type: 'success' | 'error' } | null>(null)
  const [uploading, setUploading] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const { data: logoData } = useQuery({ queryKey: ['logo'], queryFn: fetchLogo })
  const logoAssetId = logoData?.data?.logo_asset_id ?? null

  const putLogoMut = useMutation({
    mutationFn: putLogo,
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['logo'] }); setMsg({ text: 'Logo gespeichert ✅', type: 'success' }) },
    onError: (e: Error) => setMsg({ text: e.message, type: 'error' }),
  })

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setMsg(null)
    setUploading(true)
    try {
      const res = await uploadAsset(file, 'LOGO')
      const assetId = res.data.ID
      putLogoMut.mutate(assetId)
    } catch (err) {
      setMsg({ text: err instanceof Error ? err.message : 'Upload fehlgeschlagen', type: 'error' })
    } finally {
      setUploading(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  return (
    <div className="admin-block">
      <h3 className="admin-block-title">Firmenlogo (für PDF-Dokumente)</h3>
      {logoAssetId ? (
        <div style={{ marginBottom: 10 }}>
          <img
            src={`/api/v1/assets/${logoAssetId}`}
            alt="Logo"
            style={{ maxHeight: 60, maxWidth: 200, objectFit: 'contain', display: 'block', marginBottom: 8, border: '1px solid #e5e7eb', borderRadius: 4, padding: 4 }}
          />
          <button type="button" className="btn-small btn-danger" onClick={() => putLogoMut.mutate(null)} disabled={putLogoMut.isPending}>
            Logo entfernen
          </button>
        </div>
      ) : (
        <p className="empty-note" style={{ margin: '4px 0 10px' }}>Kein Logo gesetzt.</p>
      )}
      <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
        <input ref={inputRef} type="file" accept="image/jpeg,image/png,image/svg+xml,image/webp" style={{ display: 'none' }} onChange={e => void handleFile(e)} />
        <button type="button" className="btn-small" onClick={() => inputRef.current?.click()} disabled={uploading || putLogoMut.isPending}>
          {uploading ? 'Wird hochgeladen …' : logoAssetId ? 'Logo ersetzen' : 'Logo hochladen'}
        </button>
        <span style={{ fontSize: 11, color: '#6b7280' }}>PNG, JPG, SVG · max. 10 MB</span>
      </label>
      <Message text={msg?.text ?? null} type={msg?.type} />
    </div>
  )
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
    setSelectedId(c.ID); setForm(companyToForm(c)); setMsg(null)
  }, [])

  function newCompany() { setSelectedId(null); setForm({ ...EMPTY_COMPANY_FORM }); setMsg(null) }

  const onSuccess = () => { void qc.invalidateQueries({ queryKey: ['companies'] }); setMsg({ text: 'Unternehmen gespeichert ✅', type: 'success' }) }
  const onError   = (e: Error) => setMsg({ text: e.message, type: 'error' })

  const createMut = useMutation({ mutationFn: createCompany, onSuccess, onError })
  const updateMut = useMutation({ mutationFn: (body: typeof form) => updateCompany(selectedId!, body), onSuccess, onError })

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault(); setMsg(null)
    if (!form.company_name_1.trim()) { setMsg({ text: 'Firmenname 1 ist erforderlich', type: 'error' }); return }
    if (selectedId !== null) updateMut.mutate(form)
    else createMut.mutate(form)
  }

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm(f => ({ ...f, [k]: e.target.value }))

  const isPending = createMut.isPending || updateMut.isPending
  const formRef = useRef<HTMLFormElement>(null)
  useCtrlS(() => formRef.current?.requestSubmit(), !isPending)

  return (
    <div className="admin-section">
      <LogoSection />

      <div className="admin-company-selector" style={{ marginTop: 16 }}>
        {companies.map(c => (
          <button key={c.ID} type="button" className={`admin-company-btn${selectedId === c.ID ? ' active' : ''}`} onClick={() => loadCompany(c)}>
            {c.COMPANY_NAME_1}
          </button>
        ))}
        <button type="button" className={`admin-company-btn${selectedId === null ? ' active' : ''}`} onClick={newCompany}>
          + Neue Firma
        </button>
      </div>

      <form ref={formRef} onSubmit={handleSubmit} className="master-form">
        <FormField label="Unternehmen*"                    id="ufn1"  value={form.company_name_1}  onChange={set('company_name_1')} required />
        <FormField label="Unternehmen (Zusatz)"            id="ufn2"  value={form.company_name_2}  onChange={set('company_name_2')} />
        <FormField label="Straße"                          id="ust"   value={form.street}          onChange={set('street')} />
        <div className="form-row">
          <FormField label="PLZ"                           id="upc"   value={form.post_code}       onChange={set('post_code')} />
          <FormField label="Stadt"                         id="uct"   value={form.city}            onChange={set('city')} />
        </div>
        <FormField label="Postfach"                        id="upob"  value={form.post_office_box} onChange={set('post_office_box')} />
        <div className="form-group">
          <label htmlFor="uco">Land</label>
          <select id="uco" value={form.country_id} onChange={set('country_id')}>
            <option value="">Bitte wählen …</option>
            {countries.map(c => <option key={c.ID} value={c.ID}>{c.NAME_SHORT}: {c.NAME_LONG}</option>)}
          </select>
        </div>
        <FormField label="Steuernummer"                    id="utn"   value={form.tax_number}      onChange={set('tax_number')} />
        <FormField label="Steuer-IdNr."                    id="uti"   value={form.tax_id}          onChange={set('tax_id')} />
        <FormField label="BIC"                             id="ubic"  value={form.bic}             onChange={set('bic')} />
        <FormField label="IBAN"                            id="uiban" value={form.iban}            onChange={set('iban')} />
        <FormField label="Gläubiger-Identifikationsnummer" id="ucid"  value={form.creditor_id}     onChange={set('creditor_id')} />
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
  const [currencyId,     setCurrencyId]     = useState('')
  const [vatId,          setVatId]          = useState('')
  const [offerValidDays, setOfferValidDays] = useState('')

  const { data: currData } = useQuery({ queryKey: ['currencies'],   queryFn: fetchCurrencies })
  const { data: vatData  } = useQuery({ queryKey: ['vat-list'],     queryFn: fetchVatList })
  const { data: defData, isLoading } = useQuery({ queryKey: ['defaults'], queryFn: fetchDefaults })

  const currencies = currData?.data ?? []
  const vatList    = vatData?.data  ?? []

  useEffect(() => {
    if (!defData?.data) return
    setCurrencyId(defData.data.default_currency_id ?? '')
    setVatId(defData.data.default_vat_id ?? '')
    setOfferValidDays(defData.data.offer_valid_days ?? '')
  }, [defData?.data])

  const saveMut = useMutation({
    mutationFn: async () => {
      await putDefault('default_currency_id', currencyId    || null)
      await putDefault('default_vat_id',      vatId         || null)
      await putDefault('offer_valid_days',     offerValidDays || null)
    },
    onSuccess: () => setMsg({ text: 'Vorbelegungen gespeichert ✅', type: 'success' }),
    onError:   (e: Error) => setMsg({ text: e.message, type: 'error' }),
  })

  useCtrlS(() => { setMsg(null); saveMut.mutate() }, !isLoading && !saveMut.isPending)

  return (
    <div className="admin-section">
      <p className="admin-section-hint">Diese Werte werden automatisch bei der Erstellung neuer Verträge vorbelegt.</p>
      {isLoading && <p className="empty-note">Laden …</p>}
      {!isLoading && (
        <>
          <div className="admin-block">
            <h3 className="admin-block-title">Vertrag</h3>
            <div className="form-group">
              <label>Währung</label>
              <select value={currencyId} onChange={e => setCurrencyId(e.target.value)}>
                <option value="">— keine Vorbelegung —</option>
                {currencies.map(c => <option key={c.ID} value={c.ID}>{c.NAME_SHORT}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label>MwSt.</label>
              <select value={vatId} onChange={e => setVatId(e.target.value)}>
                <option value="">— keine Vorbelegung —</option>
                {vatList.map(v => <option key={v.ID} value={v.ID}>{v.VAT}: {v.VAT_PERCENT} %</option>)}
              </select>
            </div>
          </div>
          <div className="admin-block">
            <h3 className="admin-block-title">Angebote</h3>
            <div className="form-group">
              <label>Gültigkeitsdauer (Tage)</label>
              <input
                type="number" min={1} max={365} step={1}
                value={offerValidDays}
                onChange={e => setOfferValidDays(e.target.value)}
                placeholder="z. B. 30"
              />
            </div>
            <p className="admin-section-hint">Tage, um die das Gültigkeitsdatum im Angebots-Wizard vorbelegt wird.</p>
          </div>
          <Message text={msg?.text ?? null} type={msg?.type} />
          <button className="btn-primary" style={{ marginTop: 8 }} disabled={saveMut.isPending} onClick={() => { setMsg(null); saveMut.mutate() }} type="button">
            {saveMut.isPending ? 'Speichert …' : 'Speichern'}
          </button>
        </>
      )}
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export function AdminPage() {
  const [searchParams] = useSearchParams()
  const initialTab = searchParams.get('tab') ?? 'stammdaten'
  const validTabs  = PAGE_TABS.map(t => t.id)
  const [tab, setTab] = useState(validTabs.includes(initialTab) ? initialTab : 'stammdaten')
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
