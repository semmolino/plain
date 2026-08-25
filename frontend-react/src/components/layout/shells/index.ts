import { SidebarShell } from './SidebarShell'

export type { ShellProps } from './types'
export { SidebarShell } from './SidebarShell'
export { TopbarShell }  from './TopbarShell'

/**
 * Aktive Layout-Huelle.
 *
 * DIES ist der Schalter fuer Ebene 5 eines Design-Versuchs: ein
 * Design-Branch tauscht hier eine Zeile, statt Seiten anzufassen. Alle
 * Seiten haengen ueber <Outlet/> unter der Huelle und wissen nichts von ihr.
 *
 *   export const ACTIVE_SHELL = TopbarShell
 */
export const ACTIVE_SHELL = SidebarShell
