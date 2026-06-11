import { useEffect, useState } from 'react'
import { getThemePhoto } from '@/config/themePhotos'

/**
 * Schmaler Foto-Hero fuers Dashboard. Wird nur sichtbar, wenn das aktuelle
 * data-theme eine "-foto"-Variante mit hinterlegtem Bild ist. Strich- und
 * Standard-Themes bekommen nichts -- sonst lenkt es vom Arbeitskontext ab.
 *
 * Hoehe ~120px, mit Verlauf-Overlay, damit der Uebergang zu den darunter
 * folgenden KPIs / Karten weich wirkt.
 */
export function DashboardHero() {
  const [theme, setTheme] = useState<string | null>(null)

  useEffect(() => {
    setTheme(document.documentElement.getAttribute('data-theme'))
    const obs = new MutationObserver(() => {
      setTheme(document.documentElement.getAttribute('data-theme'))
    })
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
    return () => obs.disconnect()
  }, [])

  const photo = getThemePhoto(theme)
  if (!photo?.src) return null

  return (
    <div
      className="dashboard-hero"
      role="img"
      aria-label={photo.alt}
      style={{ backgroundImage: `linear-gradient(to bottom, rgba(0,0,0,0.05) 0%, var(--bg) 100%), url(${photo.src})` }}
    />
  )
}
