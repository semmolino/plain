import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { fetchRecents, trackRecent } from '@/api/recents'
import { useBookableProjects, useBookableStructure } from '@/hooks/useBooking'
import { parentStructureIds, structurePaths } from '@/utils/treeUtils'
import { useIsNarrow } from '@/hooks/useIsNarrow'

/**
 * Projekt + Leistung waehlen, mit „Zuletzt gebucht" (UI-Pilot 2026-09).
 *
 * Gemeinsam fuer „Zeit buchen" und die Stempeluhr. Vorher hatte die
 * Stempeluhr zwei nackte Auswahllisten, zeigte als Leistung auch Knoten mit
 * Unterelementen (auf die der Server keine Buchung annimmt) und kannte keine
 * zuletzt gebuchten Leistungen — gerade dort, wo man mehrmals am Tag wechselt.
 *
 * Die Listen kommen aus useBookableProjects/useBookableStructure: mit
 * „Eigene Zeit buchen" die schlanke Liste ohne Betraege, sonst die volle.
 */
export interface LeafChoice {
  projects:      { ID: number; ABBR: string; NAME: string }[]
  projectId:     number | null
  structureId:   number | null
  leaves:        { STRUCTURE_ID: number; ABBR: string | null }[]
  paths:         Map<number, string>
  structLoading: boolean
  recents:       { ID: number; ENTITY_ID: number; LABEL: string | null; projectId: number }[]
  setProject:    (id: number | null) => void
  setLeaf:       (id: number | null) => void
  pick:          (projectId: number, structureId: number) => void
  /** Letztes Pfadglied, z. B. „LP 2" statt „Leistungen > HOAI > LP 2". */
  leafLabel:     (id: number | null) => string
  projectAbbr:   (id: number | null) => string
  /** Die gewaehlte Leistung in „Zuletzt gebucht" vermerken. */
  remember:      () => void
}

export const lastSegment = (p: string) => (p.includes(' > ') ? p.slice(p.lastIndexOf(' > ') + 3) : p)

export function useLeafChoice(init: { projectId?: number | null; structureId?: number | null } = {}): LeafChoice {
  const narrow = useIsNarrow()
  const [projectId, setProjectId] = useState<number | null>(init.projectId ?? null)
  // undefined = noch nicht gewaehlt → Vorbelegung gilt; null = bewusst geleert.
  const [choice, setChoice] = useState<number | null | undefined>(init.structureId ?? undefined)

  const { data: projectsData } = useBookableProjects()
  const { data: structData, isLoading: structLoading } = useBookableStructure(projectId)
  const { data: recentsData } = useQuery({
    queryKey: ['recents', 'project_structure', null, 'recent'],
    queryFn:  () => fetchRecents('project_structure', 12, { sortBy: 'recent' }),
    staleTime: 30_000,
  })

  const projects  = useMemo(() => projectsData?.data ?? [], [projectsData])
  const structure = useMemo(() => structData?.data ?? [], [structData])
  const paths     = useMemo(() => structurePaths(structure), [structure])
  const leaves    = useMemo(() => {
    const parents = parentStructureIds(structure)
    return structure
      .filter(n => !parents.has(n.STRUCTURE_ID))
      .sort((a, b) => (paths.get(a.STRUCTURE_ID) ?? '').localeCompare(paths.get(b.STRUCTURE_ID) ?? '', 'de', { numeric: true }))
  }, [structure, paths])

  // Zuletzt gebucht — ueber alle Projekte, je Leistung einmal, nur buchbare Projekte.
  const recents = useMemo(() => {
    const seen = new Set<number>()
    const out: LeafChoice['recents'] = []
    for (const r of recentsData?.data ?? []) {
      const pid = Number((r.META as { project_id?: number } | null)?.project_id)
      if (!Number.isFinite(pid) || seen.has(r.ENTITY_ID) || !projects.some(p => p.ID === pid)) continue
      seen.add(r.ENTITY_ID)
      out.push({ ID: r.ID, ENTITY_ID: r.ENTITY_ID, LABEL: r.LABEL ?? null, projectId: pid })
    }
    return out.slice(0, narrow ? 3 : 6)
  }, [recentsData, projects, narrow])

  // Leistung vorbelegen: die einzige Leistung oder die zuletzt in diesem
  // Projekt gebuchte. Abgeleitet statt per Effekt gesetzt — eine Wahl des
  // Nutzers (auch „bitte waehlen") hat immer Vorrang.
  const defaultLeaf = useMemo(() => {
    if (projectId == null || !leaves.length) return null
    if (leaves.length === 1) return leaves[0].STRUCTURE_ID
    const last = (recentsData?.data ?? []).find(r =>
      Number((r.META as { project_id?: number } | null)?.project_id) === projectId && leaves.some(l => l.STRUCTURE_ID === r.ENTITY_ID))
    return last ? last.ENTITY_ID : null
  }, [projectId, leaves, recentsData])
  const structureId = choice === undefined ? defaultLeaf : choice

  const leafLabel   = (id: number | null) => (id == null ? '' : lastSegment(paths.get(id) ?? ''))
  const projectAbbr = (id: number | null) => projects.find(p => p.ID === id)?.ABBR ?? ''

  return {
    projects, projectId, structureId, leaves, paths, structLoading, recents,
    setProject: id => { setProjectId(id); setChoice(undefined) },
    setLeaf:    id => setChoice(id),
    pick:       (pid, sid) => { setProjectId(pid); setChoice(sid) },
    leafLabel, projectAbbr,
    remember: () => {
      if (structureId == null || projectId == null) return
      const path = paths.get(structureId) ?? leafLabel(structureId)
      void trackRecent('project_structure', structureId, path, { project_id: projectId }).catch(() => {})
    },
  }
}
