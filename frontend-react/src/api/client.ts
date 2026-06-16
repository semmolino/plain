/**
 * Typed API client for the PlaIn backend.
 *
 * - All requests go to /api/v1/ (proxied to localhost:3000 in dev via vite.config.ts)
 * - Bearer token is injected automatically from the auth store
 * - Throws ApiRequestError with the server's error message on non-2xx responses
 */

import { useAuthStore } from '@/store/authStore'

export const API_BASE = '/api/v1'

export class ApiRequestError extends Error {
  readonly status: number
  readonly details?: unknown
  constructor(status: number, message: string, details?: unknown) {
    super(message)
    this.name = 'ApiRequestError'
    this.status = status
    this.details = details
  }
}

async function request<T>(
  path: string,
  options: RequestInit = {},
  rawBody?: FormData,
): Promise<T> {
  const token = useAuthStore.getState().token

  const headers: Record<string, string> = {
    ...(options.headers as Record<string, string>),
  }

  if (!rawBody) {
    headers['Content-Type'] = 'application/json'
  }

  if (token) {
    headers['Authorization'] = `Bearer ${token}`
  }

  const body = rawBody ?? options.body
  const res = await fetch(`${API_BASE}${path}`, { ...options, headers, body })

  if (!res.ok) {
    let message = `HTTP ${res.status}`
    let payload: Record<string, unknown> | null = null
    try {
      payload = await res.json() as Record<string, unknown>
      if (typeof payload.error === 'string') message = payload.error
    } catch {
      // ignore parse error
    }
    // Phase 5: globaler 403-Hook -- triggert Toast + Permissions-Refresh
    if (res.status === 403) {
      try {
        const handler = (globalThis as typeof globalThis & { __onPermissionDenied?: (msg: string) => void }).__onPermissionDenied
        if (typeof handler === 'function') handler(message)
      } catch { /* ignore */ }
    }
    // Lizenz: 402 = Funktion nicht im Tarif -> Upgrade-Hinweis-Hook
    if (res.status === 402) {
      try {
        const handler = (globalThis as typeof globalThis & { __onLicenseDenied?: (msg: string) => void }).__onLicenseDenied
        if (typeof handler === 'function') handler(message)
      } catch { /* ignore */ }
    }
    throw new ApiRequestError(res.status, message, payload)
  }

  // 204 No Content
  if (res.status === 204) return undefined as T

  return res.json() as Promise<T>
}

/**
 * Fetch a binary/text file with the auth header and trigger a browser download.
 * @param path  API path (e.g. /invoices/1/einvoice/ubl)
 * @param fileName  Suggested file name for the download dialog
 */
export async function downloadWithAuth(path: string, fileName: string): Promise<void> {
  const token = useAuthStore.getState().token
  const headers: Record<string, string> = {}
  if (token) headers['Authorization'] = `Bearer ${token}`

  const res = await fetch(`${API_BASE}${path}`, { headers })
  if (!res.ok) {
    let message = `HTTP ${res.status}`
    try {
      const body = await res.json() as { error?: string }
      if (body.error) message = body.error
    } catch { /* ignore */ }
    throw new ApiRequestError(res.status, message)
  }

  const blob = await res.blob()
  const url  = URL.createObjectURL(blob)
  const a    = document.createElement('a')
  a.href     = url
  a.download = fileName
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

/**
 * Fetch a PDF with the auth header and open it inline in a new browser tab.
 * @param path  API path (e.g. /invoices/1/pdf?preview=1)
 */
export async function openPdfWithAuth(path: string): Promise<void> {
  const token = useAuthStore.getState().token
  const headers: Record<string, string> = {}
  if (token) headers['Authorization'] = `Bearer ${token}`

  const res = await fetch(`${API_BASE}${path}`, { headers })
  if (!res.ok) {
    let message = `HTTP ${res.status}`
    try {
      const body = await res.json() as { error?: string }
      if (body.error) message = body.error
    } catch { /* ignore */ }
    throw new ApiRequestError(res.status, message)
  }

  const blob = await res.blob()
  const url  = URL.createObjectURL(blob)
  window.open(url, '_blank')
  // Revoke after a short delay to allow the new tab to load
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

export const apiClient = {
  get: <T>(path: string) => request<T>(path),

  post: <T>(path: string, body: unknown) =>
    body instanceof FormData
      ? request<T>(path, { method: 'POST' }, body)
      : request<T>(path, { method: 'POST', body: JSON.stringify(body) }),

  patch: <T>(path: string, body: unknown) =>
    request<T>(path, { method: 'PATCH', body: JSON.stringify(body) }),

  put: <T>(path: string, body: unknown) =>
    request<T>(path, { method: 'PUT', body: JSON.stringify(body) }),

  delete: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
}
