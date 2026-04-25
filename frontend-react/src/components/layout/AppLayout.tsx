import { Outlet } from 'react-router-dom'
import { BottomNav } from './BottomNav'
import { NotificationBell } from './NotificationBell'

export function AppLayout() {
  return (
    <div className="app-layout">
      <header className="app-header">
        <NotificationBell />
      </header>
      <main className="app-main">
        <Outlet />
      </main>
      <BottomNav />
    </div>
  )
}
