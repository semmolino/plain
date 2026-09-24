import { useQuery } from '@tanstack/react-query'
import { usePermission } from '@/store/permissionsStore'
import { fetchProjectsShort, fetchProjectStructure, type StructureNode } from '@/api/projekte'
import { fetchOwnProjects, fetchOwnLeaves } from '@/api/eigeneZeit'

/**
 * Wer Zeit buchen darf — und woher die Auswahllisten kommen (Runde 2).
 *
 * Vorher hing jeder Einstieg an `projects.bookings.create` + `projects.view`.
 * Die Rolle „Mitarbeiter" hatte keines von beiden, und wer sie bekam, sah mit
 * `projects.view` Honorare und Strukturen aller Projekte. Mit
 * `projects.bookings.own` bucht man nur fuer sich selbst; die Listen kommen
 * dann aus /buchungen/eigen/* ohne Betraege.
 */
export function useCanBook() {
  const create   = usePermission('projects.bookings.create')
  const own      = usePermission('projects.bookings.own')
  const projView = usePermission('projects.view')
  return {
    /** „Zeit buchen" und Stempeluhr anzeigen */
    canBook:       (create && projView) || own,
    /** fuer andere Mitarbeiter buchen */
    canBookOthers: create && projView,
    /** volle Projektdaten statt der schlanken Listen */
    fullLists:     create && projView,
  }
}

export function useBookableProjects() {
  const { fullLists, canBook } = useCanBook()
  return useQuery({
    queryKey: fullLists ? ['projects-short'] : ['own-projects'],
    queryFn:  fullLists ? fetchProjectsShort : fetchOwnProjects,
    enabled:  canBook,
    staleTime: 60_000,
  })
}

export function useBookableStructure(projectId: number | null) {
  const { fullLists } = useCanBook()
  return useQuery({
    queryKey: fullLists ? ['structure', projectId] : ['own-leaves', projectId],
    queryFn:  async () => {
      if (fullLists) return fetchProjectStructure(projectId!)
      const r = await fetchOwnLeaves(projectId!)
      return { data: r.data as unknown as StructureNode[] }
    },
    enabled:  projectId != null,
  })
}
