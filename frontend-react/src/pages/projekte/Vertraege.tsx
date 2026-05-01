import { useState, useEffect, useCallback } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { fetchProjectsShort, fetchContractByProject, patchContract } from '@/api/projekte'
import { searchAddressesApi, fetchAddressList } from '@/api/stammdaten'
import { Autocomplete } from '@/components/ui/Autocomplete'
import { Message } from '@/components/ui/Message'

interface Props {
  initialProjectId?: number
  onProjectChange?: (id: number | null) => void
}

export function Vertraege({ initialProjectId, onProjectChange }: Props) {
  const qc = useQueryClient()
  const [pid,        setPid]        = useState<number | null>(initialProjectId ?? null)
  const [nameShort,  setNameShort]  = useState('')
  const [nameLong,   setNameLong]   = useState('')
  const [addressId,  setAddressId]  = useState<number | null>(null)
  const [addrText,   setAddrText]   = useState('')
  const [dirty,      setDirty]      = useState(false)
  const [msg,        setMsg]        = useState<{ text: string; type: 'success' | 'error' } | null>(null)

  const { data: projectsData } = useQuery({ queryKey: ['projects-short'], queryFn: fetchProjectsShort })
  const { data: addressesData } = useQuery({ queryKey: ['addresses-list'], queryFn: fetchAddressList })

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
    setAddressId(c.INVOICE_ADDRESS_ID ?? null)
    // Look up address label for autocomplete display
    const addr = (addressesData?.data ?? []).find(a => a.ID === c.INVOICE_ADDRESS_ID)
    setAddrText(addr ? addr.ADDRESS_NAME_1 : (c.INVOICE_ADDRESS_ID ? String(c.INVOICE_ADDRESS_ID) : ''))
    setDirty(false)
  }, [contractData?.data, addressesData?.data])

  const saveMut = useMutation({
    mutationFn: () => {
      const contract = contractData?.data
      if (!contract) throw new Error('Kein Vertrag geladen')
      return patchContract(contract.ID, {
        NAME_SHORT:         nameShort.trim(),
        NAME_LONG:          nameLong.trim(),
        INVOICE_ADDRESS_ID: addressId,
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

  const searchAddresses = useCallback(async (q: string) => {
    const res = await searchAddressesApi(q)
    return (res.data ?? []).map(a => ({ id: a.ID, label: a.ADDRESS_NAME_1 }))
  }, [])

  function handleProjectChange(id: number | null) {
    setPid(id)
    onProjectChange?.(id)
    setMsg(null)
    setDirty(false)
  }

  function touch() { setDirty(true); setMsg(null) }

  const projects = projectsData?.data ?? []
  const contract = contractData?.data ?? null

  return (
    <div className="vtr-wrap">
      {/* Project selector */}
      <div className="vtr-toolbar">
        <label className="vtr-label">Projekt</label>
        <select
          className="vtr-select"
          value={pid ?? ''}
          onChange={e => handleProjectChange(e.target.value ? Number(e.target.value) : null)}
        >
          <option value="">— Projekt wählen —</option>
          {projects.map(p => (
            <option key={p.ID} value={p.ID}>{p.NAME_SHORT} – {p.NAME_LONG}</option>
          ))}
        </select>
      </div>

      {msg && <div style={{ marginBottom: 12 }}><Message type={msg.type} text={msg.text} /></div>}

      {!pid && <p className="vtr-empty">Bitte ein Projekt auswählen.</p>}
      {pid && isLoading && <p className="vtr-empty">Lade Vertragsdaten…</p>}
      {pid && isError   && <p className="vtr-empty" style={{ color: 'var(--color-danger)' }}>Fehler beim Laden.</p>}
      {pid && !isLoading && !contract && !isError && (
        <p className="vtr-empty">Kein Vertrag für dieses Projekt gefunden.</p>
      )}

      {contract && (
        <div className="vtr-form">
          <div className="vtr-field">
            <label className="vtr-label" htmlFor="vtr-name-short">Vertragsnummer</label>
            <input
              id="vtr-name-short"
              className="vtr-input"
              type="text"
              value={nameShort}
              onChange={e => { setNameShort(e.target.value); touch() }}
              placeholder="z.B. V-26-001"
            />
          </div>

          <div className="vtr-field">
            <label className="vtr-label" htmlFor="vtr-name-long">Vertragsname</label>
            <input
              id="vtr-name-long"
              className="vtr-input"
              type="text"
              value={nameLong}
              onChange={e => { setNameLong(e.target.value); touch() }}
              placeholder="z.B. Planungsvertrag Hauptauftrag"
            />
          </div>

          <div className="vtr-field">
            <Autocomplete
              label="Rechnungsadresse"
              htmlId="vtr-address"
              value={addrText}
              onChange={text => { setAddrText(text); if (!text) { setAddressId(null) }; touch() }}
              onSelect={(id, label) => { setAddressId(Number(id)); setAddrText(label); touch() }}
              search={searchAddresses}
              placeholder="Adresse suchen…"
            />
            {addressId && (
              <span className="vtr-addr-id">ID {addressId}</span>
            )}
          </div>

          <div className="vtr-footer">
            <button
              className="btn btn-secondary"
              disabled={!dirty || saveMut.isPending}
              onClick={() => {
                const c = contractData?.data
                if (!c) return
                setNameShort(c.NAME_SHORT ?? '')
                setNameLong(c.NAME_LONG ?? '')
                setAddressId(c.INVOICE_ADDRESS_ID ?? null)
                const addr = (addressesData?.data ?? []).find(a => a.ID === c.INVOICE_ADDRESS_ID)
                setAddrText(addr ? addr.ADDRESS_NAME_1 : '')
                setDirty(false)
                setMsg(null)
              }}
            >
              Zurücksetzen
            </button>
            <button
              className="btn btn-primary"
              disabled={!dirty || saveMut.isPending}
              onClick={() => saveMut.mutate()}
            >
              {saveMut.isPending ? 'Speichern…' : 'Vertrag speichern'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
