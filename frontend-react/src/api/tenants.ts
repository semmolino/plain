import { apiClient } from './client'

export interface TenantSelf {
  ID:     number
  TENANT: string
  SLUG:   string | null
}

export const fetchTenantMe = () =>
  apiClient.get<{ data: TenantSelf }>('/tenants/me')

export const saveTenantSlug = (slug: string | null) =>
  apiClient.put<{ data: { slug: string | null } }>('/tenants/me/slug', { slug })

// ── Public Branding (no auth) ───────────────────────────────────────────────

export interface PublicBranding {
  tenant_name: string
  hero_url:    string | null
  theme:       string | null
}

/** Public-Endpoint -- ohne Bearer-Token. Wir bauen die URL selbst, weil
 *  apiClient den Token immer mitsendet (was hier zwar nicht stoert, aber
 *  semantisch unsauber waere). */
export async function fetchPublicLoginBranding(slug: string): Promise<PublicBranding | null> {
  try {
    const res = await fetch(`/api/v1/branding/login/${encodeURIComponent(slug)}`)
    if (!res.ok) return null
    const json = await res.json() as { data: PublicBranding }
    return json.data
  } catch {
    return null
  }
}
