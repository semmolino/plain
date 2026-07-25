import { apiClient } from './client'

export interface MyLicenseResponse {
  unrestricted: boolean
  plan_id: number | null
  state: string | null
  /** 'read_only' bei abgelaufener Lizenz — sonst null. */
  restriction: 'read_only' | null
  capabilities: string[]
  limits: Record<string, number>
}

/** Effektives Lizenz-Entitlement des eingeloggten Tenants. */
export const fetchMyLicense = () => apiClient.get<MyLicenseResponse>('/license/me')
