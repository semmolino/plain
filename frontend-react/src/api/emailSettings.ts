import { apiClient } from './client'

// ── Types ─────────────────────────────────────────────────────────────────────

/** Vom Backend gelieferte SMTP-Einstellungen (OHNE Passwort). */
export interface EmailSettings {
  configured:                boolean
  enabled:                   boolean
  smtp_host:                 string
  smtp_port:                 number
  smtp_secure:               boolean
  smtp_user:                 string
  smtp_from:                 string
  from_name:                 string
  reply_to:                  string
  smtp_pass_set:             boolean   // ob ein verschluesseltes Passwort hinterlegt ist
  encryption_available:      boolean   // ob EMAIL_ENC_KEY gesetzt ist
  global_fallback_available: boolean   // ob globaler ENV-Absender existiert
  transport:                 'resend' | 'smtp'  // aktiver Versand-Weg
  provider_ready:            boolean   // im Resend-Modus: RESEND_API_KEY + EMAIL_FROM gesetzt
  domain_name:               string    // eigene Absender-Domain (oder '')
  domain_status:             string    // not_started | pending | verified | failed | ...
  domain_records:            DomainRecord[]  // anzuzeigende DNS-Records
}

/** Ein von Resend geliefertes DNS-Record zur Domain-Verifizierung. */
export interface DomainRecord {
  record?:   string   // z.B. 'SPF' | 'DKIM'
  name:      string   // Host/Name des Records
  type:      string   // 'TXT' | 'MX' | 'CNAME'
  value:     string   // Wert
  ttl?:      string
  priority?: number
  status?:   string
}

/** Speicher-Payload. `smtp_pass` nur senden, wenn neu/geaendert. */
export interface EmailSettingsPayload {
  enabled:        boolean
  smtp_host:      string
  smtp_port:      number
  smtp_secure:    boolean
  smtp_user:      string
  smtp_from:      string
  from_name:      string
  reply_to:       string
  smtp_pass?:     string   // leer/weggelassen = unveraendert
  clear_password?: boolean // true = gespeichertes Passwort loeschen
}

// ── API ───────────────────────────────────────────────────────────────────────

export const fetchEmailSettings = () =>
  apiClient.get<EmailSettings>('/email-settings')

export const saveEmailSettings = (body: EmailSettingsPayload) =>
  apiClient.put<EmailSettings>('/email-settings', body)

export const sendEmailSettingsTest = (to: string) =>
  apiClient.post<{ sent: boolean }>('/email-settings/test', { to })

// ── Absender-Domain ─────────────────────────────────────────────────────────

export const addEmailDomain = (domain: string) =>
  apiClient.post<EmailSettings>('/email-settings/domain', { domain })

export const verifyEmailDomain = () =>
  apiClient.post<EmailSettings>('/email-settings/domain/verify', {})

export const removeEmailDomain = () =>
  apiClient.delete<EmailSettings>('/email-settings/domain')
