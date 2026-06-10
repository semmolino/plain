import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { trackRecent, type RecentEntityType } from '@/api/recents'

/**
 * Trackt einen Aufruf auf den Recents-Endpoint.
 * Wird typischerweise auf Detailseiten/-modalen aufgerufen mit
 *   useTrackRecent('project', selectedProjectId, projectLabel)
 *
 * Effekt feuert, wenn sich entity_id ODER label aendert. Fehler werden
 * geschluckt -- ein nicht-erreichbarer Recents-Endpoint darf die UI
 * nicht stoeren.
 *
 * Nach erfolgreichem Track wird der Query-Cache fuer ['recents', type]
 * und ['recents','dashboard'] invalidiert, damit Listen sofort updaten.
 */
export function useTrackRecent(
  entityType: RecentEntityType,
  entityId: number | null | undefined,
  label: string | null | undefined,
) {
  const qc = useQueryClient()
  useEffect(() => {
    if (!entityId || !label) return
    trackRecent(entityType, entityId, label)
      .then(() => {
        void qc.invalidateQueries({ queryKey: ['recents', entityType] })
        void qc.invalidateQueries({ queryKey: ['recents', 'dashboard'] })
      })
      .catch(() => { /* swallow -- nicht UI-blockierend */ })
  }, [entityType, entityId, label, qc])
}
