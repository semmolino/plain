import { NavLink } from 'react-router-dom'
import { BrandWordmark } from '@/components/brand/BrandLogo'
import { useVisibleNavItems } from './useVisibleNavItems'

export function SideNav() {
  const visibleItems = useVisibleNavItems()
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
