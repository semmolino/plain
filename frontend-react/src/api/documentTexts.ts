import { apiClient } from './client'

/** Textbaustein für Belege (backend/services/documentTexts.js, Migration 0184). */
export interface DocumentText {
  id:        number
  /** Belegkategorie (documentLayout) oder null = alle */
  category:  string | null
  position:  'intro' | 'closing' | 'free'
  label:     string
  text:      string
  sortOrder: number
}

export const TEXT_POSITION_LABELS: Record<DocumentText['position'], string> = {
  intro:   'Kopftext',
  closing: 'Fußtext',
  free:    'Eigener Textblock',
}

export interface DocumentTextInput {
  label:     string
  text:      string
  category:  string | null
  position:  DocumentText['position']
}

export const fetchDocumentTexts = (category?: string) =>
  apiClient.get<{ data: DocumentText[] }>(`/document-texts${category ? `?category=${encodeURIComponent(category)}` : ''}`)

export const createDocumentText = (body: DocumentTextInput) =>
  apiClient.post<{ data: DocumentText }>('/document-texts', body)

export const updateDocumentText = (id: number, body: Partial<DocumentTextInput>) =>
  apiClient.patch<{ data: DocumentText }>(`/document-texts/${id}`, body)

export const deleteDocumentText = (id: number) =>
  apiClient.delete<{ data: { ok: boolean } }>(`/document-texts/${id}`)
