import { apiClient } from './client'

export interface Notification {
  ID:         number
  TYPE:       string
  TITLE:      string
  BODY:       string | null
  LINK:       string | null
  METADATA:   Record<string, unknown> | null
  READ_AT:    string | null
  CREATED_AT: string
}

export const fetchNotifications = () =>
  apiClient.get<{ data: Notification[]; unread_count: number }>('/notifications')

export const markNotificationRead = (id: number) =>
  apiClient.patch<{ ok: boolean }>(`/notifications/${id}/read`, {})

export const markAllNotificationsRead = () =>
  apiClient.post<{ ok: boolean }>('/notifications/read-all', {})
