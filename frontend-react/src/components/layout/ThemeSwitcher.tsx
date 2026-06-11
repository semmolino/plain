import { useRef, useState, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useAuthStore } from '@/store/authStore'
import { fetchDefaults } from '@/api/stammdaten'

const THEMES = [
  // Standard
  { id: 'light',  label: 'Light',                  swatch: '#2563eb', group: 'Standard'   },
  { id: 'dark',   label: 'Dark',                   swatch: '#7a7ac6', group: 'Standard'   },

  // Atmosphäre
  { id: 'modern', label: 'Modern',                 swatch: '#d4714e', group: 'Atmosphäre' },
  { id: 'forest', label: 'Forest',                 swatch: '#174d38', group: 'Atmosphäre' },
  { id: 'earth',  label: 'Earth',                  swatch: '#464646', group: 'Atmosphäre' },
  { id: 'winter', label: 'Winter Chill',           swatch: '#4f7c82', group: 'Atmosphäre' },

  // Branche
  { id: 'architecture', label: 'Architektur',                swatch: '#c97b5a', group: 'Branche' },
  { id: 'civil',        label: 'Tiefbau',                    swatch: '#c8965a', group: 'Branche' },
  { id: 'urban',        label: 'Stadt-/Verkehrsplanung',     swatch: '#e9b94c', group: 'Branche' },
  { id: 'tga',          label: 'Technische Ausrüstung',      swatch: '#c79252', group: 'Branche' },
  { id: 'structural',   label: 'Tragwerksplanung',           swatch: '#4c6680', group: 'Branche' },
] as const

export type ThemeId = typeof THEMES[number]['id']

const VALID_IDS = new Set<string>(THEMES.map(t => t.id))

function storageKey(employeeId: number | null) {
  return employeeId ? `plain-theme-${employeeId}` : 'plain-theme'
}

function applyTheme(id: ThemeId) {
  if (id === 'light') {
    document.documentElement.removeAttribute('data-theme')
  } else {
    document.documentElement.setAttribute('data-theme', id)
  }
}

/** Bestimmt das initiale Theme: User-Override (localStorage) > Tenant-Default > 'light'. */
function pickInitial(userOverride: string | null, tenantDefault: string | null): ThemeId {
  if (userOverride && VALID_IDS.has(userOverride))   return userOverride as ThemeId
  if (tenantDefault && VALID_IDS.has(tenantDefault)) return tenantDefault as ThemeId
  return 'light'
}

export function ThemeSwitcher() {
  const [open, setOpen] = useState(false)
  const [current, setCurrent] = useState<ThemeId>('light')
  const wrapRef = useRef<HTMLDivElement>(null)
  const employeeId = useAuthStore(s => s.employeeId)

  const { data: defaultsData } = useQuery({
    queryKey: ['defaults'],
    queryFn:  fetchDefaults,
    staleTime: 60_000,
    enabled:   !!employeeId,
  })
  const tenantDefault = (defaultsData?.data as Record<string, string> | undefined)?.['tenant.theme_default'] ?? null

  useEffect(() => {
    const userOverride = localStorage.getItem(storageKey(employeeId))
    const id = pickInitial(userOverride, tenantDefault)
    setCurrent(id)
    applyTheme(id)
  }, [employeeId, tenantDefault])

  useEffect(() => {
    if (!open) return
    function onPointerDown(e: PointerEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [open])

  function select(id: ThemeId) {
    applyTheme(id)
    setCurrent(id)
    localStorage.setItem(storageKey(employeeId), id)
    setOpen(false)
  }

  // Gruppieren fuer die Anzeige
  const groups = ['Standard', 'Atmosphäre', 'Branche'] as const

  return (
    <div className="theme-switcher-wrap" ref={wrapRef}>
      <button
        className="theme-btn"
        onClick={() => setOpen(v => !v)}
        aria-label="Farbthema wechseln"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="13.5" cy="6.5" r=".5" fill="currentColor" stroke="none"/>
          <circle cx="17.5" cy="10.5" r=".5" fill="currentColor" stroke="none"/>
          <circle cx="8.5" cy="7.5" r=".5" fill="currentColor" stroke="none"/>
          <circle cx="6.5" cy="12.5" r=".5" fill="currentColor" stroke="none"/>
          <path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z"/>
        </svg>
      </button>

      {open && (
        <div className="theme-panel">
          {groups.map(g => {
            const items = THEMES.filter(t => t.group === g)
            if (items.length === 0) return null
            return (
              <div key={g}>
                <div className="theme-panel-header">{g}</div>
                {items.map(t => (
                  <button
                    key={t.id}
                    className={`theme-option${current === t.id ? ' active' : ''}`}
                    onClick={() => select(t.id)}
                  >
                    <span className="theme-swatch" style={{ background: t.swatch }} />
                    {t.label}
                    {current === t.id && <span className="theme-check">✓</span>}
                  </button>
                ))}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
