import { useState, useEffect } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import { Tabs }      from '@/components/ui/Tabs'
import { Message }   from '@/components/ui/Message'
import { FormField } from '@/components/ui/FormField'
import { fetchCountries, createStatus, createTyp, createRolle, createCompany } from '@/api/stammdaten'
import { fetchNumberRanges, saveNumberRanges } from '@/api/numberRanges'

const PAGE_TABS = [
  { id: 'stammdaten',   label: 'Stammdaten'   },
  { id: 'nummernkreise', label: 'Nummernkreise' },
  { id: 'unternehmen',  label: 'Unternehmen'  },
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

  function withMsg(mutFn: () => void) {
    setMsg(null); mutFn()
  }

  const statusMut = useMutation({
    mutationFn: createStatus,
    onSuccess: () => setMsg({ text: 'Status gespeichert ✅', type: 'success' }),
    onError: (e: Error) => setMsg({ text: e.message, type: 'error' }),
  })
  const typMut = useMutation({
    mutationFn: createTyp,
    onSuccess: () => setMsg({ text: 'Typ gespeichert ✅', type: 'success' }),
    onError: (e: Error) => setMsg({ text: e.message, type: 'error' }),
  })
  const rolleMut = useMutation({
    mutationFn: ({ short, long }: { short: string; long: string }) => createRolle(short, long),
    onSuccess: () => { setMsg({ text: 'Rolle gespeichert ✅', type: 'success' }); setRolleShort(''); setRolleLong('') },
    onError: (e: Error) => setMsg({ text: e.message, type: 'error' }),
  })

  return (
    <div className="admin-section">
      <p className="admin-section-hint">Neue Einträge hinzufügen</p>

      <div className="admin-block">
        <h3 className="admin-block-title">Projektstatus</h3>
        <SingleInputMutation
          label="Status"
          onSubmit={v => withMsg(() => statusMut.mutate(v))}
          isPending={statusMut.isPending}
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
        </div>
        <button
          className="btn-small btn-save"
          disabled={rolleMut.isPending || !rolleShort.trim()}
          onClick={() => { setMsg(null); rolleMut.mutate({ short: rolleShort.trim(), long: rolleLong.trim() }) }}
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

function UnternehmenSection() {
  const [form, setForm] = useState({
    company_name_1: '', company_name_2: '', street: '',
    post_code: '', city: '', country_id: '', tax_id: '',
  })
  const [msg, setMsg] = useState<{ text: string; type: 'success' | 'error' } | null>(null)

  const { data: countriesData } = useQuery({ queryKey: ['countries'], queryFn: fetchCountries })
  const countries = countriesData?.data ?? []

  const createMut = useMutation({
    mutationFn: createCompany,
    onSuccess: () => { setMsg({ text: 'Unternehmen gespeichert ✅', type: 'success' }); setForm({ company_name_1: '', company_name_2: '', street: '', post_code: '', city: '', country_id: '', tax_id: '' }) },
    onError: (e: Error) => setMsg({ text: e.message, type: 'error' }),
  })

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setMsg(null)
    if (!form.company_name_1 || !form.street || !form.post_code || !form.city || !form.country_id) {
      setMsg({ text: 'Bitte alle Pflichtfelder ausfüllen', type: 'error' }); return
    }
    createMut.mutate(form)
  }

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm(f => ({ ...f, [k]: e.target.value }))

  return (
    <div className="admin-section">
      <form onSubmit={handleSubmit} className="master-form">
        <FormField label="Firmenname 1*"  id="ufn1" value={form.company_name_1} onChange={set('company_name_1')} required />
        <FormField label="Firmenname 2"   id="ufn2" value={form.company_name_2} onChange={set('company_name_2')} />
        <FormField label="Straße*"        id="ust"  value={form.street} onChange={set('street')} required />
        <div className="form-row">
          <FormField label="PLZ*"         id="upc"  value={form.post_code} onChange={set('post_code')} required />
          <FormField label="Ort*"         id="uct"  value={form.city} onChange={set('city')} required />
        </div>
        <div className="form-group">
          <label htmlFor="uco">Land*</label>
          <select id="uco" value={form.country_id} onChange={set('country_id')} required>
            <option value="">Bitte wählen …</option>
            {countries.map(c => <option key={c.ID} value={c.ID}>{c.NAME_LONG || c.NAME_SHORT || c.ID}</option>)}
          </select>
        </div>
        <FormField label="Steuernummer"   id="uti"  value={form.tax_id} onChange={set('tax_id')} />
        <Message text={msg?.text ?? null} type={msg?.type} />
        <button className="btn-primary" type="submit" disabled={createMut.isPending}>
          {createMut.isPending ? 'Speichert …' : 'Speichern'}
        </button>
      </form>
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
      </div>
    </div>
  )
}
