import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { fetchAuthConfig, fetchMe } from '@/api/auth'
import { useAuthStore } from '@/store/authStore'

export type UrlFlowType = 'invite' | 'recovery' | null

interface AuthContextValue {
  supabase: SupabaseClient | null
  urlFlowType: UrlFlowType
}

const AuthContext = createContext<AuthContextValue>({
  supabase: null,
  urlFlowType: null,
})

export function AuthProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false)
  const [urlFlowType, setUrlFlowType] = useState<UrlFlowType>(null)
  const supabaseRef = useRef<SupabaseClient | null>(null)

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
        } catch {
          clearAuth()
        }
      } else {
        setLoading(false)
      }

      // Provide Supabase client for invite/recovery password flows
      try {
        const config = await fetchAuthConfig()
        supabaseRef.current = createClient(config.supabaseUrl, config.supabaseAnonKey)
      } catch {
        // non-fatal — recovery flow won't work but normal auth is unaffected
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
    <AuthContext.Provider value={{ supabase: supabaseRef.current, urlFlowType }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  return useContext(AuthContext)
}
