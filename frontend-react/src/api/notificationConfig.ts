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

export const fetchNotificationConfigs = () =>
  apiClient.get<{ data: NotificationTypeConfig[] }>('/notification-config')

export const upsertNotificationConfig = (typeKey: string, body: UpsertNotificationConfigBody) =>
  apiClient.put<{ data: unknown }>(`/notification-config/${encodeURIComponent(typeKey)}`, body)
