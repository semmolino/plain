/**
 * AuthProvider
 *
 * On mount:
 *  1. Fetches Supabase URL + anon key from the backend (/api/v1/auth/config)
 *  2. Creates the Supabase client and stores it in the auth store
 *  3. Subscribes to onAuthStateChange — keeps session in sync
 *  4. Reads the URL hash for invite / password-recovery flow types
 *
 * Children are not rendered until the initial auth check completes,
 * so every page can safely assume `isLoading === false` when it mounts.
 */

import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { useNavigate } from 'react-router-dom'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { fetchAuthConfig } from '@/api/auth'
import { useAuthStore } from '@/store/authStore'

export type UrlFlowType = 'invite' | 'recovery' | null

interface AuthContextValue {
  supabase: SupabaseClient | null
  /** Flow type parsed from the URL hash before Supabase consumes it */
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
  const navigate = useNavigate()

  const { setSupabase, setSession, setLoading, reset } = useAuthStore()

  useEffect(() => {
    let unsubscribe: (() => void) | undefined

    async function init() {
      // Read URL hash BEFORE createClient so Supabase doesn't consume it first
      const hashParams = new URLSearchParams(window.location.hash.slice(1))
      const flowType = hashParams.get('type') as UrlFlowType
      setUrlFlowType(flowType)

      try {
        const config = await fetchAuthConfig()
        const client = createClient(config.supabaseUrl, config.supabaseAnonKey)

        supabaseRef.current = client
        setSupabase(client)

        const { data: { subscription } } = client.auth.onAuthStateChange(
          (event, session) => {
            setSession(session)

            if (event === 'PASSWORD_RECOVERY') {
              navigate('/reset-password')
            } else if (event === 'SIGNED_IN') {
              const flowType = new URLSearchParams(window.location.hash.slice(1)).get('type')
              if (flowType === 'invite') {
                navigate('/reset-password')
              } else {
                navigate('/')
              }
            } else if (event === 'SIGNED_OUT') {
              navigate('/login')
            }
          },
        )
        unsubscribe = () => subscription.unsubscribe()

        // Hydrate from existing session (page refresh)
        const { data: { session } } = await client.auth.getSession()
        setSession(session)
      } catch (err) {
        console.error('Auth init failed:', err)
        reset()
      } finally {
        setLoading(false)
        setReady(true)
      }
    }

    void init()

    return () => {
      unsubscribe?.()
    }
  }, [setSupabase, setSession, setLoading, reset])

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
