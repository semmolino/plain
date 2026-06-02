import { apiClient, openPdfWithAuth } from './client'

export interface FeeGroup  { ID: number; NAME_SHORT: string; NAME_LONG: string }
export interface FeeMaster { ID: number; NAME_SHORT: string; NAME_LONG: string }
export interface FeeZone   { ID: number; NAME_SHORT: string; NAME_LONG: string }

export interface FeeCalcMaster {
  ID:                          number
  NAME_SHORT:                  string | null
  NAME_LONG:                   string | null
  PROJECT_ID:                  number | null
  OFFER_ID:                    number | null
  ATTACH_TO_OFFER_STRUCTURE_ID: number | null
  FEE_MASTER_ID:               number | null
  ZONE_ID:                     number | null
  ZONE_PERCENT:                number | null
  CONSTRUCTION_COSTS_K0:       number | null
  CONSTRUCTION_COSTS_K1:       number | null
  CONSTRUCTION_COSTS_K2:       number | null
  CONSTRUCTION_COSTS_K3:       number | null
  CONSTRUCTION_COSTS_K4:       number | null
  REVENUE_K0:                  number | null
  REVENUE_K1:                  number | null
  REVENUE_K2:                  number | null
  REVENUE_K3:                  number | null
  REVENUE_K4:                  number | null
  // enriched fields from listFeeCalcMasters
  projectLabel?: string | null
  offerLabel?:   string | null
  grundhonorar?: number
  zuschlaegeSum?: number
  gesamthonorar?: number
}

export interface FeePhaseRow {
  ID:               number
  PHASE_LABEL:      string
  FEE_PERCENT_BASE: number | null
  FEE_PERCENT:      number | null
  KX:               string
  REVENUE_BASE?:    number | null
  PHASE_REVENUE?:   number | null
}

export interface FeeSurchargeGlobal {
  ID:              number
  NAME_SHORT:      string
  NAME_LONG:       string | null
  SURCHARGE_TYPE:  string | null
}

export interface FeeCalcSurcharge {
  ID?:                number
  FEE_CALC_MASTER_ID: number
  FEE_SURCHARGE_ID:   number | null
  NAME_SHORT:         string | null
  NAME_LONG:          string | null
  PERCENT:            number | null
  BASE_AMOUNT:        number | null
  AMOUNT:             number | null
  SORT_ORDER:         number
  LPH_FILTER:         string | null  // JSON array of FEE_CALCULATION_PHASE IDs; null = all phases
  CALC_MODE:          string | null  // 'parallel' | 'cumulative'; null treated as 'parallel'
  INCLUDE_BL:         boolean        // legacy bulk toggle — superseded by BL_FILTER
  BL_FILTER:          string | null  // JSON array of FEE_CALCULATION_BL IDs; null = no BL items
}

export type BlAmountType = 'fixed' | 'pct_lph' | 'pct_basis' | 'pct_grundhonorar' | 'pct_gesamthonorar' | 'pct_baukosten'

export interface FeeCalcBl {
  ID?:                number
  FEE_CALC_MASTER_ID: number
  NAME_SHORT:         string | null
  NAME:               string           // NAME_LONG
  LPH_REF:            string | null    // legacy text label, kept for compat
  LPH_PHASE_ID:       number | null    // FK to FEE_CALCULATION_PHASE
  AMOUNT_TYPE:        BlAmountType
  PERCENT:            number | null    // set for pct_* types
  KX_REF:             string | null    // 'K0'..'K4' for pct_basis / pct_baukosten
  AMOUNT:             number           // always stored; computed for pct_* types
  SORT_ORDER:         number
}

export const fetchFeeGroups = () =>
  apiClient.get<{ data: FeeGroup[] }>('/stammdaten/fee-groups')

export const fetchFeeMasters = (feeGroupId: number | string) =>
  apiClient.get<{ data: FeeMaster[] }>(`/stammdaten/fee-masters?fee_group_id=${feeGroupId}`)

export const fetchFeeZones = (feeMasterId: number | string) =>
  apiClient.get<{ data: FeeZone[] }>(`/stammdaten/fee-zones?fee_master_id=${feeMasterId}`)

export const fetchFeeCalcMasters = (params?: { project_id?: number; offer_id?: number }) => {
  const sp = new URLSearchParams()
  if (params?.project_id) sp.set('project_id', String(params.project_id))
  if (params?.offer_id)   sp.set('offer_id',   String(params.offer_id))
  const qs = sp.toString() ? `?${sp.toString()}` : ''
  return apiClient.get<{ data: FeeCalcMaster[] }>(`/stammdaten/fee-calculation-masters${qs}`)
}

export const fetchFeeCalcMaster = (id: number) =>
  apiClient.get<{ data: FeeCalcMaster }>(`/stammdaten/fee-calculation-masters/${id}`)

export const initFeeCalcMaster = (fee_master_id: number, opts?: { project_id?: number; offer_id?: number }) =>
  apiClient.post<{ data: FeeCalcMaster }>('/stammdaten/fee-calculation-masters/init', {
    fee_master_id,
    ...(opts?.project_id ? { project_id: opts.project_id } : {}),
    ...(opts?.offer_id   ? { offer_id:   opts.offer_id   } : {}),
  })

export const saveFeeCalcBasis = (id: number, body: Partial<FeeCalcMaster>) =>
  apiClient.patch<{ data: FeeCalcMaster }>(`/stammdaten/fee-calculation-masters/${id}/basis`, body)

export const initFeePhases = (id: number) =>
  apiClient.post<{ data: FeePhaseRow[] }>(`/stammdaten/fee-calculation-masters/${id}/phases/init`, {})

export const saveFeePhases = (id: number, rows: Array<{ ID: number; KX: string; FEE_PERCENT: number | null }>) =>
  apiClient.post<{ data: FeePhaseRow[] }>(`/stammdaten/fee-calculation-masters/${id}/phases/save`, { rows })

export const deleteFeeCalcMaster = (id: number) =>
  apiClient.delete<{ success: boolean }>(`/stammdaten/fee-calculation-masters/${id}`)

export const attachFeeToStructure = (id: number, father_id: number, confirmed?: boolean) =>
  apiClient.post<{ message: string }>(`/stammdaten/fee-calculation-masters/${id}/add-to-project-structure`, { father_id, ...(confirmed ? { confirmed: true } : {}) })

export const attachFeeToOfferStructure = (id: number, father_id: number) =>
  apiClient.post<{ message: string }>(`/stammdaten/fee-calculation-masters/${id}/add-to-offer-structure`, { father_id })

export const fetchFeeSurchargesGlobal = (feeMasterId: number) =>
  apiClient.get<{ data: FeeSurchargeGlobal[] }>(`/stammdaten/fee-surcharges-global?fee_master_id=${feeMasterId}`)

export const fetchFeeCalcSurcharges = (calcMasterId: number) =>
  apiClient.get<{ data: FeeCalcSurcharge[] }>(`/stammdaten/fee-calculation-masters/${calcMasterId}/surcharges`)

export const saveFeeCalcSurcharges = (calcMasterId: number, rows: FeeCalcSurcharge[]) =>
  apiClient.post<{ data: FeeCalcSurcharge[] }>(`/stammdaten/fee-calculation-masters/${calcMasterId}/surcharges/save`, { rows })

export const fetchFeeCalcBl = (calcMasterId: number) =>
  apiClient.get<{ data: FeeCalcBl[] }>(`/stammdaten/fee-calculation-masters/${calcMasterId}/bl`)

export const saveFeeCalcBl = (calcMasterId: number, rows: FeeCalcBl[]) =>
  apiClient.post<{ data: FeeCalcBl[] }>(`/stammdaten/fee-calculation-masters/${calcMasterId}/bl/save`, { rows })

export function openHonorarPdf(id: number) {
  void openPdfWithAuth(`/stammdaten/fee-calculation-masters/${id}/pdf`)
}

export const syncFeeCalcToStructure = (id: number) =>
  apiClient.post<{ synced: number; projectId: number | null; message: string }>(
    `/stammdaten/fee-calculation-masters/${id}/sync-to-structure`, {}
  )
