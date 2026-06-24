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

export interface DocTheme {
  version?: number
  brand:    ThemeBrand
  header:   ThemeHeader
  footer?:  Record<string, unknown>
  blocks?:  Record<string, unknown>
}

// Kanonische Defaults — entsprechen exakt dem heutigen Look (Null-Regression).
export const DEFAULT_THEME: DocTheme = {
  version: 2,
  brand:  { primaryColor: '#111827', accentColor: '#111827', fontFamily: 'Arial, Helvetica, sans-serif', fontScale: 1 },
  header: { showLogo: true, logoMaxHeightMm: 20, logoPosition: 'right' },
  footer: { showPageNumbers: true },
  blocks: { showProjectStructure: true, showTec: true },
}

// Generische, immer verfuegbare Schrift-Stacks (keine Webfonts noetig).
export const FONT_OPTIONS: { id: string; label: string; stack: string }[] = [
  { id: 'sans',  label: 'Serifenlos', stack: 'Arial, Helvetica, sans-serif' },
  { id: 'serif', label: 'Serif',      stack: 'Georgia, "Times New Roman", serif' },
]

// ── API ──────────────────────────────────────────────────────────────────────

export const fetchBranding = () =>
  apiClient.get<{ data: { theme: DocTheme; companyId: number } }>('/document-templates/branding')

export const saveBranding = (theme_json: DocTheme) =>
  apiClient.put<{ data: { ok: boolean; theme: DocTheme } }>('/document-templates/branding', { theme_json })

export const previewBranding = (theme_json: DocTheme) =>
  apiClient.post<{ html: string }>('/document-templates/preview', { theme_json })
