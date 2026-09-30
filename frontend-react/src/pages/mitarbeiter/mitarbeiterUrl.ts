/**
 * Mitarbeiter als Arbeitsbereich (UI-Pilot Runde 10): der Reiter steht in der
 * URL — /mitarbeiter/:id?tab=… —, damit ein Link aus der Liste, aus dem
 * Rollen-Abzeichen oder aus einer Mail genau dort landet.
 */

export type MaTab =
  | 'stammdaten' | 'arbeitszeit' | 'kostensatz' | 'zeitkonto'
  | 'abwesenheit' | 'projekte' | 'rollen' | 'zugang'

export const MA_TABS: MaTab[] = ['stammdaten', 'arbeitszeit', 'kostensatz', 'zeitkonto', 'abwesenheit', 'projekte', 'rollen', 'zugang']

export const isMaTab = (t: string | null): t is MaTab => t != null && (MA_TABS as string[]).includes(t)

export function mitarbeiterHref(id: number, tab?: MaTab): string {
  return tab && tab !== 'stammdaten' ? `/mitarbeiter/${id}?tab=${tab}` : `/mitarbeiter/${id}`
}
