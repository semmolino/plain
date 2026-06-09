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
  { to: '/',           icon: LayoutDashboard, label: 'Übersicht'   },
  { to: '/adressen',   icon: BookUser,        label: 'Adressen'    },
  { to: '/projekte',   icon: FolderOpen,      label: 'Projekte'    },
  { to: '/daten',      icon: BarChart3,       label: 'Projekt-Reports' },
  { to: '/rechnungen', icon: Receipt,         label: 'Rechnungen'  },
  { to: '/admin',      icon: Settings,        label: 'Admin'       },
  { to: '/mitarbeiter',icon: Users,           label: 'Mitarbeiter' },
  { to: '/angebote',   icon: FileSignature,   label: 'Angebote'    },
]

export function BottomNav() {
  return (
    <nav className="bottom-nav">
      {NAV_ITEMS.map(({ to, icon: Icon, label }) => (
        <NavLink
          key={to}
          to={to}
          end={to === '/'}
          className={({ isActive }) =>
            'bottom-nav-item' + (isActive ? ' active' : '')
          }
        >
          <span className="bn-icon"><Icon size={20} strokeWidth={1.75} /></span>
          <span className="bn-label">{label}</span>
        </NavLink>
      ))}
    </nav>
  )
}
