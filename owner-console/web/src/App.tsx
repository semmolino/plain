import { useEffect, useState } from 'react'
import { api, ApiError, getToken, setToken } from './api'
import { Login } from './pages/Login'
import { MatrixView } from './pages/Matrix'
import { InboxView } from './pages/Inbox'
import { PlansView } from './pages/Plans'
import { TenantsView } from './pages/Tenants'
import { AuditView } from './pages/Audit'
import { FunctionsView } from './pages/Functions'
import { SuggestionsView } from './pages/Suggestions'

type Tab = 'matrix' | 'plans' | 'tenants' | 'functions' | 'suggestions' | 'inbox' | 'audit'

const TABS: { id: Tab; label: string }[] = [
  { id: 'matrix', label: 'Matrix' },
  { id: 'plans', label: 'Pläne' },
  { id: 'tenants', label: 'Tenants' },
  { id: 'functions', label: 'Funktionen' },
  { id: 'suggestions', label: 'Vorschläge' },
  { id: 'inbox', label: 'Inbox' },
  { id: 'audit', label: 'Audit' },
]

export function App() {
  const [authed, setAuthed] = useState<boolean>(!!getToken())
  const [email, setEmail] = useState<string>('')
  const [tab, setTab] = useState<Tab>('matrix')
  const [checking, setChecking] = useState<boolean>(!!getToken())

  useEffect(() => {
    if (!getToken()) return
    api
      .me()
      .then((me) => {
        setEmail(me.email)
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
          setAuthed(true)
        }}
      />
    )
  }

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          plan<span>&amp;</span>simple <small>Owner-Konsole</small>
        </div>
        <nav className="tabs">
          {TABS.map((t) => (
            <button key={t.id} className={tab === t.id ? 'active' : ''} onClick={() => setTab(t.id)}>
              {t.label}
            </button>
          ))}
        </nav>
        <div className="spacer" />
        <span className="muted email">{email}</span>
        <button className="link" onClick={logout}>
          Abmelden
        </button>
      </header>
      <main className="content">
        {tab === 'matrix' && <MatrixView />}
        {tab === 'plans' && <PlansView />}
        {tab === 'tenants' && <TenantsView />}
        {tab === 'functions' && <FunctionsView />}
        {tab === 'suggestions' && <SuggestionsView />}
        {tab === 'inbox' && <InboxView />}
        {tab === 'audit' && <AuditView />}
      </main>
    </div>
  )
}
