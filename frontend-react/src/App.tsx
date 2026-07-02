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
const AddressDetailPage = lazy(() => import('@/pages/adressen/AddressDetailPage').then(m => ({ default: m.AddressDetailPage })))
const MitarbeiterPage = lazy(() => import('@/pages/MitarbeiterPage').then(m => ({ default: m.MitarbeiterPage })))
const AdminPage       = lazy(() => import('@/pages/AdminPage').then(m => ({ default: m.AdminPage })))
const ProjektePage    = lazy(() => import('@/pages/ProjektePage').then(m => ({ default: m.ProjektePage })))
const RechnungenPage  = lazy(() => import('@/pages/RechnungenPage').then(m => ({ default: m.RechnungenPage })))
const DatenPage       = lazy(() => import('@/pages/DatenPage').then(m => ({ default: m.DatenPage })))
const AngebotePage    = lazy(() => import('@/pages/AngebotePage').then(m => ({ default: m.AngebotePage })))
const ServicePage     = lazy(() => import('@/pages/service/ServicePage').then(m => ({ default: m.ServicePage })))
const ProfilePage     = lazy(() => import('@/pages/ProfilePage').then(m => ({ default: m.ProfilePage })))
const ForbiddenPage   = lazy(() => import('@/pages/auth/ForbiddenPage').then(m => ({ default: m.ForbiddenPage })))

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
            <Route path="/login/:slug"    element={<LoginPage />} />
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
              <Route path="/"            element={<ProtectedRoute anyOf={['dashboard.view']}><Suspense fallback={<PageLoader />}><DashboardPage /></Suspense></ProtectedRoute>} />
              <Route path="/adressen"    element={<ProtectedRoute anyOf={['addresses.view']}><Suspense fallback={<PageLoader />}><AdressenPage /></Suspense></ProtectedRoute>} />
              <Route path="/adressen/:id" element={<ProtectedRoute anyOf={['addresses.view']}><Suspense fallback={<PageLoader />}><AddressDetailPage /></Suspense></ProtectedRoute>} />
              <Route path="/projekte"    element={<ProtectedRoute anyOf={['projects.view']}><Suspense fallback={<PageLoader />}><ProjektePage /></Suspense></ProtectedRoute>} />
              <Route path="/daten"       element={<ProtectedRoute anyOf={['reports.view']}><Suspense fallback={<PageLoader />}><DatenPage /></Suspense></ProtectedRoute>} />
              <Route path="/rechnungen"  element={<ProtectedRoute anyOf={['invoices.view','dunning.view','security_retention.view']}><Suspense fallback={<PageLoader />}><RechnungenPage /></Suspense></ProtectedRoute>} />
              <Route path="/admin"       element={<ProtectedRoute anyOf={['settings.basedata.view','settings.basedata.edit','settings.defaults.edit','settings.notifications.edit','settings.monthly_close.edit','settings.company.view','settings.company.edit','settings.numbers.edit','settings.text_templates.edit','settings.dunning_config.edit','settings.work_time.edit','settings.cost_rate.edit','roles.view']}><Suspense fallback={<PageLoader />}><AdminPage /></Suspense></ProtectedRoute>} />
              <Route path="/mitarbeiter" element={<ProtectedRoute anyOf={['employees.view']}><Suspense fallback={<PageLoader />}><MitarbeiterPage /></Suspense></ProtectedRoute>} />
              <Route path="/angebote"   element={<ProtectedRoute anyOf={['offers.view']}><Suspense fallback={<PageLoader />}><AngebotePage /></Suspense></ProtectedRoute>} />
              <Route path="/service"    element={<ProtectedRoute anyOf={['service.suggestions.view','service.feedback.use','service.support.use']}><Suspense fallback={<PageLoader />}><ServicePage /></Suspense></ProtectedRoute>} />
              <Route path="/profil"     element={<Suspense fallback={<PageLoader />}><ProfilePage /></Suspense>} />
              <Route path="/403"        element={<Suspense fallback={<PageLoader />}><ForbiddenPage /></Suspense>} />
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
