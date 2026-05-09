import { apiClient } from './client'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface OfferStatus {
  ID:         number
  NAME_SHORT: string
}

export interface Offer {
  ID:              number
  NAME_SHORT:      string | null
  NAME_LONG:       string
  EMPLOYEE_ID:     number | null
  PROBABILITY:     number | null
  OFFER_TEXT_1:    string | null
  OFFER_TEXT_2:    string | null
  ADDRESS_ID:      number | null
  CONTACT_ID:      number | null
  OFFER_STATUS_ID: number | null
  COMPANY_ID:      number | null
  TENANT_ID:       number | null
  CREATED_AT:      string | null
}

export interface OfferListItem {
  ID:              number
  NAME_SHORT:      string | null
  NAME_LONG:       string
  PROBABILITY:     number | null
  CREATED_AT:      string | null
  STATUS_NAME:     string | null
  OFFER_STATUS_ID: number | null
  EMPLOYEE_NAME:   string | null
  ADDRESS_NAME:    string | null
  CONTACT_NAME:    string | null
}

export interface OfferStructureNode {
  ID:              number
  NAME_SHORT:      string | null
  NAME_LONG:       string | null
  OFFER_ID:        number
  REVENUE:         number
  EXTRAS_PERCENT:  number
  EXTRAS:          number
  BILLING_TYPE_ID: number | null
  FATHER_ID:       number | null
  SORT_ORDER:      number
  QUANTITY:        number | null
  SP_RATE:         number | null
  ROLE_NAME_SHORT: string | null
  ROLE_NAME_LONG:  string | null
  ROLE_ID:         number | null
  TENANT_ID:       number | null
}

export interface OfferStructureDraftRow {
  tmp_key:         string
  father_tmp_key:  string
  NAME_SHORT:      string
  NAME_LONG:       string
  BILLING_TYPE_ID: string
  EXTRAS_PERCENT:  string
  REVENUE:         string
  QUANTITY:        string
  SP_RATE:         string
  ROLE_ID:         string
  ROLE_NAME_SHORT: string
  ROLE_NAME_LONG:  string
}

export interface CreateOfferPayload {
  name_long:        string
  company_id:       string | number
  offer_status_id:  string | number
  employee_id:      string | number
  address_id:       string | number
  contact_id:       string | number
  probability?:     string | number
  offer_text_1?:    string
  offer_text_2?:    string
  offer_structure?: OfferStructureDraftRow[]
}

export interface UpdateOfferPayload {
  name_long?:        string
  company_id?:       string | number
  offer_status_id?:  string | number
  employee_id?:      string | number
  address_id?:       string | number
  contact_id?:       string | number
  probability?:      string | number | null
  offer_text_1?:     string | null
  offer_text_2?:     string | null
}

export interface AddStructureNodePayload {
  name_short?:       string
  name_long?:        string
  billing_type_id:   string | number
  extras_percent?:   string | number
  revenue?:          string | number
  quantity?:         string | number
  sp_rate?:          string | number
  role_id?:          string | number
  role_name_short?:  string
  role_name_long?:   string
  father_id?:        string | number | null
}

export interface UpdateStructureNodePayload {
  name_short?:       string
  name_long?:        string
  billing_type_id?:  string | number
  extras_percent?:   string | number
  revenue?:          string | number
  quantity?:         string | number
  sp_rate?:          string | number
  role_id?:          string | number | null
  role_name_short?:  string
  role_name_long?:   string
}

// ── API calls ─────────────────────────────────────────────────────────────────

export const fetchOfferStatuses = () =>
  apiClient.get<{ data: OfferStatus[] }>('/angebote/statuses')

export const createOfferStatus = (name_short: string) =>
  apiClient.post<{ data: OfferStatus }>('/angebote/statuses', { name_short })

export const fetchOffers = () =>
  apiClient.get<{ data: OfferListItem[] }>('/angebote')

export const fetchOffer = (id: number) =>
  apiClient.get<{ data: Offer }>(`/angebote/${id}`)

export const createOffer = (body: CreateOfferPayload) =>
  apiClient.post<{ data: Offer }>('/angebote', body)

export const updateOffer = (id: number, body: UpdateOfferPayload) =>
  apiClient.put<{ data: Offer }>(`/angebote/${id}`, body)

export const deleteOffer = (id: number) =>
  apiClient.delete<{ ok: boolean }>(`/angebote/${id}`)

export const fetchOfferStructure = (offerId: number) =>
  apiClient.get<{ data: OfferStructureNode[] }>(`/angebote/${offerId}/structure`)

export const addOfferStructureNode = (offerId: number, body: AddStructureNodePayload) =>
  apiClient.post<{ data: OfferStructureNode }>(`/angebote/${offerId}/structure`, body)

export const updateOfferStructureNode = (offerId: number, nodeId: number, body: UpdateStructureNodePayload) =>
  apiClient.put<{ data: OfferStructureNode }>(`/angebote/${offerId}/structure/${nodeId}`, body)

export const deleteOfferStructureNode = (offerId: number, nodeId: number) =>
  apiClient.delete<{ ok: boolean }>(`/angebote/${offerId}/structure/${nodeId}`)

export const getOfferPdfUrl = (id: number, download = false) =>
  `/api/v1/angebote/${id}/pdf${download ? '?download=1' : ''}`
