import { apiClient } from './client'

// ── Gestaltung der Belege (Spiegel von backend/services_theme_schema.js) ─────
//
// Welche Belegarten es gibt, welche Bausteine sie haben und welche Platzhalter
// gelten, steht NICHT hier, sondern kommt vom Server (fetchCatalog) — aus
// services/documentLayout.js und documentPlaceholders.js. Vorher führte das
// Frontend eigene Listen, und neue Belegarten kamen in den Einstellungen nie an.

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
  /** Zeile „Bauvorhaben: …" (Gesamtprojekt) auf Belegen; fehlt = an */
  showBauvorhaben?: boolean
}

/** Anhänge (eigene Seiten): Schalter je Anhang plus Reihenfolge. */
export type ThemeBlocks = Record<string, boolean | string[] | undefined> & { order?: string[] }

export type PaymentMode = 'auto' | 'always' | 'never'

/** Abweichender Aufbau des Hauptteils (Vorlage, Projekt oder Beleg). */
export interface LayoutOverride {
  order?:      string[]
  hidden?:     string[]
  pageBreaks?: string[]
  payment?:    PaymentMode
  /** eigene Textblöcke: Schlüssel "text:<id>" → Text */
  texts?:      Record<string, string>
  introText?:  string
  closingText?: string
}

export interface DocTheme {
  version?: number
  brand:    ThemeBrand
  header:   ThemeHeader
  blocks:   ThemeBlocks
  footer?:  Record<string, unknown>
  blocksByCategory?: Record<string, ThemeBlocks>
  bodyByCategory?:   Record<string, LayoutOverride>
}

// Kanonische Defaults — entsprechen exakt dem heutigen Look (Null-Regression).
export const DEFAULT_THEME: DocTheme = {
  version: 2,
  brand:  { primaryColor: '#111827', accentColor: '#111827', fontFamily: 'system-sans', fontScale: 1 },
  header: { showLogo: true, logoMaxHeightMm: 20, logoPosition: 'right', showBauvorhaben: true },
  blocks: {
    showProjectStructure: true, showTec: true, showHonorar: true, showPayments: true,
    order: ['showPayments', 'showProjectStructure', 'showTec', 'showHonorar'],
  },
  footer: { showPageNumbers: true },
}

// ── Katalog vom Server ───────────────────────────────────────────────────────

export interface BlockInfo {
  key:    string
  label:  string
  /** Pflichtbaustein: verschiebbar, nicht ausblendbar */
  locked: boolean
  /** steht immer zuerst (Briefkopf) */
  fixed:  boolean
  modes:  PaymentMode[] | null
}

export interface CategoryInfo {
  key:        string
  label:      string
  /** erbt Einstellungen von dieser Kategorie, solange sie keine eigenen hat */
  parent:     string | null
  textType:   string | null
  defaults:   { hidden: string[]; payment: PaymentMode }
  body:       BlockInfo[]
  appendices: { key: string; label: string }[]
}

export interface PlaceholderInfo {
  token: string
  label: string
  /** wo der Platzhalter einen Wert hat (invoice | offer | mahnung | nachtrag); fehlt = überall */
  scope?: string[]
}

export interface TextTypeInfo {
  type:          string
  category:      string
  label:         string
  fallbackLabel: string | null
}

export interface DocCatalog {
  categories:   CategoryInfo[]
  placeholders: PlaceholderInfo[]
  textTypes:    TextTypeInfo[]
}

/** Belegfamilie einer Kategorie — bestimmt, welche Platzhalter dort Werte haben. */
export function familyOf(category: string): string {
  if (category.startsWith('invoice_')) return 'invoice'
  if (category.startsWith('offer_')) return 'offer'
  return category
}

// ── Stil-Vorlagen, Schriften, Logo ───────────────────────────────────────────

// Stil-Vorlagen (Ebene 1): 1-Klick-Looks, die Farbe + Schrift + Logo-Position
// gemeinsam setzen. Danach lässt sich alles einzeln nachjustieren.
export interface StylePreset {
  id:    string
  label: string
  accentColor: string
  fontFamily:  string
  logoPosition: LogoPosition
}
export const STYLE_PRESETS: StylePreset[] = [
  { id: 'standard',  label: 'Standard',  accentColor: '#111827', fontFamily: 'system-sans',      logoPosition: 'right'  },
  { id: 'modern',    label: 'Modern',    accentColor: '#1e3a5f', fontFamily: 'inter',            logoPosition: 'left'   },
  { id: 'klassisch', label: 'Klassisch', accentColor: '#3f3f46', fontFamily: 'source-serif',     logoPosition: 'right'  },
  { id: 'elegant',   label: 'Elegant',   accentColor: '#7c2d12', fontFamily: 'playfair-display', logoPosition: 'center' },
  { id: 'frisch',    label: 'Frisch',    accentColor: '#0f766e', fontFamily: 'montserrat',       logoPosition: 'left'   },
]

// Logo-Größe (Höhe in mm) — wird in den Templates als max-height genutzt.
export const LOGO_SIZES: { id: string; label: string; mm: number }[] = [
  { id: 'klein',  label: 'Klein',  mm: 14 },
  { id: 'mittel', label: 'Mittel', mm: 20 },
  { id: 'gross',  label: 'Groß',   mm: 28 },
]

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

export const fetchCatalog = () =>
  apiClient.get<{ data: DocCatalog }>('/document-templates/catalog')

export const fetchBranding = () =>
  apiClient.get<{ data: { theme: DocTheme; companyId: number } }>('/document-templates/branding')

/** Speichert die ganze Gestaltung: Marke, Aufbau je Kategorie, Anhänge je Kategorie. */
export const saveBranding = (theme_json: DocTheme) =>
  apiClient.put<{ data: { ok: boolean } }>('/document-templates/branding', { theme_json, blocks_by_category: theme_json.blocksByCategory ?? {} })

export const previewBranding = (theme_json: DocTheme, category: string) =>
  apiClient.post<{ html: string }>('/document-templates/preview', { theme_json, category })
