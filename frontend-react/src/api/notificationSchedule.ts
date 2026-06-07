import { apiClient } from './client'

export interface NotificationSchedule {
  ID:                    number
  TENANT_ID:             number
  TYPE_KEY:              string
  ENABLED:               boolean
  SCHEDULE_DAYS:         number[] | null
  SCHEDULE_LAST_DAY:     boolean
  NOTIFY_PROJECT_PM:     boolean
  PROJECT_STATUS_IDS:    number[] | null
  AUDIENCE_ROLES:        string[] | null
  AUDIENCE_DEPARTMENTS:  number[] | null
  AUDIENCE_EMPLOYEES:    number[] | null
  LAST_FIRED_DATE:       string | null
  UPDATED_AT:            string | null
}

export interface UpsertNotificationScheduleBody {
  enabled?:             boolean
  scheduleDays?:        number[]
  scheduleLastDay?:     boolean
  notifyProjectPm?:     boolean
  projectStatusIds?:    number[]
  audienceRoles?:       string[]
  audienceDepartments?: number[]
  audienceEmployees?:   number[]
}

export const fetchNotificationSchedule = (typeKey: string) =>
  apiClient.get<{ data: NotificationSchedule | null }>(`/notification-schedule/${encodeURIComponent(typeKey)}`)

export const upsertNotificationSchedule = (typeKey: string, body: UpsertNotificationScheduleBody) =>
  apiClient.put<{ data: NotificationSchedule }>(`/notification-schedule/${encodeURIComponent(typeKey)}`, body)

export const runNotificationScheduleNow = (typeKey: string) =>
  apiClient.post<{ ok: boolean; created: number }>(`/notification-schedule/${encodeURIComponent(typeKey)}/run-now`, {})
