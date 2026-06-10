import { useQuery } from '@tanstack/react-query'
import { fetchGamificationConfig, type GamificationConfig } from '@/api/gamification'

const DEFAULT_CONFIG: GamificationConfig = {
  enabled: true, setup_checklist: true, streaks: true, achievements: true, recaps: true,
}

/**
 * Liest die Engagement-Konfiguration des Tenants. Solange noch nicht geladen
 * (oder bei Netzwerkfehler) wird der Default "alles an" zurueckgegeben --
 * Default-on, damit die UI nicht kurz blank flackert.
 *
 * isFeatureEnabled('streaks') liefert nur dann true, wenn sowohl der Master-
 * Schalter als auch das Feature aktiv sind.
 */
export function useGamificationConfig() {
  const { data, isLoading } = useQuery({
    queryKey: ['gamification-config'],
    queryFn:  fetchGamificationConfig,
    staleTime: 60_000,
  })
  const config = data?.data ?? DEFAULT_CONFIG

  function isFeatureEnabled(feature: Exclude<keyof GamificationConfig, 'enabled'>): boolean {
    return config.enabled && config[feature]
  }

  return { config, isLoading, isFeatureEnabled }
}
