import { apiClient } from './client'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ProjectStatus     { ID: number; NAME_SHORT: string }
export interface ProjectType       { ID: number; NAME_SHORT: string }
export interface ProjectManager    { ID: number; SHORT_NAME: string }
export interface Department        { ID: number; NAME_SHORT: string; NAME_LONG: string }
export interface ActiveEmployee { ID: number; SHORT_NAME: string; FIRST_NAME: string; LAST_NAME: string }
export interface ActiveRole     { ID: number; NAME_SHORT: string; NAME_LONG: string }
export interface BillingType    { ID: number; NAME_SHORT: string; NAME_LONG: string }

export interface Project {
  ID:                  number
  NAME_SHORT:          string
  NAME_LONG:           string
  PROJECT_STATUS_ID:   number | null
  PROJECT_TYPE_ID:     number | null
  PROJECT_MANAGER_ID:  number | null
  STATUS_NAME:         string
  TYPE_NAME:           string
  MANAGER_NAME:        string
}

export interface StructureNode {
  STRUCTURE_ID:                number
  NAME_SHORT:                  string
  NAME_LONG:                   string
  PROJECT_ID:                  number
  BILLING_TYPE_ID:             number | null
  FATHER_ID:                   number | null
  SORT_ORDER:                  number
  REVENUE:                     number
  EXTRAS_PERCENT:              number
  EXTRAS:                      number
  REVENUE_COMPLETION_PERCENT:  number
  EXTRAS_COMPLETION_PERCENT:   number
  REVENUE_COMPLETION:          number
  EXTRAS_COMPLETION:           number
  TEC_SP_TOT_SUM:              number
  children?:                   StructureNode[]
}

export interface E2PRow {
  employee_id:    number
  role_id?:       string | number
  role_name_short?: string
  role_name_long?:  string
  sp_rate?:       string | number
}

export interface StructureDraftRow {
  tmp_key:         string
  father_tmp_key:  string
  NAME_SHORT:      string
  NAME_LONG:       string
  BILLING_TYPE_ID: string | number
  EXTRAS_PERCENT:  string | number
}

export interface CreateProjectPayload {
  company_id:          string | number
  name_long:           string
  project_status_id:   string | number
  project_type_id?:    string | number
  department_id?:      string | number
  project_manager_id:  string | number
  address_id:          string | number
  contact_id:          string | number
  employee2project?:   E2PRow[]
  project_structure?:  StructureDraftRow[]
}

// ── Lookups ───────────────────────────────────────────────────────────────────

export const fetchDepartments      = () => apiClient.get<{ data: Department[] }>('/projekte/departments')
export const fetchProjectStatuses  = () => apiClient.get<{ data: ProjectStatus[] }>('/projekte/statuses')
export const fetchProjectTypes     = () => apiClient.get<{ data: ProjectType[] }>('/projekte/types')
export const fetchProjectManagers  = () => apiClient.get<{ data: ProjectManager[] }>('/projekte/managers')
export const fetchActiveEmployees  = () => apiClient.get<{ data: ActiveEmployee[] }>('/projekte/employees/active')
export const fetchActiveRoles      = () => apiClient.get<{ data: ActiveRole[] }>('/projekte/roles/active')
export const fetchBillingTypes     = () => apiClient.get<{ data: BillingType[] }>('/stammdaten/billing-types')

// ── Projects ──────────────────────────────────────────────────────────────────

export const fetchProjectListFull = () =>
  apiClient.get<{ data: Project[] }>('/projekte/list?limit=2000')

export const fetchProjectsShort = () =>
  apiClient.get<{ data: Array<{ ID: number; NAME_SHORT: string; NAME_LONG: string }> }>('/projekte')

export const createProject = (body: CreateProjectPayload) =>
  apiClient.post<{ data: Project }>('/projekte', body)

export const updateProject = (id: number, body: Partial<{
  name_short: string; name_long: string
  project_status_id: number; project_type_id: number; project_manager_id: number
}>) => apiClient.patch<{ data: Project }>(`/projekte/${id}`, body)

export const searchProjectsApi = (q: string) =>
  apiClient.get<{ data: Array<{ ID: number; NAME_SHORT: string; NAME_LONG: string; COMPANY_ID: number | null }> }>(
    `/projekte/search?q=${encodeURIComponent(q)}`
  )

// ── Structure ─────────────────────────────────────────────────────────────────

export const fetchProjectStructure = (projectId: number) =>
  apiClient.get<{ data: StructureNode[] }>(`/projekte/${projectId}/structure`)

export const patchStructureCompletion = (structureId: number, body: {
  revenue_completion_percent: number
  extras_completion_percent: number
}) => apiClient.patch<{ data: StructureNode }>(`/projekte/structure/${structureId}/completion-percents`, body)

export const patchStructureExtras = (structureId: number, extrasPercent: number) =>
  apiClient.patch<{ data: StructureNode }>(`/projekte/structure/${structureId}`, { EXTRAS_PERCENT: extrasPercent })

export const patchStructureNode = (structureId: number, body: Partial<{
  NAME_SHORT: string; NAME_LONG: string
  BILLING_TYPE_ID: number; REVENUE: number; EXTRAS_PERCENT: number
  REVENUE_COMPLETION_PERCENT: number; EXTRAS_COMPLETION_PERCENT: number
}>) => apiClient.patch<{ data: StructureNode }>(`/projekte/structure/${structureId}`, body)

export const inheritStructureExtras = (structureId: number, extrasPercent: number) =>
  apiClient.patch<{ updated: number }>(`/projekte/structure/${structureId}/inherit`, { EXTRAS_PERCENT: extrasPercent })

export const createStructureNode = (projectId: number, node: {
  NAME_SHORT: string
  NAME_LONG?: string
  BILLING_TYPE_ID: number
  FATHER_ID?: number | null
  REVENUE?: number
  EXTRAS_PERCENT?: number
}) => apiClient.post<{ data: StructureNode }>(`/projekte/${projectId}/structure`, node)

export const deleteStructureNode = (structureId: number, cascade = true) =>
  apiClient.delete<{ success: boolean; deleted_ids: number[] }>(`/projekte/structure/${structureId}?cascade=${cascade ? 1 : 0}`)

export const moveStructureNode = (structureId: number, fatherId: number | null, sortAfterId?: number | null | '__end__') =>
  apiClient.patch<{ success: boolean }>(`/projekte/structure/${structureId}/move`, {
    father_id: fatherId,
    ...(sortAfterId !== undefined ? { sort_after_id: sortAfterId } : {}),
  })

export const createProgressSnapshot = (projectId: number) =>
  apiClient.post<{ success: boolean }>(`/projekte/${projectId}/progress-snapshot`, {})

// ── Verträge ──────────────────────────────────────────────────────────────────

export interface Contract {
  ID:                   number
  NAME_SHORT:           string
  NAME_LONG:            string
  PROJECT_ID:           number
  INVOICE_ADDRESS_ID:   number | null
  INVOICE_CONTACT_ID:   number | null
}

export const fetchContractByProject = (projectId: number) =>
  apiClient.get<{ data: Contract | null }>(`/projekte/${projectId}/contract`)

export const patchContract = (contractId: number, body: Partial<{
  NAME_SHORT: string
  NAME_LONG: string
  INVOICE_ADDRESS_ID: number | null
}>) => apiClient.patch<{ success: boolean }>(`/projekte/contract/${contractId}`, body)

// ── Leistungsstände ───────────────────────────────────────────────────────────

export interface LeistungsstandNode extends StructureNode {
  IS_LEAF:                          boolean
  PREV_REVENUE_COMPLETION_PERCENT:  number | null
  PREV_EXTRAS_COMPLETION_PERCENT:   number | null
  PREV_AT:                          string | null
}

export const fetchLeistungsstand = (projectId: number) =>
  apiClient.get<{ data: LeistungsstandNode[] }>(`/projekte/${projectId}/leistungsstand`)

export const saveLeistungsstand = (projectId: number, updates: Array<{
  structure_id: number
  revenue_completion_percent: number
}>) => apiClient.post<{ success: boolean; saved: number; inserted: number }>(
  `/projekte/${projectId}/leistungsstand`,
  { updates }
)

// ── Buchungen ─────────────────────────────────────────────────────────────────

export interface Buchung {
  ID:                  number
  PROJECT_ID:          number
  STRUCTURE_ID:        number | null
  EMPLOYEE_ID:         number
  DATE_VOUCHER:        string
  TIME_START:          string | null
  TIME_FINISH:         string | null
  QUANTITY_INT:        number
  CP_RATE:             number
  CP_TOT:              number
  QUANTITY_EXT:        number
  SP_RATE:             number
  SP_TOT:              number
  POSTING_DESCRIPTION: string
  EMPLOYEE:            { SHORT_NAME: string } | null
}

export interface CreateBuchungPayload {
  PROJECT_ID:          number
  STRUCTURE_ID?:       number
  EMPLOYEE_ID:         number
  DATE_VOUCHER:        string
  TIME_START?:         string
  TIME_FINISH?:        string
  QUANTITY_INT:        number
  CP_RATE:             number
  QUANTITY_EXT:        number
  SP_RATE:             number
  POSTING_DESCRIPTION: string
}

export const fetchBuchungen = (projectId: number) =>
  apiClient.get<{ data: Buchung[] }>(`/buchungen/project/${projectId}`)

export const createBuchung = (body: CreateBuchungPayload) =>
  apiClient.post<{ success: boolean }>('/buchungen', body)

export const deleteBuchung = (id: number) =>
  apiClient.delete<{ success: boolean }>(`/buchungen/${id}`)

export interface Employee2ProjectPreset {
  found:           boolean
  SP_RATE:         number | null
  ROLE_ID:         number | null
  ROLE_NAME_SHORT: string | null
  ROLE_NAME_LONG:  string | null
}

export const fetchEmployee2ProjectPreset = (employeeId: number, projectId: number) =>
  apiClient.get<Employee2ProjectPreset>(
    `/employee2project/preset?employee_id=${employeeId}&project_id=${projectId}`
  )
