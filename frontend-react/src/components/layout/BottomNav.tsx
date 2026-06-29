import { NavLink } from 'react-router-dom'
import {
  LayoutDashboard, BookUser, FolderOpen, BarChart3,
  Receipt, FileSignature, Users, Settings, LifeBuoy,
  type LucideIcon,
} from 'lucide-react'
import { usePermissionsStore } from '@/store/permissionsStore'
import { useLicenseStore } from '@/store/licenseStore'

interface NavItem {
  to:    string
  icon:  LucideIcon
  label: string
  /** Eine Permission reicht (anyOf) — Item ist sichtbar, sobald eine erfuellt ist. */
  permissions: string[]
  feature?: string
}

const NAV_ITEMS: NavItem[] = [
  { to: '/',           icon: LayoutDashboard, label: 'Übersicht',     permissions: ['dashboard.view'], feature: 'core.dashboard' },
  { to: '/adressen',   icon: BookUser,        label: 'Adressen',      permissions: ['addresses.view'], feature: 'core.addresses' },
  { to: '/projekte',   icon: FolderOpen,      label: 'Projekte',      permissions: ['projects.view'], feature: 'projects.management' },
  { to: '/daten',      icon: BarChart3,       label: 'Reporting',     permissions: ['reports.view'], feature: 'reports.standard' },
  { to: '/rechnungen', icon: Receipt,         label: 'Rechnungen',    permissions: ['invoices.view','dunning.view','security_retention.view'], feature: 'invoices.basic' },
  { to: '/admin',      icon: Settings,        label: 'Einstellungen', permissions: ['settings.basedata.view','settings.basedata.edit','settings.defaults.edit','settings.notifications.edit','settings.monthly_close.edit','settings.company.view','settings.company.edit','settings.numbers.edit','settings.text_templates.edit','settings.dunning_config.edit','settings.work_time.edit','settings.cost_rate.edit','roles.view'], feature: 'settings.core' },
  { to: '/mitarbeiter',icon: Users,           label: 'Mitarbeiter',   permissions: ['employees.view'], feature: 'employees.management' },
  { to: '/angebote',   icon: FileSignature,   label: 'Angebote',      permissions: ['offers.view'], feature: 'offers.basic' },
  { to: '/service',    icon: LifeBuoy,        label: 'Service',       permissions: ['service.suggestions.view','service.feedback.use','service.support.use'] },
]

export function BottomNav() {
  const unrestricted = usePermissionsStore(s => s.unrestricted)
  const keys         = usePermissionsStore(s => s.keys)
  const licUnrestricted = useLicenseStore(s => s.unrestricted)
  const caps            = useLicenseStore(s => s.capabilities)
  const visibleItems = NAV_ITEMS.filter(it =>
    (unrestricted || it.permissions.some(p => keys.has(p))) &&
    (licUnrestricted || !it.feature || caps.has(it.feature))
  )
  return (
    <nav className="bottom-nav">
      {visibleItems.map(({ to, icon: Icon, label }) => (
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
