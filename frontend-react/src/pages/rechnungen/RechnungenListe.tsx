import { useState, useMemo, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Modal }   from '@/components/ui/Modal'
import { Message } from '@/components/ui/Message'
import {
  fetchInvoices, fetchPartialPayments,
  openInvoicePdf, openPpPdf,
  downloadInvoiceEinvoice, downloadPpEinvoice,
  cancelInvoice, cancelPartialPayment,
  deleteInvoice, deletePartialPayment,
  fetchPayments, createPayment, deletePayment,
  type Invoice, type PartialPayment, type Payment,
} from '@/api/rechnungen'

interface EditDraftPayload {
  id:            number
  projectId:     number | null
  contractId:    number | null
  projectLabel:  string
  contractLabel: string
  wizardType:    'abschlag' | 'rechnung' | 'schluss'
  d1Pct:         number
  d2Pct:         number
  d1Reason:      string | null
  d2Reason:      string | null
  cashDiscPct:   number
  cashDiscDays:  number
}

const FMT_EUR = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 2 })
const fmtEur  = (v: number | null | undefined) => v == null ? '—' : FMT_EUR.format(v)
const fmtDate = (v: string | null | undefined) => v ? v.slice(0, 10) : '—'

function todayIso() { return new Date().toISOString().slice(0, 10) }

function capitalizeInvType(t: string | null | undefined): string {
  if (!t) return 'Rechnung'
  const map: Record<string, string> = {
    rechnung:            'Rechnung',
    schlussrechnung:     'Teilschluss-/Schlussrechnung',
    teilschlussrechnung: 'Teilschluss-/Schlussrechnung',
    stornorechnung:      'Stornorechnung',
  }
  return map[t.toLowerCase()] ?? (t.charAt(0).toUpperCase() + t.slice(1))
}

// ── Unified row ───────────────────────────────────────────────────────────────

interface UnifiedRow {
  key:        string
  source:     'invoice' | 'pp'
  number:     string | null
  typ:        string
  date:       string | null
  project:    string | null
  projectId:  number | null
  net:        number | null
  gross:      number | null
  paid:       number | null
  open:       number | null
  statusLabel: string
  statusClass: string
  raw:        Invoice | PartialPayment
}

function effectiveDiscounts(rawNet: number, totalDiscounts: number | null, d1Pct: number, d2Pct: number): number {
  if (totalDiscounts != null && totalDiscounts > 0) return totalDiscounts
  const d1Amt = Math.round(rawNet * d1Pct / 100 * 100) / 100
  const d2Amt = Math.round((rawNet - d1Amt) * d2Pct / 100 * 100) / 100
  return Math.round((d1Amt + d2Amt) * 100) / 100
}

function fromInvoice(inv: Invoice): UnifiedRow {
  const isOrigCancelled = inv.STATUS_ID === 3
  const isStornoRow     = inv.INVOICE_TYPE === 'stornorechnung'

  let statusLabel: string
  let statusClass: string
  if (isOrigCancelled)          { statusLabel = 'Storniert';       statusClass = 'cancelled' }
  else if (isStornoRow)         { statusLabel = 'Storno-Rechnung'; statusClass = 'cancelled' }
  else if (inv.STATUS_ID === 2) { statusLabel = 'Gebucht';         statusClass = 'booked' }
  else                          { statusLabel = 'Entwurf';         statusClass = 'draft' }

  const paid    = inv.AMOUNT_PAYED_GROSS != null ? Number(inv.AMOUNT_PAYED_GROSS) : null
  const vatPct  = inv.VAT_PERCENT != null ? Number(inv.VAT_PERCENT) : 0
  const rawNet  = inv.TOTAL_AMOUNT_NET != null ? Number(inv.TOTAL_AMOUNT_NET) : null
  const discountNet   = rawNet != null ? effectiveDiscounts(rawNet, inv.TOTAL_DISCOUNTS, Number(inv.DISCOUNT_1_PERCENT ?? 0), Number(inv.DISCOUNT_2_PERCENT ?? 0)) : 0
  const adjustedNet   = rawNet != null ? Math.round((rawNet - discountNet) * 100) / 100 : null
  const adjustedGross = adjustedNet != null ? Math.round(adjustedNet * (1 + vatPct / 100) * 100) / 100 : null
  const cdPct         = Number(inv.CASH_DISCOUNT_PERCENT ?? 0)
  const skontoGross   = cdPct > 0 && adjustedGross != null ? Math.round(adjustedGross * (1 - cdPct / 100) * 100) / 100 : null
  const rawOpen       = adjustedGross != null ? Math.round((adjustedGross - (paid ?? 0)) * 100) / 100 : null
  const open          = skontoGross !== null && (paid ?? 0) >= skontoGross - 0.005 ? 0 : rawOpen
  return {
    key:         `inv-${inv.ID}`,
    source:      'invoice',
    number:      inv.INVOICE_NUMBER ?? null,
    typ:         capitalizeInvType(inv.INVOICE_TYPE),
    date:        inv.INVOICE_DATE ?? null,
    project:     inv.PROJECT ?? null,
    projectId:   inv.PROJECT_ID ?? null,
    net:         adjustedNet,
    gross:       adjustedGross,
    paid,
    open,
    statusLabel,
    statusClass,
    raw:         inv,
  }
}

function fromPp(pp: PartialPayment): UnifiedRow {
  const isOrigCancelled = pp.STATUS_ID === 3
  const isStornoRow     = pp.CANCELS_PARTIAL_PAYMENT_ID != null

  let statusLabel: string
  let statusClass: string
  if (isOrigCancelled)          { statusLabel = 'Storniert';       statusClass = 'cancelled' }
  else if (isStornoRow)         { statusLabel = 'Storno-Rechnung'; statusClass = 'cancelled' }
  else if (pp.STATUS_ID === 2)  { statusLabel = 'Gebucht';         statusClass = 'booked' }
  else                          { statusLabel = 'Entwurf';         statusClass = 'draft' }

  const paid    = pp.AMOUNT_PAYED_GROSS != null ? Number(pp.AMOUNT_PAYED_GROSS) : null
  const vatPct  = pp.VAT_PERCENT != null ? Number(pp.VAT_PERCENT) : 0
  const rawNet  = pp.TOTAL_AMOUNT_NET != null ? Number(pp.TOTAL_AMOUNT_NET) : null
  const discountNet   = rawNet != null ? effectiveDiscounts(rawNet, pp.TOTAL_DISCOUNTS, Number(pp.DISCOUNT_1_PERCENT ?? 0), Number(pp.DISCOUNT_2_PERCENT ?? 0)) : 0
  const adjustedNet   = rawNet != null ? Math.round((rawNet - discountNet) * 100) / 100 : null
  const adjustedGross = adjustedNet != null ? Math.round(adjustedNet * (1 + vatPct / 100) * 100) / 100 : null
  const cdPct         = Number(pp.CASH_DISCOUNT_PERCENT ?? 0)
  const skontoGross   = cdPct > 0 && adjustedGross != null ? Math.round(adjustedGross * (1 - cdPct / 100) * 100) / 100 : null
  const rawOpen       = adjustedGross != null ? Math.round((adjustedGross - (paid ?? 0)) * 100) / 100 : null
  const open          = skontoGross !== null && (paid ?? 0) >= skontoGross - 0.005 ? 0 : rawOpen
  return {
    key:         `pp-${pp.ID}`,
    source:      'pp',
    number:      pp.PARTIAL_PAYMENT_NUMBER ?? null,
    typ:         'Abschlagsrechnung',
    date:        pp.PARTIAL_PAYMENT_DATE ?? null,
    project:     pp.PROJECT ?? null,
    projectId:   pp.PROJECT_ID ?? null,
    net:         adjustedNet,
    gross:       adjustedGross,
    paid,
    open,
    statusLabel,
    statusClass,
    raw:         pp,
  }
}

// ── Filter chips ──────────────────────────────────────────────────────────────

type FilterDim = 'status' | 'typ'
type ActiveFilters = Record<FilterDim, Set<string>>
const emptyFilters = (): ActiveFilters => ({ status: new Set(), typ: new Set() })

function FilterChip({ label, options, active, onChange }: {
  label: string; options: string[]; active: Set<string>; onChange: (v: Set<string>) => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [open])
  function toggle(val: string) { const s = new Set(active); s.has(val) ? s.delete(val) : s.add(val); onChange(s) }
  const count = active.size
  return (
    <div ref={ref} className="filter-chip-wrap">
      <button className={`filter-chip-btn${count > 0 ? ' active' : ''}`} onClick={() => setOpen(o => !o)}>
        {label}{count > 0 ? ` (${count})` : ''} ▾
      </button>
      {count > 0 && <button className="filter-chip-clear" onClick={() => { onChange(new Set()); setOpen(false) }} title="Zurücksetzen">×</button>}
      {open && (
        <div className="filter-chip-dropdown">
          {options.length === 0 ? <div className="filter-chip-empty">Keine Optionen</div> : options.map(opt => (
            <label key={opt} className="filter-chip-option">
              <input type="checkbox" checked={active.has(opt)} onChange={() => toggle(opt)} />
              {opt || '(ohne)'}
            </label>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Column visibility ─────────────────────────────────────────────────────────

type ColKey = 'typ' | 'date' | 'project' | 'net' | 'gross' | 'paid' | 'open' | 'statusLabel'

interface ColDef { key: ColKey; label: string; className?: string; defaultVisible: boolean }
const COLUMNS: ColDef[] = [
  { key: 'typ',         label: 'Typ',            defaultVisible: true  },
  { key: 'date',        label: 'Datum',          defaultVisible: true  },
  { key: 'project',     label: 'Projekt',        defaultVisible: true  },
  { key: 'net',         label: 'Netto €',        className: 'num', defaultVisible: true  },
  { key: 'gross',       label: 'Brutto €',       className: 'num', defaultVisible: true  },
  { key: 'paid',        label: 'Bezahlt €',      className: 'num', defaultVisible: false },
  { key: 'open',        label: 'Offene Posten €', className: 'num', defaultVisible: true  },
  { key: 'statusLabel', label: 'Status',         defaultVisible: true  },
]

// ── Sort ──────────────────────────────────────────────────────────────────────

type SortKey = 'number' | 'typ' | 'date' | 'project' | 'net' | 'gross' | 'paid' | 'open' | 'statusLabel'

function SortTh({ label, k, sortKey, dir, onClick, className }: {
  label: string; k: SortKey; sortKey: SortKey; dir: 'asc'|'desc'
  onClick: (k: SortKey) => void; className?: string
}) {
  return (
    <th className={`sortable-th${className ? ' ' + className : ''}`} onClick={() => onClick(k)}>
      {label} {sortKey === k ? (dir === 'asc' ? '▲' : '▼') : ''}
    </th>
  )
}

// ── Payment modal target ──────────────────────────────────────────────────────

interface PaymentTarget {
  source:           'invoice' | 'pp'
  id:               number
  label:            string
  totalGross:       number | null
  paidGross:        number | null
  cashDiscountPct:  number
  cashDiscountDays: number
}

function emptyPaymentForm() {
  return { amount_payed_gross: '', payment_date: todayIso(), purpose_of_payment: '', comment: '' }
}

// ── Component ─────────────────────────────────────────────────────────────────

interface RechnungenListeProps {
  onEditDraft?:  (d: EditDraftPayload) => void
  initialSearch?: string
  backProject?:  { id: number; name: string }
  onClearBack?:  () => void
}

export function RechnungenListe({ onEditDraft, initialSearch, backProject, onClearBack }: RechnungenListeProps = {}) {
  const qc = useQueryClient()
  const navigate = useNavigate()

  const [search,        setSearch]        = useState(initialSearch ?? '')
  const [onlyOpen,      setOnlyOpen]      = useState(false)
  const [activeFilters, setActiveFilters] = useState<ActiveFilters>(emptyFilters())
  const [hiddenCols,    setHiddenCols]    = useState<Set<ColKey>>(
    new Set(COLUMNS.filter(c => !c.defaultVisible).map(c => c.key))
  )
  const [colPanelOpen,  setColPanelOpen]  = useState(false)
  const colPanelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (initialSearch !== undefined) setSearch(initialSearch)
  }, [initialSearch])

  useEffect(() => {
    if (!colPanelOpen) return
    const h = (e: MouseEvent) => { if (colPanelRef.current && !colPanelRef.current.contains(e.target as Node)) setColPanelOpen(false) }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [colPanelOpen])

  function setDimFilter(dim: FilterDim, vals: Set<string>) { setActiveFilters(prev => ({ ...prev, [dim]: vals })) }
  function toggleCol(key: ColKey) { setHiddenCols(prev => { const s = new Set(prev); s.has(key) ? s.delete(key) : s.add(key); return s }) }
  const visibleCols = COLUMNS.filter(c => !hiddenCols.has(c.key))
  const [sortKey, setSortKey] = useState<SortKey>('date')
  const [sortDir, setSortDir] = useState<'asc'|'desc'>('desc')

  const [detailRow,   setDetailRow]   = useState<UnifiedRow | null>(null)
  const [payTarget,   setPayTarget]   = useState<PaymentTarget | null>(null)
  const [payForm,     setPayForm]     = useState(emptyPaymentForm())
  const [payMsg,      setPayMsg]      = useState<{ text: string; type: 'success' | 'error' } | null>(null)
  const [existingPayments, setExistingPayments] = useState<Payment[]>([])
  const [deletingPayId, setDeletingPayId] = useState<number | null>(null)

  const { data: invData, isLoading: invLoading } = useQuery({
    queryKey: ['invoices'],
    queryFn:  () => fetchInvoices(''),
  })
  const { data: ppData, isLoading: ppLoading } = useQuery({
    queryKey: ['partial-payments'],
    queryFn:  () => fetchPartialPayments(''),
  })

  const isLoading = invLoading || ppLoading

  const allRows = useMemo<UnifiedRow[]>(() => [
    ...(invData?.data ?? []).map(fromInvoice),
    ...(ppData?.data  ?? []).map(fromPp),
  ], [invData, ppData])

  const filterOptions = useMemo(() => {
    const uniq = (fn: (r: UnifiedRow) => string) =>
      [...new Set(allRows.map(fn).filter(v => v !== ''))].sort()
    return {
      status: uniq(r => r.statusLabel),
      typ:    uniq(r => r.typ),
    }
  }, [allRows])

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase()
    let filtered = q
      ? allRows.filter(r =>
          `${r.number ?? ''} ${r.typ} ${r.date ?? ''} ${r.project ?? ''} ${r.statusLabel}`
            .toLowerCase().includes(q)
        )
      : allRows
    if (onlyOpen) {
      filtered = filtered.filter(r => r.statusClass === 'booked' && (r.open ?? 0) > 0.005)
    }
    if (activeFilters.status.size > 0) filtered = filtered.filter(r => activeFilters.status.has(r.statusLabel))
    if (activeFilters.typ.size    > 0) filtered = filtered.filter(r => activeFilters.typ.has(r.typ))
    return [...filtered].sort((a, b) => {
      const av = a[sortKey] ?? ''
      const bv = b[sortKey] ?? ''
      const cmp = typeof av === 'number' && typeof bv === 'number'
        ? av - bv
        : String(av).localeCompare(String(bv), 'de', { numeric: true })
      return sortDir === 'asc' ? cmp : -cmp
    })
  }, [allRows, search, onlyOpen, sortKey, sortDir, activeFilters])

  const totals = useMemo(() => ({
    net:   rows.reduce((s, r) => s + (r.net   ?? 0), 0),
    gross: rows.reduce((s, r) => s + (r.gross ?? 0), 0),
    paid:  rows.reduce((s, r) => s + (r.paid  ?? 0), 0),
    open:  rows.reduce((s, r) => s + (r.open  ?? 0), 0),
  }), [rows])

  function toggleSort(k: SortKey) {
    if (sortKey === k) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortKey(k); setSortDir('asc') }
  }

  const payMut = useMutation({
    mutationFn: createPayment,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['invoices'] })
      void qc.invalidateQueries({ queryKey: ['partial-payments'] })
      setPayMsg({ text: 'Zahlung gespeichert ✅', type: 'success' })
      setTimeout(() => { setPayTarget(null); setPayForm(emptyPaymentForm()); setPayMsg(null) }, 900)
    },
    onError: (e: Error) => setPayMsg({ text: e.message, type: 'error' }),
  })

  function openPayment(row: UnifiedRow) {
    setPayForm(emptyPaymentForm())
    setPayMsg(null)
    setExistingPayments([])
    setDeletingPayId(null)
    const id  = (row.raw as Invoice).ID ?? (row.raw as PartialPayment).ID
    const raw = row.raw as Invoice & PartialPayment
    setPayTarget({
      source:           row.source,
      id,
      label:            row.number ?? `#${id}`,
      totalGross:       row.gross,
      paidGross:        row.paid,
      cashDiscountPct:  Number(raw.CASH_DISCOUNT_PERCENT ?? 0),
      cashDiscountDays: Number(raw.CASH_DISCOUNT_DAYS ?? 0),
    })
    const params = row.source === 'invoice' ? { invoice_id: id } : { partial_payment_id: id }
    fetchPayments(params).then(r => setExistingPayments(r.data ?? [])).catch(() => {})
  }

  async function handleDeletePayment(payId: number) {
    if (!window.confirm('Zahlung wirklich löschen?')) return
    setDeletingPayId(payId)
    try {
      await deletePayment(payId)
      setExistingPayments(prev => prev.filter(p => p.ID !== payId))
      void qc.invalidateQueries({ queryKey: ['invoices'] })
      void qc.invalidateQueries({ queryKey: ['partial-payments'] })
      // Update the displayed paidGross in the modal header
      setPayTarget(prev => {
        if (!prev) return prev
        const removed = existingPayments.find(p => p.ID === payId)
        if (!removed) return prev
        return { ...prev, paidGross: (prev.paidGross ?? 0) - removed.AMOUNT_PAYED_GROSS }
      })
    } catch (e: unknown) {
      setPayMsg({ text: (e as { message?: string })?.message ?? 'Fehler beim Löschen', type: 'error' })
    } finally {
      setDeletingPayId(null)
    }
  }

  function submitPayment(e: React.FormEvent) {
    e.preventDefault()
    setPayMsg(null)
    const gross = parseFloat(payForm.amount_payed_gross)
    if (!payForm.amount_payed_gross || !Number.isFinite(gross) || gross <= 0) {
      setPayMsg({ text: 'Betrag (Brutto) ist erforderlich', type: 'error' }); return
    }
    if (!payForm.payment_date) {
      setPayMsg({ text: 'Datum ist erforderlich', type: 'error' }); return
    }
    if (!payTarget) return
    payMut.mutate({
      ...(payTarget.source === 'invoice'
        ? { invoice_id: payTarget.id }
        : { partial_payment_id: payTarget.id }),
      amount_payed_gross: gross,
      payment_date:       payForm.payment_date,
      purpose_of_payment: payForm.purpose_of_payment || undefined,
      comment:            payForm.comment || undefined,
    })
  }

  async function handleCancel(row: UnifiedRow) {
    const label = row.number ?? `#${(row.raw as Invoice).ID}`

    if (row.source === 'invoice') {
      const inv = row.raw as Invoice
      // Check for existing payments before cancelling
      let deletePayments = false
      try {
        const paysRes = await fetchPayments({ invoice_id: inv.ID })
        const pays = paysRes.data ?? []
        if (pays.length > 0) {
          const totalPaid = pays.reduce((s, p) => s + (p.AMOUNT_PAYED_GROSS ?? 0), 0)
          const choice = window.confirm(
            `Für Rechnung ${label} existieren ${pays.length} Zahlung(en) über ${FMT_EUR.format(totalPaid)}.\n\n` +
            `OK = Zahlung(en) ebenfalls löschen\nAbbrechen = nur Rechnung stornieren`
          )
          deletePayments = choice
        } else {
          if (!window.confirm(`Stornorechnung für ${label} erstellen?`)) return
        }
      } catch {
        if (!window.confirm(`Stornorechnung für ${label} erstellen?`)) return
      }
      try {
        await cancelInvoice(inv.ID, { delete_payments: deletePayments })
        void qc.invalidateQueries({ queryKey: ['invoices'] })
        void qc.invalidateQueries({ queryKey: ['partial-payments'] })
      } catch (e: unknown) {
        alert((e as { message?: string })?.message ?? 'Fehler beim Stornieren')
      }
    } else {
      const pp = row.raw as PartialPayment
      let deletePayments = false
      try {
        const paysRes = await fetchPayments({ partial_payment_id: pp.ID })
        const pays = paysRes.data ?? []
        if (pays.length > 0) {
          const totalPaid = pays.reduce((s, p) => s + (p.AMOUNT_PAYED_GROSS ?? 0), 0)
          const choice = window.confirm(
            `Für Abschlagsrechnung ${label} existieren ${pays.length} Zahlung(en) über ${FMT_EUR.format(totalPaid)}.\n\n` +
            `OK = Zahlung(en) ebenfalls löschen\nAbbrechen = nur Abschlagsrechnung stornieren`
          )
          deletePayments = choice
        } else {
          if (!window.confirm(`Stornorechnung für ${label} erstellen?`)) return
        }
      } catch {
        if (!window.confirm(`Stornorechnung für ${label} erstellen?`)) return
      }
      try {
        await cancelPartialPayment(pp.ID, { delete_payments: deletePayments })
        void qc.invalidateQueries({ queryKey: ['partial-payments'] })
      } catch (e: unknown) {
        alert((e as { message?: string })?.message ?? 'Fehler beim Stornieren')
      }
    }
  }

  async function handleDelete(row: UnifiedRow) {
    if (!window.confirm(`Entwurf löschen?`)) return
    try {
      if (row.source === 'invoice') {
        await deleteInvoice((row.raw as Invoice).ID)
        void qc.invalidateQueries({ queryKey: ['invoices'] })
      } else {
        await deletePartialPayment((row.raw as PartialPayment).ID)
        void qc.invalidateQueries({ queryKey: ['partial-payments'] })
      }
    } catch (e: unknown) {
      alert((e as { message?: string })?.message ?? 'Fehler beim Löschen')
    }
  }

  function canPay(row: UnifiedRow) {
    if (row.source === 'invoice') {
      const inv = row.raw as Invoice
      return inv.STATUS_ID === 2 && inv.INVOICE_TYPE !== 'stornorechnung'
    }
    const pp = row.raw as PartialPayment
    return pp.STATUS_ID === 2 && !pp.CANCELS_PARTIAL_PAYMENT_ID
  }

  function canCancel(row: UnifiedRow) { return canPay(row) }

  function canDelete(row: UnifiedRow) {
    if (row.source === 'invoice') return (row.raw as Invoice).STATUS_ID === 1
    return (row.raw as PartialPayment).STATUS_ID === 1
  }

  function canEdit(row: UnifiedRow) {
    return row.statusClass === 'draft'
  }

  function wizardTypeOf(row: UnifiedRow): 'abschlag' | 'rechnung' | 'schluss' {
    if (row.source === 'pp') return 'abschlag'
    const inv = row.raw as Invoice
    if (inv.INVOICE_TYPE === 'schlussrechnung' || inv.INVOICE_TYPE === 'teilschlussrechnung') return 'schluss'
    return 'rechnung'
  }

  function handleEditDraftClick(row: UnifiedRow) {
    setDetailRow(null)
    const raw = row.raw as Invoice & PartialPayment
    onEditDraft?.({
      id:            raw.ID,
      projectId:     raw.PROJECT_ID,
      contractId:    raw.CONTRACT_ID,
      projectLabel:  row.project ?? '',
      contractLabel: raw.CONTRACT ?? '',
      wizardType:    wizardTypeOf(row),
      d1Pct:         Number(raw.DISCOUNT_1_PERCENT ?? 0),
      d2Pct:         Number(raw.DISCOUNT_2_PERCENT ?? 0),
      d1Reason:      raw.DISCOUNT_1_REASON ?? null,
      d2Reason:      raw.DISCOUNT_2_REASON ?? null,
      cashDiscPct:   Number(raw.CASH_DISCOUNT_PERCENT ?? 0),
      cashDiscDays:  Number(raw.CASH_DISCOUNT_DAYS ?? 0),
    })
  }

  function openPdf(row: UnifiedRow) {
    if (row.source === 'invoice') openInvoicePdf((row.raw as Invoice).ID)
    else openPpPdf((row.raw as PartialPayment).ID)
  }

  async function openXRechnung(row: UnifiedRow) {
    try {
      if (row.source === 'invoice') {
        const inv = row.raw as Invoice
        await downloadInvoiceEinvoice(inv.ID, inv.INVOICE_TYPE, inv.INVOICE_NUMBER, 'ubl')
      } else {
        const pp = row.raw as PartialPayment
        await downloadPpEinvoice(pp.ID, pp.PARTIAL_PAYMENT_NUMBER, 'ubl')
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      alert(`XRechnung konnte nicht geladen werden: ${msg}`)
    }
  }

  async function openZUGFeRD(row: UnifiedRow) {
    try {
      if (row.source === 'invoice') {
        const inv = row.raw as Invoice
        await downloadInvoiceEinvoice(inv.ID, inv.INVOICE_TYPE, inv.INVOICE_NUMBER, 'cii')
      } else {
        const pp = row.raw as PartialPayment
        await downloadPpEinvoice(pp.ID, pp.PARTIAL_PAYMENT_NUMBER, 'cii')
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      alert(`ZUGFeRD konnte nicht geladen werden: ${msg}`)
    }
  }

  const sp = { sortKey, dir: sortDir, onClick: toggleSort }
  const remaining = payTarget ? (Math.round(((payTarget.totalGross ?? 0) - (payTarget.paidGross ?? 0)) * 100) / 100) : null

  return (
    <div>
      {backProject && (
        <div className="proj-jump-bar" style={{ marginTop: 10 }}>
          <button className="btn-small" onClick={() => { onClearBack?.(); navigate('/projekte', { state: { tab: 'struktur', projectId: backProject.id } }) }}>
            ← Projektstruktur ({backProject.name})
          </button>
        </div>
      )}
      <div className="pl-toolbar" style={{ marginTop: backProject ? 0 : 10 }}>
        <input
          className="list-search"
          placeholder="Suchen …"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        <div className="pl-filter-chips">
          <FilterChip label="Status" options={filterOptions.status} active={activeFilters.status} onChange={v => setDimFilter('status', v)} />
          <FilterChip label="Typ"    options={filterOptions.typ}    active={activeFilters.typ}    onChange={v => setDimFilter('typ', v)}    />
          <label className="list-checkbox-label" style={{ fontSize: 12 }}>
            <input type="checkbox" checked={onlyOpen} onChange={e => setOnlyOpen(e.target.checked)} />
            nur offen
          </label>
          {(activeFilters.status.size > 0 || activeFilters.typ.size > 0) && (
            <button className="pl-clear-btn" onClick={() => setActiveFilters(emptyFilters())}>
              Filter löschen
            </button>
          )}
        </div>
        <div ref={colPanelRef} className="pl-col-wrap">
          <button className="pl-col-btn" onClick={() => setColPanelOpen(o => !o)}>⚙ Spalten</button>
          {colPanelOpen && (
            <div className="pl-col-panel">
              <div className="pl-col-panel-title">Sichtbare Spalten</div>
              {COLUMNS.map(c => (
                <label key={c.key} className="pl-col-option">
                  <input type="checkbox" checked={!hiddenCols.has(c.key)} onChange={() => toggleCol(c.key)} />
                  {c.label}
                </label>
              ))}
            </div>
          )}
        </div>
        <span className="list-info">
          {rows.length}{rows.length !== allRows.length ? ` / ${allRows.length}` : ''} Einträge
        </span>
      </div>

      {isLoading && <p className="empty-note">Laden …</p>}
      {!isLoading && (
        <div className="list-section table-scroll">
          <table className="master-table">
            <thead>
              <tr>
                <SortTh label="Nummer" k="number" {...sp} />
                {visibleCols.map(c => (
                  <SortTh key={c.key} label={c.label} k={c.key} {...sp} className={c.className} />
                ))}
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map(row => (
                <tr key={row.key}>
                  <td>{row.number ?? '—'}</td>
                  {visibleCols.map(c => {
                    if (c.key === 'typ')         return <td key={c.key}>{row.typ}</td>
                    if (c.key === 'date')        return <td key={c.key}>{fmtDate(row.date)}</td>
                    if (c.key === 'project')     return <td key={c.key}>{row.project ?? '—'}</td>
                    if (c.key === 'net')         return <td key={c.key} className="num">{fmtEur(row.net)}</td>
                    if (c.key === 'gross')       return <td key={c.key} className="num">{fmtEur(row.gross)}</td>
                    if (c.key === 'paid')        return <td key={c.key} className="num">{fmtEur(row.paid)}</td>
                    if (c.key === 'open')        return <td key={c.key} className="num">{fmtEur(row.open)}</td>
                    if (c.key === 'statusLabel') return <td key={c.key}><span className={`status-badge ${row.statusClass}`}>{row.statusLabel}</span></td>
                    return null
                  })}
                  <td className="doc-actions">
                    <button className="btn-small" onClick={() => setDetailRow(row)}>Details</button>
                    <button className="btn-small" onClick={() => openPdf(row)}>PDF</button>
                    <button className="btn-small" onClick={() => openXRechnung(row)}>XRechnung</button>
                    <button className="btn-small" onClick={() => openZUGFeRD(row)}>ZUGFeRD</button>
                    {row.projectId !== null && (
                      <button className="btn-small" title="Projektstruktur öffnen" onClick={() => navigate('/projekte', { state: { tab: 'struktur', projectId: row.projectId } })}>
                        → Projekt
                      </button>
                    )}
                    {canPay(row) && (
                      <button className="btn-small btn-save" onClick={() => openPayment(row)}>Zahlung</button>
                    )}
                    {canCancel(row) && (
                      <button className="btn-small btn-danger" onClick={() => handleCancel(row)}>Storno</button>
                    )}
                    {canDelete(row) && (
                      <button className="btn-small btn-danger" onClick={() => handleDelete(row)}>Löschen</button>
                    )}
                  </td>
                </tr>
              ))}
              {!rows.length && <tr><td colSpan={2 + visibleCols.length} className="empty-note">Keine Einträge</td></tr>}
            </tbody>
            <tfoot>
              <tr style={{ fontWeight: 600, borderTop: '2px solid rgba(17,24,39,0.12)' }}>
                <td style={{ fontSize: 13, color: 'rgba(17,24,39,0.5)', paddingTop: 6 }}>
                  {rows.length !== allRows.length ? `${rows.length} / ${allRows.length}` : `${allRows.length}`}
                </td>
                {visibleCols.map(c => {
                  if (c.key === 'net')   return <td key={c.key} className="num"><strong>{fmtEur(totals.net)}</strong></td>
                  if (c.key === 'gross') return <td key={c.key} className="num"><strong>{fmtEur(totals.gross)}</strong></td>
                  if (c.key === 'paid')  return <td key={c.key} className="num"><strong>{fmtEur(totals.paid)}</strong></td>
                  if (c.key === 'open')  return <td key={c.key} className="num"><strong>{fmtEur(totals.open)}</strong></td>
                  return <td key={c.key}></td>
                })}
                <td></td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {/* Detail modal */}
      <Modal open={detailRow !== null} onClose={() => setDetailRow(null)}
        title={detailRow ? `${detailRow.typ} – ${detailRow.number ?? '(Entwurf)'}` : ''}>
        {detailRow && (() => {
          const isInv = detailRow.source === 'invoice'
          const inv   = isInv ? (detailRow.raw as Invoice)        : null
          const pp    = !isInv ? (detailRow.raw as PartialPayment) : null

          const vatPct      = Number((inv ?? pp)?.VAT_PERCENT ?? 0)
          const rawNet      = Number((inv ?? pp)?.TOTAL_AMOUNT_NET ?? 0)
          const d1Pct       = Number((inv ?? pp)?.DISCOUNT_1_PERCENT ?? 0)
          const d2Pct       = Number((inv ?? pp)?.DISCOUNT_2_PERCENT ?? 0)
          const d1Reason    = (inv ?? pp)?.DISCOUNT_1_REASON ?? null
          const d2Reason    = (inv ?? pp)?.DISCOUNT_2_REASON ?? null
          const d1Amt       = Math.round(rawNet * d1Pct / 100 * 100) / 100
          const d2Amt       = Math.round((rawNet - d1Amt) * d2Pct / 100 * 100) / 100
          const discNet     = effectiveDiscounts(rawNet, (inv ?? pp)?.TOTAL_DISCOUNTS ?? null, d1Pct, d2Pct)
          const cdPct        = Number((inv ?? pp)?.CASH_DISCOUNT_PERCENT ?? 0)
          const cdDays       = (inv ?? pp)?.CASH_DISCOUNT_DAYS ?? null
          const adjNet       = detailRow.net ?? 0
          const adjVat       = Math.round(adjNet * vatPct / 100 * 100) / 100
          const adjGross     = detailRow.gross ?? 0
          const skontoPayAmt = cdPct > 0 ? Math.round(adjGross * (1 - cdPct / 100) * 100) / 100 : 0
          const bpStart     = (inv ?? pp)?.BILLING_PERIOD_START ?? null
          const bpFinish    = (inv ?? pp)?.BILLING_PERIOD_FINISH ?? null
          const comment     = (inv ?? pp)?.COMMENT ?? null

          const row2 = (label: string, value: React.ReactNode, dimmed = false) => (
            <tr style={{ borderBottom: '1px solid rgba(17,24,39,0.06)' }}>
              <td style={{ padding: '5px 12px 5px 0', fontSize: 13, color: 'rgba(17,24,39,0.5)', whiteSpace: 'nowrap' }}>{label}</td>
              <td style={{ padding: '5px 0', fontSize: 13, color: dimmed ? 'rgba(17,24,39,0.45)' : undefined }}>{value}</td>
            </tr>
          )
          const amtRow = (label: string, amt: number, bold = false, indent = false, minus = false) => (
            <tr>
              <td style={{ padding: '3px 12px 3px 0', fontSize: 13, color: bold ? undefined : 'rgba(17,24,39,0.6)', paddingLeft: indent ? 16 : 0 }}>{label}</td>
              <td style={{ padding: '3px 0', fontSize: 13, fontWeight: bold ? 600 : undefined, textAlign: 'right' }}>
                {minus ? '− ' : ''}{fmtEur(Math.abs(amt))}
              </td>
            </tr>
          )

          return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

              {/* Header info */}
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <tbody>
                  {row2('Status', <span className={`status-badge ${detailRow.statusClass}`}>{detailRow.statusLabel}</span>)}
                  {row2('Datum', fmtDate(isInv ? inv!.INVOICE_DATE : pp!.PARTIAL_PAYMENT_DATE))}
                  {(inv?.DUE_DATE ?? pp?.DUE_DATE) && row2('Fällig', fmtDate(inv?.DUE_DATE ?? pp?.DUE_DATE))}
                  {detailRow.project && row2('Projekt', detailRow.project)}
                  {(inv?.CONTRACT ?? pp?.CONTRACT) && row2('Vertrag', inv?.CONTRACT ?? pp?.CONTRACT)}
                  {(inv?.CONTACT ?? pp?.CONTACT) && row2('Kontakt', inv?.CONTACT ?? pp?.CONTACT)}
                  {(inv?.ADDRESS_NAME_1 ?? pp?.ADDRESS_NAME_1) && row2('Adresse', inv?.ADDRESS_NAME_1 ?? pp?.ADDRESS_NAME_1)}
                  {bpStart && row2('Abrechnungszeitraum', `${fmtDate(bpStart)} – ${fmtDate(bpFinish)}`)}
                  {comment && row2('Bemerkung', <span style={{ whiteSpace: 'pre-line' }}>{comment}</span>)}
                </tbody>
              </table>

              {/* Amount breakdown */}
              <div>
                <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'rgba(17,24,39,0.4)', marginBottom: 4 }}>Beträge</div>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <tbody>
                    {pp && pp.AMOUNT_NET != null && amtRow('Honorar', Number(pp.AMOUNT_NET))}
                    {pp && pp.AMOUNT_EXTRAS_NET != null && Number(pp.AMOUNT_EXTRAS_NET) !== 0 && amtRow('Nebenkosten', Number(pp.AMOUNT_EXTRAS_NET))}
                    {amtRow('Rechnungssumme netto', rawNet)}
                    {d1Pct > 0 && amtRow(`abzgl. ${d1Reason ?? 'Nachlass I'} (${d1Pct} %)`, d1Amt, false, true, true)}
                    {d2Pct > 0 && amtRow(`abzgl. ${d2Reason ?? 'Nachlass II'} (${d2Pct} %)`, d2Amt, false, true, true)}
                    {discNet > 0 && amtRow('Netto nach Nachlässen', adjNet, false, true)}
                    {amtRow(`zzgl. ${vatPct} % MwSt`, adjVat)}
                    {amtRow('Rechnungssumme brutto', adjGross, true)}
                    {detailRow.paid != null && detailRow.paid > 0 && amtRow('Bezahlt', detailRow.paid, false, true, true)}
                    {amtRow('Offene Posten', detailRow.open ?? adjGross, true)}
                    {cdPct > 0 && (
                      <tr>
                        <td colSpan={2} style={{ paddingTop: 8, fontSize: 12, color: 'rgba(17,24,39,0.55)', fontStyle: 'italic' }}>
                          Bei Zahlung innerhalb von {cdDays} Tagen: {cdPct} % Skonto → zu zahlen {fmtEur(skontoPayAmt)}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              {/* Actions */}
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', paddingTop: 4 }}>
                <button className="btn-small" onClick={() => openPdf(detailRow)}>PDF anzeigen</button>
                {canEdit(detailRow) && onEditDraft && (
                  <button className="btn-small btn-save" onClick={() => handleEditDraftClick(detailRow)}>
                    Bearbeiten / Buchen
                  </button>
                )}
              </div>
            </div>
          )
        })()}
      </Modal>

      {/* Payment modal */}
      <Modal open={payTarget !== null} onClose={() => setPayTarget(null)} title={`Zahlung erfassen – ${payTarget?.label ?? ''}`}>
        {payTarget && (
          <form onSubmit={submitPayment} className="master-form">

            {/* Existing payments list */}
            {existingPayments.length > 0 && (
              <div style={{ marginBottom: 14 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: 'rgba(17,24,39,0.5)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  Bisherige Zahlungen
                </div>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <tbody>
                    {existingPayments.map(p => (
                      <tr key={p.ID} style={{ borderBottom: '1px solid rgba(17,24,39,0.08)' }}>
                        <td style={{ padding: '4px 0', color: 'rgba(17,24,39,0.55)' }}>{p.PAYMENT_DATE?.slice(0, 10)}</td>
                        <td style={{ padding: '4px 6px', fontWeight: 500 }}>{fmtEur(p.AMOUNT_PAYED_GROSS)}</td>
                        <td style={{ padding: '4px 0', color: 'rgba(17,24,39,0.45)', flex: 1 }}>{p.PURPOSE_OF_PAYMENT ?? ''}</td>
                        <td style={{ padding: '4px 0 4px 8px', textAlign: 'right' }}>
                          <button
                            type="button"
                            title="Zahlung löschen"
                            disabled={deletingPayId === p.ID}
                            onClick={() => handleDeletePayment(p.ID)}
                            style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#ef4444', fontWeight: 700, fontSize: 16, lineHeight: 1, padding: '0 2px' }}
                          >
                            ×
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {payTarget.totalGross != null && (
              <div style={{ marginBottom: 12, fontSize: 14, color: 'rgba(17,24,39,0.6)', display: 'flex', alignItems: 'center', gap: 10 }}>
                <span>
                  Rechnungsbetrag: <strong>{fmtEur(payTarget.totalGross)}</strong>
                  {payTarget.paidGross != null && payTarget.paidGross > 0 && (
                    <> · bereits bezahlt: <strong>{fmtEur(payTarget.paidGross)}</strong>
                    · offen: <strong>{fmtEur(remaining)}</strong></>
                  )}
                </span>
                <button
                  type="button"
                  className="btn-small"
                  onClick={() => setPayForm(f => ({ ...f, amount_payed_gross: String(remaining ?? payTarget.totalGross) }))}
                >
                  wie gefordert
                </button>
              </div>
            )}
            {payTarget.cashDiscountPct > 0 && payTarget.totalGross != null && (() => {
              const skontoAmt = Math.round(payTarget.totalGross * (1 - payTarget.cashDiscountPct / 100) * 100) / 100
              return (
                <div style={{ marginBottom: 14, padding: '10px 14px', background: 'rgba(16,185,129,0.07)', borderRadius: 8, border: '1px solid rgba(16,185,129,0.25)', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                  <span style={{ flex: 1, fontSize: 13, color: 'rgba(17,24,39,0.75)' }}>
                    <strong>{payTarget.cashDiscountPct} % Skonto</strong> verfügbar
                    {payTarget.cashDiscountDays > 0 && ` (innerhalb von ${payTarget.cashDiscountDays} Tagen)`}
                    {' – '}Betrag abzgl. Skonto: <strong>{fmtEur(skontoAmt)}</strong>
                  </span>
                  <button
                    type="button"
                    className="btn-small btn-save"
                    onClick={() => setPayForm(f => ({ ...f, amount_payed_gross: String(skontoAmt) }))}
                  >
                    Zahlung abzgl. Skonto
                  </button>
                </div>
              )
            })()}
            <div className="form-row">
              <div className="form-group">
                <label htmlFor="pay-amount">Betrag brutto (€)*</label>
                <input
                  id="pay-amount" type="number" step="0.01" min="0.01" required
                  value={payForm.amount_payed_gross}
                  onChange={e => setPayForm(f => ({ ...f, amount_payed_gross: e.target.value }))}
                />
              </div>
              <div className="form-group">
                <label htmlFor="pay-date">Datum*</label>
                <input
                  id="pay-date" type="date" required
                  value={payForm.payment_date}
                  onChange={e => setPayForm(f => ({ ...f, payment_date: e.target.value }))}
                />
              </div>
            </div>
            <div className="form-group">
              <label htmlFor="pay-purpose">Verwendungszweck</label>
              <input id="pay-purpose" type="text"
                value={payForm.purpose_of_payment}
                onChange={e => setPayForm(f => ({ ...f, purpose_of_payment: e.target.value }))}
              />
            </div>
            <div className="form-group">
              <label htmlFor="pay-comment">Kommentar</label>
              <input id="pay-comment" type="text"
                value={payForm.comment}
                onChange={e => setPayForm(f => ({ ...f, comment: e.target.value }))}
              />
            </div>
            <Message text={payMsg?.text ?? null} type={payMsg?.type} />
            <div className="modal-actions">
              <button className="btn-primary" type="submit" disabled={payMut.isPending}>
                {payMut.isPending ? 'Speichert …' : 'Zahlung speichern'}
              </button>
              <button type="button" onClick={() => setPayTarget(null)}>Abbrechen</button>
            </div>
          </form>
        )}
      </Modal>
    </div>
  )
}