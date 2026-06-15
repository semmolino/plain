/**
 * LicenseStore (Zustand) — Lizenz Phase L2 (Soft-Gating)
 *
 * Wird nach Login geladen (analog permissionsStore) und stellt die effektiven
 * Capabilities des Tenants bereit. Steuert im Frontend Sichtbarkeit/Upgrade-
 * Hinweise — NICHT sicherheitsrelevant (das echte Gate ist serverseitig, L3).
 *
 * Soft-Fail bewusst ANDERS als permissionsStore: schlaegt das Laden fehl, gilt
 * unrestricted=true (alles anzeigen). In L2 darf eine Lizenz-API-Stoerung NIE
 * dazu fuehren, dass funktionierende Features faelschlich versteckt werden.
 */

import { create } from 'zustand'
import { fetchMyLicense } from '@/api/license'

interface LicenseState {
  capabilities: Set<string>
  limits:       Map<string, number>
  unrestricted: boolean
  planId:       number | null
  state:        string | null
  loaded:       boolean
  loading:      boolean
  reload:       () => Promise<void>
  clear:        () => void
  has:          (key: string) => boolean
}

export const useLicenseStore = create<LicenseState>((set, get) => ({
  capabilities: new Set<string>(),
  limits:       new Map<string, number>(),
  unrestricted: true,   // L2: im Zweifel anzeigen (additive Schicht)
  planId:       null,
  state:        null,
  loaded:       false,
  loading:      false,

  reload: async () => {
    if (get().loading) return
    set({ loading: true })
    try {
      const res = await fetchMyLicense()
      set({
        capabilities: new Set(res.capabilities || []),
        limits:       new Map(Object.entries(res.limits || {})),
        unrestricted: !!res.unrestricted,
        planId:       res.plan_id ?? null,
        state:        res.state ?? null,
        loaded:       true,
        loading:      false,
      })
    } catch (e) {
      // Soft-Fail: NICHT verstecken. Features bleiben sichtbar, Fehler ins Log.
      console.warn('[license] reload failed:', e)
      set({ loading: false, loaded: true, unrestricted: true })
    }
  },

  clear: () => set({
    capabilities: new Set(), limits: new Map(),
    unrestricted: true, planId: null, state: null, loaded: false,
  }),

  has: (key: string) => {
    const s = get()
    return s.unrestricted || s.capabilities.has(key)
  },
}))

/** Convenience-Hook: ist die Capability fuer den Tenant lizenziert? */
export function useFeature(key: string): boolean {
  return useLicenseStore(s => s.unrestricted || s.capabilities.has(key))
}

/** Numerisches Limit einer metered Capability (null = unbegrenzt / unrestricted). */
export function useLicenseLimit(key: string): number | null {
  return useLicenseStore(s => (s.unrestricted ? null : (s.limits.get(key) ?? null)))
}

/** Filtert Tab-Definitionen anhand einer optionalen `feature`-Eigenschaft.
 *  Tabs ohne `feature` bleiben immer sichtbar. Analog zu useFilterTabs (RBAC),
 *  aber für Lizenz-Capabilities. Kombinierbar: useLicenseFilterTabs(useFilterTabs(TABS)). */
export function useLicenseFilterTabs<T extends { feature?: string }>(tabs: T[]): T[] {
  const unrestricted = useLicenseStore(s => s.unrestricted)
  const caps         = useLicenseStore(s => s.capabilities)
  return tabs.filter(t => !t.feature || unrestricted || caps.has(t.feature))
}
