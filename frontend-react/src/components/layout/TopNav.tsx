import { NavLink } from 'react-router-dom'
import { useVisibleNavItems } from './useVisibleNavItems'

/**
 * Waagerechte Hauptnavigation in der Kopfleiste — Gegenstueck zu SideNav
 * fuer die Topbar-Huelle. Speist sich aus derselben navItems.ts, damit
 * Reihenfolge und Sichtbarkeit nicht auseinanderlaufen.
 *
 * Nur Desktop: unterhalb von 1024px uebernimmt weiterhin die BottomNav,
 * die Leiste wird dort per CSS ausgeblendet.
 *
 * aria-label/title sind hier Pflicht, kein Beiwerk: zwischen 1024 und
 * 1439px blendet globals.css die Beschriftungen aus (zehn Module passen
 * dort nicht neben Marke, Stempeluhr und Benutzermenue). display:none
 * nimmt sie aber auch aus dem Baum fuer Hilfsmittel — die Links haetten
 * dann ueberhaupt keinen Namen mehr (axe: link-name). Das title-Attribut
 * gibt zugleich der Maus eine Kurzinfo, solange nur Symbole stehen.
 */
export function TopNav() {
  const items = useVisibleNavItems()
  return (
    <nav className="top-nav" aria-label="Hauptnavigation">
      {items.map(({ to, icon: Icon, label }) => (
        <NavLink
          key={to}
          to={to}
          end={to === '/'}
          className={({ isActive }) => 'top-nav-item' + (isActive ? ' active' : '')}
          aria-label={label}
          title={label}
        >
          <span className="tn-icon"><Icon size={16} strokeWidth={1.75} /></span>
          <span className="tn-label">{label}</span>
        </NavLink>
      ))}
    </nav>
  )
}
