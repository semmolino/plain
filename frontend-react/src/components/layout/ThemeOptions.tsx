import { useEffect, useState } from 'react'
import { Check } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { useAuthStore } from '@/store/authStore'
import { fetchDefaults } from '@/api/stammdaten'

/**
 * Auswahl des Farbthemas — ohne eigenen Auslöser.
 *
 * Vorher hing die Auswahl als eigenes Dropdown dauerhaft in der Kopfzeile,
 * neben Glocke und Benutzermenü. Das Thema stellt man aber einmal ein und
 * danach praktisch nie wieder; der Platz in der Kopfzeile gehoert zu den
 * wertvollsten der App. Die Liste lebt jetzt im Benutzermenü.
 */

const THEMES = [
  { id: 'light',             label: 'Hell',                  swatch: '#2563eb', group: 'Standard' },
  { id: 'dark',              label: 'Dunkel',                swatch: '#7a7ac6', group: 'Standard' },
  { id: 'architecture-foto', label: 'Architektur',           swatch: '#c97b5a', group: 'Branche' },
  { id: 'civil-foto',        label: 'Tiefbau',               swatch: '#c8965a', group: 'Branche' },
  { id: 'urban-foto',        label: 'Stadt- und Verkehr',    swatch: '#e9b94c', group: 'Branche' },
  { id: 'tga-foto',          label: 'TGA',                   swatch: '#c79252', group: 'Branche' },
  { id: 'structural-foto',   label: 'Tragwerk',              swatch: '#4c6680', group: 'Branche' },
] as const

export type ThemeId = typeof THEMES[number]['id']

const VALID_IDS = new Set<string>(THEMES.map(t => t.id))
const storageKey = (employeeId: number | null) => employeeId ? `plain-theme-${employeeId}` : 'plain-theme'

function applyTheme(id: ThemeId) {
  if (id === 'light') document.documentElement.removeAttribute('data-theme')
  else document.documentElement.setAttribute('data-theme', id)
  syncThemeColor()
}

/**
 * Haelt <meta name="theme-color"> am --chrome-Token.
 *
 * Der Wert faerbt die Systemleiste in der installierten PWA und in der
 * Capacitor-App. Er stand fest auf #2b54e0 — einem Blau, das zu keinem
 * Theme gehoert; im Dark-Theme und in allen Branchen-Themes passte die
 * Systemleiste damit nicht zur App.
 */
function syncThemeColor() {
  const chrome = getComputedStyle(document.documentElement)
    .getPropertyValue('--chrome').trim()
  if (!chrome) return
  let meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')
  if (!meta) {
    meta = document.createElement('meta')
    meta.name = 'theme-color'
    document.head.appendChild(meta)
  }
  meta.content = chrome
}

/** User-Einstellung > Tenant-Vorgabe > 'light'. */
function pickInitial(userOverride: string | null, tenantDefault: string | null): ThemeId {
  if (userOverride && VALID_IDS.has(userOverride))   return userOverride as ThemeId
  if (tenantDefault && VALID_IDS.has(tenantDefault)) return tenantDefault as ThemeId
  return 'light'
}

/**
 * Setzt das gespeicherte Theme beim Start. Muss genau einmal in der
 * App-Shell haengen — auch dann, wenn die Auswahlliste gar nicht offen ist.
 */
export function useAppliedTheme() {
  const [current, setCurrent] = useState<ThemeId>('light')
  const employeeId = useAuthStore(s => s.employeeId)

  const { data } = useQuery({
    queryKey: ['defaults'], queryFn: fetchDefaults,
    staleTime: 60_000, enabled: !!employeeId,
  })
  const tenantDefault = (data?.data as Record<string, string> | undefined)?.['tenant.theme_default'] ?? null

  useEffect(() => {
    const id = pickInitial(localStorage.getItem(storageKey(employeeId)), tenantDefault)
    setCurrent(id)
    applyTheme(id)
  }, [employeeId, tenantDefault])

  function select(id: ThemeId) {
    applyTheme(id)
    setCurrent(id)
    localStorage.setItem(storageKey(employeeId), id)
  }

  return { current, select }
}

interface Props {
  current: ThemeId
  onSelect: (id: ThemeId) => void
}

export function ThemeOptions({ current, onSelect }: Props) {
  return (
    <div className="theme-options" role="group" aria-label="Farbthema">
      {(['Standard', 'Branche'] as const).map(group => (
        <div key={group}>
          <div className="theme-panel-header">{group}</div>
          {THEMES.filter(t => t.group === group).map(t => (
            <button
              key={t.id}
              type="button"
              className={`theme-option${current === t.id ? ' active' : ''}`}
              onClick={() => onSelect(t.id)}
              aria-pressed={current === t.id}
            >
              <span className="theme-swatch" style={{ background: t.swatch }} />
              {t.label}
              {current === t.id && <Check size={14} strokeWidth={2.5} className="theme-check" />}
            </button>
          ))}
        </div>
      ))}
    </div>
  )
}
