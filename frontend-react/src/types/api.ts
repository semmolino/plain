// Standard API response envelope from the backend
export interface ApiResponse<T> {
  data: T
}

export interface ApiError {
  error: string
}

// ── Auth ──────────────────────────────────────────────────────────────────────

export interface AuthConfig {
  supabaseUrl: string
  supabaseAnonKey: string
}

export interface MeResponse {
  email: string
  companyName: string
}

export interface TeamMember {
  id: string
  email: string
  role: string
  confirmed: boolean
  created_at: string
}

// ── Common lookups ────────────────────────────────────────────────────────────

export interface IdLabel {
  ID: number
  NAME?: string
  LABEL?: string
}

export interface Gender {
  ID: number
  GENDER: string
}

export interface Country {
  ID: number
  NAME: string
  ISO2: string
}

export interface BillingType {
  ID: number
  NAME: string
  DESCRIPTION?: string
}
