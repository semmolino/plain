import { apiClient } from './client'

export interface NotificationTypeConfig {
  typeKey:                  string
  category:                 string
  title:                    string
  description:              string | null
  defaultEnabled:           boolean
  defaultAudienceKind:      'tenant_wide' | 'managed_by_rule'
  supportsAudienceOverride: boolean
  sortOrder:                number
  enabled:                  boolean
  audienceUseDefault:       boolean
  audienceAllTenant:        boolean
  audienceRoles:            string[]
  audienceDepartments:      number[]
  audienceEmployees:        number[]
  updatedAt:                string | null
}

export interface UpsertNotificationConfigBody {
  enabled?:             boolean
  audienceUseDefault?:  boolean
  audienceAllTenant?:   boolean
  audienceRoles?:       string[]
  audienceDepartments?: number[]
  audienceEmployees?:   number[]
}

/** Wer würde diesen Entwurf bekommen? Serverseitig mit derselben Logik
 *  aufgelöst wie der spätere Versand. */
export interface AudiencePreview {
  /** true = alle Mitarbeiter (tenant-weit), recipients bleibt dann leer. */
  tenantWide:     boolean
  /** Empfänger stehen erst pro Regel fest (z. B. Budget-Warnung). */
  managedByRule?: boolean
  /** Typ ist abgeschaltet. */
  disabled?:      boolean
  recipients:     { id: number; name: string }[]
}

export const fetchNotificationConfigs = () =>
  apiClient.get<{ data: NotificationTypeConfig[] }>('/notification-config')

export const upsertNotificationConfig = (typeKey: string, body: UpsertNotificationConfigBody) =>
  apiClient.put<{ data: unknown }>(`/notification-config/${encodeURIComponent(typeKey)}`, body)

export const previewNotificationAudience = (typeKey: string, body: UpsertNotificationConfigBody) =>
  apiClient.post<AudiencePreview>(`/notification-config/${encodeURIComponent(typeKey)}/preview`, body)
