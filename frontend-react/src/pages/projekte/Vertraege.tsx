import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useCtrlS } from '@/hooks/useCtrlS'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { fetchProjectsShort, fetchContractByProject, patchContract } from '@/api/projekte'
import { searchAddressesApi, fetchContactsByAddress } from '@/api/stammdaten'
import { Autocomplete } from '@/components/ui/Autocomplete'
import { Message } from '@/components/ui/Message'

interface Props {
  initialProjectId?: number
  onProjectChange?: (id: number | null) => void
}

type ContactOpt = { ID: number; FIRST_NAME: string; LAST_NAME: string }

export function Vertraege({ initialProjectId, onProjectChange }: Props) {
  const qc       = useQueryClient()
  const navigate = useNavigate()

  const [pid,          setPid]          = useState<number | null>(initialProjectId ?? null)
  const [nameShort,    setNameShort]    = useState('')
  const [nameLong,     setNameLong]     = useState('')
  const [addressId,    setAddressId]    = useState<number | null>(null)
  const [addrText,     setAddrText]     = useState('')
  const [contactId,    setContactId]    = useState<number | null>(null)
  const [contacts,     setContacts]     = useState<ContactOpt[]>([])
  const [cashDiscPct,  setCashDiscPct]  = useState('')
  const [cashDiscDays, setCashDiscDays] = useState('')
  const [dirty,        setDirty]        = useState(false)
  const [msg,          setMsg]          = useState<{ text: string; type: 'success' | 'error' } | null>(null)

  const { data: projectsData } = useQuery({ queryKey: ['projects-short'], queryFn: fetchProjectsShort })

  const { data: contractData, isLoading, isError } = useQuery({
    queryKey: ['contract', pid],
    queryFn:  () => fetchContractByProject(pid!),
    enabled:  pid !== null,
  })

  // Pre-fill form when contract loads
  useEffect(() => {
    const c = contractData?.data
    if (!c) return

    setNameShort(c.NAME_SHORT ?? '')
    setNameLong(c.NAME_LONG ?? '')
    setCashDiscPct(c.CASH_DISCOUNT_PERCENT != null ? String(c.CASH_DISCOUNT_PERCENT) : '')
    setCashDiscDays(c.CASH_DISCOUNT_DAYS != null ? String(c.CASH_DISCOUNT_DAYS) : '')
    setContactId(c.INVOICE_CONTACT_ID ?? null)
    setDirty(false)

    // Load address and its contacts
    const addrId = c.INVOICE_ADDRESS_ID ?? null
    setAddressId(addrId)
    setAddrText(c.INVOICE_ADDRESS_NAME ?? (addrId ? String(addrId) : ''))
    if (addrId) {
      fetchContactsByAddress(addrId).then(r => setContacts(r.data ?? [])).catch(() => {})
    } else {
      setContacts([])
    }
  }, [contractData?.data])

  const saveMut = useMutation({
    mutationFn: () => {
      const contract = contractData?.data
      if (!contract) throw new Error('Kein Vertrag geladen')
      return patchContract(contract.ID, {
        NAME_SHORT:            nameShort.trim(),
        NAME_LONG:             nameLong.trim(),
        INVOICE_ADDRESS_ID:    addressId,
        INVOICE_CONTACT_ID:    contactId,
        CASH_DISCOUNT_PERCENT: cashDiscPct !== '' ? parseFloat(cashDiscPct) : null,
        CASH_DISCOUNT_DAYS:    cashDiscDays !== '' ? parseInt(cashDiscDays, 10) : null,
      })
    },
    onSuccess: () => {
      setMsg({ text: 'Vertrag gespeichert ✅', type: 'success' })
      setDirty(false)
      void qc.invalidateQueries({ queryKey: ['contract', pid] })
    },
    onError: (err: unknown) =>
      setMsg({ text: (err as { message?: string }).message || 'Fehler beim Speichern', type: 'error' }),
  })

  useCtrlS(() => { if (dirty && !saveMut.isPending) saveMut.mutate() }, dirty)

  const searchAddresses = useCallback(async (q: string) => {
    const res = await searchAddressesApi(q)
    return (res.data ?? []).map(a => ({ id: a.ID, label: a.ADDRESS_NAME_1 }))
  }, [])

  async function handleAddressSelect(id: string | number, label: string) {
    setAddressId(Number(id))
    setAddrText(label)
    setContactId(null)
    setContacts([])
    touch()
    try {
      const r = await fetchContactsByAddress(Number(id))
      setContacts(r.data ?? [])
    } catch { /* ignore */ }
  }

  function handleProjectChange(id: number | null) {
    setPid(id)
    onProjectChange?.(id)
    setMsg(null)
    setDirty(false)
  }

  function touch() { setDirty(true); setMsg(null) }

  function handleReset() {
    const c = contractData?.data
    if (!c) return
    setNameShort(c.NAME_SHORT ?? '')
    setNameLong(c.NAME_LONG ?? '')
    setContactId(c.INVOICE_CONTACT_ID ?? null)
    setCashDiscPct(c.CASH_DISCOUNT_PERCENT != null ? String(c.CASH_DISCOUNT_PERCENT) : '')
    setCashDiscDays(c.CASH_DISCOUNT_DAYS != null ? String(c.CASH_DISCOUNT_DAYS) : '')
    // reset address
    const addrId = c.INVOICE_ADDRESS_ID ?? null
    setAddressId(addrId)
    if (!addrId) { setAddrText(''); setContacts([]) }
    setDirty(false)
    setMsg(null)
  }

  const projects = projectsData?.data ?? []
  const contract = contractData?.data ?? null
  const currentProject = projects.find(p => p.ID === pid)

  return (
    <div className="list-section" style={{ maxWidth: 600 }}>
      {/* Project selector toolbar */}
      <div className="list-toolbar" style={{ marginBottom: 8 }}>
        <select
          className="list-search"
          style={{ maxWidth: 400 }}
          value={pid ?? ''}
          onChange={e => handleProjectChange(e.target.value ? Number(e.target.value) : null)}
        >
          <option value="">— Projekt wählen —</option>
          {projects.map(p => (
            <option key={p.ID} value={p.ID}>{p.NAME_SHORT} – {p.NAME_LONG}</option>
          ))}
        </select>
      </div>

      {/* Jump bar */}
      {pid && (
        <div className="proj-jump-bar">
          <span className="proj-jump-label">{currentProject?.NAME_SHORT ?? ''}</span>
          <button className="btn-small" onClick={() => navigate('/rechnungen', { state: { projectSearch: currentProject?.NAME_LONG ?? currentProject?.NAME_SHORT, backProject: { id: pid, name: currentProject?.NAME_SHORT } } })}>
            Rechnungen →
          </button>
          <button className="btn-small" onClick={() => navigate('/daten', { state: { tab: 'einzelprojekt', projectId: pid } })}>
            Projekt-Report →
          </button>
        </div>
      )}

      {msg && <div style={{ marginBottom: 12 }}><Message type={msg.type} text={msg.text} /></div>}

      {!pid && <p className="empty-note">Bitte ein Projekt auswählen.</p>}
      {pid && isLoading && <p className="empty-note">Lade Vertragsdaten…</p>}
      {pid && isError   && <p className="empty-note" style={{ color: 'var(--color-danger)' }}>Fehler beim Laden.</p>}
      {pid && !isLoading && !contract && !isError && (
        <p className="empty-note">Kein Vertrag für dieses Projekt gefunden.</p>
      )}

      {contract && (
        <div className="master-form" style={{ marginTop: 12 }}>
          <div className="form-group">
            <label>Vertragsnummer</label>
            <input
              type="text"
              value={nameShort}
              onChange={e => { setNameShort(e.target.value); touch() }}
              placeholder="z.B. V-26-001"
            />
          </div>

          <div className="form-group">
            <label>Vertragsname</label>
            <input
              type="text"
              value={nameLong}
              onChange={e => { setNameLong(e.target.value); touch() }}
              placeholder="z.B. Planungsvertrag Hauptauftrag"
            />
          </div>

          <div className="form-row">
            <div className="form-group">
              <label>Skonto (%)</label>
              <input
                type="number" min={0} max={100} step={0.01}
                value={cashDiscPct}
                onChange={e => { setCashDiscPct(e.target.value); touch() }}
                placeholder="z.B. 2"
              />
            </div>
            <div className="form-group">
              <label>Skonto-Tage</label>
              <input
                type="number" min={0} step={1}
                value={cashDiscDays}
                onChange={e => { setCashDiscDays(e.target.value); touch() }}
                placeholder="z.B. 14"
              />
            </div>
          </div>

          <Autocomplete
            label="Rechnungsadresse"
            htmlId="vtr-address"
            value={addrText}
            onChange={text => { setAddrText(text); if (!text) { setAddressId(null); setContactId(null); setContacts([]) }; touch() }}
            onSelect={handleAddressSelect}
            search={searchAddresses}
            placeholder="Adresse suchen…"
          />

          <div className="form-group">
            <label>Rechnungskontakt</label>
            <select
              value={contactId ?? ''}
              onChange={e => { setContactId(e.target.value ? Number(e.target.value) : null); touch() }}
              disabled={!addressId}
            >
              <option value="">— Kontakt wählen —</option>
              {contacts.map(c => (
                <option key={c.ID} value={c.ID}>{`${c.FIRST_NAME} ${c.LAST_NAME}`.trim()}</option>
              ))}
            </select>
          </div>

          <div className="modal-actions" style={{ marginTop: 20 }}>
            <button
              className="btn-primary"
              disabled={!dirty || saveMut.isPending}
              onClick={() => saveMut.mutate()}
            >
              {saveMut.isPending ? 'Speichern…' : 'Vertrag speichern'}
            </button>
            <button
              className="btn-secondary"
              disabled={!dirty || saveMut.isPending}
              onClick={handleReset}
            >
              Zurücksetzen
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
