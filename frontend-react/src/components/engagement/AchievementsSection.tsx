import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Trophy, Lock } from 'lucide-react'
import { fetchMyAchievements, type AchievementItem } from '@/api/mitarbeiter'
import { useGamificationConfig } from '@/hooks/useGamificationConfig'

const CATEGORY_LABEL: Record<string, string> = {
  aktivierung:   'Aktivierung',
  gewohnheit:    'Gewohnheit',
  meisterschaft: 'Meisterschaft',
}

function fmtDate(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  return d.toLocaleDateString('de-DE', { year: 'numeric', month: 'long', day: 'numeric' })
}

/**
 * Achievements-Sektion fuers Profil. Zeigt erreichte und gesperrte Achievements
 * gruppiert nach Kategorie. Versteckt sich komplett, wenn Feature im Tenant
 * abgeschaltet ist.
 *
 * Hinweis: das Backend ueberprueft und persistiert beim GET. Wenn der User
 * also gerade die 100. Buchung gemacht hat, wird das Achievement beim
 * naechsten Profil-Aufruf entriegelt.
 */
export function AchievementsSection() {
  const { isFeatureEnabled } = useGamificationConfig()
  const enabled = isFeatureEnabled('achievements')

  const { data, isLoading } = useQuery({
    queryKey: ['my-achievements'],
    queryFn:  fetchMyAchievements,
    staleTime: 60_000,
    enabled,
  })

  const items = data?.data?.items ?? []
  const byCategory = useMemo(() => {
    const map = new Map<string, AchievementItem[]>()
    for (const it of items) {
      const cat = it.category ?? 'sonst'
      if (!map.has(cat)) map.set(cat, [])
      map.get(cat)!.push(it)
    }
    return map
  }, [items])

  if (!enabled) return null
  if (isLoading) return <div className="empty-note" style={{ padding: 16 }}>Erfolge werden geprüft …</div>
  if (items.length === 0) return null

  const earnedCount = data?.data?.earned_count ?? 0
  const totalCount  = data?.data?.total_count  ?? 0

  return (
    <div className="achievements-section">
      <div className="achievements-header">
        <div className="achievements-title">
          <Trophy size={18} strokeWidth={2} /> Meine Erfolge
        </div>
        <div className="achievements-count">{earnedCount} / {totalCount}</div>
      </div>

      {[...byCategory.entries()].map(([cat, list]) => (
        <div key={cat} className="achievements-category">
          <div className="achievements-category-label">{CATEGORY_LABEL[cat] ?? cat}</div>
          <div className="achievements-grid">
            {list.map(a => (
              <div key={a.key} className={`achievement-card ${a.earned ? 'earned' : 'locked'}`}>
                <div className="achievement-icon">
                  {a.earned ? <Trophy size={20} strokeWidth={2} /> : <Lock size={18} strokeWidth={2} />}
                </div>
                <div className="achievement-body">
                  <div className="achievement-title">{a.title}</div>
                  {a.description && <div className="achievement-desc">{a.description}</div>}
                  {a.earned && a.earned_at && (
                    <div className="achievement-earned-at">Erreicht am {fmtDate(a.earned_at)}</div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
