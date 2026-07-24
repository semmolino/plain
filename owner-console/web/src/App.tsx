import { useCallback, useEffect, useState } from 'react'
import { api, ApiError, getToken, onUnauthorized, setToken } from './api'
import { Login } from './pages/Login'
import { MatrixView } from './pages/Matrix'
import { InboxView } from './pages/Inbox'
import { PlansView } from './pages/Plans'
import { TenantsView } from './pages/Tenants'
import { AuditView } from './pages/Audit'
import { FunctionsView } from './pages/Functions'
import { SuggestionsView } from './pages/Suggestions'
import { RequestsView } from './pages/Requests'
import { AnalyticsView } from './pages/Analytics'
import { SecurityView } from './pages/Security'

type Tab =
  | 'inbox' | 'matrix' | 'plans' | 'tenants' | 'functions'
  | 'audit' | 'suggestions' | 'requests' | 'analytics'

interface TabDef { id: Tab; label: string; group: 'license' | 'service' }

// Reihenfolge: erst der Handlungsbedarf (Inbox), dann die Lizenz-Konfiguration,
// dann die Service-Themen. Die Gruppen werden in der Navigation getrennt.
const TABS: TabDef[] = [
  { id: 'inbox', label: 'Inbox', group: 'license' },
  { id: 'matrix', label: 'Matrix', group: 'license' },
  { id: 'plans', label: 'Pläne', group: 'license' },
  { id: 'tenants', label: 'Tenants', group: 'license' },
  { id: 'functions', label: 'Funktionen', group: 'license' },
  { id: 'audit', label: 'Protokoll', group: 'license' },
  { id: 'suggestions', label: 'Vorschläge', group: 'service' },
  { id: 'requests', label: 'Anfragen', group: 'service' },
  { id: 'analytics', label: 'Auswertung', group: 'service' },
]
const TAB_IDS = new Set(TABS.map((t) => t.id))

function readHash(): { tab: Tab; ref: string | null } {
  const raw = window.location.hash.replace(/^#\/?/, '')
  const [tab, ref] = raw.split('/')
  return {
    tab: TAB_IDS.has(tab as Tab) ? (tab as Tab) : 'inbox',
    ref: ref ? decodeURIComponent(ref) : null,
  }
}

export function App() {
  const [authed, setAuthed] = useState<boolean>(!!getToken())
  const [email, setEmail] = useState<string>('')
  const [route, setRoute] = useState(readHash())
  const [checking, setChecking] = useState<boolean>(!!getToken())
  const [showSecurity, setShowSecurity] = useState(false)
  const [totpEnabled, setTotpEnabled] = useState<boolean | null>(null)

  // Tab-Zustand in der URL (Reload-fest, Deep-Links aus der Inbox).
  useEffect(() => {
    const onHash = () => setRoute(readHash())
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  // Globales 401-Handling: abgelaufene Sitzung -> zurück zum Login.
  useEffect(() => {
    onUnauthorized(() => {
      setToken(null)
      setAuthed(false)
      setEmail('')
    })
  }, [])

  useEffect(() => {
    if (!getToken()) return
    api
      .me()
      .then((me) => {
        setEmail(me.email)
        setTotpEnabled(!!me.totp_enabled)
        setAuthed(true)
      })
      .catch((e: unknown) => {
        if (e instanceof ApiError && e.status === 401) {
          setToken(null)
          setAuthed(false)
        }
      })
      .finally(() => setChecking(false))
  }, [])

  const navigate = useCallback((tab: string, ref?: string) => {
    window.location.hash = ref ? `/${tab}/${encodeURIComponent(ref)}` : `/${tab}`
  }, [])

  function logout() {
    setToken(null)
    setAuthed(false)
    setEmail('')
  }

  if (checking) return <div className="center muted">Lädt…</div>
  if (!authed) {
    return (
      <Login
        onSuccess={(em) => {
          setEmail(em)
          setShowSecurity(false)
          api.me().then((me) => setTotpEnabled(!!me.totp_enabled)).catch(() => {})
          setAuthed(true)
        }}
      />
    )
  }

  const { tab, ref } = route

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          plan<span>&amp;</span>simple <small>Owner-Konsole</small>
        </div>
        <nav className="tabs">
          {TABS.map((t, i) => {
            const prev = TABS[i - 1]
            const sep = prev && prev.group !== t.group
            return (
              <span key={t.id} className="tab-slot">
                {sep && <span className="tab-sep" aria-hidden />}
                <button className={tab === t.id ? 'active' : ''} onClick={() => navigate(t.id)}>
                  {t.label}
                </button>
              </span>
            )
          })}
        </nav>
        <div className="spacer" />
        <span className="muted email">{email}</span>
        <button className="link" onClick={() => setShowSecurity(true)} title="Konto & Sicherheit">
          Konto{totpEnabled === false ? ' ⚠' : ''}
        </button>
        <button className="link" onClick={logout}>
          Abmelden
        </button>
      </header>
      {totpEnabled === false && !showSecurity && (
        <div className="nag-bar">
          2FA ist für dein Konto nicht aktiv. Diese Konsole steuert alle Mandanten —{' '}
          <button className="link" onClick={() => setShowSecurity(true)}>jetzt einrichten</button>.
        </div>
      )}
      <main className="content">
        {showSecurity ? (
          <SecurityView onClose={() => setShowSecurity(false)} onSessionInvalidated={logout} />
        ) : (
          <>
        {tab === 'inbox' && <InboxView onNavigate={navigate} />}
        {tab === 'matrix' && <MatrixView focusRef={ref} />}
        {tab === 'plans' && <PlansView />}
        {tab === 'tenants' && <TenantsView focusRef={ref} />}
        {tab === 'functions' && <FunctionsView focusRef={ref} />}
        {tab === 'audit' && <AuditView />}
        {tab === 'suggestions' && <SuggestionsView />}
        {tab === 'requests' && <RequestsView />}
        {tab === 'analytics' && <AnalyticsView />}
          </>
        )}
      </main>
    </div>
  )
}
