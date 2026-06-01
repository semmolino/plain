import { useState, useRef, useEffect } from 'react'
import { Outlet, useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { useAuthStore } from '@/store/authStore'
import { BottomNav } from './BottomNav'
import { NotificationBell } from './NotificationBell'
import { TimerBar } from './TimerBar'
import { ThemeSwitcher } from './ThemeSwitcher'
import { ToastContainer } from '@/components/ui/Toast'

function UserMenu() {
  const [open,       setOpen]       = useState(false)
  const [confirming, setConfirming] = useState(false)
  const wrapRef   = useRef<HTMLDivElement>(null)
  const shortName = useAuthStore(s => s.shortName)
  const clearAuth = useAuthStore(s => s.clearAuth)
  const navigate  = useNavigate()
  const qc        = useQueryClient()

  useEffect(() => {
    if (!open) return
    function onPointerDown(e: PointerEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false)
        setConfirming(false)
      }
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [open])

  function handleLogout() {
    qc.clear()
    clearAuth()
    navigate('/login')
  }

  return (
    <div className="user-menu-wrap" ref={wrapRef}>
      <button
        className="user-menu-btn"
        onClick={() => { setOpen(v => !v); setConfirming(false) }}
        aria-label="Benutzermenü"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="8" r="4"/>
          <path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/>
        </svg>
        {shortName && <span className="user-menu-name">{shortName}</span>}
      </button>

      {open && (
        <div className="user-menu-panel">
          <button className="user-menu-item" onClick={() => { navigate('/profil'); setOpen(false) }}>
            Profil
          </button>
          {confirming ? (
            <div className="user-menu-confirm">
              <span className="user-menu-confirm-text">Wirklich abmelden?</span>
              <div className="user-menu-confirm-btns">
                <button className="user-menu-confirm-yes" onClick={handleLogout}>Ja</button>
                <button className="user-menu-confirm-no"  onClick={() => setConfirming(false)}>Nein</button>
              </div>
            </div>
          ) : (
            <button className="user-menu-item danger" onClick={() => setConfirming(true)}>
              Abmelden
            </button>
          )}
        </div>
      )}
    </div>
  )
}

export function AppLayout() {
  return (
    <div className="app-layout">
      <header className="app-header">
        <div className="app-header-left">
          <TimerBar />
        </div>
        <div className="app-header-right">
          <ThemeSwitcher />
          <NotificationBell />
          <UserMenu />
        </div>
      </header>
      <main className="app-main">
        <ToastContainer />
        <Outlet />
      </main>
      <BottomNav />
    </div>
  )
}
