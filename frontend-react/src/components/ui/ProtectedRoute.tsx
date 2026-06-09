import { Navigate, useLocation } from 'react-router-dom'
import { useSession } from '@/hooks/useSession'
import { usePermissionsStore } from '@/store/permissionsStore'
import type { ReactNode } from 'react'

interface Props {
  children: ReactNode
  /** Eine dieser Permissions reicht (anyOf). Leeres Array = nur Auth-Check. */
  anyOf?: string[]
}

/**
 * Auth-Guard + optional Permission-Check.
 *   <ProtectedRoute>...</ProtectedRoute>                   nur eingeloggt
 *   <ProtectedRoute anyOf={['addresses.view']}>...</...>   eingeloggt + Permission
 *
 * Bei fehlender Auth -> /login. Bei fehlender Permission -> /403 (Fallback-Seite).
 */
export function ProtectedRoute({ children, anyOf }: Props) {
  const { isAuthenticated } = useSession()
  const unrestricted = usePermissionsStore(s => s.unrestricted)
  const keys         = usePermissionsStore(s => s.keys)
  const loaded       = usePermissionsStore(s => s.loaded)
  const location     = useLocation()

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />
  }

  if (anyOf && anyOf.length > 0) {
    // Permissions noch nicht geladen -> kurzes Loading statt Redirect
    if (!loaded && !unrestricted) {
      return <div style={{ padding: 40, textAlign: 'center', color: '#6b7280' }}>Laden …</div>
    }
    if (!unrestricted && !anyOf.some(k => keys.has(k))) {
      return <Navigate to="/403" state={{ from: location.pathname }} replace />
    }
  }

  return <>{children}</>
}
