import { apiClient, openPdfWithAuth } from './client'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface Country     { ID: string; NAME_LONG: string; NAME_SHORT: string }
export interface Salutation  { ID: number; SALUTATION: string }
export interface Gender      { ID: number; GENDER: string }

export interface Address {
  ID:               number
  ADDRESS_NAME_1:   string
  ADDRESS_NAME_2:   string | null
  STREET:           string | null
  POST_CODE:        string | null
  CITY:             string | null
  POST_OFFICE_BOX:  string | null
  COUNTRY_ID:       string | null
  CUSTOMER_NUMBER:  string | null
  TAX_ID:           string | null
  BUYER_REFERENCE:  string | null
  COUNTRY:          string
}

export interface Contact {
  ID:            number
  TITLE:         string | null
  FIRST_NAME:    string
  LAST_NAME:     string
  EMAIL:         string | null
  MOBILE:        string | null
  SALUTATION_ID: number | null
  GENDER_ID:     number | null
  ADDRESS_ID:    number | null
  SALUTATION:    string
  GENDER:        string
  ADDRESS:       string
  NAME:          string
}

export interface AddressPayload {
  address_name_1: string
  address_name_2?: string
  street?: string
  post_code?: string
  city?: string
  post_office_box?: string
  country_id: string
  customer_number?: string
  tax_id?: string
  buyer_reference?: string
}

export interface ContactPayload {
  title?: string
  first_name: string
  last_name: string
  email?: string
  mobile?: string
  salutation_id: string | number
  gender_id: string | number
  address_id: string | number
}

// ── Lookups ───────────────────────────────────────────────────────────────────

export const fetchCountries   = () => apiClient.get<{ data: Country[] }>('/stammdaten/countries')
export const fetchSalutations = () => apiClient.get<{ data: Salutation[] }>('/stammdaten/salutations')
export const fetchGenders     = () => apiClient.get<{ data: Gender[] }>('/stammdaten/genders')

// ── Addresses ─────────────────────────────────────────────────────────────────

export const fetchAddressList = () =>
  apiClient.get<{ data: Address[] }>('/stammdaten/addresses/list')

export const searchAddressesApi = (q: string) =>
  apiClient.get<{ data: Array<{ ID: number; ADDRESS_NAME_1: string }> }>(
    `/stammdaten/addresses/search?q=${encodeURIComponent(q)}`
  )

export const createAddress = (body: AddressPayload) =>
  apiClient.post<{ data: Address }>('/stammdaten/address', body)

export const updateAddress = (id: number, body: AddressPayload) =>
  apiClient.patch<{ data: Address }>(`/stammdaten/addresses/${id}`, body)

// ── Contacts ──────────────────────────────────────────────────────────────────

export const fetchContactList = () =>
  apiClient.get<{ data: Contact[] }>('/stammdaten/contacts/list')

export const searchContactsApi = (addressId: number, q: string) =>
  apiClient.get<{ data: Array<{ ID: number; FIRST_NAME: string; LAST_NAME: string }> }>(
    `/stammdaten/contacts/search?address_id=${addressId}&q=${encodeURIComponent(q)}`
  )

export const fetchContactsByAddress = (addressId: number) =>
  apiClient.get<{ data: Array<{ ID: number; FIRST_NAME: string; LAST_NAME: string }> }>(
    `/stammdaten/contacts/by-address?address_id=${addressId}`
  )

export const createContact = (body: ContactPayload) =>
  apiClient.post<{ data: Contact }>('/stammdaten/contacts', body)

export const updateContact = (id: number, body: ContactPayload) =>
  apiClient.patch<{ data: Contact }>(`/stammdaten/contacts/${id}`, body)

// ── Company ───────────────────────────────────────────────────────────────────

export interface Company {
  ID: number
  COMPANY_NAME_1: string
  COMPANY_NAME_2: string | null
  STREET: string | null
  POST_CODE: string | null
  CITY: string | null
  POST_OFFICE_BOX: string | null
  COUNTRY_ID: string | null
  TAX_NUMBER: string | null
  'TAX-ID': string | null
  BIC: string | null
  IBAN: string | null
  'CREDITOR-ID': string | null
}

export interface CompanyPayload {
  company_name_1: string
  company_name_2?: string
  street?: string
  post_code?: string
  city?: string
  post_office_box?: string
  country_id?: string
  tax_number?: string
  tax_id?: string
  bic?: string
  iban?: string
  creditor_id?: string
}

export const fetchCompanies = () =>
  apiClient.get<{ data: Company[] }>('/stammdaten/companies')

export const createCompany = (body: CompanyPayload) =>
  apiClient.post<{ data: unknown }>('/stammdaten/company', body)

export const updateCompany = (id: number, body: CompanyPayload) =>
  apiClient.put<{ data: unknown }>(`/stammdaten/company/${id}`, body)

// ── Stammdaten (status, typ, rollen) ──────────────────────────────────────────

export const createStatus = (name_short: string) =>
  apiClient.post<{ data: unknown }>('/stammdaten/status', { name_short })

export const createTyp = (name_short: string) =>
  apiClient.post<{ data: unknown }>('/stammdaten/typ', { name_short })

export const createDepartment = (name_short: string) =>
  apiClient.post<{ data: unknown }>('/stammdaten/department', { name_short })

export const createRolle = (name_short: string, name_long?: string, sp_rate?: string) =>
  apiClient.post<{ data: unknown }>('/stammdaten/rollen', { name_short, name_long, sp_rate })

export interface Currency { ID: number; NAME_SHORT: string }
export interface VatRate  { ID: number; VAT: string; VAT_PERCENT: number }

export const fetchCurrencies = () =>
  apiClient.get<{ data: Currency[] }>('/stammdaten/currencies')

export const fetchVatList = () =>
  apiClient.get<{ data: VatRate[] }>('/stammdaten/vat')

export const fetchDefaults = () =>
  apiClient.get<{ data: Record<string, string | null> }>('/stammdaten/defaults')

export const putDefault = (key: string, value: string | null) =>
  apiClient.put<{ ok: boolean }>('/stammdaten/defaults', { key, value })

// ── Stammdaten lists + delete ─────────────────────────────────────────────────

export interface StammdatenItem { ID: number; NAME_SHORT: string }
export interface Rolle { ID: number; NAME_SHORT: string; NAME_LONG: string | null; SP_RATE: number | null }

export const fetchDepartments = () =>
  apiClient.get<{ data: StammdatenItem[] }>('/stammdaten/departments')
export const deleteDepartment = (id: number) =>
  apiClient.delete<{ ok: boolean }>(`/stammdaten/department/${id}`)
export const updateDepartment = (id: number, name_short: string) =>
  apiClient.patch<{ data: StammdatenItem }>(`/stammdaten/department/${id}`, { name_short })

export const fetchTypen = () =>
  apiClient.get<{ data: StammdatenItem[] }>('/stammdaten/typen')
export const deleteTyp = (id: number) =>
  apiClient.delete<{ ok: boolean }>(`/stammdaten/typ/${id}`)
export const updateTyp = (id: number, name_short: string) =>
  apiClient.patch<{ data: StammdatenItem }>(`/stammdaten/typ/${id}`, { name_short })

export const fetchRollen = () =>
  apiClient.get<{ data: Rolle[] }>('/stammdaten/rollen')
export const deleteRolle = (id: number) =>
  apiClient.delete<{ ok: boolean }>(`/stammdaten/rolle/${id}`)
export const updateRolle = (id: number, body: { name_short: string; name_long?: string; sp_rate?: string | number | null }) =>
  apiClient.patch<{ data: Rolle }>(`/stammdaten/rolle/${id}`, body)

export const deleteAddress = (id: number) =>
  apiClient.delete<{ ok: boolean }>(`/stammdaten/addresses/${id}`)

export const deleteContact = (id: number) =>
  apiClient.delete<{ ok: boolean }>(`/stammdaten/contacts/${id}`)

// ── Logo ──────────────────────────────────────────────────────────────────────

export const fetchLogo = () =>
  apiClient.get<{ data: { logo_asset_id: number | null; logo_data_uri: string | null } }>('/stammdaten/logo')

export const putLogo = (logo_asset_id: number | null) =>
  apiClient.put<{ ok: boolean }>('/stammdaten/logo', { logo_asset_id })

// ── Per-company assets (logo + signature) ─────────────────────────────────────

export interface CompanyAssets {
  logo_asset_id: number | null
  logo_data_uri: string | null
  sig_asset_id:  number | null
  sig_data_uri:  string | null
}

export const fetchCompanyAssets = (companyId: number) =>
  apiClient.get<{ data: CompanyAssets }>(`/stammdaten/companies/${companyId}/assets`)

export const putCompanyLogo = (companyId: number, asset_id: number | null) =>
  apiClient.put<{ ok: boolean }>(`/stammdaten/companies/${companyId}/logo`, { asset_id })

export const putCompanySignature = (companyId: number, asset_id: number | null) =>
  apiClient.put<{ ok: boolean }>(`/stammdaten/companies/${companyId}/signature`, { asset_id })

export const uploadAsset = (file: File, assetType = 'LOGO') => {
  const form = new FormData()
  form.append('file', file)
  form.append('asset_type', assetType)
  return apiClient.post<{ data: { ID: number }; url: string }>('/assets/upload', form)
}

// ── Working-time models ───────────────────────────────────────────────────────

export interface WorkingTimeModel {
  ID:           number
  NAME:         string
  COUNTRY_CODE: string
  STATE_CODE:   string | null
  MON: number; TUE: number; WED: number; THU: number; FRI: number; SAT: number; SUN: number
}

export interface WorkingTimeModelPayload {
  name:         string
  country_code: string
  state_code?:  string | null
  mon: number; tue: number; wed: number; thu: number; fri: number; sat: number; sun: number
}

export interface CountryState { code: string | null; label: string }

export const fetchCountryStates = () =>
  apiClient.get<{ data: Record<string, CountryState[]> }>('/stammdaten/working-time-models/country-states')

export const fetchWorkingTimeModels = () =>
  apiClient.get<{ data: WorkingTimeModel[] }>('/stammdaten/working-time-models')

export const createWorkingTimeModel = (body: WorkingTimeModelPayload) =>
  apiClient.post<{ data: WorkingTimeModel }>('/stammdaten/working-time-models', body)

export const updateWorkingTimeModel = (id: number, body: WorkingTimeModelPayload) =>
  apiClient.patch<{ data: WorkingTimeModel }>(`/stammdaten/working-time-models/${id}`, body)

export const deleteWorkingTimeModel = (id: number) =>
  apiClient.delete<{ ok: boolean }>(`/stammdaten/working-time-models/${id}`)

// ── Monatsabschluss ───────────────────────────────────────────────────────────

export interface MonatsabschlussSettings {
  enabled:      boolean
  statuses:     number[]
  lastRunMonth: string | null
  lastRunDate:  string | null
  lastRunCount: number | null
}

export const fetchMonatsabschluss = () =>
  apiClient.get<{ data: MonatsabschlussSettings }>('/stammdaten/monatsabschluss')

export const putMonatsabschluss = (body: { enabled: boolean; statuses: number[] }) =>
  apiClient.put<{ ok: boolean }>('/stammdaten/monatsabschluss', body)

export const runMonatsabschlussNow = () =>
  apiClient.post<{ data: { monthKey: string; snapshotCount: number; projectCount: number } }>(
    '/stammdaten/monatsabschluss/run', {}
  )

export const openMonatsabschlussPdf = () =>
  openPdfWithAuth('/stammdaten/monatsabschluss/pdf')
