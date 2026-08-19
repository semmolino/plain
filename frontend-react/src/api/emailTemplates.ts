import { apiClient } from './client'

// ── Types ─────────────────────────────────────────────────────────────────────

/** Eine Vorlage je Versandart: Rechnungen, Stornos bzw. Mahnungen. */
export type EmailTemplateKey = 'invoice' | 'invoice_storno' | 'dunning'

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
  invoice:        'Rechnungen',
  invoice_storno: 'Stornos',
  dunning:        'Mahnungen',
}

export const EMAIL_TEMPLATE_HINTS: Record<EmailTemplateKey, string> = {
  invoice:        'Gilt für Rechnungen, Abschlags- und Schlussrechnungen sowie Gutschriften.',
  invoice_storno: 'Gilt für Stornorechnungen und Storno-Abschlagsrechnungen — eigener Text, weil hier nichts mehr zu zahlen ist.',
  dunning:        'Gilt für Zahlungserinnerungen und alle Mahnstufen.',
}

/** Platzhalter, die der Server beim Versand gegen Belegwerte ersetzt
 *  (Spiegel von backend/services/emailTemplates.js). */
export interface EmailPlaceholder {
  token: string
  label: string
  /** Fehlt der Eintrag, gilt der Platzhalter für alle Vorlagen. */
  only?: EmailTemplateKey
  /** Für diese Vorlagen ausblenden (fachlich sinnlos, z.B. Fälligkeit im Storno). */
  hideFor?: EmailTemplateKey[]
}

export const EMAIL_PLACEHOLDERS: EmailPlaceholder[] = [
  { token: '{{belegart}}',        label: 'Belegart' },
  { token: '{{belegnummer}}',     label: 'Belegnummer' },
  { token: '{{belegdatum}}',      label: 'Belegdatum' },
  { token: '{{faelligkeit}}',     label: 'Fällig am',       hideFor: ['invoice_storno'] },
  { token: '{{betrag}}',          label: 'Betrag brutto' },
  { token: '{{bezahlt}}',         label: 'Bereits bezahlt', hideFor: ['invoice_storno'] },
  { token: '{{offener_betrag}}',  label: 'Offener Betrag',  hideFor: ['invoice_storno'] },
  { token: '{{projekt}}',         label: 'Projekt' },
  { token: '{{kunde}}',           label: 'Kunde' },
  { token: '{{ansprechpartner}}', label: 'Ansprechpartner' },
  { token: '{{firma}}',           label: 'Eigene Firma' },
  { token: '{{mahnstufe}}',       label: 'Mahnstufe',  only: 'dunning' },
  { token: '{{mahngebuehr}}',     label: 'Mahngebühr', only: 'dunning' },
  { token: '{{tage_ueberfaellig}}', label: 'Tage überfällig', only: 'dunning' },
]

export const placeholdersFor = (key: EmailTemplateKey) =>
  EMAIL_PLACEHOLDERS.filter(p => (!p.only || p.only === key) && !p.hideFor?.includes(key))

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
