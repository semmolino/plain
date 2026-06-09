/**
 * PermissionsStore (Zustand) — RBAC Phase 0
 *
 * Wird einmal nach Login geladen und stellt die Permission-Keys des Users zur
 * Verfuegung. Im Frontend wird Sichtbarkeit von Buttons/Menues davon
 * gesteuert (Phase 1 — noch nicht enforciert).
 *
 * Unrestricted=true: Backend hat (noch) keine Permissions geladen — Foundation-
 * Phase, alles erlaubt.
 */

import { create } from 'zustand'
import { fetchMyPermissions } from '@/api/rbac'

interface PermissionsState {
  keys:         Set<string>
  unrestricted: boolean
  loaded:       boolean
  loading:      boolean
  reload:       () => Promise<void>
  clear:        () => void
  has:          (key: string) => boolean
  hasAny:       (keys: string[]) => boolean
}

export const usePermissionsStore = create<PermissionsState>((set, get) => ({
  keys:         new Set<string>(),
  unrestricted: true,   // Optimistic default until first load completes
  loaded:       false,
  loading:      false,

  reload: async () => {
    if (get().loading) return
    set({ loading: true })
    try {
      const res = await fetchMyPermissions()
      set({
        keys:         new Set(res.keys || []),
        unrestricted: !!res.unrestricted,
        loaded:       true,
        loading:      false,
      })
    } catch (e) {
      // Soft-fail: bei Netzwerkfehler bleibt unrestricted, damit App benutzbar bleibt
      console.warn('[permissions] reload failed:', e)
      set({ loading: false, loaded: true, unrestricted: true })
    }
  },

  clear: () => set({ keys: new Set(), unrestricted: true, loaded: false }),

  has: (key: string) => {
    const s = get()
    return s.unrestricted || s.keys.has(key)
  },

  hasAny: (keys: string[]) => {
    const s = get()
    if (s.unrestricted) return true
    return keys.some(k => s.keys.has(k))
  },
}))

/** Convenience hook for components: returns boolean. */
export function usePermission(key: string): boolean {
  return usePermissionsStore(s => s.unrestricted || s.keys.has(key))
}

/** Convenience hook: returns boolean if ANY of the keys is granted. */
export function useAnyPermission(keys: string[]): boolean {
  return usePermissionsStore(s => s.unrestricted || keys.some(k => s.keys.has(k)))
}

/** Filtert eine Liste von Tab-Definitionen anhand der `permissions`-Eigenschaft.
 *  Tabs ohne `permissions` bleiben immer sichtbar. */
export function useFilterTabs<T extends { permissions?: string[] }>(tabs: T[]): T[] {
  const unrestricted = usePermissionsStore(s => s.unrestricted)
  const keys         = usePermissionsStore(s => s.keys)
  return tabs.filter(t =>
    !t.permissions ||
    t.permissions.length === 0 ||
    unrestricted ||
    t.permissions.some(p => keys.has(p))
  )
}
