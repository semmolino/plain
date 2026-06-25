import { apiClient } from './client'

// ── Buchungsarten: Pauschalen & Stückleistungen ───────────────────────────────

export type BookingKind = 'UNIT' | 'LUMP_COST' | 'LUMP_REVENUE'

export const BOOKING_KIND_LABEL: Record<BookingKind, string> = {
  UNIT:         'Stückleistung',
  LUMP_COST:    'Pauschale (Kosten)',
  LUMP_REVENUE: 'Pauschale (Erlös)',
}

export interface BookingType {
  ID:              number
  KIND:            BookingKind
  NAME_SHORT:      string
  NAME_LONG:       string | null
  UNIT_LABEL:      string | null
  UNIT_CODE:       string | null
  DEFAULT_SP_RATE: number | null
  DEFAULT_CP_RATE: number | null
  SCOPE:           'global' | 'project'
  PROJECT_ID:      number | null
  ACTIVE:          number
  SORT_ORDER:      number | null
}

export interface BookingTypePayload {
  kind:            BookingKind
  name_short:      string
  name_long?:      string | null
  unit_label?:     string | null
  unit_code?:      string | null
  default_sp_rate?: number | null
  default_cp_rate?: number | null
  scope?:          'global' | 'project'
  project_id?:     number | null
  active?:         number
  sort_order?:     number | null
}

// ── Katalog-Verwaltung (Stammdaten) ───────────────────────────────────────────

export const fetchBookingTypes = (params?: { projectId?: number; activeOnly?: boolean }) => {
  const q = new URLSearchParams()
  if (params?.projectId != null) q.set('project_id', String(params.projectId))
  if (params?.activeOnly) q.set('active', '1')
  const qs = q.toString()
  return apiClient.get<{ data: BookingType[] }>(`/stammdaten/booking-types${qs ? `?${qs}` : ''}`)
}

export const createBookingType = (body: BookingTypePayload) =>
  apiClient.post<{ data: BookingType }>('/stammdaten/booking-types', body)

export const updateBookingType = (id: number, body: BookingTypePayload) =>
  apiClient.patch<{ data: BookingType }>(`/stammdaten/booking-types/${id}`, body)

export const deleteBookingType = (id: number) =>
  apiClient.delete<{ success: boolean }>(`/stammdaten/booking-types/${id}`)

// ── Auswahl beim Buchen (global + projektbezogen, nur aktive) ──────────────────

export interface SelectableBookingType {
  ID:              number
  KIND:            BookingKind
  NAME_SHORT:      string
  NAME_LONG:       string | null
  UNIT_LABEL:      string | null
  UNIT_CODE:       string | null
  DEFAULT_SP_RATE: number | null
  DEFAULT_CP_RATE: number | null
  SCOPE:           'global' | 'project'
  PROJECT_ID:      number | null
}

export const fetchSelectableBookingTypes = (projectId: number) =>
  apiClient.get<{ data: SelectableBookingType[] }>(`/buchungen/booking-types?project_id=${projectId}`)

// ── Spezial-Buchung anlegen (nicht stundenbasiert) ────────────────────────────

export interface CreateSpecialBuchungPayload {
  BOOKING_KIND:        BookingKind
  PROJECT_ID:          number
  STRUCTURE_ID?:       number
  DATE_VOUCHER:        string
  BOOKING_TYPE_ID?:    number
  POSTING_DESCRIPTION: string
  // UNIT
  QUANTITY?:           number
  UNIT_LABEL?:         string
  SP_RATE?:            number
  CP_RATE?:            number
  // LUMP_COST / LUMP_REVENUE
  AMOUNT?:             number
}

export const createSpecialBuchung = (body: CreateSpecialBuchungPayload) =>
  apiClient.post<{ success: boolean }>('/buchungen/special', body)
