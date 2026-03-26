import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ReactQueryDevtools } from '@tanstack/react-query-devtools'

import { AuthProvider }    from '@/context/AuthContext'
import { ProtectedRoute }  from '@/components/ui/ProtectedRoute'
import { ErrorBoundary }   from '@/components/ui/ErrorBoundary'
import { AppLayout }       from '@/components/layout/AppLayout'

import { LoginPage }         from '@/pages/auth/LoginPage'
import { SignupPage }        from '@/pages/auth/SignupPage'
import { ResetPasswordPage } from '@/pages/auth/ResetPasswordPage'
import { DashboardPage }    from '@/pages/DashboardPage'
import { AdressenPage }     from '@/pages/AdressenPage'
import { MitarbeiterPage }  from '@/pages/MitarbeiterPage'
import { AdminPage }        from '@/pages/AdminPage'
import { ProjektePage }    from '@/pages/ProjektePage'
import { RechnungenPage }  from '@/pages/RechnungenPage'
import { DatenPage }       from '@/pages/DatenPage'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5, // 5 min
      retry: 1,
    },
  },
})

export default function App() {
  return (
    <ErrorBoundary>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <ErrorBoundary>
        <AuthProvider>
          <Routes>
            {/* Public */}
            <Route path="/login"          element={<LoginPage />} />
            <Route path="/signup"         element={<SignupPage />} />
            <Route path="/reset-password" element={<ResetPasswordPage />} />

            {/* Protected — all wrapped in AppLayout */}
            <Route
              element={
                <ProtectedRoute>
                  <AppLayout />
                </ProtectedRoute>
              }
            >
              <Route path="/"            element={<DashboardPage />} />
              <Route path="/adressen"    element={<AdressenPage />} />
              <Route path="/projekte"    element={<ProjektePage />} />
              <Route path="/daten"       element={<DatenPage />} />
              <Route path="/rechnungen"  element={<RechnungenPage />} />
              <Route path="/admin"       element={<AdminPage />} />
              <Route path="/mitarbeiter" element={<MitarbeiterPage />} />
            </Route>

            {/* Catch-all */}
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </AuthProvider>
        </ErrorBoundary>
      </BrowserRouter>
      <ReactQueryDevtools initialIsOpen={false} />
    </QueryClientProvider>
    </ErrorBoundary>
  )
}
