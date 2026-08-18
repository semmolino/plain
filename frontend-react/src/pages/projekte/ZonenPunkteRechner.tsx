import { useEffect, useMemo, useState } from 'react'
import { Modal } from '@/components/ui/Modal'
import { DialogFooter } from '@/components/ui/DialogFooter'
import { Message } from '@/components/ui/Message'
import {
  fetchFeeZoneCriteria,
  type FeeZone, type FeeZoneCriterion, type FeeZoneThreshold,
} from '@/api/fee'

interface Props {
  open:        boolean
  onClose:     () => void
  feeMasterId: number | null
  zones:       FeeZone[]
  onApply:     (zoneId: number) => void
}

/**
 * Honorarzone über die Bewertungsmerkmale ermitteln (§ 5 Abs. 2 HOAI).
 *
 * Je Merkmal werden 0..MAX_POINTS vergeben; die Summe fällt in eines der
 * Punktebänder und ergibt die Honorarzone. Das ist der eigentliche
 * Mechanismus der HOAI — die Objektliste (ObjektlisteZonePicker) ist laut
 * § 5 Abs. 2 nur die ergänzende Hilfe („Regelbeispiele").
 */
export function ZonenPunkteRechner({ open, onClose, feeMasterId, zones, onApply }: Props) {
  const [criteria,   setCriteria]   = useState<FeeZoneCriterion[]>([])
  const [thresholds, setThresholds] = useState<FeeZoneThreshold[]>([])
  const [points,     setPoints]     = useState<Record<number, string>>({})
  const [loading,    setLoading]    = useState(false)
  // false = Migration 0127 fehlt noch; true = da, aber ggf. ohne Punktesystem
  // für dieses Leistungsbild. Beides liefert leere Listen und sähe sonst
  // gleich aus.
  const [available,  setAvailable]  = useState(true)
  const [msg,        setMsg]        = useState<{ text: string; type: 'error' } | null>(null)

  useEffect(() => {
    if (!open || !feeMasterId) return
    let cancelled = false
    setLoading(true); setMsg(null); setPoints({})
    ;(async () => {
      try {
        const r = await fetchFeeZoneCriteria(feeMasterId)
        if (cancelled) return
        setCriteria(r.criteria ?? [])
        setThresholds(r.thresholds ?? [])
        setAvailable(r.available !== false)
      } catch (e) {
        if (!cancelled) setMsg({ text: (e as Error).message, type: 'error' })
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [open, feeMasterId])

  const summe = useMemo(
    () => criteria.reduce((s, c) => s + (Number(points[c.ID]) || 0), 0),
    [criteria, points],
  )
  const maxSumme = useMemo(
    () => criteria.reduce((s, c) => s + c.MAX_POINTS, 0),
    [criteria],
  )

  // Nur bewerten, wenn zu jedem Merkmal etwas eingetragen wurde — eine
  // Teilbewertung ergäbe eine zu niedrige Zone, ohne dass es auffällt.
  const alleBewertet = criteria.length > 0 && criteria.every(c => points[c.ID] !== undefined && points[c.ID] !== '')

  const treffer = useMemo(() => {
    if (!alleBewertet) return null
    const sorted = [...thresholds].sort((a, b) => a.POINTS_FROM - b.POINTS_FROM)
    return sorted.find(t => summe >= t.POINTS_FROM && summe <= t.POINTS_TO)
        ?? (sorted.length && summe > sorted[sorted.length - 1].POINTS_TO ? sorted[sorted.length - 1] : null)
  }, [alleBewertet, thresholds, summe])

  const zoneLabel = (zoneId: number) => {
    const z = zones.find(zz => zz.ID === zoneId)
    return z ? `${z.NAME_SHORT}${z.NAME_LONG ? ' – ' + z.NAME_LONG : ''}` : `Zone ${zoneId}`
  }

  const setPoint = (id: number, raw: string, max: number) => {
    if (raw === '') { setPoints(p => ({ ...p, [id]: '' })); return }
    const n = Math.max(0, Math.min(max, Math.round(Number(raw) || 0)))
    setPoints(p => ({ ...p, [id]: String(n) }))
  }

  const legalRef = criteria.find(c => c.LEGAL_REF)?.LEGAL_REF

  return (
    <Modal open={open} onClose={onClose} title="Honorarzone über Bewertungsmerkmale ermitteln">
      <p className="admin-section-hint" style={{ marginTop: 0 }}>
        Je Bewertungsmerkmal Punkte vergeben — die Summe ergibt die Honorarzone
        {legalRef ? ` (${legalRef})` : ''}. Die übernommene Zone bleibt im Basisdaten-Feld änderbar.
      </p>

      {!feeMasterId ? (
        <p className="empty-note">Bitte zuerst ein Leistungsbild wählen.</p>
      ) : loading ? (
        <p className="empty-note">Laden …</p>
      ) : !available ? (
        <p className="empty-note" style={{ color: 'var(--warning-strong)' }}>
          Die Bewertungsmerkmale sind noch nicht verfügbar — die Datenbank-Migration 0127 wurde noch
          nicht ausgeführt.
        </p>
      ) : criteria.length === 0 ? (
        <p className="empty-note">
          Für dieses Leistungsbild sieht die HOAI kein Punktesystem vor — die Honorarzone wird dort
          anhand beschreibender Merkmale bzw. der Objektliste zugeordnet.
        </p>
      ) : (
        <>
          <div className="table-scroll">
            <table className="master-table">
              <thead>
                <tr>
                  <th scope="col">Bewertungsmerkmal</th>
                  <th scope="col" className="num" style={{ width: 90 }}>Punkte</th>
                  <th scope="col" className="num" style={{ width: 70 }}>max.</th>
                </tr>
              </thead>
              <tbody>
                {criteria.map(c => (
                  <tr key={c.ID}>
                    <td>
                      {c.TEXT}
                      {c.LEVEL_HINT && (
                        <div className="ls-muted" style={{ fontSize: 11, marginTop: 2 }}>{c.LEVEL_HINT}</div>
                      )}
                    </td>
                    <td className="num">
                      <input
                        className="tbl-input num" type="number" min={0} max={c.MAX_POINTS} step={1}
                        style={{ width: 70, textAlign: 'right' }}
                        value={points[c.ID] ?? ''}
                        onChange={e => setPoint(c.ID, e.target.value, c.MAX_POINTS)}
                      />
                    </td>
                    <td className="num ls-muted">{c.MAX_POINTS}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="sum-row">
                  <td><strong>Summe</strong></td>
                  <td className="num"><strong>{summe}</strong></td>
                  <td className="num ls-muted">{maxSumme}</td>
                </tr>
              </tfoot>
            </table>
          </div>

          <div style={{ marginTop: 12 }}>
            {treffer ? (
              <p style={{ margin: 0 }}>
                <strong>{summe} Punkte</strong> → Honorarzone <strong>{zoneLabel(treffer.ZONE_ID)}</strong>
                <span className="ls-muted"> (Band {treffer.POINTS_FROM}–{treffer.POINTS_TO})</span>
              </p>
            ) : (
              <p className="empty-note" style={{ margin: 0 }}>
                Bitte alle {criteria.length} Merkmale bewerten — eine Teilbewertung ergäbe eine zu
                niedrige Zone.
              </p>
            )}
          </div>
        </>
      )}

      {msg && <div style={{ marginTop: 10 }}><Message text={msg.text} type={msg.type} /></div>}

      <DialogFooter>
        <button type="button" className="btn-secondary" onClick={onClose}>Abbrechen</button>
        <button
          type="button" className="btn-primary" disabled={!treffer}
          onClick={() => { if (treffer) { onApply(treffer.ZONE_ID); onClose() } }}
        >
          Zone übernehmen
        </button>
      </DialogFooter>
    </Modal>
  )
}
