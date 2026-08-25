import { useState, useRef, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuthStore } from '@/store/authStore'
import { usePermissionsStore } from '@/store/permissionsStore'
import { useLicenseStore } from '@/store/licenseStore'
import { ThemeOptions, useAppliedTheme } from './ThemeOptions'
import { fetchMyAvatar } from '@/api/mitarbeiter'

/**
 * Benutzermenue der Kopfzeile. Lag frueher in AppLayout.tsx; seit es mehrere
 * Layout-Huellen gibt (Seitennavigation / Kopfleiste), braucht es beide.
 */
export function UserMenu() {
  const [open,       setOpen]       = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [themesOpen, setThemesOpen] = useState(false)
  const theme = useAppliedTheme()
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

          {/* Farbthema hing vorher als eigenes Dropdown dauerhaft in der
              Kopfzeile. Man stellt es einmal ein — der Platz dort gehoert
              zu den wertvollsten der App. */}
          <button
            className="user-menu-item"
            onClick={() => setThemesOpen(v => !v)}
            aria-expanded={themesOpen}
          >
            Darstellung
          </button>
          {themesOpen && <ThemeOptions current={theme.current} onSelect={theme.select} />}

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
