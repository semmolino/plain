import { useCallback } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { fetchGroupAbbrSuggestion, PROJECT_GROUP_QUERY_KEYS, type MovedProject } from '@/api/gesamtprojekte'
import type { DateFilter } from '@/api/reports'
import type { GroupTab } from '@/pages/projekte/projektUrlState'

/** Link auf ein Gesamtprojekt (Projekte-Seite, URL-Zustand in projektUrlState). */
export const groupHref = (id: number, tab: GroupTab = 'uebersicht') => `/projekte?groupId=${id}&tab=${tab}`

/** „2026-014 · Schule Nord" — Kürzel nur, wenn es eins gibt. */
export const groupLabel = (g: { ABBR?: string | null; NAME: string }) =>
  [g.ABBR, g.NAME].filter(Boolean).join(' · ')

/**
 * Heute, in derselben Form wie der Report „Alle Projekte" — so teilen sich
 * Gesamtprojekt-Liste und Report den Cache (`['project-list', filter]`).
 */
export const NOW_FILTER: DateFilter = { mode: 'now', asOfDate: '', dateFrom: '', dateTo: '' }

/** Nach jeder Änderung an Gesamtprojekten: Listen, Ansicht und Reports neu laden. */
export function useInvalidateGroups() {
  const qc = useQueryClient()
  return useCallback(
    () => Promise.all(PROJECT_GROUP_QUERY_KEYS.map(k => qc.invalidateQueries({ queryKey: [...k] }))),
    [qc],
  )
}

/** Hinweis, wenn Projekte beim Zuordnen aus einem anderen Gesamtprojekt gewechselt sind. */
export function movedNote(moved: MovedProject[] | undefined): string | null {
  if (!moved?.length) return null
  const from = [...new Set(moved.map(m => m.FROM_GROUP_NAME).filter(Boolean))]
  const what = moved.length === 1 ? `${moved[0].ABBR} ist` : `${moved.length} Projekte sind`
  return `${what} aus ${from.length === 1 ? `„${from[0]}"` : 'anderen Gesamtprojekten'} hierher gewechselt.`
}

// ── Neues Projekt in einem Gesamtprojekt (Anlegen, Beauftragen, Kopieren) ────

/** Auswahl beim Anlegen eines Projekts: Gesamtprojekt und Art der Nummer. */
export interface GruppenWahl {
  /** '' = keinem Gesamtprojekt */
  groupId: string
  /** abgeleitete Nummer ({Kürzel}-{NN}) statt der nächsten aus dem Nummernkreis */
  derived: boolean
}

export const KEINE_GRUPPE: GruppenWahl = { groupId: '', derived: false }

/** Vorschlag der abgeleiteten Nummer — null, wenn das Gesamtprojekt kein Kürzel hat. */
export function useDerivedAbbr(groupId: string) {
  const { data } = useQuery({
    queryKey: ['project-group-number', groupId],
    queryFn:  () => fetchGroupAbbrSuggestion(Number(groupId)),
    enabled:  groupId !== '',
    staleTime: 0,
  })
  return groupId !== '' ? data?.data.abbr ?? null : null
}

/** Nutzlast-Felder für Anlegen und Beauftragen (Server: newProjectGroupAndAbbr). */
export function gruppenPayload(w: GruppenWahl, derivedAbbr: string | null): { project_group_id?: number; project_abbr?: string } {
  if (!w.groupId) return {}
  return {
    project_group_id: Number(w.groupId),
    ...(w.derived && derivedAbbr ? { project_abbr: derivedAbbr } : {}),
  }
}
