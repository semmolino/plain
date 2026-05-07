import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export interface AuthState {
  token:       string | null
  employeeId:  number | null
  tenantId:    number | null
  shortName:   string | null
  email:       string | null
  companyName: string | null
  isLoading:   boolean
}

interface AuthStore extends AuthState {
  setAuth: (data: {
    token:       string
    employeeId:  number
    tenantId:    number
    shortName:   string
    email:       string
    companyName: string | null
  }) => void
  clearAuth:  () => void
  setLoading: (loading: boolean) => void
}

export const useAuthStore = create<AuthStore>()(
  persist(
    (set) => ({
      token:       null,
      employeeId:  null,
      tenantId:    null,
      shortName:   null,
      email:       null,
      companyName: null,
      isLoading:   true,

      setAuth: (data) =>
        set({
          token:       data.token,
          employeeId:  data.employeeId,
          tenantId:    data.tenantId,
          shortName:   data.shortName,
          email:       data.email,
          companyName: data.companyName,
          isLoading:   false,
        }),

      clearAuth: () =>
        set({
          token:       null,
          employeeId:  null,
          tenantId:    null,
          shortName:   null,
          email:       null,
          companyName: null,
          isLoading:   false,
        }),

      setLoading: (isLoading) => set({ isLoading }),
    }),
    {
      name: 'plain_auth',
      partialize: (s) => ({ token: s.token, employeeId: s.employeeId, tenantId: s.tenantId, shortName: s.shortName, email: s.email, companyName: s.companyName }),
    },
  ),
)
