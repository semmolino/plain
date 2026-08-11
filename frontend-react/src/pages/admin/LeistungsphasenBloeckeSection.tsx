import { useState, useEffect, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Trash2 } from 'lucide-react'
import { Message } from '@/components/ui/Message'
import { HelpHint } from '@/components/ui/HelpHint'
import { Can } from '@/components/ui/Can'
import { fetchFeeGroups, fetchFeeMasters } from '@/api/fee'
import {
  fetchLphBlocks, saveLphBlocks, seedDefaultLphBlocks,
  type LphBlockInput,
} from '@/api/stammdaten'

interface BlockRow { key: string; id: number | null; name: string }

/**
 * Leistungsphasen-Blöcke — Stammdaten je Leistungsbild.
 *
 * Ein Block bündelt mehrere HOAI-Leistungsphasen zu einer Auswertungseinheit
 * (z. B. „Planung" = LPH 1–4). Das Schema wird pro Leistungsbild gepflegt.
 * Speist die blockweise Auswertung im Projekt-Report (Projektdaten → Projekt →
 * Leistungsphasen).
 */
export function LeistungsphasenBloeckeSection() {
  const qc = useQueryClient()
  const [msg, setMsg] = useState<{ text: string; type: 'success' | 'error' } | null>(null)

  const [feeGroupId,  setFeeGroupId]  = useState<number | null>(null)
  const [feeMasterId, setFeeMasterId] = useState<number | null>(null)

  const [blocks,      setBlocks]      = useState<BlockRow[]>([])
  const [assign,      setAssign]      = useState<Record<number, string | null>>({})
  const [newCounter,  setNewCounter]  = useState(1)

  const { data: groupsData } = useQuery({ queryKey: ['fee-groups'], queryFn: fetchFeeGroups })
  const groups = groupsData?.data ?? []

  const { data: mastersData } = useQuery({
    queryKey: ['fee-masters', feeGroupId],
    queryFn:  () => fetchFeeMasters(feeGroupId!),
    enabled:  feeGroupId != null,
  })
  const masters = useMemo(() => mastersData?.data ?? [], [mastersData])

  const { data: blocksData, isLoading: blocksLoading } = useQuery({
    queryKey: ['lph-blocks', feeMasterId],
    queryFn:  () => fetchLphBlocks(feeMasterId!),
    enabled:  feeMasterId != null,
  })
  const available = blocksData?.data?.available ?? true
  const phases    = useMemo(() => blocksData?.data?.phases ?? [], [blocksData])

  // Server-Zustand in editierbaren lokalen Zustand übernehmen.
  useEffect(() => {
    const d = blocksData?.data
    if (!d) return
    setBlocks((d.blocks ?? []).map(b => ({ key: `b${b.ID}`, id: b.ID, name: b.NAME_SHORT })))
    const a: Record<number, string | null> = {}
    for (const p of (d.phases ?? [])) a[p.ID] = p.BLOCK_ID != null ? `b${p.BLOCK_ID}` : null
    setAssign(a)
    setMsg(null)
  }, [blocksData?.data])

  const saveMut = useMutation({
    mutationFn: () => {
      const payloadBlocks: LphBlockInput[] = blocks
        .filter(b => b.name.trim())
        .map((b, i) => ({ key: b.key, id: b.id, name_short: b.name.trim(), sort_order: i }))
      // Zuordnungen auf noch existierende Blöcke begrenzen.
      const liveKeys = new Set(payloadBlocks.map(b => b.key))
      const cleanAssign: Record<number, string | null> = {}
      for (const [pid, key] of Object.entries(assign)) {
        cleanAssign[Number(pid)] = key && liveKeys.has(key) ? key : null
      }
      return saveLphBlocks({ fee_master_id: feeMasterId!, blocks: payloadBlocks, assignments: cleanAssign })
    },
    onSuccess: () => {
      setMsg({ text: 'Leistungsphasen-Blöcke gespeichert ✅', type: 'success' })
      void qc.invalidateQueries({ queryKey: ['lph-blocks', feeMasterId] })
    },
    onError: (e: Error) => setMsg({ text: e.message, type: 'error' }),
  })

  const seedMut = useMutation({
    mutationFn: () => seedDefaultLphBlocks(feeMasterId!),
    onSuccess: () => {
      setMsg({ text: 'Standard-Blöcke angelegt ✅', type: 'success' })
      void qc.invalidateQueries({ queryKey: ['lph-blocks', feeMasterId] })
    },
    onError: (e: Error) => setMsg({ text: e.message, type: 'error' }),
  })

  function addBlock() {
    setBlocks(bs => [...bs, { key: `new${newCounter}`, id: null, name: '' }])
    setNewCounter(n => n + 1)
  }
  function removeBlock(key: string) {
    setBlocks(bs => bs.filter(b => b.key !== key))
    setAssign(a => {
      const next = { ...a }
      for (const pid of Object.keys(next)) if (next[Number(pid)] === key) next[Number(pid)] = null
      return next
    })
  }
  function renameBlock(key: string, name: string) {
    setBlocks(bs => bs.map(b => b.key === key ? { ...b, name } : b))
  }

  return (
    <div className="admin-section">
      <div className="admin-block">
        <h3 className="admin-block-title" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          Leistungsphasen-Blöcke
          <HelpHint id="stammdaten.lph_bloecke" />
        </h3>
        <p className="admin-section-hint" style={{ marginTop: 0 }}>
          Fasse Leistungsphasen zu Blöcken zusammen (z. B. „Planung" = LPH 1–4). Die Blöcke erscheinen in
          der Projekt-Auswertung „Leistungsphasen" und lassen sich dort auf die einzelnen Phasen aufklappen.
          Das Schema gilt je Leistungsbild.
        </p>

        <div className="form-row">
          <div className="form-group">
            <label>Leistungsbild-Gruppe</label>
            <select value={feeGroupId ?? ''} onChange={e => {
              setFeeGroupId(e.target.value ? Number(e.target.value) : null)
              setFeeMasterId(null); setBlocks([]); setAssign({})
            }}>
              <option value="">Bitte wählen …</option>
              {groups.map(g => <option key={g.ID} value={g.ID}>{g.NAME_SHORT}{g.NAME_LONG ? ` – ${g.NAME_LONG}` : ''}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label>Leistungsbild</label>
            <select value={feeMasterId ?? ''} disabled={feeGroupId == null}
              onChange={e => setFeeMasterId(e.target.value ? Number(e.target.value) : null)}>
              <option value="">Bitte wählen …</option>
              {masters.map(m => <option key={m.ID} value={m.ID}>{m.NAME_SHORT}{m.NAME_LONG ? ` – ${m.NAME_LONG}` : ''}</option>)}
            </select>
          </div>
        </div>

        {feeMasterId != null && !available && (
          <p className="empty-note" style={{ color: 'var(--warning-strong)' }}>
            Leistungsphasen-Blöcke sind noch nicht verfügbar — die Datenbank-Migration 0097 wurde noch nicht ausgeführt.
          </p>
        )}

        {feeMasterId != null && available && blocksLoading && <p className="empty-note">Laden …</p>}

        {feeMasterId != null && available && !blocksLoading && (
          <>
            {phases.length === 0 ? (
              <p className="empty-note">Dieses Leistungsbild hat keine Leistungsphasen hinterlegt.</p>
            ) : (
              <>
                {/* Blöcke definieren */}
                <div style={{ marginTop: 12 }}>
                  <div style={{ fontSize: 12, color: 'var(--text-3)', marginBottom: 6 }}>Blöcke</div>
                  {blocks.length === 0 && (
                    <p className="empty-note" style={{ margin: '4px 0 8px' }}>
                      Noch keine Blöcke. Lege welche an oder übernimm die HOAI-Standardaufteilung.
                    </p>
                  )}
                  {blocks.map(b => (
                    <div key={b.key} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                      <input
                        className="tbl-input"
                        style={{ width: 260 }}
                        placeholder="Blockname (z. B. Planung)"
                        value={b.name}
                        onChange={e => renameBlock(b.key, e.target.value)}
                      />
                      <Can permission="settings.basedata.edit">
                        <button type="button" className="row-action-btn" title="Block entfernen" onClick={() => removeBlock(b.key)}>
                          <Trash2 size={12} strokeWidth={2.5} />
                        </button>
                      </Can>
                    </div>
                  ))}
                  <Can permission="settings.basedata.edit">
                    <button type="button" className="btn-small" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, marginTop: 2 }} onClick={addBlock}>
                      <Plus size={13} strokeWidth={2} /> Block hinzufügen
                    </button>
                    <button type="button" className="btn-small" style={{ marginLeft: 8 }} disabled={seedMut.isPending}
                      onClick={() => { setMsg(null); seedMut.mutate() }}>
                      {seedMut.isPending ? '…' : 'HOAI-Standard (1–4 / 5–7 / 8–9)'}
                    </button>
                  </Can>
                </div>

                {/* Phasen zuordnen */}
                <div style={{ marginTop: 16 }}>
                  <div style={{ fontSize: 12, color: 'var(--text-3)', marginBottom: 6 }}>Zuordnung Phase → Block</div>
                  <table className="master-table" style={{ maxWidth: 560 }}>
                    <thead>
                      <tr>
                        <th scope="col">Leistungsphase</th>
                        <th scope="col">Block</th>
                      </tr>
                    </thead>
                    <tbody>
                      {phases.map(p => (
                        <tr key={p.ID}>
                          <td>
                            <strong>{p.NAME_SHORT}</strong>
                            {p.NAME_LONG && <span className="tree-name-long"> {p.NAME_LONG}</span>}
                          </td>
                          <td>
                            <select
                              value={assign[p.ID] ?? ''}
                              onChange={e => setAssign(a => ({ ...a, [p.ID]: e.target.value || null }))}
                            >
                              <option value="">— kein Block —</option>
                              {blocks.filter(b => b.name.trim()).map(b => (
                                <option key={b.key} value={b.key}>{b.name}</option>
                              ))}
                            </select>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <Can permission="settings.basedata.edit">
                  <button
                    className="btn-primary"
                    style={{ marginTop: 14 }}
                    disabled={saveMut.isPending}
                    onClick={() => { setMsg(null); saveMut.mutate() }}
                    type="button"
                  >
                    {saveMut.isPending ? 'Speichert …' : 'Blöcke speichern'}
                  </button>
                </Can>
              </>
            )}
          </>
        )}

        <Message text={msg?.text ?? null} type={msg?.type} />
      </div>
    </div>
  )
}
