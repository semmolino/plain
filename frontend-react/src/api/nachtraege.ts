import { apiClient, openPdfWithAuth } from './client'

// ── Types ─────────────────────────────────────────────────────────────────────

export type NachtragType     = 'OWN' | 'MANAGED'
export type NachtragCategory = 'CHANGED' | 'ADDITIONAL' | 'QUANTITY' | 'SPECIAL' | 'DISRUPTION' | 'CONTENT' | 'CIRCUMSTANCE'
export type ReleaseKind      = 'FULL' | 'PARTIAL' | 'PROVISIONAL'
export type ReleaseBasis     = 'WRITTEN' | 'ORAL' | 'ORDER'
export type ApprovalState    = 'OPEN' | 'APPROVED' | 'PARTIAL' | 'REJECTED'
export type ReviewRecommendation = 'ACCEPT' | 'REDUCE' | 'REJECT' | 'QUERY'

export interface NachtragStatus {
  ID:             number
  CODE:           string
  NAME_SHORT:     string
  SORT_ORDER:     number
  IS_TERMINAL:    boolean
  ALLOWS_RELEASE: boolean
}

export interface NachtragListItem {
  ID:                  number
  NAME_SHORT:          string | null
  NAME_LONG:           string
  NACHTRAG_TYPE:       NachtragType
  CATEGORY:            NachtragCategory | null
  STATUS_CODE:         string | null
  STATUS_NAME:         string | null
  NACHTRAG_STATUS_ID:  number | null
  PROJECT_ID:          number | null
  PROJECT_NAME:        string | null
  EMPLOYEE_NAME:       string | null
  ADDRESS_NAME:        string | null
  REVIEW_DUE_DATE:     string | null
  AMOUNT_CLAIMED_NET:  number
  AMOUNT_APPROVED_NET: number
  CREATED_AT:          string | null
}

export interface Nachtrag {
  ID:                  number
  TENANT_ID:           number | null
  PROJECT_ID:          number
  CONTRACT_ID:         number | null
  OFFER_ID:            number | null
  NAME_SHORT:          string | null
  NAME_LONG:           string
  NACHTRAG_TYPE:       NachtragType
  NACHTRAG_STATUS_ID:  number | null
  CATEGORY:            NachtragCategory | null
  CLAIM_BASIS:         string | null
  REASON:              string | null
  IS_GRANTED_BASIS:    boolean
  EMPLOYEE_ID:         number | null
  ADDRESS_ID:          number | null
  CONTACT_ID:          number | null
  COMPANY_ID:          number | null
  VAT_ID:              number | null
  ANNOUNCED_DATE:      string | null
  SUBMITTED_DATE:      string | null
  REVIEW_DUE_DATE:     string | null
  DECISION_DATE:       string | null
  AMOUNT_CLAIMED_NET:  number
  AMOUNT_APPROVED_NET: number
  REVIEW_FORMAL:         boolean
  REVIEW_CONTENT:        boolean
  REVIEW_CALCULATION:    boolean
  REVIEW_NOTE:           string | null
  REVIEW_RECOMMENDATION: ReviewRecommendation | null
  REVIEWED_AT:           string | null
  REVIEWED_BY:           number | null
  CREATED_AT:          string | null
}

export interface NachtragStructureNode {
  ID:                    number
  NAME_SHORT:            string | null
  NAME_LONG:             string | null
  NACHTRAG_ID:           number
  FATHER_ID:             number | null
  SORT_ORDER:            number
  BILLING_TYPE_ID:       number | null
  REVENUE_BASIS:         number | null
  REVENUE:               number
  EXTRAS_PERCENT:        number
  EXTRAS:                number
  QUANTITY:              number | null
  SP_RATE:               number | null
  ROLE_NAME_SHORT:       string | null
  ROLE_NAME_LONG:        string | null
  ROLE_ID:               number | null
  SURCHARGES_TOTAL:      number
  APPROVAL_STATE:        ApprovalState
  APPROVED_AMOUNT_NET:   number | null
  RELEASED_STRUCTURE_ID: number | null
}

export interface NachtragRelease {
  ID:            number
  NACHTRAG_ID:   number
  RELEASE_NO:    number
  RELEASE_KIND:  ReleaseKind
  RELEASE_BASIS: ReleaseBasis | null
  AMOUNT_NET:    number
  RELEASED_BY:   number | null
  RELEASED_AT:   string | null
  NOTE:          string | null
}

export interface CreateNachtragPayload {
  project_id:       number
  name_long:        string
  nachtrag_type?:   NachtragType
  category?:        NachtragCategory | null
  claim_basis?:     string
  reason?:          string
  employee_id?:     number
  review_due_date?: string | null
}

export interface UpdateNachtragPayload {
  name_long?:       string
  category?:        NachtragCategory | null
  claim_basis?:     string | null
  reason?:          string | null
  is_granted_basis?: boolean
  status_code?:     string
  employee_id?:     number | null
  announced_date?:  string | null
  submitted_date?:  string | null
  review_due_date?: string | null
  decision_date?:   string | null
}

export interface ReviewPayload {
  review_formal:          boolean
  review_content:         boolean
  review_calculation:     boolean
  review_note?:           string
  review_recommendation?: ReviewRecommendation | null
}

export interface AddNachtragStructureNodePayload {
  name_short?:      string
  name_long?:       string
  billing_type_id:  string | number
  extras_percent?:  string | number
  revenue?:         string | number
  quantity?:        string | number
  sp_rate?:         string | number
  father_id?:       string | number | null
}

export interface ReleasePayload {
  release_kind:  ReleaseKind
  release_basis?: ReleaseBasis
  note?:         string
  positions?:    Array<{ nachtrag_structure_id: number; approved_amount_net?: number | null }>
}

export interface ReleaseResult {
  release_no:          number
  amount_net:          number
  approved_total_net:  number
  status_code:         string
  group_structure_id:  number
}

// ── API calls ─────────────────────────────────────────────────────────────────

export const fetchNachtragStatuses = () =>
  apiClient.get<{ data: NachtragStatus[] }>('/nachtraege/statuses')

export const fetchNachtraege = (projectId?: number) =>
  apiClient.get<{ data: NachtragListItem[] }>(`/nachtraege${projectId ? `?project_id=${projectId}` : ''}`)

export const fetchNachtrag = (id: number) =>
  apiClient.get<{ data: Nachtrag }>(`/nachtraege/${id}`)

export const createNachtrag = (body: CreateNachtragPayload) =>
  apiClient.post<{ data: Nachtrag }>('/nachtraege', body)

export const updateNachtrag = (id: number, body: UpdateNachtragPayload) =>
  apiClient.put<{ data: Nachtrag }>(`/nachtraege/${id}`, body)

export const deleteNachtrag = (id: number) =>
  apiClient.delete<{ ok: boolean }>(`/nachtraege/${id}`)

export const fetchNachtragStructure = (id: number) =>
  apiClient.get<{ data: NachtragStructureNode[] }>(`/nachtraege/${id}/structure`)

export const addNachtragStructureNode = (id: number, body: AddNachtragStructureNodePayload) =>
  apiClient.post<{ data: NachtragStructureNode }>(`/nachtraege/${id}/structure`, body)

export const deleteNachtragStructureNode = (id: number, nodeId: number) =>
  apiClient.delete<{ ok: boolean }>(`/nachtraege/${id}/structure/${nodeId}`)

export const releaseNachtrag = (id: number, body: ReleasePayload) =>
  apiClient.post<{ data: ReleaseResult }>(`/nachtraege/${id}/release`, body)

export const fetchNachtragReleases = (id: number) =>
  apiClient.get<{ data: NachtragRelease[] }>(`/nachtraege/${id}/releases`)

export const saveNachtragReview = (id: number, body: ReviewPayload) =>
  apiClient.put<{ data: Nachtrag }>(`/nachtraege/${id}/review`, body)

export const openNachtragPdf = (id: number) =>
  openPdfWithAuth(`/nachtraege/${id}/pdf`)

// ── UI-Labels (deutsch) ─────────────────────────────────────────────────────

export const CATEGORY_LABELS: Record<NachtragCategory, string> = {
  CHANGED:      'Geänderte Leistung',
  ADDITIONAL:   'Zusätzliche Leistung',
  QUANTITY:     'Mengen-/Umfangsänderung',
  SPECIAL:      'Besondere Leistung',
  DISRUPTION:   'Gestörter Bauablauf',
  CONTENT:      'Bauinhaltsnachtrag',
  CIRCUMSTANCE: 'Bauumstandsnachtrag',
}

export const RELEASE_KIND_LABELS: Record<ReleaseKind, string> = {
  FULL:        'Voll-Freigabe',
  PARTIAL:     'Teilfreigabe',
  PROVISIONAL: 'Vorläufige Anordnung',
}

export const RELEASE_BASIS_LABELS: Record<ReleaseBasis, string> = {
  WRITTEN: 'Schriftlich',
  ORAL:    'Mündlich',
  ORDER:   'Anordnung',
}

export const RECOMMENDATION_LABELS: Record<ReviewRecommendation, string> = {
  ACCEPT: 'Anerkennen',
  REDUCE: 'Kürzen',
  REJECT: 'Ablehnen',
  QUERY:  'Rückfrage',
}
