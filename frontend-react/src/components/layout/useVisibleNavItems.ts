import { usePermissionsStore } from '@/store/permissionsStore'
import { useLicenseStore } from '@/store/licenseStore'
import { NAV_ITEMS, type NavItem } from './navItems'

/**
 * Navigationseintraege, die der angemeldete Nutzer sehen darf.
 *
 * Derselbe Filter stand wortgleich in SideNav und BottomNav; mit der
 * Topbar-Variante waere er ein drittes Mal entstanden. Eine Abweichung
 * zwischen den Leisten faellt im Betrieb kaum auf, fuehrt aber dazu, dass
 * ein Modul auf dem Handy sichtbar ist und auf dem Desktop nicht.
 */
export function useVisibleNavItems(): NavItem[] {
  const unrestricted    = usePermissionsStore(s => s.unrestricted)
  const keys            = usePermissionsStore(s => s.keys)
  const licUnrestricted = useLicenseStore(s => s.unrestricted)
  const caps            = useLicenseStore(s => s.capabilities)

  return NAV_ITEMS.filter(it =>
    (unrestricted || it.permissions.some(p => keys.has(p))) &&
    (licUnrestricted || !it.feature || caps.has(it.feature))
  )
}
