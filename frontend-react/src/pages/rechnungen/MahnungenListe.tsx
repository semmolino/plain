import { useState, useMemo, useEffect, useRef } from 'react'
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
import {
  fetchPayments, createPayment, deletePayment,
  type Payment,
} from '@/api/rechnungen'

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

function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr + 'T00:00:00')
  d.setDate(d.getDate() + days)
  return d.toISOString().slice(0, 10)
}

// ── Mahnstufe badge-select ────────────────────────────────────────────────────

const STUFE_COLORS: Record<number, { bg: string; color: string }> = {
  0: { bg: '#e5e7eb', color: '#6b7280' },
  1: { bg: '#dbeafe', color: '#1d4ed8' },
  2: { bg: '#fef3c7', color: '#92400e' },
  3: { bg: '#fed7aa', color: '#9a3412' },
  4: { bg: '#fecaca', color: '#7f1d1d' },
}

function MahnstufeSelect({ value, levels, onChange, onClick }: {
  value: number
  levels: MahnungSettingsLevel[]
  onChange: (v: number) => void
  onClick?: (e: React.MouseEvent) => void
}) {
  const col = STUFE_COLORS[value] ?? STUFE_COLORS[0]
  return (
    <select
      style={{
        background:    col.bg,
        color:         col.color,
        border:        'none',
        borderRadius:  10,
        padding:       '2px 6px',
        fontSize:      11,
        fontWeight:    600,
        cursor:        'pointer',
        minWidth:      100,
        maxWidth:      160,
      }}
      value={value}
      onChange={e => onChange(Number(e.target.value))}
      onClick={onClick}
    >
      <option value={0}>– Keine –</option>
      {levels.map(lv => (
        <option key={lv.mahnstufe} value={lv.mahnstufe}>{lv.label}</option>
      ))}
    </select>
  )
}

// ── Click-to-edit date ────────────────────────────────────────────────────────

function ClickToEditDate({ value, onSave, stopProp = true }: {
  value: string | null
  onSave: (v: string) => void
  stopProp?: boolean
}) {
  const [editing, setEditing] = useState(false)

  function handleClick(e: React.MouseEvent) {
    if (stopProp) e.stopPropagation()
    setEditing(true)
  }

  if (!editing) {
    return (
      <span
        className="cte-date"
        onClick={handleClick}
        title="Klicken zum Bearbeiten"
      >
        {value ? fmtDate(value) : <span className="cte-date-empty">— setzen</span>}
      </span>
    )
  }

  return (
    <input
      type="date"
      className="inline-date-input"
      defaultValue={value?.slice(0, 10) ?? ''}
      autoFocus
      onClick={e => e.stopPropagation()}
      onBlur={e => { onSave(e.target.value); setEditing(false) }}
      onKeyDown={e => { if (e.key === 'Escape') setEditing(false) }}
    />
  )
}

// ── Sorting ───────────────────────────────────────────────────────────────────

type SortKey = 'number' | 'invoiceDate' | 'dueDate' | 'daysOverdue' | 'mahnstufe'
             | 'lastMahnungDate' | 'nextMahnungDate' | 'addressName1' | 'projectName' | 'totalGross' | 'openAmount'

function SortTh({ label, k, sortKey, dir, onClick, className }: {
  label: string; k: SortKey; sortKey: SortKey; dir: 'asc'|'desc'
  onClick: (k: SortKey) => void; className?: string
}) {
  return (
    <th className={`sortable-th${className ? ' '+className : ''}`} onClick={() => onClick(k)}>
      {label}{sortKey === k ? (dir === 'asc' ? ' ▲' : ' ▼') : ''}
    </th>
  )
}

// ── Optional columns ──────────────────────────────────────────────────────────

type OptColKey = 'invoiceDate' | 'totalGross' | 'openAmount' | 'contractName' | 'contact'

interface OptColDef { key: OptColKey; label: string; defaultVisible: boolean }
const OPT_COLS: OptColDef[] = [
  { key: 'invoiceDate',  label: 'Rech.-Datum',    defaultVisible: true  },
  { key: 'totalGross',   label: 'Betrag',          defaultVisible: false },
  { key: 'openAmount',   label: 'Offene Posten €', defaultVisible: true  },
  { key: 'contractName', label: 'Vertrag',         defaultVisible: false },
  { key: 'contact',      label: 'Ansprechpart.',   defaultVisible: false },
]

// ── Filter persistence ────────────────────────────────────────────────────────

interface FilterState {
  stichtag:   string
  mahnstufe:  string
  projekt:    string
  vertrag:    string
  adresse:    string
  showClosed: boolean
}

const LS_KEY = 'mahnungen-filters-v2'
const defaultFilters = (): FilterState => ({
  stichtag:   '',
  mahnstufe:  '',
  projekt:    '',
  vertrag:    '',
  adresse:    '',
  showClosed: false,
})

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
  const navigate = useNavigate()
  const qc       = useQueryClient()

  const rows$     = useQuery({ queryKey: ['mahnungen'],       queryFn: () => fetchMahnungen().then(r => r.data) })
  const settings$ = useQuery({ queryKey: ['mahnung-settings'], queryFn: () => fetchMahnungSettings().then(r => r.data) })
  const emp$      = useQuery({ queryKey: ['employees'],        queryFn: () => fetchEmployeeList().then(r => r.data) })

  const rawData      = rows$.data       ?? []
  const settingsData = settings$.data   ?? []
  const employees    = emp$.data        ?? []

  const settingsByLevel = useMemo(() => {
    const m: Record<number, MahnungSettingsLevel> = {}
    for (const s of settingsData) m[s.mahnstufe] = s
    return m
  }, [settingsData])

  const allLevels: MahnungSettingsLevel[] = useMemo(() =>
    [1,2,3,4].map(n => settingsByLevel[n] ?? {
      mahnstufe: n, label: STUFEN_LABELS[n] ?? `Stufe ${n}`,
      daysAfterDue: 7, daysAfterPrev: 14, fee: 0, headerText: null, footerText: null,
    }), [settingsByLevel])

  const empById = useMemo(() => {
    const m: Record<number, Employee> = {}
    for (const e of employees) m[e.ID] = e
    return m
  }, [employees])

  // ── Filter + sort state ──────────────────────────────────────────────────────
  const [filters,  setFilters]  = useState<FilterState>(loadFilters)
  const [sortKey,  setSortKey]  = useState<SortKey>('dueDate')
  const [sortDir,  setSortDir]  = useState<'asc'|'desc'>('asc')
  const [hiddenCols, setHiddenCols] = useState<Set<OptColKey>>(
    new Set(OPT_COLS.filter(c => !c.defaultVisible).map(c => c.key))
  )
  const [colPanelOpen, setColPanelOpen] = useState(false)
  const colPanelRef = useRef<HTMLDivElement>(null)

  useEffect(() => { saveFilters(filters) }, [filters])

  useEffect(() => {
    if (!colPanelOpen) return
    const h = (e: MouseEvent) => {
      if (colPanelRef.current && !colPanelRef.current.contains(e.target as Node)) setColPanelOpen(false)
    }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [colPanelOpen])

  function toggleSort(k: SortKey) {
    if (sortKey === k) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortKey(k); setSortDir('asc') }
  }
  function toggleCol(key: OptColKey) {
    setHiddenCols(prev => { const s = new Set(prev); s.has(key) ? s.delete(key) : s.add(key); return s })
  }

  const rows = useMemo(() => {
    let r = rawData.filter(row => {
      if (!filters.showClosed && row.isClosed) return false
      if (filters.stichtag && row.dueDate > filters.stichtag) return false
      if (filters.mahnstufe !== '' && String(row.mahnstufe) !== filters.mahnstufe) return false
      if (filters.projekt) {
        const q = filters.projekt.toLowerCase()
        const proj = `${row.projectNumber ?? ''} ${row.projectName ?? ''}`.toLowerCase()
        if (!proj.includes(q)) return false
      }
      if (filters.vertrag) {
        const q = filters.vertrag.toLowerCase()
        if (!(row.contractName ?? '').toLowerCase().includes(q)) return false
      }
      if (filters.adresse) {
        const q = filters.adresse.toLowerCase()
        if (!(row.addressName1 ?? '').toLowerCase().includes(q)) return false
      }
      return true
    })

    r = [...r].sort((a, b) => {
      let av: string | number = ''
      let bv: string | number = ''
      switch (sortKey) {
        case 'number':         av = a.number ?? '';           bv = b.number ?? '';           break
        case 'invoiceDate':    av = a.invoiceDate ?? '';      bv = b.invoiceDate ?? '';      break
        case 'dueDate':        av = a.dueDate;                bv = b.dueDate;                break
        case 'daysOverdue':    av = a.daysOverdue;            bv = b.daysOverdue;            break
        case 'mahnstufe':      av = a.mahnstufe;              bv = b.mahnstufe;              break
        case 'lastMahnungDate': av = a.lastMahnungDate ?? ''; bv = b.lastMahnungDate ?? ''; break
        case 'nextMahnungDate': av = a.nextMahnungDate ?? ''; bv = b.nextMahnungDate ?? ''; break
        case 'addressName1':   av = a.addressName1 ?? '';     bv = b.addressName1 ?? '';     break
        case 'projectName':    av = a.projectName ?? '';      bv = b.projectName ?? '';      break
        case 'totalGross':     av = a.totalGross ?? 0;        bv = b.totalGross ?? 0;        break
        case 'openAmount':     av = a.openAmount ?? 0;        bv = b.openAmount ?? 0;        break
      }
      const cmp = typeof av === 'number'
        ? av - (bv as number)
        : String(av).localeCompare(String(bv), 'de', { sensitivity: 'base', numeric: true })
      return sortDir === 'asc' ? cmp : -cmp
    })

    return r
  }, [rawData, filters, sortKey, sortDir])

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

  const selectedWithMahnung = rows.filter(r => selected.has(rowKey(r)) && r.mahnungId !== null).length

  function openSelectedPdfs() {
    const selRows = rows.filter(r => selected.has(rowKey(r)) && r.mahnungId !== null)
    selRows.forEach((r, i) => setTimeout(() => openMahnungPdf(r.mahnungId!), i * 300))
  }

  // ── Inline save mutation ──────────────────────────────────────────────────────
  const inlineMut = useMutation({
    mutationFn: upsertMahnung,
    onSuccess:  () => qc.invalidateQueries({ queryKey: ['mahnungen'] }),
  })

  function saveInlineField(r: MahnungRow, patch: Parameters<typeof upsertMahnung>[0]) {
    inlineMut.mutate({
      ...(r.sourceType === 'invoice' ? { invoice_id: r.sourceId } : { pp_id: r.sourceId }),
      ...patch,
    })
  }

  function handleLastMahnungChange(r: MahnungRow, date: string) {
    const stufe = r.mahnstufe || 1
    const level = settingsByLevel[stufe]
    const daysInterval = (level?.daysAfterPrev && level.daysAfterPrev > 0)
      ? level.daysAfterPrev
      : (level?.daysAfterDue || 14)
    const nextDate = date ? addDays(date, daysInterval) : null
    saveInlineField(r, {
      last_mahnung_date: date || null,
      next_mahnung_date: nextDate,
    })
  }

  // ── Closed toggle (inline) ────────────────────────────────────────────────────
  const closedMut = useMutation({
    mutationFn: (r: MahnungRow) => upsertMahnung({
      ...(r.sourceType === 'invoice' ? { invoice_id: r.sourceId } : { pp_id: r.sourceId }),
      is_closed: !r.isClosed,
    }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['mahnungen'] }),
  })

  // ── Detail modal ─────────────────────────────────────────────────────────────
  const [detailRow, setDetailRow] = useState<MahnungRow | null>(null)
  const [draft,     setDraft]     = useState<Partial<MahnungRow>>({})
  const [saveMsg,   setSaveMsg]   = useState<{ type: 'ok' | 'err'; text: string } | null>(null)

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

  // Auto-fill nächste Mahnung in the detail modal
  function handleDraftLastMahnungChange(date: string) {
    const stufe = draft.mahnstufe ?? 1
    const level = settingsByLevel[stufe]
    const daysInterval = (level?.daysAfterPrev && level.daysAfterPrev > 0)
      ? level.daysAfterPrev
      : (level?.daysAfterDue || 14)
    const nextDate = date ? addDays(date, daysInterval) : null
    setDraft(d => ({ ...d, lastMahnungDate: date || null, nextMahnungDate: nextDate }))
  }

  // ── Email modal ──────────────────────────────────────────────────────────────
  const [emailRow,     setEmailRow]     = useState<MahnungRow | null>(null)
  const [emailTo,      setEmailTo]      = useState('')
  const [emailSubject, setEmailSubject] = useState('')
  const [emailBody,    setEmailBody]    = useState('')
  const [emailMsg,     setEmailMsg]     = useState<{ type: 'ok' | 'err'; text: string } | null>(null)

  function openEmailFor(r: MahnungRow) {
    const stufe = r.mahnstufe || 0
    const lv    = settingsByLevel[stufe]
    setEmailRow(r)
    setEmailTo(r.contactMail ?? '')
    setEmailSubject(`${lv?.label ?? STUFEN_LABELS[stufe] ?? 'Mahnung'} zu ${r.number}`)
    setEmailBody(lv?.headerText ?? '')
    setEmailMsg(null)
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
    if (!emailRow?.mahnungId) {
      setEmailMsg({ type: 'err', text: 'Bitte zuerst Mahnstufe speichern.' })
      return
    }
    sendMut.mutate({ id: emailRow.mahnungId, to: emailTo, subject: emailSubject, body: emailBody })
  }

  // ── Payment modal ─────────────────────────────────────────────────────────────
  interface PayTarget { sourceType: 'invoice' | 'pp'; sourceId: number; label: string; totalGross: number; paidGross: number }
  const [payTarget,         setPayTarget]         = useState<PayTarget | null>(null)
  const [existingPayments,  setExistingPayments]  = useState<Payment[]>([])
  const [deletingPayId,     setDeletingPayId]     = useState<number | null>(null)
  const [payAmount,         setPayAmount]         = useState('')
  const [payDate,           setPayDate]           = useState('')
  const [payPurpose,        setPayPurpose]        = useState('')
  const [payMsg,            setPayMsg]            = useState<{ type: 'ok' | 'err'; text: string } | null>(null)

  function openPaymentFor(r: MahnungRow) {
    setPayAmount('')
    setPayDate(new Date().toISOString().slice(0, 10))
    setPayPurpose('')
    setPayMsg(null)
    setExistingPayments([])
    setDeletingPayId(null)
    setPayTarget({ sourceType: r.sourceType, sourceId: r.sourceId, label: r.number, totalGross: r.totalGross, paidGross: r.amountPaidGross })
    const params = r.sourceType === 'invoice' ? { invoice_id: r.sourceId } : { partial_payment_id: r.sourceId }
    fetchPayments(params).then(res => setExistingPayments(res.data ?? [])).catch(() => {})
  }

  const payMut = useMutation({
    mutationFn: createPayment,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['mahnungen'] })
      setPayMsg({ type: 'ok', text: 'Zahlung gespeichert.' })
      setTimeout(() => { setPayTarget(null); setPayAmount(''); setPayMsg(null) }, 900)
    },
    onError: (e: Error) => setPayMsg({ type: 'err', text: e.message }),
  })

  function submitPayment(e: React.FormEvent) {
    e.preventDefault()
    if (!payTarget) return
    const gross = parseFloat(payAmount)
    if (!payAmount || !Number.isFinite(gross) || gross <= 0) {
      setPayMsg({ type: 'err', text: 'Betrag (Brutto) ist erforderlich' }); return
    }
    if (!payDate) {
      setPayMsg({ type: 'err', text: 'Datum ist erforderlich' }); return
    }
    payMut.mutate({
      ...(payTarget.sourceType === 'invoice'
        ? { invoice_id: payTarget.sourceId }
        : { partial_payment_id: payTarget.sourceId }),
      amount_payed_gross: gross,
      payment_date: payDate,
      purpose_of_payment: payPurpose || undefined,
    })
  }

  async function handleDeletePayment(payId: number) {
    if (!window.confirm('Zahlung wirklich löschen?')) return
    setDeletingPayId(payId)
    try {
      await deletePayment(payId)
      setExistingPayments(prev => prev.filter(p => p.ID !== payId))
      qc.invalidateQueries({ queryKey: ['mahnungen'] })
      setPayTarget(prev => {
        if (!prev) return prev
        const removed = existingPayments.find(p => p.ID === payId)
        if (!removed) return prev
        return { ...prev, paidGross: (prev.paidGross ?? 0) - removed.AMOUNT_PAYED_GROSS }
      })
    } catch { /* ignore */ } finally {
      setDeletingPayId(null)
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────────

  if (rows$.isLoading) return <p className="empty-note">Lade Mahnungsdaten…</p>
  if (rows$.error)     return <p className="empty-note" style={{ color: 'var(--red)' }}>Fehler beim Laden.</p>

  return (
    <div>

      {/* ── Filter bar ── */}
      <div className="filter-bar" style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginBottom: 12 }}>

        <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 13 }}>
          Fällig bis
          <input
            type="date"
            value={filters.stichtag}
            onChange={e => setFilters(f => ({ ...f, stichtag: e.target.value }))}
            style={{ fontSize: 13, padding: '3px 6px' }}
          />
          {filters.stichtag && (
            <button className="filter-chip-clear" onClick={() => setFilters(f => ({ ...f, stichtag: '' }))} title="Zurücksetzen">×</button>
          )}
        </label>

        <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 13 }}>
          Stufe
          <select value={filters.mahnstufe} onChange={e => setFilters(f => ({ ...f, mahnstufe: e.target.value }))} style={{ fontSize: 13, padding: '3px 6px' }}>
            <option value="">Alle</option>
            <option value="0">Keine</option>
            {allLevels.map(lv => <option key={lv.mahnstufe} value={String(lv.mahnstufe)}>{lv.label}</option>)}
          </select>
        </label>

        <input
          type="text"
          placeholder="Projekt…"
          value={filters.projekt}
          onChange={e => setFilters(f => ({ ...f, projekt: e.target.value }))}
          style={{ fontSize: 13, padding: '3px 8px', width: 130, borderRadius: 4, border: '1px solid var(--border)' }}
        />

        <input
          type="text"
          placeholder="Vertrag…"
          value={filters.vertrag}
          onChange={e => setFilters(f => ({ ...f, vertrag: e.target.value }))}
          style={{ fontSize: 13, padding: '3px 8px', width: 130, borderRadius: 4, border: '1px solid var(--border)' }}
        />

        <input
          type="text"
          placeholder="Adresse…"
          value={filters.adresse}
          onChange={e => setFilters(f => ({ ...f, adresse: e.target.value }))}
          style={{ fontSize: 13, padding: '3px 8px', width: 130, borderRadius: 4, border: '1px solid var(--border)' }}
        />

        <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 13 }}>
          <input type="checkbox" checked={filters.showClosed} onChange={e => setFilters(f => ({ ...f, showClosed: e.target.checked }))} />
          Abgeschlossene
        </label>

        {/* Column chooser */}
        <div ref={colPanelRef} style={{ marginLeft: 'auto', position: 'relative' }}>
          <button className="btn btn-sm" onClick={() => setColPanelOpen(o => !o)}>Spalten ▾</button>
          {colPanelOpen && (
            <div style={{ position: 'absolute', right: 0, top: '110%', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 6, padding: '8px 12px', zIndex: 100, minWidth: 160, boxShadow: '0 4px 12px rgba(0,0,0,.12)' }}>
              {OPT_COLS.map(col => (
                <label key={col.key} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, padding: '4px 0', cursor: 'pointer', whiteSpace: 'nowrap' }}>
                  <input type="checkbox" checked={!hiddenCols.has(col.key)} onChange={() => toggleCol(col.key)} />
                  {col.label}
                </label>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── Toolbar ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 13, cursor: 'pointer' }}>
          <input type="checkbox" checked={allSelected} onChange={toggleAll} />
          Alle
        </label>
        {selected.size > 0 && (
          <button className="btn btn-sm" onClick={openSelectedPdfs} disabled={selectedWithMahnung === 0}>
            PDFs öffnen ({selectedWithMahnung})
          </button>
        )}
        <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--text-muted)' }}>
          {rows.length} Einträge
        </span>
      </div>

      {/* ── Table ── */}
      {rows.length === 0
        ? <p className="empty-note">Keine überfälligen Rechnungen gefunden.</p>
        : (
          <div className="table-scroll">
            <table className="master-table">
              <thead>
                <tr>
                  <th style={{ width: 32 }}></th>
                  <th style={{ width: 80 }}>Typ</th>
                  <SortTh label="Nummer"         k="number"          sortKey={sortKey} dir={sortDir} onClick={toggleSort} />
                  {!hiddenCols.has('invoiceDate') && <SortTh label="Rech.-Datum" k="invoiceDate" sortKey={sortKey} dir={sortDir} onClick={toggleSort} />}
                  <SortTh label="Fällig"          k="dueDate"         sortKey={sortKey} dir={sortDir} onClick={toggleSort} />
                  <SortTh label="Tage"            k="daysOverdue"     sortKey={sortKey} dir={sortDir} onClick={toggleSort} className="num" />
                  <SortTh label="Letzte Mahnung"  k="lastMahnungDate" sortKey={sortKey} dir={sortDir} onClick={toggleSort} />
                  <SortTh label="Stufe"           k="mahnstufe"       sortKey={sortKey} dir={sortDir} onClick={toggleSort} />
                  <SortTh label="Nächste Mahnung" k="nextMahnungDate" sortKey={sortKey} dir={sortDir} onClick={toggleSort} />
                  <SortTh label="Projekt"         k="projectName"     sortKey={sortKey} dir={sortDir} onClick={toggleSort} />
                  <SortTh label="Adresse"         k="addressName1"    sortKey={sortKey} dir={sortDir} onClick={toggleSort} />
                  {!hiddenCols.has('contractName') && <th>Vertrag</th>}
                  {!hiddenCols.has('contact')      && <th>Ansprechpart.</th>}
                  {!hiddenCols.has('totalGross')   && <SortTh label="Betrag"          k="totalGross" sortKey={sortKey} dir={sortDir} onClick={toggleSort} className="num" />}
                  {!hiddenCols.has('openAmount')   && <SortTh label="Offene Posten €" k="openAmount" sortKey={sortKey} dir={sortDir} onClick={toggleSort} className="num" />}
                  <th style={{ width: 40, textAlign: 'center' }}>Abg.</th>
                  <th style={{ width: 120 }}>Aktionen</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(r => {
                  const k   = rowKey(r)
                  const emp = r.responsibleEmployeeId ? empById[r.responsibleEmployeeId] : null
                  const projLabel = r.projectNumber && r.projectName
                    ? `${r.projectNumber}: ${r.projectName}`
                    : (r.projectName || r.projectNumber || '–')
                  return (
                    <tr
                      key={k}
                      className={`clickable-row${r.isClosed ? ' row-muted' : ''}`}
                      onClick={() => openDetail(r)}
                      style={{ opacity: r.isClosed ? 0.6 : 1 }}
                    >
                      {/* Checkbox */}
                      <td onClick={e => e.stopPropagation()} style={{ textAlign: 'center' }}>
                        <input type="checkbox" checked={selected.has(k)} onChange={() => toggleRow(r)} />
                      </td>

                      {/* Typ badge */}
                      <td onClick={e => e.stopPropagation()}>
                        <span style={{ fontSize: 11, background: r.sourceType === 'invoice' ? '#e0f2fe' : '#fce7f3', color: r.sourceType === 'invoice' ? '#0369a1' : '#9d174d', borderRadius: 4, padding: '1px 6px' }}>
                          {r.sourceType === 'invoice' ? 'Rechnung' : 'Anzahlung'}
                        </span>
                      </td>

                      <td style={{ fontWeight: 600 }}>{r.number}</td>
                      {!hiddenCols.has('invoiceDate') && <td>{fmtDate(r.invoiceDate)}</td>}
                      <td>{fmtDate(r.dueDate)}</td>
                      <td className={`num ${daysClass(r.daysOverdue)}`}>{r.daysOverdue}</td>

                      {/* Inline: letzte Mahnung date */}
                      <td onClick={e => e.stopPropagation()} style={{ minWidth: 110 }}>
                        <ClickToEditDate
                          value={r.lastMahnungDate}
                          onSave={date => handleLastMahnungChange(r, date)}
                        />
                      </td>

                      {/* Inline: Mahnstufe — badge-styled select */}
                      <td onClick={e => e.stopPropagation()} style={{ minWidth: 110 }}>
                        <MahnstufeSelect
                          value={r.mahnstufe}
                          levels={allLevels}
                          onChange={v => saveInlineField(r, { mahnstufe: v })}
                          onClick={e => e.stopPropagation()}
                        />
                      </td>

                      {/* Inline: nächste Mahnung date */}
                      <td onClick={e => e.stopPropagation()} style={{ minWidth: 110 }}>
                        <ClickToEditDate
                          value={r.nextMahnungDate}
                          onSave={date => saveInlineField(r, { next_mahnung_date: date || null })}
                        />
                      </td>

                      {/* Projekt */}
                      <td style={{ fontSize: 12 }}>
                        {r.projectId
                          ? <button className="link-btn" style={{ fontSize: 12 }} onClick={e => { e.stopPropagation(); navigate('/projekte', { state: { search: r.projectNumber ?? r.projectName } }) }}>
                              {projLabel}
                            </button>
                          : '–'
                        }
                      </td>

                      <td style={{ fontSize: 12 }}>{r.addressName1 ?? '–'}</td>
                      {!hiddenCols.has('contractName') && <td style={{ fontSize: 12 }}>{r.contractName ?? '–'}</td>}
                      {!hiddenCols.has('contact')      && <td style={{ fontSize: 12 }}>{r.contact ?? '–'}</td>}
                      {!hiddenCols.has('totalGross')   && <td className="num">{fmtMoney(r.totalGross)}</td>}
                      {!hiddenCols.has('openAmount')   && <td className="num" style={{ fontWeight: r.openAmount > 0 ? 600 : undefined, color: r.openAmount > 0 ? 'var(--red, #dc2626)' : undefined }}>{fmtMoney(r.openAmount)}</td>}

                      {/* Abgeschlossen checkbox */}
                      <td style={{ textAlign: 'center' }} onClick={e => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={r.isClosed}
                          title={r.isClosed ? 'Abgeschlossen' : 'Als abgeschlossen markieren'}
                          onChange={() => closedMut.mutate(r)}
                        />
                      </td>

                      {/* Inline action buttons */}
                      <td onClick={e => e.stopPropagation()} className="row-actions">
                        <button
                          className="row-action-btn"
                          title="PDF öffnen"
                          disabled={!r.mahnungId}
                          onClick={() => r.mahnungId && openMahnungPdf(r.mahnungId)}
                        >📄</button>
                        <button
                          className="row-action-btn"
                          title="E-Mail senden"
                          disabled={!r.mahnungId}
                          onClick={() => r.mahnungId && openEmailFor(r)}
                        >✉</button>
                        <button
                          className="row-action-btn"
                          title="Zahlung erfassen"
                          onClick={() => openPaymentFor(r)}
                        >💶</button>
                        <button
                          className="row-action-btn"
                          title="→ Rechnung"
                          onClick={() => navigate('/rechnungen', { state: { projectSearch: r.number } })}
                        >🧾</button>
                        {emp && <span title={`Verantw.: ${emp.SHORT_NAME}`} style={{ fontSize: 11, color: 'var(--text-muted)', padding: '0 2px' }}>{emp.SHORT_NAME}</span>}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )
      }

      <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 8 }}>Klick auf eine Zeile für Details und Notizen.</p>

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
                <select className="form-control" value={draft.mahnstufe ?? 0} onChange={e => setDraft(d => ({ ...d, mahnstufe: Number(e.target.value) }))}>
                  <option value={0}>– Keine –</option>
                  {allLevels.map(lv => <option key={lv.mahnstufe} value={lv.mahnstufe}>{lv.label}</option>)}
                </select>
              </div>

              <div className="form-group">
                <label className="form-label">Datum letzte Mahnung</label>
                <input
                  type="date" className="form-control"
                  value={draft.lastMahnungDate ?? ''}
                  onChange={e => handleDraftLastMahnungChange(e.target.value)}
                />
              </div>

              <div className="form-group">
                <label className="form-label">Datum nächste Mahnung <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>(wird auto-berechnet)</span></label>
                <input
                  type="date" className="form-control"
                  value={draft.nextMahnungDate ?? ''}
                  onChange={e => setDraft(d => ({ ...d, nextMahnungDate: e.target.value || null }))}
                />
              </div>

              <div className="form-group">
                <label className="form-label">Verantwortlicher (intern)</label>
                <select className="form-control" value={draft.responsibleEmployeeId ?? ''} onChange={e => setDraft(d => ({ ...d, responsibleEmployeeId: e.target.value ? Number(e.target.value) : null }))}>
                  <option value="">– Kein –</option>
                  {employees.filter(e => e.ACTIVE !== 2).map(e => (
                    <option key={e.ID} value={e.ID}>{e.SHORT_NAME} – {e.FIRST_NAME} {e.LAST_NAME}</option>
                  ))}
                </select>
              </div>

              <div className="form-group" style={{ display: 'flex', gap: 16 }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
                  <input type="checkbox" checked={draft.inKlaerung ?? false} onChange={e => setDraft(d => ({ ...d, inKlaerung: e.target.checked }))} />
                  In Klärung
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
                  <input type="checkbox" checked={draft.isClosed ?? false} onChange={e => setDraft(d => ({ ...d, isClosed: e.target.checked }))} />
                  Abgeschlossen
                </label>
              </div>

              {draft.isClosed && (
                <div className="form-group">
                  <label className="form-label">Grund (optional)</label>
                  <input type="text" className="form-control" value={draft.closeReason ?? ''} placeholder="z.B. Betrag eingegangen…" onChange={e => setDraft(d => ({ ...d, closeReason: e.target.value || null }))} />
                </div>
              )}

              <div className="form-group">
                <label className="form-label">Notizen</label>
                <textarea className="form-control" rows={3} value={draft.notes ?? ''} onChange={e => setDraft(d => ({ ...d, notes: e.target.value || null }))} />
              </div>

              {saveMsg && <Message type={saveMsg.type === 'ok' ? 'success' : 'error'} text={saveMsg.text} />}

              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
                <button className="btn btn-primary" onClick={saveDraft} disabled={upsertMut.isPending}>
                  {upsertMut.isPending ? 'Speichern…' : 'Speichern'}
                </button>
                <button className="btn" onClick={() => detailRow.mahnungId && openMahnungPdf(detailRow.mahnungId)} disabled={!detailRow.mahnungId} title={!detailRow.mahnungId ? 'Zuerst speichern' : undefined}>
                  PDF öffnen
                </button>
                <button className="btn" onClick={() => detailRow.mahnungId && openEmailFor(detailRow)} disabled={!detailRow.mahnungId} title={!detailRow.mahnungId ? 'Zuerst speichern' : undefined}>
                  E-Mail senden
                </button>
              </div>

              <div style={{ display: 'flex', gap: 12, marginTop: 12, fontSize: 13 }}>
                <button className="link-btn" onClick={() => { closeDetail(); navigate('/rechnungen', { state: { projectSearch: detailRow.number } }) }}>
                  → Rechnung öffnen
                </button>
                {detailRow.projectId && (
                  <button className="link-btn" onClick={() => { closeDetail(); navigate('/projekte', { state: { search: detailRow.projectNumber ?? detailRow.projectName } }) }}>
                    → Projekt öffnen
                  </button>
                )}
              </div>
            </div>

            {/* Right — level info + history */}
            <div>
              {(draft.mahnstufe ?? 0) > 0 && settingsByLevel[draft.mahnstufe!] && (
                <div style={{ background: 'var(--bg-2)', borderRadius: 8, padding: 12, marginBottom: 16, fontSize: 13 }}>
                  <div style={{ fontWeight: 600, marginBottom: 6 }}>
                    <span className={`mahnstufe-badge ms-${draft.mahnstufe}`}>{settingsByLevel[draft.mahnstufe!].label}</span>
                  </div>
                  <div>Gebühr: <strong>{fmtMoney(settingsByLevel[draft.mahnstufe!].fee)}</strong></div>
                  {settingsByLevel[draft.mahnstufe!].headerText && (
                    <div style={{ marginTop: 8, whiteSpace: 'pre-line', color: 'var(--text-2)' }}>{settingsByLevel[draft.mahnstufe!].headerText}</div>
                  )}
                </div>
              )}

              <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 8 }}>Verlauf</div>
              {detailRow.history.length === 0
                ? <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>Noch keine Aktionen.</p>
                : (
                  <ul className="mahnung-history-list">
                    {detailRow.history.map((h, i) => (
                      <li key={i}>
                        <span className={`mahnstufe-badge ms-${h.mahnstufe}`}>{STUFEN_LABELS[h.mahnstufe] ?? `Stufe ${h.mahnstufe}`}</span>
                        <div style={{ flex: 1 }}>
                          <div>{new Date(h.dateAction).toLocaleDateString('de-DE')}{h.emailSent ? ' · ✉ ' + (h.emailTo ?? '') : ''}</div>
                          {h.feeAmount > 0 && <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Gebühr: {fmtMoney(h.feeAmount)}</div>}
                        </div>
                      </li>
                    ))}
                  </ul>
                )
              }
            </div>
          </div>
        </Modal>
      )}

      {/* ── Email Modal ── */}
      {emailRow && (
        <Modal open={emailRow !== null} onClose={() => setEmailRow(null)} title={`E-Mail senden — ${emailRow.number}`}>
          <div style={{ minWidth: 420 }}>
            <div className="form-group">
              <label className="form-label">An</label>
              <input type="email" className="form-control" value={emailTo} onChange={e => setEmailTo(e.target.value)} placeholder="empfaenger@beispiel.de" />
            </div>
            <div className="form-group">
              <label className="form-label">Betreff</label>
              <input type="text" className="form-control" value={emailSubject} onChange={e => setEmailSubject(e.target.value)} />
            </div>
            <div className="form-group">
              <label className="form-label">Nachricht</label>
              <textarea className="form-control" rows={6} value={emailBody} onChange={e => setEmailBody(e.target.value)} />
            </div>
            {emailMsg && <Message type={emailMsg.type === 'ok' ? 'success' : 'error'} text={emailMsg.text} />}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
              <button className="btn" onClick={() => setEmailRow(null)}>Abbrechen</button>
              <button className="btn btn-primary" onClick={sendEmail} disabled={sendMut.isPending || !emailTo}>
                {sendMut.isPending ? 'Senden…' : 'Senden'}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* ── Payment Modal ── */}
      {payTarget && (
        <Modal open={payTarget !== null} onClose={() => setPayTarget(null)} title={`Zahlung — ${payTarget.label}`}>
          <div style={{ minWidth: 360 }}>
            <div style={{ marginBottom: 12, fontSize: 13, display: 'flex', gap: 16, color: 'var(--text-2)' }}>
              <span>Brutto: <strong>{fmtMoney(payTarget.totalGross)}</strong></span>
              <span>Bezahlt: <strong>{fmtMoney(payTarget.paidGross)}</strong></span>
              <span>Offen: <strong style={{ color: 'var(--red, #dc2626)' }}>{fmtMoney(Math.max(0, payTarget.totalGross - payTarget.paidGross))}</strong></span>
            </div>

            {existingPayments.length > 0 && (
              <div style={{ marginBottom: 12 }}>
                <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6, color: 'var(--text-4)' }}>Bisherige Zahlungen</div>
                {existingPayments.map(p => (
                  <div key={p.ID} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, padding: '4px 0', borderBottom: '1px solid var(--border)' }}>
                    <span>{p.PAYMENT_DATE?.slice(0, 10) ?? '–'}</span>
                    <span style={{ fontWeight: 600 }}>{fmtMoney(p.AMOUNT_PAYED_GROSS)}</span>
                    {p.PURPOSE_OF_PAYMENT && <span style={{ color: 'var(--text-4)', flex: 1 }}>{p.PURPOSE_OF_PAYMENT}</span>}
                    <button
                      className="btn-small btn-danger"
                      disabled={deletingPayId === p.ID}
                      onClick={() => handleDeletePayment(p.ID)}
                    >{deletingPayId === p.ID ? '…' : '×'}</button>
                  </div>
                ))}
              </div>
            )}

            <form onSubmit={submitPayment}>
              <div className="form-group">
                <label className="form-label">Betrag Brutto *</label>
                <input type="number" className="form-control" step="0.01" min="0.01"
                  value={payAmount} onChange={e => setPayAmount(e.target.value)} placeholder="0.00" />
              </div>
              <div className="form-group">
                <label className="form-label">Datum *</label>
                <input type="date" className="form-control" value={payDate} onChange={e => setPayDate(e.target.value)} />
              </div>
              <div className="form-group">
                <label className="form-label">Verwendungszweck</label>
                <input type="text" className="form-control" value={payPurpose} onChange={e => setPayPurpose(e.target.value)} placeholder="Optional" />
              </div>
              {payMsg && <Message type={payMsg.type === 'ok' ? 'success' : 'error'} text={payMsg.text} />}
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
                <button type="button" className="btn" onClick={() => setPayTarget(null)}>Schließen</button>
                <button type="submit" className="btn btn-primary" disabled={payMut.isPending}>
                  {payMut.isPending ? 'Speichern…' : 'Zahlung speichern'}
                </button>
              </div>
            </form>
          </div>
        </Modal>
      )}
    </div>
  )
}
