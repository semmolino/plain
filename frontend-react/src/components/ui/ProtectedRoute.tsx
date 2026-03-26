import { Navigate } from 'react-router-dom'
import { useSession } from '@/hooks/useSession'
import type { ReactNode } from 'react'

interface Props {
  children: ReactNode
}

/**
 * Redirects unauthenticated users to /login.
 * isLoading is always false here because AuthProvider
 * blocks rendering until the session check is complete.
 */
export function ProtectedRoute({ children }: Props) {
  const { isAuthenticated } = useSession()

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />
  }

  return <>{children}</>
}
