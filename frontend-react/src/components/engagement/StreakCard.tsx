import { useQuery } from '@tanstack/react-query'
import { fetchMyStreak } from '@/api/mitarbeiter'
import { useGamificationConfig } from '@/hooks/useGamificationConfig'
import { BrandGlyph } from '@/components/brand/BrandGlyph'

// Zielwert, ab dem das & voll ist. Es füllt sich Richtung Ziel und sinkt bei
// Streak-Abbruch automatisch mit dem Streak-Wert.
const STREAK_TARGET = 50

/**
 * Buchungsstreak-Karte fuer das Mitarbeiter-Dashboard. Zeigt den aktuellen
 * Streak (Anzahl aufeinanderfolgender Arbeitstage mit Buchung) und den
 * persoenlichen Rekord. Strikt persoenlich -- niemals tenant-uebergreifend.
 *
 * Versteckt sich komplett, wenn Tenant-Admin "streaks" abgeschaltet hat.
 */
export function StreakCard() {
  const { isFeatureEnabled } = useGamificationConfig()
  const enabled = isFeatureEnabled('streaks')

  const { data, isLoading } = useQuery({
    queryKey: ['my-streak'],
    queryFn:  fetchMyStreak,
    staleTime: 60_000,
    enabled,
  })

  if (!enabled) return null
  if (isLoading || !data?.data) return null

  const { current_streak, longest_streak, today_booked } = data.data

  // Eintrittsschwelle: erst ab Streak >= 2 anzeigen. Sonst wirkt die Karte
  // beim ersten Mal trivial ("Dein Streak: 0 Tage").
  if (current_streak < 2 && longest_streak < 2) return null

  const noteText = !today_booked && current_streak > 0
    ? `Heute noch buchen, um die Streak zu sichern.`
    : current_streak === 0 && longest_streak > 0
      ? `Letzte Streak: ${longest_streak} Tage. Wieder anfangen?`
      : current_streak === longest_streak
        ? `Neuer persönlicher Rekord.`
        : `Persönlicher Rekord: ${longest_streak} Tage.`

  return (
    <div className="streak-card">
      <div className="streak-card-icon">
        <BrandGlyph size={26} fill={Math.min(current_streak / STREAK_TARGET, 1)} title={`Streak ${current_streak} Tage`} />
      </div>
      <div className="streak-card-body">
        <div className="streak-card-label">Buchungsstreak</div>
        <div className="streak-card-value">
          <span className="streak-card-number">{current_streak}</span>
          <span className="streak-card-unit">{current_streak === 1 ? 'Tag' : 'Tage'}</span>
        </div>
        <div className="streak-card-note">{noteText}</div>
      </div>
    </div>
  )
}
