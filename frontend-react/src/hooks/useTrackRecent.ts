import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { trackRecent, type RecentEntityType } from '@/api/recents'

/**
 * Trackt einen Aufruf auf den Recents-Endpoint.
 * Wird typischerweise auf Detailseiten/-modalen aufgerufen mit
 *   useTrackRecent('project', selectedProjectId, projectLabel)
 *
 * Optionales META wird mitgespeichert -- noetig fuer Filter-Recents und
 * kontextabhaengige Eintraege (z.B. project_structure mit project_id im META).
 *
 * Effekt feuert, wenn sich entity_id, label oder die Serialisierung des
 * METAs aendert. Fehler werden geschluckt.
 */
export function useTrackRecent(
  entityType: RecentEntityType,
  entityId: number | null | undefined,
  label: string | null | undefined,
  meta?: Record<string, unknown> | null,
) {
  const qc = useQueryClient()
  // META-Identitaet ueber JSON.stringify stabilisieren -- sonst feuert der
  // Effekt bei jedem Re-Render, weil das Objekt-Literal neue Referenz hat.
  const metaKey = meta ? JSON.stringify(meta) : null

  useEffect(() => {
    if (!entityId || !label) return
    trackRecent(entityType, entityId, label, meta ?? null)
      .then(() => {
        void qc.invalidateQueries({ queryKey: ['recents', entityType] })
        void qc.invalidateQueries({ queryKey: ['recents', 'dashboard'] })
      })
      .catch(() => { /* swallow */ })
  // metaKey deckt meta ab, deshalb meta selbst hier nicht als Dep aufnehmen
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entityType, entityId, label, metaKey, qc])
}
