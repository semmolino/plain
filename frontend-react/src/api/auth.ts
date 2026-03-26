import { apiClient } from './client'
import type { AuthConfig, MeResponse, TeamMember } from '@/types/api'

// Uses native fetch (no auth token) — called before Supabase is initialised
export async function fetchAuthConfig(): Promise<AuthConfig> {
  const res = await fetch('/api/v1/auth/config')
  if (!res.ok) throw new Error('Backend nicht erreichbar')
  return res.json() as Promise<AuthConfig>
}

export async function fetchMe(): Promise<MeResponse> {
  return apiClient.get<MeResponse>('/auth/me')
}

export async function updateMe(data: Partial<MeResponse>): Promise<MeResponse> {
  return apiClient.patch<MeResponse>('/auth/me', data)
}

export async function fetchTeam(): Promise<TeamMember[]> {
  return apiClient.get<TeamMember[]>('/auth/team')
}

export async function inviteTeamMember(email: string): Promise<void> {
  return apiClient.post('/auth/invite', { email })
}

export async function removeTeamMember(userId: string): Promise<void> {
  return apiClient.delete(`/auth/team/${userId}`)
}

export async function signup(data: {
  email: string
  password: string
  companyName: string
}): Promise<void> {
  // Signup uses raw fetch (no session yet)
  const res = await fetch('/api/v1/auth/signup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { error?: string }
    throw new Error(body.error ?? 'Fehler beim Registrieren')
  }
}
