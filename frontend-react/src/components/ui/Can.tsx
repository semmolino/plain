import { type ReactNode } from 'react'
import { usePermissionsStore } from '@/store/permissionsStore'

interface Props {
  /** Erforderliche Permission. */
  permission?: string
  /** Erforderlich: eine von mehreren Permissions. */
  anyOf?: string[]
  /** Erforderlich: ALLE der Permissions. */
  allOf?: string[]
  /** Fallback, wenn Berechtigung fehlt (z.B. ein Disabled-Hinweis). Default: nichts rendern. */
  fallback?: ReactNode
  children: ReactNode
}

/**
 * <Can permission="invoices.edit">...</Can>
 * <Can anyOf={['invoices.book','invoices.edit']}>...</Can>
 *
 * Phase 0: rendert die Children, wenn unrestricted=true (Migration 0062 fehlt
 * oder Backend hat keine Permissions geladen). So bleibt die App benutzbar,
 * waehrend wir die RBAC schrittweise einbauen.
 */
export function Can({ permission, anyOf, allOf, fallback = null, children }: Props) {
  const { unrestricted, keys } = usePermissionsStore(s => ({ unrestricted: s.unrestricted, keys: s.keys }))

  const granted = (() => {
    if (unrestricted) return true
    if (permission && !keys.has(permission)) return false
    if (anyOf && anyOf.length > 0 && !anyOf.some(k => keys.has(k))) return false
    if (allOf && allOf.length > 0 && !allOf.every(k => keys.has(k))) return false
    return true
  })()

  return <>{granted ? children : fallback}</>
}
