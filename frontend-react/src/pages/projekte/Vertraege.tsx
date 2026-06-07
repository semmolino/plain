import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useCtrlS } from '@/hooks/useCtrlS'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { fetchProjectsShort, fetchContractByProject, patchContract } from '@/api/projekte'
import { searchAddressesApi, fetchContactsByAddress, fetchVatList } from '@/api/stammdaten'
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
  // Notification-Klick mit neuem Projekt soll umschalten.
  useEffect(() => { if (initialProjectId) setPid(initialProjectId) }, [initialProjectId])
  const [nameShort,    setNameShort]    = useState('')
  const [nameLong,     setNameLong]     = useState('')
  const [addressId,    setAddressId]    = useState<number | null>(null)
  const [addrText,     setAddrText]     = useState('')
  const [contactId,    setContactId]    = useState<number | null>(null)
  const [contacts,     setContacts]     = useState<ContactOpt[]>([])
  const [cashDiscPct,  setCashDiscPct]  = useState('')
  const [cashDiscDays, setCashDiscDays] = useState('')
  const [vatId,        setVatId]        = useState<number | null>(null)
  // Sicherheitseinbehalt (Phase 1)
  const [seEnabled,    setSeEnabled]    = useState(false)
  const [sePct,        setSePct]        = useState('')
  const [seBasis,      setSeBasis]      = useState<'BRUTTO' | 'NETTO'>('BRUTTO')
  const [seLegalRef,   setSeLegalRef]   = useState('')
  const [dirty,        setDirty]        = useState(false)
  const [msg,          setMsg]          = useState<{ text: string; type: 'success' | 'error' } | null>(null)

  const { data: projectsData } = useQuery({ queryKey: ['projects-short'], queryFn: fetchProjectsShort })
  const { data: vatListData }  = useQuery({ queryKey: ['vat-list'],       queryFn: fetchVatList })

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
    setVatId(c.VAT_ID ?? null)
    setSeEnabled(!!c.SE_ENABLED)
    setSePct(c.SE_PERCENT != null ? String(c.SE_PERCENT) : '')
    setSeBasis((c.SE_BASIS as 'BRUTTO' | 'NETTO') === 'NETTO' ? 'NETTO' : 'BRUTTO')
    setSeLegalRef(c.SE_LEGAL_REFERENCE ?? '')
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
        VAT_ID:                vatId,
        SE_ENABLED:            seEnabled,
        SE_PERCENT:            seEnabled && sePct !== '' ? parseFloat(sePct) : null,
        SE_BASIS:              seEnabled ? seBasis : null,
        SE_LEGAL_REFERENCE:    seEnabled && seLegalRef.trim() ? seLegalRef.trim() : null,
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
    setSeEnabled(!!c.SE_ENABLED)
    setSePct(c.SE_PERCENT != null ? String(c.SE_PERCENT) : '')
    setSeBasis((c.SE_BASIS as 'BRUTTO' | 'NETTO') === 'NETTO' ? 'NETTO' : 'BRUTTO')
    setSeLegalRef(c.SE_LEGAL_REFERENCE ?? '')
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

          <div className="form-group">
            <label>Steuerschlüssel (MwSt.)</label>
            <select
              value={vatId ?? ''}
              onChange={e => { setVatId(e.target.value ? Number(e.target.value) : null); touch() }}
            >
              <option value="">— Tenant-Standard verwenden —</option>
              {(vatListData?.data ?? []).map(v => (
                <option key={v.ID} value={v.ID}>
                  {v.VAT} ({v.VAT_PERCENT}&nbsp;%)
                </option>
              ))}
            </select>
            <p style={{ fontSize: 11, color: '#6b7280', margin: '4px 0 0' }}>
              Bestimmt den MwSt-Satz für alle Rechnungen aus diesem Vertrag.
              Bei "Tenant-Standard" wird der Default aus den Vorbelegungen verwendet.
            </p>
          </div>

          {/* ── Sicherheitseinbehalt ───────────────────────────────────────── */}
          <div style={{ background: 'rgba(17,24,39,0.03)', border: '1px solid rgba(17,24,39,0.08)', borderRadius: 10, padding: '14px 16px', marginTop: 12, marginBottom: 8 }}>
            <p style={{ fontWeight: 600, fontSize: 13, marginBottom: 10 }}>Sicherheitseinbehalt</p>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer', marginBottom: 8 }}>
              <input type="checkbox" checked={seEnabled} onChange={e => { setSeEnabled(e.target.checked); touch() }} />
              Sicherheitseinbehalt vereinbart
            </label>
            {seEnabled && (
              <div style={{ paddingLeft: 22, display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
                    Prozent (%):
                    <input
                      type="number" min={0} max={100} step={0.01}
                      value={sePct}
                      onChange={e => { setSePct(e.target.value); touch() }}
                      style={{ width: 80, padding: '4px 8px', border: '1px solid rgba(17,24,39,0.15)', borderRadius: 6, fontSize: 13 }}
                      placeholder="z.B. 5"
                    />
                  </label>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13 }}>
                    <span>Basis:</span>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      <input type="radio" checked={seBasis === 'BRUTTO'} onChange={() => { setSeBasis('BRUTTO'); touch() }} />
                      vom Brutto
                    </label>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      <input type="radio" checked={seBasis === 'NETTO'} onChange={() => { setSeBasis('NETTO'); touch() }} />
                      vom Netto
                    </label>
                  </div>
                </div>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
                  <span style={{ minWidth: 130 }}>Rechtsgrundlage:</span>
                  <input
                    type="text"
                    value={seLegalRef}
                    onChange={e => { setSeLegalRef(e.target.value); touch() }}
                    placeholder="z.B. § 17 VOB/B oder freier Text"
                    style={{ flex: 1, minWidth: 200, padding: '4px 8px', border: '1px solid rgba(17,24,39,0.15)', borderRadius: 6, fontSize: 13 }}
                  />
                </label>
                <p style={{ fontSize: 12, color: '#6b7280', margin: 0 }}>
                  Wird in jeder Abschlagsrechnung abgezogen und mit der Schluss-/Teilschlussrechnung aufgelöst.
                </p>
              </div>
            )}
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
