import { lazy, Suspense } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ReactQueryDevtools } from '@tanstack/react-query-devtools'

import { AuthProvider }   from '@/context/AuthContext'
import { ProtectedRoute } from '@/components/ui/ProtectedRoute'
import { ErrorBoundary }  from '@/components/ui/ErrorBoundary'
import { AppLayout }      from '@/components/layout/AppLayout'

// Auth pages — tiny, always needed, eager
import { LoginPage }         from '@/pages/auth/LoginPage'
import { SignupPage }        from '@/pages/auth/SignupPage'
import { ResetPasswordPage } from '@/pages/auth/ResetPasswordPage'

// App pages — lazy-loaded per route
const DashboardPage   = lazy(() => import('@/pages/DashboardPage').then(m => ({ default: m.DashboardPage })))
const AdressenPage    = lazy(() => import('@/pages/AdressenPage').then(m => ({ default: m.AdressenPage })))
const MitarbeiterPage = lazy(() => import('@/pages/MitarbeiterPage').then(m => ({ default: m.MitarbeiterPage })))
const AdminPage       = lazy(() => import('@/pages/AdminPage').then(m => ({ default: m.AdminPage })))
const ProjektePage    = lazy(() => import('@/pages/ProjektePage').then(m => ({ default: m.ProjektePage })))
const RechnungenPage  = lazy(() => import('@/pages/RechnungenPage').then(m => ({ default: m.RechnungenPage })))
const DatenPage       = lazy(() => import('@/pages/DatenPage').then(m => ({ default: m.DatenPage })))

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5,
      retry: 1,
    },
  },
})

function PageLoader() {
  return <div style={{ padding: '2rem', textAlign: 'center', color: '#888' }}>Laden …</div>
}

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
              <Route path="/"            element={<Suspense fallback={<PageLoader />}><DashboardPage /></Suspense>} />
              <Route path="/adressen"    element={<Suspense fallback={<PageLoader />}><AdressenPage /></Suspense>} />
              <Route path="/projekte"    element={<Suspense fallback={<PageLoader />}><ProjektePage /></Suspense>} />
              <Route path="/daten"       element={<Suspense fallback={<PageLoader />}><DatenPage /></Suspense>} />
              <Route path="/rechnungen"  element={<Suspense fallback={<PageLoader />}><RechnungenPage /></Suspense>} />
              <Route path="/admin"       element={<Suspense fallback={<PageLoader />}><AdminPage /></Suspense>} />
              <Route path="/mitarbeiter" element={<Suspense fallback={<PageLoader />}><MitarbeiterPage /></Suspense>} />
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
