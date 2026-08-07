import { NavLink } from 'react-router-dom'
import { usePermissionsStore } from '@/store/permissionsStore'
import { useLicenseStore } from '@/store/licenseStore'
import { BrandWordmark } from '@/components/brand/BrandLogo'
import { NAV_ITEMS } from './navItems'

export function SideNav() {
  const unrestricted = usePermissionsStore(s => s.unrestricted)
  const keys         = usePermissionsStore(s => s.keys)
  const licUnrestricted = useLicenseStore(s => s.unrestricted)
  const caps            = useLicenseStore(s => s.capabilities)
  const visibleItems = NAV_ITEMS.filter(it =>
    (unrestricted || it.permissions.some(p => keys.has(p))) &&
    (licUnrestricted || !it.feature || caps.has(it.feature))
  )
  return (
    <nav className="side-nav" aria-label="Hauptnavigation">
      <div className="side-nav-brand">
        <BrandWordmark size={22} />
      </div>
      {visibleItems.map(({ to, icon: Icon, label }) => (
        <NavLink
          key={to}
          to={to}
          end={to === '/'}
          className={({ isActive }) => 'side-nav-item' + (isActive ? ' active' : '')}
        >
          <span className="sn-icon"><Icon size={18} strokeWidth={1.75} /></span>
          <span className="sn-label">{label}</span>
        </NavLink>
      ))}
    </nav>
  )
}
