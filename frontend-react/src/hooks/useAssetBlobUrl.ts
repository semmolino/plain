import { useEffect, useState } from 'react'
import { useAuthStore } from '@/store/authStore'

/**
 * Laedt ein Asset (geschuetzte URL /api/v1/assets/:id) authentifiziert
 * via fetch() und stellt es als Blob-URL bereit. Das ist noetig, weil
 * <img>/background-image keine Authorization-Header schicken kann.
 *
 * Cleanup: revoked die Blob-URL beim Unmount oder bei wechselnder asset_id.
 */
export function useAssetBlobUrl(assetId: number | null | undefined): string | null {
  const [url, setUrl] = useState<string | null>(null)

  useEffect(() => {
    if (!assetId) {
      setUrl(null)
      return
    }
    const token = useAuthStore.getState().token
    if (!token) return

    let cancelled = false
    let blobUrl: string | null = null

    fetch(`/api/v1/assets/${assetId}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(r => r.ok ? r.blob() : null)
      .then(blob => {
        if (cancelled || !blob) return
        blobUrl = URL.createObjectURL(blob)
        setUrl(blobUrl)
      })
      .catch(() => { /* swallow */ })

    return () => {
      cancelled = true
      if (blobUrl) URL.revokeObjectURL(blobUrl)
    }
  }, [assetId])

  return url
}
