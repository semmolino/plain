import { apiClient } from './client'

export interface OverheadItem {
  id?:       number
  category:  string
  item_name: string
  amount:    number
}

export interface EmployeeCalcParams {
  annual_salary:      number
  weekly_hours:       number
  vacation_days:      number
  sick_days_est:      number
  training_days:      number
  social_contrib_pct: number
  productivity_pct:   number
}

export interface CalcBreakdown {
  working_days:       number
  public_holidays:    number
  productive_hours:   number
  annual_salary:      number
  social_contrib_eur: number
  direct_cost_total:  number
  direct_cost_per_h:  number
  overhead_total:     number
  overhead_share_pct: number
  overhead_allocated: number
  overhead_per_h:     number
  vollkostensatz:     number
  import_rate:        number
}

export interface CalcResult {
  employee_id:     number
  short_name:      string
  first_name:      string
  last_name:       string
  current_cp_rate: number | null
  country_code:    string
  state_code:      string | null
  params:          EmployeeCalcParams
  breakdown:       CalcBreakdown
}

export const fetchOverhead = (year: number) =>
  apiClient.get<{ data: OverheadItem[] }>(`/kostensatz/overhead?year=${year}`)

export const saveOverhead = (year: number, items: OverheadItem[]) =>
  apiClient.post<{ data: OverheadItem[] }>('/kostensatz/overhead', { year, items })

export const copyOverheadFromYear = (from_year: number, to_year: number) =>
  apiClient.post<{ data: OverheadItem[] }>('/kostensatz/overhead/copy', { from_year, to_year })

export const fetchEmployeeParams = (id: number, year: number) =>
  apiClient.get<{ data: EmployeeCalcParams }>(`/kostensatz/params/${id}?year=${year}`)

export const saveEmployeeParams = (id: number, year: number, params: EmployeeCalcParams) =>
  apiClient.post<{ data: unknown }>(`/kostensatz/params/${id}`, { year, ...params })

export const saveEmployeeParamsBulk = (year: number, params: Array<{ employee_id: number } & EmployeeCalcParams>) =>
  apiClient.post<{ ok: boolean }>('/kostensatz/params-bulk', { year, params })

export const calculateRates = (body: { year: number; employee_ids?: number[]; profit_markup_pct?: number }) =>
  apiClient.post<{ data: CalcResult[] }>('/kostensatz/calculate', body)

export const importRates = (rates: Array<{ employee_id: number; rate: number }>, valid_from: string, recalc_bookings: boolean) =>
  apiClient.post<{ ok: boolean }>('/kostensatz/import', { rates, valid_from, recalc_bookings })
