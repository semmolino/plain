import { apiClient } from './client'
import type { StructureNode } from './projekte'

/**
 * Schlanke Auswahllisten fuer „Eigene Zeit buchen" (projects.bookings.own).
 * Nur Nummer, Name und Kuerzel — wer nur dieses Recht hat, sieht keine
 * Honorare, Budgets oder Strukturwerte (Migration 0169).
 */
export const fetchOwnProjects = () =>
  apiClient.get<{ data: Array<{ ID: number; ABBR: string; NAME: string }> }>('/buchungen/eigen/projekte')

export type OwnLeaf = Pick<StructureNode, 'STRUCTURE_ID' | 'FATHER_ID' | 'ABBR' | 'NAME' | 'BILLING_TYPE_ID'>

export const fetchOwnLeaves = (projectId: number) =>
  apiClient.get<{ data: OwnLeaf[] }>(`/buchungen/eigen/projekte/${projectId}/leistungen`)
