import { apiClient } from './client'

// ── Service-Bereich (Vorschläge · Feedback · Unterstützung) ──────────────────
// Phase 0: Zugangs-Gate (Haftungs-/Nutzungsbestätigung) + Produkt-Sprecher.
// Siehe docs/SERVICE_AREA_CONCEPT.md.

export interface ConsentStatus {
  current_version: string
  accepted:        boolean
  accepted_at:     string | null
}

export interface DelegateInfo {
  employee_id:   number | null
  employee_name: string | null
  is_me:         boolean
}

export const fetchConsent = () =>
  apiClient.get<ConsentStatus>('/service/consent')

export const acceptConsent = () =>
  apiClient.post<{ accepted: boolean; current_version: string }>('/service/consent', {})

export const fetchDelegate = () =>
  apiClient.get<DelegateInfo>('/service/delegate')

export const saveDelegate = (employeeId: number | null) =>
  apiClient.put<{ employee_id: number | null }>('/service/delegate', { employee_id: employeeId })
