import { apiClient } from './client'

export interface LoginResponse {
  token:          string
  employee_id:    number
  tenant_id:      number
  email:          string
  short_name:     string
  company_name:   string | null
  dashboard_role: string | null
}

export async function loginEmployee(email: string, password: string): Promise<LoginResponse> {
  const res = await fetch('/api/v1/auth/login', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ email, password }),
  })
  const body = await res.json() as LoginResponse & { error?: string }
  if (!res.ok) throw new Error(body.error ?? 'Anmeldung fehlgeschlagen')
  return body
}

export interface MeResponse {
  employee_id:  number
  tenant_id:    number
  email:        string
  short_name:   string
  company_name: string | null
}

export async function fetchMe(token: string): Promise<MeResponse> {
  const res = await fetch('/api/v1/auth/me', {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) throw new Error('Session ungültig')
  return res.json() as Promise<MeResponse>
}

export async function changePassword(currentPassword: string, newPassword: string): Promise<void> {
  return apiClient.patch('/auth/me/password', { current_password: currentPassword, new_password: newPassword })
}

export async function requestPasswordReset(email: string): Promise<void> {
  const res = await fetch('/api/v1/auth/reset-request', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ email }),
  })
  const body = await res.json() as { success?: boolean; error?: string }
  if (!res.ok) throw new Error(body.error ?? 'Fehler beim Zurücksetzen')
}

export async function confirmPasswordReset(token: string, newPassword: string): Promise<void> {
  const res = await fetch('/api/v1/auth/reset-confirm', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ token, new_password: newPassword }),
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { error?: string }
    throw new Error(body.error ?? 'Fehler beim Speichern des Passworts')
  }
}

export async function signup(data: {
  email: string
  password: string
  companyName: string
  shortName: string
}): Promise<void> {
  const res = await fetch('/api/v1/auth/signup', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(data),
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { error?: string }
    throw new Error(body.error ?? 'Fehler beim Registrieren')
  }
}
