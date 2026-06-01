import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { TrendingUp, Users, Clock, CalendarRange, BarChart3, AlertCircle } from 'lucide-react'
import { fetchCompanyKpis, type CompanyKpiResult } from '@/api/reports'

const FMT_EUR  = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 })
const FMT_EURK = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2, maximumFractionDigits: 2 })
const FMT_NUM  = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 1 })
const fmtEur   = (v: number | null) => v == null ? '–' : FMT_EUR.format(v)
const fmtEurK  = (v: number | null) => v == null ? '–' : FMT_EURK.format(v)
const fmtPct   = (v: number | null) => v == null ? '–' : `${FMT_NUM.format(v)} %`
const fmtH     = (v: number | null) => v == null ? '–' : `${FMT_NUM.format(v)} h`
const fmtM     = (v: number | null) => v == null ? '–' : `${FMT_NUM.format(v)} Mon.`

const CURRENT_YEAR = new Date().getFullYear()
const YEAR_OPTIONS = Array.from({ length: 6 }, (_, i) => CURRENT_YEAR - i)

// ── KPI card ──────────────────────────────────────────────────────────────────

interface KpiCardProps {
  label:       string
  value:       string
  formula:     string
  note?:       string
  unavailable?: string
  icon:        React.ReactNode
  highlight?:  'good' | 'warn' | 'bad' | 'neutral'
}

function KpiCard({ label, value, formula, note, unavailable, icon, highlight = 'neutral' }: KpiCardProps) {
  const highlightClass = unavailable ? 'unk-card--na' :
    highlight === 'good' ? 'unk-card--good' :
    highlight === 'warn' ? 'unk-card--warn' :
    highlight === 'bad'  ? 'unk-card--bad'  : ''

  return (
    <div className={`unk-card ${highlightClass}`}>
      <div className="unk-card-icon">{icon}</div>
      <div className="unk-card-body">
        <div className="unk-card-label">{label}</div>
        {unavailable
          ? <div className="unk-card-na">Nicht berechenbar</div>
          : <div className="unk-card-value">{value}</div>
        }
        <div className="unk-card-formula">{unavailable ?? formula}</div>
        {note && !unavailable && <div className="unk-card-note"><AlertCircle size={11} strokeWidth={2} style={{ marginRight: 3, verticalAlign: 'middle' }} />{note}</div>}
      </div>
    </div>
  )
}

// ── Base data strip ───────────────────────────────────────────────────────────

function BaseDataRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="unk-base-row">
      <span className="unk-base-label">{label}</span>
      <span className="unk-base-value">{value}</span>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export function UnternehmenskennzahlenTab() {
  const [year, setYear] = useState(CURRENT_YEAR)

  const { data, isLoading, error } = useQuery({
    queryKey: ['company-kpis', year],
    queryFn:  () => fetchCompanyKpis(year).then(r => r.data),
  })

  const kpi  = data  // CompanyKpiResult | undefined
  const raw  = kpi?.raw
  const kpis = kpi?.kpis

  // Heuristic quality indicators
  function dbMargeHighlight(v: number | null): 'good' | 'warn' | 'bad' | 'neutral' {
    if (v == null) return 'neutral'
    if (v >= 20)   return 'good'
    if (v >= 5)    return 'warn'
    return 'bad'
  }
  function auftragsHighlight(v: number | null): 'good' | 'warn' | 'bad' | 'neutral' {
    if (v == null) return 'neutral'
    if (v >= 6)    return 'good'
    if (v >= 3)    return 'warn'
    return 'bad'
  }

  return (
    <div className="unk-root">

      {/* ── Year selector ── */}
      <div className="unk-header">
        <h2 className="unk-title">Unternehmenskennzahlen</h2>
        <div className="unk-year-wrap">
          <label htmlFor="unk-year" style={{ fontSize: 13, color: 'var(--text-2)', marginRight: 6 }}>Jahr</label>
          <select
            id="unk-year"
            className="inline-select"
            value={year}
            onChange={e => setYear(Number(e.target.value))}
          >
            {YEAR_OPTIONS.map(y => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
        </div>
      </div>

      <p style={{ fontSize: 13, color: 'var(--text-3)', marginBottom: 20, lineHeight: 1.5 }}>
        Basierend auf Rechnungen, Teilzahlungen und Zeitbuchungen des gewählten Jahres.
        Für Kennzahlen, die eine vollständige Kostenaufschlüsselung erfordern, sind Platzhalter ausgewiesen.
      </p>

      {error && <p style={{ color: 'var(--red, #dc2626)', fontSize: 13 }}>Fehler beim Laden.</p>}
      {isLoading && <p className="empty-note">Lade Kennzahlen …</p>}

      {!isLoading && kpis && (
        <>
          {/* ── KPI grid ── */}
          <div className="unk-grid">

            <KpiCard
              icon={<TrendingUp size={20} strokeWidth={1.75} />}
              label="Umsatz pro Mitarbeiter"
              value={fmtEur(kpis.umsatzProMitarbeiter)}
              formula="Jahresumsatz (inkl. Abschläge) / Mitarbeiteranzahl"
              note="Mitarbeiteranzahl: aktive Mitarbeiter zum Abfragezeitpunkt"
            />

            <KpiCard
              icon={<BarChart3 size={20} strokeWidth={1.75} />}
              label="Deckungsbeitragsmarge"
              value={fmtPct(kpis.deckungsbeitragMarge)}
              formula="(Umsatz – Einzelkosten) / Umsatz"
              note="Näherungswert: Einzelkosten = CP_TOT aus Zeitbuchungen (ohne Gemeinkosten)"
              highlight={dbMargeHighlight(kpis.deckungsbeitragMarge)}
            />

            <KpiCard
              icon={<Clock size={20} strokeWidth={1.75} />}
              label="Ø Kostenrate (Stundensatz)"
              value={fmtEurK(kpis.mittlererStundensatz)}
              formula="Gesamte Einzelkosten / Projektstunden"
              note="Entspricht dem mittleren Kostenpreis je Projektstunde (ohne Gemeinkostenzuschlag)"
            />

            <KpiCard
              icon={<CalendarRange size={20} strokeWidth={1.75} />}
              label="Auftragsreichweite"
              value={fmtM(kpis.auftragsreichweite)}
              formula="Auftragsbestand × 12 / Jahresumsatz"
              note="Auftragsbestand = Summe (Budget – Abgerechnet) aller aktiven Projekte"
              highlight={auftragsHighlight(kpis.auftragsreichweite)}
            />

            <KpiCard
              icon={<Users size={20} strokeWidth={1.75} />}
              label="Anteil Projektmitarbeiter"
              value={fmtPct(kpis.anteilProjektmitarbeiter)}
              formula="Mitarbeiter mit Zeitbuchungen / Gesamtzahl Mitarbeiter"
            />

            {/* ── Not-computable KPIs ── */}
            <KpiCard
              icon={<Clock size={20} strokeWidth={1.75} />}
              label="Projektstundenanteil"
              value="–"
              formula=""
              unavailable="Erfordert Erfassung allgemeiner Bürostunden (ohne Projektbezug) — derzeit nicht erfasst"
            />

            <KpiCard
              icon={<BarChart3 size={20} strokeWidth={1.75} />}
              label="Personalkostenanteil"
              value="–"
              formula=""
              unavailable="Erfordert Kostenart-Konfiguration (Personal- vs. Gemeinkosten) — noch nicht konfigurierbar"
            />

            <KpiCard
              icon={<BarChart3 size={20} strokeWidth={1.75} />}
              label="Gemeinkostenfaktor"
              value="–"
              formula=""
              unavailable="Erfordert Kostenart-Konfiguration — noch nicht konfigurierbar"
            />

          </div>

          {/* ── Raw data strip ── */}
          <details style={{ marginTop: 24 }}>
            <summary style={{ fontSize: 12, color: 'var(--text-3)', cursor: 'pointer', userSelect: 'none', marginBottom: 8 }}>
              Basisdaten {year}
            </summary>
            <div className="unk-base-strip">
              <BaseDataRow label="Umsatz (Rechnungen + Abschläge)" value={fmtEur(raw?.revenue ?? null)} />
              <BaseDataRow label="Einzelkosten (Zeitbuchungen CP_TOT)" value={fmtEur(raw?.directCosts ?? null)} />
              <BaseDataRow label="Projektstunden (Zeitbuchungen)" value={fmtH(raw?.totalHours ?? null)} />
              <BaseDataRow label="Aktive Mitarbeiter" value={raw?.employeeCount != null ? String(raw.employeeCount) : '–'} />
              <BaseDataRow label="Mitarbeiter mit Buchungen" value={raw?.projectEmployeeCount != null ? String(raw.projectEmployeeCount) : '–'} />
              <BaseDataRow label="Auftragsbestand (alle Projekte)" value={fmtEur(raw?.backlog ?? null)} />
            </div>
          </details>

          {/* ── Source notes ── */}
          <div className="unk-source-notes">
            <p><strong>Literatur:</strong> Die Kennzahlen orientieren sich am Standard der PBP Planungsbüro Professionell (Evelyn Saxinger, Frenz | Saxinger Unternehmensberatung) und den PeP-7-Kennzahlen des Vereins „Praxisinitiative erfolgreiches Planungsbüro e.V."</p>
            <p><strong>Hinweis Vergleichbarkeit:</strong> Kennzahlen verschiedener Büros sind schwer vergleichbar (unterschiedliche Definitionen von Umsatz, Projektstunden, Mitarbeiteranzahl). Der interne Jahresvergleich ist aussagekräftiger als Branchenvergleiche.</p>
          </div>
        </>
      )}
    </div>
  )
}
