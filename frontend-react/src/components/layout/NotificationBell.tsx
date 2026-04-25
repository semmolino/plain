import { useRef, useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  fetchNotifications,
  markNotificationRead,
  markAllNotificationsRead,
  type Notification,
} from '@/api/notifications'

const fmtTime = (iso: string) => {
  const d = new Date(iso)
  const now = new Date()
  const diffMs = now.getTime() - d.getTime()
  const diffMin = Math.floor(diffMs / 60_000)
  if (diffMin < 1)  return 'Gerade eben'
  if (diffMin < 60) return `vor ${diffMin} Min.`
  const diffH = Math.floor(diffMin / 60)
  if (diffH < 24)   return `vor ${diffH} Std.`
  const diffD = Math.floor(diffH / 24)
  return `vor ${diffD} Tag${diffD > 1 ? 'en' : ''}`
}

export function NotificationBell() {
  const [open, setOpen] = useState(false)
  const panelRef = useRef<HTMLDivElement>(null)
  const navigate = useNavigate()
  const qc = useQueryClient()

  const { data } = useQuery({
    queryKey: ['notifications'],
    queryFn:  fetchNotifications,
    refetchInterval: 30_000,
  })

  const notifications: Notification[] = data?.data ?? []
  const unreadCount = data?.unread_count ?? 0

  // Close panel when clicking outside
  useEffect(() => {
    if (!open) return
    function onPointerDown(e: PointerEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [open])

  async function handleClick(n: Notification) {
    if (!n.READ_AT) {
      await markNotificationRead(n.ID)
      qc.invalidateQueries({ queryKey: ['notifications'] })
    }
    setOpen(false)
    if (n.LINK) navigate(n.LINK)
  }

  async function handleMarkAllRead() {
    await markAllNotificationsRead()
    qc.invalidateQueries({ queryKey: ['notifications'] })
  }

  return (
    <div className="notif-bell-wrap" ref={panelRef}>
      <button
        className="notif-bell-btn"
        onClick={() => setOpen(v => !v)}
        aria-label="Benachrichtigungen"
      >
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
          <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
        </svg>
        {unreadCount > 0 && (
          <span className="notif-badge">{unreadCount > 99 ? '99+' : unreadCount}</span>
        )}
      </button>

      {open && (
        <div className="notif-panel">
          <div className="notif-panel-header">
            <span>Benachrichtigungen</span>
            {unreadCount > 0 && (
              <button className="notif-read-all" onClick={handleMarkAllRead}>
                Alle gelesen
              </button>
            )}
          </div>

          <div className="notif-list">
            {notifications.length === 0 && (
              <p className="notif-empty">Keine Benachrichtigungen</p>
            )}
            {notifications.map(n => (
              <button
                key={n.ID}
                className={`notif-item${n.READ_AT ? ' read' : ''}`}
                onClick={() => handleClick(n)}
              >
                {!n.READ_AT && <span className="notif-dot" />}
                <div className="notif-content">
                  <span className="notif-title">{n.TITLE}</span>
                  {n.BODY && <span className="notif-body">{n.BODY}</span>}
                  <span className="notif-time">{fmtTime(n.CREATED_AT)}</span>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
