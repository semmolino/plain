// API-Client für die Owner-Konsole. Token im localStorage, Bearer-Auth.

const BASE = '/api/console'
const TOKEN_KEY = 'console_token'

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY)
}
export function setToken(t: string | null): void {
  if (t) localStorage.setItem(TOKEN_KEY, t)
  else localStorage.removeItem(TOKEN_KEY)
}

export class ApiError extends Error {
  status: number
  payload: unknown
  constructor(status: number, message: string, payload?: unknown) {
    super(message)
    this.status = status
    this.payload = payload
  }
}

async function req<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> | undefined),
  }
  const token = getToken()
  if (token) headers['Authorization'] = `Bearer ${token}`

  const res = await fetch(`${BASE}${path}`, { ...options, headers })
  const text = await res.text()
  let data: unknown = null
  try {
    data = text ? JSON.parse(text) : null
  } catch {
    // Nicht-JSON (z.B. Proxy-Fehlerseite) -> data bleibt null
  }
  if (!res.ok) {
    const msg = (data as { error?: string } | null)?.error || `HTTP ${res.status}`
    throw new ApiError(res.status, msg, data)
  }
  return data as T
}

// ── Typen ────────────────────────────────────────────────────────────────────
export interface MatrixPlan { ID: number; KEY: string; NAME_DE: string; POSITION: number }
export interface MatrixCap { key: string; module: string; labelDe: string; type: 'boolean' | 'metered'; unit: string | null }
export interface MatrixCell { plan_id: number; capability_key: string; enabled: boolean; numeric_limit: number | null }
export interface MatrixResponse { plans: MatrixPlan[]; capabilities: MatrixCap[]; cells: MatrixCell[] }

export interface Capability { key: string; module: string; labelDe: string; type: 'boolean' | 'metered'; unit: string | null }
export interface Module { key: string; labelDe: string }
export interface CapabilityFns extends Capability { permissionKeys: string[] }
export interface PermissionInfo { key: string; label: string; module: string }
export interface FunctionsResponse { modules: Module[]; capabilities: CapabilityFns[]; permissions: PermissionInfo[] }

export interface Plan {
  ID: number
  KEY: string
  NAME_DE: string
  DESCRIPTION_DE: string | null
  POSITION: number
  IS_ACTIVE: boolean
  PRICE_MONTHLY: number | null
  PRICE_YEARLY: number | null
  VERSION: number
  capabilities: { capability_key: string; numeric_limit: number | null }[]
}

export interface TenantLicense {
  TENANT_ID: number
  PLAN_ID: number
  PLAN_VERSION: number
  STATE: string
  STARTS_AT: string | null
  VALID_UNTIL: string | null
  TRIAL_UNTIL: string | null
  GRACE_UNTIL: string | null
}

export interface Override {
  ID: number
  CAPABILITY_KEY: string
  MODE: 'grant' | 'revoke'
  NUMERIC_LIMIT: number | null
  REASON: string | null
  EXPIRES_AT: string | null
  CREATED_AT: string
  CREATED_BY: string | null
}

export interface AuditEntry {
  ID: number
  ACTOR: string | null
  ENTITY: string
  ENTITY_REF: string | null
  ACTION: string
  AT: string
}

// ── Vorschläge (Moderation) ──────────────────────────────────────────────────
export type SgModerationState = 'pending' | 'published' | 'declined' | 'merged'
export type SgLifecycle = 'new' | 'reviewing' | 'planned' | 'in_progress' | 'shipped' | 'not_planned'

export interface ModSuggestion {
  id: number
  tenant_id: number
  org_name: string
  submitter_name: string
  submitter_mail: string | null
  title: string
  body: string
  public_title: string | null
  public_body: string | null
  category: string
  priority_hint: string | null
  moderation_state: SgModerationState
  lifecycle_status: SgLifecycle
  merged_into_id: number | null
  vote_count: number
  jira_issue_key: string | null
  jira_url: string | null
  created_at: string
  published_at: string | null
}
export interface ModComment {
  id: number
  body: string
  author_kind: 'user' | 'vendor'
  visibility: 'public' | 'vendor_only'
  moderation_state: SgModerationState
  author_name: string
  created_at: string
}
export interface PendingComment {
  id: number
  suggestion_id: number
  body: string
  created_at: string
}
export interface SuggestionPatch {
  public_title?: string
  public_body?: string
  lifecycle_status?: SgLifecycle
  category?: string
}

// ── Feedback & Unterstützung (Inbox) ─────────────────────────────────────────
export type ReqStatus = 'new' | 'in_progress' | 'waiting' | 'resolved' | 'closed'
export interface ModRequest {
  id: number
  org_name: string
  submitter_name: string
  contact_name: string | null
  contact_email: string | null
  kind: 'feedback' | 'support'
  category: string | null
  subject: string
  body: string
  status: ReqStatus
  urgency: string | null
  wants_reply: boolean
  created_at: string
}
export interface ReqMessage {
  id: number
  body: string
  author_kind: 'user' | 'vendor'
  created_at: string
}

export interface AttachmentRow {
  id: number
  filename: string
  mime_type: string
  size_bytes: number
}

/** Lädt eine Datei mit Auth-Header und öffnet sie in einem neuen Tab. */
export async function openConsoleFile(path: string): Promise<void> {
  const token = getToken()
  const res = await fetch(`${BASE}${path}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
  if (!res.ok) throw new ApiError(res.status, `Download fehlgeschlagen (HTTP ${res.status})`)
  const url = URL.createObjectURL(await res.blob())
  window.open(url, '_blank')
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

export interface NewPlan {
  key: string
  name_de: string
  description_de?: string
  price_monthly?: number | null
  price_yearly?: number | null
  position?: number
}
export interface PlanPatch {
  name_de?: string
  description_de?: string | null
  price_monthly?: number | null
  price_yearly?: number | null
  position?: number
  is_active?: boolean
}

// ── API ──────────────────────────────────────────────────────────────────────
export const api = {
  login: (email: string, password: string, totp?: string) =>
    req<{ token: string; email: string }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password, totp }),
    }),
  me: () => req<{ admin_id: number; email: string }>('/auth/me'),

  capabilities: () => req<{ modules: Module[]; capabilities: Capability[] }>('/capabilities'),
  capabilityFunctions: () => req<FunctionsResponse>('/capabilities/functions'),
  addCapPermission: (capKey: string, permKey: string) =>
    req<{ ok: true }>(`/capabilities/${encodeURIComponent(capKey)}/permissions/${encodeURIComponent(permKey)}`, { method: 'PUT' }),
  removeCapPermission: (capKey: string, permKey: string) =>
    req<{ ok: true }>(`/capabilities/${encodeURIComponent(capKey)}/permissions/${encodeURIComponent(permKey)}`, { method: 'DELETE' }),
  matrix: () => req<MatrixResponse>('/matrix'),
  inbox: () => req<{ unmapped: string[]; count: number }>('/inbox'),
  setCell: (planId: number, capKey: string, enabled: boolean, numericLimit: number | null) =>
    req<{ ok: true }>(`/plans/${planId}/capabilities/${encodeURIComponent(capKey)}`, {
      method: 'PUT',
      body: JSON.stringify({ enabled, numeric_limit: numericLimit }),
    }),

  plans: () => req<{ plans: Plan[] }>('/plans'),
  createPlan: (p: NewPlan) => req<{ plan: Plan }>('/plans', { method: 'POST', body: JSON.stringify(p) }),
  updatePlan: (id: number, patch: PlanPatch) =>
    req<{ plan: Plan }>(`/plans/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),

  tenants: () => req<{ tenants: TenantLicense[] }>('/tenants'),
  setTenantPlan: (tenantId: number, planId: number) =>
    req<{ tenant_license: TenantLicense }>(`/tenants/${tenantId}/plan`, {
      method: 'PATCH',
      body: JSON.stringify({ plan_id: planId }),
    }),
  // (dormant — Per-Tenant-Overrides bleiben im Backend für spätere Add-Ons)
  tenantOverrides: (id: number) => req<{ overrides: Override[] }>(`/tenants/${id}/overrides`),
  addOverride: (
    id: number,
    body: { capability_key: string; mode: 'grant' | 'revoke'; numeric_limit?: number | null; reason?: string },
  ) => req<{ override: Override }>(`/tenants/${id}/overrides`, { method: 'POST', body: JSON.stringify(body) }),
  deleteOverride: (id: number, capKey: string) =>
    req<{ ok: true }>(`/tenants/${id}/overrides/${encodeURIComponent(capKey)}`, { method: 'DELETE' }),

  audit: () => req<{ entries: AuditEntry[] }>('/audit'),

  // Vorschläge (Moderation)
  suggestions: (state: string = 'all') => req<{ suggestions: ModSuggestion[] }>(`/suggestions?state=${state}`),
  suggestionDetail: (id: number) => req<{ suggestion: ModSuggestion; comments: ModComment[]; attachments: AttachmentRow[] }>(`/suggestions/${id}`),
  patchSuggestion: (id: number, patch: SuggestionPatch) =>
    req<{ ok: true }>(`/suggestions/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  publishSuggestion: (id: number) => req<{ ok: true }>(`/suggestions/${id}/publish`, { method: 'POST', body: '{}' }),
  declineSuggestion: (id: number) => req<{ ok: true }>(`/suggestions/${id}/decline`, { method: 'POST', body: '{}' }),
  setSuggestionLifecycle: (id: number, status: SgLifecycle) =>
    req<{ ok: true }>(`/suggestions/${id}/lifecycle`, { method: 'POST', body: JSON.stringify({ lifecycle_status: status }) }),
  mergeSuggestion: (id: number, intoId: number) =>
    req<{ ok: true }>(`/suggestions/${id}/merge`, { method: 'POST', body: JSON.stringify({ into_id: intoId }) }),
  respondSuggestion: (id: number, body: string, visibility: 'public' | 'vendor_only') =>
    req<{ ok: true }>(`/suggestions/${id}/respond`, { method: 'POST', body: JSON.stringify({ body, visibility }) }),
  createJiraIssue: (id: number) =>
    req<{ key: string; url: string | null }>(`/suggestions/${id}/jira`, { method: 'POST', body: '{}' }),
  pendingComments: () => req<{ comments: PendingComment[] }>('/suggestion-comments?state=pending'),
  moderateComment: (id: number, action: 'publish' | 'decline') =>
    req<{ ok: true }>(`/suggestion-comments/${id}/${action}`, { method: 'POST', body: '{}' }),

  // Feedback & Unterstützung (Inbox)
  serviceRequests: (kind: string = '', status: string = 'all') =>
    req<{ requests: ModRequest[] }>(`/requests?kind=${kind}&status=${status}`),
  serviceRequestDetail: (id: number) =>
    req<{ request: ModRequest; messages: ReqMessage[]; attachments: AttachmentRow[] }>(`/requests/${id}`),
  replyRequest: (id: number, body: string) =>
    req<{ ok: true }>(`/requests/${id}/reply`, { method: 'POST', body: JSON.stringify({ body }) }),
  setRequestStatus: (id: number, status: ReqStatus) =>
    req<{ ok: true }>(`/requests/${id}/status`, { method: 'POST', body: JSON.stringify({ status }) }),
}
