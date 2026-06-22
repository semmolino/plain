import { useState, useRef, useEffect } from 'react'
import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuthStore } from '@/store/authStore'
import { usePermissionsStore } from '@/store/permissionsStore'
import { useLicenseStore } from '@/store/licenseStore'
import { useToast } from '@/store/toastStore'
import { BottomNav } from './BottomNav'
import { SideNav }   from './SideNav'
import { NotificationBell } from './NotificationBell'
import { TimerBar } from './TimerBar'
import { ThemeSwitcher } from './ThemeSwitcher'
import { ToastContainer } from '@/components/ui/Toast'
import { BrandMark } from '@/components/brand/BrandLogo'
import { fetchDefaults } from '@/api/stammdaten'
import { fetchMyAvatar } from '@/api/mitarbeiter'

function UserMenu() {
  const [open,       setOpen]       = useState(false)
  const [confirming, setConfirming] = useState(false)
  const wrapRef   = useRef<HTMLDivElement>(null)
  const shortName = useAuthStore(s => s.shortName)
  const clearAuth = useAuthStore(s => s.clearAuth)
  const navigate  = useNavigate()
  const qc        = useQueryClient()
  const { data: avatarData } = useQuery({ queryKey: ['my-avatar'], queryFn: fetchMyAvatar, staleTime: 60_000 })
  const avatarUri = avatarData?.data?.data_uri ?? null

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
    usePermissionsStore.getState().clear()
    useLicenseStore.getState().clear()
    navigate('/login')
  }

  return (
    <div className="user-menu-wrap" ref={wrapRef}>
      <button
        className="user-menu-btn"
        onClick={() => { setOpen(v => !v); setConfirming(false) }}
        aria-label="Benutzermenü"
      >
        {avatarUri ? (
          <img
            src={avatarUri}
            alt=""
            style={{ width: 22, height: 22, borderRadius: '50%', objectFit: 'cover', display: 'block' }}
          />
        ) : (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="8" r="4"/>
            <path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/>
          </svg>
        )}
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
  // Stempeluhr kann tenant-weit deaktiviert werden — default aktiv.
  const { data: defData } = useQuery({
    queryKey: ['defaults'], queryFn: fetchDefaults,
    staleTime: 60_000,
  })
  const timerEnabled = defData?.data?.timer_enabled !== 'false'

  const location = useLocation()
  const toast    = useToast()
  const reloadPermissions = usePermissionsStore(s => s.reload)

  // Phase 5: Permissions refreshen bei Navigation, max. 1x pro 30s.
  // Damit sieht ein User Rollen-Aenderungen, ohne sich neu einloggen zu muessen.
  useEffect(() => {
    const last = Number(sessionStorage.getItem('perm-last-reload') || 0)
    if (Date.now() - last > 30_000) {
      sessionStorage.setItem('perm-last-reload', String(Date.now()))
      void reloadPermissions()
    }
  }, [location.pathname, reloadPermissions])

  // Phase 5: globaler 403-Handler installieren -> Toast + Refresh
  useEffect(() => {
    const g = globalThis as typeof globalThis & { __onPermissionDenied?: (msg: string) => void }
    g.__onPermissionDenied = (msg: string) => {
      toast.error(msg || 'Du hast keine Berechtigung fuer diese Aktion.')
      void reloadPermissions()
    }
    return () => { g.__onPermissionDenied = undefined }
  }, [toast, reloadPermissions])

  // Lizenz: globaler 402-Handler -> Upgrade-Hinweis + Entitlement-Refresh
  useEffect(() => {
    const g = globalThis as typeof globalThis & { __onLicenseDenied?: (msg: string) => void }
    g.__onLicenseDenied = (msg: string) => {
      toast.error(msg || 'Diese Funktion ist in deinem Tarif nicht enthalten.')
      void useLicenseStore.getState().reload()
    }
    return () => { g.__onLicenseDenied = undefined }
  }, [toast])

  return (
    <div className="app-layout">
      <header className="app-header">
        <div className="app-header-left">
          <BrandMark size={26} className="app-header-brand" />
          {timerEnabled && <TimerBar />}
        </div>
        <div className="app-header-right">
          <ThemeSwitcher />
          <NotificationBell />
          <UserMenu />
        </div>
      </header>
      <div className="app-body">
        <SideNav />
        <main className="app-main">
          <ToastContainer />
          <Outlet />
        </main>
      </div>
      <BottomNav />
    </div>
  )
}
