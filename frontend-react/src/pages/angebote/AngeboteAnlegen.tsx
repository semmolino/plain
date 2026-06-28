import { useState, useEffect, useCallback } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Message }      from '@/components/ui/Message'
import { Autocomplete } from '@/components/ui/Autocomplete'
import { fetchOfferStatuses, createOffer, openOfferPdf } from '@/api/angebote'
import { fetchProjectManagers } from '@/api/projekte'
import { fetchCompanies } from '@/api/rechnungen'
import { searchAddressesApi, fetchContactsByAddress, fetchDefaults } from '@/api/stammdaten'
import { HonorarWizard } from '@/pages/projekte/HonorarWizard'

function todayIso() { return new Date().toISOString().slice(0, 10) }
function addDays(iso: string, days: number): string {
  const d = new Date(iso); d.setDate(d.getDate() + days); return d.toISOString().slice(0, 10)
}

interface BasicForm {
  name_long:       string; company_id:      string; offer_status_id: string
  employee_id:     string; probability:     string; offer_text_1:    string
  offer_text_2:    string; address_id:      string; contact_id:      string
  offer_date:      string; valid_until:     string
}

function emptyBasic(): BasicForm {
  return { name_long: '', company_id: '', offer_status_id: '', employee_id: '',
    probability: '', offer_text_1: '', offer_text_2: '', address_id: '',
    contact_id: '', offer_date: todayIso(), valid_until: '' }
}

export function AngeboteAnlegen({ onOfferCreated }: { onOfferCreated?: (id: number) => void }) {
  const qc = useQueryClient()
  const [step, setStep]                   = useState(1)
  const [basic, setBasic]                 = useState<BasicForm>(emptyBasic)
  const [addrText, setAddrText]           = useState('')
  const [msg, setMsg]                     = useState<{ text: string; type: 'success' | 'error' | 'info' } | null>(null)
  const [createdOfferId, setCreatedOfferId] = useState<number | null>(null)
  // true, sobald „Gültig bis" manuell gesetzt wurde → Standard-Dauer nicht mehr überschreiben
  const [validUntilTouched, setValidUntilTouched] = useState(false)

  const { data: statusData  } = useQuery({ queryKey: ['offer-statuses'],   queryFn: fetchOfferStatuses  })
  const { data: mgrData     } = useQuery({ queryKey: ['project-managers'], queryFn: fetchProjectManagers })
  const { data: companyData } = useQuery({ queryKey: ['companies'],        queryFn: fetchCompanies      })
  const { data: defData     } = useQuery({ queryKey: ['defaults'],         queryFn: fetchDefaults       })
  const addressId = basic.address_id ? Number(basic.address_id) : null
  const { data: contactData } = useQuery({
    queryKey: ['contacts-by-address', addressId],
    queryFn:  () => fetchContactsByAddress(addressId!),
    enabled:  !!addressId,
  })

  const statuses  = statusData?.data  ?? []
  const managers  = mgrData?.data     ?? []
  const companies = companyData?.data ?? []
  const contacts  = contactData?.data ?? []

  if (companies.length === 1 && !basic.company_id)
    setBasic(f => ({ ...f, company_id: String(companies[0].ID) }))

  // Standard-Angebotsdauer aus den Vorbelegungen: „Gültig bis" = Angebotsdatum
  // + N Tage. Greift beim Laden der Vorbelegung UND bei jeder Änderung des
  // Angebotsdatums — außer der Nutzer hat „Gültig bis" selbst überschrieben.
  useEffect(() => {
    if (validUntilTouched) return
    const days = parseInt(defData?.data?.offer_valid_days ?? '', 10)
    if (!Number.isFinite(days) || days <= 0) return
    const next = addDays(basic.offer_date || todayIso(), days)
    setBasic(f => (f.valid_until === next ? f : { ...f, valid_until: next }))
  }, [defData?.data?.offer_valid_days, basic.offer_date, validUntilTouched])

  useEffect(() => {
    const t1 = defData?.data?.offer_text_1 ?? ''
    const t2 = defData?.data?.offer_text_2 ?? ''
    if (!t1 && !t2) return
    setBasic(f => ({
      ...f,
      ...(!f.offer_text_1 && t1 ? { offer_text_1: t1 } : {}),
      ...(!f.offer_text_2 && t2 ? { offer_text_2: t2 } : {}),
    }))
  }, [defData?.data?.offer_text_1, defData?.data?.offer_text_2])

  const searchAddresses = useCallback(async (q: string) => {
    const res = await searchAddressesApi(q)
    return res.data.map(a => ({ id: a.ID, label: a.ADDRESS_NAME_1 }))
  }, [])

  const createMut = useMutation({
    mutationFn: createOffer,
    onSuccess: (res) => {
      void qc.invalidateQueries({ queryKey: ['offers'] })
      void qc.invalidateQueries({ queryKey: ['number-ranges'] })
      setCreatedOfferId(res.data.ID)
      setMsg({ text: `Angebot "${res.data.NAME_SHORT}" wurde angelegt ✅`, type: 'success' })
      if (onOfferCreated) {
        onOfferCreated(res.data.ID)
      } else {
        setStep(2)
      }
    },
    onError: (e: Error) => setMsg({ text: e.message, type: 'error' }),
  })

  function resetAll() {
    setStep(1); setBasic(emptyBasic()); setAddrText('')
    setCreatedOfferId(null); setMsg(null); setValidUntilTouched(false)
  }

  const setB = (k: keyof BasicForm) => (v: string) => setBasic(f => ({ ...f, [k]: v }))

  function validateStep1() {
    const missing: string[] = []
    if (!basic.name_long)       missing.push('Angebotstitel')
    if (!basic.offer_status_id) missing.push('Angebotsstatus')
    if (!basic.employee_id)     missing.push('Ansprechpartner')
    if (!basic.address_id)      missing.push('Adresse')
    if (!basic.contact_id)      missing.push('Kontakt')
    if (missing.length) { setMsg({ text: `Pflichtfeld${missing.length > 1 ? 'er' : ''} fehlt: ${missing.join(', ')}`, type: 'error' }); return false }
    setMsg(null); return true
  }

  function submit() {
    setMsg(null)
    createMut.mutate({
      name_long:       basic.name_long,
      company_id:      basic.company_id || 0,
      offer_status_id: Number(basic.offer_status_id),
      employee_id:     Number(basic.employee_id),
      address_id:      Number(basic.address_id),
      contact_id:      Number(basic.contact_id),
      probability:     basic.probability || undefined,
      offer_text_1:    basic.offer_text_1 || undefined,
      offer_text_2:    basic.offer_text_2 || undefined,
      offer_date:      basic.offer_date   || undefined,
      valid_until:     basic.valid_until  || null,
    })
  }

  return (
    <div className="wizard-wrap">

      {/* ── Step 1: Angebotsdaten ── */}
      {step === 1 && (
        <div className="wizard-step-content">
          <h3 className="wizard-step-title">Schritt 1: Angebotsdaten</h3>

          {companies.length > 1 && (
            <div className="form-group">
              <label>Firma*</label>
              <select value={basic.company_id} onChange={e => setB('company_id')(e.target.value)}>
                <option value="">Bitte wählen …</option>
                {companies.map(c => <option key={c.ID} value={c.ID}>{c.COMPANY_NAME_1}</option>)}
              </select>
            </div>
          )}

          <div className="form-group">
            <label>Angebotstitel*</label>
            <input value={basic.name_long} onChange={e => setB('name_long')(e.target.value)} placeholder="Titel des Angebots" />
          </div>

          <div className="form-group">
            <label>Angebotsstatus*</label>
            <select value={basic.offer_status_id} onChange={e => setB('offer_status_id')(e.target.value)}>
              <option value="">Bitte wählen …</option>
              {statuses.map(s => <option key={s.ID} value={s.ID}>{s.NAME_SHORT}</option>)}
            </select>
          </div>

          <div className="form-group">
            <label>Ansprechpartner*</label>
            <select value={basic.employee_id} onChange={e => setB('employee_id')(e.target.value)}>
              <option value="">Bitte wählen …</option>
              {managers.map(m => <option key={m.ID} value={m.ID}>{m.SHORT_NAME}</option>)}
            </select>
          </div>

          <div className="form-row">
            <div className="form-group">
              <label>Angebotsdatum</label>
              <input type="date" value={basic.offer_date} onChange={e => setB('offer_date')(e.target.value)} />
            </div>
            <div className="form-group">
              <label>Gültig bis</label>
              <input type="date" value={basic.valid_until} onChange={e => { setValidUntilTouched(true); setB('valid_until')(e.target.value) }} />
            </div>
            <div className="form-group">
              <label>Wahrscheinlichkeit (%)</label>
              <input type="number" min={0} max={100} step={1} value={basic.probability}
                onChange={e => setB('probability')(e.target.value)} placeholder="z. B. 50" />
            </div>
          </div>

          <Autocomplete label="Adresse / Empfänger*" htmlId="offer-addr"
            value={addrText}
            onChange={t => { setAddrText(t); if (!t) { setB('address_id')(''); setB('contact_id')('') } }}
            onSelect={(id, lbl) => { setAddrText(lbl); setB('address_id')(String(id)); setB('contact_id')('') }}
            search={searchAddresses} placeholder="Name eingeben …" />

          <div className="form-group">
            <label>Kontakt*</label>
            <select value={basic.contact_id} onChange={e => setB('contact_id')(e.target.value)} disabled={!basic.address_id}>
              <option value="">{basic.address_id ? 'Bitte wählen …' : 'Erst Adresse wählen'}</option>
              {contacts.map(c => (
                <option key={c.ID} value={c.ID}>{`${c.FIRST_NAME ?? ''} ${c.LAST_NAME ?? ''}`.trim()}</option>
              ))}
            </select>
          </div>

          <div className="form-group">
            <label>Kopftext</label>
            <textarea rows={3} value={basic.offer_text_1} onChange={e => setB('offer_text_1')(e.target.value)}
              placeholder="Einleitungstext …" style={{ width: '100%', resize: 'vertical' }} />
          </div>

          <div className="form-group">
            <label>Fußtext</label>
            <textarea rows={3} value={basic.offer_text_2} onChange={e => setB('offer_text_2')(e.target.value)}
              placeholder="Abschlusstext …" style={{ width: '100%', resize: 'vertical' }} />
          </div>
        </div>
      )}

      {/* ── Step 2: HOAI-Kalkulationen (optional) ── */}
      {step === 2 && createdOfferId && (
        <div className="wizard-step-content">
          <h3 className="wizard-step-title">Schritt 2: HOAI-Kalkulationen (optional)</h3>
          <p style={{ fontSize: 12, color: '#6b7280', marginBottom: 12 }}>
            Das Angebot wurde angelegt. Positionen können im Tab „Struktur" ergänzt werden.
            Fügen Sie optional HOAI-Kalkulationen hinzu oder überspringen Sie diesen Schritt.
          </p>
          <div style={{ marginBottom: 8 }}>
            <button className="btn-small" type="button" onClick={() => openOfferPdf(createdOfferId)}>PDF öffnen</button>
          </div>
          <HonorarWizard offerId={createdOfferId} onDone={resetAll} />
        </div>
      )}

      <Message text={msg?.text ?? null} type={msg?.type} />

      <div className="wizard-nav">
        {step === 1 && (
          <button className="btn-primary" type="button" disabled={createMut.isPending} onClick={() => { if (validateStep1()) submit() }}>
            {createMut.isPending ? 'Speichert …' : 'Angebot anlegen →'}
          </button>
        )}
        {step === 2 && (
          <button type="button" onClick={resetAll}>Überspringen &amp; Fertig</button>
        )}
      </div>
    </div>
  )
}
