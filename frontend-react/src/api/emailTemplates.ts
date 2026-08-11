import { apiClient } from './client'

// ── Types ─────────────────────────────────────────────────────────────────────

/** Eine Vorlage je Versandart: Rechnungen bzw. Mahnungen. */
export type EmailTemplateKey = 'invoice' | 'dunning'

export interface EmailTemplate {
  key:            EmailTemplateKey
  subject:        string
  body:           string
  /** false = es greift noch der Standardtext. */
  isCustom:       boolean
  defaultSubject: string
  defaultBody:    string
}

export const EMAIL_TEMPLATE_LABELS: Record<EmailTemplateKey, string> = {
  invoice: 'Rechnungen',
  dunning: 'Mahnungen',
}

export const EMAIL_TEMPLATE_HINTS: Record<EmailTemplateKey, string> = {
  invoice: 'Gilt für Rechnungen, Abschlags-, Schluss- und Stornorechnungen sowie Gutschriften.',
  dunning: 'Gilt für Zahlungserinnerungen und alle Mahnstufen.',
}

/** Platzhalter, die der Server beim Versand gegen Belegwerte ersetzt
 *  (Spiegel von backend/services/emailTemplates.js). */
export interface EmailPlaceholder {
  token: string
  label: string
  /** Fehlt der Eintrag, gilt der Platzhalter für beide Vorlagen. */
  only?: EmailTemplateKey
}

export const EMAIL_PLACEHOLDERS: EmailPlaceholder[] = [
  { token: '{{belegart}}',        label: 'Belegart' },
  { token: '{{belegnummer}}',     label: 'Belegnummer' },
  { token: '{{belegdatum}}',      label: 'Belegdatum' },
  { token: '{{faelligkeit}}',     label: 'Fällig am' },
  { token: '{{betrag}}',          label: 'Betrag brutto' },
  { token: '{{bezahlt}}',         label: 'Bereits bezahlt' },
  { token: '{{offener_betrag}}',  label: 'Offener Betrag' },
  { token: '{{projekt}}',         label: 'Projekt' },
  { token: '{{kunde}}',           label: 'Kunde' },
  { token: '{{ansprechpartner}}', label: 'Ansprechpartner' },
  { token: '{{firma}}',           label: 'Eigene Firma' },
  { token: '{{mahnstufe}}',       label: 'Mahnstufe',  only: 'dunning' },
  { token: '{{mahngebuehr}}',     label: 'Mahngebühr', only: 'dunning' },
  { token: '{{tage_ueberfaellig}}', label: 'Tage überfällig', only: 'dunning' },
]

export const placeholdersFor = (key: EmailTemplateKey) =>
  EMAIL_PLACEHOLDERS.filter(p => !p.only || p.only === key)

/** Vom Server aufgelöster Betreff/Text für genau einen Beleg. */
export interface EmailPreview {
  to:      string
  subject: string
  body:    string
}

// ── API ───────────────────────────────────────────────────────────────────────

export const fetchEmailTemplates = () =>
  apiClient.get<{ data: EmailTemplate[] }>('/email-templates')

export const saveEmailTemplate = (
  key: EmailTemplateKey,
  payload: { subject: string; body: string },
) => apiClient.put<{ ok: boolean }>(`/email-templates/${key}`, payload)

export const resetEmailTemplate = (key: EmailTemplateKey) =>
  apiClient.delete<{ ok: boolean }>(`/email-templates/${key}`)
