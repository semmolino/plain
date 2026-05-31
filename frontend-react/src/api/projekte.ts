import { apiClient } from './client'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ProjectStatus     { ID: number; NAME_SHORT: string }
export interface ProjectType       { ID: number; NAME_SHORT: string }
export interface ProjectManager    { ID: number; SHORT_NAME: string }
export interface Department        { ID: number; NAME_SHORT: string; NAME_LONG: string }
export interface ActiveEmployee { ID: number; SHORT_NAME: string; FIRST_NAME: string; LAST_NAME: string }
export interface ActiveRole     { ID: number; NAME_SHORT: string; NAME_LONG: string; SP_RATE: number | null }
export interface BillingType    { ID: number; NAME_SHORT: string; NAME_LONG: string }

export interface Project {
  ID:                  number
  NAME_SHORT:          string
  NAME_LONG:           string
  PROJECT_STATUS_ID:   number | null
  PROJECT_TYPE_ID:     number | null
  PROJECT_MANAGER_ID:  number | null
  DEPARTMENT_ID:       number | null
  ADDRESS_ID:          number | null
  CONTACT_ID:          number | null
  IS_INTERNAL:         boolean
  STATUS_NAME:         string
  TYPE_NAME:           string
  MANAGER_NAME:        string
  ADDRESS_NAME:        string
  CONTACT_NAME:        string
  DEPARTMENT_NAME:     string
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
  IS_INTERNAL:                 boolean
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

export const deleteProject = (id: number) =>
  apiClient.delete<{ success: boolean }>(`/projekte/${id}`)

export const cascadeProjectInternal = (projectId: number, isInternal: boolean) =>
  apiClient.patch<{ data: { updated: boolean } }>(`/projekte/${projectId}/internal-cascade`, { is_internal: isInternal })

export const copyProject = (id: number) =>
  apiClient.post<{ data: { project: { ID: number; NAME_SHORT: string }; projectName: string } }>(`/projekte/${id}/copy`, {})

export const updateProject = (id: number, body: Partial<{
  name_short: string; name_long: string
  project_status_id: number; project_type_id: number | null; project_manager_id: number
  department_id: number | null; address_id: number | null; contact_id: number | null
  is_internal: boolean
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
  IS_INTERNAL: boolean
}>) => apiClient.patch<{ data: StructureNode }>(`/projekte/structure/${structureId}`, body)

export const inheritStructureExtras = (structureId: number, extrasPercent: number) =>
  apiClient.patch<{ updated: number }>(`/projekte/structure/${structureId}/inherit`, { EXTRAS_PERCENT: extrasPercent })

export interface ParentChildCheckResult {
  status: 'ok' | 'needs_transfer' | 'blocked'
  reason?: string
  hasTec?: boolean
  parentValues?: { REVENUE: number; EXTRAS: number; [k: string]: unknown }
}
export const fetchParentChildCheck = (parentId: number) =>
  apiClient.get<ParentChildCheckResult>(`/projekte/structure/${parentId}/child-check`)

export const transferFatherToChild = (fatherId: number, childId: number) =>
  apiClient.post<{ success: boolean }>(`/projekte/structure/${fatherId}/transfer-to-child`, { child_id: childId })

export const createStructureNode = (projectId: number, node: {
  NAME_SHORT: string
  NAME_LONG?: string
  BILLING_TYPE_ID: number
  FATHER_ID?: number | null
  REVENUE?: number
  EXTRAS_PERCENT?: number
  transfer_parent_values?: boolean
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
  ID:                    number
  NAME_SHORT:            string
  NAME_LONG:             string
  PROJECT_ID:            number
  INVOICE_ADDRESS_ID:    number | null
  INVOICE_ADDRESS_NAME:  string | null
  INVOICE_CONTACT_ID:    number | null
  CASH_DISCOUNT_PERCENT: number | null
  CASH_DISCOUNT_DAYS:    number | null
}

export const fetchContractByProject = (projectId: number) =>
  apiClient.get<{ data: Contract | null }>(`/projekte/${projectId}/contract`)

export const patchContract = (contractId: number, body: Partial<{
  NAME_SHORT: string
  NAME_LONG: string
  INVOICE_ADDRESS_ID: number | null
  INVOICE_CONTACT_ID: number | null
  CASH_DISCOUNT_PERCENT: number | null
  CASH_DISCOUNT_DAYS: number | null
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
  POSTING_DESCRIPTION:  string
  PARTIAL_PAYMENT_ID:   number | null
  INVOICE_ID:           number | null
  EMPLOYEE:             { SHORT_NAME: string } | null
}

export interface CreateBuchungPayload {
  PROJECT_ID:          number
  STRUCTURE_ID?:       number
  EMPLOYEE_ID:         number
  DATE_VOUCHER:        string
  TIME_START?:         string
  TIME_FINISH?:        string
  QUANTITY_INT:        number
  CP_RATE?:            number
  QUANTITY_EXT:        number
  SP_RATE:             number
  POSTING_DESCRIPTION: string
}

export const fetchBuchungen = (projectId: number) =>
  apiClient.get<{ data: Buchung[] }>(`/buchungen/project/${projectId}`)

export interface UpdateBuchungPayload {
  EMPLOYEE_ID?:         number
  STRUCTURE_ID?:        number | null
  DATE_VOUCHER?:        string
  TIME_START?:          string
  TIME_FINISH?:         string
  QUANTITY_INT?:        number
  CP_RATE?:             number
  QUANTITY_EXT?:        number
  SP_RATE?:             number
  POSTING_DESCRIPTION?: string
}

export const createBuchung = (body: CreateBuchungPayload) =>
  apiClient.post<{ success: boolean }>('/buchungen', body)

export const updateBuchung = (id: number, body: UpdateBuchungPayload) =>
  apiClient.patch<{ data: Buchung }>(`/buchungen/${id}`, body)

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

// ── Employee2Project CRUD ─────────────────────────────────────────────────────

export interface E2PEntry {
  ID:                  number
  EMPLOYEE_ID:         number
  ROLE_ID:             number | null
  ROLE_NAME_SHORT:     string
  ROLE_NAME_LONG:      string
  SP_RATE:             number | null
  EMPLOYEE_SHORT_NAME: string | null
  EMPLOYEE_FIRST_NAME: string | null
  EMPLOYEE_LAST_NAME:  string | null
}

export const fetchE2PByProject = (projectId: number) =>
  apiClient.get<{ data: E2PEntry[] }>(`/employee2project/project/${projectId}`)

export const createE2P = (projectId: number, body: {
  employee_id:      number
  role_id?:         number | null
  role_name_short?: string
  role_name_long?:  string
  sp_rate?:         number | null
}) => apiClient.post<{ data: E2PEntry }>(`/employee2project/project/${projectId}`, body)

export const updateE2P = (id: number, body: {
  role_id?:         number | null
  role_name_short?: string
  role_name_long?:  string
  sp_rate?:         number | null
}) => apiClient.patch<{ success: boolean }>(`/employee2project/${id}`, body)

export const deleteE2P = (id: number) =>
  apiClient.delete<{ success: boolean }>(`/employee2project/${id}`)
