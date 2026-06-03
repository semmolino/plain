import { apiClient, downloadWithAuth } from './client'

// ── Types ──────────────────────────────────────────────────────────────────

export interface ArbzgSettings {
  enabled:                 boolean
  strictMode:              boolean
  checkBreakRequired:      boolean
  checkMaxDaily:           boolean
  checkMinRest:            boolean
  checkSundayHoliday:      boolean
  checkAvg6m:              boolean
  autoBreakDeduct:         boolean
  autoBreakRequireConfirm: boolean
  defaultBreakRuleId:      number | null
  country:                 string
  stateCode:               string | null
  legalTextBlock:          string
}

export interface BreakRule {
  ID:             number
  NAME:           string
  T1_HOURS:       number
  T1_BREAK_MIN:   number
  T2_HOURS:       number
  T2_BREAK_MIN:   number
  MIN_BLOCK_MIN:  number
  CREATED_AT?:    string
}

export interface ActiveWorkModel {
  ID:                number
  NAME:              string
  COUNTRY_CODE:      string
  STATE_CODE:        string | null
  MODEL_TYPE:        'FIXED' | 'TRUST'
  BREAK_RULE_ID:     number | null
  MAX_DAILY_HOURS:   number
  MIN_REST_HOURS:    number
  IS_MINOR_PROFILE:  boolean
}

export type ArbzgSeverity = 'INFO' | 'WARN' | 'BLOCK'

export interface ArbzgIssue {
  severity: ArbzgSeverity
  code:     string
  message:  string
  details?: Record<string, unknown>
}

export interface PreflightPayload {
  employee_id:    number
  date_voucher:   string
  time_start?:    string | null
  time_finish?:   string | null
  quantity_int:   number
  entry_kind?:    'WORK' | 'BREAK'
  exclude_tec_id?: number | null
}

export interface PreflightResult {
  issues:    ArbzgIssue[]
  dayTotal?: number
  breakRule?: Pick<BreakRule, 'ID' | 'NAME' | 'T1_HOURS' | 'T1_BREAK_MIN' | 'T2_HOURS' | 'T2_BREAK_MIN'>
}

export interface ArbzgLimits {
  settings:   ArbzgSettings
  model:      ActiveWorkModel | null
  breakRule:  BreakRule
  employeeId: number
  date:       string
}

export interface AuditEntry {
  ID:           number
  EMPLOYEE_ID:  number
  DATE_VOUCHER: string
  EVENT_TYPE:   string
  SEVERITY:     ArbzgSeverity
  DETAILS:      Record<string, unknown>
  TEC_ID:       number | null
  CREATED_AT:   string
}

export type BreakConfirmationKind = 'ACCEPT_AUTO_DEDUCT' | 'BREAK_TAKEN_UNRECORDED'

export interface BreakConfirmation {
  kind:     BreakConfirmationKind
  minutes?: number
}

// Keyed by `${employeeId}|${dateVoucher}` to match backend
export type BreakConfirmationMap = Record<string, BreakConfirmation>

// ── API functions ──────────────────────────────────────────────────────────

export const fetchArbzgSettings = () =>
  apiClient.get<{ data: ArbzgSettings }>('/arbzg/settings')

export const saveArbzgSettings = (patch: Partial<ArbzgSettings>) =>
  apiClient.put<{ success: boolean; data: ArbzgSettings }>('/arbzg/settings', patch)

export const fetchArbzgLimits = (employeeId: number, date: string) =>
  apiClient.get<{ data: ArbzgLimits }>(`/arbzg/limits/${employeeId}?date=${date}`)

export const arbzgPreflight = (body: PreflightPayload) =>
  apiClient.post<{ data: PreflightResult }>('/arbzg/preflight', body)

export const fetchArbzgAudit = (params: {
  employee_id?: number; date_from?: string; date_to?: string;
  event_type?:  string; severity?:  ArbzgSeverity
} = {}) => {
  const qs = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) if (v != null && v !== '') qs.append(k, String(v))
  return apiClient.get<{ data: AuditEntry[]; warning?: string }>(`/arbzg/audit?${qs.toString()}`)
}

export const downloadArbzgAuditCsv = (params: {
  employee_id?: number; date_from?: string; date_to?: string
} = {}) => {
  const qs = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) if (v != null && v !== '') qs.append(k, String(v))
  const fname = `arbzg_audit_${params.date_from || 'all'}_${params.date_to || 'all'}.csv`
  return downloadWithAuth(`/arbzg/audit/export?${qs.toString()}`, fname)
}

export const fetchBreakRules = () =>
  apiClient.get<{ data: BreakRule[] }>('/arbzg/break-rules')

export const upsertBreakRule = (body: {
  id?: number; name: string;
  t1_hours: number; t1_break_min: number;
  t2_hours: number; t2_break_min: number;
  min_block_min: number;
}) =>
  apiClient.put<{ data: BreakRule }>('/arbzg/break-rules', body)

export const deleteBreakRule = (id: number) =>
  apiClient.delete<{ success: boolean }>(`/arbzg/break-rules/${id}`)
