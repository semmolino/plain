import { apiClient } from './client'

// ── Types ───────────────────────────────────────────────────────────────────

export interface Permission {
  ID:             number
  KEY:            string
  MODULE:         string
  ACTION:         string
  LABEL_DE:       string
  DESCRIPTION_DE: string | null
  CATEGORY:       string | null
  POSITION:       number
}

export interface UserRole {
  ID:              number
  NAME_SHORT:      string
  NAME_LONG:       string | null
  COLOR:           string | null
  IS_SYSTEM:       boolean
  IS_DEFAULT:      boolean
  CREATED_AT:      string
  UPDATED_AT:      string
  EMPLOYEE_COUNT:  number
}

export interface UserRoleDetail extends Omit<UserRole, 'EMPLOYEE_COUNT'> {
  PERMISSION_IDS: number[]
}

export interface EmployeeRoleMapping {
  EMPLOYEE_ID: number
  ROLE_ID:    number
}

export interface MyPermissionsResponse {
  keys:         string[]
  unrestricted: boolean
}

export interface CreateRolePayload {
  name_short:     string
  name_long?:     string | null
  color?:         string | null
  permission_ids?: number[]
}

export interface PatchRolePayload {
  name_short?:     string
  name_long?:      string | null
  color?:          string | null
  is_default?:     boolean
  permission_ids?: number[]
}

// ── API ─────────────────────────────────────────────────────────────────────

export const fetchMyPermissions = () =>
  apiClient.get<MyPermissionsResponse>('/permissions/me')

export const fetchPermissionCatalog = () =>
  apiClient.get<{ data: Permission[] }>('/permissions')

export const fetchRoles = () =>
  apiClient.get<{ data: UserRole[] }>('/roles')

export const fetchRole = (id: number) =>
  apiClient.get<{ data: UserRoleDetail }>(`/roles/${id}`)

export const createRole = (body: CreateRolePayload) =>
  apiClient.post<{ data: UserRole }>('/roles', body)

export const patchRole = (id: number, body: PatchRolePayload) =>
  apiClient.patch<{ data: { id: number } }>(`/roles/${id}`, body)

export const deleteRole = (id: number) =>
  apiClient.delete<{ ok: boolean }>(`/roles/${id}`)

export const duplicateRole = (id: number) =>
  apiClient.post<{ data: UserRole }>(`/roles/${id}/duplicate`, {})

export const fetchEmployeeRoleMap = () =>
  apiClient.get<{ data: EmployeeRoleMapping[] }>('/roles/employees')

export const setEmployeeRoles = (employeeId: number, roleIds: number[]) =>
  apiClient.put<{ ok: boolean }>(`/employees/${employeeId}/roles`, { role_ids: roleIds })
