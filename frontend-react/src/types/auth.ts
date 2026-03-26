import type { Session, User } from '@supabase/supabase-js'

export interface AuthUser extends User {
  app_metadata: {
    tenant_id?: number
    [key: string]: unknown
  }
}

export interface AuthState {
  session: Session | null
  user: AuthUser | null
  tenantId: number | null
  isLoading: boolean
}
