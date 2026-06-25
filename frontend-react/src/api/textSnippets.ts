import { apiClient } from './client'

// ── Persönliche Buchungstexte (Textbausteine) für Stunden-Buchungen ────────────

export interface TextSnippet {
  ID:         number
  LABEL:      string | null
  TEXT:       string
  SORT_ORDER: number | null
}

export const fetchTextSnippets = () =>
  apiClient.get<{ data: TextSnippet[] }>('/buchungen/text-snippets')

export const createTextSnippet = (body: { label?: string | null; text: string }) =>
  apiClient.post<{ data: TextSnippet }>('/buchungen/text-snippets', body)

export const updateTextSnippet = (id: number, body: { label?: string | null; text?: string }) =>
  apiClient.patch<{ data: TextSnippet }>(`/buchungen/text-snippets/${id}`, body)

export const deleteTextSnippet = (id: number) =>
  apiClient.delete<{ success: boolean }>(`/buchungen/text-snippets/${id}`)
