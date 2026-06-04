import { apiClient } from './client'

export interface BudgetWarningRule {
  ID:             number
  TENANT_ID:      number
  PROJECT_ID:     number | null
  STRUCTURE_ID:   number | null
  THRESHOLD_PCT:  number
  NOTIFY_PM:      boolean
  NOTIFY_BOOKER:  boolean
  NOTIFY_CC:      number[] | null
  MUTED:          boolean
  CREATED_AT:     string
  CREATED_BY:     number | null
}

export interface BudgetWarningFired {
  ID:             number
  RULE_ID:        number
  FIRED_AT:       string
  BUDGET_EUR:     number
  ACTUAL_EUR:     number
  TRIGGER_TEC_ID: number | null
  RESET_AT:       string | null
}

export interface BudgetWarningStructureAgg {
  ID:        number
  FATHER_ID: number | null
  budget:    number
  verbrauch: number
}

export interface BudgetWarningOverview {
  project: {
    ID: number
    NAME_SHORT: string | null
    NAME_LONG:  string | null
    PROJECT_MANAGER_ID: number | null
    BUDGET_WARNINGS_MUTED: boolean
  }
  projectAggregate: { budget: number; verbrauch: number }
  structures:       BudgetWarningStructureAgg[]
  rules:            BudgetWarningRule[]
  fired:            BudgetWarningFired[]
}

export const fetchBudgetOverview = (projectId: number) =>
  apiClient.get<{ data: BudgetWarningOverview }>(`/budget-warnings/projects/${projectId}`)

export interface CreateRuleBody {
  threshold_pct:  number
  structure_id?:  number | null
  notify_pm?:     boolean
  notify_booker?: boolean
  notify_cc?:     number[]
  muted?:         boolean
}

export const createBudgetRule = (projectId: number, body: CreateRuleBody) =>
  apiClient.post<{ data: BudgetWarningRule }>(`/budget-warnings/projects/${projectId}/rules`, body)

export interface UpdateRuleBody {
  threshold_pct?: number
  notify_pm?:     boolean
  notify_booker?: boolean
  notify_cc?:     number[]
  muted?:         boolean
}

export const updateBudgetRule = (ruleId: number, body: UpdateRuleBody) =>
  apiClient.put<{ data: BudgetWarningRule }>(`/budget-warnings/rules/${ruleId}`, body)

export const deleteBudgetRule = (ruleId: number) =>
  apiClient.delete<{ data: { ok: true } }>(`/budget-warnings/rules/${ruleId}`)

export const setProjectMute = (projectId: number, muted: boolean) =>
  apiClient.put<{ data: { ID: number; BUDGET_WARNINGS_MUTED: boolean } }>(
    `/budget-warnings/projects/${projectId}/mute`, { muted },
  )
