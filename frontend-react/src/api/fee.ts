import { apiClient } from './client'

export interface FeeGroup  { ID: number; NAME_SHORT: string; NAME_LONG: string }
export interface FeeMaster { ID: number; NAME_SHORT: string; NAME_LONG: string }
export interface FeeZone   { ID: number; NAME_SHORT: string; NAME_LONG: string }

export interface FeeCalcMaster {
  ID:                    number
  NAME_SHORT:            string | null
  NAME_LONG:             string | null
  PROJECT_ID:            number | null
  ZONE_ID:               number | null
  ZONE_PERCENT:          number | null
  CONSTRUCTION_COSTS_K0: number | null
  CONSTRUCTION_COSTS_K1: number | null
  CONSTRUCTION_COSTS_K2: number | null
  CONSTRUCTION_COSTS_K3: number | null
  CONSTRUCTION_COSTS_K4: number | null
  REVENUE_K0:            number | null
  REVENUE_K1:            number | null
  REVENUE_K2:            number | null
  REVENUE_K3:            number | null
  REVENUE_K4:            number | null
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

export const fetchFeeGroups = () =>
  apiClient.get<{ data: FeeGroup[] }>('/stammdaten/fee-groups')

export const fetchFeeMasters = (feeGroupId: number | string) =>
  apiClient.get<{ data: FeeMaster[] }>(`/stammdaten/fee-masters?fee_group_id=${feeGroupId}`)

export const fetchFeeZones = (feeMasterId: number | string) =>
  apiClient.get<{ data: FeeZone[] }>(`/stammdaten/fee-zones?fee_master_id=${feeMasterId}`)

export const initFeeCalcMaster = (fee_master_id: number) =>
  apiClient.post<{ data: FeeCalcMaster }>('/stammdaten/fee-calculation-masters/init', { fee_master_id })

export const saveFeeCalcBasis = (id: number, body: Partial<FeeCalcMaster>) =>
  apiClient.patch<{ data: FeeCalcMaster }>(`/stammdaten/fee-calculation-masters/${id}/basis`, body)

export const initFeePhases = (id: number) =>
  apiClient.post<{ data: FeePhaseRow[] }>(`/stammdaten/fee-calculation-masters/${id}/phases/init`, {})

export const saveFeePhases = (id: number, rows: Array<{ ID: number; KX: string; FEE_PERCENT: number | null }>) =>
  apiClient.post<{ data: FeePhaseRow[] }>(`/stammdaten/fee-calculation-masters/${id}/phases/save`, { rows })

export const deleteFeeCalcMaster = (id: number) =>
  apiClient.delete<{ success: boolean }>(`/stammdaten/fee-calculation-masters/${id}`)

export const attachFeeToStructure = (id: number, father_id: number) =>
  apiClient.post<{ message: string }>(`/stammdaten/fee-calculation-masters/${id}/add-to-project-structure`, { father_id })
