import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export interface AuthState {
  token:         string | null
  employeeId:    number | null
  tenantId:      number | null
  shortName:     string | null
  email:         string | null
  companyName:   string | null
  dashboardRole: string | null  // 'geschaeftsleitung' | 'controller' | 'bereichsleiter' | null
  isLoading:     boolean
}

interface AuthStore extends AuthState {
  setAuth: (data: {
    token:          string
    employeeId:     number
    tenantId:       number
    shortName:      string
    email:          string
    companyName:    string | null
    dashboardRole?: string | null
  }) => void
  clearAuth:        () => void
  setLoading:       (loading: boolean) => void
  setDashboardRole: (role: string | null) => void
}

export const useAuthStore = create<AuthStore>()(
  persist(
    (set) => ({
      token:         null,
      employeeId:    null,
      tenantId:      null,
      shortName:     null,
      email:         null,
      companyName:   null,
      dashboardRole: null,
      isLoading:     true,

      setAuth: (data) =>
        set((state) => ({
          token:         data.token,
          employeeId:    data.employeeId,
          tenantId:      data.tenantId,
          shortName:     data.shortName,
          email:         data.email,
          companyName:   data.companyName,
          // Server role takes priority; fall back to existing client preference
          dashboardRole: data.dashboardRole !== undefined
            ? data.dashboardRole
            : state.dashboardRole,
          isLoading:     false,
        })),

      clearAuth: () =>
        set({
          token:         null,
          employeeId:    null,
          tenantId:      null,
          shortName:     null,
          email:         null,
          companyName:   null,
          dashboardRole: null,
          isLoading:     false,
        }),

      setLoading: (isLoading) => set({ isLoading }),

      setDashboardRole: (dashboardRole) => set({ dashboardRole }),
    }),
    {
      name: 'plain_auth',
      partialize: (s) => ({ token: s.token, employeeId: s.employeeId, tenantId: s.tenantId, shortName: s.shortName, email: s.email, companyName: s.companyName, dashboardRole: s.dashboardRole }),
    },
  ),
)
