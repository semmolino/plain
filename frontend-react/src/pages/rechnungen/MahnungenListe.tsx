import { useState, useMemo, useEffect } from 'react'
import { useNavigate }    from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Modal }          from '@/components/ui/Modal'
import { Message }        from '@/components/ui/Message'
import {
  fetchMahnungen, upsertMahnung, sendMahnungEmail, openMahnungPdf,
  fetchMahnungSettings,
  type MahnungRow, type MahnungSettingsLevel,
} from '@/api/mahnungen'
import { fetchEmployeeList, type Employee } from '@/api/mitarbeiter'

// ── Helpers ───────────────────────────────────────────────────────────────────

const STUFEN_LABELS: Record<number, string> = {
  0: '–',
  1: 'Zahlungserinnerung',
  2: '1. Mahnung',
  3: '2. Mahnung',
  4: '3. Mahnung',
}

function fmtDate(d: string | null) {
  if (!d) return '–'
  const [y, m, day] = d.slice(0, 10).split('-')
  return `${day}.${m}.${y}`
}

function fmtMoney(v: number | null) {
  if (v == null) return '–'
  return v.toLocaleString('de-DE', { style: 'currency', currency: 'EUR' })
}

function daysClass(days: number) {
  if (days > 30) return 'days-crit'
  if (days > 14) return 'days-warn'
  return ''
}

// ── Filter persistence ────────────────────────────────────────────────────────

interface FilterState { mahnstufe: string; adresse: string; showClosed: boolean }

const LS_KEY = 'mahnungen-filters'
const defaultFilters = (): FilterState => ({ mahnstufe: '', adresse: '', showClosed: false })

function loadFilters(): FilterState {
  try {
    const raw = localStorage.getItem(LS_KEY)
    return raw ? { ...defaultFilters(), ...JSON.parse(raw) } : defaultFilters()
  } catch { return defaultFilters() }
}

function saveFilters(f: FilterState) {
  localStorage.setItem(LS_KEY, JSON.stringify(f))
}

// ── Main component ────────────────────────────────────────────────────────────

export function MahnungenListe() {
  const navigate     = useNavigate()
  const qc           = useQueryClient()

  const { data: rawData, isLoading, error } = useQuery({ queryKey: ['mahnungen'], queryFn: () => fetchMahnungen().then(r => r.data.data) })
  const { data: settingsData } = useQuery({ queryKey: ['mahnung-settings'], queryFn: () => fetchMahnungSettings().then(r => r.data.data) })
  const { data: employees }    = useQuery({ queryKey: ['employees'], queryFn: () => fetchEmployeeList().then(r => r.data.data) })

  const settingsByLevel = useMemo(() => {
    const m: Record<number, MahnungSettingsLevel> = {}
    for (const s of (settingsData || [])) m[s.mahnstufe] = s
    return m
  }, [settingsData])

  const allLevels: MahnungSettingsLevel[] = useMemo(() => [1,2,3,4].map(n => settingsByLevel[n] ?? {
    mahnstufe: n, label: STUFEN_LABELS[n] ?? `Stufe ${n}`,
    daysAfterDue: 7, daysAfterPrev: 14, fee: 0, headerText: null, footerText: null,
  }), [settingsByLevel])

  const empById = useMemo(() => {
    const m: Record<number, Employee> = {}
    for (const e of (employees || [])) m[e.ID] = e
    return m
  }, [employees])

  // ── Filter state ────────────────────────────────────────────────────────────
  const [filters, setFilters] = useState<FilterState>(loadFilters)

  useEffect(() => { saveFilters(filters) }, [filters])

  const rows = useMemo(() => {
    if (!rawData) return []
    return rawData.filter(r => {
      if (!filters.showClosed && r.isClosed) return false
      if (filters.mahnstufe !== '' && String(r.mahnstufe) !== filters.mahnstufe) return false
      if (filters.adresse && !(r.addressName1 || '').toLowerCase().includes(filters.adresse.toLowerCase())) return false
      return true
    })
  }, [rawData, filters])

  // ── Selection ────────────────────────────────────────────────────────────────
  const [selected, setSelected] = useState<Set<string>>(new Set())

  function rowKey(r: MahnungRow) { return `${r.sourceType}-${r.sourceId}` }
  const allSelected = rows.length > 0 && rows.every(r => selected.has(rowKey(r)))

  function toggleAll() {
    if (allSelected) setSelected(new Set())
    else setSelected(new Set(rows.map(rowKey)))
  }

  function toggleRow(r: MahnungRow) {
    const k = rowKey(r)
    const s = new Set(selected)
    s.has(k) ? s.delete(k) : s.add(k)
    setSelected(s)
  }

  // ── Detail modal ─────────────────────────────────────────────────────────────
  const [detailRow, setDetailRow] = useState<MahnungRow | null>(null)
  const [draft, setDraft]         = useState<Partial<MahnungRow>>({})
  const [saveMsg, setSaveMsg]     = useState<{ type: 'ok' | 'err'; text: string } | null>(null)

  function openDetail(r: MahnungRow) {
    setDetailRow(r)
    setDraft({
      mahnstufe:             r.mahnstufe,
      lastMahnungDate:       r.lastMahnungDate,
      nextMahnungDate:       r.nextMahnungDate,
      responsibleEmployeeId: r.responsibleEmployeeId,
      isClosed:              r.isClosed,
      closeReason:           r.closeReason,
      inKlaerung:            r.inKlaerung,
      notes:                 r.notes,
    })
    setSaveMsg(null)
  }

  function closeDetail() { setDetailRow(null); setDraft({}) }

  const upsertMut = useMutation({
    mutationFn: upsertMahnung,
    onSuccess:  () => { qc.invalidateQueries({ queryKey: ['mahnungen'] }); setSaveMsg({ type: 'ok', text: 'Gespeichert.' }) },
    onError:    (e: Error) => setSaveMsg({ type: 'err', text: e.message }),
  })

  function saveDraft() {
    if (!detailRow) return
    upsertMut.mutate({
      ...(detailRow.sourceType === 'invoice' ? { invoice_id: detailRow.sourceId } : { pp_id: detailRow.sourceId }),
      mahnstufe:               draft.mahnstufe,
      last_mahnung_date:       draft.lastMahnungDate   ?? null,
      next_mahnung_date:       draft.nextMahnungDate   ?? null,
      responsible_employee_id: draft.responsibleEmployeeId ?? null,
      is_closed:               draft.isClosed,
      close_reason:            draft.closeReason       ?? null,
      in_klaerung:             draft.inKlaerung,
      notes:                   draft.notes             ?? null,
    })
  }

  // Inline isClosed toggle
  const closedMut = useMutation({
    mutationFn: (r: MahnungRow) => upsertMahnung({
      ...(r.sourceType === 'invoice' ? { invoice_id: r.sourceId } : { pp_id: r.sourceId }),
      is_closed: !r.isClosed,
    }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['mahnungen'] }),
  })

  // ── Email modal ──────────────────────────────────────────────────────────────
  const [emailOpen, setEmailOpen]     = useState(false)
  const [emailTo, setEmailTo]         = useState('')
  const [emailSubject, setEmailSubject] = useState('')
  const [emailBody, setEmailBody]     = useState('')
  const [emailMsg, setEmailMsg]       = useState<{ type: 'ok' | 'err'; text: string } | null>(null)

  function openEmailModal() {
    if (!detailRow) return
    const stufe = draft.mahnstufe ?? 0
    const lv    = settingsByLevel[stufe]
    setEmailTo('')
    setEmailSubject(`${lv?.label ?? STUFEN_LABELS[stufe] ?? 'Mahnung'} zu ${detailRow.number}`)
    setEmailBody(lv?.headerText ?? '')
    setEmailMsg(null)
    setEmailOpen(true)
  }

  const sendMut = useMutation({
    mutationFn: ({ id, to, subject, body }: { id: number; to: string; subject: string; body: string }) =>
      sendMahnungEmail(id, { emailTo: to, emailSubject: subject, emailBody: body }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['mahnungen'] })
      setEmailMsg({ type: 'ok', text: 'E-Mail erfolgreich gesendet.' })
    },
    onError: (e: Error) => setEmailMsg({ type: 'err', text: e.message }),
  })

  function sendEmail() {
    if (!detailRow?.mahnungId) {
      setEmailMsg({ type: 'err', text: 'Bitte zuerst Mahnstufe speichern, um eine Mahnung zu erstellen.' })
      return
    }
    sendMut.mutate({ id: detailRow.mahnungId, to: emailTo, subject: emailSubject, body: emailBody })
  }

  // ── Selected PDF open ─────────────────────────────────────────────────────────
  function openSelectedPdfs() {
    const selRows = rows.filter(r => selected.has(rowKey(r)) && r.mahnungId !== null)
    for (const r of selRows) openMahnungPdf(r.mahnungId!)
  }

  const selectedWithMahnung = rows.filter(r => selected.has(rowKey(r)) && r.mahnungId !== null).length

  // ── Render ────────────────────────────────────────────────────────────────────

  if (isLoading) return <p className="empty-note">Lade Mahnungsdaten…</p>
  if (error)     return <p className="empty-note" style={{ color: 'var(--red)' }}>Fehler beim Laden.</p>

  return (
    <div>

      {/* Filter bar */}
      <div className="filter-bar" style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center', marginBottom: 12 }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
          Mahnstufe
          <select value={filters.mahnstufe} onChange={e => setFilters(f => ({ ...f, mahnstufe: e.target.value }))} style={{ fontSize: 13, padding: '3px 6px' }}>
            <option value="">Alle</option>
            <option value="0">Keine</option>
            {allLevels.map(lv => <option key={lv.mahnstufe} value={String(lv.mahnstufe)}>{lv.label}</option>)}
          </select>
        </label>

        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
          Adresse
          <input
            type="text"
            value={filters.adresse}
            onChange={e => setFilters(f => ({ ...f, adresse: e.target.value }))}
            placeholder="Filtern…"
            style={{ fontSize: 13, padding: '3px 6px', width: 160 }}
          />
        </label>

        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
          <input type="checkbox" checked={filters.showClosed} onChange={e => setFilters(f => ({ ...f, showClosed: e.target.checked }))} />
          Abgeschlossene zeigen
        </label>
      </div>

      {/* Toolbar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer' }}>
          <input type="checkbox" checked={allSelected} onChange={toggleAll} />
          Alle
        </label>
        {selected.size > 0 && (
          <button
            className="btn btn-sm"
            onClick={openSelectedPdfs}
            disabled={selectedWithMahnung === 0}
            title={selectedWithMahnung === 0 ? 'Keine der gewählten Zeilen hat eine gespeicherte Mahnstufe' : undefined}
          >
            Ausgewählte PDFs öffnen ({selectedWithMahnung})
          </button>
        )}
        <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--text-muted)' }}>{rows.length} Einträge</span>
      </div>

      {/* Table */}
      {rows.length === 0
        ? <p className="empty-note">Keine überfälligen Rechnungen gefunden.</p>
        : (
          <div className="table-scroll">
            <table className="master-table">
              <thead>
                <tr>
                  <th style={{ width: 32 }}></th>
                  <th>Typ</th>
                  <th>Nummer</th>
                  <th>Datum</th>
                  <th>Fällig</th>
                  <th className="num">Tage</th>
                  <th>Letzte Mahnung</th>
                  <th>Stufe</th>
                  <th>Nächste Mahnung</th>
                  <th>Verantw.</th>
                  <th>Adresse</th>
                  <th style={{ width: 48, textAlign: 'center' }}>Abg.</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(r => {
                  const k   = rowKey(r)
                  const emp = r.responsibleEmployeeId ? empById[r.responsibleEmployeeId] : null
                  return (
                    <tr
                      key={k}
                      className={`clickable-row${r.isClosed ? ' row-muted' : ''}`}
                      onDoubleClick={() => openDetail(r)}
                      style={{ opacity: r.isClosed ? 0.55 : 1 }}
                    >
                      <td onClick={e => e.stopPropagation()} style={{ textAlign: 'center' }}>
                        <input type="checkbox" checked={selected.has(k)} onChange={() => toggleRow(r)} />
                      </td>
                      <td>
                        <span style={{ fontSize: 11, background: r.sourceType === 'invoice' ? '#e0f2fe' : '#fce7f3', color: r.sourceType === 'invoice' ? '#0369a1' : '#9d174d', borderRadius: 4, padding: '1px 6px' }}>
                          {r.sourceType === 'invoice' ? 'Rechnung' : 'Anzahlung'}
                        </span>
                      </td>
                      <td style={{ fontWeight: 600 }}>{r.number}</td>
                      <td>{fmtDate(r.invoiceDate)}</td>
                      <td>{fmtDate(r.dueDate)}</td>
                      <td className={`num ${daysClass(r.daysOverdue)}`}>{r.daysOverdue}</td>
                      <td>{fmtDate(r.lastMahnungDate)}</td>
                      <td>
                        <span className={`mahnstufe-badge ms-${r.mahnstufe}`}>
                          {settingsByLevel[r.mahnstufe]?.label ?? STUFEN_LABELS[r.mahnstufe] ?? '–'}
                        </span>
                      </td>
                      <td>{fmtDate(r.nextMahnungDate)}</td>
                      <td style={{ fontSize: 12 }}>{emp ? emp.SHORT_NAME : '–'}</td>
                      <td style={{ fontSize: 12 }}>{r.addressName1 ?? '–'}</td>
                      <td style={{ textAlign: 'center' }} onClick={e => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={r.isClosed}
                          title={r.isClosed ? 'Abgeschlossen' : 'Als abgeschlossen markieren'}
                          onChange={() => closedMut.mutate(r)}
                        />
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )
      }

      <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 8 }}>Doppelklick auf eine Zeile für Details und Bearbeitung.</p>

      {/* ── Detail Modal ── */}
      {detailRow && (
        <Modal
          open={detailRow !== null}
          onClose={closeDetail}
          title={`${detailRow.sourceType === 'invoice' ? 'Rechnung' : 'Anzahlung'} ${detailRow.number}`}
        >
          <div className="mahnung-detail-grid">

            {/* Left — editable fields */}
            <div>
              <div className="form-group">
                <label className="form-label">Mahnstufe</label>
                <select
                  className="form-control"
                  value={draft.mahnstufe ?? 0}
                  onChange={e => setDraft(d => ({ ...d, mahnstufe: Number(e.target.value) }))}
                >
                  <option value={0}>– Keine –</option>
                  {allLevels.map(lv => (
                    <option key={lv.mahnstufe} value={lv.mahnstufe}>{lv.label}</option>
                  ))}
                </select>
              </div>

              <div className="form-group">
                <label className="form-label">Datum letzte Mahnung</label>
                <input
                  type="date"
                  className="form-control"
                  value={draft.lastMahnungDate ?? ''}
                  onChange={e => setDraft(d => ({ ...d, lastMahnungDate: e.target.value || null }))}
                />
              </div>

              <div className="form-group">
                <label className="form-label">Datum nächste Mahnung</label>
                <input
                  type="date"
                  className="form-control"
                  value={draft.nextMahnungDate ?? ''}
                  onChange={e => setDraft(d => ({ ...d, nextMahnungDate: e.target.value || null }))}
                />
              </div>

              <div className="form-group">
                <label className="form-label">Verantwortlicher (intern)</label>
                <select
                  className="form-control"
                  value={draft.responsibleEmployeeId ?? ''}
                  onChange={e => setDraft(d => ({ ...d, responsibleEmployeeId: e.target.value ? Number(e.target.value) : null }))}
                >
                  <option value="">– Kein –</option>
                  {(employees || []).filter(e => e.ACTIVE !== 2).map(e => (
                    <option key={e.ID} value={e.ID}>{e.SHORT_NAME} – {e.FIRST_NAME} {e.LAST_NAME}</option>
                  ))}
                </select>
              </div>

              <div className="form-group" style={{ display: 'flex', gap: 16 }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
                  <input
                    type="checkbox"
                    checked={draft.inKlaerung ?? false}
                    onChange={e => setDraft(d => ({ ...d, inKlaerung: e.target.checked }))}
                  />
                  In Klärung
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
                  <input
                    type="checkbox"
                    checked={draft.isClosed ?? false}
                    onChange={e => setDraft(d => ({ ...d, isClosed: e.target.checked }))}
                  />
                  Abgeschlossen
                </label>
              </div>

              {draft.isClosed && (
                <div className="form-group">
                  <label className="form-label">Grund (optional)</label>
                  <input
                    type="text"
                    className="form-control"
                    value={draft.closeReason ?? ''}
                    placeholder="z.B. Betrag eingegangen, Einigung…"
                    onChange={e => setDraft(d => ({ ...d, closeReason: e.target.value || null }))}
                  />
                </div>
              )}

              <div className="form-group">
                <label className="form-label">Notizen</label>
                <textarea
                  className="form-control"
                  rows={3}
                  value={draft.notes ?? ''}
                  onChange={e => setDraft(d => ({ ...d, notes: e.target.value || null }))}
                />
              </div>

              {saveMsg && <Message type={saveMsg.type === 'ok' ? 'success' : 'error'} text={saveMsg.text} />}

              {/* Action buttons */}
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
                <button className="btn btn-primary" onClick={saveDraft} disabled={upsertMut.isPending}>
                  {upsertMut.isPending ? 'Speichern…' : 'Speichern'}
                </button>
                <button
                  className="btn"
                  onClick={() => detailRow.mahnungId && openMahnungPdf(detailRow.mahnungId)}
                  disabled={!detailRow.mahnungId}
                  title={!detailRow.mahnungId ? 'Zuerst speichern' : undefined}
                >
                  PDF öffnen
                </button>
                <button className="btn" onClick={openEmailModal} disabled={!detailRow.mahnungId} title={!detailRow.mahnungId ? 'Zuerst speichern' : undefined}>
                  E-Mail senden
                </button>
              </div>

              {/* Navigation links */}
              <div style={{ display: 'flex', gap: 12, marginTop: 12, fontSize: 13 }}>
                <button
                  className="link-btn"
                  onClick={() => { closeDetail(); navigate('/rechnungen', { state: { projectSearch: detailRow.number } }) }}
                >
                  → Rechnung öffnen
                </button>
                {detailRow.projectId && (
                  <button
                    className="link-btn"
                    onClick={() => { closeDetail(); navigate('/daten', { state: { tab: 'einzelprojekt', projectId: detailRow.projectId } }) }}
                  >
                    → Projekt öffnen
                  </button>
                )}
              </div>
            </div>

            {/* Right — mahnstufe info + history */}
            <div>
              {/* Settings info for current level */}
              {(draft.mahnstufe ?? 0) > 0 && settingsByLevel[draft.mahnstufe!] && (
                <div className="narrative-block" style={{ marginBottom: 12 }}>
                  <strong>{settingsByLevel[draft.mahnstufe!].label}</strong>
                  <div style={{ marginTop: 4, fontSize: 12 }}>
                    {settingsByLevel[draft.mahnstufe!].fee > 0 && (
                      <div>Mahngebühr: <strong>{fmtMoney(settingsByLevel[draft.mahnstufe!].fee)}</strong></div>
                    )}
                    {settingsByLevel[draft.mahnstufe!].headerText && (
                      <div style={{ marginTop: 6, fontStyle: 'italic', whiteSpace: 'pre-line' }}>
                        {settingsByLevel[draft.mahnstufe!].headerText}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Invoice summary */}
              <div className="narrative-block" style={{ marginBottom: 12, fontSize: 12 }}>
                <div>Rechnungsbetrag: <strong>{fmtMoney(detailRow.totalGross)}</strong></div>
                <div>Fällig seit: <strong>{fmtDate(detailRow.dueDate)}</strong> ({detailRow.daysOverdue} Tage)</div>
                {detailRow.addressName1 && <div>Adresse: {detailRow.addressName1}</div>}
              </div>

              {/* History */}
              <div>
                <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 6 }}>Mahnungshistorie</div>
                {detailRow.history.length === 0
                  ? <p className="empty-note" style={{ fontSize: 12 }}>Noch keine Aktionen.</p>
                  : (
                    <ul className="mahnung-history-list">
                      {detailRow.history.map((h, i) => (
                        <li key={i}>
                          <span style={{ color: 'var(--text-muted)', minWidth: 85, fontSize: 11 }}>
                            {fmtDate(h.dateAction.slice(0, 10))}
                          </span>
                          <span className={`mahnstufe-badge ms-${h.mahnstufe}`} style={{ fontSize: 10 }}>
                            {settingsByLevel[h.mahnstufe]?.label ?? STUFEN_LABELS[h.mahnstufe]}
                          </span>
                          {h.emailSent && <span style={{ fontSize: 11, color: '#16a34a' }}>✉ {h.emailTo}</span>}
                          {h.feeAmount > 0 && <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{fmtMoney(h.feeAmount)}</span>}
                        </li>
                      ))}
                    </ul>
                  )
                }
              </div>
            </div>

          </div>
        </Modal>
      )}

      {/* ── Email Modal ── */}
      {emailOpen && detailRow && (
        <Modal open={emailOpen} onClose={() => setEmailOpen(false)} title="Mahnung per E-Mail senden">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div className="form-group">
              <label className="form-label">An *</label>
              <input
                type="email"
                className="form-control"
                value={emailTo}
                onChange={e => setEmailTo(e.target.value)}
                placeholder="empfaenger@beispiel.de"
              />
            </div>
            <div className="form-group">
              <label className="form-label">Betreff *</label>
              <input
                type="text"
                className="form-control"
                value={emailSubject}
                onChange={e => setEmailSubject(e.target.value)}
              />
            </div>
            <div className="form-group">
              <label className="form-label">Nachricht</label>
              <textarea
                className="form-control"
                rows={6}
                value={emailBody}
                onChange={e => setEmailBody(e.target.value)}
                placeholder="Optionaler Begleittext…"
              />
            </div>
            <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>Die Mahnung wird als PDF-Anhang beigefügt.</p>
            {emailMsg && <Message type={emailMsg.type === 'ok' ? 'success' : 'error'} text={emailMsg.text} />}
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn btn-primary" onClick={sendEmail} disabled={!emailTo || !emailSubject || sendMut.isPending}>
                {sendMut.isPending ? 'Sende…' : 'Senden'}
              </button>
              <button className="btn" onClick={() => setEmailOpen(false)}>Abbrechen</button>
            </div>
          </div>
        </Modal>
      )}

    </div>
  )
}
