import { apiClient } from './client'

export interface Employee {
  ID:                  number
  SHORT_NAME:          string
  TITLE:               string | null
  FIRST_NAME:          string
  LAST_NAME:           string
  MAIL:                string | null
  MOBILE:              string | null
  PERSONNEL_NUMBER:    string | null
  GENDER_ID:           number | null
  GENDER:              string
  NAME:                string
  DEPARTMENT_ID:       number | null
  DEPARTMENT_NAME:     string
  ACTIVE:              number | null
  CURRENT_MODEL_ID:    number | null
  CURRENT_MODEL_NAME:  string
  DASHBOARD_ROLE:      string | null
}

export interface EmpGender { ID: number; GENDER: string }

export interface CreateEmployeePayload {
  short_name:        string
  title?:            string
  first_name:        string
  last_name:         string
  password?:         string
  email?:            string
  mobile?:           string
  personnel_number?: string
  gender_id:         string | number
}

export interface UpdateEmployeePayload {
  short_name:        string
  title?:            string
  first_name:        string
  last_name:         string
  mail?:             string
  mobile?:           string
  personnel_number?: string
  gender_id:         number
  department_id?:    number | null
  active?:           number
  dashboard_role?:   string | null
}

// ── Work-model assignments ────────────────────────────────────────────────────

export interface WorkTimeModel {
  ID: number; NAME: string; COUNTRY_CODE: string; STATE_CODE: string | null
  MON: number; TUE: number; WED: number; THU: number; FRI: number; SAT: number; SUN: number
}

export interface EmployeeWorkModel {
  ID:          number
  EMPLOYEE_ID: number
  MODEL_ID:    number
  VALID_FROM:  string
  model:       WorkTimeModel | null
}

export interface EmployeeCpRate {
  ID:         number
  CP_RATE:    number
  VALID_FROM: string
}

export interface DayBooking {
  id:           number
  hours:        number
  description:  string
  project:      string
  structure:    string
  time_start:   string | null
  time_finish:  string | null
  project_id:   number | null
  structure_id: number | null
}

export interface DayBalance {
  date:      string
  weekday:   number
  required:  number
  actual:    number
  balance:   number
  isHoliday: boolean
  bookings:  DayBooking[]
}

export interface MonthBalance {
  year:     number
  month:    number
  required: number
  actual:   number
  balance:  number
  days:     DayBalance[]
}

export interface RunningMonth {
  year:       number
  month:      number
  required:   number
  actual:     number
  balance:    number
  cumulative: number
}

export const fetchEmployeeGenders = () =>
  apiClient.get<{ data: EmpGender[] }>('/mitarbeiter/genders')

export const fetchEmployeeList = () =>
  apiClient.get<{ data: Employee[] }>('/mitarbeiter/list?limit=2000')

export const createEmployee = (body: CreateEmployeePayload) =>
  apiClient.post<{ data: Employee }>('/mitarbeiter', body)

export const updateEmployee = (id: number, body: UpdateEmployeePayload) =>
  apiClient.patch<{ data: Employee }>(`/mitarbeiter/${id}`, body)

export const deleteEmployee = (id: number) =>
  apiClient.delete<{ success: boolean }>(`/mitarbeiter/${id}`)

export const fetchEmployeeWorkModels = (id: number) =>
  apiClient.get<{ data: EmployeeWorkModel[] }>(`/mitarbeiter/${id}/work-models`)

export const createEmployeeWorkModel = (id: number, body: { model_id: number; valid_from: string }) =>
  apiClient.post<{ data: EmployeeWorkModel }>(`/mitarbeiter/${id}/work-models`, body)

export const updateEmployeeWorkModel = (id: number, wid: number, body: { model_id?: number; valid_from?: string }) =>
  apiClient.patch<{ data: EmployeeWorkModel }>(`/mitarbeiter/${id}/work-models/${wid}`, body)

export const deleteEmployeeWorkModel = (id: number, wid: number) =>
  apiClient.delete<{ ok: boolean }>(`/mitarbeiter/${id}/work-models/${wid}`)

export const fetchEmployeeCpRateForDate = (id: number, date: string) =>
  apiClient.get<{ data: { rate: number; found: boolean } }>(`/mitarbeiter/${id}/cp-rate?date=${date}`)

export const fetchEmployeeCpRates = (id: number) =>
  apiClient.get<{ data: EmployeeCpRate[] }>(`/mitarbeiter/${id}/cp-rates`)

export const createEmployeeCpRate = (id: number, body: { cp_rate: number; valid_from: string }) =>
  apiClient.post<{ data: EmployeeCpRate }>(`/mitarbeiter/${id}/cp-rates`, body)

export const updateEmployeeCpRate = (id: number, rid: number, body: { cp_rate?: number; valid_from?: string }) =>
  apiClient.patch<{ data: EmployeeCpRate }>(`/mitarbeiter/${id}/cp-rates/${rid}`, body)

export const deleteEmployeeCpRate = (id: number, rid: number) =>
  apiClient.delete<{ ok: boolean }>(`/mitarbeiter/${id}/cp-rates/${rid}`)

export const fetchMonthBalance = (id: number, year: number, month: number) =>
  apiClient.get<{ data: MonthBalance }>(`/mitarbeiter/${id}/balance?year=${year}&month=${month}`)

export const fetchRunningBalance = (id: number) =>
  apiClient.get<{ data: { months: RunningMonth[]; totalBalance: number } }>(`/mitarbeiter/${id}/balance/running`)

// ── Employee list report ──────────────────────────────────────────────────────

export interface EmployeeReportRow {
  EMPLOYEE_ID:      number
  SHORT_NAME:       string
  FIRST_NAME:       string
  LAST_NAME:        string
  DEPARTMENT_NAME:  string
  YEAR:             number
  MONTH:            number
  REQUIRED:         number
  ACTUAL:           number
  BALANCE:          number
  HOURS_EXT:        number
  COST:             number
  RUNNING_BALANCE?: number
  PRODUCTIVITY_PCT: number | null
}

export const fetchEmployeeReportList = (params: {
  mode:         'now' | 'as_of' | 'period'
  asOfDate?:    string
  dateFrom?:    string
  dateTo?:      string
  employeeId?:  number
}) => {
  const p = new URLSearchParams({ mode: params.mode })
  if (params.asOfDate)   p.set('as_of_date', params.asOfDate)
  if (params.dateFrom)   p.set('date_from',  params.dateFrom)
  if (params.dateTo)     p.set('date_to',    params.dateTo)
  if (params.employeeId) p.set('employee_id', String(params.employeeId))
  return apiClient.get<{ data: EmployeeReportRow[] }>(`/mitarbeiter/report-list?${p}`)
}

// ── Month close ───────────────────────────────────────────────────────────────

export interface MonthClose {
  ID:        number
  YEAR:      number
  MONTH:     number
  CLOSED_AT: string
  CLOSED_BY: number
}

export interface MonthCloseOverviewEmployee {
  ID:         number
  SHORT_NAME: string
  FIRST_NAME: string
  LAST_NAME:  string
  months:     Array<{ year: number; month: number; closed: boolean; closed_at: string | null }>
}

export const fetchMonthCloseStatus = (id: number, year: number, month: number) =>
  apiClient.get<{ data: MonthClose | null }>(`/mitarbeiter/${id}/month-close/${year}/${month}`)

export const closeMonth = (id: number, year: number, month: number) =>
  apiClient.post<{ data: MonthClose }>(`/mitarbeiter/${id}/month-close`, { year, month })

export const reopenMonth = (id: number, year: number, month: number) =>
  apiClient.delete<{ ok: boolean }>(`/mitarbeiter/${id}/month-close/${year}/${month}`)

export const fetchMonthCloseOverview = () =>
  apiClient.get<{ data: MonthCloseOverviewEmployee[]; months: Array<{ year: number; month: number }> }>('/mitarbeiter/month-close-overview')

export const setEmployeePassword = (id: number, new_password: string | null) =>
  apiClient.patch<{ success: boolean }>(`/mitarbeiter/${id}/set-password`, { new_password })
