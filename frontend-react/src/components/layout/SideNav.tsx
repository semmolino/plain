import { NavLink } from 'react-router-dom'
import {
  LayoutDashboard, BookUser, FolderOpen, BarChart3,
  Receipt, FileSignature, Users, Settings,
  type LucideIcon,
} from 'lucide-react'

interface NavItem {
  to:    string
  icon:  LucideIcon
  label: string
}

const NAV_ITEMS: NavItem[] = [
  { to: '/',            icon: LayoutDashboard, label: 'Übersicht'   },
  { to: '/adressen',    icon: BookUser,        label: 'Adressen'    },
  { to: '/projekte',    icon: FolderOpen,      label: 'Projekte'    },
  { to: '/daten',       icon: BarChart3,       label: 'Reporting'   },
  { to: '/rechnungen',  icon: Receipt,         label: 'Rechnungen'  },
  { to: '/angebote',    icon: FileSignature,   label: 'Angebote'    },
  { to: '/mitarbeiter', icon: Users,           label: 'Mitarbeiter' },
  { to: '/admin',       icon: Settings,        label: 'Einstellungen' },
]

export function SideNav() {
  return (
    <nav className="side-nav" aria-label="Hauptnavigation">
      {NAV_ITEMS.map(({ to, icon: Icon, label }) => (
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
