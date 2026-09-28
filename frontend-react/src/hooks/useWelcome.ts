import { useState } from 'react'
import { useSession } from '@/hooks/useSession'

const WELCOME_KEY = 'plansimple.welcome_dismissed'

/**
 * Sichtbarkeit des Einfuehrungs-Panels, je Organisation gemerkt.
 *
 * Eigener Hook (UI-Pilot 2026-09): die Uebersicht bietet „Einführung anzeigen"
 * jetzt im ⋯-Menue des Seitenkopfs an statt als eigene Zeile auf der Seite.
 */
export function useWelcome() {
  const { tenantId } = useSession()
  const key = `${WELCOME_KEY}_${tenantId ?? 'anon'}`
  const [open, setOpen] = useState<boolean>(() => {
    try { return localStorage.getItem(key) !== '1' } catch { return true }
  })
  function dismiss() {
    setOpen(false)
    try { localStorage.setItem(key, '1') } catch { /* ignore */ }
  }
  return { open, dismiss, reopen: () => setOpen(true) }
}
