import { Outlet } from 'react-router-dom'
import { BottomNav } from './BottomNav'
import { NotificationBell } from './NotificationBell'
import { TimerBar } from './TimerBar'

export function AppLayout() {
  return (
    <div className="app-layout">
      <header className="app-header">
        <div className="app-header-left">
          <TimerBar />
        </div>
        <div className="app-header-right">
          <NotificationBell />
        </div>
      </header>
      <main className="app-main">
        <Outlet />
      </main>
      <BottomNav />
    </div>
  )
}
