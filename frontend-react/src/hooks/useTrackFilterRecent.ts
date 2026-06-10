import { useEffect, useMemo, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { trackRecent, hashFilter, type RecentEntityType } from '@/api/recents'

/**
 * Trackt Filter-Kombinationen mit Debounce. ENTITY_ID ist ein stabiler Hash
 * der Snapshot-Werte; LABEL beschreibt die Kombi menschenlesbar; META haelt
 * den vollstaendigen State zum Wiederherstellen.
 *
 *   useTrackFilterRecent('report_filter', { mode, dateFrom, ... },
 *     `${dateLabel} · ${dimLabel}`,
 *     shouldTrack)
 *
 * shouldTrack = false unterdrueckt das Tracken (z.B. wenn Filter "Standard"
 * ist). Default-Filter wuerden sonst die Liste muellern.
 *
 * Debounce 1500 ms -- ein Filter-Wechsel ohne Pause ist noch kein "verwendet".
 */
export function useTrackFilterRecent(
  entityType: RecentEntityType,
  snapshot: Record<string, unknown>,
  label: string,
  shouldTrack: boolean,
) {
  const qc = useQueryClient()
  const snapshotKey = useMemo(() => JSON.stringify(snapshot), [snapshot])
  const filterId   = useMemo(() => hashFilter(snapshot),     [snapshotKey])  // eslint-disable-line react-hooks/exhaustive-deps
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current)
    if (!shouldTrack || !label) return
    timerRef.current = setTimeout(() => {
      trackRecent(entityType, filterId, label, snapshot)
        .then(() => {
          void qc.invalidateQueries({ queryKey: ['recents', entityType] })
        })
        .catch(() => { /* swallow */ })
    }, 1500)
    return () => { if (timerRef.current) clearTimeout(timerRef.current) }
  // snapshotKey deckt snapshot ab
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entityType, filterId, label, snapshotKey, shouldTrack, qc])
}
