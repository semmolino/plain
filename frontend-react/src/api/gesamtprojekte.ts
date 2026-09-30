import { apiClient } from './client'

// Gesamtprojekte (Migration 0181, docs/GESAMTPROJEKT_CONCEPT.md): eine Klammer
// um mehrere Projekte. Belege bleiben am Projekt — hier wird nur zugeordnet.
// Beträge kommen aus dem Report (`fetchGroupSummary` in api/reports.ts).

export interface ProjectGroup {
  ID:            number
  ABBR:          string | null
  NAME:          string
  ADDRESS_ID:    number | null
  ADDRESS_NAME:  string
  MANAGER_ID:    number | null
  MANAGER_NAME:  string
  NOTES:         string | null
  PROJECT_IDS:   number[]
  PROJECT_COUNT: number
}

export interface ProjectGroupMember {
  ID:                number
  ABBR:              string
  NAME:              string
  PROJECT_STATUS_ID: number | null
  ADDRESS_ID:        number | null
  COMPANY_ID:        number | null
  IS_INTERNAL:       boolean
  /** Rechnungsempfänger aus dem Vertrag — nur mit `projects.contracts.view` vorhanden. */
  INVOICE_ADDRESS_NAME?: string | null
}

export interface ProjectGroupDetail extends ProjectGroup {
  PROJECTS: ProjectGroupMember[]
}

/** Projekt, das beim Zuordnen aus einem anderen Gesamtprojekt herübergewechselt ist. */
export interface MovedProject {
  ID:              number
  ABBR:            string
  NAME:            string
  FROM_GROUP_ID:   number
  FROM_GROUP_NAME: string
}

export interface ProjectGroupPayload {
  name:        string
  abbr:        string | null
  address_id:  number | null
  manager_id:  number | null
  notes:       string | null
  project_ids?: number[]
}

export const fetchProjectGroups = () =>
  apiClient.get<{ data: ProjectGroup[] }>('/projekte/gruppen')

export const fetchProjectGroup = (id: number) =>
  apiClient.get<{ data: ProjectGroupDetail }>(`/projekte/gruppen/${id}`)

export const createProjectGroup = (body: ProjectGroupPayload) =>
  apiClient.post<{ data: ProjectGroupDetail; moved: MovedProject[] }>('/projekte/gruppen', body)

export const updateProjectGroup = (id: number, body: Partial<ProjectGroupPayload>) =>
  apiClient.patch<{ data: ProjectGroupDetail }>(`/projekte/gruppen/${id}`, body)

export const deleteProjectGroup = (id: number) =>
  apiClient.delete<{ data: { deleted: boolean; unlinked: number } }>(`/projekte/gruppen/${id}`)

export const setProjectGroupMembers = (id: number, projectIds: number[]) =>
  apiClient.put<{ data: ProjectGroupDetail; added: number; removed: number; moved: MovedProject[] }>(
    `/projekte/gruppen/${id}/projekte`, { project_ids: projectIds },
  )

/** Nächste abgeleitete Projektnummer ({Kürzel}-{NN}); null ohne Kürzel. */
export const fetchGroupAbbrSuggestion = (id: number) =>
  apiClient.get<{ data: { abbr: string | null } }>(`/projekte/gruppen/${id}/nummer`)

/** Alles, was nach einer Änderung an Gesamtprojekten neu geladen werden muss. */
export const PROJECT_GROUP_QUERY_KEYS = [
  ['project-groups'], ['project-group'], ['report-group'],
  ['projects-full'], ['projects-short'], ['project-list'], ['project-group-number'],
] as const
