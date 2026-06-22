import { useQuery } from '@tanstack/react-query'
import { Lightbulb } from 'lucide-react'
import { fetchMyMastery, type MasteryModule } from '@/api/mitarbeiter'
import { useGamificationConfig } from '@/hooks/useGamificationConfig'
import { BrandGlyph } from '@/components/brand/BrandGlyph'

const LEVEL_COLORS: Record<string, { bg: string; fg: string; bar: string }> = {
  noch_nicht_erkundet: { bg: '#f3f4f6', fg: '#6b7280', bar: '#d1d5db' },
  anfaenger:           { bg: '#dbeafe', fg: '#1d4ed8', bar: '#60a5fa' },
  vertraut:            { bg: '#dcfce7', fg: '#15803d', bar: '#4ade80' },
  profi:               { bg: '#fef3c7', fg: '#a16207', bar: '#f59e0b' },
  experte:             { bg: '#ede9fe', fg: '#6d28d9', bar: '#a78bfa' },
}

// Reifegrad-Stufen 0…4 → das & füllt sich über die gesamte Reife (Stufe + Fortschritt).
const LEVEL_INDEX: Record<string, number> = {
  noch_nicht_erkundet: 0, anfaenger: 1, vertraut: 2, profi: 3, experte: 4,
}
const MAX_LEVEL = 4

/**
 * Modul-Reife pro User. Versteckt sich, wenn 'achievements' im Tenant aus ist
 * (gleicher Toggle wie Achievements -- semantisch dieselbe Familie).
 */
export function MasterySection() {
  const { isFeatureEnabled } = useGamificationConfig()
  const enabled = isFeatureEnabled('achievements')

  const { data, isLoading } = useQuery({
    queryKey: ['my-mastery'],
    queryFn:  fetchMyMastery,
    staleTime: 60_000,
    enabled,
  })

  if (!enabled) return null
  if (isLoading) return null

  const modules = data?.data?.modules ?? []
  if (modules.length === 0) return null

  const tip = data?.data?.tip_of_day ?? null

  return (
    <div className="mastery-section">
      <div className="mastery-header">
        <BrandGlyph size={16} fill={1} /> Modul-Reife
      </div>

      <div className="mastery-grid">
        {modules.map(m => <MasteryRow key={m.module} m={m} />)}
      </div>

      {tip && (
        <div className="mastery-tip">
          <div className="mastery-tip-icon"><Lightbulb size={14} strokeWidth={2} /></div>
          <div className="mastery-tip-body">
            <div className="mastery-tip-label">Tipp · {tip.label}</div>
            <div className="mastery-tip-text">{tip.text}</div>
          </div>
        </div>
      )}
    </div>
  )
}

function MasteryRow({ m }: { m: MasteryModule }) {
  const colors = LEVEL_COLORS[m.level] ?? LEVEL_COLORS.noch_nicht_erkundet
  const pct = Math.round(m.progress_in_level * 100)
  // Gesamtreife über alle Stufen: aktuelle Stufe + Fortschritt in der Stufe.
  const overall = Math.min(((LEVEL_INDEX[m.level] ?? 0) + m.progress_in_level) / MAX_LEVEL, 1)
  return (
    <div className="mastery-row">
      <div className="mastery-row-head">
        <span className="mastery-row-label" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <BrandGlyph size={15} fill={overall} title={`${m.level_label} · Reife ${Math.round(overall * 100)} %`} />
          {m.label}
        </span>
        <span className="mastery-row-badge" style={{ background: colors.bg, color: colors.fg }}>
          {m.level_label}
        </span>
      </div>
      <div className="mastery-bar-track">
        <div className="mastery-bar-fill" style={{ width: `${pct}%`, background: colors.bar }} />
      </div>
      <div className="mastery-row-count">{m.count} {m.count === 1 ? 'Aktion' : 'Aktionen'}</div>
    </div>
  )
}
