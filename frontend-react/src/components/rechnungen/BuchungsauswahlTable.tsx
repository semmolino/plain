import { useEffect, useMemo, useRef, useState } from 'react'
import { RotateCcw } from 'lucide-react'
import { InfoHint } from '@/components/ui/InfoHint'
import type { TecEntry } from '@/api/rechnungen'

const FMT_EUR = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' })
const fmtEur  = (v: number | null | undefined) => v == null ? '—' : FMT_EUR.format(v)
const fmtDate = (v: string | null | undefined) => v ? v.slice(0, 10) : '—'

// ── userbezogene Persistenz (wie ProjektlisteTab & andere Listen) ──────────────
function lsGet<T>(key: string, fallback: T): T {
  try { const v = localStorage.getItem(key); return v != null ? JSON.parse(v) as T : fallback } catch { return fallback }
}
function lsPut(key: string, val: unknown) {
  try { localStorage.setItem(key, JSON.stringify(val)) } catch { /* Speicher voll / privater Modus */ }
}

// Ein gemeinsamer Schlüssel für beide Rechnungswizards — die Filtereinstellungen
// beziehen sich auf dieselbe Art von Daten (offene Buchungen) und bleiben so
// über Rechnung und Abschlag hinweg konsistent gespeichert.
const DEFAULT_KEY = 'plain:filt:tec-selection'

// FilterChip — lokal, nach dem projektweiten Muster (siehe HonorarWizard.tsx)
function FilterChip({ label, options, selected, onChange }: {
  label: string
  options: string[]
  selected: Set<string>
  onChange: (next: Set<string>) => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  function toggle(v: string) {
    const next = new Set(selected)
    if (next.has(v)) next.delete(v); else next.add(v)
    onChange(next)
  }

  const hasFilter = selected.size > 0
  return (
    <div className="filter-chip-wrap" ref={ref}>
      <button
        type="button"
        className={`filter-chip-btn${hasFilter ? ' active' : ''}`}
        onClick={() => setOpen(o => !o)}
      >
        {label}{hasFilter ? ` (${selected.size})` : ''} ▾
      </button>
      {open && (
        <div className="filter-chip-dropdown">
          {options.map(v => (
            <label key={v} className="filter-chip-option">
              <input type="checkbox" checked={selected.has(v)} onChange={() => toggle(v)} />
              {v}
            </label>
          ))}
          {options.length === 0 && (
            <span style={{ padding: '6px 10px', fontSize: 12, color: '#9ca3af', display: 'block' }}>Keine Optionen</span>
          )}
          {hasFilter && (
            <div style={{ borderTop: '1px solid var(--border)', marginTop: 4, paddingTop: 4 }}>
              <button type="button" className="filter-chip-option" style={{ color: '#dc2626', width: '100%', textAlign: 'left' }}
                onClick={() => { onChange(new Set()); setOpen(false) }}>
                Zurücksetzen
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

/**
 * BuchungsauswahlTable — Auswahl der abzurechnenden Buchungen (BILLING_TYPE_ID = 2)
 * in den Rechnungswizards (Rechnung & Abschlag).
 *
 * Bietet Filter über der langen Buchungsliste (Suche, Datum von/bis, Mitarbeiter,
 * 0-Beträge ausblenden). Die Filtereinstellungen werden userbezogen im
 * localStorage gespeichert — wie in den übrigen Listen.
 *
 * Wichtig: Filter sind nur eine *Ansicht*. Die Auswahl (`selected`) bleibt beim
 * Filtern erhalten; nur ausgewählte Buchungen werden später abgerechnet.
 */
export function BuchungsauswahlTable({ tecList, selected, setSelected, storageKey = DEFAULT_KEY }: {
  tecList: TecEntry[]
  selected: Set<number>
  setSelected: React.Dispatch<React.SetStateAction<Set<number>>>
  storageKey?: string
}) {
  const [search,   setSearch]   = useState(() => lsGet<string>(`${storageKey}:search`, ''))
  const [dateFrom, setDateFrom] = useState(() => lsGet<string>(`${storageKey}:dateFrom`, ''))
  const [dateTo,   setDateTo]   = useState(() => lsGet<string>(`${storageKey}:dateTo`, ''))
  const [hideZero, setHideZero] = useState(() => lsGet<boolean>(`${storageKey}:hideZero`, false))
  const [empFilter, setEmpFilter] = useState<Set<string>>(() =>
    new Set(lsGet<string[]>(`${storageKey}:emp`, [])))

  useEffect(() => { lsPut(`${storageKey}:search`,   search)   }, [storageKey, search])
  useEffect(() => { lsPut(`${storageKey}:dateFrom`, dateFrom) }, [storageKey, dateFrom])
  useEffect(() => { lsPut(`${storageKey}:dateTo`,   dateTo)   }, [storageKey, dateTo])
  useEffect(() => { lsPut(`${storageKey}:hideZero`, hideZero) }, [storageKey, hideZero])
  useEffect(() => { lsPut(`${storageKey}:emp`,      [...empFilter]) }, [storageKey, empFilter])

  const allEmployees = useMemo(() => {
    const s = new Set<string>()
    tecList.forEach(t => { if (t.EMPLOYEE_SHORT_NAME) s.add(t.EMPLOYEE_SHORT_NAME) })
    return [...s].sort((a, b) => a.localeCompare(b, 'de'))
  }, [tecList])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return tecList.filter(t => {
      if (hideZero && (t.SP_TOT ?? 0) === 0) return false
      if (empFilter.size > 0 && !(t.EMPLOYEE_SHORT_NAME && empFilter.has(t.EMPLOYEE_SHORT_NAME))) return false
      if (dateFrom || dateTo) {
        const d = t.DATE_VOUCHER ? t.DATE_VOUCHER.slice(0, 10) : ''
        if (!d) return false
        if (dateFrom && d < dateFrom) return false
        if (dateTo   && d > dateTo)   return false
      }
      if (q) {
        const hay = `${t.POSTING_DESCRIPTION ?? ''} ${t.EMPLOYEE_SHORT_NAME ?? ''}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [tecList, search, dateFrom, dateTo, hideZero, empFilter])

  const filterActive = !!(search.trim() || dateFrom || dateTo || hideZero || empFilter.size > 0)
  const visibleIds   = useMemo(() => filtered.map(t => t.ID), [filtered])
  const allVisibleSelected = filtered.length > 0 && visibleIds.every(id => selected.has(id))
  // Auswahl/Summe über die *gesamte* Liste — deckt sich mit der Zusammenfassung
  // des Wizards, auch wenn ein Filter Zeilen ausblendet.
  const selectedTotal    = tecList.reduce((n, t) => selected.has(t.ID) ? n + 1 : n, 0)
  const selectedTotalSum = tecList.reduce((s, t) => selected.has(t.ID) ? s + (t.SP_TOT ?? 0) : s, 0)

  function resetFilters() {
    setSearch(''); setDateFrom(''); setDateTo(''); setHideZero(false); setEmpFilter(new Set())
  }

  function toggleTec(id: number) {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  // "Alle" wirkt nur auf die aktuell sichtbaren (gefilterten) Zeilen —
  // die Auswahl ausgeblendeter Buchungen bleibt unangetastet.
  function toggleAllVisible() {
    setSelected(prev => {
      const next = new Set(prev)
      if (allVisibleSelected) visibleIds.forEach(id => next.delete(id))
      else                    visibleIds.forEach(id => next.add(id))
      return next
    })
  }

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, margin: '14px 0 6px' }}>
        <p style={{ margin: 0, fontWeight: 700, fontSize: 14 }}>Buchungen zuweisen</p>
        <InfoHint title="Buchungen filtern">
          Filter sind nur eine Ansicht auf die Liste — sie ändern <strong>nicht</strong>, was abgerechnet
          wird. Abgerechnet werden ausschließlich die <strong>angehakten</strong> Buchungen, auch wenn sie
          durch einen Filter gerade ausgeblendet sind. „Alle" oben in der Tabelle wählt jeweils nur die
          aktuell sichtbaren Zeilen. Die Filtereinstellungen bleiben für dich gespeichert.
        </InfoHint>
      </div>

      {tecList.length === 0 ? (
        <p style={{ fontSize: 13, color: 'rgba(17,24,39,0.45)', margin: '4px 0 8px' }}>
          Keine offenen Buchungen für dieses Projekt vorhanden.
        </p>
      ) : (
        <>
          <div className="list-toolbar">
            <input
              type="search"
              className="list-search"
              placeholder="Beschreibung oder Mitarbeiter suchen …"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
            <input type="date" className="inline-date-input" aria-label="Datum von"
              value={dateFrom} onChange={e => setDateFrom(e.target.value)} />
            <span style={{ fontSize: 13, color: 'var(--text-4)' }}>–</span>
            <input type="date" className="inline-date-input" aria-label="Datum bis"
              value={dateTo} onChange={e => setDateTo(e.target.value)} />
            <FilterChip label="Mitarbeiter" options={allEmployees} selected={empFilter} onChange={setEmpFilter} />
            <label className="list-checkbox-label">
              <input type="checkbox" checked={hideZero} onChange={e => setHideZero(e.target.checked)} />
              0-Beträge ausblenden
            </label>
            {filterActive && (
              <button type="button" className="filter-chip-btn" onClick={resetFilters}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 4, marginLeft: 'auto' }}>
                <RotateCcw size={13} strokeWidth={2} /> Filter zurücksetzen
              </button>
            )}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', margin: '0 0 6px' }}>
            <span className="list-info">
              {filterActive
                ? `${filtered.length} von ${tecList.length} Buchungen`
                : `${tecList.length} Buchungen`}
            </span>
            <span className="list-info">
              {selectedTotal} ausgewählt{selectedTotal > 0 ? ` · ${fmtEur(selectedTotalSum)}` : ''}
            </span>
          </div>

          {filtered.length === 0 ? (
            <p style={{ fontSize: 13, color: 'rgba(17,24,39,0.45)', margin: '4px 0 8px' }}>
              Kein Treffer für die aktuellen Filter.{' '}
              <button type="button" onClick={resetFilters}
                style={{ background: 'none', border: 'none', color: 'var(--accent)', cursor: 'pointer', padding: 0, font: 'inherit' }}>
                Filter zurücksetzen
              </button>
            </p>
          ) : (
            <div className="list-section table-scroll">
              <table className="master-table">
                <thead>
                  <tr>
                    <th><input type="checkbox" checked={allVisibleSelected} onChange={toggleAllVisible}
                      aria-label="Alle sichtbaren auswählen" /></th>
                    <th>Datum</th><th>Mitarbeiter</th><th>Beschreibung</th><th className="num">Betrag €</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(t => (
                    <tr key={t.ID}>
                      <td><input type="checkbox" checked={selected.has(t.ID)} onChange={() => toggleTec(t.ID)} /></td>
                      <td>{fmtDate(t.DATE_VOUCHER)}</td>
                      <td>{t.EMPLOYEE_SHORT_NAME ?? '—'}</td>
                      <td>{t.POSTING_DESCRIPTION}</td>
                      <td className="num">{fmtEur(t.SP_TOT)}</td>
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
