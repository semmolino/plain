import { apiClient } from './client'

/** 'per_project' = je Projekt eine Nachricht · 'summary' = eine insgesamt. */
export type PmNotifyMode = 'per_project' | 'summary'

export interface NotificationSchedule {
  ID:                    number
  TENANT_ID:             number
  TYPE_KEY:              string
  ENABLED:               boolean
  SCHEDULE_DAYS:         number[] | null
  SCHEDULE_LAST_DAY:     boolean
  SCHEDULE_TIME_OF_DAY:  string | null   // "HH:MM:SS"
  NOTIFY_PROJECT_PM:     boolean
  /** Wie die Projektleitung erinnert wird: je Projekt eine Nachricht oder
   *  eine Sammelnachricht. Fehlt, solange Migration 0129 nicht läuft. */
  PM_NOTIFY_MODE:        PmNotifyMode | null
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
  scheduleTimeOfDay?:   string          // "HH:MM"
  notifyProjectPm?:     boolean
  pmNotifyMode?:        PmNotifyMode
  projectStatusIds?:    number[]
  audienceRoles?:       string[]
  audienceDepartments?: number[]
  audienceEmployees?:   number[]
}

/** In dieser Zone gilt SCHEDULE_TIME_OF_DAY. Das UI rechnet daraus die
 *  Gerätezeit des Betrachters — gespeichert wird weiter die Bürozeit, sonst
 *  verschöbe sich der Versand je nachdem, wer zuletzt gespeichert hat. */
export const fetchNotificationSchedule = (typeKey: string) =>
  apiClient.get<{ data: NotificationSchedule | null; bueroZeitzone: string }>(
    `/notification-schedule/${encodeURIComponent(typeKey)}`,
  )

export const upsertNotificationSchedule = (typeKey: string, body: UpsertNotificationScheduleBody) =>
  apiClient.put<{ data: NotificationSchedule }>(`/notification-schedule/${encodeURIComponent(typeKey)}`, body)

export const runNotificationScheduleNow = (typeKey: string) =>
  apiClient.post<{ ok: boolean; created: number }>(`/notification-schedule/${encodeURIComponent(typeKey)}/run-now`, {})
