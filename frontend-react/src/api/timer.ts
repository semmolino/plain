import { apiClient } from './client'
import type { ArbzgIssue, BreakConfirmationMap } from './arbzg'

export type EntryKind = 'WORK' | 'BREAK'

export interface DraftEntry {
  ID:                  number
  PROJECT_ID:          number | null
  STRUCTURE_ID:        number | null
  EMPLOYEE_ID:         number
  BOOKING_DATE:        string
  TIME_START:          string | null
  TIME_FINISH:         string | null
  QUANTITY_INT:        number
  COST_RATE:             number
  COST_TOTAL:              number
  QUANTITY_EXT:        number
  HOURLY_RATE:             number
  HOURLY_RATE_TOTAL:              number
  POSTING_DESCRIPTION: string
  STATUS:              string
  ENTRY_KIND?:         EntryKind
  PROJECT:             { NAME_SHORT: string } | null
  STRUCTURE:           { NAME_SHORT: string; NAME_LONG: string } | null
}

export interface CreateDraftPayload {
  EMPLOYEE_ID:         number
  PROJECT_ID:          number | null
  STRUCTURE_ID:        number | null
  BOOKING_DATE:        string
  TIME_START:          string
  TIME_FINISH:         string
  QUANTITY_INT:        number
  COST_RATE:             number
  POSTING_DESCRIPTION: string
  ENTRY_KIND?:         EntryKind
}

export const createTimerDraft = (body: CreateDraftPayload) =>
  apiClient.post<{ success: boolean; data: { ID: number; arbzgIssues?: ArbzgIssue[] } }>(
    '/buchungen/timer/draft', body
  )

export const fetchDrafts = (employeeId: number, date: string) =>
  apiClient.get<{ data: DraftEntry[] }>(`/buchungen/timer/drafts?employee_id=${employeeId}&date=${date}`)

export interface WorkstartStatus {
  autoshowEnabled:  boolean
  hasBookingsToday: boolean
  today:            string
}
export const fetchWorkstartStatus = () =>
  apiClient.get<{ data: WorkstartStatus }>('/buchungen/workstart-status')

export const confirmDrafts = (ids: number[], breakConfirmations?: BreakConfirmationMap) =>
  apiClient.post<{ success: boolean; confirmed: number; arbzgEvents?: unknown[] }>(
    '/buchungen/timer/confirm', { ids, break_confirmations: breakConfirmations || {} }
  )

export const deleteTimerDraft = (id: number) =>
  apiClient.delete<{ success: boolean }>(`/buchungen/timer/draft/${id}`)

export const patchDraftDescription = (id: number, description: string) =>
  apiClient.patch<{ success: boolean }>(`/buchungen/timer/draft/${id}`, { description })

export const patchDraft = (id: number, body: {
  description?:  string
  time_start?:   string
  time_finish?:  string
  quantity_int?: number
}) =>
  apiClient.patch<{ success: boolean }>(`/buchungen/timer/draft/${id}`, body)
