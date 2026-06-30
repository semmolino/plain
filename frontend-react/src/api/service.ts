import { apiClient } from './client'

// ── Service-Bereich (Vorschläge · Feedback · Unterstützung) ──────────────────
// Phase 0: Zugangs-Gate (Haftungs-/Nutzungsbestätigung) + Produkt-Sprecher.
// Siehe docs/SERVICE_AREA_CONCEPT.md.

export interface ConsentStatus {
  current_version: string
  accepted:        boolean
  accepted_at:     string | null
}

export interface DelegateInfo {
  employee_id:   number | null
  employee_name: string | null
  is_me:         boolean
}

export const fetchConsent = () =>
  apiClient.get<ConsentStatus>('/service/consent')

export const acceptConsent = () =>
  apiClient.post<{ accepted: boolean; current_version: string }>('/service/consent', {})

export const fetchDelegate = () =>
  apiClient.get<DelegateInfo>('/service/delegate')

export const saveDelegate = (employeeId: number | null) =>
  apiClient.put<{ employee_id: number | null }>('/service/delegate', { employee_id: employeeId })

// ── Vorschläge (Phase 1) ─────────────────────────────────────────────────────

export type LifecycleStatus = 'new' | 'reviewing' | 'planned' | 'in_progress' | 'shipped' | 'not_planned'
export type ModerationState = 'pending' | 'published' | 'declined' | 'merged'
export type PriorityHint    = 'nice' | 'important' | 'blocker'

export const SUGGESTION_CATEGORIES: { value: string; label: string }[] = [
  { value: 'projekte',    label: 'Projekte' },
  { value: 'rechnungen',  label: 'Rechnungen' },
  { value: 'angebote',    label: 'Angebote' },
  { value: 'reporting',   label: 'Reporting' },
  { value: 'adressen',    label: 'Adressen' },
  { value: 'mitarbeiter', label: 'Mitarbeiter' },
  { value: 'import',      label: 'Datenimport' },
  { value: 'einvoice',    label: 'E-Rechnung' },
  { value: 'sonstiges',   label: 'Sonstiges' },
]

export interface BoardItem {
  id:               number
  title:            string
  body:             string
  category:         string
  lifecycle_status: LifecycleStatus
  vote_count:       number
  comment_count:    number
  has_my_vote:      boolean
  published_at:     string | null
}

export interface MineItem {
  id:               number
  title:            string
  body:             string
  category:         string
  priority_hint:    PriorityHint | null
  moderation_state: ModerationState
  lifecycle_status: LifecycleStatus
  vote_count:       number
  created_at:       string
  submitter:        string | null
  is_mine:          boolean
  vendor_responses: { body: string; created_at: string }[]
}

export interface SuggestionComment {
  body:        string
  author:      string
  is_official: boolean
  created_at:  string
}

export interface SuggestionDetail {
  id:               number
  title:            string
  body:             string
  category:         string
  lifecycle_status: LifecycleStatus
  moderation_state: ModerationState
  vote_count:       number
  has_my_vote:      boolean
  can_vote:         boolean
  is_own_org:       boolean
  comments:         SuggestionComment[]
  created_at:       string
}

export interface SubmitSuggestionPayload {
  title:          string
  body:           string
  category:       string
  priority_hint?: PriorityHint | null
}

export const fetchBoard = (sort: 'popular' | 'new' = 'popular') =>
  apiClient.get<{ can_vote: boolean; data: BoardItem[] }>(`/service/suggestions/board?sort=${sort}`)

export const fetchMineSuggestions = () =>
  apiClient.get<{ org_view: boolean; data: MineItem[] }>('/service/suggestions/mine')

export const fetchSuggestion = (id: number) =>
  apiClient.get<{ data: SuggestionDetail }>(`/service/suggestions/${id}`)

export const submitSuggestion = (payload: SubmitSuggestionPayload) =>
  apiClient.post<{ data: { ID: number } }>('/service/suggestions', payload)

export const voteSuggestion = (id: number) =>
  apiClient.post<{ has_my_vote: boolean; vote_count: number }>(`/service/suggestions/${id}/vote`, {})

export const unvoteSuggestion = (id: number) =>
  apiClient.delete<{ has_my_vote: boolean; vote_count: number }>(`/service/suggestions/${id}/vote`)

export const commentSuggestion = (id: number, body: string) =>
  apiClient.post<{ ok: boolean; pending: boolean }>(`/service/suggestions/${id}/comments`, { body })

// ── Feedback & Unterstützung (Phase 2) ───────────────────────────────────────

export type ServiceRequestKind   = 'feedback' | 'support'
export type ServiceRequestStatus = 'new' | 'in_progress' | 'waiting' | 'resolved' | 'closed'
export type Urgency              = 'question' | 'impaired' | 'blocker'

export interface ContactPrefill { name: string; email: string; org: string }

export interface MyRequest {
  id:          number
  kind:        ServiceRequestKind
  category:    string | null
  subject:     string
  body:        string
  status:      ServiceRequestStatus
  urgency:     Urgency | null
  wants_reply: boolean
  created_at:  string
}

export interface RequestMessage {
  body:       string
  author:     string
  is_vendor:  boolean
  created_at: string
}

export interface RequestDetail {
  id:         number
  kind:       ServiceRequestKind
  category:   string | null
  subject:    string
  body:       string
  status:     ServiceRequestStatus
  urgency:    Urgency | null
  created_at: string
  messages:   RequestMessage[]
}

export interface SubmitRequestPayload {
  kind:           ServiceRequestKind
  category?:      string | null
  subject:        string
  body:           string
  contact_name?:  string
  contact_email?: string
  wants_reply?:   boolean
  urgency?:       Urgency | null
}

export const fetchContactPrefill = () =>
  apiClient.get<ContactPrefill>('/service/requests/contact')

export const submitRequest = (payload: SubmitRequestPayload) =>
  apiClient.post<{ data: { ID: number } }>('/service/requests', payload)

export const fetchMyRequests = (kind: ServiceRequestKind) =>
  apiClient.get<{ data: MyRequest[] }>(`/service/requests/mine?kind=${kind}`)

export const fetchRequest = (id: number) =>
  apiClient.get<{ data: RequestDetail }>(`/service/requests/${id}`)

export const postRequestMessage = (id: number, body: string) =>
  apiClient.post<{ ok: boolean }>(`/service/requests/${id}/messages`, { body })
