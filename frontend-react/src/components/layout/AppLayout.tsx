import { Outlet } from 'react-router-dom'
import { BottomNav } from './BottomNav'

export function AppLayout() {
  return (
    <div className="app-layout">
      <main className="app-main">
        <Outlet />
      </main>
      <BottomNav />
    </div>
  )
}
