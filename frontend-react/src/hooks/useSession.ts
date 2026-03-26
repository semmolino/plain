/**
 * Convenience hook — components use this to read the current auth state.
 * Reads from the Zustand store (updated by AuthProvider).
 *
 * Usage:
 *   const { user, tenantId, isLoading } = useSession()
 */

import { useShallow } from 'zustand/react/shallow'
import { useAuthStore } from '@/store/authStore'

export function useSession() {
  return useAuthStore(
    useShallow((s) => ({
      session:         s.session,
      user:            s.user,
      tenantId:        s.tenantId,
      isLoading:       s.isLoading,
      isAuthenticated: s.session !== null,
    })),
  )
}
