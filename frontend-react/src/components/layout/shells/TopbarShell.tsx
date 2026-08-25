import { BrandWordmark } from '@/components/brand/BrandLogo'
import { TopNav }    from '../TopNav'
import { BottomNav } from '../BottomNav'
import { TimerBar }  from '../TimerBar'
import { NotificationBell } from '../NotificationBell'
import { UserMenu }  from '../UserMenu'
import type { ShellProps } from './types'

/**
 * Kopfleisten-Huelle: Navigation waagerecht oben, keine Seitenleiste. Der
 * Inhalt bekommt dadurch die volle Breite — bei den breiten Tabellen dieser
 * Anwendung ein spuerbarer Unterschied.
 *
 * Auf dem Handy bleibt alles wie gehabt: die waagerechte Leiste wird
 * ausgeblendet, die BottomNav uebernimmt.
 */
export function TopbarShell({ timerEnabled, children }: ShellProps) {
  return (
    <div className="app-layout shell-topbar">
      <a href="#hauptinhalt" className="skip-link">Zum Hauptinhalt springen</a>
      <header className="app-header">
        <div className="app-header-left">
          <BrandWordmark size={20} />
          <TopNav />
        </div>
        <div className="app-header-right">
          {timerEnabled && <TimerBar />}
          <NotificationBell />
          <UserMenu />
        </div>
      </header>
      <div className="app-body">
        <main className="app-main" id="hauptinhalt" tabIndex={-1}>
          {children}
        </main>
      </div>
      <BottomNav />
    </div>
  )
}
