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

// Globaler 401-Handler: eine abgelaufene Sitzung soll überall (nicht nur beim
// ersten me()-Call) zum Login zurückführen, statt die Seite auf „Lädt…" oder
// einer Fehlermeldung hängen zu lassen.
let unauthorizedHandler: (() => void) | null = null
export function onUnauthorized(fn: () => void): void {
  unauthorizedHandler = fn
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
    if (res.status === 401 && path !== '/auth/login') {
      setToken(null)
      unauthorizedHandler?.()
    }
    throw new ApiError(res.status, msg, data)
  }
  return data as T
}

// ── Typen ────────────────────────────────────────────────────────────────────
export interface MatrixPlan { ID: number; KEY: string; NAME_DE: string; POSITION: number }
export interface MatrixCap { key: string; module: string; labelDe: string; type: 'boolean' | 'metered'; unit: string | null }
export interface MatrixCell { plan_id: number; capability_key: string; enabled: boolean; numeric_limit: number | null }
export interface MatrixResponse { plans: MatrixPlan[]; modules: Module[]; capabilities: MatrixCap[]; cells: MatrixCell[] }

export interface Capability { key: string; module: string; labelDe: string; type: 'boolean' | 'metered'; unit: string | null }
export interface Module { key: string; labelDe: string }
export interface CapabilityFns extends Capability { permissionKeys: string[]; since?: string | null }
export interface PermissionInfo { key: string; label: string; module: string; capabilityKeys?: string[] }
export interface FunctionsResponse { modules: Module[]; capabilities: CapabilityFns[]; permissions: PermissionInfo[] }

// ── Inbox (offene Lizenz-Aufgaben) ───────────────────────────────────────────
export type InboxSeverity = 'kritisch' | 'hoch' | 'mittel' | 'niedrig'
export type InboxTab = 'functions' | 'matrix' | 'tenants' | 'inbox'
export interface InboxItem {
  id: string
  kind: string
  severity: InboxSeverity
  ref: string
  title: string
  detail: string
  action: string
  targetTab: InboxTab
  position: number
}
export interface InboxResponse {
  items: InboxItem[]
  counts: Record<string, number>
  bySeverity: Partial<Record<InboxSeverity, number>>
  total: number
  warnings: string[]
  kindLabels: Record<string, string>
  checkedAt: string
}

export interface Plan {
  ID: number
  KEY: string
  NAME_DE: string
  DESCRIPTION_DE: string | null
  POSITION: number
  IS_ACTIVE: boolean
  IS_DEFAULT?: boolean
  PRICE_MONTHLY: number | null
  PRICE_YEARLY: number | null
  VERSION: number
  capabilities: { capability_key: string; numeric_limit: number | null }[]
  tenant_count?: number
}

export type LicenseState = 'trial' | 'active' | 'past_due' | 'grace' | 'expired'

export interface TenantLicense {
  TENANT_ID: number
  NAME: string | null
  SLUG: string | null
  EMPLOYEE_COUNT: number
  OVERRIDE_COUNT: number
  HAS_LICENSE: boolean
  PLAN_ID: number | null
  PLAN_NAME: string | null
  PLAN_KEY: string | null
  PLAN_VERSION: number | null
  PLAN_VERSION_CURRENT: number | null
  PLAN_OUTDATED: boolean
  STATE: LicenseState | null
  STARTS_AT: string | null
  VALID_UNTIL: string | null
  TRIAL_UNTIL: string | null
  GRACE_UNTIL: string | null
  UPDATED_AT: string | null
}

export interface TenantEntitlement {
  unrestricted: boolean
  reason?: string
  plan_id?: number
  plan_version?: number
  state?: string
  capabilities: string[]
  limits: Record<string, number>
  overrides: Override[]
  missing?: string[]
}

export interface TenantLicensePatch {
  plan_id?: number
  state?: LicenseState
  valid_until?: string | null
  trial_until?: string | null
  grace_until?: string | null
  repin_version?: boolean
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

export interface AuditDiff { field: string; label: string; before: unknown; after: unknown }
export interface AuditEntry {
  ID: number
  ACTOR: string | null
  ENTITY: string
  ENTITY_REF: string | null
  ACTION: string
  AT: string
  BEFORE?: Record<string, unknown> | null
  AFTER?: Record<string, unknown> | null
  CONTEXT?: Record<string, unknown> | null
  IP?: string | null
  ACTION_LABEL: string
  ENTITY_LABEL: string
  OBJECT_LABEL: string
  DIFF: AuditDiff[]
}
export interface AuditResponse {
  entries: AuditEntry[]
  total: number
  limit: number
  offset: number
  filters: { entities: { key: string; label: string }[]; actions: { key: string; label: string }[] }
  warning?: string
}
export interface AuditQuery {
  entity?: string
  action?: string
  actor?: string
  from?: string
  to?: string
  limit?: number
  offset?: number
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

// ── Auswertungen ─────────────────────────────────────────────────────────────
export type CountMap = Record<string, number>
export interface MonthPoint { month: string; count: number }
export interface TopSuggestion { id: number; title: string; votes: number; lifecycle_status: string }
export interface Analytics {
  suggestions: {
    total: number
    pending: number
    published: number
    by_moderation: CountMap
    by_lifecycle: CountMap
    by_category: CountMap
    orgs_participating: number
    per_month: MonthPoint[]
    top: TopSuggestion[]
  }
  requests: {
    total: number
    open: number
    by_kind: CountMap
    by_status: CountMap
    by_category: CountMap
    per_month: MonthPoint[]
  }
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

/** Lädt eine Datei mit Auth-Header und speichert sie unter `filename`. */
export async function downloadConsoleFile(path: string, filename: string): Promise<void> {
  const token = getToken()
  const res = await fetch(`${BASE}${path}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
  if (!res.ok) throw new ApiError(res.status, `Download fehlgeschlagen (HTTP ${res.status})`)
  const url = URL.createObjectURL(await res.blob())
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
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
  is_default?: boolean
  force?: boolean
}

// ── API ──────────────────────────────────────────────────────────────────────
export const api = {
  login: (email: string, password: string, totp?: string) =>
    req<{ token: string; email: string }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password, totp }),
    }),
  me: () =>
    req<{
      admin_id: number
      email: string
      totp_enabled?: boolean
      require_totp?: boolean
      last_login_at?: string | null
    }>('/auth/me'),
  totpSetup: () => req<{ secret: string; otpauth: string }>('/auth/totp/setup', { method: 'POST', body: '{}' }),
  totpConfirm: (code: string) =>
    req<{ ok: true }>('/auth/totp/confirm', { method: 'POST', body: JSON.stringify({ code }) }),
  totpDisable: (code: string) =>
    req<{ ok: true }>('/auth/totp/disable', { method: 'POST', body: JSON.stringify({ code }) }),
  logoutAll: () => req<{ ok: true }>('/auth/logout-all', { method: 'POST', body: '{}' }),

  capabilities: () => req<{ modules: Module[]; capabilities: Capability[] }>('/capabilities'),
  capabilityFunctions: () => req<FunctionsResponse>('/capabilities/functions'),
  addCapPermission: (capKey: string, permKey: string) =>
    req<{ ok: true }>(`/capabilities/${encodeURIComponent(capKey)}/permissions/${encodeURIComponent(permKey)}`, { method: 'PUT' }),
  removeCapPermission: (capKey: string, permKey: string) =>
    req<{ ok: true }>(`/capabilities/${encodeURIComponent(capKey)}/permissions/${encodeURIComponent(permKey)}`, { method: 'DELETE' }),
  addCapPermissions: (capKey: string, permKeys: string[]) =>
    req<{ ok: true; added: number }>(`/capabilities/${encodeURIComponent(capKey)}/permissions`, {
      method: 'POST',
      body: JSON.stringify({ permission_keys: permKeys }),
    }),
  matrix: () => req<MatrixResponse>('/matrix'),
  inbox: () => req<InboxResponse>('/inbox'),
  setCell: (planId: number, capKey: string, enabled: boolean, numericLimit: number | null) =>
    req<{ ok: true }>(`/plans/${planId}/capabilities/${encodeURIComponent(capKey)}`, {
      method: 'PUT',
      body: JSON.stringify({ enabled, numeric_limit: numericLimit }),
    }),
  setCells: (planId: number, changes: { capability_key: string; enabled: boolean; numeric_limit?: number | null }[]) =>
    req<{ ok: true; added: number; removed: number }>(`/plans/${planId}/capabilities`, {
      method: 'PUT',
      body: JSON.stringify({ changes }),
    }),

  plans: () => req<{ plans: Plan[] }>('/plans'),
  createPlan: (p: NewPlan) => req<{ plan: Plan }>('/plans', { method: 'POST', body: JSON.stringify(p) }),
  updatePlan: (id: number, patch: PlanPatch) =>
    req<{ plan: Plan }>(`/plans/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  deletePlan: (id: number) => req<{ ok: true }>(`/plans/${id}`, { method: 'DELETE' }),
  duplicatePlan: (id: number, key: string, nameDe: string) =>
    req<{ plan: Plan; copied_capabilities: number }>(`/plans/${id}/duplicate`, {
      method: 'POST',
      body: JSON.stringify({ key, name_de: nameDe }),
    }),

  tenants: () => req<{ tenants: TenantLicense[]; unlicensed: number }>('/tenants'),
  setTenantPlan: (tenantId: number, planId: number) =>
    req<{ tenant_license: TenantLicense }>(`/tenants/${tenantId}/plan`, {
      method: 'PATCH',
      body: JSON.stringify({ plan_id: planId }),
    }),
  patchTenantLicense: (tenantId: number, patch: TenantLicensePatch) =>
    req<{ tenant_license: TenantLicense }>(`/tenants/${tenantId}/plan`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),
  tenantEntitlement: (tenantId: number) => req<TenantEntitlement>(`/tenants/${tenantId}/entitlement`),
  // (dormant — Per-Tenant-Overrides bleiben im Backend für spätere Add-Ons)
  tenantOverrides: (id: number) => req<{ overrides: Override[] }>(`/tenants/${id}/overrides`),
  addOverride: (
    id: number,
    body: {
      capability_key: string
      mode: 'grant' | 'revoke'
      numeric_limit?: number | null
      reason?: string
      expires_at?: string | null
    },
  ) => req<{ override: Override }>(`/tenants/${id}/overrides`, { method: 'POST', body: JSON.stringify(body) }),
  deleteOverride: (id: number, capKey: string) =>
    req<{ ok: true }>(`/tenants/${id}/overrides/${encodeURIComponent(capKey)}`, { method: 'DELETE' }),

  audit: (q: AuditQuery = {}) => {
    const p = new URLSearchParams()
    Object.entries(q).forEach(([k, v]) => {
      if (v !== undefined && v !== null && v !== '') p.set(k, String(v))
    })
    const qs = p.toString()
    return req<AuditResponse>(`/audit${qs ? `?${qs}` : ''}`)
  },
  auditExportUrl: (q: AuditQuery = {}) => {
    const p = new URLSearchParams()
    Object.entries(q).forEach(([k, v]) => {
      if (v !== undefined && v !== null && v !== '') p.set(k, String(v))
    })
    const qs = p.toString()
    return `/audit/export${qs ? `?${qs}` : ''}`
  },

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

  analytics: () => req<Analytics>('/analytics'),
}
