import { apiClient } from './client'

// ── Types ─────────────────────────────────────────────────────────────────────

/** Vom Backend gelieferte Absender-Einstellungen. SMTP-Zugangsdaten kommen
 *  ausschliesslich aus den globalen ENV-Variablen und sind hier nicht Teil
 *  der API. */
export interface EmailSettings {
  enabled:   boolean
  smtp_from: string
  from_name: string
  reply_to:  string
}

/** Speicher-Payload. */
export interface EmailSettingsPayload {
  enabled:   boolean
  smtp_from: string
  from_name: string
  reply_to:  string
}

// ── API ───────────────────────────────────────────────────────────────────────

export const fetchEmailSettings = () =>
  apiClient.get<EmailSettings>('/email-settings')

export const saveEmailSettings = (body: EmailSettingsPayload) =>
  apiClient.put<EmailSettings>('/email-settings', body)

export const sendEmailSettingsTest = (to: string) =>
  apiClient.post<{ sent: boolean }>('/email-settings/test', { to })
