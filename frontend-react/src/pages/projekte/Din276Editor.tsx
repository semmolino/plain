import { useEffect, useMemo, useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { Modal } from '@/components/ui/Modal'
import { DialogFooter } from '@/components/ui/DialogFooter'
import { Message } from '@/components/ui/Message'
import { HelpHint } from '@/components/ui/HelpHint'
import { Can } from '@/components/ui/Can'
import {
  fetchDin276Estimates, fetchDin276Estimate, createDin276Estimate,
  updateDin276Estimate, saveDin276Groups, computeDin276Anrechenbar,
  type Din276Group, type Din276Estimate, type Din276AnrechenbarResult, type Din276Stage,
} from '@/api/din276'

const FMT_EUR = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2, maximumFractionDigits: 2 })
const fmtEur  = (v: number | null | undefined) => v == null ? '—' : FMT_EUR.format(v)

// Erste Hunderter-KG aus einem Code ("410" → 400).
const kgHundred = (code: string): number | null => {
  const n = parseInt(String(code).replace(/\D/g, ''), 10)
  return Number.isFinite(n) ? Math.floor(n / 100) * 100 : null
}
// KG 200/400/600 sind nur bei "selbst geplant" (voll bzw. anteilig) anrechenbar.
// KG 500 ebenso — bei Freianlagen (§ 38 Abs. 1) sowie bei Ingenieurbauwerken
// und Verkehrsanlagen (§ 42/§ 46 Abs. 3).
const SELF_RELEVANT = new Set([200, 400, 500, 600])

// Anlagengruppen der Technischen Ausrüstung (KG 410–480, § 53).
const ANLAGENGRUPPEN: [string, string][] = [
  ['410', 'Abwasser-, Wasser-, Gasanlagen'],
  ['420', 'Wärmeversorgungsanlagen'],
  ['430', 'Lufttechnische Anlagen'],
  ['440', 'Starkstromanlagen'],
  ['450', 'Fernmelde- und informationstechnische Anlagen'],
  ['460', 'Förderanlagen'],
  ['470', 'Nutzungsspezifische und verfahrenstechnische Anlagen'],
  ['480', 'Gebäudeautomation'],
]

interface Props {
  open:          boolean
  onClose:       () => void
  projectId?:    number
  offerId?:      number
  leistungsbild?: string
  /** Übernahme des berechneten Betrags (anrechenbare Kosten) in die Kalkulation. */
  onApply:       (anrechenbareKosten: number, estimateId: number, leistungsbild: string) => void
}

export function Din276Editor({ open, onClose, projectId, offerId, leistungsbild = 'gebaeude', onApply }: Props) {
  const [loading,   setLoading]   = useState(false)
  const [available, setAvailable] = useState(true)
  const [estimate,  setEstimate]  = useState<Din276Estimate | null>(null)
  const [groups,    setGroups]    = useState<Din276Group[]>([])
  const [stage,     setStage]     = useState<Din276Stage>('berechnung')
  const [bausubstanz, setBausubstanz] = useState('0')
  const [lb,        setLb]        = useState(leistungsbild)
  const [anlagengruppe, setAnlagengruppe] = useState('410')
  // Tragwerksplanung/Geotechnik: § 50 rechnet je nach Objektart mit anderen
  // Prozentsätzen (Abs. 1 Gebäude 55/10, Abs. 3 Ingenieurbauwerk 90/15).
  const [objektart, setObjektart] = useState('gebaeude')
  // Raumakustik (Anlage 1.2.5) wird je Innenraum gerechnet: KG 300 + KG 400
  // werden über den Bruttorauminhalt auf den Raum umgelegt.
  const [rauminhalt, setRauminhalt] = useState('')
  const [bri,        setBri]        = useState('')
  // Zusammengesetzter Schlüssel für TGA (je Anlagengruppe): "tga:420".
  const usesObjektart = lb === 'tragwerk' || lb === 'geotechnik'
  const effectiveLb = lb === 'tga' ? `tga:${anlagengruppe}`
    : usesObjektart ? `${lb}:${objektart}`
    : lb
  const [result,    setResult]    = useState<Din276AnrechenbarResult | null>(null)
  const [msg,       setMsg]       = useState<{ text: string; type: 'success' | 'error' } | null>(null)

  function applyEstimate(est: Din276Estimate) {
    setEstimate(est)
    setGroups((est.groups ?? []).slice().sort((a, b) => a.SORT_ORDER - b.SORT_ORDER))
    setStage(est.STAGE)
    setBausubstanz(String(est.MITVERARBEITETE_BAUSUBSTANZ ?? 0))
    setResult(null)
  }

  // Beim Öffnen: bestehende Kostenermittlung laden oder anlegen.
  useEffect(() => {
    if (!open) return
    let cancelled = false
    setLoading(true); setMsg(null); setResult(null)
    ;(async () => {
      try {
        const list = await fetchDin276Estimates({ project_id: projectId, offer_id: offerId })
        if (cancelled) return
        if (list.available === false) { setAvailable(false); setLoading(false); return }
        setAvailable(true)
        if (list.data.length > 0) {
          const full = await fetchDin276Estimate(list.data[0].ID)
          if (!cancelled) applyEstimate(full.data)
        } else {
          const created = await createDin276Estimate({ project_id: projectId, offer_id: offerId, stage: 'berechnung' })
          if (!cancelled) applyEstimate(created.data)
        }
      } catch (e) {
        if (!cancelled) setMsg({ text: (e as Error).message, type: 'error' })
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [open, projectId, offerId])

  function setGroup(idx: number, patch: Partial<Din276Group>) {
    setGroups(gs => gs.map((g, i) => i === idx ? { ...g, ...patch } : g))
    setResult(null)
  }
  function addGroup() {
    setGroups(gs => [...gs, { KG_CODE: '', LABEL: '', AMOUNT: 0, IS_PLANNED_SELF: false, SORT_ORDER: gs.length }])
  }
  function removeGroup(idx: number) {
    setGroups(gs => gs.filter((_, i) => i !== idx))
    setResult(null)
  }

  async function saveAndCompute() {
    if (!estimate) return
    setLoading(true); setMsg(null)
    try {
      await updateDin276Estimate(estimate.ID, { stage, mitverarbeitete_bausubstanz: Number(bausubstanz) || 0 })
      const saved = await saveDin276Groups(estimate.ID, groups.map((g, i) => ({ ...g, SORT_ORDER: i })))
      applyEstimate(saved.data)
      const r = await computeDin276Anrechenbar(estimate.ID, effectiveLb,
        lb === 'bauphysik_raumakustik' ? { rauminhalt, bri } : undefined)
      setResult(r.data)
      setMsg({ text: 'Gespeichert und berechnet ✅', type: 'success' })
    } catch (e) {
      setMsg({ text: (e as Error).message, type: 'error' })
    } finally {
      setLoading(false)
    }
  }

  const anrechenbar = result?.anrechenbareKosten ?? null
  const totalBaukosten = useMemo(() => groups.reduce((s, g) => s + (Number(g.AMOUNT) || 0), 0), [groups])

  return (
    <Modal open={open} onClose={onClose} title="Anrechenbare Kosten aus DIN-276-Kostenermittlung">
      {!available ? (
        <p className="empty-note" style={{ color: 'var(--warning-strong)' }}>
          Das DIN-276-Modul ist noch nicht verfügbar — die Datenbank-Migration 0098 wurde noch nicht ausgeführt.
        </p>
      ) : loading && !estimate ? (
        <p className="empty-note">Laden …</p>
      ) : (
        <>
          <p className="admin-section-hint" style={{ marginTop: 0, display: 'flex', alignItems: 'flex-start', gap: 6 }}>
            <span>
              Trage die Baukosten je Kostengruppe (DIN 276) ein. Daraus werden die anrechenbaren Kosten
              nach HOAI je gewähltem Leistungsbild berechnet — für Gebäude inkl. der KG-400-Regel und
              mitverarbeiteter Bausubstanz.
            </span>
            <HelpHint id="din276.anrechenbare_kosten" />
          </p>

          <div className="form-row">
            <div className="form-group">
              <label>Leistungsbild</label>
              <select value={lb} onChange={e => { setLb(e.target.value); setResult(null) }}>
                <option value="gebaeude">Gebäude (§ 33)</option>
                <option value="tragwerk">Tragwerksplanung (§ 50)</option>
                <option value="freianlagen">Freianlagen (§ 38/40)</option>
                <option value="ingenieurbauwerke">Ingenieurbauwerke (§ 42)</option>
                <option value="verkehrsanlagen">Verkehrsanlagen (§ 46)</option>
                <option value="tga">Technische Ausrüstung (§ 53/54)</option>
                <option value="bauphysik_waerme">Wärmeschutz und Energiebilanzierung (Anlage 1.2.3)</option>
                <option value="bauphysik_bauakustik">Bauakustik (Anlage 1.2.4)</option>
                <option value="bauphysik_raumakustik">Raumakustik (Anlage 1.2.5)</option>
                <option value="geotechnik">Geotechnik (Anlage 1.3)</option>
              </select>
            </div>
            {lb === 'tga' && (
              <div className="form-group">
                <label>Anlagengruppe</label>
                <select value={anlagengruppe} onChange={e => { setAnlagengruppe(e.target.value); setResult(null) }}>
                  {ANLAGENGRUPPEN.map(([code, name]) => (
                    <option key={code} value={code}>{code} · {name}</option>
                  ))}
                </select>
              </div>
            )}
            {usesObjektart && (
              <div className="form-group">
                <label>Objektart</label>
                <select value={objektart} onChange={e => { setObjektart(e.target.value); setResult(null) }}>
                  <option value="gebaeude">Gebäude (§ 50 Abs. 1 — 55 % / 10 %)</option>
                  <option value="ingenieurbauwerk">Ingenieurbauwerk (§ 50 Abs. 3 — 90 % / 15 %)</option>
                </select>
              </div>
            )}
            {lb === 'bauphysik_raumakustik' && (
              <>
                <div className="form-group">
                  <label style={{ display: 'inline-flex', alignItems: 'center' }}>
                    Rauminhalt Innenraum (m³) <HelpHint id="din276.raumakustik_volumen" />
                  </label>
                  <input type="text" inputMode="numeric" value={rauminhalt}
                    onChange={e => { setRauminhalt(e.target.value); setResult(null) }} />
                </div>
                <div className="form-group">
                  <label>Bruttorauminhalt Gebäude (m³)</label>
                  <input type="text" inputMode="numeric" value={bri}
                    onChange={e => { setBri(e.target.value); setResult(null) }} />
                </div>
              </>
            )}
            <div className="form-group">
              <label style={{ display: 'inline-flex', alignItems: 'center' }}>
                Kostenstufe <HelpHint id="din276.stufe" />
              </label>
              <select value={stage} onChange={e => { setStage(e.target.value as Din276Stage); setResult(null) }}>
                <option value="schaetzung">Kostenschätzung (LPH 2)</option>
                <option value="berechnung">Kostenberechnung (LPH 3, maßgeblich)</option>
              </select>
            </div>
            <div className="form-group">
              <label style={{ display: 'inline-flex', alignItems: 'center' }}>
                Mitverarbeitete Bausubstanz (€) <HelpHint id="din276.bausubstanz" />
              </label>
              <input type="text" inputMode="numeric" value={bausubstanz}
                onChange={e => { setBausubstanz(e.target.value); setResult(null) }} />
            </div>
          </div>

          {lb.startsWith('bauphysik_') && (
            <p className="empty-note" style={{ marginTop: 0, marginBottom: 8, display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
              <span>
                {lb === 'bauphysik_waerme'     && 'Wärmeschutz rechnet mit den anrechenbaren Kosten des Gebäudes nach § 33 — einschließlich der 25-/50-%-Regel für fremdgeplante KG 400.'}
                {lb === 'bauphysik_bauakustik' && 'Bauakustik rechnet KG 300 und KG 400 voll an. Die 25-/50-%-Kappung des § 33 gilt hier nicht.'}
                {lb === 'bauphysik_raumakustik' && 'Raumakustik gilt je Innenraum: KG 300 + KG 400 anteilig über den Bruttorauminhalt, KG 610 des Innenraums voll.'}
              </span>
              <HelpHint id="din276.bauphysik" />
            </p>
          )}
          {lb === 'tga' && (
            <p className="empty-note" style={{ marginTop: 0, marginBottom: 8 }}>
              Für die Technische Ausrüstung wird je Anlagengruppe getrennt gerechnet. Erfasse die Kosten
              der gewählten Anlagengruppe als eigene Kostengruppen-Zeile (z. B. <strong>{anlagengruppe}</strong>) —
              das Zusammenfassen mehrerer Anlagengruppen (Mischhonorar) ist noch nicht abgebildet.
            </p>
          )}
          {usesObjektart && (
            <p className="empty-note" style={{ marginTop: 0, marginBottom: 8 }}>
              {lb === 'geotechnik'
                ? 'Geotechnik hat keine eigene Anrechenbarkeitsregel — Anlage 1.3.2 Abs. 1 verweist auf § 50 Abs. 1–3 (Tragwerksplanung), für das gesamte Objekt aus Bauwerk und Baugrube. '
                : ''}
              Die Prozentsätze hängen von der Objektart ab: bei Gebäuden 55 % KG 300 + 10 % KG 400
              (§ 50 Abs. 1), bei Ingenieurbauwerken 90 % + 15 % (Abs. 3). Bei Gebäuden mit hohem Anteil
              an Gründung und Tragkonstruktion darf nach Abs. 2 ebenfalls die Ingenieurbauwerk-Variante
              vereinbart werden — dann hier „Ingenieurbauwerk" wählen.
            </p>
          )}
          {lb === 'freianlagen' && (
            <p className="empty-note" style={{ marginTop: 0, marginBottom: 8 }}>
              Anrechenbar sind die Außenanlagen (KG 500), aber nur soweit der Auftragnehmer sie selbst
              plant oder überwacht (§ 38 Abs. 1) — dafür je Kostengruppen-Zeile „selbst geplant" setzen.
              Fremd geplante Anteile erscheinen in der Herleitung mit 0 %.
            </p>
          )}

          <div className="table-scroll">
            <table className="master-table">
              <thead>
                <tr>
                  <th scope="col" style={{ width: 70 }}>KG</th>
                  <th scope="col">Bezeichnung</th>
                  <th scope="col" className="num">Betrag €</th>
                  <th scope="col" style={{ textAlign: 'center' }} title="Vom Auftragnehmer selbst fachlich geplant/überwacht (relevant für KG 200/400/500/600)">selbst geplant?</th>
                  <th scope="col" />
                </tr>
              </thead>
              <tbody>
                {groups.map((g, idx) => {
                  const h = kgHundred(g.KG_CODE)
                  const showSelf = h != null && SELF_RELEVANT.has(h)
                  return (
                    <tr key={g.ID ?? `new-${idx}`}>
                      <td>
                        <input className="tbl-input" style={{ width: 56 }} value={g.KG_CODE}
                          onChange={e => setGroup(idx, { KG_CODE: e.target.value })} placeholder="300" />
                      </td>
                      <td>
                        <input className="tbl-input" style={{ width: '100%' }} value={g.LABEL ?? ''}
                          onChange={e => setGroup(idx, { LABEL: e.target.value })} />
                      </td>
                      <td className="num">
                        <input className="tbl-input num" type="text" inputMode="numeric" style={{ width: 120, textAlign: 'right' }}
                          value={String(g.AMOUNT ?? 0)}
                          onChange={e => setGroup(idx, { AMOUNT: Number(e.target.value.replace(',', '.')) || 0 })} />
                      </td>
                      <td style={{ textAlign: 'center' }}>
                        {showSelf ? (
                          <input type="checkbox" checked={g.IS_PLANNED_SELF}
                            onChange={e => setGroup(idx, { IS_PLANNED_SELF: e.target.checked })} />
                        ) : <span className="ls-muted">—</span>}
                      </td>
                      <td>
                        <Can permission="projects.calculations.edit">
                          <button type="button" className="row-action-btn" title="Zeile entfernen" onClick={() => removeGroup(idx)}>
                            <Trash2 size={12} strokeWidth={2.5} />
                          </button>
                        </Can>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
              <tfoot>
                <tr className="sum-row">
                  <td colSpan={2}><strong>Baukosten gesamt</strong></td>
                  <td className="num"><strong>{fmtEur(totalBaukosten)}</strong></td>
                  <td colSpan={2} />
                </tr>
              </tfoot>
            </table>
          </div>

          <Can permission="projects.calculations.edit">
            <button type="button" className="btn-small" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, marginTop: 6 }} onClick={addGroup}>
              <Plus size={13} strokeWidth={2} /> Kostengruppe hinzufügen
            </button>
          </Can>

          {result && (
            <div style={{ marginTop: 16 }}>
              <div style={{ fontSize: 12, color: 'var(--text-3)', marginBottom: 6 }}>
                Herleitung ({(lb === 'tragwerk' || lb === 'geotechnik') ? '§ 50' : lb === 'freianlagen' ? '§ 38/40' : lb === 'ingenieurbauwerke' ? '§ 42' : lb === 'verkehrsanlagen' ? '§ 46' : lb === 'tga' ? '§ 53/54' : '§ 33'} HOAI)
              </div>
              <div className="table-scroll">
                <table className="master-table">
                  <thead>
                    <tr>
                      <th scope="col">KG</th>
                      <th scope="col">Ansatz</th>
                      <th scope="col" className="num">Basis €</th>
                      <th scope="col" className="num">%</th>
                      <th scope="col" className="num">anrechenbar €</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.herleitung.map((h, i) => (
                      <tr key={i}>
                        <td>{h.kg}</td>
                        <td>{h.label}</td>
                        <td className="num">{fmtEur(h.basis)}</td>
                        <td className="num">{h.ansatz}</td>
                        <td className="num">{fmtEur(h.betrag)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="sum-row">
                      <td colSpan={4}><strong>Anrechenbare Kosten</strong></td>
                      <td className="num"><strong>{fmtEur(result.anrechenbareKosten)}</strong></td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          )}

          {msg && <div style={{ marginTop: 10 }}><Message text={msg.text} type={msg.type} /></div>}
        </>
      )}

      <DialogFooter>
        <button type="button" className="btn-secondary" onClick={onClose}>Abbrechen</button>
        <Can permission="projects.calculations.edit">
          <button type="button" className="btn-secondary" disabled={loading || !estimate} onClick={saveAndCompute}>
            {loading ? '…' : 'Speichern & berechnen'}
          </button>
        </Can>
        <button
          type="button"
          className="btn-primary"
          disabled={anrechenbar == null || !estimate}
          onClick={() => { if (anrechenbar != null && estimate) { onApply(anrechenbar, estimate.ID, effectiveLb); onClose() } }}
          title={anrechenbar == null ? 'Erst „Speichern & berechnen"' : undefined}
        >
          In Kalkulation übernehmen{anrechenbar != null ? ` (${fmtEur(anrechenbar)})` : ''}
        </button>
      </DialogFooter>
    </Modal>
  )
}
