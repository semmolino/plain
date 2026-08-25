import { useState, useMemo, useEffect, useRef, useCallback, Fragment } from 'react'
import { ListLoading } from '@/components/ui/Skeleton'
import { DialogFooter } from '@/components/ui/DialogFooter'
import { FilterChip } from '@/components/ui/FilterChip'
import { useStickyState } from '@/hooks/useStickyState'
import { useScrollEdges } from '@/hooks/useScrollEdges'
import { useRowDisclosure, useDetailPanelId, RowExpandButton, RowDetailRow, type DetailFeld } from '@/components/ui/RowDetail'
import { useFitColumns } from '@/hooks/useFitColumns'
import { SortTh } from '@/components/ui/SortTh'
import { RecentList } from '@/components/recents/RecentList'
import { trackRecent } from '@/api/recents'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Mail, SlidersHorizontal, Pencil, FileText } from 'lucide-react'
import { FilterBar } from '@/components/ui/FilterBar'
import { RowMenu } from '@/components/ui/RowMenu'
import { useIsNarrow } from '@/hooks/useIsNarrow'
import { Can } from '@/components/ui/Can'
import { HasFeature } from '@/components/ui/HasFeature'
import { Modal }        from '@/components/ui/Modal'
import { Message }      from '@/components/ui/Message'
import { ConfirmModal } from '@/components/ui/ConfirmModal'
import { BatchEmailModal, type BatchEmailItem } from '@/components/ui/BatchEmailModal'
import { useToast }     from '@/store/toastStore'
import { AbrechenbareProjekte } from '@/pages/rechnungen/AbrechenbareProjekte'
import {
  fetchInvoices, fetchPartialPayments,
  openInvoicePdf, openPpPdf,
  downloadInvoiceEinvoice, downloadPpEinvoice,
  downloadInvoicePdfHybrid, downloadPpPdfHybrid,
  downloadInvoicePeppol, downloadPpPeppol,
  cancelInvoice, cancelPartialPayment,
  deleteInvoice, deletePartialPayment,
  fetchPayments, createPayment, deletePayment,
  sendInvoiceEmail, sendPpEmail,
  fetchInvoiceEmailPreview, fetchPpEmailPreview,
  type Invoice, type PartialPayment, type Payment,
} from '@/api/rechnungen'
import { fetchEmailTemplates } from '@/api/emailTemplates'

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
    gutschrift:          'Gutschrift',
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
  dueDate:    string | null
  isOverdue:  boolean
  project:    string | null
  projectId:  number | null
  address:    string | null
  net:        number | null
  gross:      number | null
  paid:       number | null
  open:       number | null
  seHeld:     number | null   // einbehaltener SEB für diese Rechnung (≥ 0)
  seRelease:  number | null   // aufgelöster SEB durch diese Rechnung (≥ 0, nur INVOICE)
  payable:    number | null   // tatsächliche Forderungssumme nach SEB
  statusLabel: string
  statusClass: string
  /** true = der Storno-Beleg selbst (nicht der stornierte Originalbeleg). */
  isStorno:   boolean
  raw:        Invoice | PartialPayment
}

function effectiveDiscounts(rawNet: number, totalDiscounts: number | null, d1Pct: number, d2Pct: number): number {
  if (totalDiscounts != null && totalDiscounts > 0) return totalDiscounts
  const d1Amt = Math.round(rawNet * d1Pct / 100 * 100) / 100
  const d2Amt = Math.round((rawNet - d1Amt) * d2Pct / 100 * 100) / 100
  return Math.round((d1Amt + d2Amt) * 100) / 100
}

/**
 * Versendbar ist jeder gebuchte Beleg — und zusaetzlich der Storno-Beleg
 * selbst. Der traegt den Status "Storno-Rechnung" (nicht "gebucht"), ist aber
 * ein eigener, gebuchter Beleg mit eigenem Storno-Formular und muss beim
 * Kunden ankommen. Der stornierte ORIGINALbeleg bleibt aussen vor: er ist
 * fachlich zurueckgenommen und darf nicht erneut verschickt werden.
 */
function canSendEmail(row: UnifiedRow) {
  return row.statusClass === 'booked' || row.isStorno
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
  const seHeld        = inv.SE_AMOUNT != null ? Number(inv.SE_AMOUNT) : 0
  const seRelease     = inv.SE_RELEASE_TOTAL != null ? Number(inv.SE_RELEASE_TOTAL) : 0
  const payable       = adjustedGross != null
    ? Math.round((adjustedGross - seHeld + seRelease) * 100) / 100
    : null
  const skontoBase    = payable ?? adjustedGross
  const skontoGross   = cdPct > 0 && skontoBase != null ? Math.round(skontoBase * (1 - cdPct / 100) * 100) / 100 : null
  const rawOpen       = payable != null ? Math.round((payable - (paid ?? 0)) * 100) / 100 : null
  const open          = skontoGross !== null && (paid ?? 0) >= skontoGross - 0.005 ? 0 : rawOpen
  const today = new Date().toISOString().slice(0, 10)
  const dueDate   = inv.DUE_DATE ?? null
  const isOverdue = statusClass === 'booked' && dueDate !== null && dueDate < today && (open ?? 0) > 0.005
  return {
    key:         `inv-${inv.ID}`,
    source:      'invoice',
    number:      inv.INVOICE_NUMBER ?? null,
    typ:         capitalizeInvType(inv.INVOICE_TYPE),
    date:        inv.INVOICE_DATE ?? null,
    dueDate,
    isOverdue,
    project:     inv.PROJECT ?? null,
    projectId:   inv.PROJECT_ID ?? null,
    address:     inv.ADDRESS_NAME_1 ?? null,
    net:         adjustedNet,
    gross:       adjustedGross,
    paid,
    open,
    seHeld:      seHeld !== 0 ? seHeld : null,
    seRelease:   seRelease > 0 ? seRelease : null,
    payable,
    statusLabel,
    statusClass,
    isStorno:    isStornoRow && !isOrigCancelled,
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
  const seHeld        = pp.SE_AMOUNT != null ? Number(pp.SE_AMOUNT) : 0
  const payable       = adjustedGross != null
    ? Math.round((adjustedGross - seHeld) * 100) / 100
    : null
  const skontoBase    = payable ?? adjustedGross
  const skontoGross   = cdPct > 0 && skontoBase != null ? Math.round(skontoBase * (1 - cdPct / 100) * 100) / 100 : null
  const rawOpen       = payable != null ? Math.round((payable - (paid ?? 0)) * 100) / 100 : null
  const open          = skontoGross !== null && (paid ?? 0) >= skontoGross - 0.005 ? 0 : rawOpen
  const today2   = new Date().toISOString().slice(0, 10)
  const dueDate2  = pp.DUE_DATE ?? null
  const isOverdue2 = statusClass === 'booked' && dueDate2 !== null && dueDate2 < today2 && (open ?? 0) > 0.005
  return {
    key:         `pp-${pp.ID}`,
    source:      'pp',
    number:      pp.PARTIAL_PAYMENT_NUMBER ?? null,
    typ:         'Abschlagsrechnung',
    date:        pp.PARTIAL_PAYMENT_DATE ?? null,
    dueDate:     dueDate2,
    isOverdue:   isOverdue2,
    project:     pp.PROJECT ?? null,
    projectId:   pp.PROJECT_ID ?? null,
    address:     pp.ADDRESS_NAME_1 ?? null,
    net:         adjustedNet,
    gross:       adjustedGross,
    paid,
    open,
    seHeld:      seHeld !== 0 ? seHeld : null,
    seRelease:   null,
    payable,
    statusLabel,
    statusClass,
    isStorno:    isStornoRow && !isOrigCancelled,
    raw:         pp,
  }
}

// ── Filter chips ──────────────────────────────────────────────────────────────

type FilterDim = 'status' | 'typ'
type ActiveFilters = Record<FilterDim, Set<string>>
const emptyFilters = (): ActiveFilters => ({ status: new Set(), typ: new Set() })


// ── Column visibility ─────────────────────────────────────────────────────────

type ColKey = 'typ' | 'date' | 'project' | 'address' | 'net' | 'gross' | 'seHeld' | 'payable' | 'paid' | 'open' | 'statusLabel'

interface ColDef { key: ColKey; label: string; className?: string; defaultVisible: boolean }
// Status steht bewusst VOR den Betraegen: er ist die haeufigste Scan-Dimension
// („was ist offen / ueberfaellig?"). Ganz rechts lag er hinter der fixierten
// Aktionsspalte und war beim horizontalen Scrollen als Erstes verdeckt.
//
// Welche Spalte bei Platzmangel weicht, steht NICHT hier, sondern in
// `WEGFALLBAR` weiter unten — als Reihenfolge, nicht als feste Stufe. Der
// Unterschied ist wesentlich: Eine Stufe („ab 1520px alles zeigen") ist eine
// Vorhersage darueber, wann etwas passt, und die war mit echten Daten falsch.
// Eine Reihenfolge ist nur eine Rangfolge; wie viele davon tatsaechlich
// weichen, misst `useFitColumns` nach dem Rendern.
const COLUMNS: ColDef[] = [
  { key: 'typ',         label: 'Typ',             defaultVisible: true  },
  { key: 'date',        label: 'Datum',           defaultVisible: true  },
  { key: 'statusLabel', label: 'Status',          defaultVisible: true  },
  { key: 'project',     label: 'Projekt',         defaultVisible: true  },
  { key: 'address',     label: 'Adresse',         defaultVisible: false },
  { key: 'net',         label: 'Netto €',         className: 'num', defaultVisible: true  },
  { key: 'gross',       label: 'Brutto €',        className: 'num', defaultVisible: true  },
  { key: 'seHeld',      label: 'SEB €',           className: 'num', defaultVisible: true  },
  { key: 'payable',     label: 'Forderung €',     className: 'num', defaultVisible: true  },
  { key: 'paid',        label: 'Bezahlt €',       className: 'num', defaultVisible: false },
  { key: 'open',        label: 'Offene Posten €', className: 'num', defaultVisible: true  },
]

/**
 * Rangfolge beim Platzmangel — unwichtigste zuerst.
 *
 * Zum WIEDERERKENNEN einer Rechnung braucht man Nummer, Datum und Projekt,
 * zum HANDELN Status und Brutto. Die stehen deshalb nicht in dieser Liste und
 * bleiben immer. Sicherheitseinbehalt und Forderung sind Nachrechen-Details
 * und weichen als Erste (so entschieden am 24.08.2026); danach Netto (aus
 * Brutto ableitbar), dann Offene Posten, zuletzt der Typ — der steht auch im
 * farbigen Zeilenrand und in der Detailansicht.
 */
// 'paid' ist in der Design-Variante "Aeline" ergaenzt: deren Monospace in
// den Betragsspalten und die Versal-Badges im Status brauchen rund 46px mehr
// Breite als die Standardschrift. Bei 1100px reichten die bisherigen fuenf
// Raenge dadurch nicht mehr aus, und die Liste stand ueber. Die Schrift
// dafuer weiter zu verkleinern schied aus — 11px fuer Meta und 13px fuer
// Fliesstext sind in CLAUDE.md als Untergrenze festgehalten.
const WEGFALLBAR: ColKey[] = ['seHeld', 'payable', 'net', 'open', 'typ', 'paid']

// ── Sort ──────────────────────────────────────────────────────────────────────

type SortKey = 'number' | 'typ' | 'date' | 'project' | 'address' | 'net' | 'gross' | 'seHeld' | 'payable' | 'paid' | 'open' | 'statusLabel'

// Die lokale SortTh-Kopie ist entfallen — sie hatte weder Tastaturbedienung
// noch `aria-sort`. Diese Liste nutzt jetzt `components/ui/SortTh`.

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

// ── Row overflow menu ─────────────────────────────────────────────────────────

// RowMenu liegt jetzt in components/ui/RowMenu.tsx (war hier lokal).

// ── Component ─────────────────────────────────────────────────────────────────

interface RechnungenListeProps {
  onEditDraft?:  (d: EditDraftPayload) => void
  onCreateInvoiceFromBilling?: (wizardType: 'abschlag' | 'rechnung' | 'schluss', projectId: number, projectLabel: string) => void
  initialSearch?: string
  backProject?:  { id: number; name: string }
  onClearBack?:  () => void
}

export function RechnungenListe({ onEditDraft, onCreateInvoiceFromBilling, initialSearch, backProject, onClearBack }: RechnungenListeProps = {}) {
  const qc = useQueryClient()
  const navigate = useNavigate()

  const [search,        setSearch]        = useState(initialSearch ?? '')
  const [onlyOpen,      setOnlyOpen]      = useStickyState<boolean>('rechnungen.onlyOpen', false)
  const [activeFilters, setActiveFilters] = useStickyState<ActiveFilters>('rechnungen.filters', emptyFilters, {
    serialize:   f => ({ status: [...f.status], typ: [...f.typ] }),
    deserialize: raw => {
      const r = emptyFilters(); const o = (raw ?? {}) as Record<string, unknown>
      if (Array.isArray(o.status)) r.status = new Set(o.status as string[])
      if (Array.isArray(o.typ))    r.typ    = new Set(o.typ as string[])
      return r
    },
  })
  const [hiddenCols,    setHiddenCols]    = useStickyState<Set<ColKey>>(
    'rechnungen.cols',
    () => new Set(COLUMNS.filter(c => !c.defaultVisible).map(c => c.key)),
    { serialize: s => [...s], deserialize: raw => new Set(Array.isArray(raw) ? raw as ColKey[] : []) },
  )
  // Spalten, die der Nutzer im Waehler selbst an- oder abgewaehlt hat. Fuer
  // diese gilt die automatische Ausblendung nach Platz NICHT mehr — sonst
  // haekelt man „SEB €" an und es passiert nichts, weil der Bildschirm zu
  // schmal ist. Wer sich entscheidet, hat entschieden.
  const [touchedCols,   setTouchedCols]   = useStickyState<Set<ColKey>>(
    'rechnungen.colsTouched',
    () => new Set<ColKey>(),
    { serialize: s => [...s], deserialize: raw => new Set(Array.isArray(raw) ? raw as ColKey[] : []) },
  )
  const [colPanelOpen,  setColPanelOpen]  = useState(false)
  const colPanelRef = useRef<HTMLDivElement>(null)
  // Steuert die REIHENFOLGE der Spalten (Aktionen vorne auf dem Handy) —
  // reine Darstellungsunterschiede stehen weiterhin in CSS-Media-Queries.
  const narrow = useIsNarrow()

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
  function toggleCol(key: ColKey) {
    setHiddenCols(prev => { const s = new Set(prev); if (s.has(key)) s.delete(key); else s.add(key); return s })
    setTouchedCols(prev => new Set(prev).add(key))
  }
  // Ein Element, zwei Beobachter: der eine misst, ob Spalten weichen muessen,
  // der andere markiert die Kante an der fixierten Aktionsspalte. Beide sind
  // Callback-Refs, also werden sie hier zu einem zusammengefasst.
  const edgeRef = useScrollEdges<HTMLDivElement>()

  // Reihenfolge = unwichtigste zuerst. Der Hook laesst nur so viele weg, wie
  // noetig sind — auf einem breiten Bildschirm faellt gar nichts weg.
  // Wer eine Spalte im Waehler bewusst anhakt, ist hier ausgenommen.
  const wegfallbar = useMemo(
    () => WEGFALLBAR.filter(k => !touchedCols.has(k) && !hiddenCols.has(k)),
    [touchedCols, hiddenCols],
  )
  const [platzWeg, fitRef] = useFitColumns<ColKey>(wegfallbar, [hiddenCols.size])

  /**
   * Spaltenzahl der Kopfzeile — Grundlage fuer den colSpan der Leerzeile.
   *
   * Vorher stand dort `3 + visibleCols.length` von Hand. Die 3 waren Auswahl,
   * Nummer und Aktionen. Auf dem Handy stimmt das nicht: Dort steht die
   * Aktionsspalte VORNE und ERSETZT die Auswahlspalte, es sind also nur zwei.
   * Gemessen bei 390px: sechs Kopfspalten gegen colSpan 7. Ein zu grosser
   * colSpan spannt eine Phantomspalte auf und verbreitert die Tabelle — auf
   * dem Geraet, auf dem der Platz ohnehin am knappsten ist.
   */
  const setBox = useCallback((el: HTMLDivElement | null) => { fitRef(el); edgeRef(el) }, [fitRef, edgeRef])

  const visibleCols = COLUMNS.filter(c => !hiddenCols.has(c.key) && !platzWeg.has(c.key))
  const platzVersteckt = COLUMNS.filter(c => platzWeg.has(c.key))
  const spaltenZahl = (narrow ? 2 : 3) + visibleCols.length

  /**
   * Inhalt einer Zelle — EINE Quelle fuer die Tabelle UND den Aufklappbereich.
   *
   * Vorher stand die if-Kette direkt im Rumpf und lieferte fertige `<td>`.
   * Damit haette der Aufklappbereich seine Werte ein zweites Mal berechnen
   * muessen, und die beiden waeren mit der Zeit auseinandergelaufen — genau
   * das Muster, das in diesem Projekt schon FilterChip und SortTh vervielfacht
   * hat. Die Funktion liefert deshalb nur den INHALT; wer ihn in `<td>` oder
   * in ein Beschriftung/Wert-Paar setzt, entscheidet die Aufrufstelle.
   */
  function zellInhalt(row: UnifiedRow, key: ColKey): { inhalt: React.ReactNode; className?: string; title?: string } {
    switch (key) {
      case 'typ':  return { inhalt: row.typ }
      case 'date': return { inhalt: fmtDate(row.date), className: 'cell-nowrap' }
      case 'project': return {
        title:  row.project ?? undefined,
        inhalt: row.projectId !== null
          ? <button className="link-btn" style={{ fontSize: 13 }}
              onClick={() => navigate('/projekte', { state: { tab: 'struktur', projectId: row.projectId } })}>
              {row.project ?? '—'}
            </button>
          : (row.project ?? '—'),
      }
      case 'address': return {
        inhalt: row.address
          ? <button className="link-cell" onClick={() => navigate('/adressen', { state: { searchAddress: row.address } })}>{row.address}</button>
          : '—',
      }
      case 'net':   return { inhalt: fmtEur(row.net),   className: 'num' }
      case 'gross': return { inhalt: fmtEur(row.gross), className: 'num' }
      case 'seHeld': {
        if (row.seHeld == null) return { inhalt: '—', className: 'num' }
        const v = row.seHeld
        // Original-AR: positiv → als Abzug "− X" zeigen.
        // Storno-AR:    negativ → als Rückbuchung "+ X" zeigen.
        return { inhalt: v >= 0 ? `− ${fmtEur(v)}` : `+ ${fmtEur(-v)}`, className: 'num' }
      }
      case 'payable': return {
        className: 'num',
        inhalt: row.payable != null && (row.seHeld != null || row.seRelease != null)
          ? <strong>{fmtEur(row.payable)}</strong>
          : fmtEur(row.payable),
      }
      case 'paid': return { inhalt: fmtEur(row.paid), className: 'num' }
      case 'open': return { inhalt: fmtEur(row.open), className: 'num' }
      case 'statusLabel': return {
        inhalt: <>
          <span className={`status-badge ${row.statusClass}`}>{row.statusLabel}</span>
          {row.isOverdue && <span className="status-badge overdue" title={`Fällig: ${row.dueDate}`}>Überfällig</span>}
        </>,
      }
    }
  }

  // ── Aufklappbare Detailzeile ──────────────────────────────────────────
  const detail    = useRowDisclosure()
  const panelIdOf = useDetailPanelId()

  /** Genau die Spalten, die wegen der Fensterbreite entfallen sind — nicht
   *  die, die der Nutzer im Waehler bewusst abgewaehlt hat. */
  function detailFelder(row: UnifiedRow): DetailFeld[] {
    return COLUMNS
      .filter(c => platzWeg.has(c.key))
      .map(c => ({ label: c.label, wert: zellInhalt(row, c.key).inhalt }))
  }
  const [sortKey, setSortKey] = useStickyState<SortKey>('rechnungen.sortKey', 'date')
  const [sortDir, setSortDir] = useStickyState<'asc'|'desc'>('rechnungen.sortDir', 'desc')

  const toast = useToast()
  const [detailRow,     setDetailRow]     = useState<UnifiedRow | null>(null)
  const [confirmState,  setConfirmState]  = useState<{ title: string; message: string; onConfirm: () => void } | null>(null)
  const [stornoState,   setStornoState]   = useState<{ label: string; hasPayments: boolean; payCount: number; payTotal: number; onStorno: (del: boolean) => Promise<void> } | null>(null)
  const [payTarget,     setPayTarget]     = useState<PaymentTarget | null>(null)
  const [payForm,     setPayForm]     = useState(emptyPaymentForm())
  const [payMsg,      setPayMsg]      = useState<{ text: string; type: 'success' | 'error' } | null>(null)
  const [existingPayments, setExistingPayments] = useState<Payment[]>([])
  const [deletingPayId, setDeletingPayId] = useState<number | null>(null)

  // ── Multi-select + Email modal state ─────────────────────────────────────────
  const [selected, setSelected] = useState<Set<string>>(new Set())

  // ── Email modal ───────────────────────────────────────────────────────────────
  const [emailRow,     setEmailRow]     = useState<UnifiedRow | null>(null)
  const [emailTo,      setEmailTo]      = useState('')
  const [emailSubject, setEmailSubject] = useState('')
  const [emailBody,    setEmailBody]    = useState('')
  const [emailMsg,     setEmailMsg]     = useState<{ text: string; type: 'success' | 'error' } | null>(null)
  const [emailLoading, setEmailLoading] = useState(false)

  // E-Mail-Textvorlage des Mandanten (Platzhalter noch unaufgeloest) — sie
  // fuellt den Sammelversand vor. Der Einzelversand nimmt stattdessen die vom
  // Server bereits belegbezogen aufgeloeste Fassung (email-preview).
  const { data: mailTemplates } = useQuery({
    queryKey: ['email-templates'],
    queryFn:  () => fetchEmailTemplates().then(r => r.data),
    staleTime: 5 * 60_000,
  })
  const invoiceTemplate = mailTemplates?.find(t => t.key === 'invoice')
  const stornoTemplate  = mailTemplates?.find(t => t.key === 'invoice_storno')

  function sendMailFor(row: UnifiedRow, payload: { emailTo?: string; emailSubject?: string; emailBody?: string }) {
    const id = (row.raw as Invoice & PartialPayment).ID
    return row.source === 'invoice' ? sendInvoiceEmail(id, payload) : sendPpEmail(id, payload)
  }

  function openEmailFor(row: UnifiedRow) {
    const raw = row.raw as Invoice & PartialPayment
    // Dialog sofort oeffnen und mit den bekannten Werten fuellen; Betreff/Text
    // kommen gleich darauf vom Server nach (dort werden die Platzhalter der
    // Vorlage gegen die Werte dieses Belegs ersetzt).
    setEmailRow(row)
    setEmailTo(raw.CONTACT_MAIL ?? '')
    setEmailSubject('')
    setEmailBody('')
    setEmailMsg(null)
    setEmailLoading(true)
    const load = row.source === 'invoice' ? fetchInvoiceEmailPreview(raw.ID) : fetchPpEmailPreview(raw.ID)
    load
      .then(p => {
        setEmailTo(t => t || p.to)
        setEmailSubject(p.subject)
        setEmailBody(p.body)
      })
      .catch(() => {
        // Vorschau fehlgeschlagen: der Versand greift serverseitig ohnehin auf
        // die Vorlage zurueck — hier nur ein brauchbarer Betreff als Notnagel.
        setEmailSubject(row.source === 'invoice'
          ? `Rechnung ${row.number ?? ''}`
          : `Abschlagsrechnung ${row.number ?? ''}`)
      })
      .finally(() => setEmailLoading(false))
  }

  const sendEmailMut = useMutation({
    mutationFn: ({ row, to, subject, body }: { row: UnifiedRow; to: string; subject: string; body: string }) =>
      sendMailFor(row, { emailTo: to, emailSubject: subject, emailBody: body }),
    onSuccess: () => setEmailMsg({ text: 'E-Mail erfolgreich gesendet.', type: 'success' }),
    onError:   (e: Error) => setEmailMsg({ text: e.message, type: 'error' }),
  })

  // ── Sammelversand ─────────────────────────────────────────────────────────────
  const [batchOpen, setBatchOpen] = useState(false)

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
          `${r.number ?? ''} ${r.typ} ${r.date ?? ''} ${r.project ?? ''} ${r.address ?? ''} ${r.statusLabel}`
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
    net:     rows.reduce((s, r) => s + (r.net     ?? 0), 0),
    gross:   rows.reduce((s, r) => s + (r.gross   ?? 0), 0),
    seHeld:  rows.reduce((s, r) => s + (r.seHeld  ?? 0), 0),
    payable: rows.reduce((s, r) => s + (r.payable ?? 0), 0),
    paid:    rows.reduce((s, r) => s + (r.paid    ?? 0), 0),
    open:    rows.reduce((s, r) => s + (r.open    ?? 0), 0),
  }), [rows])

  function toggleSort(k: SortKey) {
    if (sortKey === k) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortKey(k); setSortDir('asc') }
  }

  // ── Batch selection helpers (depend on rows) ──────────────────────────────────
  const allSelected = rows.length > 0 && rows.every(r => selected.has(r.key))
  function toggleAll() { setSelected(allSelected ? new Set() : new Set(rows.map(r => r.key))) }
  function toggleRowSel(key: string) { setSelected(prev => { const s = new Set(prev); s.has(key) ? s.delete(key) : s.add(key); return s }) }
  function openSelectedPdfs() {
    rows.filter(r => selected.has(r.key))
      .forEach((row, i) => setTimeout(() => openPdf(row), i * 300))
  }

  const selectedSendable = useMemo(
    () => rows.filter(r => selected.has(r.key) && canSendEmail(r)),
    [rows, selected],
  )
  // Der Storno-Text passt nur, wenn wirklich alle ausgewaehlten Belege Stornos
  // sind — sonst gilt die Rechnungsvorlage und der Hinweis unten weist darauf hin.
  const batchAllStorno = selectedSendable.length > 0 && selectedSendable.every(r => r.isStorno)
  const batchMixed     = selectedSendable.some(r => r.isStorno) && selectedSendable.some(r => !r.isStorno)
  const batchItems = useMemo<BatchEmailItem[]>(
    () => selectedSendable.map(r => ({
      key:   r.key,
      label: r.number ?? `#${(r.raw as Invoice & PartialPayment).ID}`,
      sub:   [r.typ, r.address].filter(Boolean).join(' · '),
      to:    (r.raw as Invoice & PartialPayment).CONTACT_MAIL ?? '',
    })),
    [selectedSendable],
  )

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
    // payable = Brutto − einbehaltener SEB + aufgelöster SEB.
    // Wenn SE im Spiel ist, ist der Soll-Zahlbetrag genau payable, NICHT gross.
    setPayTarget({
      source:           row.source,
      id,
      label:            row.number ?? `#${id}`,
      totalGross:       row.payable ?? row.gross,
      paidGross:        row.paid,
      cashDiscountPct:  Number(raw.CASH_DISCOUNT_PERCENT ?? 0),
      cashDiscountDays: Number(raw.CASH_DISCOUNT_DAYS ?? 0),
    })
    const params = row.source === 'invoice' ? { invoice_id: id } : { partial_payment_id: id }
    fetchPayments(params).then(r => setExistingPayments(r.data ?? [])).catch(() => {})
  }

  function handleDeletePayment(payId: number) {
    setConfirmState({
      title: 'Zahlung löschen',
      message: 'Diese Zahlung wirklich löschen?',
      onConfirm: () => actuallyDeletePayment(payId),
    })
  }

  async function actuallyDeletePayment(payId: number) {
    setDeletingPayId(payId)
    try {
      await deletePayment(payId)
      setExistingPayments(prev => prev.filter(p => p.ID !== payId))
      void qc.invalidateQueries({ queryKey: ['invoices'] })
      void qc.invalidateQueries({ queryKey: ['partial-payments'] })
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
    let pays: Payment[] = []
    try {
      const paysRes = row.source === 'invoice'
        ? await fetchPayments({ invoice_id: (row.raw as Invoice).ID })
        : await fetchPayments({ partial_payment_id: (row.raw as PartialPayment).ID })
      pays = paysRes.data ?? []
    } catch { /* proceed without payment info */ }
    const payTotal = pays.reduce((s, p) => s + (p.AMOUNT_PAYED_GROSS ?? 0), 0)

    async function doStorno(deletePayments: boolean) {
      try {
        if (row.source === 'invoice') {
          await cancelInvoice((row.raw as Invoice).ID, { delete_payments: deletePayments })
          void qc.invalidateQueries({ queryKey: ['invoices'] })
          void qc.invalidateQueries({ queryKey: ['partial-payments'] })
        } else {
          await cancelPartialPayment((row.raw as PartialPayment).ID, { delete_payments: deletePayments })
          void qc.invalidateQueries({ queryKey: ['partial-payments'] })
        }
      } catch (e: unknown) {
        toast.error((e as { message?: string })?.message ?? 'Fehler beim Stornieren')
      }
    }

    setStornoState({ label, hasPayments: pays.length > 0, payCount: pays.length, payTotal, onStorno: doStorno })
  }

  function handleDelete(row: UnifiedRow) {
    setConfirmState({
      title: 'Entwurf löschen',
      message: 'Diesen Entwurf wirklich löschen?',
      onConfirm: () => actuallyDelete(row),
    })
  }

  async function actuallyDelete(row: UnifiedRow) {
    try {
      if (row.source === 'invoice') {
        await deleteInvoice((row.raw as Invoice).ID)
        void qc.invalidateQueries({ queryKey: ['invoices'] })
      } else {
        await deletePartialPayment((row.raw as PartialPayment).ID)
        void qc.invalidateQueries({ queryKey: ['partial-payments'] })
      }
    } catch (e: unknown) {
      toast.error((e as { message?: string })?.message ?? 'Fehler beim Löschen')
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

  /** Detailansicht oeffnen. Liegt als Funktion vor, weil der Einstieg an
   *  zwei Stellen haengt: als Knopf in der Zeile (ab Tablet) und als
   *  Eintrag im ⋯-Menue (Handy). */
  function openDetail(row: UnifiedRow) {
    setDetailRow(row)
    const id   = row.source === 'invoice' ? (row.raw as Invoice).ID : (row.raw as PartialPayment).ID
    const type = row.source === 'invoice' ? 'invoice' : 'partial_payment'
    void trackRecent(type, id, [row.number, row.address].filter(Boolean).join(' · ') || `#${id}`).catch(() => {})
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
      toast.error(`XRechnung konnte nicht geladen werden: ${msg}`)
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
      toast.error(`ZUGFeRD konnte nicht geladen werden: ${msg}`)
    }
  }

  async function openPeppol(row: UnifiedRow) {
    try {
      if (row.source === 'invoice') {
        const inv = row.raw as Invoice
        await downloadInvoicePeppol(inv.ID, inv.INVOICE_TYPE, inv.INVOICE_NUMBER)
      } else {
        const pp = row.raw as PartialPayment
        await downloadPpPeppol(pp.ID, pp.PARTIAL_PAYMENT_NUMBER)
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      toast.error(`Peppol-XML konnte nicht geladen werden: ${msg}`)
    }
  }

  async function openHybridPdf(row: UnifiedRow) {
    try {
      if (row.source === 'invoice') {
        const inv = row.raw as Invoice
        await downloadInvoicePdfHybrid(inv.ID, inv.INVOICE_NUMBER)
      } else {
        const pp = row.raw as PartialPayment
        await downloadPpPdfHybrid(pp.ID, pp.PARTIAL_PAYMENT_NUMBER)
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      toast.error(`Hybrid-PDF konnte nicht erzeugt werden: ${msg}`)
    }
  }

  const sp = { sortKey, dir: sortDir, onSort: toggleSort }
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
      {onCreateInvoiceFromBilling && (
        <AbrechenbareProjekte onCreateInvoice={onCreateInvoiceFromBilling} />
      )}
      <RecentList
        type="invoice"
        title="Zuletzt verwendete Rechnungen"
        onSelect={(e) => {
          const row = rows.find(r => r.source === 'invoice' && (r.raw as Invoice).ID === e.ENTITY_ID)
          if (row) setDetailRow(row)
          else     setSearch(e.LABEL ?? '')
        }}
      />

      <div className="pl-toolbar" style={{ marginTop: backProject ? 0 : 10 }}>
        <input type="search"
          className="list-search"
          placeholder="Suchen …"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        {/* Auf dem Handy liegen die Chips hinter „Filter" (siehe FilterBar) —
            die Leiste brauchte dort sonst drei Zeilen. */}
        <FilterBar
          activeCount={activeFilters.status.size + activeFilters.typ.size + (onlyOpen ? 1 : 0)}
          onReset={() => { setActiveFilters(emptyFilters()); setOnlyOpen(false) }}
        >
          <FilterChip label="Status" options={filterOptions.status} active={activeFilters.status} onChange={v => setDimFilter('status', v)} />
          <FilterChip label="Typ"    options={filterOptions.typ}    active={activeFilters.typ}    onChange={v => setDimFilter('typ', v)}    />
          <label className="list-checkbox-label" style={{ fontSize: 12 }}>
            <input type="checkbox" checked={onlyOpen} onChange={e => setOnlyOpen(e.target.checked)} />
            nur offen
          </label>
        </FilterBar>
        <div ref={colPanelRef} className="pl-col-wrap">
          <button className="pl-col-btn" onClick={() => setColPanelOpen(o => !o)} style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><SlidersHorizontal size={13} strokeWidth={2} />Spalten</button>
          {colPanelOpen && (
            <div className="pl-col-panel">
              <div className="pl-col-panel-title">Sichtbare Spalten</div>
              {COLUMNS.map(c => (
                <label key={c.key} className="pl-col-option">
                  <input type="checkbox" checked={!hiddenCols.has(c.key)} onChange={() => toggleCol(c.key)} />
                  {c.label}
                  {/* Ohne diesen Hinweis stuende hier ein Haken bei einer
                      Spalte, die man nicht sieht — die Liste wuerde ueber
                      ihren eigenen Zustand luegen. Anhaken holt sie zurueck. */}
                  {platzWeg.has(c.key) && <span className="pl-col-hint">kein Platz</span>}
                </label>
              ))}
              {platzVersteckt.length > 0 && (
                <div className="pl-col-panel-note">
                  {platzVersteckt.length === 1 ? 'Eine Spalte ist' : `${platzVersteckt.length} Spalten sind`} wegen der
                  Fensterbreite ausgeblendet. Anhaken zeigt sie dauerhaft.
                </div>
              )}
            </div>
          )}
        </div>
        {/* Waehrend des Ladens stand hier „0 Einträge" — eine falsche
            Aussage, die sich auf langsamer Verbindung wie „keine Daten" liest. */}
        <span className="list-info">
          {isLoading
            ? '… Einträge'
            : `${rows.length}${rows.length !== allRows.length ? ` / ${allRows.length}` : ''} Einträge`}
        </span>
      </div>

      {rows.length < allRows.length && (() => {
        const chips: string[] = []
        if (search.trim()) chips.push(`"${search.trim()}"`)
        if (onlyOpen) chips.push('nur offen')
        activeFilters.status.forEach(v => chips.push(v))
        activeFilters.typ.forEach(v => chips.push(v))
        return (
          <div className="filter-summary">
            <span className="filter-summary-count">{rows.length} von {allRows.length}</span>
            {chips.map(c => <span key={c} className="filter-summary-chip">{c}</span>)}
            <button className="filter-summary-clear" onClick={() => { setSearch(''); setOnlyOpen(false); setActiveFilters(emptyFilters()) }}>× Alle löschen</button>
          </div>
        )
      })()}

      {/* Batch toolbar */}
      {selected.size > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 0', fontSize: 13 }}>
          <span style={{ color: 'var(--text-3)' }}>{selected.size} ausgewählt</span>
          <button className="btn btn-sm" onClick={openSelectedPdfs}>
            PDFs öffnen ({selected.size})
          </button>
          <Can permission="invoices.send_email">
            <button
              className="btn btn-sm"
              onClick={() => setBatchOpen(true)}
              disabled={selectedSendable.length === 0}
              title={selectedSendable.length === 0 ? 'Nur gebuchte Rechnungen und Storno-Belege können versendet werden' : undefined}
            >
              <Mail size={13} strokeWidth={1.75} style={{ marginRight: 5, verticalAlign: 'middle' }} />
              Rechnungen versenden ({selectedSendable.length})
            </button>
          </Can>
          <button className="btn btn-sm" style={{ color: 'var(--text-3)' }} onClick={() => setSelected(new Set())}>
            Auswahl aufheben
          </button>
        </div>
      )}

      {isLoading && <ListLoading columns={6} />}
      {!isLoading && (
        <div className="list-section table-scroll" ref={setBox}>
          {/* Diese Tabelle hat so viele Spalten, dass sie auf ueblichen
              Breiten horizontal scrollt — daher die rechts fixierte
              Aktionsspalte. Schmalere Listen bekommen den Modifier nicht. */}
          <table className="master-table master-table--sticky-actions master-table--aufklappbar">
            <thead>
              <tr>
                {/* Auf dem Handy steht die Aktionsspalte VORNE: als letzte
                    Zelle laege sie am Ende einer rund 1200px breiten Tabelle
                    und waere ohne Seitwaerts-Scrollen unerreichbar. Die
                    Mehrfachauswahl entfaellt dort — Sammelaktionen sind eine
                    Schreibtisch-Taetigkeit und kosten sonst 44px Breite. */}
                {narrow
                  ? <th scope="col" className="doc-actions"><span className="sr-only">Aktionen</span></th>
                  : (
                    <th scope="col" style={{ width: 32, padding: '6px 4px' }}>
                      <input type="checkbox" checked={allSelected} onChange={toggleAll} aria-label="Alle auswählen" />
                    </th>
                  )}
                <SortTh label="Nummer" column="number" {...sp} />
                {visibleCols.map(c => (
                  <SortTh key={c.key} label={c.label} column={c.key} {...sp} className={c.className} />
                ))}
                {!narrow && <th scope="col" className="doc-actions"><span className="sr-only">Aktionen</span></th>}
              </tr>
            </thead>
            <tbody>
              {rows.map(row => {
                // Aktionszelle als Variable, weil sie je nach Breite an
                // unterschiedlicher Stelle steht — auf dem Handy vorne,
                // sonst am Zeilenende.
                const actionsCell = (
                    <td className="doc-actions" style={{ whiteSpace: 'nowrap' }}>
                      {/* Ab Tablet stehen „Details" und „PDF" direkt in der Zeile.
                          Auf dem Handy bleibt nur das ⋯-Menue stehen (siehe die
                          gleichnamigen Eintraege darin) — drei Knoepfe belegten
                          dort rund 180px und zwangen zum Seitwaerts-Scrollen.
                          Die jeweils andere Variante ist per CSS ausgeblendet und
                          damit auch aus Tab-Reihenfolge und Screenreader raus. */}
                      {/* Icons statt der Woerter „Details" und „PDF": Das Paar
                          belegte rund 150px, die Icons rund 70. Auf einem
                          1024px-Bildschirm war genau dieser Unterschied der
                          Grund, warum die Tabelle noch ueberlief, nachdem
                          bereits alle entbehrlichen Spalten weggelassen waren.
                          `title` UND `aria-label`, weil das Wort sonst
                          ersatzlos verschwaende — Lucide-Icons sind laut
                          CLAUDE.md ohnehin die Vorgabe (PDF -> FileText). */}
                      <span className="doc-actions-inline">
                        <button className="row-action-btn" onClick={() => openDetail(row)}
                          title="Details" aria-label={`Details zu ${row.number}`}>
                          <Pencil size={14} strokeWidth={1.75} />
                        </button>
                        <Can permission="invoices.download_pdf">
                          <button className="row-action-btn" onClick={() => openPdf(row)}
                            title="PDF" aria-label={`PDF zu ${row.number}`}>
                            <FileText size={14} strokeWidth={1.75} />
                          </button>
                        </Can>
                      </span>
                      {/* „Mail" und „Zahlung" sind ins ⋯-Menue gewandert. Beide
                          erschienen nur unter Bedingungen, wodurch die Aktions-
                          spalte von Zeile zu Zeile ihre Breite wechselte — bei
                          einer rechts fixierten Spalte besonders unruhig. Inline
                          bleibt jetzt immer dasselbe Paar: Details + PDF + ⋯. */}
                      <RowMenu>
                        {/* Nur auf dem Handy sichtbar — dort ersetzen diese
                            beiden die Knoepfe aus der Zeile. */}
                        <button className="row-menu-item row-menu-item--mobile" onClick={() => openDetail(row)}>
                          Details
                        </button>
                        <Can permission="invoices.download_pdf">
                          <button className="row-menu-item row-menu-item--mobile" onClick={() => openPdf(row)}>
                            PDF öffnen
                          </button>
                        </Can>
                        {canSendEmail(row) && (
                          <Can permission="invoices.send_email">
                            <button className="row-menu-item" onClick={() => openEmailFor(row)}>
                              <Mail size={13} strokeWidth={1.75} />Per E-Mail senden
                            </button>
                          </Can>
                        )}
                        {canPay(row) && (
                          <button className="row-menu-item" onClick={() => openPayment(row)}>Zahlung erfassen</button>
                        )}
                        <Can permission="invoices.download_xml">
                          <HasFeature feature="einvoice.xrechnung">
                            <button className="row-menu-item" onClick={() => openXRechnung(row)}>XRechnung</button>
                          </HasFeature>
                          <HasFeature feature="einvoice.zugferd">
                            <button className="row-menu-item" onClick={() => openZUGFeRD(row)}>ZUGFeRD</button>
                          </HasFeature>
                          <HasFeature feature="einvoice.peppol">
                            <button className="row-menu-item" onClick={() => openPeppol(row)}>Peppol BIS 3.0</button>
                          </HasFeature>
                          <HasFeature feature="einvoice.zugferd">
                            <button className="row-menu-item" onClick={() => openHybridPdf(row)}>PDF + ZUGFeRD (hybrid)</button>
                          </HasFeature>
                        </Can>
                        {row.statusClass === 'booked' && (
                          <Can permission="dunning.view">
                            <button className="row-menu-item" onClick={() => navigate('/rechnungen?tab=mahnungen')}>→ Mahnung</button>
                          </Can>
                        )}
                        {canCancel(row) && (
                          <Can permission="invoices.cancel">
                            <button className="row-menu-item danger" onClick={() => handleCancel(row)}>Storno</button>
                          </Can>
                        )}
                        {canDelete(row) && (
                          <Can permission="invoices.delete">
                            <button className="row-menu-item danger" onClick={() => handleDelete(row)}>Löschen</button>
                          </Can>
                        )}
                      </RowMenu>
                    </td>
                )
                const felder  = detailFelder(row)
                const panelId = panelIdOf(row.key)
                const offen   = detail.istOffen(row.key)
                return (
                  // Datenzeile und Detailzeile in EINEM Fragment: Beim
                  // Sortieren wandert der aufgeklappte Zustand mit der Zeile.
                  <Fragment key={row.key}>
                  <tr className={`row-status-${row.statusClass}`}>
                    {narrow && actionsCell}
                    {!narrow && (
                      <td style={{ padding: '4px', textAlign: 'center' }}>
                        <input type="checkbox" checked={selected.has(row.key)} onChange={() => toggleRowSel(row.key)}
                          aria-label={`${row.number ?? 'Zeile'} auswählen`} />
                      </td>
                    )}
                    <td className="cell-nowrap">
                      {/* Der Chevron sitzt IN der Nummernzelle statt in einer
                          eigenen Spalte — die kostete auf Touch 44px und
                          aenderte die Spaltenzahl samt jedem colSpan. */}
                      <RowExpandButton
                        sichtbar={felder.length > 0}
                        offen={offen}
                        onToggle={() => detail.toggle(row.key)}
                        bezeichnung={`Rechnung ${row.number ?? ''}`.trim()}
                        panelId={panelId}
                      />
                      {row.number ?? '—'}
                    </td>
                    {visibleCols.map(c => {
                      const z = zellInhalt(row, c.key)
                      return <td key={c.key} className={z.className} title={z.title}>{z.inhalt}</td>
                    })}
                    {!narrow && actionsCell}
                  </tr>
                  <RowDetailRow offen={offen} panelId={panelId} spalten={spaltenZahl} felder={felder} />
                  </Fragment>
                )
              })}
              {!rows.length && (
                <tr><td colSpan={spaltenZahl} className="empty-note">
                  {(search.trim() || onlyOpen || activeFilters.status.size > 0 || activeFilters.typ.size > 0)
                    ? 'Keine Rechnungen für diese Filter.'
                    : 'Noch keine Rechnungen — erstelle sie über „Abschlagsrechnungen" / „Einzelrechnung" oder direkt aus „Abrechenbare Projekte".'}
                </td></tr>
              )}
            </tbody>
            <tfoot>
              <tr style={{ fontWeight: 600, borderTop: '2px solid var(--border)' }}>
                <td></td>
                <td style={{ fontSize: 13, color: 'var(--text-3)', paddingTop: 6 }}>
                  {rows.length !== allRows.length ? `${rows.length} / ${allRows.length}` : `${allRows.length}`}
                </td>
                {visibleCols.map(c => {
                  if (c.key === 'net')     return <td key={c.key} className="num"><strong>{fmtEur(totals.net)}</strong></td>
                  if (c.key === 'gross')   return <td key={c.key} className="num"><strong>{fmtEur(totals.gross)}</strong></td>
                  if (c.key === 'seHeld') {
                    const v = totals.seHeld
                    const label = v === 0 ? '—' : v > 0 ? `− ${fmtEur(v)}` : `+ ${fmtEur(-v)}`
                    return <td key={c.key} className="num"><strong>{label}</strong></td>
                  }
                  if (c.key === 'payable') return <td key={c.key} className="num"><strong>{fmtEur(totals.payable)}</strong></td>
                  if (c.key === 'paid')    return <td key={c.key} className="num"><strong>{fmtEur(totals.paid)}</strong></td>
                  if (c.key === 'open')    return <td key={c.key} className="num"><strong>{fmtEur(totals.open)}</strong></td>
                  return <td key={c.key}></td>
                })}
                <td></td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      <ConfirmModal
        open={confirmState !== null}
        title={confirmState?.title ?? ''}
        message={confirmState?.message ?? ''}
        confirmLabel="Löschen"
        confirmClass="danger"
        onConfirm={() => { confirmState?.onConfirm(); setConfirmState(null) }}
        onCancel={() => setConfirmState(null)}
      />

      {/* Storno confirmation modal */}
      {stornoState && (
        <Modal open title={`Storno – ${stornoState.label}`} onClose={() => setStornoState(null)}>
          <div style={{ padding: '4px 0 16px' }}>
            {stornoState.hasPayments ? (
              <p>Für <strong>{stornoState.label}</strong> existieren {stornoState.payCount} Zahlung(en) über {FMT_EUR.format(stornoState.payTotal)}.<br />Wie soll storniert werden?</p>
            ) : (
              <p>Stornorechnung für <strong>{stornoState.label}</strong> erstellen?</p>
            )}
          </div>
          <DialogFooter>
            <button type="button" className="btn-secondary" onClick={() => setStornoState(null)}>Abbrechen</button>
            {stornoState.hasPayments && (
              <button type="button" className="btn btn-danger" onClick={() => { void stornoState.onStorno(true); setStornoState(null) }}>
                Stornieren + Zahlungen löschen
              </button>
            )}
            <button type="button" className="btn btn-danger" onClick={() => { void stornoState.onStorno(false); setStornoState(null) }}>
              {stornoState.hasPayments ? 'Nur stornieren' : 'Stornieren'}
            </button>
          </DialogFooter>
        </Modal>
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
            <tr style={{ borderBottom: '1px solid var(--border)' }}>
              <td style={{ padding: '5px 12px 5px 0', fontSize: 13, color: 'var(--text-3)', whiteSpace: 'nowrap' }}>{label}</td>
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
                <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-3)', marginBottom: 4 }}>Beträge</div>
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
                    {detailRow.seHeld != null && detailRow.seHeld > 0 && amtRow('./. Sicherheitseinbehalt', detailRow.seHeld, false, true, true)}
                    {detailRow.seRelease != null && detailRow.seRelease > 0 && amtRow('+ Auflösung Sicherheitseinbehalt', detailRow.seRelease, false, true)}
                    {(detailRow.seHeld != null || detailRow.seRelease != null) && detailRow.payable != null && amtRow('Zahlungsbetrag', detailRow.payable, true)}
                    {detailRow.paid != null && detailRow.paid > 0 && amtRow('Bezahlt', detailRow.paid, false, true, true)}
                    {amtRow('Offene Posten', detailRow.open ?? detailRow.payable ?? adjGross, true)}
                    {cdPct > 0 && (
                      <tr>
                        <td colSpan={2} style={{ paddingTop: 8, fontSize: 12, color: 'var(--text-3)', fontStyle: 'italic' }}>
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
                {canSendEmail(detailRow) && (
                  <button className="btn-small" onClick={() => { setDetailRow(null); openEmailFor(detailRow) }} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><Mail size={13} strokeWidth={1.75} />Per E-Mail senden</button>
                )}
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
                <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-3)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  Bisherige Zahlungen
                </div>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <tbody>
                    {existingPayments.map(p => (
                      <tr key={p.ID} style={{ borderBottom: '1px solid var(--border)' }}>
                        <td style={{ padding: '4px 0', color: 'var(--text-3)' }}>{p.PAYMENT_DATE?.slice(0, 10)}</td>
                        <td style={{ padding: '4px 6px', fontWeight: 500 }}>{fmtEur(p.AMOUNT_PAYED_GROSS)}</td>
                        <td style={{ padding: '4px 0', color: 'var(--text-3)', flex: 1 }}>{p.PURPOSE_OF_PAYMENT ?? ''}</td>
                        <td style={{ padding: '4px 0 4px 8px', textAlign: 'right' }}>
                          <button
                            type="button"
                            title="Zahlung löschen"
                            disabled={deletingPayId === p.ID}
                            onClick={() => handleDeletePayment(p.ID)}
                            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--danger)', fontWeight: 700, fontSize: 16, lineHeight: 1, padding: '0 2px' }}
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
              <div style={{ marginBottom: 12, fontSize: 14, color: 'var(--text-3)', display: 'flex', alignItems: 'center', gap: 10 }}>
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
                  <span style={{ flex: 1, fontSize: 13, color: 'var(--text-2)' }}>
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
            <DialogFooter>
              <button type="button" className="btn-secondary" onClick={() => setPayTarget(null)}>Abbrechen</button>
              <button className="btn-primary" type="submit" disabled={payMut.isPending}>
                {payMut.isPending ? 'Speichert …' : 'Zahlung speichern'}
              </button>
            </DialogFooter>
          </form>
        )}
      </Modal>

      {/* Email modal */}
      <Modal
        open={emailRow !== null}
        onClose={() => { setEmailRow(null); setEmailMsg(null) }}
        title={emailRow ? `E-Mail senden – ${emailRow.number ?? ''}` : ''}
      >
        {emailRow && (
          <div style={{ minWidth: 400 }}>
            <div className="form-group">
              <label className="form-label">An</label>
              <input
                type="email"
                className="form-control"
                value={emailTo}
                onChange={e => setEmailTo(e.target.value)}
                placeholder="empfaenger@beispiel.de"
              />
            </div>
            <div className="form-group">
              <label className="form-label">Betreff</label>
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
                rows={8}
                value={emailBody}
                onChange={e => setEmailBody(e.target.value)}
                placeholder={emailLoading ? 'Lade Textvorlage …' : 'Sehr geehrte Damen und Herren,\nim Anhang finden Sie …'}
              />
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-3)', marginBottom: 10 }}>
              📎 PDF wird automatisch angehängt. Betreff und Text stammen aus der Textvorlage
              (Einstellungen → E-Mail-Versand) und können hier angepasst werden.
            </div>
            {emailMsg && (
              <Message text={emailMsg.text} type={emailMsg.type} />
            )}
            <DialogFooter>
              <button type="button" className="btn-secondary" onClick={() => { setEmailRow(null); setEmailMsg(null) }}>
                Abbrechen
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={sendEmailMut.isPending || emailLoading || !emailTo}
                onClick={() => sendEmailMut.mutate({ row: emailRow, to: emailTo, subject: emailSubject, body: emailBody })}
              >
                {sendEmailMut.isPending ? 'Senden…' : 'Senden'}
              </button>
            </DialogFooter>
          </div>
        )}
      </Modal>

      {/* Sammelversand — nur gemountet, solange offen: so startet jeder Aufruf
          mit frischem Zustand (Empfaenger, Status, Fehler). */}
      {batchOpen && <BatchEmailModal
        title={`Rechnungen versenden (${batchItems.length})`}
        docLabel="Rechnung"
        items={batchItems}
        subject={(batchAllStorno ? stornoTemplate : invoiceTemplate)?.subject ?? '{{belegart}} {{belegnummer}}'}
        body={(batchAllStorno ? stornoTemplate : invoiceTemplate)?.body ?? ''}
        notice={batchMixed
          ? 'Die Auswahl enthält Storno- und normale Belege. Der Text unten gilt für alle — für Stornos besser getrennt versenden, dann greift die Storno-Textvorlage.'
          : undefined}
        onSend={(item, to, subject, body) => {
          const row = selectedSendable.find(r => r.key === item.key)
          if (!row) return Promise.reject(new Error('Rechnung nicht mehr in der Auswahl'))
          return sendMailFor(row, { emailTo: to, emailSubject: subject, emailBody: body })
        }}
        onSent={() => {
          void qc.invalidateQueries({ queryKey: ['invoices'] })
          void qc.invalidateQueries({ queryKey: ['partial-payments'] })
        }}
        onClose={() => setBatchOpen(false)}
      />}
    </div>
  )
}