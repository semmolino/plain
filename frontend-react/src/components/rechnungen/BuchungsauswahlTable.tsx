import { useMemo, useState } from 'react'
import { RotateCcw } from 'lucide-react'
import { FilterChip } from '@/components/ui/FilterChip'
import { HelpHint } from '@/components/ui/HelpHint'
import { SortTh } from '@/components/ui/SortTh'
import type { LastInvoice, TecEntry } from '@/api/rechnungen'
import { useStickyState } from '@/hooks/useStickyState'
import { fmtEur, money } from '@/utils/money'
import { fmtDateDe, fmtHours } from '@/utils/zeit'
import {
  billable, filterBookings, idsOf, isZeroBooking, loadPrefs, outsidePeriod, savePref, sortBookings, sortKeyOr,
  summarize, toggleRows, triState, withZeros, PREFS_KEY,
  type BookingPrefs, type BookingSortKey, type Period, type TriState,
} from './buchungsauswahl'

const KIND_LABEL: Record<string, string> = {
  abschlag: 'Abschlagsrechnung', rechnung: 'Rechnung',
  schlussrechnung: 'Schlussrechnung', teilschlussrechnung: 'Teilschlussrechnung',
}

function lastInvoiceTitle(li: LastInvoice): string {
  const doc = `${KIND_LABEL[li.kind] ?? 'Rechnung'} ${li.number ?? ''}`.trim()
  return li.period_end
    ? `${doc}, Leistungszeitraum bis ${fmtDateDe(li.period_end)}`
    : `${doc} vom ${fmtDateDe(li.date)}`
}

function periodLabel(p: Period): string {
  if (p.start && p.end) return `${fmtDateDe(p.start)} – ${fmtDateDe(p.end)}`
  return p.start ? `ab ${fmtDateDe(p.start)}` : `bis ${fmtDateDe(p.end)}`
}

/** Häkchen mit Zwischenzustand („teils gewählt"). */
function TriCheckbox({ state, onChange, label, disabled }: {
  state: TriState; onChange: () => void; label?: string; disabled?: boolean
}) {
  return (
    <input
      type="checkbox"
      ref={el => { if (el) el.indeterminate = state === 'some' }}
      checked={state === 'all'}
      onChange={onChange}
      aria-label={label}
      disabled={disabled}
    />
  )
}

/**
 * BuchungsauswahlTable — Auswahl der abzurechnenden Buchungen (BILLING_TYPE_ID = 2)
 * in den Rechnungsassistenten (Abschlag, Einzelrechnung, Rechnungskorrektur).
 *
 * Oben die Filter — eine Ansicht, sie ändern nicht, was abgerechnet wird.
 * Darunter die Auswahl: „Alle Buchungen", „0-Beträge mitabrechnen" und
 * „Nur sichtbare auswählen", die einzige Brücke von der Ansicht zur Auswahl.
 * Was ausgewählt, aber ausgeblendet ist, sagt die Zählzeile — vorher wurde es
 * still mit abgerechnet.
 *
 * Über Rechnungen hinweg gemerkt werden nur Vorlieben (0-Beträge, „Seit letzter
 * Rechnung"); Suche, Datum, Mitarbeiter und Leistung gelten für diese Rechnung.
 * Logik und Begründungen: `buchungsauswahl.ts`.
 */
export function BuchungsauswahlTable({
  tecList, selected, setSelected, lastInvoice = null, periodStart = '', periodEnd = '', storageKey = PREFS_KEY,
}: {
  tecList: TecEntry[]
  selected: Set<number>
  setSelected: React.Dispatch<React.SetStateAction<Set<number>>>
  /** Letzte gebuchte Rechnung des Vertrags — ohne sie gibt es den Filter „Seit letzter Rechnung" nicht. */
  lastInvoice?: LastInvoice | null
  /** Leistungszeitraum dieser Rechnung (YYYY-MM-DD) */
  periodStart?: string
  periodEnd?: string
  storageKey?: string
}) {
  const [prefs, setPrefs] = useState<BookingPrefs>(() => loadPrefs(storageKey))
  function setPref(name: keyof BookingPrefs, value: boolean) {
    setPrefs(p => ({ ...p, [name]: value }))
    savePref(storageKey, name, value)
  }

  const [search,       setSearch]       = useState('')
  const [dateFrom,     setDateFrom]     = useState('')
  const [dateTo,       setDateTo]       = useState('')
  const [empFilter,    setEmpFilter]    = useState<Set<string>>(() => new Set())
  const [structFilter, setStructFilter] = useState<Set<string>>(() => new Set())
  const [inPeriodOnly, setInPeriodOnly] = useState(false)

  const period = useMemo<Period | null>(
    () => (periodStart || periodEnd ? { start: periodStart, end: periodEnd } : null),
    [periodStart, periodEnd])

  const allEmployees = useMemo(() => {
    const s = new Set<string>()
    tecList.forEach(t => { if (t.EMPLOYEE_SHORT_NAME) s.add(t.EMPLOYEE_SHORT_NAME) })
    return [...s].sort((a, b) => a.localeCompare(b, 'de'))
  }, [tecList])

  const allStructures = useMemo(() => {
    const s = new Set<string>()
    tecList.forEach(t => { if (t.STRUCTURE_LABEL) s.add(t.STRUCTURE_LABEL) })
    return [...s].sort((a, b) => a.localeCompare(b, 'de', { numeric: true }))
  }, [tecList])
  const manyStructures = allStructures.length > 1

  const zeroCount = useMemo(() => tecList.filter(isZeroBooking).length, [tecList])

  const sinceActive  = prefs.sinceLast && !!lastInvoice
  const periodActive = inPeriodOnly && !!period

  const filtered = useMemo(() => filterBookings(tecList, {
    search, dateFrom, dateTo, employees: empFilter, structures: structFilter, hideZero: prefs.hideZero,
    since:  sinceActive && lastInvoice ? lastInvoice.since : null,
    period: periodActive ? period : null,
  }), [tecList, search, dateFrom, dateTo, empFilter, structFilter, prefs.hideZero, sinceActive, lastInvoice, periodActive, period])

  // Sortieren ist eine Vorliebe wie in den anderen Listen — sie blendet nichts aus.
  const [sortKeyRaw, setSortKey] = useStickyState<BookingSortKey>('buchungsauswahl.sortKey', 'BOOKING_DATE')
  const [sortDir,    setSortDir] = useStickyState<'asc' | 'desc'>('buchungsauswahl.sortDir', 'asc')
  const sortKey = sortKeyOr(sortKeyRaw)
  const rows = useMemo(() => sortBookings(filtered, sortKey, sortDir), [filtered, sortKey, sortDir])
  function toggleSort(k: BookingSortKey) {
    if (sortKey === k) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortKey(k); setSortDir('asc') }
  }
  const sp = { sortKey, dir: sortDir, onSort: toggleSort }

  const filterActive = !!(search.trim() || dateFrom || dateTo || empFilter.size > 0 || structFilter.size > 0
    || prefs.hideZero || sinceActive || periodActive)
  const visibleIds   = useMemo(() => idsOf(filtered), [filtered])
  // Auswahl und Summe über die *ganze* Liste — deckt sich mit der Zusammenfassung des Assistenten.
  const summary      = summarize(tecList, selected, visibleIds)
  const allState     = triState(tecList, selected, prefs.includeZero)
  const visibleState = triState(filtered, selected, prefs.includeZero)
  const outside      = outsidePeriod(tecList, selected, period)

  function resetFilters() {
    setSearch(''); setDateFrom(''); setDateTo(''); setEmpFilter(new Set()); setStructFilter(new Set())
    setInPeriodOnly(false)
    if (prefs.hideZero)  setPref('hideZero', false)
    if (prefs.sinceLast) setPref('sinceLast', false)
  }

  function toggleTec(id: number) {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  const toggleAll         = () => setSelected(allState === 'all' ? new Set() : idsOf(billable(tecList, prefs.includeZero)))
  const toggleVisible     = () => setSelected(prev => toggleRows(prev, filtered, prefs.includeZero))
  const selectOnlyVisible = () => setSelected(idsOf(billable(filtered, prefs.includeZero)))
  const deselectOutside   = () => setSelected(prev => {
    const next = new Set(prev)
    outside.forEach(t => next.delete(t.ID))
    return next
  })
  function setIncludeZero(include: boolean) {
    setPref('includeZero', include)
    setSelected(prev => withZeros(prev, tecList, include))
  }

  return (
    <>
      <p className="ba-title">Buchungen zuweisen <HelpHint id="invoice.buchungsauswahl" /></p>

      {tecList.length === 0 ? (
        <p className="ba-empty">Keine offenen Buchungen für dieses Projekt vorhanden.</p>
      ) : (
        <>
          {/* Filter: eine Ansicht auf die Liste */}
          <div className="list-toolbar">
            <input
              type="search"
              className="list-search"
              placeholder="Buchungen suchen …"
              aria-label="Buchungen suchen (Beschreibung, Mitarbeiter, Leistung)"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
            <input type="date" className="inline-date-input" aria-label="Datum von"
              value={dateFrom} onChange={e => setDateFrom(e.target.value)} />
            <span className="ba-muted">–</span>
            <input type="date" className="inline-date-input" aria-label="Datum bis"
              value={dateTo} onChange={e => setDateTo(e.target.value)} />
            <FilterChip label="Mitarbeiter" options={allEmployees} active={empFilter} onChange={setEmpFilter} />
            {manyStructures && (
              <FilterChip label="Leistung" options={allStructures} active={structFilter} onChange={setStructFilter} />
            )}
            {lastInvoice && (
              <label className="list-checkbox-label" title={lastInvoiceTitle(lastInvoice)}>
                <input type="checkbox" checked={prefs.sinceLast} onChange={e => setPref('sinceLast', e.target.checked)} />
                Seit letzter Rechnung <span className="ba-muted">(nach {fmtDateDe(lastInvoice.since)})</span>
              </label>
            )}
            {period && (
              <label className="list-checkbox-label">
                <input type="checkbox" checked={inPeriodOnly} onChange={e => setInPeriodOnly(e.target.checked)} />
                Im Leistungszeitraum <span className="ba-muted">({periodLabel(period)})</span>
              </label>
            )}
            <label className="list-checkbox-label">
              <input type="checkbox" checked={prefs.hideZero} onChange={e => setPref('hideZero', e.target.checked)} />
              0-Beträge ausblenden
            </label>
            {filterActive && (
              <button type="button" className="filter-chip-btn ba-reset" onClick={resetFilters}>
                <RotateCcw size={13} strokeWidth={2} aria-hidden="true" /> Filter zurücksetzen
              </button>
            )}
          </div>

          {/* Auswahl: das wird abgerechnet */}
          <div className="ba-bar" role="group" aria-label="Auswahl der Buchungen">
            <label className="ba-check">
              <TriCheckbox state={allState} onChange={toggleAll} />
              Alle Buchungen
            </label>
            {zeroCount > 0 && (
              <label className="ba-check">
                <input type="checkbox" checked={prefs.includeZero} onChange={e => setIncludeZero(e.target.checked)} />
                0-Beträge mitabrechnen <span className="ba-muted">({zeroCount})</span>
              </label>
            )}
            {filterActive && filtered.length > 0 && (
              <button type="button" className="filter-chip-btn" onClick={selectOnlyVisible}>
                Nur sichtbare auswählen
              </button>
            )}
          </div>
          <p className="list-info ba-summary" aria-live="polite">
            <span>{filterActive ? `${filtered.length} von ${tecList.length} sichtbar` : `${tecList.length} Buchungen`}</span>
            <span>· {summary.count} ausgewählt</span>
            {summary.count > 0 && summary.hours > 0 && <span>· {fmtHours(summary.hours)} h</span>}
            {summary.count > 0 && <span>· {fmtEur(summary.amount)}</span>}
            {summary.hidden > 0 && (
              <span className="ba-hidden">· davon {summary.hidden} ausgeblendet – werden mit abgerechnet</span>
            )}
          </p>
          {outside.length > 0 && period && (
            <p className="ba-warn">
              <span>
                {outside.length === 1 ? '1 ausgewählte Buchung liegt' : `${outside.length} ausgewählte Buchungen liegen`}
                {' '}außerhalb des Leistungszeitraums ({periodLabel(period)}).
              </span>
              <button type="button" className="link-btn" onClick={deselectOutside}>Abwählen</button>
            </p>
          )}

          {filtered.length === 0 ? (
            <p className="ba-empty">
              Kein Treffer für die aktuellen Filter.{' '}
              <button type="button" className="link-btn" onClick={resetFilters}>Filter zurücksetzen</button>
            </p>
          ) : (
            <div className="list-section table-scroll">
              <table className="master-table ba-table">
                <thead>
                  <tr>
                    <th scope="col">
                      <TriCheckbox state={visibleState} onChange={toggleVisible} label="Alle sichtbaren auswählen" />
                    </th>
                    <SortTh label="Datum"        column="BOOKING_DATE"        {...sp} />
                    <SortTh label="Mitarbeiter"  column="EMPLOYEE_SHORT_NAME" {...sp} className="ba-wide" />
                    <SortTh label="Beschreibung" column="POSTING_DESCRIPTION" {...sp} />
                    <SortTh label="Std."         column="HOURS"               {...sp} className="num ba-wide" />
                    <SortTh label="Betrag €"     column="HOURLY_RATE_TOTAL"   {...sp} className="num" />
                  </tr>
                </thead>
                <tbody>
                  {rows.map(t => (
                    <tr key={t.ID}>
                      <td>
                        <input type="checkbox" checked={selected.has(t.ID)} onChange={() => toggleTec(t.ID)}
                          aria-label={`${fmtDateDe(t.BOOKING_DATE)} ${t.POSTING_DESCRIPTION ?? ''} auswählen`.trim()} />
                      </td>
                      <td className="ba-date">{fmtDateDe(t.BOOKING_DATE) || '—'}</td>
                      <td className="ba-wide">{t.EMPLOYEE_SHORT_NAME || '—'}</td>
                      <td>
                        {t.POSTING_DESCRIPTION}
                        {manyStructures && t.STRUCTURE_LABEL && <span className="ba-structure">{t.STRUCTURE_LABEL}</span>}
                        {/* Am Handy statt der Spalten Mitarbeiter und Std. — sonst fiel der Betrag aus dem Bild. */}
                        <span className="ba-meta-narrow">
                          {[t.EMPLOYEE_SHORT_NAME, t.HOURS == null ? null : `${fmtHours(t.HOURS)} h`].filter(Boolean).join(' · ')}
                        </span>
                      </td>
                      <td className="num ba-wide">{t.HOURS == null ? '—' : fmtHours(t.HOURS)}</td>
                      <td className="num">{money(t.HOURLY_RATE_TOTAL)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </>
  )
}
