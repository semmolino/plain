import { useEffect, useState } from 'react'
import { api, ApiError, type Analytics, type CountMap, type MonthPoint } from '../api'

const LIFECYCLE_LABEL: Record<string, string> = {
  new: 'Neu', reviewing: 'In Prüfung', planned: 'Geplant', in_progress: 'In Umsetzung',
  shipped: 'Umgesetzt', not_planned: 'Aktuell nicht geplant',
}
const MODERATION_LABEL: Record<string, string> = {
  pending: 'Zu prüfen', published: 'Veröffentlicht', declined: 'Abgelehnt', merged: 'Zusammengeführt',
}
const REQ_STATUS_LABEL: Record<string, string> = {
  new: 'Offen', in_progress: 'In Bearbeitung', waiting: 'Wartet auf Anwender', resolved: 'Gelöst', closed: 'Geschlossen',
}
const KIND_LABEL: Record<string, string> = { feedback: 'Feedback', support: 'Unterstützung' }
const CAT_LABEL: Record<string, string> = {
  projekte: 'Projekte', rechnungen: 'Rechnungen', angebote: 'Angebote', reporting: 'Reporting',
  adressen: 'Adressen', mitarbeiter: 'Mitarbeiter', import: 'Datenimport', einvoice: 'E-Rechnung',
  datenimport: 'Datenimport', ersteinrichtung: 'Ersteinrichtung', projekte_kalk: 'Projekte', benutzer: 'Benutzer',
  technik: 'Technik', lob: 'Lob', kritik: 'Kritik', frage: 'Frage', sonstiges: 'Sonstiges',
}

function KpiCard({ label, value, accent }: { label: string; value: number; accent?: string }) {
  return (
    <div className="card" style={{ minWidth: 150, flex: '1 1 150px', textAlign: 'center' }}>
      <div style={{ fontSize: 30, fontWeight: 700, color: accent || 'inherit' }}>{value}</div>
      <div className="muted" style={{ fontSize: 13 }}>{label}</div>
    </div>
  )
}

function BarList({ title, data, labels }: { title: string; data: CountMap; labels?: Record<string, string> }) {
  const entries = Object.entries(data).sort((a, b) => b[1] - a[1])
  const max = Math.max(1, ...entries.map(([, v]) => v))
  return (
    <div className="card" style={{ flex: '1 1 280px' }}>
      <strong style={{ fontSize: 14 }}>{title}</strong>
      <div style={{ display: 'grid', gap: 6, marginTop: 10 }}>
        {entries.length === 0 && <span className="muted">Keine Daten.</span>}
        {entries.map(([k, v]) => (
          <div key={k} style={{ display: 'grid', gridTemplateColumns: '150px 1fr 32px', alignItems: 'center', gap: 8, fontSize: 13 }}>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{labels?.[k] || k}</span>
            <span style={{ background: 'rgba(99,102,241,0.15)', borderRadius: 4, height: 14 }}>
              <span style={{ display: 'block', width: `${(v / max) * 100}%`, height: '100%', background: '#6366f1', borderRadius: 4 }} />
            </span>
            <span style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{v}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function MonthBars({ title, data }: { title: string; data: MonthPoint[] }) {
  const max = Math.max(1, ...data.map((d) => d.count))
  return (
    <div className="card" style={{ flex: '1 1 280px' }}>
      <strong style={{ fontSize: 14 }}>{title}</strong>
      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', height: 110, marginTop: 12 }}>
        {data.map((d) => (
          <div key={d.month} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
            <span style={{ fontSize: 11, fontVariantNumeric: 'tabular-nums' }}>{d.count}</span>
            <div style={{ width: '70%', height: `${(d.count / max) * 80}px`, minHeight: 2, background: '#6366f1', borderRadius: '3px 3px 0 0' }} />
            <span className="muted" style={{ fontSize: 10 }}>{d.month.slice(2)}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

export function AnalyticsView() {
  const [data, setData] = useState<Analytics | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api.analytics().then(setData).catch((e) => setError(e instanceof ApiError ? e.message : 'Laden fehlgeschlagen.'))
  }, [])

  if (error) return <div className="error">{error}</div>
  if (!data) return <div className="muted">Lädt…</div>

  const { suggestions: sg, requests: rq } = data

  return (
    <div>
      <h2>Auswertung</h2>
      <p className="muted">Plan&simple-weite Kennzahlen. Ohne personenbezogene Daten — Organisationen zählen nur anonym.</p>

      <h3 style={{ marginBottom: 8 }}>Vorschläge</h3>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
        <KpiCard label="Vorschläge gesamt" value={sg.total} />
        <KpiCard label="Zu prüfen" value={sg.pending} accent={sg.pending > 0 ? '#b45309' : undefined} />
        <KpiCard label="Veröffentlicht" value={sg.published} accent="#047857" />
        <KpiCard label="Beteiligte Organisationen" value={sg.orgs_participating} />
      </div>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
        <BarList title="Nach Status (veröffentlicht)" data={sg.by_lifecycle} labels={LIFECYCLE_LABEL} />
        <BarList title="Nach Moderation" data={sg.by_moderation} labels={MODERATION_LABEL} />
        <BarList title="Nach Bereich" data={sg.by_category} labels={CAT_LABEL} />
        <MonthBars title="Eingereicht pro Monat" data={sg.per_month} />
      </div>

      <div className="card" style={{ marginBottom: 20 }}>
        <strong style={{ fontSize: 14 }}>Top-Wünsche (nach Stimmen)</strong>
        <table className="grid" style={{ marginTop: 8 }}>
          <thead><tr><th>#</th><th>Titel</th><th>Status</th><th>Stimmen</th></tr></thead>
          <tbody>
            {sg.top.length === 0 && <tr><td colSpan={4} className="muted">Noch keine veröffentlichten Vorschläge.</td></tr>}
            {sg.top.map((t) => (
              <tr key={t.id}>
                <td>#{t.id}</td>
                <td>{t.title}</td>
                <td>{LIFECYCLE_LABEL[t.lifecycle_status] || t.lifecycle_status}</td>
                <td style={{ fontVariantNumeric: 'tabular-nums' }}>{t.votes}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h3 style={{ marginBottom: 8 }}>Feedback & Unterstützung</h3>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
        <KpiCard label="Anfragen gesamt" value={rq.total} />
        <KpiCard label="Offen" value={rq.open} accent={rq.open > 0 ? '#b45309' : undefined} />
      </div>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <BarList title="Nach Art" data={rq.by_kind} labels={KIND_LABEL} />
        <BarList title="Nach Status" data={rq.by_status} labels={REQ_STATUS_LABEL} />
        <BarList title="Nach Kategorie" data={rq.by_category} labels={CAT_LABEL} />
        <MonthBars title="Eingegangen pro Monat" data={rq.per_month} />
      </div>
    </div>
  )
}
