import { apiClient } from './client'

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

export interface CompanyPayload {
  company_name_1: string
  company_name_2?: string
  street: string
  post_code: string
  city: string
  country_id: string
  tax_id?: string
}

export const createCompany = (body: CompanyPayload) =>
  apiClient.post<{ data: unknown }>('/stammdaten/company', body)

// ── Stammdaten (status, typ, rollen) ──────────────────────────────────────────

export const createStatus = (name_short: string) =>
  apiClient.post<{ data: unknown }>('/stammdaten/status', { name_short })

export const createTyp = (name_short: string) =>
  apiClient.post<{ data: unknown }>('/stammdaten/typ', { name_short })

export const createRolle = (name_short: string, name_long?: string) =>
  apiClient.post<{ data: unknown }>('/stammdaten/rollen', { name_short, name_long })

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
