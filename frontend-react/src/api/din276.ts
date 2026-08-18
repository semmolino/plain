import { apiClient } from './client'

export type Din276Stage = 'schaetzung' | 'berechnung'

export interface Din276Group {
  ID?:              number
  KG_CODE:          string
  LABEL:            string | null
  AMOUNT:           number
  IS_PLANNED_SELF:  boolean
  SORT_ORDER:       number
}

export interface Din276Estimate {
  ID:                            number
  NAME_SHORT:                    string | null
  NAME_LONG:                     string | null
  STAGE:                         Din276Stage
  STATUS:                        string
  DIN_VERSION:                   string
  MITVERARBEITETE_BAUSUBSTANZ:   number
  PROJECT_ID:                    number | null
  OFFER_ID:                      number | null
  groups?:                       Din276Group[]
}

export interface Din276HerleitungRow {
  kg:     string
  label:  string
  basis:  number
  ansatz: number   // %
  betrag: number
}

export interface Din276AnrechenbarResult {
  anrechenbareKosten:         number
  sonstigeAnrechenbareKosten: number
  herleitung:                 Din276HerleitungRow[]
}

export const fetchDin276Estimates = (params: { project_id?: number; offer_id?: number }) => {
  const sp = new URLSearchParams()
  if (params.project_id) sp.set('project_id', String(params.project_id))
  if (params.offer_id)   sp.set('offer_id',   String(params.offer_id))
  return apiClient.get<{ data: Din276Estimate[]; available: boolean }>(`/stammdaten/din276/estimates?${sp}`)
}

export const fetchDin276Estimate = (id: number) =>
  apiClient.get<{ data: Din276Estimate }>(`/stammdaten/din276/estimates/${id}`)

export const createDin276Estimate = (body: { project_id?: number; offer_id?: number; name_short?: string; stage?: Din276Stage }) =>
  apiClient.post<{ data: Din276Estimate }>('/stammdaten/din276/estimates', body)

export const updateDin276Estimate = (id: number, body: Partial<{
  name_short: string; name_long: string; stage: Din276Stage; status: string; mitverarbeitete_bausubstanz: number
}>) =>
  apiClient.patch<{ data: Din276Estimate }>(`/stammdaten/din276/estimates/${id}`, body)

export const saveDin276Groups = (id: number, groups: Din276Group[]) =>
  apiClient.post<{ data: Din276Estimate }>(`/stammdaten/din276/estimates/${id}/groups/save`, { groups: groups.map(g => ({
    id: g.ID, kg_code: g.KG_CODE, label: g.LABEL, amount: g.AMOUNT, is_planned_self: g.IS_PLANNED_SELF, sort_order: g.SORT_ORDER,
  })) })

/** Raumakustik (Anlage 1.2.5) rechnet je Innenraum — dafuer Rauminhalt des
 *  Innenraums und Bruttorauminhalt des Gebaeudes (m³). */
export const computeDin276Anrechenbar = (
  id: number,
  leistungsbild = 'gebaeude',
  volumes?: { rauminhalt?: string | number; bri?: string | number },
) => {
  const sp = new URLSearchParams({ leistungsbild })
  if (volumes?.rauminhalt) sp.set('rauminhalt', String(volumes.rauminhalt))
  if (volumes?.bri)        sp.set('bri',        String(volumes.bri))
  return apiClient.get<{ data: Din276AnrechenbarResult }>(
    `/stammdaten/din276/estimates/${id}/anrechenbar?${sp.toString()}`)
}

export const deleteDin276Estimate = (id: number) =>
  apiClient.delete<{ success: boolean }>(`/stammdaten/din276/estimates/${id}`)
