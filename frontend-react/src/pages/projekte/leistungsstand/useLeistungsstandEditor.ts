import { useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { fetchLeistungsstand, saveLeistungsstand, type SaveLeistungsstandResult } from '@/api/projekte'
import { buildRows, pctInput, summarize } from './leistungsstandCalc'

/**
 * Zustand der Leistungsstand-Eingabe eines Projekts zu einem Stichtag.
 *
 * Gespeichert werden nur geaenderte Elemente — vorher schickte der Reiter bei
 * jedem Speichern alle Blaetter, auch unveraenderte. `vals` haelt nur, was der
 * Nutzer getippt hat; alles andere zeigt den heutigen Stand.
 */
export function useLeistungsstandEditor(projectId: number | null, asOf: string | null) {
  const qc = useQueryClient()
  const [vals, setVals] = useState<Record<number, string>>({})
  const [pending, setPending] = useState<'save' | 'confirm' | null>(null)

  const query = useQuery({
    queryKey: ['leistungsstand', projectId],
    queryFn:  () => fetchLeistungsstand(projectId!),
    enabled:  projectId != null,
  })
  const meta      = query.data?.meta
  const effAsOf   = asOf ?? meta?.today ?? null
  const nodes     = useMemo(() => query.data?.data ?? [], [query.data])
  const rows      = useMemo(() => buildRows(nodes, effAsOf ?? '9999-12-31'), [nodes, effAsOf])
  const summary   = useMemo(() => summarize(rows, vals), [rows, vals])
  const editableCount = rows.filter(r => r.editable).length
  const lockedCount   = rows.filter(r => r.lockedAfter).length

  /** Angezeigter Wert eines Feldes: getippt oder heutiger Stand. */
  const valueOf = (sid: number, current: number) => vals[sid] ?? pctInput(current)

  function setVal(sid: number, raw: string) {
    setVals(v => ({ ...v, [sid]: raw }))
  }

  async function refresh() {
    await Promise.all([
      qc.invalidateQueries({ queryKey: ['leistungsstand', projectId] }),
      qc.invalidateQueries({ queryKey: ['leistungsstand-runde'] }),
      qc.invalidateQueries({ queryKey: ['structure', projectId] }),
      qc.invalidateQueries({ queryKey: ['report-header', projectId] }),
    ])
  }

  async function run(kind: 'save' | 'confirm'): Promise<SaveLeistungsstandResult> {
    if (projectId == null) throw new Error('Kein Projekt gewählt')
    if (summary.errors) throw new Error(summary.errors === 1 ? 'Ein Feld enthält keinen gültigen Wert.' : `${summary.errors} Felder enthalten keinen gültigen Wert.`)
    setPending(kind)
    try {
      const res = kind === 'save'
        ? await saveLeistungsstand(projectId, summary.updates, { as_of_date: effAsOf ?? undefined })
        : await saveLeistungsstand(projectId, [], { as_of_date: effAsOf ?? undefined, confirm_unchanged: true })
      await refresh()
      setVals({})
      return res
    } finally {
      setPending(null)
    }
  }

  return {
    query, meta, rows, vals, summary, effAsOf, editableCount, lockedCount, pending,
    dirty: summary.changed > 0 || summary.errors > 0,
    valueOf, setVal,
    reset: () => setVals({}),
    save:    () => run('save'),
    confirm: () => run('confirm'),
  }
}

export type LeistungsstandEditor = ReturnType<typeof useLeistungsstandEditor>
