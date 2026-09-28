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

/** Eine eigene Buchung fuer „Meine Zeit" — ohne Saetze und Summen. */
export interface MyBooking {
  ID:                  number
  PROJECT_ID:          number | null
  STRUCTURE_ID:        number | null
  BOOKING_DATE:        string
  TIME_START:          string | null
  TIME_FINISH:         string | null
  QUANTITY_INT:        number
  /** Abrechnungsstunden = geleistete Stunden (beim Aendern mitziehen). */
  EXT_FOLLOWS:         boolean
  POSTING_DESCRIPTION: string
  ENTRY_KIND:          'WORK' | 'BREAK' | string
  BOOKING_KIND:        string | null
  PROJECT:             { ABBR: string; NAME: string } | null
  STRUCTURE:           { ABBR: string; NAME: string | null } | null
  /** steckt in einer Rechnung/Abschlagsrechnung — nicht mehr aenderbar */
  BILLED:              boolean
  /** Monat fuer den Mitarbeiter abgeschlossen */
  CLOSED:              boolean
}

/** Eigene Buchungen eines Zeitraums (hoechstens 62 Tage); Mitarbeiter = Sitzung. */
export const fetchMine = (from: string, to: string) =>
  apiClient.get<{ data: { from: string; to: string; bookings: MyBooking[]; drafts: MyBooking[] } }>(
    `/buchungen/mine?from=${from}&to=${to}`)
