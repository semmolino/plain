import { useCallback, useEffect, useState } from 'react'
import {
  fetchPushPublicKey,
  fetchPushStatus,
  subscribePush,
  unsubscribePush,
} from '@/api/push'

// VAPID-Schlüssel (base64url) -> Uint8Array für applicationServerKey.
// Explizit über ArrayBuffer, damit der Typ (Uint8Array<ArrayBuffer>) als
// BufferSource für pushManager.subscribe akzeptiert wird.
function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = window.atob(base64)
  const buffer = new ArrayBuffer(raw.length)
  const output = new Uint8Array(buffer)
  for (let i = 0; i < raw.length; i++) output[i] = raw.charCodeAt(i)
  return output
}

const isIOS = (): boolean =>
  /iphone|ipad|ipod/i.test(navigator.userAgent) ||
  // iPadOS meldet sich als "Macintosh" mit Touch
  (navigator.platform === 'MacIntel' && (navigator as unknown as { maxTouchPoints?: number }).maxTouchPoints
    ? (navigator as unknown as { maxTouchPoints: number }).maxTouchPoints > 1
    : false)

const isStandalone = (): boolean =>
  window.matchMedia('(display-mode: standalone)').matches ||
  (navigator as unknown as { standalone?: boolean }).standalone === true

export interface PushState {
  /** Browser kann Web-Push (SW + PushManager + Notification vorhanden). */
  supported: boolean
  /** Server hat VAPID konfiguriert. null = noch nicht geprüft. */
  serverEnabled: boolean | null
  /** Dieses Gerät ist aktiv abonniert. */
  subscribed: boolean
  /** Aktueller Browser-Permission-Status. */
  permission: NotificationPermission | 'unsupported'
  /** Laufende Aktion (subscribe/unsubscribe/initial). */
  busy: boolean
  /** iOS ohne Home-Bildschirm-Installation -> erst installieren. */
  needsInstall: boolean
  error: string | null
  subscribe: () => Promise<void>
  unsubscribe: () => Promise<void>
}

export function usePushNotifications(): PushState {
  const supported =
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window

  const [serverEnabled, setServerEnabled] = useState<boolean | null>(null)
  const [subscribed, setSubscribed] = useState(false)
  const [permission, setPermission] = useState<NotificationPermission | 'unsupported'>(
    supported ? Notification.permission : 'unsupported',
  )
  const [busy, setBusy] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // iOS erlaubt Push nur als installierte PWA. Wenn wir dort nicht supported
  // sind UND nicht im Standalone-Modus laufen, ist die Installation der
  // fehlende Schritt.
  const needsInstall = !supported && isIOS() && !isStandalone()

  // Initialzustand ermitteln: Server-Key + bestehendes Abo dieses Geräts.
  useEffect(() => {
    let cancelled = false
    if (!supported) {
      setBusy(false)
      return
    }
    ;(async () => {
      try {
        const { enabled } = await fetchPushPublicKey()
        if (cancelled) return
        setServerEnabled(enabled)

        const reg = await navigator.serviceWorker.ready
        const existing = await reg.pushManager.getSubscription()
        if (cancelled) return

        if (existing) {
          // Mit dem Server abgleichen — evtl. auf anderem Gerät/Server gelöscht.
          try {
            const { subscribed: onServer } = await fetchPushStatus(existing.endpoint)
            if (!cancelled) setSubscribed(onServer)
          } catch {
            if (!cancelled) setSubscribed(true)
          }
        } else {
          setSubscribed(false)
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e))
      } finally {
        if (!cancelled) setBusy(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [supported])

  const subscribe = useCallback(async () => {
    if (!supported) return
    setBusy(true)
    setError(null)
    try {
      const perm = await Notification.requestPermission()
      setPermission(perm)
      if (perm !== 'granted') {
        setError(
          perm === 'denied'
            ? 'Benachrichtigungen sind im Browser blockiert. Bitte in den Website-Einstellungen erlauben.'
            : 'Berechtigung nicht erteilt.',
        )
        return
      }

      const { enabled, publicKey } = await fetchPushPublicKey()
      setServerEnabled(enabled)
      if (!enabled || !publicKey) {
        setError('Push ist auf dem Server nicht konfiguriert.')
        return
      }

      const reg = await navigator.serviceWorker.ready
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      })
      await subscribePush(sub.toJSON())
      setSubscribed(true)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }, [supported])

  const unsubscribe = useCallback(async () => {
    if (!supported) return
    setBusy(true)
    setError(null)
    try {
      const reg = await navigator.serviceWorker.ready
      const sub = await reg.pushManager.getSubscription()
      if (sub) {
        await unsubscribePush(sub.endpoint).catch(() => {})
        await sub.unsubscribe().catch(() => {})
      }
      setSubscribed(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }, [supported])

  return {
    supported,
    serverEnabled,
    subscribed,
    permission,
    busy,
    needsInstall,
    error,
    subscribe,
    unsubscribe,
  }
}
