import { apiClient } from './client'

export interface NumberRanges {
  year:                  number
  next_counter:          number
  project_next_counter:  number
  offer_next_counter:    number
}

export const fetchNumberRanges = (year: number) =>
  apiClient.get<NumberRanges>(`/number-ranges?year=${year}`)

export const saveNumberRanges = (body: {
  year: number
  next_counter: number
  project_next_counter: number
  offer_next_counter: number
}) => apiClient.post<{ ok: boolean }>('/number-ranges/set', body)

// ── Template-Konfiguration ──────────────────────────────────────────────────

export type NumberRangeDocType = 'PROJECT' | 'OFFER' | 'INVOICE'

export interface NumberRangeTemplate {
  ID:         number
  COMPANY_ID: number
  DOC_TYPE:   NumberRangeDocType
  TEMPLATE:   string
  UPDATED_AT: string
}

export const fetchNumberRangeTemplates = () =>
  apiClient.get<{ data: NumberRangeTemplate[] }>('/number-ranges/templates')

export const saveNumberRangeTemplate = (body: {
  company_id: number
  doc_type:   NumberRangeDocType
  template:   string
}) => apiClient.put<{ data: NumberRangeTemplate[] }>('/number-ranges/templates', body)

export const previewNumberRangeTemplate = (body: {
  template:    string
  counter?:    number
  company_id?: number
}) => apiClient.post<{ data: { rendered: string } }>('/number-ranges/templates/preview', body)
