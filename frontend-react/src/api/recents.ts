import { apiClient } from './client'

export type RecentEntityType =
  | 'project'
  | 'invoice'
  | 'partial_payment'
  | 'offer'
  | 'mahnung'
  | 'address'

export interface RecentEntry {
  ID:          number
  ENTITY_TYPE: RecentEntityType
  ENTITY_ID:   number
  LABEL:       string | null
  LAST_SEEN:   string
  VIEW_COUNT:  number
}

export const trackRecent = (entityType: RecentEntityType, entityId: number, label: string | null) =>
  apiClient.post<{ data: { id: number; isNew: boolean } }>('/recents', {
    entity_type: entityType,
    entity_id:   entityId,
    label,
  })

export const fetchRecents = (entityType: RecentEntityType, limit = 5) =>
  apiClient.get<{ data: RecentEntry[] }>(`/recents?type=${entityType}&limit=${limit}`)

export const fetchDashboardRecents = (limit = 8) =>
  apiClient.get<{ data: RecentEntry[] }>(`/recents/dashboard?limit=${limit}`)
