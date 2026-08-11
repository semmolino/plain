import { apiClient } from './client'

/** Öffentlicher VAPID-Schlüssel + ob Push serverseitig überhaupt aktiv ist. */
export const fetchPushPublicKey = () =>
  apiClient.get<{ enabled: boolean; publicKey: string | null }>('/push/public-key')

/** Ist DIESES Gerät (Endpoint) bereits serverseitig registriert? */
export const fetchPushStatus = (endpoint: string) =>
  apiClient.get<{ subscribed: boolean }>(`/push/status?endpoint=${encodeURIComponent(endpoint)}`)

/** Subscription dieses Geräts speichern. */
export const subscribePush = (subscription: PushSubscriptionJSON) =>
  apiClient.post<{ ok: boolean }>('/push/subscribe', { subscription })

/** Subscription dieses Geräts entfernen (Opt-out). */
export const unsubscribePush = (endpoint: string) =>
  apiClient.post<{ ok: boolean }>('/push/unsubscribe', { endpoint })
