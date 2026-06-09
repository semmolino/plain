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
  // Wichtig: jeden Wert einzeln selektieren (primitiv / stabile Referenz).
  // Object-Literal-Selectors triggern bei Zustand sonst Re-Renders auf jeden Store-Tick.
  const unrestricted = usePermissionsStore(s => s.unrestricted)
  const keys         = usePermissionsStore(s => s.keys)

  let granted = true
  if (!unrestricted) {
    if (permission && !keys.has(permission)) granted = false
    else if (anyOf && anyOf.length > 0 && !anyOf.some(k => keys.has(k))) granted = false
    else if (allOf && allOf.length > 0 && !allOf.every(k => keys.has(k))) granted = false
  }

  return <>{granted ? children : fallback}</>
}
