import { useEffect, useMemo, useState } from 'react'
import { Modal } from '@/components/ui/Modal'
import { DialogFooter } from '@/components/ui/DialogFooter'
import { Message } from '@/components/ui/Message'
import { fetchFeeZoneLookup, type FeeZone, type FeeZoneLookupRow } from '@/api/fee'

interface Props {
  open:         boolean
  onClose:      () => void
  feeMasterId:  number | null
  zones:        FeeZone[]
  onApply:      (zoneId: number, sourceLabel: string) => void
}

/**
 * Objektliste zur Honorarzonen-Bestimmung (z. B. Anlage 14.2 Tragwerksplanung):
 * Sachverhalt aus einer Liste auswählen statt die Zone zu erraten. Jede Zeile
 * ordnet eine Beschreibung genau einer Zone zu — die Software entscheidet
 * nicht automatisch, sie zeigt nur die passende gesetzliche Einordnung an.
 */
export function ObjektlisteZonePicker({ open, onClose, feeMasterId, zones, onApply }: Props) {
  const [rows,     setRows]     = useState<FeeZoneLookupRow[]>([])
  const [loading,  setLoading]  = useState(false)
  const [search,   setSearch]   = useState('')
  const [selected, setSelected] = useState<number | null>(null)
  const [msg,      setMsg]      = useState<{ text: string; type: 'error' } | null>(null)

  useEffect(() => {
    if (!open || !feeMasterId) return
    let cancelled = false
    setLoading(true); setMsg(null); setSelected(null); setSearch('')
    ;(async () => {
      try {
        const r = await fetchFeeZoneLookup(feeMasterId)
        if (!cancelled) setRows(r.data ?? [])
      } catch (e) {
        if (!cancelled) setMsg({ text: (e as Error).message, type: 'error' })
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [open, feeMasterId])

  const zoneLabel = (zoneId: number) => {
    const z = zones.find(zz => zz.ID === zoneId)
    return z ? `${z.NAME_SHORT}${z.NAME_LONG ? ' – ' + z.NAME_LONG : ''}` : `Zone ${zoneId}`
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    const list = q
      ? rows.filter(r => r.DESCRIPTION.toLowerCase().includes(q) || (r.CATEGORY ?? '').toLowerCase().includes(q))
      : rows
    const byCat = new Map<string, FeeZoneLookupRow[]>()
    for (const r of list) {
      const key = r.CATEGORY ?? ''
      if (!byCat.has(key)) byCat.set(key, [])
      byCat.get(key)!.push(r)
    }
    return byCat
  }, [rows, search])

  const selectedRow = rows.find(r => r.ID === selected) ?? null

  return (
    <Modal open={open} onClose={onClose} title="Honorarzone anhand Objektliste bestimmen">
      <p className="admin-section-hint" style={{ marginTop: 0 }}>
        Die gesetzliche Objektliste beschreibt typische Sachverhalte je Honorarzone. Beschreibung
        auswählen, die am ehesten passt — die Zone wird daraus übernommen, bleibt aber im
        Basisdaten-Feld weiter änderbar.
      </p>

      {!feeMasterId ? (
        <p className="empty-note">Bitte zuerst ein Leistungsbild wählen.</p>
      ) : loading ? (
        <p className="empty-note">Laden …</p>
      ) : rows.length === 0 ? (
        <p className="empty-note">Für dieses Leistungsbild liegt keine Objektliste vor.</p>
      ) : (
        <>
          <input
            type="search"
            className="list-search"
            style={{ width: '100%', marginBottom: 10 }}
            placeholder="Suchen …"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          <div className="table-scroll" style={{ maxHeight: '50vh', overflowY: 'auto' }}>
            {[...filtered.entries()].map(([category, catRows]) => (
              <div key={category} style={{ marginBottom: 12 }}>
                {category && <p className="admin-block-title" style={{ marginBottom: 4 }}>{category}</p>}
                {catRows.map(r => (
                  <label
                    key={r.ID}
                    style={{
                      display: 'flex', alignItems: 'flex-start', gap: 8, padding: '6px 8px',
                      borderRadius: 'var(--radius-sm)', cursor: 'pointer',
                      background: selected === r.ID ? 'var(--accent-tint)' : 'transparent',
                    }}
                  >
                    <input
                      type="radio"
                      name="objektliste-row"
                      checked={selected === r.ID}
                      onChange={() => setSelected(r.ID)}
                      style={{ marginTop: 3 }}
                    />
                    <span style={{ flex: 1, fontSize: 13 }}>{r.DESCRIPTION}</span>
                    <span className="ls-muted" style={{ fontSize: 12, whiteSpace: 'nowrap' }}>{zoneLabel(r.ZONE_ID)}</span>
                  </label>
                ))}
              </div>
            ))}
            {filtered.size === 0 && <p className="empty-note">Kein Treffer.</p>}
          </div>
        </>
      )}

      {msg && <div style={{ marginTop: 10 }}><Message text={msg.text} type={msg.type} /></div>}

      <DialogFooter>
        <button type="button" className="btn-secondary" onClick={onClose}>Abbrechen</button>
        <button
          type="button"
          className="btn-primary"
          disabled={!selectedRow}
          onClick={() => {
            if (!selectedRow) return
            onApply(selectedRow.ZONE_ID, `${selectedRow.CATEGORY ? selectedRow.CATEGORY + ': ' : ''}${selectedRow.DESCRIPTION}`)
            onClose()
          }}
        >
          Zone übernehmen
        </button>
      </DialogFooter>
    </Modal>
  )
}
