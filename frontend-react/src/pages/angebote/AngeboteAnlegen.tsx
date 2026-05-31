import { useState, useEffect, useCallback } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Message }      from '@/components/ui/Message'
import { Autocomplete } from '@/components/ui/Autocomplete'
import { fetchOfferStatuses, createOffer, openOfferPdf, type OfferStructureDraftRow } from '@/api/angebote'
import { fetchProjectManagers, fetchBillingTypes, fetchActiveRoles } from '@/api/projekte'
import { fetchCompanies } from '@/api/rechnungen'
import { searchAddressesApi, fetchContactsByAddress, fetchDefaults } from '@/api/stammdaten'
import { HonorarWizard } from '@/pages/projekte/HonorarWizard'

// ── Types ─────────────────────────────────────────────────────────────────────

function todayIso() { return new Date().toISOString().slice(0, 10) }

function addDays(iso: string, days: number): string {
  const d = new Date(iso)
  d.setDate(d.getDate() + days)
  return d.toISOString().slice(0, 10)
}

interface BasicForm {
  name_long:        string
  company_id:       string
  offer_status_id:  string
  employee_id:      string
  probability:      string
  offer_text_1:     string
  offer_text_2:     string
  address_id:       string
  contact_id:       string
  offer_date:       string
  valid_until:      string
}

function emptyBasic(): BasicForm {
  return { name_long: '', company_id: '', offer_status_id: '', employee_id: '', probability: '', offer_text_1: '', offer_text_2: '', address_id: '', contact_id: '', offer_date: todayIso(), valid_until: '' }
}

function newStructRow(): OfferStructureDraftRow {
  const tmp = 't' + Date.now().toString(36) + Math.floor(Math.random() * 1000)
  return { tmp_key: tmp, father_tmp_key: '', NAME_SHORT: '', NAME_LONG: '', BILLING_TYPE_ID: '', EXTRAS_PERCENT: '', REVENUE: '', QUANTITY: '', SP_RATE: '', ROLE_ID: '', ROLE_NAME_SHORT: '', ROLE_NAME_LONG: '' }
}

function StepIndicator({ step }: { step: number }) {
  return (
    <div className="wizard-steps">
      {[1, 2, 3].map(s => (
        <span key={s} className={`wizard-step${s === step ? ' active' : s < step ? ' done' : ''}`}>{s}</span>
      ))}
    </div>
  )
}

// ── Component ─────────────────────────────────────────────────────────────────

export function AngeboteAnlegen() {
  const qc = useQueryClient()
  const [step, setStep]           = useState(1)
  const [basic, setBasic]         = useState<BasicForm>(emptyBasic)
  const [addrText, setAddrText]   = useState('')
  const [structDraft, setStructDraft] = useState<OfferStructureDraftRow[]>([])
  const [msg, setMsg]             = useState<{ text: string; type: 'success' | 'error' | 'info' } | null>(null)
  const [createdOfferId, setCreatedOfferId] = useState<number | null>(null)

  const { data: statusData  } = useQuery({ queryKey: ['offer-statuses'],  queryFn: fetchOfferStatuses  })
  const { data: mgrData     } = useQuery({ queryKey: ['project-managers'],queryFn: fetchProjectManagers })
  const { data: btData      } = useQuery({ queryKey: ['billing-types'],   queryFn: fetchBillingTypes   })
  const { data: roleData    } = useQuery({ queryKey: ['active-roles'],    queryFn: fetchActiveRoles    })
  const { data: companyData } = useQuery({ queryKey: ['companies'],       queryFn: fetchCompanies      })
  const { data: defData     } = useQuery({ queryKey: ['defaults'],        queryFn: fetchDefaults       })
  const addressId = basic.address_id ? Number(basic.address_id) : null
  const { data: contactData } = useQuery({
    queryKey: ['contacts-by-address', addressId],
    queryFn:  () => fetchContactsByAddress(addressId!),
    enabled:  !!addressId,
  })

  const statuses  = statusData?.data  ?? []
  const managers  = mgrData?.data     ?? []
  const btypes    = btData?.data      ?? []
  const roles     = roleData?.data    ?? []
  const companies = companyData?.data ?? []
  const contacts  = contactData?.data ?? []

  if (companies.length === 1 && !basic.company_id) {
    setBasic(f => ({ ...f, company_id: String(companies[0].ID) }))
  }

  // Pre-fill valid_until = offer_date + offer_valid_days when defaults load
  useEffect(() => {
    const days = parseInt(defData?.data?.offer_valid_days ?? '', 10)
    if (!Number.isFinite(days) || days <= 0) return
    setBasic(f => ({ ...f, valid_until: addDays(f.offer_date || todayIso(), days) }))
  }, [defData?.data?.offer_valid_days])

  // Pre-fill Kopftext / Fußtext from saved defaults (only when field is still empty)
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
      setStep(3)
    },
    onError: (e: Error) => setMsg({ text: e.message, type: 'error' }),
  })

  function resetAll() {
    setStep(1); setBasic(emptyBasic()); setAddrText(''); setStructDraft([])
    setCreatedOfferId(null); setMsg(null)
  }

  const setB = (k: keyof BasicForm) => (v: string) => setBasic(f => ({ ...f, [k]: v }))

  function addStructRow() { setStructDraft(d => [...d, newStructRow()]) }

  function removeStructRow(tmpKey: string) {
    setStructDraft(d => d.filter(r => r.tmp_key !== tmpKey).map(r => ({
      ...r, father_tmp_key: r.father_tmp_key === tmpKey ? '' : r.father_tmp_key,
    })))
  }

  function setStructField(tmpKey: string, field: keyof OfferStructureDraftRow, value: string) {
    setStructDraft(d => d.map(r => {
      if (r.tmp_key !== tmpKey) return r
      const updated = { ...r, [field]: value }
      // Auto-calc revenue for hourly rows when quantity or sp_rate changes
      if ((field === 'QUANTITY' || field === 'SP_RATE') && updated.BILLING_TYPE_ID === '2') {
        const q = Number(updated.QUANTITY) || 0
        const s = Number(updated.SP_RATE)  || 0
        updated.REVENUE = String(Math.round(q * s * 100) / 100)
      }
      return updated
    }))
  }

  function applyRolePreset(tmpKey: string, roleId: string) {
    const role = roles.find(r => String(r.ID) === roleId)
    setStructDraft(d => d.map(r => {
      if (r.tmp_key !== tmpKey) return r
      const newSpRate = role?.SP_RATE != null ? String(role.SP_RATE) : r.SP_RATE
      const newRevenue = String(Math.round((Number(r.QUANTITY) || 0) * (Number(newSpRate) || 0) * 100) / 100)
      return {
        ...r,
        ROLE_ID:         roleId,
        ROLE_NAME_SHORT: role?.NAME_SHORT ?? '',
        ROLE_NAME_LONG:  role?.NAME_LONG  ?? '',
        SP_RATE:         newSpRate,
        REVENUE:         newRevenue,
      }
    }))
  }

  function validateStep1() {
    const missing: string[] = []
    if (!basic.name_long)       missing.push('Angebotstitel')
    if (!basic.offer_status_id) missing.push('Angebotsstatus')
    if (!basic.employee_id)     missing.push('Ansprechpartner')
    if (!basic.address_id)      missing.push('Adresse')
    if (!basic.contact_id)      missing.push('Kontakt')
    if (missing.length) {
      setMsg({ text: `Pflichtfeld${missing.length > 1 ? 'er' : ''} fehlt: ${missing.join(', ')}`, type: 'error' })
      return false
    }
    setMsg(null); return true
  }

  function submit() {
    setMsg(null)
    createMut.mutate({
      name_long:        basic.name_long,
      company_id:       basic.company_id || 0,
      offer_status_id:  Number(basic.offer_status_id),
      employee_id:      Number(basic.employee_id),
      address_id:       Number(basic.address_id),
      contact_id:       Number(basic.contact_id),
      probability:      basic.probability || undefined,
      offer_text_1:     basic.offer_text_1 || undefined,
      offer_text_2:     basic.offer_text_2 || undefined,
      offer_date:       basic.offer_date   || undefined,
      valid_until:      basic.valid_until  || null,
      offer_structure:  structDraft.length ? structDraft : undefined,
    })
  }

  return (
    <div className="wizard-wrap">
      <StepIndicator step={step} />

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
              <label>Gültigkeitsdatum</label>
              <input type="date" value={basic.valid_until} onChange={e => setB('valid_until')(e.target.value)} />
            </div>
          </div>

          <div className="form-group">
            <label>Wahrscheinlichkeit (%)</label>
            <input type="number" min={0} max={100} step={1} value={basic.probability} onChange={e => setB('probability')(e.target.value)} placeholder="z. B. 50" />
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
            <textarea rows={4} value={basic.offer_text_1} onChange={e => setB('offer_text_1')(e.target.value)} placeholder="Einleitungstext …" style={{ width: '100%', resize: 'vertical' }} />
          </div>

          <div className="form-group">
            <label>Fußtext</label>
            <textarea rows={4} value={basic.offer_text_2} onChange={e => setB('offer_text_2')(e.target.value)} placeholder="Abschlusstext …" style={{ width: '100%', resize: 'vertical' }} />
          </div>
        </div>
      )}

      {/* ── Step 2: Positionen ── */}
      {step === 2 && (
        <div className="wizard-step-content">
          <h3 className="wizard-step-title">Schritt 2: Positionen</h3>
          <p className="admin-section-hint">Optional — Positionen können später ergänzt werden.</p>
          <button className="btn-small btn-save" type="button" onClick={addStructRow} style={{ marginBottom: 8 }}>+ Position hinzufügen</button>

          {structDraft.length > 0 && (
            <div className="table-scroll">
              <table className="master-table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Position</th>
                    <th>Bezeichnung</th>
                    <th>Leistungsart*</th>
                    <th>NK %</th>
                    <th>Honorar / Aufwand</th>
                    <th>Übergeordnet</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {structDraft.map((r, i) => {
                    const isHourly = r.BILLING_TYPE_ID === '2'
                    return (
                      <tr key={r.tmp_key}>
                        <td>{i + 1}</td>
                        <td><input className="tbl-input" style={{ width: 70 }} value={r.NAME_SHORT} onChange={e => setStructField(r.tmp_key, 'NAME_SHORT', e.target.value)} /></td>
                        <td><input className="tbl-input" style={{ width: 140 }} value={r.NAME_LONG} onChange={e => setStructField(r.tmp_key, 'NAME_LONG', e.target.value)} /></td>
                        <td>
                          <select className="tbl-select" style={{ width: 120 }} value={r.BILLING_TYPE_ID}
                            onChange={e => setStructField(r.tmp_key, 'BILLING_TYPE_ID', e.target.value)}>
                            <option value="">Bitte wählen …</option>
                            {btypes.map(b => <option key={b.ID} value={b.ID}>{b.NAME_SHORT}{b.NAME_LONG ? ' – ' + b.NAME_LONG : ''}</option>)}
                          </select>
                        </td>
                        <td>
                          <input className="tbl-input" type="number" min={0} max={100} step={0.1} style={{ width: 60 }}
                            value={r.EXTRAS_PERCENT} placeholder="0"
                            onChange={e => setStructField(r.tmp_key, 'EXTRAS_PERCENT', e.target.value)} />
                        </td>
                        <td>
                          {isHourly ? (
                            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', alignItems: 'center' }}>
                              <select className="tbl-select" style={{ width: 110 }} value={r.ROLE_ID}
                                onChange={e => applyRolePreset(r.tmp_key, e.target.value)}>
                                <option value="">Rolle …</option>
                                {roles.map(ro => <option key={ro.ID} value={ro.ID}>{ro.NAME_SHORT}{ro.NAME_LONG ? ' – ' + ro.NAME_LONG : ''}</option>)}
                              </select>
                              <input className="tbl-input" style={{ width: 70 }} placeholder="Aufwand h"
                                type="number" min={0} step={0.5} value={r.QUANTITY}
                                onChange={e => setStructField(r.tmp_key, 'QUANTITY', e.target.value)} />
                              <input className="tbl-input" style={{ width: 70 }} placeholder="€/h"
                                type="number" min={0} step={0.01} value={r.SP_RATE}
                                onChange={e => setStructField(r.tmp_key, 'SP_RATE', e.target.value)} />
                              <span style={{ fontSize: 11, color: '#6b7280' }}>
                                = {r.REVENUE ? Number(r.REVENUE).toLocaleString('de-DE', { style: 'currency', currency: 'EUR' }) : '—'}
                              </span>
                            </div>
                          ) : (
                            <input className="tbl-input" style={{ width: 110 }} type="number" min={0} step={0.01} placeholder="Honorar"
                              value={r.REVENUE}
                              onChange={e => setStructField(r.tmp_key, 'REVENUE', e.target.value)} />
                          )}
                        </td>
                        <td>
                          <select className="tbl-select" style={{ width: 120 }} value={r.father_tmp_key}
                            onChange={e => setStructField(r.tmp_key, 'father_tmp_key', e.target.value)}>
                            <option value="">(Root)</option>
                            {structDraft.filter(x => x.tmp_key !== r.tmp_key).map(x => (
                              <option key={x.tmp_key} value={x.tmp_key}>
                                {(`${x.NAME_SHORT} ${x.NAME_LONG}`).trim() || `Zeile ${structDraft.indexOf(x) + 1}`}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td><button className="btn-small" type="button" onClick={() => removeStructRow(r.tmp_key)}>Entfernen</button></td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ── Step 3: HOAI-Kalkulationen ── */}
      {step === 3 && createdOfferId && (
        <div className="wizard-step-content">
          <h3 className="wizard-step-title">Schritt 3: HOAI-Kalkulationen (optional)</h3>
          <p style={{ fontSize: 12, color: '#6b7280', marginBottom: 12 }}>
            Das Angebot wurde angelegt. Fügen Sie optional HOAI-Kalkulationen hinzu oder überspringen Sie diesen Schritt.
          </p>
          <div style={{ marginBottom: 8 }}>
            <button className="btn-small" type="button" onClick={() => openOfferPdf(createdOfferId)}>
              PDF öffnen
            </button>
          </div>
          <HonorarWizard
            offerId={createdOfferId}
            onDone={resetAll}
          />
        </div>
      )}

      <Message text={msg?.text ?? null} type={msg?.type} />

      <div className="wizard-nav">
        {step > 1 && step < 3 && <button type="button" onClick={() => { setMsg(null); setStep(s => s - 1) }}>← Zurück</button>}
        {step < 2 && (
          <button className="btn-primary" type="button" onClick={() => { if (validateStep1()) setStep(2) }}>Weiter →</button>
        )}
        {step === 2 && (
          <button className="btn-primary" type="button" disabled={createMut.isPending} onClick={submit}>
            {createMut.isPending ? 'Speichert …' : 'Angebot anlegen'}
          </button>
        )}
        {step === 3 && (
          <button type="button" onClick={resetAll}>Überspringen &amp; Fertig</button>
        )}
      </div>
    </div>
  )
}
