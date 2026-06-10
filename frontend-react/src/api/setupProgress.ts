import { apiClient } from './client'

export interface SetupStep {
  key:   string
  label: string
  hint:  string
  href:  string
  done:  boolean
}

export interface SetupSection {
  steps: SetupStep[]
  done:  number
  total: number
}

export interface SetupProgress {
  admin:       SetupSection
  daten:       SetupSection
  total_done:  number
  total_count: number
  all_done:    boolean
}

export const fetchSetupProgress = () =>
  apiClient.get<{ data: SetupProgress }>('/stammdaten/setup-progress')
