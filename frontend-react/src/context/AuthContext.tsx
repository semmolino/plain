import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react'
import { fetchMe } from '@/api/auth'
import { useAuthStore } from '@/store/authStore'
import { usePermissionsStore } from '@/store/permissionsStore'
import { useLicenseStore } from '@/store/licenseStore'

export type UrlFlowType = 'invite' | 'recovery' | null

interface AuthContextValue {
  urlFlowType: UrlFlowType
}

const AuthContext = createContext<AuthContextValue>({
  urlFlowType: null,
})

export function AuthProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false)
  const [urlFlowType, setUrlFlowType] = useState<UrlFlowType>(null)

  const { token, setAuth, clearAuth, setLoading } = useAuthStore()

  useEffect(() => {
    async function init() {
      const hashParams = new URLSearchParams(window.location.hash.slice(1))
      const flowType = hashParams.get('type') as UrlFlowType
      setUrlFlowType(flowType)

      if (token) {
        try {
          const me = await fetchMe(token)
          setAuth({
            token,
            employeeId:  me.employee_id,
            tenantId:    me.tenant_id,
            shortName:   me.short_name,
            email:       me.email,
            companyName: me.company_name,
          })
          // RBAC: Permissions des Users laden, BEVOR App rendert.
          // Sonst rendern Komponenten mit dem optimistischen Default (unrestricted=true)
          // und zeigen kurz alle Buttons/Spalten, bevor die API antwortet.
          await usePermissionsStore.getState().reload()
          // Lizenz (L2): Entitlement des Tenants laden (Soft-Gating).
          await useLicenseStore.getState().reload()
        } catch {
          clearAuth()
          usePermissionsStore.getState().clear()
          useLicenseStore.getState().clear()
        }
      } else {
        setLoading(false)
      }

      setReady(true)
    }

    void init()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (!ready) {
    return (
      <div style={{ position: 'fixed', inset: 0, background: '#fff', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', zIndex: 9999 }}>
        <div style={{ fontSize: 32, fontWeight: 900, color: '#1a1a2e', marginBottom: 16 }}>PlaIn</div>
        <div style={{ fontSize: 14, color: '#666' }}>Laden …</div>
      </div>
    )
  }

  return (
    <AuthContext.Provider value={{ urlFlowType }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  return useContext(AuthContext)
}
