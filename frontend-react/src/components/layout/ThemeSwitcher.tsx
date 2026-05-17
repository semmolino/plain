import { useRef, useState, useEffect } from 'react'

const THEMES = [
  { id: 'light',  label: 'Light',        swatch: '#2563eb' },
  { id: 'modern', label: 'Modern',       swatch: '#d4714e' },
  { id: 'mossy',  label: 'Mossy',        swatch: '#174d38' },
  { id: 'earth',  label: 'Earth',        swatch: '#464646' },
  { id: 'winter', label: 'Winter Chill', swatch: '#4f7c82' },
  { id: 'dark',   label: 'Dark',         swatch: '#7a7ac6' },
] as const

type ThemeId = typeof THEMES[number]['id']

function applyTheme(id: ThemeId) {
  if (id === 'light') {
    document.documentElement.removeAttribute('data-theme')
  } else {
    document.documentElement.setAttribute('data-theme', id)
  }
  localStorage.setItem('plain-theme', id)
}

export function ThemeSwitcher() {
  const [open, setOpen] = useState(false)
  const [current, setCurrent] = useState<ThemeId>('light')
  const wrapRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const saved = (localStorage.getItem('plain-theme') ?? 'light') as ThemeId
    setCurrent(saved)
    applyTheme(saved)
  }, [])

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
    setOpen(false)
  }

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
          <div className="theme-panel-header">Farbthema</div>
          {THEMES.map(t => (
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
      )}
    </div>
  )
}
