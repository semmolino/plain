import { apiClient } from './client'

// ── Buchungstextvorlagen (global + persönlich) ────────────────────────────────

export interface TextSnippet {
  ID:         number
  LABEL:      string | null
  TEXT:       string
  SORT_ORDER: number | null
  SCOPE:      'global' | 'employee'
}

export interface TextSnippetPayload { label?: string | null; text: string; sort_order?: number }

// Auswahl beim Buchen: globale + eigene persönliche.
export const fetchTextSnippets = () =>
  apiClient.get<{ data: TextSnippet[] }>('/buchungen/text-snippets')

// Persönliche Bausteine (jeder seine eigenen, kein Recht nötig).
export const createTextSnippet = (body: TextSnippetPayload) =>
  apiClient.post<{ data: TextSnippet }>('/buchungen/text-snippets', body)
export const updateTextSnippet = (id: number, body: Partial<TextSnippetPayload>) =>
  apiClient.patch<{ data: TextSnippet }>(`/buchungen/text-snippets/${id}`, body)
export const deleteTextSnippet = (id: number) =>
  apiClient.delete<{ success: boolean }>(`/buchungen/text-snippets/${id}`)

// Globale Buchungstextvorlagen (Stammdaten, gated settings.booking_text_templates.edit).
export const fetchGlobalSnippets = () =>
  apiClient.get<{ data: TextSnippet[] }>('/stammdaten/booking-text-templates')
export const createGlobalSnippet = (body: TextSnippetPayload) =>
  apiClient.post<{ data: TextSnippet }>('/stammdaten/booking-text-templates', body)
export const updateGlobalSnippet = (id: number, body: Partial<TextSnippetPayload>) =>
  apiClient.patch<{ data: TextSnippet }>(`/stammdaten/booking-text-templates/${id}`, body)
export const deleteGlobalSnippet = (id: number) =>
  apiClient.delete<{ success: boolean }>(`/stammdaten/booking-text-templates/${id}`)
