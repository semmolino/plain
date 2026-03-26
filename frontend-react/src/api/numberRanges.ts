import { apiClient } from './client'

export interface NumberRanges {
  year:                  number
  next_counter:          number
  project_next_counter:  number
}

export const fetchNumberRanges = (year: number) =>
  apiClient.get<NumberRanges>(`/number-ranges?year=${year}`)

export const saveNumberRanges = (body: {
  year: number
  next_counter: number
  project_next_counter: number
}) => apiClient.post<{ ok: boolean }>('/number-ranges/set', body)
