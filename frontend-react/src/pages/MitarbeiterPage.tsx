import { useState, useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Tabs } from '@/components/ui/Tabs'
import { DirtyGuardProvider } from '@/components/ui/DirtyGuard'
import { useGuardedAction } from '@/hooks/useDirtyGuard'
import { useToast } from '@/store/toastStore'
import { AlertTriangle } from 'lucide-react'
import { useFilterTabs, usePermission } from '@/store/permissionsStore'
import { useLicenseFilterTabs } from '@/store/licenseStore'
import { fetchEmployeeList, type Employee } from '@/api/mitarbeiter'
import { fetchArbzgAudit, downloadArbzgAuditCsv, type AuditEntry, type ArbzgSeverity } from '@/api/arbzg'
import { localIso, todayLocal } from '@/pages/mitarbeiter/mitarbeiterFormat'
import { MitarbeiterListe } from '@/pages/mitarbeiter/MitarbeiterListe'
import { Stundencontrolling } from '@/pages/mitarbeiter/Stundencontrolling'
import { AbwesenheitenTab } from '@/pages/mitarbeiter/AbwesenheitenTab'

// ── Constants ─────────────────────────────────────────────────────────────────

const TABS: { id: string; label: string; permissions: string[]; feature?: string }[] = [
  { id: 'list',          label: 'Mitarbeiter',           permissions: ['employees.view'] },
  { id: 'zeitwirtschaft', label: 'Stundencontrolling',   permissions: ['employees.bookings.view_all','employees.month_close.edit'] },
  { id: 'abwesenheiten', label: 'Abwesenheiten',         permissions: ['absence.view','absence.request'] },
  { id: 'arbzg',         label: 'Arbeitszeit (Details)', permissions: ['employees.bookings.view_all'], feature: 'arbzg.compliance' },
]

// ── ArbZG-Auditlog ────────────────────────────────────────────────────────────

const EVENT_TYPES = [
  { value: '',                    label: '— alle Ereignisse —' },
  { value: 'BOOKING_CONFIRMED',   label: 'Buchung freigegeben' },
  { value: 'OVER_8H',             label: '> 8 Stunden (§ 16 Abs. 2)' },
  { value: 'OVER_10H',            label: '> 10 Stunden (§ 3 ArbZG)' },
  { value: 'OVER_8H_MINOR',       label: '> 8 Stunden (U18, JArbSchG)' },
  { value: 'BREAK_MISSING',       label: 'Pflichtpause fehlt' },
  { value: 'REST_LT_11H',         label: 'Ruhezeit unterschritten' },
  { value: 'SUNDAY_WORK',         label: 'Sonntagsarbeit' },
  { value: 'HOLIDAY_WORK',        label: 'Feiertagsarbeit' },
  { value: 'PAUSE_AUTO_DEDUCT',   label: 'Auto-Pausenabzug' },
  { value: 'MANUAL_OVERRIDE',     label: 'Manueller Override' },
]
const SEVERITIES: Array<{ value: '' | ArbzgSeverity; label: string }> = [
  { value: '',      label: '— alle —' },
  { value: 'INFO',  label: 'Info' },
  { value: 'WARN',  label: 'Warnung' },
  { value: 'BLOCK', label: 'Blockade' },
]
const EVENT_LABEL: Record<string, string> = Object.fromEntries(
  EVENT_TYPES.filter(e => e.value).map(e => [e.value, e.label])
)

function sevBadge(s: ArbzgSeverity) {
  const style: Record<ArbzgSeverity, React.CSSProperties> = {
    INFO:  { background: 'rgba(59,130,246,0.12)',  color: 'var(--info)' },
    WARN:  { background: 'rgba(245,158,11,0.15)',  color: 'var(--warning-strong)' },
    BLOCK: { background: 'rgba(220,38,38,0.13)',   color: 'var(--danger-strong)' },
  }
  return (
    <span style={{ ...style[s], display: 'inline-block', padding: '2px 8px',
                    borderRadius: 10, fontSize: 11, fontWeight: 600 }}>
      {s}
    </span>
  )
}

function ArbzgAuditTab({ employees }: { employees: Employee[] }) {
  const [empId,    setEmpId]    = useState<number | ''>('')
  const [dateFrom, setDateFrom] = useState<string>(() => {
    const d = new Date(); d.setDate(d.getDate() - 30)
    return localIso(d)
  })
  const [dateTo,   setDateTo]   = useState<string>(todayLocal)
  const [evtType,  setEvtType]  = useState<string>('')
  const [sev,      setSev]      = useState<'' | ArbzgSeverity>('')

  const params = useMemo(() => ({
    employee_id: empId === '' ? undefined : Number(empId),
    date_from:   dateFrom || undefined,
    date_to:     dateTo   || undefined,
    event_type:  evtType  || undefined,
    severity:    sev      || undefined,
  }), [empId, dateFrom, dateTo, evtType, sev])

  const { data, isLoading } = useQuery({
    queryKey: ['arbzg-audit', params],
    queryFn:  () => fetchArbzgAudit(params),
  })

  const rows: AuditEntry[] = data?.data ?? []
  const warning = data?.warning

  const empMap = useMemo(() => new Map(employees.map(e => [e.ID, e])), [employees])

  function fmtDateTime(s: string) {
    const d = new Date(s)
    return isNaN(d.getTime()) ? s : d.toLocaleString('de-DE')
  }
  function fmtDate(s: string) {
    return new Date(s).toLocaleDateString('de-DE')
  }
  function fmtDetails(d: Record<string, unknown>) {
    if (!d) return '—'
    const parts: string[] = []
    const hHum = (n: number) => `${n.toFixed(2).replace('.', ',')} h`

    // entryKind + quantityInt zusammen als "X h Projektzeit" / "X h Pause" zeigen
    const entryKind   = d.entryKind
    const quantityInt = typeof d.quantityInt === 'number' ? d.quantityInt : null
    if (entryKind === 'BREAK') {
      parts.push(quantityInt != null && quantityInt > 0 ? `${hHum(quantityInt)} Pause` : 'Pause-Block')
    } else if (entryKind === 'WORK') {
      parts.push(quantityInt != null && quantityInt > 0 ? `${hHum(quantityInt)} Projektzeit` : 'Arbeitsblock')
    } else if (quantityInt != null && quantityInt > 0) {
      parts.push(`${hHum(quantityInt)}`)
    }

    // ArbZG-spezifische Felder
    if (typeof d.dayTotal === 'number')   parts.push(`Tagessumme ${hHum(d.dayTotal as number)}`)
    if (typeof d.dayWork === 'number')    parts.push(`Arbeit heute ${hHum(d.dayWork as number)}`)
    if (typeof d.max === 'number')        parts.push(`Maximum ${d.max} h`)
    if (typeof d.required === 'number')   parts.push(`erforderlich ${d.required} min`)
    if (typeof d.current === 'number')    parts.push(`erfasst ${d.current} min`)
    if (typeof d.breakRule === 'string')  parts.push(`Pausenregel: ${d.breakRule}`)
    if (typeof d.restHours === 'number')  parts.push(`Ruhezeit ${(d.restHours as number).toFixed(1).replace('.', ',')} h`)
    if (typeof d.deductedMin === 'number') parts.push(`Auto-Abzug ${d.deductedMin} min`)

    const kind = d.kind
    if (typeof kind === 'string') {
      if (kind === 'BREAK_TAKEN_UNRECORDED') parts.push('Pause nachgetragen')
      else if (kind === 'ACCEPT_AUTO_DEDUCT') parts.push('Auto-Abzug akzeptiert')
      // andere kind-Werte bewusst weggelassen — keine DB-Rohformate
    }

    return parts.length > 0 ? parts.join(' · ') : '—'
  }

  const toast = useToast()
  async function handleExport() {
    try {
      await downloadArbzgAuditCsv({
        employee_id: empId === '' ? undefined : Number(empId),
        date_from:   dateFrom || undefined,
        date_to:     dateTo   || undefined,
        event_type:  evtType  || undefined,
        severity:    sev      || undefined,
      })
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  return (
    <div style={{ maxWidth: 1100 }}>
      <p className="admin-section-hint" style={{ marginBottom: 14 }}>
        Audit-Log der ArbZG-Ereignisse — Pflichtarchiv nach § 16 Abs. 2 ArbZG (2 Jahre).
        Datensätze sind gegen Löschen und Manipulation geschützt.
      </p>

      <div className="pl-toolbar" style={{ marginBottom: 12 }}>
        <select className="list-search" value={empId}
          onChange={e => setEmpId(e.target.value === '' ? '' : Number(e.target.value))}
          style={{ minWidth: 200, maxWidth: 240 }}>
          <option value="">— Alle Mitarbeiter —</option>
          {employees.map(e => <option key={e.ID} value={e.ID}>{e.ABBR} – {e.FIRST_NAME} {e.LAST_NAME}</option>)}
        </select>
        <label style={{ fontSize: 12 }}>Von
          <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
            style={{ marginLeft: 4 }} />
        </label>
        <label style={{ fontSize: 12 }}>Bis
          <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
            style={{ marginLeft: 4 }} />
        </label>
        <select value={evtType} onChange={e => setEvtType(e.target.value)}
          style={{ fontSize: 12, padding: '4px 8px', borderRadius: 6, border: '1px solid var(--border)' }}>
          {EVENT_TYPES.map(e => <option key={e.value} value={e.value}>{e.label}</option>)}
        </select>
        <select value={sev} onChange={e => setSev(e.target.value as '' | ArbzgSeverity)}
          style={{ fontSize: 12, padding: '4px 8px', borderRadius: 6, border: '1px solid var(--border)' }}>
          {SEVERITIES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>
        <button type="button" className="btn-small btn-save"
          style={{ marginLeft: 'auto' }} onClick={handleExport}>
          ↓ CSV-Export
        </button>
      </div>

      {warning && (
        <p className="ta-note" style={{ marginBottom: 12 }}>
          <AlertTriangle size={13} strokeWidth={2} aria-hidden="true" />{warning}
        </p>
      )}

      {isLoading && <p className="empty-note">Laden…</p>}

      {!isLoading && rows.length === 0 && !warning && (
        <p className="empty-note">Keine Einträge für die gewählten Filter.</p>
      )}

      {!isLoading && rows.length > 0 && (
        <div className="list-section table-scroll">
          <table className="master-table">
            <thead>
              <tr>
                <th scope="col">Mitarbeiter</th>
                <th scope="col">Datum</th>
                <th scope="col">Ereignis</th>
                <th scope="col">Schwere</th>
                <th scope="col">Details</th>
                <th scope="col">Erfasst</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => {
                const emp = empMap.get(r.EMPLOYEE_ID)
                return (
                  <tr key={r.ID}>
                    <td>
                      <strong>{emp?.ABBR ?? `#${r.EMPLOYEE_ID}`}</strong>
                      {emp && <span style={{ display: 'block', fontSize: 11, color: 'var(--text-3)' }}>
                        {emp.FIRST_NAME} {emp.LAST_NAME}
                      </span>}
                    </td>
                    <td>{fmtDate(r.BOOKING_DATE)}</td>
                    <td>{EVENT_LABEL[r.EVENT_TYPE] ?? r.EVENT_TYPE}</td>
                    <td>{sevBadge(r.SEVERITY)}</td>
                    <td style={{ fontSize: 12, color: 'var(--text-2)' }}>{fmtDetails(r.DETAILS || {})}</td>
                    <td style={{ fontSize: 11, color: 'var(--text-3)', whiteSpace: 'nowrap' }}>
                      {fmtDateTime(r.CREATED_AT)}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {rows.length > 0 && (
        <p style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 8 }}>
          {rows.length} Einträge · limitiert auf 1.000 — bei mehr Treffern Filter verfeinern.
        </p>
      )}
    </div>
  )
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export function MitarbeiterPage() {
  // Runde 11: Unterreiter mit offenen Eingaben (Urlaubsansprüche) fragen
  // beim Wechsel nach — vorher waren die Eingaben still weg.
  return (
    <DirtyGuardProvider>
      <MitarbeiterPageInner />
    </DirtyGuardProvider>
  )
}

function MitarbeiterPageInner() {
  const [searchParams, setSearchParams] = useSearchParams()
  const guarded = useGuardedAction()

  // Die Liste braucht employees.view. Nutzer, die nur eigene Abwesenheiten
  // beantragen (absence.request), erreichen die Seite ebenfalls — für sie
  // gaten wir ab, sonst lösen die 403 den globalen Fehler-Toast aus.
  const canViewEmployees = usePermission('employees.view')
  const { data: listData, isLoading } = useQuery({ queryKey: ['employees'], queryFn: fetchEmployeeList, enabled: canViewEmployees })
  const employees = listData?.data ?? []

  const visibleTabs = useLicenseFilterTabs(useFilterTabs(TABS))
  // Der Reiter steht in der URL (?tab=…); fehlt er oder ist er nicht
  // freigegeben, gilt der erste sichtbare.
  const urlTab = searchParams.get('tab')
  const tab = urlTab && visibleTabs.some(t => t.id === urlTab) ? urlTab : (visibleTabs[0]?.id ?? 'list')
  function changeTab(t: string) {
    if (t === tab) return
    guarded(() => {
      // Unterreiter und Auswahl gehören zum alten Reiter.
      const p = new URLSearchParams()
      if (t !== 'list') p.set('tab', t)
      setSearchParams(p, { replace: true })
    })
  }

  return (
    <div className="master-page">
      <h1 className="sr-only">Mitarbeiter</h1>
      <Tabs tabs={visibleTabs} active={tab} onChange={changeTab} />

      <div className="master-section">
        {tab === 'list' && <MitarbeiterListe employees={employees} isLoading={isLoading} />}
        {tab === 'zeitwirtschaft' && <Stundencontrolling employees={employees} onGoToList={() => changeTab('list')} />}
        {tab === 'abwesenheiten' && <AbwesenheitenTab employees={employees} />}
        {tab === 'arbzg' && <ArbzgAuditTab employees={employees} />}
      </div>
    </div>
  )
}
