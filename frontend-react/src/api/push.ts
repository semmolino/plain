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

/** Antwort eines Push-Dienstes, der die Zustellung abgelehnt hat. */
export interface PushZustellFehler {
  /** Host des Push-Dienstes, z. B. `web.push.apple.com` — nie der volle Endpoint. */
  dienst: string
  /** HTTP-Status der Ablehnung (403 = Token abgelehnt, 400 = Anfrage fehlerhaft). */
  code: number | null
  meldung: string
}

export interface PushTestErgebnis {
  /** true, sobald mindestens ein Gerät den Push angenommen hat. */
  ok: boolean
  /** Registrierte Geräte dieses Kontos. */
  devices: number
  /** Davon vom Push-Dienst angenommen. */
  zugestellt: number
  /** Registrierungen, die abgelaufen waren — serverseitig bereits entfernt. */
  abgelaufen: number
  fehler: PushZustellFehler[]
  /** Der `sub`-Claim aus dem VAPID-Token (VAPID_SUBJECT). */
  subject: string
}

/** Test-Benachrichtigung an alle eigenen Geräte. Meldet, was die Push-Dienste
 *  geantwortet haben — nicht nur, dass verschickt wurde. */
export const sendTestPush = () =>
  apiClient.post<PushTestErgebnis>('/push/test', {})
