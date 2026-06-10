import { apiClient } from './client'

export type RecentEntityType =
  | 'project'
  | 'invoice'
  | 'partial_payment'
  | 'offer'
  | 'mahnung'
  | 'address'
  | 'project_structure'
  | 'report_filter'                // Legacy
  | 'report_projektliste_filter'
  | 'report_trends_filter'
  | 'report_kennzahlen_filter'
  | 'mitarbeiter_report_filter'

export interface RecentEntry {
  ID:          number
  ENTITY_TYPE: RecentEntityType
  ENTITY_ID:   number
  LABEL:       string | null
  META:        Record<string, unknown> | null
  LAST_SEEN:   string
  VIEW_COUNT:  number
}

export interface TrackRecentBody {
  entity_type: RecentEntityType
  entity_id:   number
  label?:      string | null
  meta?:       Record<string, unknown> | null
}

export const trackRecent = (
  entityType: RecentEntityType,
  entityId: number,
  label: string | null,
  meta?: Record<string, unknown> | null,
) =>
  apiClient.post<{ data: { id: number; isNew: boolean } }>('/recents', {
    entity_type: entityType,
    entity_id:   entityId,
    label,
    meta:        meta ?? null,
  } as TrackRecentBody)

export type RecentSortBy = 'recent' | 'frequent'

export const fetchRecents = (
  entityType: RecentEntityType,
  limit = 5,
  opts: { projectId?: number | null; sortBy?: RecentSortBy } = {},
) => {
  const params = new URLSearchParams()
  params.set('type', entityType)
  params.set('limit', String(limit))
  if (opts.projectId != null) params.set('project_id', String(opts.projectId))
  if (opts.sortBy)            params.set('sort_by',    opts.sortBy)
  return apiClient.get<{ data: RecentEntry[] }>(`/recents?${params.toString()}`)
}

export const fetchDashboardRecents = (limit = 8) =>
  apiClient.get<{ data: RecentEntry[] }>(`/recents/dashboard?limit=${limit}`)

/** Stabiler 31-bit-Hash fuer Filter-Objekte -> als ENTITY_ID nutzbar.
 *  Kollisionen sind in der Praxis unkritisch -- gleiche Filter waeren bei
 *  Kollision faelschlich zusammengefasst, was die User-Wahrnehmung kaum
 *  beeinflusst (Label + META werden ja jedes Mal aktualisiert). */
export function hashFilter(state: unknown): number {
  const s = JSON.stringify(state ?? {})
  let h = 0
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) - h + s.charCodeAt(i)) | 0
  }
  return Math.abs(h) || 1   // 0 verbietet das Backend
}
