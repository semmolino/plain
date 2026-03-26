/**
 * Dashboard placeholder — Phase 2 will implement the full KPI/chart view.
 */
import { useSession } from '@/hooks/useSession'
import { useAuth } from '@/context/AuthContext'

export function DashboardPage() {
  const { supabase } = useAuth()
  const { user }     = useSession()

  async function handleLogout() {
    await supabase?.auth.signOut()
  }

  return (
    <div style={{ padding: 32 }}>
      <h1>Dashboard</h1>
      <p style={{ marginTop: 8, color: '#666' }}>
        Angemeldet als: <strong>{user?.email}</strong>
      </p>
      <button
        style={{ marginTop: 24 }}
        onClick={() => void handleLogout()}
      >
        Abmelden
      </button>
    </div>
  )
}
