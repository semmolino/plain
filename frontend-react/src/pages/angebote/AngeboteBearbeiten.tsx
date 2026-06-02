import { useState, useEffect, useCallback, useMemo, Fragment } from 'react'
import { useCtrlS } from '@/hooks/useCtrlS'
import { useSaveState } from '@/hooks/useSaveState'
import { SaveBadge } from '@/components/ui/SaveBadge'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Message }      from '@/components/ui/Message'
import { Modal }        from '@/components/ui/Modal'
import { ConfirmModal } from '@/components/ui/ConfirmModal'
import { Autocomplete } from '@/components/ui/Autocomplete'
import { Percent } from 'lucide-react'
import {
  fetchOffers, fetchOffer, updateOffer, fetchOfferStructure,
  addOfferStructureNode, updateOfferStructureNode, deleteOfferStructureNode, convertOffer, copyOffer,
  updateOfferStructureSurcharges,
  openOfferPdf, type Offer, type OfferStructureNode, type AddStructureNodePayload, type ConvertOfferPayload,
} from '@/api/angebote'
import { fetchOfferStatuses } from '@/api/angebote'
import { BeauftragtModal } from './BeauftragtModal'
import { HonorarWizard } from '@/pages/projekte/HonorarWizard'
import { fetchFeeCalcMasters, openHonorarPdf, deleteFeeCalcMaster } from '@/api/fee'
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

interface EditNodeForm {
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
}

type SurchargeEdit = {
  s1Label: string; s1Pct: string; s1Cumul: boolean
  s2Label: string; s2Pct: string; s2Cumul: boolean
  s3Label: string; s3Pct: string; s3Cumul: boolean
}

function nodeToEditForm(n: OfferStructureNode): EditNodeForm {
  const isHourly = Number(n.BILLING_TYPE_ID) === 2
  return {
    name_short:      n.NAME_SHORT ?? '',
    name_long:       n.NAME_LONG  ?? '',
    billing_type_id: n.BILLING_TYPE_ID != null ? String(n.BILLING_TYPE_ID) : '',
    extras_percent:  n.EXTRAS_PERCENT  != null ? String(n.EXTRAS_PERCENT)  : '0',
    revenue:         !isHourly ? String(n.REVENUE_BASIS ?? n.REVENUE ?? 0) : '',
    quantity:        n.QUANTITY != null ? String(n.QUANTITY) : '',
    sp_rate:         n.SP_RATE  != null ? String(n.SP_RATE)  : '',
    role_id:         n.ROLE_ID  != null ? String(n.ROLE_ID)  : '',
    role_name_short: n.ROLE_NAME_SHORT ?? '',
    role_name_long:  n.ROLE_NAME_LONG  ?? '',
  }
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
  const saveState = useSaveState()
  const [structMsg,  setStructMsg]  = useState<{ text: string; type: 'success' | 'error' } | null>(null)
  const [showBeauftragt, setShowBeauftragt] = useState(false)
  const [convertErr,     setConvertErr]     = useState<string | null>(null)
  const [editNode,          setEditNode]          = useState<OfferStructureNode | null>(null)
  const [editNodeForm,      setEditNodeForm]      = useState<EditNodeForm | null>(null)
  const [editNodeMsg,       setEditNodeMsg]       = useState<{ text: string; type: 'success'|'error' } | null>(null)
  const [showHonorarWizard, setShowHonorarWizard] = useState(false)
  const [editCalcId, setEditCalcId] = useState<number | null>(null)
  const [confirmState, setConfirmState] = useState<{ title: string; message: string; onConfirm: () => void } | null>(null)
  const [surchargePanel, setSurchargePanel] = useState<number | null>(null)
  const [surchargeEdits, setSurchargeEdits] = useState<Record<number, SurchargeEdit>>({})

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

  // HOAI calculations linked to this offer
  const { data: feeCalcData, refetch: refetchFeeCalcs } = useQuery({
    queryKey: ['fee-calc-masters-offer', selectedId],
    queryFn:  () => fetchFeeCalcMasters({ offer_id: selectedId! }),
    enabled:  selectedId !== null,
  })

  const offers   = offersData?.data  ?? []
  const statuses = statusData?.data  ?? []
  const managers = mgrData?.data     ?? []
  const btypes   = btData?.data      ?? []
  const roles    = roleData?.data    ?? []
  const companies = companyData?.data ?? []
  const contacts = contactData?.data ?? []
  const structNodes = structData?.data ?? []
  const feeCalcs = feeCalcData?.data ?? []

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
      saveState.mark('saved')
      setMsg(null)
      void qc.invalidateQueries({ queryKey: ['offers'] })
      void qc.invalidateQueries({ queryKey: ['offer', selectedId] })
    },
    onError: (e: Error) => { saveState.mark('error'); setMsg({ text: e.message, type: 'error' }) },
  })

  useCtrlS(() => { if (!saveMut.isPending && form) saveMut.mutate(form) }, !!form)

  const copyMut = useMutation({
    mutationFn: () => copyOffer(selectedId!),
    onSuccess: (res) => {
      void qc.invalidateQueries({ queryKey: ['offers'] })
      setMsg({ text: `Angebot kopiert: ${res.data.NAME_SHORT}`, type: 'success' })
    },
    onError: (e: Error) => setMsg({ text: e.message, type: 'error' }),
  })

  const convertMut = useMutation({
    mutationFn: (body: ConvertOfferPayload) => convertOffer(selectedId!, body),
    onSuccess: (res) => {
      setShowBeauftragt(false)
      setConvertErr(null)
      void qc.invalidateQueries({ queryKey: ['offer', selectedId] })
      void qc.invalidateQueries({ queryKey: ['offers'] })
      setMsg({ text: `Projekt ${res.data.projectName} wurde angelegt ✅`, type: 'success' })
    },
    onError: (e: Error) => setConvertErr(e.message),
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

  const deleteCalcMut = useMutation({
    mutationFn: (calcId: number) => deleteFeeCalcMaster(calcId),
    onSuccess: () => void refetchFeeCalcs(),
    onError: (e: Error) => setMsg({ text: e.message, type: 'error' }),
  })

  const updateNodeMut = useMutation({
    mutationFn: ({ nodeId, f }: { nodeId: number; f: EditNodeForm }) => {
      const isHourly = f.billing_type_id === '2'
      return updateOfferStructureNode(selectedId!, nodeId, {
        name_short:      f.name_short,
        name_long:       f.name_long,
        billing_type_id: Number(f.billing_type_id),
        extras_percent:  Number(f.extras_percent) || 0,
        role_id:         f.role_id ? Number(f.role_id) : null,
        role_name_short: f.role_name_short || undefined,
        role_name_long:  f.role_name_long  || undefined,
        ...(isHourly
          ? { quantity: Number(f.quantity) || 0, sp_rate: Number(f.sp_rate) || 0 }
          : { revenue:  Number(f.revenue)  || 0 }),
      })
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['offer-structure', selectedId] })
      setStructMsg({ text: 'Position gespeichert ✅', type: 'success' })
      setEditNode(null)
    },
    onError: (e: Error) => setEditNodeMsg({ text: e.message, type: 'error' }),
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

  const setENF = (k: keyof EditNodeForm) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setEditNodeForm(f => f ? { ...f, [k]: e.target.value } : f)

  function applyRoleToEdit(roleId: string) {
    const role = roles.find(r => String(r.ID) === roleId)
    setEditNodeForm(f => f ? ({
      ...f,
      role_id:         roleId,
      role_name_short: role?.NAME_SHORT ?? '',
      role_name_long:  role?.NAME_LONG  ?? '',
      sp_rate:         role?.SP_RATE != null ? String(role.SP_RATE) : f.sp_rate,
    }) : f)
  }

  function openNodeEdit(n: OfferStructureNode) {
    setEditNode(n)
    setEditNodeForm(nodeToEditForm(n))
    setEditNodeMsg(null)
  }

  function surchargeDefault(n: OfferStructureNode): SurchargeEdit {
    return {
      s1Label: n.SURCHARGE_1_LABEL ?? '', s1Pct: n.SURCHARGE_1_PCT != null ? String(n.SURCHARGE_1_PCT) : '', s1Cumul: n.SURCHARGE_1_CUMUL ?? true,
      s2Label: n.SURCHARGE_2_LABEL ?? '', s2Pct: n.SURCHARGE_2_PCT != null ? String(n.SURCHARGE_2_PCT) : '', s2Cumul: n.SURCHARGE_2_CUMUL ?? true,
      s3Label: n.SURCHARGE_3_LABEL ?? '', s3Pct: n.SURCHARGE_3_PCT != null ? String(n.SURCHARGE_3_PCT) : '', s3Cumul: n.SURCHARGE_3_CUMUL ?? true,
    }
  }

  function computeSurchargesDisplay(base: number, s: SurchargeEdit) {
    const r2 = (n: number) => Math.round(n * 100) / 100
    const s1Active = !!s.s1Label && s.s1Pct !== '' && Number(s.s1Pct) !== 0
    const s1Eur    = s1Active ? r2(base * Number(s.s1Pct) / 100) : 0
    const s1Sub    = base + s1Eur
    const s2Base   = s.s2Cumul ? s1Sub : base
    const s2Active = !!s.s2Label && s.s2Pct !== '' && Number(s.s2Pct) !== 0
    const s2Eur    = s2Active ? r2(s2Base * Number(s.s2Pct) / 100) : 0
    const s2Sub    = s1Sub + s2Eur
    const s3Base   = s.s3Cumul ? s2Sub : base
    const s3Active = !!s.s3Label && s.s3Pct !== '' && Number(s.s3Pct) !== 0
    const s3Eur    = s3Active ? r2(s3Base * Number(s.s3Pct) / 100) : 0
    return { s1Eur, s2Eur, s3Eur, total: r2(s1Eur + s2Eur + s3Eur) }
  }

  const surchargeMut = useMutation({
    mutationFn: ({ id, s }: { id: number; s: SurchargeEdit }) =>
      updateOfferStructureSurcharges(selectedId!, id, {
        SURCHARGE_1_LABEL: s.s1Label || null, SURCHARGE_1_PCT: s.s1Pct !== '' ? Number(s.s1Pct) : null, SURCHARGE_1_CUMUL: s.s1Cumul,
        SURCHARGE_2_LABEL: s.s2Label || null, SURCHARGE_2_PCT: s.s2Pct !== '' ? Number(s.s2Pct) : null, SURCHARGE_2_CUMUL: s.s2Cumul,
        SURCHARGE_3_LABEL: s.s3Label || null, SURCHARGE_3_PCT: s.s3Pct !== '' ? Number(s.s3Pct) : null, SURCHARGE_3_CUMUL: s.s3Cumul,
      }),
    onSuccess: (_, { id }) => {
      void qc.invalidateQueries({ queryKey: ['offer-structure', selectedId] })
      setSurchargeEdits(prev => { const n = { ...prev }; delete n[id]; return n })
      setStructMsg({ text: 'Zuschläge gespeichert ✅', type: 'success' })
    },
    onError: (e: Error) => setStructMsg({ text: e.message, type: 'error' }),
  })

  function closeSurchargePanel(nodeId: number) {
    const pending = surchargeEdits[nodeId]
    if (pending) surchargeMut.mutate({ id: nodeId, s: pending })
    setSurchargePanel(null)
  }

  // Map OFFER_STRUCTURE nodes to the STRUCTURE_ID shape expected by treeUtils
  const mappedForTree = structNodes.map(n => ({ ...n, STRUCTURE_ID: n.ID }))
  const flatNodes = mappedForTree.length
    ? flattenTree(buildStructureTree(mappedForTree as unknown as StructureNode[]))
    : []

  const parentIds = new Set(structNodes.filter(n => n.FATHER_ID != null).map(n => String(n.FATHER_ID)))

  const aggMap = useMemo(() => {
    const childrenOf = new Map<string, string[]>()
    for (const n of structNodes) {
      if (n.FATHER_ID != null) {
        const fid = String(n.FATHER_ID)
        const arr = childrenOf.get(fid) ?? []
        arr.push(String(n.ID))
        childrenOf.set(fid, arr)
      }
    }
    const nodeMap = new Map(structNodes.map(n => [String(n.ID), n]))
    const cache = new Map<string, { surcharges: number; revenueBasis: number }>()
    function agg(id: string): { surcharges: number; revenueBasis: number } {
      if (cache.has(id)) return cache.get(id)!
      const children = childrenOf.get(id) ?? []
      if (children.length === 0) {
        const node = nodeMap.get(id)!
        const rb = node?.REVENUE_BASIS != null
          ? Number(node.REVENUE_BASIS)
          : Math.max(0, Number(node?.REVENUE ?? 0) - Number(node?.SURCHARGES_TOTAL ?? 0))
        const r = { surcharges: Number(node?.SURCHARGES_TOTAL ?? 0), revenueBasis: rb }
        cache.set(id, r); return r
      }
      let surcharges = 0, revenueBasis = 0
      for (const cid of children) { const c = agg(cid); surcharges += c.surcharges; revenueBasis += c.revenueBasis }
      surcharges += Number(nodeMap.get(id)?.SURCHARGES_TOTAL ?? 0)
      cache.set(id, { surcharges, revenueBasis }); return { surcharges, revenueBasis }
    }
    for (const n of structNodes) agg(String(n.ID))
    return cache
  }, [structNodes])

  const FMT_EUR = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2, maximumFractionDigits: 2 })

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
    <>
    <div className="ls-wrap">
      {/* Offer selector */}
      <div className="ls-toolbar">
        <label className="ls-label">Angebot</label>
        <select className="ls-select" value={selectedId} onChange={e => setSelectedId(Number(e.target.value) || null)}>
          <option value="">— Angebot wählen —</option>
          {offers.map(o => <option key={o.ID} value={o.ID}>{o.NAME_SHORT} – {o.NAME_LONG}</option>)}
        </select>
        {selectedId && (
          <>
            <button className="btn-small" onClick={() => openOfferPdf(selectedId)} style={{ marginLeft: 8 }}>PDF</button>
            <button className="btn-small" onClick={() => copyMut.mutate()} disabled={copyMut.isPending} style={{ marginLeft: 4 }}>
              {copyMut.isPending ? '…' : 'Kopieren'}
            </button>
          </>
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

            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <button className="btn btn-primary" disabled={saveMut.isPending} onClick={() => { setMsg(null); saveState.mark('saving'); saveMut.mutate(form) }}>
                {saveMut.isPending ? 'Speichert …' : 'Änderungen speichern'}
              </button>
              <SaveBadge state={saveState.state} />

              {offerData?.data?.PROJECT_ID ? (
                <span style={{ color: '#16a34a', fontSize: 13, fontWeight: 500 }}>
                  ✅ Beauftragt → {offers.find(o => o.ID === selectedId)?.PROJECT_NAME ?? `Projekt #${offerData.data.PROJECT_ID}`}
                </span>
              ) : (
                <button
                  className="btn"
                  style={{ background: '#16a34a', color: '#fff', borderColor: '#16a34a' }}
                  onClick={() => { setConvertErr(null); setShowBeauftragt(true) }}
                >
                  Beauftragt
                </button>
              )}
            </div>
          </div>

          {/* ── HOAI-Kalkulationen ── */}
          {feeCalcs.length > 0 && (
            <div style={{ marginBottom: 24 }}>
              <h3 className="wizard-step-title" style={{ marginBottom: 12 }}>HOAI-Kalkulationen</h3>
              <div className="table-scroll">
                <table className="ls-table">
                  <thead>
                    <tr>
                      <th className="ls-th">§</th>
                      <th className="ls-th">Bezeichnung</th>
                      <th className="ls-th ls-col-num">Grundhonorar</th>
                      <th className="ls-th ls-col-num">Gesamthonorar</th>
                      <th className="ls-th"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {feeCalcs.map(c => (
                      <tr key={c.ID} className="ls-row">
                        <td className="ls-td">{c.NAME_SHORT || '—'}</td>
                        <td className="ls-td">{c.NAME_LONG || '—'}</td>
                        <td className="ls-td" style={{ textAlign: 'right' }}>
                          {c.grundhonorar != null ? c.grundhonorar.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €' : '—'}
                        </td>
                        <td className="ls-td" style={{ textAlign: 'right', fontWeight: 600 }}>
                          {c.gesamthonorar != null ? c.gesamthonorar.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €' : '—'}
                        </td>
                        <td className="ls-td doc-actions">
                          <button type="button" className="btn-small" onClick={() => setEditCalcId(c.ID)}>Bearbeiten</button>
                          <button type="button" className="btn-small" onClick={() => openHonorarPdf(c.ID)}>PDF</button>
                          <button
                            type="button"
                            className="btn-small btn-danger"
                            disabled={deleteCalcMut.isPending}
                            onClick={() => setConfirmState({ title: 'Kalkulation löschen', message: `HOAI-Kalkulation „${c.NAME_SHORT || c.NAME_LONG || 'Kalkulation'}" und alle zugehörigen Daten löschen?`, onConfirm: () => deleteCalcMut.mutate(c.ID) })}
                          >×</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

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
                      <th className="ls-th ls-col-num">Honorar €</th>
                      <th className="ls-th ls-col-num">Zuschläge €</th>
                      <th className="ls-th ls-col-num">Honorar + Zuschl. €</th>
                      <th className="ls-th ls-col-num">NK</th>
                      <th className="ls-th ls-col-num">Gesamt</th>
                      <th className="ls-th"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {flatNodes.map(({ node, depth }) => {
                      const n        = node as unknown as OfferStructureNode
                      const revenue  = Number(n.REVENUE || 0)
                      const extras   = Number(n.EXTRAS  || 0)
                      const bt       = btypes.find(b => b.ID === n.BILLING_TYPE_ID)
                      const isParent = parentIds.has(String(n.ID))
                      const hasSurcharges = (n.SURCHARGES_TOTAL ?? 0) > 0
                      const displayRevenueBasis = isParent
                        ? (aggMap.get(String(n.ID))?.revenueBasis ?? (n.REVENUE_BASIS ?? revenue))
                        : (n.REVENUE_BASIS != null ? Number(n.REVENUE_BASIS) : revenue)
                      const displaySurcharges = isParent
                        ? (aggMap.get(String(n.ID))?.surcharges ?? (n.SURCHARGES_TOTAL ?? 0))
                        : (n.SURCHARGES_TOTAL ?? 0)
                      const sEdit        = surchargeEdits[n.ID] ?? surchargeDefault(n)
                      const surchargeBase = n.REVENUE_BASIS != null ? Number(n.REVENUE_BASIS) : revenue
                      const computed     = computeSurchargesDisplay(surchargeBase, sEdit)
                      return (
                        <Fragment key={n.ID}>
                        <tr className={`ls-row ${isParent ? 'ls-row-parent' : 'ls-row-leaf'}`}>
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
                          <td className="ls-td ls-right">
                            <span style={{ color: isParent ? 'rgba(17,24,39,0.45)' : undefined, fontSize: isParent ? 12 : undefined }}>
                              {FMT_EUR.format(displayRevenueBasis)}
                            </span>
                          </td>
                          <td className="ls-td ls-right">
                            {displaySurcharges !== 0 ? (
                              <span style={{ color: displaySurcharges > 0 ? '#16a34a' : '#dc2626', fontSize: 12 }}>{FMT_EUR.format(displaySurcharges)}</span>
                            ) : (
                              <span className="ls-muted">—</span>
                            )}
                          </td>
                          <td className="ls-td ls-right">
                            <span style={{ fontSize: 12, fontWeight: hasSurcharges ? 600 : undefined }}>
                              {FMT_EUR.format(revenue)}
                            </span>
                          </td>
                          <td className="ls-td ls-right">{FMT_EUR.format(extras)}</td>
                          <td className="ls-td ls-right">{FMT_EUR.format(revenue + extras)}</td>
                          <td className="ls-td doc-actions">
                            <button
                              className="row-action-btn"
                              title={hasSurcharges ? `Zuschläge (${FMT_EUR.format(n.SURCHARGES_TOTAL ?? 0)})` : 'Zuschläge bearbeiten'}
                              style={hasSurcharges ? { color: '#2563eb', borderColor: '#2563eb' } : { color: '#6b7280' }}
                              onClick={() => { if (surchargePanel === n.ID) closeSurchargePanel(n.ID); else setSurchargePanel(n.ID) }}
                            ><Percent size={13} strokeWidth={2} /></button>
                            <button className="btn-small" onClick={() => openNodeEdit(n)}>Bearbeiten</button>
                            <button className="btn-small btn-danger"
                              disabled={deleteNodeMut.isPending}
                              onClick={() => setConfirmState({ title: 'Position löschen', message: `Position „${n.NAME_SHORT}" löschen?`, onConfirm: () => deleteNodeMut.mutate({ nodeId: n.ID }) })}>
                              ×
                            </button>
                          </td>
                        </tr>
                        {surchargePanel === n.ID && (
                          <tr className="surcharge-panel-row">
                            <td colSpan={9}>
                              <div className="surcharge-panel">
                                <div className="surcharge-panel-basis">
                                  Basis (Honorar): <strong>{FMT_EUR.format(surchargeBase)}</strong>
                                </div>
                                <div className="surcharge-grid">
                                  <div className="surcharge-grid-header">
                                    <span>Kumul.</span>
                                    <span>Bezeichnung</span>
                                    <span style={{ textAlign: 'right' }}>%</span>
                                    <span style={{ textAlign: 'right' }}>Betrag</span>
                                  </div>
                                  {([
                                    {
                                      label: sEdit.s1Label, pct: sEdit.s1Pct, cumul: sEdit.s1Cumul, eur: computed.s1Eur,
                                      disableCumul: true, placeholder: 'z.B. GP-Zuschlag',
                                      onChange: (f: Partial<SurchargeEdit>) => setSurchargeEdits(prev => ({ ...prev, [n.ID]: { ...(prev[n.ID] ?? surchargeDefault(n)), ...f } })),
                                      labelKey: 's1Label' as const, pctKey: 's1Pct' as const, cumulKey: 's1Cumul' as const,
                                    },
                                    {
                                      label: sEdit.s2Label, pct: sEdit.s2Pct, cumul: sEdit.s2Cumul, eur: computed.s2Eur,
                                      disableCumul: false, placeholder: '(leer = inaktiv)',
                                      onChange: (f: Partial<SurchargeEdit>) => setSurchargeEdits(prev => ({ ...prev, [n.ID]: { ...(prev[n.ID] ?? surchargeDefault(n)), ...f } })),
                                      labelKey: 's2Label' as const, pctKey: 's2Pct' as const, cumulKey: 's2Cumul' as const,
                                    },
                                    {
                                      label: sEdit.s3Label, pct: sEdit.s3Pct, cumul: sEdit.s3Cumul, eur: computed.s3Eur,
                                      disableCumul: false, placeholder: '(leer = inaktiv)',
                                      onChange: (f: Partial<SurchargeEdit>) => setSurchargeEdits(prev => ({ ...prev, [n.ID]: { ...(prev[n.ID] ?? surchargeDefault(n)), ...f } })),
                                      labelKey: 's3Label' as const, pctKey: 's3Pct' as const, cumulKey: 's3Cumul' as const,
                                    },
                                  ] as const).map((row, i) => (
                                    <div className="surcharge-grid-row" key={i}>
                                      <input type="checkbox" checked={row.cumul} disabled={row.disableCumul}
                                        title={row.disableCumul ? 'Erster Zuschlag bezieht sich immer auf die Basis' : 'Kumulativ (auf laufende Zwischensumme)'}
                                        onChange={e => row.onChange({ [row.cumulKey]: e.target.checked })} />
                                      <input className="tbl-input" placeholder={row.placeholder}
                                        value={row.label}
                                        onChange={e => row.onChange({ [row.labelKey]: e.target.value })} />
                                      <input className="tbl-input" type="number" min={-100} max={500} step={0.1}
                                        style={{ width: 64, textAlign: 'right' }}
                                        value={row.pct}
                                        onChange={e => row.onChange({ [row.pctKey]: e.target.value })} />
                                      <span className="surcharge-eur">{row.label || row.pct ? FMT_EUR.format(row.eur) : '—'}</span>
                                    </div>
                                  ))}
                                  <div className="surcharge-grid-total">
                                    Gesamt Zuschläge: <strong>{FMT_EUR.format(computed.total)}</strong>
                                  </div>
                                </div>
                                <div className="surcharge-panel-actions">
                                  <button className="btn-small" onClick={() => closeSurchargePanel(n.ID)}>
                                    {surchargeMut.isPending ? 'Speichert …' : 'Schließen (speichert automatisch)'}
                                  </button>
                                </div>
                              </div>
                            </td>
                          </tr>
                        )}
                        </Fragment>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {/* Add node form */}
            {!showAdd && (
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn-small btn-save" type="button" onClick={() => setShowAdd(true)}>+ Position hinzufügen</button>
                <button className="btn-small btn-save" type="button" onClick={() => setShowHonorarWizard(true)}>+ HOAI-Kalkulation</button>
              </div>
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

    {selectedId && showHonorarWizard && (
      <Modal open={showHonorarWizard} onClose={() => setShowHonorarWizard(false)} title="HOAI-Kalkulation hinzufügen" className="modal-xl">
        <HonorarWizard
          offerId={selectedId}
          onDone={() => {
            setShowHonorarWizard(false)
            void refetchFeeCalcs()
          }}
        />
      </Modal>
    )}

    {selectedId && editCalcId !== null && (
      <Modal open={editCalcId !== null} onClose={() => setEditCalcId(null)} title="HOAI-Kalkulation bearbeiten" className="modal-xl">
        <HonorarWizard
          existingId={editCalcId}
          offerId={selectedId}
          onDone={() => {
            setEditCalcId(null)
            void refetchFeeCalcs()
          }}
        />
      </Modal>
    )}

    <ConfirmModal
      open={confirmState !== null}
      title={confirmState?.title ?? ''}
      message={confirmState?.message ?? ''}
      onConfirm={() => confirmState?.onConfirm()}
      onCancel={() => setConfirmState(null)}
    />

    {selectedId && (
      <BeauftragtModal
        open={showBeauftragt}
        offerName={offerData?.data?.NAME_SHORT ?? offerData?.data?.NAME_LONG ?? ''}
        structNodes={structNodes}
        onConvert={body => convertMut.mutate(body)}
        onClose={() => setShowBeauftragt(false)}
        isPending={convertMut.isPending}
        error={convertErr}
      />
    )}

    {/* ── Edit structure node modal ── */}
    <Modal open={editNode !== null} onClose={() => setEditNode(null)} title="Position bearbeiten">
      {editNodeForm && (
        <div className="master-form">
          <div className="form-row">
            <div className="form-group">
              <label>Position</label>
              <input value={editNodeForm.name_short} onChange={setENF('name_short')} placeholder="z. B. 1.1" />
            </div>
            <div className="form-group" style={{ flex: 2 }}>
              <label>Bezeichnung</label>
              <input value={editNodeForm.name_long} onChange={setENF('name_long')} placeholder="Leistungsbeschreibung" />
            </div>
          </div>

          <div className="form-row">
            <div className="form-group">
              <label>Leistungsart*</label>
              <select value={editNodeForm.billing_type_id} onChange={setENF('billing_type_id')}>
                <option value="">Bitte wählen …</option>
                {btypes.map(b => <option key={b.ID} value={b.ID}>{b.NAME_SHORT}{b.NAME_LONG ? ' – ' + b.NAME_LONG : ''}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label>NK %</label>
              <input type="number" min={0} max={100} step={0.1} value={editNodeForm.extras_percent} onChange={setENF('extras_percent')} placeholder="0" />
            </div>
          </div>

          {editNodeForm.billing_type_id === '2' ? (
            <div className="form-row">
              <div className="form-group">
                <label>Rolle</label>
                <select value={editNodeForm.role_id} onChange={e => applyRoleToEdit(e.target.value)}>
                  <option value="">—</option>
                  {roles.map(r => <option key={r.ID} value={r.ID}>{r.NAME_SHORT}{r.NAME_LONG ? ' – ' + r.NAME_LONG : ''}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label>Aufwand (h)</label>
                <input type="number" min={0} step={0.5} value={editNodeForm.quantity} onChange={setENF('quantity')} placeholder="0" />
              </div>
              <div className="form-group">
                <label>Stundensatz (€/h)</label>
                <input type="number" min={0} step={0.01} value={editNodeForm.sp_rate} onChange={setENF('sp_rate')} placeholder="0" />
              </div>
            </div>
          ) : editNodeForm.billing_type_id && editNodeForm.billing_type_id !== '2' ? (
            <div className="form-group">
              <label>Honorar (€)</label>
              <input type="number" min={0} step={0.01} value={editNodeForm.revenue} onChange={setENF('revenue')} placeholder="0" />
            </div>
          ) : null}

          <Message text={editNodeMsg?.text ?? null} type={editNodeMsg?.type} />
          <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
            <button className="btn-primary" disabled={updateNodeMut.isPending || !editNodeForm.billing_type_id}
              onClick={() => editNode && updateNodeMut.mutate({ nodeId: editNode.ID, f: editNodeForm })}>
              {updateNodeMut.isPending ? 'Speichert …' : 'Speichern'}
            </button>
            <button type="button" className="btn-small" onClick={() => setEditNode(null)}>Abbrechen</button>
          </div>
        </div>
      )}
    </Modal>
    </>
  )
}
