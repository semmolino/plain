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

  capabilities: () => req<{ modules: { key: string; labelDe: string }[]; capabilities: Capability[] }>('/capabilities'),
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
  tenantOverrides: (id: number) => req<{ overrides: Override[] }>(`/tenants/${id}/overrides`),
  addOverride: (
    id: number,
    body: { capability_key: string; mode: 'grant' | 'revoke'; numeric_limit?: number | null; reason?: string },
  ) => req<{ override: Override }>(`/tenants/${id}/overrides`, { method: 'POST', body: JSON.stringify(body) }),
  deleteOverride: (id: number, capKey: string) =>
    req<{ ok: true }>(`/tenants/${id}/overrides/${encodeURIComponent(capKey)}`, { method: 'DELETE' }),

  audit: () => req<{ entries: AuditEntry[] }>('/audit'),
}
