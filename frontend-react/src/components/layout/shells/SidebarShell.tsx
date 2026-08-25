import { BrandMark } from '@/components/brand/BrandLogo'
import { SideNav }    from '../SideNav'
import { BottomNav }  from '../BottomNav'
import { TimerBar }   from '../TimerBar'
import { NotificationBell } from '../NotificationBell'
import { UserMenu }   from '../UserMenu'
import type { ShellProps } from './types'

/**
 * Standardhuelle: schmale Seitennavigation links, Kopfzeile mit Marke und
 * Stempeluhr, Bottom-Nav auf dem Handy.
 */
export function SidebarShell({ timerEnabled, children }: ShellProps) {
  return (
    <div className="app-layout shell-sidebar">
      {/* Ohne Skip-Link muessen Tastaturnutzer auf jeder Seite Header und
          Navigation komplett durchtabben, bevor sie den Inhalt erreichen. */}
      <a href="#hauptinhalt" className="skip-link">Zum Hauptinhalt springen</a>
      <header className="app-header">
        <div className="app-header-left">
          <BrandMark size={26} className="app-header-brand" />
          {timerEnabled && <TimerBar />}
        </div>
        <div className="app-header-right">
          <NotificationBell />
          <UserMenu />
        </div>
      </header>
      <div className="app-body">
        <SideNav />
        <main className="app-main" id="hauptinhalt" tabIndex={-1}>
          {children}
        </main>
      </div>
      <BottomNav />
    </div>
  )
}
