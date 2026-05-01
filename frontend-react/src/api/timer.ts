import { apiClient } from './client'

export interface DraftEntry {
  ID:                  number
  PROJECT_ID:          number
  STRUCTURE_ID:        number
  EMPLOYEE_ID:         number
  DATE_VOUCHER:        string
  TIME_START:          string | null
  TIME_FINISH:         string | null
  QUANTITY_INT:        number
  CP_RATE:             number
  CP_TOT:              number
  QUANTITY_EXT:        number
  SP_RATE:             number
  SP_TOT:              number
  POSTING_DESCRIPTION: string
  STATUS:              string
  PROJECT:             { NAME_SHORT: string } | null
  STRUCTURE:           { NAME_SHORT: string; NAME_LONG: string } | null
}

export interface CreateDraftPayload {
  EMPLOYEE_ID:         number
  PROJECT_ID:          number
  STRUCTURE_ID:        number
  DATE_VOUCHER:        string
  TIME_START:          string
  TIME_FINISH:         string
  QUANTITY_INT:        number
  CP_RATE:             number
  POSTING_DESCRIPTION: string
}

export const createTimerDraft = (body: CreateDraftPayload) =>
  apiClient.post<{ success: boolean; data: { ID: number } }>('/buchungen/timer/draft', body)

export const fetchDrafts = (employeeId: number, date: string) =>
  apiClient.get<{ data: DraftEntry[] }>(`/buchungen/timer/drafts?employee_id=${employeeId}&date=${date}`)

export const confirmDrafts = (ids: number[]) =>
  apiClient.post<{ success: boolean; confirmed: number }>('/buchungen/timer/confirm', { ids })

export const deleteTimerDraft = (id: number) =>
  apiClient.delete<{ success: boolean }>(`/buchungen/timer/draft/${id}`)

export const patchDraftDescription = (id: number, description: string) =>
  apiClient.patch<{ success: boolean }>(`/buchungen/timer/draft/${id}`, { description })
