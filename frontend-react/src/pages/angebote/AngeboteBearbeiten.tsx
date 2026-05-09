import { useState, useEffect, useCallback } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Message }      from '@/components/ui/Message'
import { Autocomplete } from '@/components/ui/Autocomplete'
import {
  fetchOffers, fetchOffer, updateOffer, fetchOfferStructure,
  addOfferStructureNode, deleteOfferStructureNode,
  openOfferPdf, type Offer, type OfferStructureNode, type AddStructureNodePayload,
} from '@/api/angebote'
import { fetchOfferStatuses } from '@/api/angebote'
import { fetchProjectManagers, fetchBillingTypes, fetchActiveRoles } from '@/api/projekte'
import { fetchCompanies } from '@/api/rechnungen'
import { searchAddressesApi, fetchContactsByAddress } from '@/api/stammdaten'
import { buildStructureTree, flattenTree } from '@/utils/treeUtils'
import type { StructureNode } from '@/api/projekte'

// ── helpers ───────────────────────────────────────────────────────────────────

interface EditForm {
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

function offerToForm(o: Offer): EditForm {
  return {
    name_long:        o.NAME_LONG ?? '',
    company_id:       o.COMPANY_ID != null ? String(o.COMPANY_ID) : '',
    offer_status_id:  o.OFFER_STATUS_ID != null ? String(o.OFFER_STATUS_ID) : '',
    employee_id:      o.EMPLOYEE_ID != null ? String(o.EMPLOYEE_ID) : '',
    probability:      o.PROBABILITY != null ? String(o.PROBABILITY) : '',
    offer_text_1:     o.OFFER_TEXT_1 ?? '',
    offer_text_2:     o.OFFER_TEXT_2 ?? '',
    address_id:       o.ADDRESS_ID != null ? String(o.ADDRESS_ID) : '',
    contact_id:       o.CONTACT_ID != null ? String(o.CONTACT_ID) : '',
    offer_date:       o.OFFER_DATE   ?? '',
    valid_until:      o.VALID_UNTIL  ?? '',
  }
}

interface AddNodeForm {
  name_short:      string
  name_long:       string
  billing_type_id: string
  extras_percent:  string
  revenue:         string
  quantity:        string
  sp_rate:         string
  role_id:         string
  role_name_short: string
  role_name_long:  string
  father_id:       string
}

function emptyAddForm(): AddNodeForm {
  return { name_short: '', name_long: '', billing_type_id: '', extras_percent: '', revenue: '', quantity: '', sp_rate: '', role_id: '', role_name_short: '', role_name_long: '', father_id: '' }
}

// ── Component ─────────────────────────────────────────────────────────────────

export function AngeboteBearbeiten({ initialOfferId }: { initialOfferId?: number }) {
  const qc = useQueryClient()
  const [selectedId, setSelectedId] = useState<number | null>(initialOfferId ?? null)
  const [form,       setForm]       = useState<EditForm | null>(null)
  const [addrText,   setAddrText]   = useState('')
  const [addForm,    setAddForm]    = useState<AddNodeForm>(emptyAddForm)
  const [showAdd,    setShowAdd]    = useState(false)
  const [msg,        setMsg]        = useState<{ text: string; type: 'success' | 'error' } | null>(null)
  const [structMsg,  setStructMsg]  = useState<{ text: string; type: 'success' | 'error' } | null>(null)

  // Lookups
  const { data: offersData  } = useQuery({ queryKey: ['offers'],          queryFn: fetchOffers         })
  const { data: statusData  } = useQuery({ queryKey: ['offer-statuses'],  queryFn: fetchOfferStatuses  })
  const { data: mgrData     } = useQuery({ queryKey: ['project-managers'],queryFn: fetchProjectManagers })
  const { data: btData      } = useQuery({ queryKey: ['billing-types'],   queryFn: fetchBillingTypes   })
  const { data: roleData    } = useQuery({ queryKey: ['active-roles'],    queryFn: fetchActiveRoles    })
  const { data: companyData } = useQuery({ queryKey: ['companies'],       queryFn: fetchCompanies      })

  // Selected offer data
  const { data: offerData, isLoading: offerLoading } = useQuery({
    queryKey: ['offer', selectedId],
    queryFn:  () => fetchOffer(selectedId!),
    enabled:  selectedId !== null,
  })
  const { data: structData } = useQuery({
    queryKey: ['offer-structure', selectedId],
    queryFn:  () => fetchOfferStructure(selectedId!),
    enabled:  selectedId !== null,
  })

  const addressId = form?.address_id ? Number(form.address_id) : null
  const { data: contactData } = useQuery({
    queryKey: ['contacts-by-address', addressId],
    queryFn:  () => fetchContactsByAddress(addressId!),
    enabled:  !!addressId,
  })

  const offers   = offersData?.data  ?? []
  const statuses = statusData?.data  ?? []
  const managers = mgrData?.data     ?? []
  const btypes   = btData?.data      ?? []
  const roles    = roleData?.data    ?? []
  const companies = companyData?.data ?? []
  const contacts = contactData?.data ?? []
  const structNodes = structData?.data ?? []

  // Populate form when offer loads
  useEffect(() => {
    if (offerData?.data) {
      setForm(offerToForm(offerData.data))
      setAddrText('')
    }
  }, [offerData?.data])

  useEffect(() => {
    if (selectedId !== null) setMsg(null)
  }, [selectedId])

  const searchAddresses = useCallback(async (q: string) => {
    const res = await searchAddressesApi(q)
    return res.data.map(a => ({ id: a.ID, label: a.ADDRESS_NAME_1 }))
  }, [])

  const saveMut = useMutation({
    mutationFn: (f: EditForm) => updateOffer(selectedId!, {
      name_long:        f.name_long,
      company_id:       f.company_id || undefined,
      offer_status_id:  Number(f.offer_status_id),
      employee_id:      Number(f.employee_id),
      address_id:       Number(f.address_id),
      contact_id:       Number(f.contact_id),
      probability:      f.probability !== '' ? Number(f.probability) : null,
      offer_text_1:     f.offer_text_1 || null,
      offer_text_2:     f.offer_text_2 || null,
      offer_date:       f.offer_date   || null,
      valid_until:      f.valid_until  || null,
    }),
    onSuccess: () => {
      setMsg({ text: 'Angebot gespeichert ✅', type: 'success' })
      void qc.invalidateQueries({ queryKey: ['offers'] })
      void qc.invalidateQueries({ queryKey: ['offer', selectedId] })
    },
    onError: (e: Error) => setMsg({ text: e.message, type: 'error' }),
  })

  const addNodeMut = useMutation({
    mutationFn: (f: AddNodeForm) => {
      const isHourly = f.billing_type_id === '2'
      const payload: AddStructureNodePayload = {
        name_short:      f.name_short,
        name_long:       f.name_long,
        billing_type_id: Number(f.billing_type_id),
        extras_percent:  Number(f.extras_percent) || 0,
        father_id:       f.father_id ? Number(f.father_id) : null,
        role_name_short: f.role_name_short || undefined,
        role_name_long:  f.role_name_long  || undefined,
        role_id:         f.role_id ? Number(f.role_id) : undefined,
      }
      if (isHourly) {
        payload.quantity = Number(f.quantity) || 0
        payload.sp_rate  = Number(f.sp_rate)  || 0
      } else {
        payload.revenue = Number(f.revenue) || 0
      }
      return addOfferStructureNode(selectedId!, payload)
    },
    onSuccess: () => {
      setStructMsg({ text: 'Position hinzugefügt ✅', type: 'success' })
      setShowAdd(false); setAddForm(emptyAddForm())
      void qc.invalidateQueries({ queryKey: ['offer-structure', selectedId] })
    },
    onError: (e: Error) => setStructMsg({ text: e.message, type: 'error' }),
  })

  const deleteNodeMut = useMutation({
    mutationFn: ({ nodeId }: { nodeId: number }) => deleteOfferStructureNode(selectedId!, nodeId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['offer-structure', selectedId] })
    },
    onError: (e: Error) => setStructMsg({ text: e.message, type: 'error' }),
  })

  const setF = (k: keyof EditForm) => (v: string) => setForm(f => f ? { ...f, [k]: v } : f)
  const setAF = (k: keyof AddNodeForm) => (v: string) => setAddForm(f => {
    const updated = { ...f, [k]: v }
    if ((k === 'QUANTITY' as unknown as keyof AddNodeForm || k === 'quantity' || k === 'sp_rate') && updated.billing_type_id === '2') {
      // re-compute inline display only (backend computes actual revenue)
    }
    return updated
  })

  function applyRoleToAdd(roleId: string) {
    const role = roles.find(r => String(r.ID) === roleId)
    setAddForm(f => ({
      ...f,
      role_id:         roleId,
      role_name_short: role?.NAME_SHORT ?? '',
      role_name_long:  role?.NAME_LONG  ?? '',
      sp_rate:         role?.SP_RATE != null ? String(role.SP_RATE) : f.sp_rate,
    }))
  }

  // Map OFFER_STRUCTURE nodes to the STRUCTURE_ID shape expected by treeUtils
  const mappedForTree = structNodes.map(n => ({ ...n, STRUCTURE_ID: n.ID }))
  const flatNodes = mappedForTree.length
    ? flattenTree(buildStructureTree(mappedForTree as unknown as StructureNode[]))
    : []

  const FMT_EUR = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 })

  if (!selectedId) {
    return (
      <div className="ls-wrap">
        <div className="ls-toolbar">
          <label className="ls-label">Angebot</label>
          <select className="ls-select" value={''} onChange={e => setSelectedId(Number(e.target.value) || null)}>
            <option value="">— Angebot wählen —</option>
            {offers.map(o => <option key={o.ID} value={o.ID}>{o.NAME_SHORT} – {o.NAME_LONG}</option>)}
          </select>
        </div>
        <p className="ls-empty">Bitte ein Angebot auswählen.</p>
      </div>
    )
  }

  return (
    <div className="ls-wrap">
      {/* Offer selector */}
      <div className="ls-toolbar">
        <label className="ls-label">Angebot</label>
        <select className="ls-select" value={selectedId} onChange={e => setSelectedId(Number(e.target.value) || null)}>
          <option value="">— Angebot wählen —</option>
          {offers.map(o => <option key={o.ID} value={o.ID}>{o.NAME_SHORT} – {o.NAME_LONG}</option>)}
        </select>
        {selectedId && (
          <button className="btn-small" onClick={() => openOfferPdf(selectedId)} style={{ marginLeft: 8 }}>PDF</button>
        )}
      </div>

      {offerLoading && <p className="ls-empty">Lade …</p>}

      {!offerLoading && form && (
        <>
          {/* ── Angebotsdaten ── */}
          <div style={{ marginBottom: 24 }}>
            <h3 className="wizard-step-title" style={{ marginBottom: 12 }}>Angebotsdaten</h3>

            {companies.length > 1 && (
              <div className="form-group">
                <label>Firma</label>
                <select value={form.company_id} onChange={e => setF('company_id')(e.target.value)}>
                  <option value="">—</option>
                  {companies.map(c => <option key={c.ID} value={c.ID}>{c.COMPANY_NAME_1}</option>)}
                </select>
              </div>
            )}

            <div className="form-group">
              <label>Angebotstitel*</label>
              <input value={form.name_long} onChange={e => setF('name_long')(e.target.value)} />
            </div>

            <div className="form-group">
              <label>Angebotsstatus*</label>
              <select value={form.offer_status_id} onChange={e => setF('offer_status_id')(e.target.value)}>
                <option value="">Bitte wählen …</option>
                {statuses.map(s => <option key={s.ID} value={s.ID}>{s.NAME_SHORT}</option>)}
              </select>
            </div>

            <div className="form-group">
              <label>Ansprechpartner*</label>
              <select value={form.employee_id} onChange={e => setF('employee_id')(e.target.value)}>
                <option value="">Bitte wählen …</option>
                {managers.map(m => <option key={m.ID} value={m.ID}>{m.SHORT_NAME}</option>)}
              </select>
            </div>

            <div className="form-row">
              <div className="form-group">
                <label>Angebotsdatum</label>
                <input type="date" value={form.offer_date} onChange={e => setF('offer_date')(e.target.value)} />
              </div>
              <div className="form-group">
                <label>Gültigkeitsdatum</label>
                <input type="date" value={form.valid_until} onChange={e => setF('valid_until')(e.target.value)} />
              </div>
            </div>

            <div className="form-group">
              <label>Wahrscheinlichkeit (%)</label>
              <input type="number" min={0} max={100} step={1} value={form.probability} onChange={e => setF('probability')(e.target.value)} />
            </div>

            <Autocomplete label="Adresse / Empfänger*" htmlId="edit-offer-addr"
              value={addrText || (offerData?.data?.ADDRESS_ID ? String(offerData.data.ADDRESS_ID) : '')}
              onChange={t => { setAddrText(t); if (!t) { setF('address_id')(''); setF('contact_id')('') } }}
              onSelect={(id, lbl) => { setAddrText(lbl); setF('address_id')(String(id)); setF('contact_id')('') }}
              search={searchAddresses} placeholder="Name eingeben …" />

            <div className="form-group">
              <label>Kontakt*</label>
              <select value={form.contact_id} onChange={e => setF('contact_id')(e.target.value)} disabled={!form.address_id}>
                <option value="">{form.address_id ? 'Bitte wählen …' : 'Erst Adresse wählen'}</option>
                {contacts.map(c => (
                  <option key={c.ID} value={c.ID}>{`${c.FIRST_NAME ?? ''} ${c.LAST_NAME ?? ''}`.trim()}</option>
                ))}
              </select>
            </div>

            <div className="form-group">
              <label>Kopftext</label>
              <textarea rows={4} value={form.offer_text_1} onChange={e => setF('offer_text_1')(e.target.value)} style={{ width: '100%', resize: 'vertical' }} />
            </div>

            <div className="form-group">
              <label>Fußtext</label>
              <textarea rows={4} value={form.offer_text_2} onChange={e => setF('offer_text_2')(e.target.value)} style={{ width: '100%', resize: 'vertical' }} />
            </div>

            {msg && <div style={{ marginBottom: 8 }}><Message type={msg.type} text={msg.text} /></div>}

            <button className="btn btn-primary" disabled={saveMut.isPending} onClick={() => { setMsg(null); saveMut.mutate(form) }}>
              {saveMut.isPending ? 'Speichert …' : 'Änderungen speichern'}
            </button>
          </div>

          {/* ── Positionen ── */}
          <div>
            <h3 className="wizard-step-title" style={{ marginBottom: 12 }}>Positionen</h3>

            {structMsg && <div style={{ marginBottom: 8 }}><Message type={structMsg.type} text={structMsg.text} /></div>}

            {flatNodes.length > 0 && (
              <div className="ls-table-wrap" style={{ marginBottom: 16 }}>
                <table className="ls-table">
                  <thead>
                    <tr>
                      <th className="ls-th">Position</th>
                      <th className="ls-th">Bezeichnung</th>
                      <th className="ls-th">Art</th>
                      <th className="ls-th ls-col-num">Honorar</th>
                      <th className="ls-th ls-col-num">NK</th>
                      <th className="ls-th ls-col-num">Gesamt</th>
                      <th className="ls-th"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {flatNodes.map(({ node, depth }) => {
                      const n = node as unknown as OfferStructureNode
                      const revenue = Number(n.REVENUE || 0)
                      const extras  = Number(n.EXTRAS  || 0)
                      const bt = btypes.find(b => b.ID === n.BILLING_TYPE_ID)
                      return (
                        <tr key={n.ID} className="ls-row ls-row-leaf">
                          <td className="ls-td"><span style={{ paddingLeft: depth * 16 }}>{n.NAME_SHORT}</span></td>
                          <td className="ls-td">
                            {n.NAME_LONG}
                            {Number(n.BILLING_TYPE_ID) === 2 && n.QUANTITY != null && (
                              <span className="ls-muted" style={{ marginLeft: 6, fontSize: 11 }}>
                                {n.QUANTITY}h × {Number(n.SP_RATE || 0).toLocaleString('de-DE')} €/h
                              </span>
                            )}
                          </td>
                          <td className="ls-td">{bt?.NAME_SHORT ?? '—'}</td>
                          <td className="ls-td ls-right">{FMT_EUR.format(revenue)}</td>
                          <td className="ls-td ls-right">{FMT_EUR.format(extras)}</td>
                          <td className="ls-td ls-right">{FMT_EUR.format(revenue + extras)}</td>
                          <td className="ls-td">
                            <button className="btn-small" style={{ color: 'var(--color-danger, #ef4444)' }}
                              disabled={deleteNodeMut.isPending}
                              onClick={() => { if (confirm('Position löschen?')) deleteNodeMut.mutate({ nodeId: n.ID }) }}>
                              ✕
                            </button>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {/* Add node form */}
            {!showAdd && (
              <button className="btn-small btn-save" type="button" onClick={() => setShowAdd(true)}>+ Position hinzufügen</button>
            )}

            {showAdd && (
              <div style={{ border: '1px solid #e5e7eb', borderRadius: 6, padding: 16, marginTop: 8 }}>
                <h4 style={{ marginBottom: 12, fontWeight: 600 }}>Neue Position</h4>

                <div className="form-row">
                  <div className="form-group">
                    <label>Position</label>
                    <input style={{ width: 80 }} value={addForm.name_short} onChange={e => setAF('name_short')(e.target.value)} placeholder="z. B. 1.1" />
                  </div>
                  <div className="form-group" style={{ flex: 2 }}>
                    <label>Bezeichnung</label>
                    <input value={addForm.name_long} onChange={e => setAF('name_long')(e.target.value)} placeholder="Leistungsbeschreibung" />
                  </div>
                </div>

                <div className="form-row">
                  <div className="form-group">
                    <label>Leistungsart*</label>
                    <select value={addForm.billing_type_id} onChange={e => setAF('billing_type_id')(e.target.value)}>
                      <option value="">Bitte wählen …</option>
                      {btypes.map(b => <option key={b.ID} value={b.ID}>{b.NAME_SHORT}{b.NAME_LONG ? ' – ' + b.NAME_LONG : ''}</option>)}
                    </select>
                  </div>
                  <div className="form-group">
                    <label>NK %</label>
                    <input type="number" min={0} max={100} step={0.1} style={{ width: 80 }} value={addForm.extras_percent} onChange={e => setAF('extras_percent')(e.target.value)} placeholder="0" />
                  </div>
                  <div className="form-group">
                    <label>Übergeordnet</label>
                    <select value={addForm.father_id} onChange={e => setAF('father_id')(e.target.value)}>
                      <option value="">(Root)</option>
                      {structNodes.map(n => (
                        <option key={n.ID} value={n.ID}>{n.NAME_SHORT} {n.NAME_LONG}</option>
                      ))}
                    </select>
                  </div>
                </div>

                {addForm.billing_type_id === '2' ? (
                  <div className="form-row">
                    <div className="form-group">
                      <label>Rolle</label>
                      <select value={addForm.role_id} onChange={e => applyRoleToAdd(e.target.value)}>
                        <option value="">—</option>
                        {roles.map(r => <option key={r.ID} value={r.ID}>{r.NAME_SHORT}{r.NAME_LONG ? ' – ' + r.NAME_LONG : ''}</option>)}
                      </select>
                    </div>
                    <div className="form-group">
                      <label>Aufwand (h)</label>
                      <input type="number" min={0} step={0.5} style={{ width: 90 }} value={addForm.quantity} onChange={e => setAF('quantity')(e.target.value)} placeholder="0" />
                    </div>
                    <div className="form-group">
                      <label>Stundensatz (€/h)</label>
                      <input type="number" min={0} step={0.01} style={{ width: 90 }} value={addForm.sp_rate} onChange={e => setAF('sp_rate')(e.target.value)} placeholder="0" />
                    </div>
                  </div>
                ) : addForm.billing_type_id && addForm.billing_type_id !== '2' ? (
                  <div className="form-group">
                    <label>Honorar (€)</label>
                    <input type="number" min={0} step={0.01} style={{ width: 120 }} value={addForm.revenue} onChange={e => setAF('revenue')(e.target.value)} placeholder="0" />
                  </div>
                ) : null}

                <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                  <button className="btn btn-primary" disabled={addNodeMut.isPending || !addForm.billing_type_id}
                    onClick={() => addNodeMut.mutate(addForm)}>
                    {addNodeMut.isPending ? 'Speichert …' : 'Hinzufügen'}
                  </button>
                  <button type="button" onClick={() => { setShowAdd(false); setAddForm(emptyAddForm()) }}>Abbrechen</button>
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
