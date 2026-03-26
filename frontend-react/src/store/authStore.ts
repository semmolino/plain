import { create } from 'zustand'
import type { Session, SupabaseClient } from '@supabase/supabase-js'
import type { AuthUser } from '@/types/auth'

interface AuthStore {
  supabase: SupabaseClient | null
  session: Session | null
  user: AuthUser | null
  tenantId: number | null
  isLoading: boolean

  setSupabase: (client: SupabaseClient) => void
  setSession: (session: Session | null) => void
  setLoading: (loading: boolean) => void
  reset: () => void
}

export const useAuthStore = create<AuthStore>((set) => ({
  supabase: null,
  session: null,
  user: null,
  tenantId: null,
  isLoading: true,

  setSupabase: (client) => set({ supabase: client }),

  setSession: (session) =>
    set({
      session,
      user: (session?.user as AuthUser) ?? null,
      tenantId: (session?.user?.app_metadata?.tenant_id as number) ?? null,
    }),

  setLoading: (isLoading) => set({ isLoading }),

  reset: () =>
    set({ session: null, user: null, tenantId: null, isLoading: false }),
}))
