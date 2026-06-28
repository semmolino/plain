import { apiClient } from './client'

// ── Typen ─────────────────────────────────────────────────────────────────────

export interface AbsenceType {
  ID:                number
  NAME:              string
  COLOR:             string | null
  COUNTS_AS_WORKED:  boolean
  REDUCES_VACATION:  boolean
  REQUIRES_APPROVAL: boolean
  IS_PAID:           boolean
  ACTIVE:            number
  SORT_ORDER:        number
}

export type AbsenceStatus = 'REQUESTED' | 'APPROVED' | 'REJECTED' | 'CANCELLED'

export interface Absence {
  ID:                  number
  EMPLOYEE_ID:         number
  ABSENCE_TYPE_ID:     number
  DATE_FROM:           string
  DATE_TO:             string
  HALF_DAY:            boolean
  STATUS:              AbsenceStatus
  NOTE:                string | null
  REQUESTED_BY:        number | null
  REQUESTED_AT:        string | null
  DECIDED_BY:          number | null
  DECIDED_AT:          string | null
  DECISION_NOTE:       string | null
  // angereichert vom Backend
  DAYS:                number
  TYPE_NAME:           string | null
  TYPE_COLOR:          string | null
  REDUCES_VACATION:    boolean
  EMPLOYEE_SHORT_NAME: string | null
  EMPLOYEE_FIRST_NAME: string | null
  EMPLOYEE_LAST_NAME:  string | null
}

export interface VacationBalanceYear {
  year:      number
  carryover: number
  entitled:  number
  taken:     number
  remaining: number
}
export interface VacationBalance extends VacationBalanceYear {
  breakdown: VacationBalanceYear[]
}

export interface VacationEntitlement {
  ID:                 number
  EMPLOYEE_ID:        number
  YEAR:               number
  DAYS_ENTITLED:      number
  CARRYOVER_OVERRIDE: number | null
  NOTE:               string | null
}

export interface CreateAbsencePayload {
  employee_id?:    number
  absence_type_id: number
  date_from:       string
  date_to:         string
  half_day?:       boolean
  note?:           string
}

// ── Abwesenheitsarten (Katalog) ───────────────────────────────────────────────

export const fetchAbsenceTypes = () =>
  apiClient.get<{ data: AbsenceType[] }>('/abwesenheit/types')

export const createAbsenceType = (body: Partial<AbsenceType> & { name: string }) =>
  apiClient.post<{ data: AbsenceType }>('/abwesenheit/types', {
    name:              body.NAME,
    color:             body.COLOR,
    counts_as_worked:  body.COUNTS_AS_WORKED,
    reduces_vacation:  body.REDUCES_VACATION,
    requires_approval: body.REQUIRES_APPROVAL,
    is_paid:           body.IS_PAID,
    sort_order:        body.SORT_ORDER,
  })

export const updateAbsenceType = (id: number, body: Record<string, unknown>) =>
  apiClient.patch<{ success: boolean }>(`/abwesenheit/types/${id}`, body)

export const deleteAbsenceType = (id: number) =>
  apiClient.delete<{ success: boolean; deactivated?: boolean }>(`/abwesenheit/types/${id}`)

// ── Abwesenheiten ─────────────────────────────────────────────────────────────

export const fetchAbsences = (params: { employee_id?: number; from?: string; to?: string; status?: AbsenceStatus }) => {
  const p = new URLSearchParams()
  if (params.employee_id != null) p.set('employee_id', String(params.employee_id))
  if (params.from)   p.set('from', params.from)
  if (params.to)     p.set('to', params.to)
  if (params.status) p.set('status', params.status)
  const qs = p.toString()
  return apiClient.get<{ data: Absence[] }>(`/abwesenheit${qs ? `?${qs}` : ''}`)
}

export const createAbsence = (body: CreateAbsencePayload) =>
  apiClient.post<{ data: Absence }>('/abwesenheit', body)

export const updateAbsence = (id: number, body: Partial<CreateAbsencePayload>) =>
  apiClient.patch<{ success: boolean }>(`/abwesenheit/${id}`, body)

export const decideAbsence = (id: number, decision: 'APPROVED' | 'REJECTED', note?: string) =>
  apiClient.post<{ success: boolean }>(`/abwesenheit/${id}/decision`, { decision, note })

export const cancelAbsence = (id: number) =>
  apiClient.post<{ success: boolean }>(`/abwesenheit/${id}/cancel`, {})

export const deleteAbsence = (id: number) =>
  apiClient.delete<{ success: boolean }>(`/abwesenheit/${id}`)

// ── Urlaubsanspruch + Saldo ───────────────────────────────────────────────────

export const fetchVacationBalance = (employeeId: number, year?: number) => {
  const p = new URLSearchParams({ employee_id: String(employeeId) })
  if (year) p.set('year', String(year))
  return apiClient.get<{ data: VacationBalance }>(`/abwesenheit/vacation-balance?${p}`)
}

export const fetchEntitlements = (employeeId: number, year?: number) => {
  const p = new URLSearchParams({ employee_id: String(employeeId) })
  if (year) p.set('year', String(year))
  return apiClient.get<{ data: VacationEntitlement[] }>(`/abwesenheit/entitlements?${p}`)
}

export const putEntitlement = (body: { employee_id: number; year: number; days_entitled: number; carryover_override?: number | null; note?: string }) =>
  apiClient.put<{ data: VacationEntitlement }>('/abwesenheit/entitlements', body)
