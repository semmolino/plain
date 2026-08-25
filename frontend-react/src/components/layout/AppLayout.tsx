import { useEffect } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { usePermissionsStore } from '@/store/permissionsStore'
import { useLicenseStore, useLicenseReadOnly } from '@/store/licenseStore'
import { useToast } from '@/store/toastStore'
import { ToastContainer } from '@/components/ui/Toast'
import { fetchDefaults } from '@/api/stammdaten'
import { ACTIVE_SHELL } from './shells'

/**
 * Rahmen aller geschuetzten Seiten. Enthaelt nur noch die uebergreifende
 * Logik (Permissions-Refresh, 403/402-Handler, Vorbelegungen); die sichtbare
 * Anordnung liefert die aktive Huelle aus ./shells.
 */
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

  const Shell = ACTIVE_SHELL
  return (
    <Shell timerEnabled={timerEnabled}>
      <ToastContainer />
      <LicenseReadOnlyBanner />
      <Outlet />
    </Shell>
  )
}

/** Hinweis-Banner bei abgelaufener Lizenz (Nur-Lese-Modus). */
function LicenseReadOnlyBanner() {
  const readOnly = useLicenseReadOnly()
  if (!readOnly) return null
  return (
    <div className="license-readonly-banner" role="status">
      Deine Lizenz ist abgelaufen — du hast derzeit nur Lesezugriff. Deine Daten bleiben erhalten.
      Bitte wende dich an plan&amp;simple, um die Lizenz zu verlängern.
    </div>
  )
}
