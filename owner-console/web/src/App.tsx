import { useEffect, useState } from 'react'
import { api, ApiError, getToken, setToken } from './api'
import { Login } from './pages/Login'
import { MatrixView } from './pages/Matrix'
import { InboxView } from './pages/Inbox'

type Tab = 'matrix' | 'inbox'

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
          <button className={tab === 'matrix' ? 'active' : ''} onClick={() => setTab('matrix')}>
            Matrix
          </button>
          <button className={tab === 'inbox' ? 'active' : ''} onClick={() => setTab('inbox')}>
            Inbox
          </button>
        </nav>
        <div className="spacer" />
        <span className="muted email">{email}</span>
        <button className="link" onClick={logout}>
          Abmelden
        </button>
      </header>
      <main className="content">{tab === 'matrix' ? <MatrixView /> : <InboxView />}</main>
    </div>
  )
}
