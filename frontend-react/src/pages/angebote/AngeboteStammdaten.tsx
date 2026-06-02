import { useState, useEffect, useCallback } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useCtrlS }     from '@/hooks/useCtrlS'
import { useSaveState } from '@/hooks/useSaveState'
import { SaveBadge }    from '@/components/ui/SaveBadge'
import { Autocomplete } from '@/components/ui/Autocomplete'
import { ConfirmModal } from '@/components/ui/ConfirmModal'
import {
  fetchOffer, updateOffer, copyOffer, fetchOfferStructure, convertOffer, openOfferPdf, openAuftragsbestaetigungPdf,
  type Offer, type ConvertOfferPayload,
} from '@/api/angebote'
import { fetchOfferStatuses } from '@/api/angebote'
import { fetchProjectManagers } from '@/api/projekte'
import { fetchCompanies }      from '@/api/rechnungen'
import { searchAddressesApi, fetchContactsByAddress } from '@/api/stammdaten'
import { BeauftragtModal } from './BeauftragtModal'

interface EditForm {
  name_long: string; company_id: string; offer_status_id: string; employee_id: string
  probability: string; offer_text_1: string; offer_text_2: string
  address_id: string; contact_id: string; offer_date: string; valid_until: string
}

function offerToForm(o: Offer): EditForm {
  return {
    name_long:       o.NAME_LONG       ?? '',
    company_id:      o.COMPANY_ID != null ? String(o.COMPANY_ID) : '',
    offer_status_id: o.OFFER_STATUS_ID != null ? String(o.OFFER_STATUS_ID) : '',
    employee_id:     o.EMPLOYEE_ID != null ? String(o.EMPLOYEE_ID) : '',
    probability:     o.PROBABILITY != null ? String(o.PROBABILITY) : '',
    offer_text_1:    o.OFFER_TEXT_1    ?? '',
    offer_text_2:    o.OFFER_TEXT_2    ?? '',
    address_id:      o.ADDRESS_ID != null ? String(o.ADDRESS_ID) : '',
    contact_id:      o.CONTACT_ID != null ? String(o.CONTACT_ID) : '',
    offer_date:      o.OFFER_DATE      ?? '',
    valid_until:     o.VALID_UNTIL     ?? '',
  }
}

interface Props {
  initialOfferId?: number
  onOfferChange?: (_id: number | null) => void
}

export function AngeboteStammdaten({ initialOfferId }: Props) {
  const qc = useQueryClient()
  const [oid, setOid]         = useState<number | null>(initialOfferId ?? null)
  const [form, setForm]       = useState<EditForm | null>(null)
  const [addrText, setAddrText] = useState('')
  const [showBeauftragt, setShowBeauftragt] = useState(false)
  const [convertErr, setConvertErr]         = useState<string | null>(null)
  const [confirmState, setConfirmState]     = useState<{ title: string; message: string; onConfirm: () => void } | null>(null)
  const saveState = useSaveState()

  const { data: statusData  } = useQuery({ queryKey: ['offer-statuses'],  queryFn: fetchOfferStatuses  })
  const { data: mgrData     } = useQuery({ queryKey: ['project-managers'],queryFn: fetchProjectManagers })
  const { data: companyData } = useQuery({ queryKey: ['companies'],       queryFn: fetchCompanies      })
  const { data: offerData, isLoading } = useQuery({
    queryKey: ['offer', oid], queryFn: () => fetchOffer(oid!), enabled: oid !== null,
  })
  const addressId = form?.address_id ? Number(form.address_id) : null
  const { data: contactData } = useQuery({
    queryKey: ['contacts-by-address', addressId],
    queryFn:  () => fetchContactsByAddress(addressId!), enabled: !!addressId,
  })
  const { data: structData } = useQuery({
    queryKey: ['offer-structure', oid],
    queryFn:  () => fetchOfferStructure(oid!), enabled: showBeauftragt && oid !== null,
  })

  useEffect(() => { if (initialOfferId) { setOid(initialOfferId); setAddrText('') } }, [initialOfferId])
  useEffect(() => { if (offerData?.data) { setForm(offerToForm(offerData.data)); setAddrText('') } }, [offerData?.data])

  const statuses  = statusData?.data  ?? []
  const managers  = mgrData?.data     ?? []
  const companies = companyData?.data ?? []
  const contacts  = contactData?.data ?? []

  const searchAddresses = useCallback(async (q: string) => {
    const res = await searchAddressesApi(q)
    return res.data.map(a => ({ id: a.ID, label: a.ADDRESS_NAME_1 }))
  }, [])

  const saveMut = useMutation({
    mutationFn: (f: EditForm) => updateOffer(oid!, {
      name_long:       f.name_long,
      company_id:      f.company_id || undefined,
      offer_status_id: Number(f.offer_status_id),
      employee_id:     Number(f.employee_id),
      address_id:      Number(f.address_id),
      contact_id:      Number(f.contact_id),
      probability:     f.probability !== '' ? Number(f.probability) : null,
      offer_text_1:    f.offer_text_1 || null,
      offer_text_2:    f.offer_text_2 || null,
      offer_date:      f.offer_date   || null,
      valid_until:     f.valid_until  || null,
    }),
    onSuccess: () => {
      saveState.mark('saved')
      void qc.invalidateQueries({ queryKey: ['offers'] })
      void qc.invalidateQueries({ queryKey: ['offer', oid] })
    },
    onError: () => { saveState.mark('error') },
  })

  const copyMut = useMutation({
    mutationFn: () => copyOffer(oid!),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['offers'] }),
    onError: () => {},
  })

  const convertMut = useMutation({
    mutationFn: (body: ConvertOfferPayload) => convertOffer(oid!, body),
    onSuccess: () => {
      setShowBeauftragt(false); setConvertErr(null)
      void qc.invalidateQueries({ queryKey: ['offer', oid] })
      void qc.invalidateQueries({ queryKey: ['offers'] })
    },
    onError: (e: Error) => setConvertErr(e.message),
  })

  const { data: statusListData } = useQuery({ queryKey: ['offer-statuses'], queryFn: fetchOfferStatuses })
  const beauftragtStatusId = statusListData?.data?.find(s => s.NAME_SHORT === 'Beauftragt')?.ID ?? null

  const markOrderedMut = useMutation({
    mutationFn: (body: { order_date: string; project_id?: number | null }) =>
      updateOffer(oid!, {
        order_date: body.order_date,
        project_id: body.project_id ?? null,
        ...(beauftragtStatusId ? { offer_status_id: beauftragtStatusId } : {}),
      }),
    onSuccess: () => {
      setShowBeauftragt(false); setConvertErr(null)
      void qc.invalidateQueries({ queryKey: ['offer', oid] })
      void qc.invalidateQueries({ queryKey: ['offers'] })
    },
    onError: (e: Error) => setConvertErr(e.message),
  })

  const setF = (k: keyof EditForm) => (v: string) => { setForm(f => f ? { ...f, [k]: v } : f) }

  function handleSave() { if (form && !saveMut.isPending) { saveState.mark('saving'); saveMut.mutate(form) } }

  useCtrlS(handleSave, !!form)

  if (!oid || isLoading || !form) {
    return (
      <div className="ls-wrap">
        <p className="ls-empty" style={{ marginTop: 24 }}>Kein Angebot ausgewählt. Bitte in der Angebotsliste eines öffnen.</p>
      </div>
    )
  }

  const isBeauftragt = !!offerData?.data?.PROJECT_ID

  return (
    <div className="ls-wrap">

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 16 }}>
        <button className="btn-small" onClick={() => openOfferPdf(oid)}>PDF öffnen</button>
        <button className="btn-small" onClick={() => copyMut.mutate()} disabled={copyMut.isPending}>
          {copyMut.isPending ? '…' : 'Kopieren'}
        </button>
        {isBeauftragt ? (
          <>
            <span style={{ fontSize: 13, color: '#16a34a', fontWeight: 600 }}>
              ✅ Beauftragt
            </span>
            <button className="btn-small" onClick={() => openAuftragsbestaetigungPdf(oid)}>Auftragsbestätigung PDF</button>
          </>
        ) : (
          <button className="btn" style={{ background: '#16a34a', color: '#fff', borderColor: '#16a34a' }}
            onClick={() => { setConvertErr(null); setShowBeauftragt(true) }}>
            Beauftragt
          </button>
        )}
        <SaveBadge state={saveState.state} />
      </div>

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
          <label>Gültig bis</label>
          <input type="date" value={form.valid_until} onChange={e => setF('valid_until')(e.target.value)} />
        </div>
        <div className="form-group">
          <label>Wahrscheinlichkeit (%)</label>
          <input type="number" min={0} max={100} step={1} value={form.probability}
            onChange={e => setF('probability')(e.target.value)} />
        </div>
      </div>

      <Autocomplete label="Adresse / Empfänger*" htmlId="stmd-offer-addr"
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
        <textarea rows={4} value={form.offer_text_1} onChange={e => setF('offer_text_1')(e.target.value)}
          style={{ width: '100%', resize: 'vertical' }} />
      </div>

      <div className="form-group">
        <label>Fußtext</label>
        <textarea rows={4} value={form.offer_text_2} onChange={e => setF('offer_text_2')(e.target.value)}
          style={{ width: '100%', resize: 'vertical' }} />
      </div>

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 8 }}>
        <button className="btn btn-primary" disabled={saveMut.isPending} onClick={handleSave}>
          {saveMut.isPending ? 'Speichert …' : 'Speichern (Strg+S)'}
        </button>
        <SaveBadge state={saveState.state} />
      </div>

      <BeauftragtModal
        open={showBeauftragt}
        offerName={offerData?.data?.NAME_SHORT ?? offerData?.data?.NAME_LONG ?? ''}
        structNodes={structData?.data ?? []}
        onConvert={body => convertMut.mutate(body)}
        onMarkOrdered={body => markOrderedMut.mutate(body)}
        onClose={() => setShowBeauftragt(false)}
        isPending={convertMut.isPending || markOrderedMut.isPending}
        error={convertErr}
      />

      <ConfirmModal
        open={confirmState !== null}
        title={confirmState?.title ?? ''}
        message={confirmState?.message ?? ''}
        onConfirm={() => { confirmState?.onConfirm(); setConfirmState(null) }}
        onCancel={() => setConfirmState(null)}
      />
    </div>
  )
}
