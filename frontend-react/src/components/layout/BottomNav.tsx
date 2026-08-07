import { useEffect, useState } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import { MoreHorizontal } from 'lucide-react'
import { usePermissionsStore } from '@/store/permissionsStore'
import { useLicenseStore } from '@/store/licenseStore'
import { NAV_ITEMS, MOBILE_PRIMARY_COUNT, type NavItem } from './navItems'

/** Maximale Anzahl Spalten in der Leiste — darueber wird "Mehr" eingeblendet. */
const MAX_BAR_ITEMS = MOBILE_PRIMARY_COUNT + 1

export function BottomNav() {
  const unrestricted    = usePermissionsStore(s => s.unrestricted)
  const keys            = usePermissionsStore(s => s.keys)
  const licUnrestricted = useLicenseStore(s => s.unrestricted)
  const caps            = useLicenseStore(s => s.capabilities)
  const [moreOpen, setMoreOpen] = useState(false)
  const location = useLocation()

  // Beim Navigieren schliessen — sonst bleibt das Sheet nach der Auswahl offen.
  useEffect(() => { setMoreOpen(false) }, [location.pathname])

  useEffect(() => {
    if (!moreOpen) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setMoreOpen(false) }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [moreOpen])

  const visible = NAV_ITEMS.filter(it =>
    (unrestricted || it.permissions.some(p => keys.has(p))) &&
    (licUnrestricted || !it.feature || caps.has(it.feature))
  )

  // Passt alles in die Leiste, braucht es kein "Mehr".
  const needsMore = visible.length > MAX_BAR_ITEMS

  // mobileRank entscheidet nur, WELCHE Eintraege in die Leiste kommen —
  // angezeigt werden sie in derselben Reihenfolge wie in der Seitennavigation.
  // Sonst haette dasselbe Modul auf Desktop und Handy eine andere Position.
  const inBar = new Set(
    [...visible].sort((a, b) => a.mobileRank - b.mobileRank).slice(0, MOBILE_PRIMARY_COUNT)
  )
  const primary  = needsMore ? visible.filter(it => inBar.has(it))  : visible
  const overflow = needsMore ? visible.filter(it => !inBar.has(it)) : []

  const overflowActive = overflow.some(it => it.to !== '/' && location.pathname.startsWith(it.to))

  const renderLink = (it: NavItem, cls: string) => (
    <NavLink
      key={it.to}
      to={it.to}
      end={it.to === '/'}
      className={({ isActive }) => cls + (isActive ? ' active' : '')}
    >
      <span className="bn-icon"><it.icon size={20} strokeWidth={1.75} /></span>
      <span className="bn-label">{it.label}</span>
    </NavLink>
  )

  return (
    <>
      {moreOpen && (
        <div
          className="bn-more-backdrop"
          onClick={() => setMoreOpen(false)}
          aria-hidden="true"
        />
      )}

      <nav className="bottom-nav" aria-label="Hauptnavigation">
        {primary.map(it => renderLink(it, 'bottom-nav-item'))}

        {needsMore && (
          <button
            type="button"
            className={'bottom-nav-item bn-more-btn' + (moreOpen || overflowActive ? ' active' : '')}
            onClick={() => setMoreOpen(v => !v)}
            aria-expanded={moreOpen}
            aria-haspopup="menu"
          >
            <span className="bn-icon"><MoreHorizontal size={20} strokeWidth={1.75} /></span>
            <span className="bn-label">Mehr</span>
          </button>
        )}
      </nav>

      {moreOpen && (
        <div className="bn-more-sheet" role="menu" aria-label="Weitere Bereiche">
          {overflow.map(it => renderLink(it, 'bn-more-item'))}
        </div>
      )}
    </>
  )
}
