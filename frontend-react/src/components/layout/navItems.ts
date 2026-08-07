import {
  LayoutDashboard, BookUser, FolderOpen, BarChart3,
  Receipt, FileSignature, FileDiff, Users, Settings, LifeBuoy,
  type LucideIcon,
} from 'lucide-react'

export interface NavItem {
  to:    string
  icon:  LucideIcon
  label: string
  /** Eine Permission reicht (anyOf) — Item ist sichtbar, sobald eine erfuellt ist. */
  permissions: string[]
  feature?: string
  /**
   * Rang fuer die mobile Leiste. Nur die MOBILE_PRIMARY_COUNT niedrigsten
   * Raenge kommen in die Bottom-Nav, der Rest wandert hinter "Mehr".
   * Zehn Eintraege nebeneinander ergaeben auf einem 390px-Geraet 39px pro
   * Ziel — unter den 44px, die CLAUDE.md fordert.
   */
  mobileRank: number
}

const SETTINGS_PERMISSIONS = [
  'settings.basedata.view', 'settings.basedata.edit', 'settings.defaults.edit',
  'settings.notifications.edit', 'settings.monthly_close.edit', 'settings.company.view',
  'settings.company.edit', 'settings.numbers.edit', 'settings.text_templates.edit',
  'settings.dunning_config.edit', 'settings.work_time.edit', 'settings.cost_rate.edit',
  'roles.view',
]

/**
 * EINE Quelle fuer Seiten- und Bottom-Navigation.
 *
 * Vorher pflegten SideNav.tsx und BottomNav.tsx zwei getrennte Arrays, die
 * auseinandergelaufen waren: "Einstellungen" stand auf dem Desktop an
 * Position 10, auf dem Handy an Position 6. Wer zwischen Geraeten wechselt,
 * verliert dadurch die Ortskenntnis.
 */
export const NAV_ITEMS: NavItem[] = [
  { to: '/',            icon: LayoutDashboard, label: 'Übersicht',     permissions: ['dashboard.view'],  feature: 'core.dashboard',           mobileRank: 1 },
  { to: '/adressen',    icon: BookUser,        label: 'Adressen',      permissions: ['addresses.view'],  feature: 'core.addresses',           mobileRank: 4 },
  { to: '/projekte',    icon: FolderOpen,      label: 'Projekte',      permissions: ['projects.view'],   feature: 'projects.management',      mobileRank: 2 },
  { to: '/daten',       icon: BarChart3,       label: 'Reporting',     permissions: ['reports.view'],    feature: 'reports.standard',         mobileRank: 6 },
  { to: '/rechnungen',  icon: Receipt,         label: 'Rechnungen',    permissions: ['invoices.view','dunning.view','security_retention.view'], feature: 'invoices.basic', mobileRank: 3 },
  { to: '/angebote',    icon: FileSignature,   label: 'Angebote',      permissions: ['offers.view'],     feature: 'offers.basic',             mobileRank: 5 },
  { to: '/nachtraege',  icon: FileDiff,        label: 'Nachträge',     permissions: ['nachtraege.view'], feature: 'nachtraege.management',    mobileRank: 7 },
  { to: '/mitarbeiter', icon: Users,           label: 'Mitarbeiter',   permissions: ['employees.view','absence.view','absence.request'], feature: 'employees.management', mobileRank: 8 },
  { to: '/service',     icon: LifeBuoy,        label: 'Service',       permissions: ['service.suggestions.view','service.feedback.use','service.support.use'], mobileRank: 9 },
  { to: '/admin',       icon: Settings,        label: 'Einstellungen', permissions: SETTINGS_PERMISSIONS, feature: 'settings.core',           mobileRank: 10 },
]

/**
 * 5 Ziele + "Mehr" = 6 Spalten → 65px auf einem 390px-Geraet.
 * Vorher standen bis zu 10 Eintraege nebeneinander (39px, unter den 44px
 * aus CLAUDE.md). Mehr als 6 Spalten wuerden die Grenze wieder reissen.
 */
export const MOBILE_PRIMARY_COUNT = 5
