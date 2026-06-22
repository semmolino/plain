import { useState, useCallback } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, Trash2 } from 'lucide-react'
import { Modal }        from '@/components/ui/Modal'
import { Message }      from '@/components/ui/Message'
import { Autocomplete } from '@/components/ui/Autocomplete'
import { quickstartOffer, openOfferPdf, type QuickstartOfferPayload } from '@/api/angebote'
import { searchAddressesApi, fetchContactsByAddress } from '@/api/stammdaten'

/**
 * Schnellstart: führt einen neuen Nutzer in wenigen Feldern zu seinem ersten
 * ECHTEN Angebot (+ optional neuer Kunde/Kontakt) und öffnet danach die PDF.
 * Bewusst KEINE Demodaten: gespeichert wird erst beim Bestätigen; brichst du
 * vorher ab, wird nichts angelegt. Backend räumt bei Teilfehlern auf.
 */
type Position = { name_long: string; revenue: string }

export function QuickstartOfferModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient()
  const [mode, setMode]           = useState<'new' | 'existing'>('new')
  const [recipient, setRecipient] = useState('')
  const [firstName, setFirstName] = useState('')
  const [lastName,  setLastName]  = useState('')
  const [addressId, setAddressId] = useState<number | null>(null)
  const [addrText,  setAddrText]  = useState('')
  const [contactId, setContactId] = useState('')
  const [title,     setTitle]     = useState('')
  const [positions, setPositions] = useState<Position[]>([{ name_long: '', revenue: '' }, { name_long: '', revenue: '' }])
  const [msg,       setMsg]       = useState<{ text: string; type: 'error' | 'info' | 'success' } | null>(null)
  const [loading,   setLoading]   = useState(false)

  const { data: contactData } = useQuery({
    queryKey: ['contacts-by-address', addressId],
    queryFn:  () => fetchContactsByAddress(addressId!),
    enabled:  mode === 'existing' && !!addressId,
  })
  const contacts = contactData?.data ?? []

  const searchAddresses = useCallback(async (q: string) => {
    const res = await searchAddressesApi(q)
    return res.data.map(a => ({ id: a.ID, label: a.ADDRESS_NAME_1 }))
  }, [])

  const setPos = (i: number, k: keyof Position, v: string) =>
    setPositions(p => p.map((row, idx) => (idx === i ? { ...row, [k]: v } : row)))
  const addPos = () => setPositions(p => [...p, { name_long: '', revenue: '' }])
  const removePos = (i: number) => setPositions(p => (p.length > 1 ? p.filter((_, idx) => idx !== i) : p))

  function reset() {
    setMode('new'); setRecipient(''); setFirstName(''); setLastName('')
    setAddressId(null); setAddrText(''); setContactId(''); setTitle('')
    setPositions([{ name_long: '', revenue: '' }, { name_long: '', revenue: '' }]); setMsg(null); setLoading(false)
  }
  function close() { reset(); onClose() }

  async function submit() {
    setMsg(null)
    if (!title.trim()) { setMsg({ text: 'Bitte einen Angebotstitel angeben.', type: 'error' }); return }
    const pos = positions
      .filter(p => p.name_long.trim() || p.revenue)
      .map(p => ({ name_long: p.name_long.trim(), revenue: Number(p.revenue) || 0 }))
    if (pos.length === 0) { setMsg({ text: 'Bitte mindestens eine Position eintragen.', type: 'error' }); return }

    const payload: QuickstartOfferPayload = { name_long: title.trim(), positions: pos }
    if (mode === 'new') {
      if (!recipient.trim()) { setMsg({ text: 'Bitte den Namen des Empfängers angeben.', type: 'error' }); return }
      if (!lastName.trim())  { setMsg({ text: 'Bitte den Nachnamen des Ansprechpartners angeben.', type: 'error' }); return }
      payload.new_address = { name_1: recipient.trim() }
      payload.new_contact = { first_name: firstName.trim(), last_name: lastName.trim() }
    } else {
      if (!addressId) { setMsg({ text: 'Bitte eine Adresse wählen.', type: 'error' }); return }
      if (!contactId) { setMsg({ text: 'Bitte einen Kontakt wählen.', type: 'error' }); return }
      payload.address_id = addressId
      payload.contact_id = Number(contactId)
    }

    setLoading(true)
    try {
      const res = await quickstartOffer(payload)
      void qc.invalidateQueries({ queryKey: ['offers'] })
      void qc.invalidateQueries({ queryKey: ['setup-progress'] })
      void qc.invalidateQueries({ queryKey: ['addresses'] })
      openOfferPdf(res.data.offer_id)
      close()
    } catch (e) {
      setMsg({ text: e instanceof Error ? e.message : 'Angebot konnte nicht erstellt werden.', type: 'error' })
      setLoading(false)
    }
  }

  return (
    <Modal open={open} onClose={close} title="Schnellstart: dein erstes Angebot">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14, minWidth: 320, maxWidth: 560 }}>
        <p style={{ margin: 0, fontSize: 12, color: 'var(--text-3)' }}>
          In wenigen Feldern zu deinem ersten echten Angebots-PDF. Gespeichert wird erst beim
          Erstellen — brichst du ab, bleibt nichts zurück.
        </p>

        {/* Empfänger */}
        <div>
          <div className="seg-toggle" style={{ display: 'inline-flex', gap: 4, marginBottom: 8 }}>
            <button type="button" className={`btn-small${mode === 'new' ? ' btn-save' : ''}`} onClick={() => setMode('new')}>Neuer Kunde</button>
            <button type="button" className={`btn-small${mode === 'existing' ? ' btn-save' : ''}`} onClick={() => setMode('existing')}>Bestehender Kunde</button>
          </div>

          {mode === 'new' ? (
            <>
              <div className="form-group">
                <label>Empfänger / Firma*</label>
                <input value={recipient} onChange={e => setRecipient(e.target.value)} placeholder="z. B. Mustermann Bau GmbH" />
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>Ansprechpartner — Vorname</label>
                  <input value={firstName} onChange={e => setFirstName(e.target.value)} placeholder="optional" />
                </div>
                <div className="form-group">
                  <label>Nachname*</label>
                  <input value={lastName} onChange={e => setLastName(e.target.value)} placeholder="z. B. Mustermann" />
                </div>
              </div>
            </>
          ) : (
            <>
              <Autocomplete label="Adresse / Empfänger*" htmlId="qs-addr"
                value={addrText}
                onChange={t => { setAddrText(t); if (!t) { setAddressId(null); setContactId('') } }}
                onSelect={(id, lbl) => { setAddrText(lbl); setAddressId(Number(id)); setContactId('') }}
                search={searchAddresses} placeholder="Name eingeben …" />
              <div className="form-group">
                <label>Kontakt*</label>
                <select value={contactId} onChange={e => setContactId(e.target.value)} disabled={!addressId}>
                  <option value="">{addressId ? 'Bitte wählen …' : 'Erst Adresse wählen'}</option>
                  {contacts.map(c => (
                    <option key={c.ID} value={c.ID}>{`${c.FIRST_NAME ?? ''} ${c.LAST_NAME ?? ''}`.trim()}</option>
                  ))}
                </select>
              </div>
            </>
          )}
        </div>

        {/* Angebot */}
        <div className="form-group">
          <label>Angebotstitel*</label>
          <input value={title} onChange={e => setTitle(e.target.value)} placeholder="z. B. Planungsleistungen Neubau" />
        </div>

        <div>
          <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 6 }}>Positionen</label>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {positions.map((p, i) => (
              <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <input style={{ flex: 1 }} value={p.name_long} onChange={e => setPos(i, 'name_long', e.target.value)}
                  placeholder={`Leistung ${i + 1}`} />
                <input type="number" min={0} step={100} style={{ width: 120, textAlign: 'right' }}
                  value={p.revenue} onChange={e => setPos(i, 'revenue', e.target.value)} placeholder="Honorar €" />
                <button type="button" className="btn-small btn-danger" onClick={() => removePos(i)}
                  disabled={positions.length <= 1} aria-label="Position entfernen"
                  style={{ display: 'inline-flex', alignItems: 'center' }}>
                  <Trash2 size={13} strokeWidth={2} />
                </button>
              </div>
            ))}
          </div>
          <button type="button" className="btn-small" onClick={addPos} style={{ marginTop: 6, display: 'inline-flex', alignItems: 'center', gap: 5 }}>
            <Plus size={13} strokeWidth={2} /> Position
          </button>
        </div>

        <Message text={msg?.text ?? null} type={msg?.type} />

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button type="button" className="btn-small" onClick={close} disabled={loading}>Abbrechen</button>
          <button type="button" className="btn-primary btn-small" onClick={() => void submit()} disabled={loading}>
            {loading ? 'Wird erstellt …' : 'Angebot erstellen & öffnen'}
          </button>
        </div>
      </div>
    </Modal>
  )
}
