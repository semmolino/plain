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

export interface MatrixPlan { ID: number; KEY: string; NAME_DE: string; POSITION: number }
export interface MatrixCap { key: string; module: string; labelDe: string; type: 'boolean' | 'metered'; unit: string | null }
export interface MatrixCell { plan_id: number; capability_key: string; enabled: boolean; numeric_limit: number | null }
export interface MatrixResponse { plans: MatrixPlan[]; capabilities: MatrixCap[]; cells: MatrixCell[] }

export const api = {
  login: (email: string, password: string, totp?: string) =>
    req<{ token: string; email: string }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password, totp }),
    }),
  me: () => req<{ admin_id: number; email: string }>('/auth/me'),
  matrix: () => req<MatrixResponse>('/matrix'),
  inbox: () => req<{ unmapped: string[]; count: number }>('/inbox'),
  setCell: (planId: number, capKey: string, enabled: boolean, numericLimit: number | null) =>
    req<{ ok: true }>(`/plans/${planId}/capabilities/${encodeURIComponent(capKey)}`, {
      method: 'PUT',
      body: JSON.stringify({ enabled, numeric_limit: numericLimit }),
    }),
}
