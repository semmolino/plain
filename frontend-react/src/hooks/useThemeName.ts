import { useEffect, useState } from 'react'

/**
 * Aktuelles Theme (`data-theme` am <html>), reaktiv beim Umschalten.
 *
 * Das Muster (useState + MutationObserver) lag vorher dreimal kopiert in
 * BranchEmptyState, DashboardHero und BranchIllustrations. `null` = Default-Theme.
 */
export function useThemeName(): string | null {
  const [theme, setTheme] = useState<string | null>(
    typeof document === 'undefined' ? null : document.documentElement.getAttribute('data-theme')
  )

  useEffect(() => {
    const read = () => setTheme(document.documentElement.getAttribute('data-theme'))
    read()
    const obs = new MutationObserver(read)
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
    return () => obs.disconnect()
  }, [])

  return theme
}

/** Themes mit dunklem Untergrund — relevant fuer Canvas-Farben (Charts). */
const DARK_THEMES = new Set(['dark'])

export function useIsDarkTheme(): boolean {
  return DARK_THEMES.has(useThemeName() ?? '')
}
