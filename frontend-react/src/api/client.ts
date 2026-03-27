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
  constructor(status: number, message: string) {
    super(message)
    this.name = 'ApiRequestError'
    this.status = status
  }
}

async function request<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const token = useAuthStore.getState().session?.access_token

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string>),
  }

  if (token) {
    headers['Authorization'] = `Bearer ${token}`
  }

  const res = await fetch(`${API_BASE}${path}`, { ...options, headers })

  if (!res.ok) {
    let message = `HTTP ${res.status}`
    try {
      const body = await res.json() as { error?: string }
      if (body.error) message = body.error
    } catch {
      // ignore parse error
    }
    throw new ApiRequestError(res.status, message)
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
  const token = useAuthStore.getState().session?.access_token
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
  const token = useAuthStore.getState().session?.access_token
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
    request<T>(path, { method: 'POST', body: JSON.stringify(body) }),

  patch: <T>(path: string, body: unknown) =>
    request<T>(path, { method: 'PATCH', body: JSON.stringify(body) }),

  put: <T>(path: string, body: unknown) =>
    request<T>(path, { method: 'PUT', body: JSON.stringify(body) }),

  delete: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
}
