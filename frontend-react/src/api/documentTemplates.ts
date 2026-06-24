import { apiClient } from './client'

// ── Theme-Form (Spiegel von backend/services_theme_defaults.js) ──────────────

export type LogoPosition = 'left' | 'center' | 'right'

export interface ThemeBrand {
  primaryColor: string
  accentColor:  string
  fontFamily:   string
  fontScale:    number
}

export interface ThemeHeader {
  showLogo:        boolean
  logoMaxHeightMm: number
  logoPosition:    LogoPosition
}

// Schaltbare Anhang-/Inhaltsabschnitte. Spiegel von services_theme_defaults.js.
export interface ThemeBlocks {
  showProjectStructure: boolean
  showTec:              boolean
  showHonorar:          boolean
  showPayments:         boolean
}

export interface DocTheme {
  version?: number
  brand:    ThemeBrand
  header:   ThemeHeader
  blocks:   ThemeBlocks
  footer?:  Record<string, unknown>
}

// Kanonische Defaults — entsprechen exakt dem heutigen Look (Null-Regression).
export const DEFAULT_THEME: DocTheme = {
  version: 2,
  brand:  { primaryColor: '#111827', accentColor: '#111827', fontFamily: 'system-sans', fontScale: 1 },
  header: { showLogo: true, logoMaxHeightMm: 20, logoPosition: 'right' },
  blocks: { showProjectStructure: true, showTec: true, showHonorar: true, showPayments: true },
  footer: { showPageNumbers: true },
}

// Reihenfolge + Labels der schaltbaren Anhänge (für den „Inhalte & Anhänge"-Block).
export const APPENDIX_BLOCKS: { key: keyof ThemeBlocks; label: string }[] = [
  { key: 'showProjectStructure', label: 'Projektübersicht' },
  { key: 'showTec',              label: 'Stundennachweis' },
  { key: 'showHonorar',          label: 'HOAI-/Kalkulationsübersicht' },
  { key: 'showPayments',         label: 'Zahlungsübersicht' },
]

export type DocTemplateType = 'INVOICE' | 'PARTIAL_PAYMENT' | 'OFFER'

export const DOC_TYPE_LABELS: Record<DocTemplateType, string> = {
  INVOICE:         'Rechnungen',
  PARTIAL_PAYMENT: 'Abschlagsrechnungen',
  OFFER:           'Angebote',
}

// Welche Anhänge je Belegtyp konfigurierbar sind. Spiegel von
// backend/services_pdf_render.js (APPENDIX_BY_DOCTYPE).
export const APPENDIX_BLOCKS_BY_TYPE: Record<DocTemplateType, (keyof ThemeBlocks)[]> = {
  INVOICE:         ['showProjectStructure', 'showTec', 'showHonorar', 'showPayments'],
  PARTIAL_PAYMENT: ['showProjectStructure', 'showTec', 'showHonorar', 'showPayments'],
  OFFER:           ['showHonorar'],
}

// Schriftauswahl — Keys spiegeln backend/services_theme_fonts.js (FONTS).
// system-* = generische Familien; alle anderen werden serverseitig als Webfont
// eingebettet (PDF + Vorschau identisch).
export const FONT_OPTIONS: { key: string; label: string; group: 'sans' | 'serif' }[] = [
  { key: 'system-sans',      label: 'Standard (serifenlos)', group: 'sans' },
  { key: 'inter',            label: 'Inter',            group: 'sans' },
  { key: 'roboto',           label: 'Roboto',           group: 'sans' },
  { key: 'open-sans',        label: 'Open Sans',        group: 'sans' },
  { key: 'montserrat',       label: 'Montserrat',       group: 'sans' },
  { key: 'system-serif',     label: 'Standard (Serif)', group: 'serif' },
  { key: 'merriweather',     label: 'Merriweather',     group: 'serif' },
  { key: 'lora',             label: 'Lora',             group: 'serif' },
  { key: 'source-serif',     label: 'Source Serif',     group: 'serif' },
  { key: 'playfair-display', label: 'Playfair Display', group: 'serif' },
]

// ── API ──────────────────────────────────────────────────────────────────────

export const fetchBranding = () =>
  apiClient.get<{ data: { theme: DocTheme; blocksByType: Record<DocTemplateType, ThemeBlocks>; companyId: number } }>('/document-templates/branding')

export const saveBranding = (theme_json: DocTheme, blocks_by_type: Record<DocTemplateType, ThemeBlocks>) =>
  apiClient.put<{ data: { ok: boolean } }>('/document-templates/branding', { theme_json, blocks_by_type })

export const previewBranding = (theme_json: DocTheme, doc_type: DocTemplateType) =>
  apiClient.post<{ html: string }>('/document-templates/preview', { theme_json, doc_type })
