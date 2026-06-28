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
  PROJECT_ID:                number | null
  NAME_SHORT:                string | null
  NAME_LONG:                 string | null
  PROJECT_STATUS_ID:         number | null
  PROJECT_STATUS_NAME_SHORT: string | null
  PROJECT_MANAGER_ID:        number | null
  PROJECT_MANAGER_DISPLAY:   string | null
  DEPARTMENT_ID:             number | null
  DEPARTMENT_NAME:           string | null
  BUDGET_TOTAL_NET:          number | null
  LEISTUNGSSTAND_PERCENT:    number | null
  LEISTUNGSSTAND_VALUE:      number | null
  HOURS_TOTAL:               number | null
  COST_TOTAL:                number | null
  COST_RATIO:                number | null
  REMAINING_BUDGET_NET:      number | null
  BILLED_NET_TOTAL:          number | null
  OPEN_NET_TOTAL:            number | null
  PAYED_NET_TOTAL:           number | null
  SALES_TOTAL:               number | null
  QTY_EXT_TOTAL:             number | null
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

export const fetchDashboardProjects = (dateFrom?: string, dateTo?: string) => {
  const qs = dateFrom && dateTo ? `?date_from=${dateFrom}&date_to=${dateTo}` : ''
  return apiClient.get<{ data: DashboardProject[] }>(`/reports/dashboard/projects${qs}`)
}

// Phase 3 — Open Sicherheitseinbehalte across the whole tenant
export interface DashboardOpenSe {
  totalOpen: number
  count:     number
  byProject: Array<{
    project_id: number
    name_short?: string
    name_long?:  string
    total:      number
    count:      number
  }>
}

export const fetchDashboardOpenSe = () =>
  apiClient.get<{ data: DashboardOpenSe }>('/reports/dashboard/open-se')

export interface DashboardArbzgStats {
  warnWeek:       number
  blockWeek:      number
  over8hWeek:     number
  warn30:         number
  block30:        number
  breakMissing30: number
  available:      boolean
}

export const fetchDashboardArbzgStats = () =>
  apiClient.get<{ data: DashboardArbzgStats }>('/reports/dashboard/arbzg-stats')

export const fetchDashboardMonthly = (dateFrom?: string, dateTo?: string) => {
  const qs = dateFrom && dateTo ? `?date_from=${dateFrom}&date_to=${dateTo}` : ''
  return apiClient.get<{ data: DashboardMonthly[] }>(`/reports/dashboard/monthly${qs}`)
}

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
  STRUCTURE_ID:           number
  PARENT_STRUCTURE_ID:    number | null
  NAME_SHORT:             string
  NAME_LONG:              string | null
  IS_LEAF:                boolean
  HOURS_TOTAL:            number
  COST_TOTAL:             number
  EARNED_VALUE_NET:       number
  HONORAR_NET:            number
  REST_HONORAR:           number
  LEISTUNGSSTAND_PERCENT: number
  KOSTENQUOTE:            number | null
}

export type FilterMode = 'now' | 'as_of' | 'period'

export interface DateFilter {
  mode:      FilterMode
  asOfDate?: string   // ISO date, required when mode='as_of'
  dateFrom?: string   // ISO date, required when mode='period'
  dateTo?:   string   // ISO date, required when mode='period'
}

function buildDateParams(f: DateFilter): string {
  if (f.mode === 'as_of') return `filter_mode=as_of&as_of_date=${f.asOfDate ?? ''}`
  if (f.mode === 'period') return `filter_mode=period&date_from=${f.dateFrom ?? ''}&date_to=${f.dateTo ?? ''}`
  return ''
}

// ── Multi-project list ────────────────────────────────────────────────────────

export interface ProjectListRow {
  PROJECT_ID:                number
  NAME_SHORT:                string
  NAME_LONG:                 string | null
  PROJECT_STATUS_ID:         number | null
  PROJECT_STATUS_NAME_SHORT: string | null
  PROJECT_TYPE_ID:           number | null
  PROJECT_TYPE_NAME_SHORT:   string | null
  PROJECT_MANAGER_ID:        number | null
  PROJECT_MANAGER_DISPLAY:   string | null
  ADDRESS_ID:                number | null
  ADDRESS_NAME:              string | null
  COMPANY_ID:                number | null
  COMPANY_NAME:              string | null
  DEPARTMENT_ID:             number | null
  DEPARTMENT_NAME:           string | null
  BUDGET_TOTAL_NET:          number
  LEISTUNGSSTAND_PERCENT:    number | null
  LEISTUNGSSTAND_VALUE:      number
  HOURS_TOTAL:               number
  COST_TOTAL:                number
  COST_RATIO:                number | null
  REMAINING_BUDGET_NET:      number
  BILLED_NET_TOTAL:          number
  OPEN_NET_TOTAL:            number
  PAYED_NET_TOTAL:           number
  SALES_TOTAL:               number
  QTY_EXT_TOTAL:             number
}

export const fetchProjectList = (filter: DateFilter = { mode: 'now' }) => {
  const qs = buildDateParams(filter)
  return apiClient.get<{ data: ProjectListRow[] }>(`/reports/projects/list${qs ? `?${qs}` : ''}`)
}

export const fetchProjectReportHeader = (projectId: number, filter: DateFilter = { mode: 'now' }) => {
  const qs = buildDateParams(filter)
  return apiClient.get<{ data: ProjectReportHeader }>(`/reports/project/${projectId}/header${qs ? `?${qs}` : ''}`)
}

export const fetchProjectReportStructure = (projectId: number, filter: DateFilter = { mode: 'now' }) => {
  const qs = buildDateParams(filter)
  return apiClient.get<{ data: ProjectReportStructure[] }>(`/reports/project/${projectId}/structure${qs ? `?${qs}` : ''}`)
}

// ── Project timeline (chart data) ─────────────────────────────────────────────

export interface TimelinePoint {
  DATE:                 string  // ISO date YYYY-MM-DD
  HONORAR_NET:          number
  LEISTUNGSSTAND_VALUE: number
  KOSTEN_TOTAL:         number
  ABGERECHNET_NET:      number
  BEZAHLT_NET:          number
}

function buildTimelineQs(filter: DateFilter): string {
  const params = new URLSearchParams()
  if (filter.mode === 'as_of' && filter.asOfDate) {
    params.set('date_to', filter.asOfDate)
  } else if (filter.mode === 'period') {
    if (filter.dateFrom) params.set('date_from', filter.dateFrom)
    if (filter.dateTo)   params.set('date_to',   filter.dateTo)
  }
  return params.toString()
}

export const fetchProjectTimeline = (projectId: number, filter: DateFilter = { mode: 'now' }) => {
  const qs = buildTimelineQs(filter)
  return apiClient.get<{ data: TimelinePoint[] }>(`/reports/project/${projectId}/timeline${qs ? `?${qs}` : ''}`)
}

export const fetchProjectsTimeline = (filter: DateFilter = { mode: 'now' }, projectIds?: number[]) => {
  const params = new URLSearchParams(buildTimelineQs(filter))
  // projectIds gesetzt (auch leeres Array) => Chart auf diese Projekte einschraenken
  if (projectIds) params.set('project_ids', projectIds.join(','))
  const qs = params.toString()
  return apiClient.get<{ data: TimelinePoint[] }>(`/reports/projects/timeline${qs ? `?${qs}` : ''}`)
}

// Offener Dashboard-Verlauf (kein reports.view nötig). scope='own' → nur Projekte,
// in denen der eingeloggte Nutzer Projektleiter ist (Projektleiter-Dashboard).
export const fetchDashboardProjectsTimeline = (scope: 'own' | undefined, dateFrom?: string, dateTo?: string) => {
  const params = new URLSearchParams()
  if (scope)    params.set('scope', scope)
  if (dateFrom) params.set('date_from', dateFrom)
  if (dateTo)   params.set('date_to',   dateTo)
  const qs = params.toString()
  return apiClient.get<{ data: TimelinePoint[] }>(`/reports/dashboard/projects-timeline${qs ? `?${qs}` : ''}`)
}

// ── Dashboard alerts & role-specific data ─────────────────────────────────────

export interface DashboardAlert {
  severity:   'red' | 'amber' | 'blue'
  type:       string
  message:    string
  count?:     number
  action_url: string
}

export interface OverdueInvoice {
  ID:               number
  INVOICE_NUMBER:   string
  INVOICE_DATE:     string | null
  DUE_DATE:         string
  TOTAL_AMOUNT_NET: number
  PROJECT_ID:       number | null
  days_overdue:     number
}

export interface TeamMemberUtilization {
  employee_id:  number
  short_name:   string
  hours_4weeks: number
}

export const fetchDashboardAlerts = () =>
  apiClient.get<{ data: DashboardAlert[] }>('/reports/dashboard/alerts')

export const fetchOverdueInvoices = () =>
  apiClient.get<{ data: OverdueInvoice[] }>('/reports/dashboard/overdue-invoices')

export const fetchTeamUtilization = () =>
  apiClient.get<{ data: TeamMemberUtilization[] }>('/reports/dashboard/team-utilization')

// ── Risk cockpit ──────────────────────────────────────────────────────────────

export interface RiskProject {
  PROJECT_ID:                number
  NAME_SHORT:                string
  NAME_LONG:                 string | null
  PROJECT_STATUS_ID:         number | null
  PROJECT_STATUS_NAME_SHORT: string | null
  PROJECT_MANAGER_ID:        number | null
  PROJECT_MANAGER_DISPLAY:   string | null
  DEPARTMENT_ID:             number | null
  DEPARTMENT_NAME:           string | null
  BUDGET_TOTAL_NET:          number
  LEISTUNGSSTAND_PERCENT:    number | null
  LEISTUNGSSTAND_VALUE:      number
  COST_TOTAL:                number
  COST_RATIO:                number | null
  BILLED_NET_TOTAL:          number
  OPEN_NET_TOTAL:            number
  ampel:  'rot' | 'orange' | 'gelb' | 'gruen'
  flags:  string[]
  db:     number
}

export interface BillingProject {
  PROJECT_ID:              number
  NAME_SHORT:              string
  NAME_LONG:               string | null
  PROJECT_MANAGER_DISPLAY: string | null
  OPEN_NET_TOTAL:          number
}

export interface BillingByPl {
  name:  string
  total: number
  count: number
}

export interface BillingSummaryData {
  projects: BillingProject[]
  byPl:     BillingByPl[]
}

// ── Company KPIs (Unternehmenskennzahlen) ─────────────────────────────────────

export interface CompanyKpiRaw {
  revenue:               number
  directCosts:           number
  totalHours:            number
  employeeCount:         number
  projectEmployeeCount:  number
  backlog:               number
}

export interface CompanyKpis {
  umsatzProMitarbeiter:      number | null
  anteilProjektmitarbeiter:  number | null   // %
  mittlererStundensatz:      number | null   // €/h
  auftragsreichweite:        number | null   // months
  deckungsbeitragMarge:      number | null   // %
}

export interface CompanyKpiResult {
  year:         number
  periodType:   'year' | 'quarter' | 'month'
  periodMonths: number
  raw:          CompanyKpiRaw
  kpis:         CompanyKpis
}

export interface CompanyKpiPeriod {
  type:     'year' | 'quarter' | 'month'
  year:     number
  quarter?: number
  month?:   number
}

export const fetchCompanyKpis = (period: CompanyKpiPeriod) => {
  const qs = new URLSearchParams({ period_type: period.type, year: String(period.year) })
  if (period.type === 'quarter' && period.quarter != null) qs.set('quarter', String(period.quarter))
  if (period.type === 'month'   && period.month   != null) qs.set('month',   String(period.month))
  return apiClient.get<{ data: CompanyKpiResult }>(`/reports/company-kpis?${qs}`)
}

export interface TeamHoursMonth {
  month: string
  hours: number
}

export interface TeamHoursEmployee {
  employee_id: number
  short_name:  string
  months:      TeamHoursMonth[]
  total:       number
}

export interface TeamHoursData {
  employees: TeamHoursEmployee[]
  months:    string[]
}

// scope='own' → nur Projekte, in denen der eingeloggte Nutzer Projektleiter ist
export const fetchRiskProjects = (scope?: 'own') =>
  apiClient.get<{ data: RiskProject[] }>(`/reports/dashboard/risk-projects${scope ? `?scope=${scope}` : ''}`)

export const fetchBillingSummary = () =>
  apiClient.get<{ data: BillingSummaryData }>('/reports/dashboard/billing-summary')

// ── Größte offene Posten (unbezahlte Rechnungen + Abschlagsrechnungen) ─────────

export interface OpenPosten {
  sourceType:  'invoice' | 'pp'
  sourceId:    number
  number:      string
  date:        string | null
  dueDate:     string | null
  addressName: string | null
  projectId:   number | null
  openAmount:  number   // offener Brutto-Betrag
  daysOverdue: number
}

export const fetchDashboardOpenInvoices = (limit = 10) =>
  apiClient.get<{ data: OpenPosten[] }>(`/reports/dashboard/open-invoices?limit=${limit}`)

// ── Company snapshot (gleitende 12 Monate + aktueller Auftragsbestand) ─────────

export interface CompanySnapshot {
  periodMonths: number
  raw: {
    revenue:              number
    directCosts:          number
    totalHours:           number
    employeeCount:        number
    projectEmployeeCount: number
    backlog:              number
  }
  kpis: {
    umsatzProMitarbeiter:     number | null
    anteilProjektmitarbeiter: number | null  // %
    auftragsreichweite:       number | null  // Monate
  }
}

export const fetchDashboardCompanySnapshot = () =>
  apiClient.get<{ data: CompanySnapshot }>('/reports/dashboard/company-snapshot')

export const fetchTeamHours = (dateFrom?: string, dateTo?: string) => {
  const qs = dateFrom && dateTo ? `?date_from=${dateFrom}&date_to=${dateTo}` : ''
  return apiClient.get<{ data: TeamHoursData }>(`/reports/dashboard/team-hours${qs}`)
}

// ── Periodic Trends ───────────────────────────────────────────────────────────

export interface TrendPeriod {
  period:          string        // "2026-05" | "2026-Q2" | "2026"
  period_label:    string        // "05/2026" | "Q2 2026" | "2026"
  period_start:    string
  period_end:      string
  stunden:         number
  kosten:          number
  avg_stundensatz: number | null
  fakturiert:      number
  bezahlt:         number
  db:              number        // Deckungsbeitrag = fakturiert − kosten
  db_marge:        number | null // db / fakturiert × 100
  auftragsbestand: number
}

export type TrendsGroupBy = 'month' | 'quarter' | 'year'

export const fetchTrends = (groupBy: TrendsGroupBy, dateFrom?: string, dateTo?: string) => {
  const qs = new URLSearchParams({ group_by: groupBy })
  if (dateFrom) qs.set('date_from', dateFrom)
  if (dateTo)   qs.set('date_to',   dateTo)
  return apiClient.get<{ data: TrendPeriod[] }>(`/reports/trends?${qs}`)
}
