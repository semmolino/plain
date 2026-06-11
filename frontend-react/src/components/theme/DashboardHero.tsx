import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getThemePhoto } from '@/config/themePhotos'
import { fetchDefaults } from '@/api/stammdaten'
import { useAssetBlobUrl } from '@/hooks/useAssetBlobUrl'

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

  const customHeroIdRaw = (defaultsData?.data as Record<string, string> | undefined)?.['tenant.hero_asset_id']
  const customHeroId    = customHeroIdRaw ? parseInt(customHeroIdRaw, 10) : null
  const customHeroBlobUrl = useAssetBlobUrl(customHeroId)

  // Custom-Bild hat Vorrang, sobald die Blob-URL bereit ist. Solange das
  // Custom-Bild noch lädt, zeigen wir das Theme-Foto als Fallback (kein
  // Flash zum Nichts wahrend Defaults-Query und Blob-Fetch durchlaufen).
  // Sequenz fuer User mit Custom-Bild + Foto-Theme:
  //   0s    -> Theme-Foto
  //   ~1s   -> defaults da, customHeroId gesetzt, Blob laedt -> Theme-Foto bleibt
  //   ~1.5s -> Blob da -> swap auf Custom-Bild
  let src: string | null = null
  let alt = 'Tenant-Hintergrundbild'

  if (customHeroId && customHeroBlobUrl) {
    src = customHeroBlobUrl
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
