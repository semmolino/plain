import { apiClient, openPdfWithAuth } from './client'

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
  OFFER_DATE:      string | null
  VALID_UNTIL:     string | null
  PROJECT_ID:      number | null
  ORDER_DATE:      string | null
}

export interface ConvertOfferPayload {
  order_date:         string
  project_status_id:  number
  project_manager_id: number
  project_type_id?:   number | null
  department_id?:     number | null
  employee2project?:  Array<{
    employee_id:      number
    role_id?:         number | null
    role_name_short?: string
    role_name_long?:  string
    sp_rate?:         number | null
  }>
}

export interface OfferListItem {
  ID:              number
  NAME_SHORT:      string | null
  NAME_LONG:       string
  PROBABILITY:     number | null
  CREATED_AT:      string | null
  OFFER_DATE:      string | null
  VALID_UNTIL:     string | null
  TOTAL_AMOUNT:    number | null
  STATUS_NAME:     string | null
  OFFER_STATUS_ID: number | null
  EMPLOYEE_NAME:   string | null
  ADDRESS_NAME:    string | null
  CONTACT_NAME:    string | null
  PROJECT_ID:      number | null
  PROJECT_NAME:    string | null
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
  offer_date?:      string
  valid_until?:     string | null
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
  offer_date?:       string | null
  valid_until?:      string | null
  refusal_date?:     string | null
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

export const openOfferPdf = (id: number) =>
  openPdfWithAuth(`/angebote/${id}/pdf`)

export const openAuftragsbestaetigungPdf = (id: number) =>
  openPdfWithAuth(`/angebote/${id}/auftragsbestaetigung`)

export const convertOffer = (id: number, body: ConvertOfferPayload) =>
  apiClient.post<{ data: { project: { ID: number; NAME_SHORT: string }; projectName: string } }>(`/angebote/${id}/convert`, body)
