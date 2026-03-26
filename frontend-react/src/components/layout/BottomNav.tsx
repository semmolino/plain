import { NavLink } from 'react-router-dom'

interface NavItem {
  to:    string
  icon:  string
  label: string
}

const NAV_ITEMS: NavItem[] = [
  { to: '/',           icon: '▦',  label: 'Übersicht'   },
  { to: '/adressen',   icon: '📇', label: 'Adressen'    },
  { to: '/projekte',   icon: '📁', label: 'Projekte'    },
  { to: '/daten',      icon: '⏱',  label: 'Daten'       },
  { to: '/rechnungen', icon: '🧾', label: 'Rechnungen'  },
  { to: '/admin',      icon: '⚙️', label: 'Admin'       },
  { to: '/mitarbeiter',icon: '👤', label: 'Mitarbeiter' },
]

export function BottomNav() {
  return (
    <nav className="bottom-nav">
      {NAV_ITEMS.map(({ to, icon, label }) => (
        <NavLink
          key={to}
          to={to}
          end={to === '/'}
          className={({ isActive }) =>
            'bottom-nav-item' + (isActive ? ' active' : '')
          }
        >
          <span className="bn-icon">{icon}</span>
          <span className="bn-label">{label}</span>
        </NavLink>
      ))}
    </nav>
  )
}
