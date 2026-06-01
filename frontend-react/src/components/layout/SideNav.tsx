import { NavLink } from 'react-router-dom'

const NAV_ITEMS = [
  { to: '/',            icon: '▦',  label: 'Übersicht'   },
  { to: '/adressen',    icon: '📇', label: 'Adressen'    },
  { to: '/projekte',    icon: '📁', label: 'Projekte'    },
  { to: '/daten',       icon: '⏱',  label: 'Daten'       },
  { to: '/rechnungen',  icon: '🧾', label: 'Rechnungen'  },
  { to: '/angebote',    icon: '📄', label: 'Angebote'    },
  { to: '/mitarbeiter', icon: '👤', label: 'Mitarbeiter' },
  { to: '/admin',       icon: '⚙️', label: 'Admin'       },
]

export function SideNav() {
  return (
    <nav className="side-nav" aria-label="Hauptnavigation">
      {NAV_ITEMS.map(({ to, icon, label }) => (
        <NavLink
          key={to}
          to={to}
          end={to === '/'}
          className={({ isActive }) => 'side-nav-item' + (isActive ? ' active' : '')}
        >
          <span className="sn-icon">{icon}</span>
          <span className="sn-label">{label}</span>
        </NavLink>
      ))}
    </nav>
  )
}
