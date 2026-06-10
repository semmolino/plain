import { apiClient } from './client'

export interface GamificationConfig {
  enabled:         boolean
  setup_checklist: boolean
  streaks:         boolean
  achievements:    boolean
  recaps:          boolean
}

export const fetchGamificationConfig = () =>
  apiClient.get<{ data: GamificationConfig }>('/gamification/config')

export const saveGamificationConfig = (patch: Partial<GamificationConfig>) =>
  apiClient.put<{ data: GamificationConfig }>('/gamification/config', patch)
