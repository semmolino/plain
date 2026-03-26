import { apiClient } from './client'

export interface DashboardKpis {
  HONORAR_GESAMT:      number | null
  LEISTUNGSSTAND_VALUE: number | null
  OFFENE_LEISTUNG:     number | null
  STUNDEN_MONAT:       number | null
  ABSCHLAGSRECHNUNGEN: number | null
  SCHLUSSGERECHNET:    number | null
}

export interface DashboardProject {
  NAME_SHORT:          string | null
  NAME_LONG:           string | null
  BUDGET_TOTAL_NET:    number | null
  LEISTUNGSSTAND_VALUE: number | null
  HOURS_TOTAL:         number | null
  COST_TOTAL:          number | null
}

export interface DashboardMonthly {
  MONTH:       string
  HOURS_TOTAL: string | number
  COST_TOTAL:  string | number
}

export interface DashboardByStatus {
  STATUS_NAME:   string | null
  PROJECT_COUNT: string | number
}

export const fetchDashboardKpis = () =>
  apiClient.get<{ data: DashboardKpis }>('/reports/dashboard/kpis')

export const fetchDashboardProjects = () =>
  apiClient.get<{ data: DashboardProject[] }>('/reports/dashboard/projects')

export const fetchDashboardMonthly = () =>
  apiClient.get<{ data: DashboardMonthly[] }>('/reports/dashboard/monthly')

export const fetchDashboardByStatus = () =>
  apiClient.get<{ data: DashboardByStatus[] }>('/reports/dashboard/by-status')

// ── Project detail report ─────────────────────────────────────────────────────

export interface ProjectReportHeader {
  PROJECT_ID:                number
  NAME_SHORT:                string
  NAME_LONG:                 string
  PROJECT_STATUS_NAME_SHORT: string | null
  PROJECT_MANAGER_DISPLAY:   string | null
  COMPANY_NAME:              string | null
  BUDGET_TOTAL_NET:          number
  LEISTUNGSSTAND_PERCENT:    number | null
  LEISTUNGSSTAND_VALUE:      number
  HOURS_TOTAL:               number
  COST_TOTAL:                number
  EARNED_VALUE_NET:          number
  COST_RATIO:                number | null
  REMAINING_BUDGET_NET:      number
  BILLED_NET_TOTAL:          number
  OPEN_NET_TOTAL:            number
  PAYED_NET_TOTAL:           number
  SALES_TOTAL:               number
  QTY_EXT_TOTAL:             number
}

export interface ProjectReportStructure {
  STRUCTURE_ID:        number
  PARENT_STRUCTURE_ID: number | null
  NAME_SHORT:          string
  NAME_LONG:           string | null
  HOURS_TOTAL:         number
  COST_TOTAL:          number
  EARNED_VALUE_NET:    number
  HONORAR_NET:         number
  REST_HONORAR:        number
}

export type FilterMode = 'now' | 'as_of' | 'period'

export interface DateFilter {
  mode:      FilterMode
  asOfDate?: string   // ISO date, required when mode='as_of'
  dateFrom?: string   // ISO date, required when mode='period'
  dateTo?:   string   // ISO date, required when mode='period'
}

function buildDateParams(f: DateFilter): string {
  if (f.mode === 'now') return ''
  if (f.mode === 'as_of') return `&filter_mode=as_of&as_of_date=${f.asOfDate ?? ''}`
  return `&filter_mode=period&date_from=${f.dateFrom ?? ''}&date_to=${f.dateTo ?? ''}`
}

export const fetchProjectReportHeader = (projectId: number, filter: DateFilter = { mode: 'now' }) =>
  apiClient.get<{ data: ProjectReportHeader }>(`/reports/project/${projectId}/header?${buildDateParams(filter)}`)

export const fetchProjectReportStructure = (projectId: number, filter: DateFilter = { mode: 'now' }) =>
  apiClient.get<{ data: ProjectReportStructure[] }>(`/reports/project/${projectId}/structure?${buildDateParams(filter)}`)
