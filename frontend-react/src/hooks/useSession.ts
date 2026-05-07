import { useShallow } from 'zustand/react/shallow'
import { useAuthStore } from '@/store/authStore'

export function useSession() {
  return useAuthStore(
    useShallow((s) => ({
      token:           s.token,
      employeeId:      s.employeeId,
      tenantId:        s.tenantId,
      shortName:       s.shortName,
      email:           s.email,
      companyName:     s.companyName,
      isLoading:       s.isLoading,
      isAuthenticated: s.token !== null,
    })),
  )
}
