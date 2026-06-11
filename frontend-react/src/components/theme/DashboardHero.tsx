import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getThemePhoto } from '@/config/themePhotos'
import { fetchDefaults } from '@/api/stammdaten'

/**
 * Schmaler Foto-Hero fuers Dashboard.
 *
 * Quellen-Prioritaet:
 *   1. Tenant hat ein eigenes Bild hochgeladen (TENANT_SETTINGS
 *      'tenant.hero_asset_id') -> dieses Bild gewinnt immer
 *   2. Aktives Theme ist eine "-foto"-Variante mit hinterlegtem Default-
 *      Stockfoto -> das wird gezeigt
 *   3. Sonst kein Banner (Strich-/Standard-/Atmosphaere-Themes)
 *
 * Hoehe ~120px, mit Verlauf-Overlay zum weichen Uebergang.
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

  const { data: defaultsData } = useQuery({
    queryKey: ['defaults'],
    queryFn:  fetchDefaults,
    staleTime: 60_000,
  })

  const customHeroId = (defaultsData?.data as Record<string, string> | undefined)?.['tenant.hero_asset_id']
  const customHeroUrl = customHeroId ? `/api/v1/assets/${customHeroId}` : null

  // Custom-Bild hat Vorrang. Sonst Theme-Default-Foto.
  let src: string | null = null
  let alt = 'Tenant-Hintergrundbild'
  if (customHeroUrl) {
    src = customHeroUrl
  } else {
    const photo = getThemePhoto(theme)
    if (photo?.src) {
      src = photo.src
      alt = photo.alt
    }
  }

  if (!src) return null

  return (
    <div
      className="dashboard-hero"
      role="img"
      aria-label={alt}
      style={{ backgroundImage: `linear-gradient(to bottom, rgba(0,0,0,0.05) 0%, var(--bg) 100%), url(${src})` }}
    />
  )
}
